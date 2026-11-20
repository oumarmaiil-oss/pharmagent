"""Tests de l'agent sans ERP réel : fenêtres, panneau, démo clavier, remplacement d'un ancien agent, lanceur Mac."""
import json
import pathlib
import plistlib
import sys
import tempfile
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _agent import Checker, load_agent  # noqa: E402

A = load_agent()
check = Checker()
real_run, real_system = A.subprocess.run, A.SYSTEM
R = lambda out, rc=0: types.SimpleNamespace(stdout=out, returncode=rc, stderr="")

# Liste des fenêtres et fenêtre active (macOS simulé)
A.SYSTEM = "Darwin"
A.subprocess.run = lambda *a, **k: R("Finder, Google Chrome, Numbers, Terminal, PharmAgent\n")
check("liste sans Finder/Terminal/PharmAgent", A.list_windows() == ["Google Chrome", "Numbers"], A.list_windows())
A.subprocess.run = lambda *a, **k: R("", 1)
check("échec osascript => fenêtre inconnue (ne bloque pas la démo)", A.foreground_title() is None)
A.subprocess.run = lambda *a, **k: R("Numbers\n")
check("fenêtre active lue", A.foreground_title() == "Numbers")
A.subprocess.run, A.SYSTEM = real_run, real_system

# « Changer d'ERP » puis « Continuer »
e = A.Engine("http://127.0.0.1:9")
e.api.key = "k"
e.profile = {"mode": "desktop", "windowTitle": "Autre", "headerSteps": [], "lineSteps": []}
e._handle("change_setup", {})
check("Changer d'ERP => écran de choix", e.state()["status"] == "setup")
for bad in ("Finder", ""):
    try:
        e._handle("setup", {"mode": "desktop", "windowTitle": bad})
        check(f"fenêtre « {bad} » refusée", False)
    except ValueError:
        check(f"fenêtre « {bad} » refusée", True)
e._handle("setup", {"mode": "desktop", "windowTitle": "Numbers"})
st = e.state()
check("Continuer => écran de démonstration", st["status"] == "prepare" and st["setup"]["windowTitle"] == "Numbers", st["status"])

# Compteur de la démo clavier
e.recording = {"phase": "header", "mode": "desktop", "events": [], "started": time.time()}
e.key_recorder = A.KeyRecorder("Numbers")
e.key_recorder.steps = [{"kind": "type", "value": "UBIPHARM"}, {"kind": "key", "key": "enter"}]
e.key_recorder.buf = "BL-1"
v = e.state()["recording"]
check("compteur et aperçu de la démo clavier", v["count"] == 3 and any("UBIPHARM" in p for p in v["preview"]) and v["wanted"] == "Numbers", v)
e.recording, e.key_recorder = None, None

# Un agent d'une autre version est remplacé, pas un agent de la même version
quits = []


def handler(version):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            body = json.dumps({"version": version}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            quits.append(self.path)
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")
    return H


for version, expected in (("2.1.0", True), (A.AGENT_VERSION, False)):
    srv = HTTPServer(("127.0.0.1", 0), handler(version))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    quits.clear()
    res = A.replace_running_agent(f"http://127.0.0.1:{srv.server_port}/")
    srv.shutdown()
    check(f"agent {version} remplacé = {expected}", res is expected and (quits == ["/api/quit"]) == expected, quits)

# Lanceur macOS (osacompile simulé)
home = pathlib.Path(tempfile.mkdtemp())
A.SYSTEM = "Darwin"
A.HOME = home / "Library" / "Application Support" / "PharmAgent"
A.HOME.mkdir(parents=True)
real_home = pathlib.Path.home
pathlib.Path.home = staticmethod(lambda: home)
calls = []


def fake_run(args, **k):
    calls.append(args)
    if args[0] == "osacompile":
        pathlib.Path(args[2]).mkdir(parents=True)
    return R("")


A.subprocess.run = fake_run
A.ensure_mac_launcher("https://pharmagent.onrender.com")
script = [calls[0][i + 1] for i, x in enumerate(calls[0]) if x == "-e"] if calls else []
check("application PharmAgent : ouvre le Terminal et lance l'agent", len(calls) == 1 and script[0] == 'tell application "Terminal"' and "--server" in script[2], script)
plist = plistlib.loads((home / "Library" / "LaunchAgents" / "com.pharmagent.agent.plist").read_bytes())
check("démarrage automatique par la même application", plist["ProgramArguments"][:3] == ["/usr/bin/open", "-g", "-a"] and plist["RunAtLoad"])
calls.clear()
A.ensure_mac_launcher("https://pharmagent.onrender.com")
check("rien à refaire au lancement suivant", calls == [])
pathlib.Path.home, A.subprocess.run, A.SYSTEM = real_home, real_run, real_system

check.exit()
