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
    def mk(name):
        body, status, _ = call("POST", "/api/pharmacies", {"name": name, "city": "Dakar", "pharmacist": "Dr T", "targetSoftware": "Excel / Tableur"}, owner)
        return body["pharmacy"]["id"], body["credentials"]
    (pa, cred_a), (pb, cred_b) = mk("ZZ A"), mk("ZZ B")
    check("création : code et mot de passe Pharmacien fournis", len(cred_b["code"]) == 6 and len(cred_b["password"]) >= 8)
    login = lambda cred, profile, pw: call("POST", "/api/pharmacy/auth/login", {"code": cred["code"], "profile": profile, "password": pw})
    check("mauvais mot de passe pharmacie refusé", login(cred_b, "pharmacien", "faux")[1] == 401)
    check("le mot de passe d'une autre pharmacie ne marche pas", login(cred_b, "pharmacien", cred_a["password"])[1] == 401)
    body, status, _ = login(cred_b, "pharmacien", cred_b["password"])
    check("connexion Pharmacien", status == 200 and body["user"]["profile"] == "pharmacien" and body["teamAccount"] is False, body)
    user_b = body["token"]
    snap = call("GET", "/api/pharmacy/dashboard", token=user_b)[0]
    check("tableau de bord limité à sa pharmacie, sans clé d'agent", [p["id"] for p in snap["pharmacies"]] == [pb] and "agentKey" not in snap["pharmacies"][0])
    check("tableau de bord superviseur refusé à une pharmacie", call("GET", "/api/dashboard", token=user_b)[1] == 401)
    body, status, _ = call("POST", "/api/pharmacy/team-account", {}, user_b)
    check("compte Équipe créé par le Pharmacien", status == 200 and body.get("password"))
    team_pw = body["password"]
    body, status, _ = login(cred_b, "equipe", team_pw)
    check("connexion Équipe", status == 200 and body["user"]["profile"] == "equipe")
    team_b = body["token"]
    check("l'Équipe ne gère pas les comptes", call("POST", "/api/pharmacy/team-account", {}, team_b)[1] == 403)
    check("l'Équipe ne branche pas l'agent", call("POST", f"/api/pharmacies/{pb}/pair", {"code": "123456"}, team_b)[1] == 403)
    check("changement de mot de passe : ancien requis", call("POST", "/api/pharmacy/auth/change-password", {"current": "x", "next": "nouveau1"}, team_b)[1] == 401)
    check("changement de mot de passe", call("POST", "/api/pharmacy/auth/change-password", {"current": team_pw, "next": "nouveau1"}, team_b)[1] == 200 and login(cred_b, "equipe", "nouveau1")[1] == 200)
    body, status, _ = call("POST", f"/api/pharmacies/{pb}/reset-password", {}, owner)
    check("réinitialisation par le superviseur", status == 200 and login(cred_b, "pharmacien", body["password"])[1] == 200 and login(cred_b, "pharmacien", cred_b["password"])[1] == 401)

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
