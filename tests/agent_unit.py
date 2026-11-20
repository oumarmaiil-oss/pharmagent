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
for bad in ("Finder", "", "Numbers", "Microsoft Excel"):
    try:
        e._handle("setup", {"mode": "desktop", "windowTitle": bad})
        check(f"fenêtre « {bad} » refusée", False)
    except ValueError:
        check(f"fenêtre « {bad} » refusée", True)
e._handle("setup", {"mode": "desktop", "windowTitle": "LogiPharm"})
st = e.state()
check("Continuer => écran de démonstration", st["status"] == "prepare" and st["setup"]["windowTitle"] == "LogiPharm", st["status"])

# Compteur de la démo clavier
e.recording = {"phase": "header", "mode": "desktop", "events": [], "started": time.time()}
e.key_recorder = A.KeyRecorder("LogiPharm")
e.key_recorder.steps = [{"kind": "type", "value": "UBIPHARM"}, {"kind": "key", "key": "enter"}]
e.key_recorder.buf = "BL-1"
v = e.state()["recording"]
check("compteur et aperçu de la démo clavier", v["count"] == 3 and any("UBIPHARM" in p for p in v["preview"]) and v["wanted"] == "LogiPharm", v)
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
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
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

# Garde-fou : boutons finaux interdits (logiciel ET site du grossiste), boutons de brouillon autorisés
for label in ("Valider", "Confirmer la réception", "Clôturer", "Commander", "Passer la commande", "Payer", "Checkout"):
    check(f"garde-fou bloque « {label} »", A.forbidden_text(label))
for label in ("Ajouter au panier", "Enregistrer le brouillon", "Commandes", "Quantité", "Rechercher"):
    check(f"garde-fou laisse passer « {label} »", not A.forbidden_text(label))

# Injection de touches : un texte lu sur un bon ne doit jamais taper Entrée ou Tab dans l'ERP
check("saut de ligne et tabulation neutralisés", A.format_value("product", "DOLI\nPRANE\t1000\r\n", None) == "DOLI PRANE 1000", A.format_value("product", "DOLI\nPRANE\t1000\r\n", None))
check("mise à jour refusée sans HTTPS", A.self_update("http://pirate.example") is None)

# Clavier : jamais de frappe si la fenêtre active est inconnue ou si le logiciel n'est pas ouvert
real_fg, real_act = A.foreground_title, A.activate_window
A.foreground_title = lambda: None
check("fenêtre active inconnue : considérée comme PAS le logiciel", A.foreground_is("Numbers") is False)
A.activate_window = lambda t: False
try:
    A.KeyPlayer.ensure_window(types.SimpleNamespace(title="Numbers")); ok = False
except A.StepError as e:
    ok = "n'est pas ouvert" in str(e)
check("logiciel fermé : arrêt avant toute frappe, message clair", ok)
A.foreground_title = lambda: "Mail"; A.activate_window = lambda t: True
try:
    A.KeyPlayer.ensure_window(types.SimpleNamespace(title="Numbers")); ok = False
except A.StepError as e:
    ok = "premier plan" in str(e)
check("autre fenêtre au premier plan : arrêt", ok)
A.foreground_title, A.activate_window = real_fg, real_act
calls = []
A.SYSTEM = "Darwin"
A.subprocess.run = lambda args, **k: calls.append(args) or R("absent\n")
check("Mac : un logiciel fermé n'est jamais lancé", A.activate_window("Numbers") is False and "is running" in " ".join(calls[-1]))
A.subprocess.run, A.SYSTEM = real_run, real_system

# Mode fichier : le bon est écrit dans une copie du modèle, sans démo ni frappe
import base64 as _b64
tmpd = pathlib.Path(tempfile.mkdtemp())
tpl = tmpd / "Reception.xlsx"; tpl.write_bytes(b"MODELE")
opened, sent = [], []
A.open_file = lambda p_: opened.append(p_)
class _Api:
    def call(self, m, path, body=None, timeout=30):
        sent.append((m, path, body))
        if path.endswith("/fill-file"):
            return {"fileBase64": _b64.b64encode(b"REMPLI").decode(), "report": {"linesWritten": 2, "missingLabels": []}}
        return {}
eng = types.SimpleNamespace(profile={"mode": "file", "filePath": str(tpl)}, stop_flag=threading.Event(), task=None, last_result=None,
                            api=_Api(), _persist=lambda: None, _pending_products=[], web=None)
A.Engine._run_task(eng, {"id": "dr-1", "header": {"documentNumber": "BL/77"}, "lines": [{"index": 0, "product": "A"}, {"index": 1, "product": "B"}]})
out = tmpd / "Reception - BL-77.xlsx"
check("mode fichier : copie remplie créée à côté du modèle, modèle intact", out.read_bytes() == b"REMPLI" and tpl.read_bytes() == b"MODELE", list(tmpd.iterdir()))
check("mode fichier : la copie s'ouvre", opened == [str(out)])
res = [b for m, p_, b in sent if p_.endswith("/result")][0]
check("mode fichier : résultat « fait » envoyé au serveur", res["status"] == "done" and "Reception - BL-77.xlsx" in res["message"], res)
A.Engine._run_task(eng, {"id": "dr-2", "header": {"documentNumber": "BL/77"}, "lines": [{"index": 0}]})
check("deuxième bon au même numéro : nouveau fichier, rien n'est écrasé", (tmpd / "Reception - BL-77 (2).xlsx").exists())
tpl.unlink()
A.Engine._run_task(eng, {"id": "dr-3", "header": {}, "lines": [{"index": 0}]})
res = [b for m, p_, b in sent if p_ == "/api/agent-client/tasks/dr-3/result"][0]
check("modèle déplacé : échec clair, rien d'écrit", res["status"] == "failed" and "introuvable" in res["message"], res)

check.exit()
