"""Serveur réel sans clé d'IA : connexions, quotas, accès entre officines, sauvegarde, téléchargements.
Prérequis : npm run build (le serveur sert dist/)."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _agent import ROOT, Checker  # noqa: E402

PORT = int(os.environ.get("SMOKE_PORT", "4077"))
B = f"http://127.0.0.1:{PORT}"
check = Checker()
env = {**os.environ, "DATA_DIR": tempfile.mkdtemp(), "PORT": str(PORT), "NODE_ENV": "production",
       "PHARMAGENT_OWNER_PASSWORD": "ownerpw", "PHARMAGENT_PHARMACY_DEFAULT_PASSWORD": "phpw"}
for k in ("ANTHROPIC_API_KEY", "DATABASE_URL"):
    env.pop(k, None)
log = open(os.path.join(env["DATA_DIR"], "server.log"), "w")
srv = subprocess.Popen(["npx", "tsx", "server.ts"], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)


def call(method, path, body=None, token=None, raw=False):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
            return (data if raw else json.loads(data or b"{}")), r.status, r.headers
    except urllib.error.HTTPError as e:
        data = e.read()
        return (data if raw else json.loads(data or b"{}")), e.code, e.headers


try:
    for _ in range(60):
        try:
            if call("GET", "/api/health")[1] == 200:
                break
        except Exception:
            time.sleep(1)
    check("serveur démarré", call("GET", "/api/health")[1] == 200)
    check("mauvais mot de passe refusé", call("POST", "/api/owner/auth/login", {"loginId": "dr.oumar", "password": "x"})[1] == 401)
    owner = call("POST", "/api/owner/auth/login", {"loginId": "dr.oumar", "password": "ownerpw"})[0]["token"]
    mk = lambda n: call("POST", "/api/pharmacies", {"name": n, "city": "Dakar", "pharmacist": "T", "targetSoftware": "Excel / Tableur"}, owner)[0]["pharmacy"]["id"]
    pa, pb = mk("ZZ A"), mk("ZZ B")
    user_b = call("POST", f"/api/pharmacies/{pb}/auth/login", {"loginId": "titulaire", "password": "phpw"})[0]["token"]

    body, status, _ = call("POST", "/api/agent/extract", {"pharmacyId": pa, "sampleAssetPath": "/src/assets/images/sample_bon_livraison_1795017387838.jpg"}, owner)
    check("analyse lancée en arrière-plan", status == 200 and body["draft"]["extractionStatus"] == "processing")
    did = body["draft"]["id"]
    for _ in range(30):
        d = call("GET", f"/api/drafts/{did}", token=owner)[0]["draft"]
        if d["extractionStatus"] != "processing":
            break
        time.sleep(0.5)
    check("sans clé d'IA : échec lisible et brouillon rejeté", d["extractionStatus"] == "error" and "ANTHROPIC_API_KEY" in d.get("extractionError", "") and d["status"] == "rejected", d.get("extractionError"))
    used = [p for p in call("GET", "/api/dashboard", token=owner)[0]["pharmacies"] if p["id"] == pa][0]["usedThisMonth"]
    check("quota rendu après échec", used == 0, used)
    check("approbation d'un brouillon en échec refusée", call("POST", f"/api/drafts/{did}/approve", {}, owner)[1] == 400)
    check("remplissage Excel refusé sans analyse", call("POST", f"/api/drafts/{did}/fill-excel", {"fileBase64": "AA=="}, owner)[1] == 400)
    check("brouillon d'une autre officine inaccessible", call("GET", f"/api/drafts/{did}", token=user_b)[1] == 403)

    call("PATCH", f"/api/pharmacies/{pa}/subscription", {"plan": "trial", "quota": 0}, owner)
    body, status, _ = call("POST", "/api/agent/extract", {"pharmacyId": pa, "sampleAssetPath": "/src/assets/images/sample_bon_livraison_1795017387838.jpg"}, owner)
    check("quota atteint : analyse refusée avec message", status == 429 and "Quota" in body.get("error", ""), body)

    check("sauvegarde réservée au propriétaire", call("GET", "/api/owner/backup", token=user_b)[1] in (401, 403))
    backup, status, headers = call("GET", "/api/owner/backup", token=owner)
    check("sauvegarde téléchargée", status == 200 and "attachment" in headers.get("Content-Disposition", "") and len(backup["pharmacies"]) >= 3)
    check("restauration d'un fichier invalide refusée", call("POST", "/api/owner/restore", {"data": {"x": 1}}, owner)[1] == 400)
    backup["pharmacies"] = [p for p in backup["pharmacies"] if p["id"] != pb]
    body, status, _ = call("POST", "/api/owner/restore", {"data": backup}, owner)
    names = [p["name"] for p in call("GET", "/api/dashboard", token=owner)[0]["pharmacies"]]
    check("restauration appliquée", status == 200 and "ZZ B" not in names and "ZZ A" in names, names)

    data, status, headers = call("GET", "/install/mac.zip", raw=True)
    check("installeur Mac (zip)", status == 200 and data[:2] == b"PK" and b"PharmAgent-Mac.command" in data)
    version = call("GET", "/agent/version")[0]["version"]
    agent_src = pathlib.Path(ROOT, "agent", "pharmagent_agent.py").read_text(encoding="utf-8")
    check("version de l'agent servie", f'AGENT_VERSION = "{version}"' in agent_src, version)
finally:
    srv.terminate()
check.exit()
