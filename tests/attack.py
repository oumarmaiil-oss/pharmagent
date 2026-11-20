"""Second passage d'attaque : chaque route est essayée sans compte, avec un faux jeton, avec le compte d'une AUTRE pharmacie,
avec le compte Équipe sur les actions réservées, et l'agent avec une fausse clé. Aucune ne doit réussir."""
import base64, json, os, pathlib, subprocess, sys, tempfile, time, urllib.error, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _agent import ROOT, Checker  # noqa: E402

PORT = 4123; B = f"http://127.0.0.1:{PORT}"; check = Checker()
env = {**os.environ, "DATA_DIR": tempfile.mkdtemp(), "PORT": str(PORT), "NODE_ENV": "production", "PHARMAGENT_OWNER_PASSWORD": "ownerpw"}
env.pop("DATABASE_URL", None); env.pop("ANTHROPIC_API_KEY", None)
srv = subprocess.Popen(["npx", "tsx", "server.ts"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


def call(m, p, b=None, t=None, h=None):
    hdr = {"Content-Type": "application/json", **({"Authorization": "Bearer " + t} if t else {}), **(h or {})}
    try:
        with urllib.request.urlopen(urllib.request.Request(B + p, data=json.dumps(b).encode() if b is not None else None, headers=hdr, method=m), timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


try:
    for _ in range(60):
        try:
            if call("GET", "/api/health")[0] == 200:
                break
        except Exception:
            time.sleep(1)
    owner = json.loads(call("POST", "/api/owner/auth/login", {"loginId": "dr.oumar", "password": "ownerpw"})[1])["token"]

    def pharmacy(name):
        r = json.loads(call("POST", "/api/pharmacies", {"name": name, "city": "Dakar", "pharmacist": "T", "targetSoftware": "Excel / Tableur"}, owner)[1])
        tok = json.loads(call("POST", "/api/pharmacy/auth/login", {"code": r["credentials"]["code"], "profile": "pharmacien", "password": r["credentials"]["password"]})[1])["token"]
        team_pw = json.loads(call("POST", "/api/pharmacy/team-account", {}, tok)[1])["password"]
        team = json.loads(call("POST", "/api/pharmacy/auth/login", {"code": r["credentials"]["code"], "profile": "equipe", "password": team_pw})[1])["token"]
        return r["pharmacy"]["id"], tok, team

    (A, tokA, teamA), (Bid, tokB, teamB) = pharmacy("Cible A"), pharmacy("Attaquant B")
    csv = "data:text/csv;base64," + base64.b64encode("Désignation;Qté;P.U.\nDOLIPRANE;2;100\n".encode()).decode()
    did = json.loads(call("POST", "/api/agent/extract", {"pharmacyId": A, "imageBase64": csv, "fileName": "bl.csv"}, tokA)[1])["draft"]["id"]

    # Toutes les routes de la pharmacie A, attaquées par B (Pharmacien et Équipe), sans compte, et avec un jeton falsifié
    routes = [
        ("GET", f"/api/pharmacies/{A}/users"), ("GET", f"/api/pharmacies/{A}/agent"), ("GET", f"/api/pharmacies/{A}/catalog"),
        ("POST", f"/api/pharmacies/{A}/catalog/import"), ("POST", f"/api/pharmacies/{A}/sales/import"), ("GET", f"/api/pharmacies/{A}/order-proposal"),
        ("POST", f"/api/pharmacies/{A}/order-proposal/export"), ("GET", f"/api/pharmacies/{A}/drafts"), ("GET", f"/api/pharmacies/{A}/audit"),
        ("POST", f"/api/pharmacies/{A}/pair"), ("GET", f"/api/drafts/{did}"), ("POST", f"/api/drafts/{did}/approve"),
        ("POST", f"/api/drafts/{did}/reject"), ("POST", f"/api/drafts/{did}/requeue"), ("POST", f"/api/drafts/{did}/lines/0/match"),
        ("PATCH", f"/api/drafts/{did}/lines/0"), ("POST", f"/api/drafts/{did}/rematch"), ("POST", f"/api/drafts/{did}/fill-excel"),
        ("GET", f"/api/drafts/{did}/download"), ("POST", f"/api/drafts/{did}/accept-labels"),
    ]
    body = {"fileBase64": "AA==", "productId": "x", "erpLabel": "PIRATE", "quantity": 999, "lines": [{"label": "x", "quantity": 1}], "code": "000000"}
    forged = tokB[:-4] + ("AAAA" if not tokB.endswith("AAAA") else "BBBB")
    for who, tok in (("autre pharmacie (Pharmacien)", tokB), ("autre pharmacie (Équipe)", teamB), ("sans compte", None), ("jeton falsifié", forged)):
        ok = [(m, p, st) for m, p in routes for st in [call(m, p, body, tok)[0]] if st not in (401, 403, 404)]
        check(f"{who} : aucune route de la pharmacie A accessible ({len(routes)} essayées)", not ok, ok)
    st = call("POST", "/api/tools/fill-any", {"pharmacyId": A, "documentBase64": csv, "templateBase64": csv}, tokB)[0]
    check("remplissage universel au nom d'une autre pharmacie refusé", st == 403, st)
    draft = json.loads(call("GET", f"/api/drafts/{did}", t=tokA)[1])["draft"]
    check("le brouillon n'a pas été modifié par l'attaquant", draft["status"] == "pending" and draft["extractedData"]["lineItems"][0]["quantity"] == 2, draft["status"])

    # Supervision : réservée au propriétaire
    owner_routes = [("GET", "/api/dashboard"), ("GET", "/api/owner/backup"), ("POST", "/api/owner/restore"), ("POST", "/api/pharmacies"),
                    ("POST", f"/api/pharmacies/{A}/reset-password"), ("PATCH", f"/api/pharmacies/{A}/subscription"), ("GET", "/api/audit"),
                    ("DELETE", f"/api/pharmacies/{A}/catalog"), ("GET", "/api/training/download/memory"), ("POST", "/api/training/rules"),
                    ("POST", "/api/agent/ground-interface"), ("POST", "/api/owner/auth/change-credentials")]
    ok = [(m, p, st) for m, p in owner_routes for st in [call(m, p, {"data": {}}, tokA)[0]] if st not in (401, 403)]
    check("un Pharmacien n'accède à aucune route du superviseur", not ok, ok)

    # Réservé au Pharmacien : l'Équipe ne peut pas
    for m, p in (("POST", f"/api/pharmacies/{A}/catalog/import"), ("POST", f"/api/pharmacies/{A}/sales/import"), ("POST", f"/api/pharmacies/{A}/pair"), ("POST", "/api/pharmacy/team-account")):
        check(f"Équipe refusée : {p}", call(m, p, {"fileBase64": "AA==", "code": "1"}, teamA)[0] == 403)

    # Agent : sans clé ou avec une fausse clé, rien
    agent = [("POST", "/api/agent-client/heartbeat"), ("GET", "/api/agent-client/profile"), ("PUT", "/api/agent-client/profile"), ("GET", "/api/agent-client/sample"),
             ("POST", "/api/agent-client/claim"), ("POST", f"/api/agent-client/tasks/{did}/result"), ("POST", "/api/agent-client/catalog")]
    for label, h in (("sans clé", None), ("fausse clé", {"X-Agent-Key": "ak-faux"})):
        ok = [(m, p, st) for m, p in agent for st in [call(m, p, {}, None, h)[0]] if st != 401]
        check(f"agent {label} : refusé partout", not ok, ok)
    check("appairage : statut refusé sans le secret", call("GET", "/api/agent-client/pair/status?pairingId=x&secret=y")[0] == 404)

    # Fichiers et entrées piégés
    check("chemin d'exemple hors du dossier autorisé refusé", call("POST", "/api/agent/extract", {"pharmacyId": A, "sampleAssetPath": "/../../server.ts"}, tokA)[0] == 400)
    check("format de fichier inconnu refusé", call("POST", "/api/agent/extract", {"pharmacyId": A, "imageBase64": "data:application/x-msdownload;base64,TVo="}, tokA)[0] == 400)
    check("extraction pour une autre pharmacie refusée", call("POST", "/api/agent/extract", {"pharmacyId": A, "imageBase64": csv, "fileName": "x.csv"}, tokB)[0] == 403)
    check("jeton dans l'adresse refusé", call("GET", f"/api/pharmacy/auth/me?token={tokA}")[0] == 401)
    st = 0
    for _ in range(6):
        st = call("POST", "/api/pharmacy/auth/login", {"code": "ZZZZZZ", "profile": "pharmacien", "password": "devine"})[0]
    check("force brute : bloquée après 5 essais", st == 429, st)
    big = "data:text/csv;base64," + "A" * (31 * 1024 * 1024)
    check("envoi géant (> 30 Mo) refusé", call("POST", "/api/agent/extract", {"pharmacyId": A, "imageBase64": big}, tokA)[0] == 413)
finally:
    srv.terminate()
check.exit()
