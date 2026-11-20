"""Serveur réel sans clé d'IA : connexions, quotas, accès entre officines, sauvegarde, téléchargements.
Prérequis : npm run build (le serveur sert dist/)."""
import base64, json
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
    tolerant = lambda code, pw: call("POST", "/api/pharmacy/auth/login", {"code": code, "profile": "pharmacien", "password": pw})[1]
    check("connexion tolérante : code en minuscules avec espaces, mot de passe généré tapé en minuscules",
          tolerant(" " + cred_b["code"].lower()[:3] + " " + cred_b["code"].lower()[3:], cred_b["password"].lower() + " ") == 200)
    check("connexion avec l'identifiant interne de la pharmacie (ph-…)", tolerant(pb, cred_b["password"]) == 200)
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
    check("réinitialisation sans mot de passe superviseur refusée", call("POST", f"/api/pharmacies/{pb}/reset-password", {}, owner)[1] == 403)
    check("réinitialisation avec un mauvais mot de passe superviseur refusée", call("POST", f"/api/pharmacies/{pb}/reset-password", {"password": "faux"}, owner)[1] == 403)
    body, status, _ = call("POST", f"/api/pharmacies/{pb}/reset-password", {"password": "ownerpw"}, owner)
    check("réinitialisation par le superviseur", status == 200 and login(cred_b, "pharmacien", body["password"])[1] == 200 and login(cred_b, "pharmacien", cred_b["password"])[1] == 401)
    check("réinitialisation : l'ancienne session du Pharmacien est coupée", call("GET", "/api/pharmacy/auth/me", token=user_b)[1] == 401)
    user_b = login(cred_b, "pharmacien", body["password"])[0]["token"]

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
    now = "2026-11-20T10:00:00.000Z"
    avoir = {"id": "dr-avoir-test", "pharmacyId": pa, "status": "pending", "extractionStatus": "ready", "documentCategory": "bon_livraison",
             "extractedData": {"documentType": "bon_livraison", "documentNumber": "AV-1", "supplierOrOrg": "X", "recipientPharmacy": "", "documentDate": "", "currency": "FCFA", "totalAmountFCFA": -300,
                               "lineItems": [{"designation": "Smecta", "quantity": -3, "unitPriceFCFA": 100, "confidence": 1, "match": {"status": "confirmed", "method": "manual", "score": 1, "erpLabel": "Smecta", "candidates": []}}]},
             "columnMapping": [], "createdAt": now, "updatedAt": now, "actorId": "x", "actorName": "x", "tokensConsumed": 0}
    backup["drafts"] = [avoir] + backup["drafts"]
    call("POST", "/api/owner/restore", {"data": backup}, owner)
    body, status, _ = call("POST", "/api/drafts/dr-avoir-test/approve", {}, owner)
    check("un avoir (quantités négatives) n'est jamais envoyé à l'agent", status == 400 and "Avoir" in body.get("error", ""), body)

    # Bon reçu en fichier (CSV du grossiste) : lu sans IA, rapproché du catalogue, prix vérifiés
    check("officine supprimée : catalogue refusé", call("POST", f"/api/pharmacies/{pb}/catalog/import", {"fileBase64": "AA=="}, owner)[1] == 404)
    pb, cred_c = mk("ZZ C")
    user_c = login(cred_c, "pharmacien", cred_c["password"])[0]["token"]
    team_pw_c = call("POST", "/api/pharmacy/team-account", {}, user_c)[0]["password"]
    team_b = login(cred_c, "equipe", team_pw_c)[0]["token"]
    b64 = lambda txt: base64.b64encode(txt.encode("utf-8")).decode()
    catalog_csv = "Désignation;Code CIP;Prix achat;Stock\nDOLIPRANE 1000MG CP B/8;3400930000001;1.000;10\nAMOXICILLINE 500MG GELULE B/12;;2.100;0\n"
    body, status, _ = call("POST", f"/api/pharmacies/{pb}/catalog/import", {"fileBase64": "data:text/csv;base64," + b64(catalog_csv)}, owner)
    check("catalogue importé par le superviseur (prix « 1.000 » = 1000)", status == 200 and body.get("total") == 2, body)
    bl_csv = "Fournisseur : LABOREX;;;\nN° BL;BL-77;;\nDésignation;Qté livrée;P.U.;Montant\nDOLIPRANE 1000MG CP B/8;20;1.250;25.000\nAMOXICILLINE 500MG GELULE B/12;10;2.100;21.000\n"
    body, status, _ = call("POST", "/api/agent/extract", {"pharmacyId": pb, "imageBase64": "data:text/csv;base64," + b64(bl_csv), "fileName": "BL-77.csv"}, owner)
    check("bon CSV accepté", status == 200, body)
    for _ in range(40):
        d = call("GET", f"/api/drafts/{body['draft']['id']}", token=owner)[0]["draft"]
        if d["extractionStatus"] != "processing":
            break
        time.sleep(0.3)
    L = d["extractedData"]["lineItems"]
    check("bon CSV lu sans IA : lignes, quantités, prix exacts", d["extractionStatus"] == "ready" and [(l["quantity"], l["unitPriceFCFA"]) for l in L] == [(20, 1250), (10, 2100)]
          and d["extractedData"]["documentNumber"] == "BL-77" and d["tokensConsumed"] == 0, d.get("extractionError") or L)
    check("lignes rapprochées du catalogue avec son prix de référence", all(l["match"]["status"] == "auto" and l["match"].get("reference", {}).get("purchase") for l in L), [l.get("match") for l in L])

    # Produit absent du catalogue : « Garder les libellés du bon » débloque l'approbation en un clic
    unk = "Désignation;Qté;P.U.\nPRODUIT INCONNU 5MG CP B/30;3;500\n"
    did2 = call("POST", "/api/agent/extract", {"pharmacyId": pb, "imageBase64": "data:text/csv;base64," + b64(unk), "fileName": "BL-78.csv"}, owner)[0]["draft"]["id"]
    for _ in range(40):
        d2 = call("GET", f"/api/drafts/{did2}", token=owner)[0]["draft"]
        if d2["extractionStatus"] != "processing":
            break
        time.sleep(0.3)
    check("ligne inconnue : approbation bloquée tant qu'elle n'est pas rattachée", call("POST", f"/api/drafts/{did2}/approve", {}, owner)[1] == 400)
    body, status, _ = call("POST", f"/api/drafts/{did2}/accept-labels", {}, team_b)
    check("libellés du bon gardés en un clic", status == 200 and body["draft"]["extractedData"]["lineItems"][0]["match"]["erpLabel"] == "PRODUIT INCONNU 5MG CP B/30", body)
    check("puis approbation possible", call("POST", f"/api/drafts/{did2}/approve", {}, team_b)[1] == 200)

    # Journal des ventes → proposition de commande → panier
    sales_csv = "Date;Désignation;Qté vendue\n01/11/2026;DOLIPRANE 1000MG CP B/8;12\n10/11/2026;DOLIPRANE 1000MG CP B/8;8\n10/11/2026;AMOXICILLINE 500MG GELULE B/12;5\n"
    check("journal des ventes : réservé au Pharmacien", call("POST", f"/api/pharmacies/{pb}/sales/import", {"fileBase64": b64(sales_csv)}, team_b)[1] == 403)
    body, status, _ = call("POST", f"/api/pharmacies/{pb}/sales/import", {"fileBase64": b64(sales_csv), "fileName": "ventes.csv"}, owner)
    check("journal des ventes importé, durée lue sur les dates", status == 200 and body["periodDays"] == 10 and body["products"] == 2, body)
    prop = call("GET", f"/api/pharmacies/{pb}/order-proposal?cover=7&lead=1&safety=2", token=team_b)[0]
    got = [(l["label"], l["proposed"], l["outOfStock"]) for l in prop["lines"]]
    check("proposition : rupture en tête, besoin = ventes/j × 10 j − stock", got == [("AMOXICILLINE 500MG GELULE B/12", 5, True), ("DOLIPRANE 1000MG CP B/8", 10, False)], got)
    data, status, headers = call("POST", f"/api/pharmacies/{pb}/order-proposal/export", {"format": "csv", "lines": [{"label": "DOLIPRANE 1000MG CP B/8", "cip": "3400930000001", "quantity": 10}]}, team_b, raw=True)
    check("panier CSV téléchargé", status == 200 and "attachment" in headers.get("Content-Disposition", "") and b"3400930000001;DOLIPRANE 1000MG CP B/8;10" in data, data[:120])
    check("proposition d'une autre officine refusée", call("GET", f"/api/pharmacies/{pa}/order-proposal", token=team_b)[1] == 403)

    # Remplissage universel : erreurs lisibles sans IA ni tableau
    body, status, _ = call("POST", "/api/tools/fill-any", {"pharmacyId": pb, "documentBase64": "data:text/csv;base64," + b64("a;b\n1;2"), "templateBase64": "data:text/csv;base64," + b64("x\n")}, owner)
    check("tableau sans intitulés : message clair", status == 400 and "Aucun tableau" in body.get("error", ""), body)
    check("remplissage universel refusé sans compte", call("POST", "/api/tools/fill-any", {"pharmacyId": pb})[1] == 401)

    # Connexion unique : identifiant (code ou superviseur, sans casse) + mot de passe ; le mot de passe désigne le compte
    uni = lambda ident, pw: call("POST", "/api/auth/login", {"identifiant": ident, "password": pw})
    check("connexion unique : superviseur (identifiant sans casse)", uni("DR.OUMAR", "ownerpw")[0].get("kind") == "owner")
    body, status, _ = uni(cred_c["code"].lower(), cred_c["password"])
    check("connexion unique : pharmacie, mot de passe Pharmacien → compte Pharmacien", status == 200 and body["user"]["profile"] == "pharmacien", body)
    body, status, _ = uni(cred_c["code"], team_pw_c)
    check("connexion unique : mot de passe Équipe → compte Équipe", status == 200 and body["user"]["profile"] == "equipe", body)
    check("connexion unique : mauvais mot de passe refusé", uni(cred_c["code"], "faux-faux")[1] == 401)
    body, status, _ = call("POST", "/api/pharmacy/auth/change-password", {"current": cred_c["password"], "next": team_pw_c}, user_c)
    check("Pharmacien et Équipe ne peuvent pas avoir le même mot de passe", status == 400 and "différent" in body.get("error", ""), body)

    # Fiche de l'officine : modifier, mot de passe Équipe, déconnecter l'ordinateur, supprimer (avec confirmation)
    body, status, _ = call("PATCH", f"/api/pharmacies/{pb}", {"name": "ZZ C Modifiée", "city": "Thiès"}, owner)
    check("informations de l'officine modifiées", status == 200 and body["pharmacy"]["name"] == "ZZ C Modifiée" and body["pharmacy"]["city"] == "Thiès", body)
    check("modification refusée à une pharmacie", call("PATCH", f"/api/pharmacies/{pb}", {"name": "pirate"}, user_c)[1] == 401)
    body, status, _ = call("POST", f"/api/pharmacies/{pb}/reset-password", {"password": "ownerpw", "account": "equipe"}, owner)
    check("nouveau mot de passe Équipe par le superviseur", status == 200 and body["account"] == "equipe" and uni(cred_c["code"], body["password"])[0]["user"]["profile"] == "equipe", body)
    check("déconnecter l'ordinateur : mot de passe exigé", call("POST", f"/api/pharmacies/{pb}/agent/revoke", {}, owner)[1] == 403)
    check("déconnecter l'ordinateur", call("POST", f"/api/pharmacies/{pb}/agent/revoke", {"password": "ownerpw"}, owner)[1] == 200)
    check("abonnement : quota invalide refusé", call("PATCH", f"/api/pharmacies/{pb}/subscription", {"plan": "standard", "quota": -5}, owner)[1] == 400)
    gone, _ = mk("ZZ À Supprimer")
    check("suppression : nom mal retapé refusé", call("POST", f"/api/pharmacies/{gone}/delete", {"password": "ownerpw", "confirmName": "autre"}, owner)[1] == 400)
    check("suppression : mot de passe exigé", call("POST", f"/api/pharmacies/{gone}/delete", {"confirmName": "zz à supprimer"}, owner)[1] == 403)
    check("suppression avec nom et mot de passe", call("POST", f"/api/pharmacies/{gone}/delete", {"password": "ownerpw", "confirmName": "zz à supprimer"}, owner)[1] == 200
          and gone not in [p["id"] for p in call("GET", "/api/dashboard", token=owner)[0]["pharmacies"]])

    # Sécurité : sessions, jeton dans l'adresse, ancienne route, en-têtes du navigateur
    tok1 = login(cred_c, "pharmacien", cred_c["password"])[0]["token"]
    check("jeton refusé dans l'adresse (?token=)", call("GET", f"/api/pharmacy/auth/me?token={tok1}")[1] == 401)
    check("changement de mot de passe accepté", call("POST", "/api/pharmacy/auth/change-password", {"current": cred_c["password"], "next": "Nouveau-mdp-1"}, tok1)[1] == 200)
    check("anciennes sessions coupées après changement de mot de passe", call("GET", "/api/pharmacy/auth/me", token=tok1)[1] == 401 and call("GET", "/api/pharmacy/auth/me", token=user_c)[1] == 401)
    check("nouvelle connexion avec le nouveau mot de passe", call("GET", "/api/pharmacy/auth/me", token=login(cred_c, "pharmacien", "Nouveau-mdp-1")[0]["token"])[1] == 200)
    check("ancienne route de connexion supprimée", call("POST", f"/api/pharmacies/{pb}/auth/login", {"loginId": "titulaire", "password": "x"})[1] == 404)
    _, _, h = call("GET", "/", raw=True)
    check("en-têtes de sécurité (CSP, HSTS, anti-iframe)", "script-src 'self'" in (h.get("Content-Security-Policy") or "") and h.get("Strict-Transport-Security") and h.get("X-Frame-Options") == "DENY", dict(h))

    data, status, headers = call("GET", "/install/mac.zip", raw=True)
    check("installeur Mac : application avec exécutable", status == 200 and data[:2] == b"PK" and b"Installer PharmAgent.app/Contents/MacOS/PharmAgent" in data and b"Info.plist" in data and b"display dialog" in data)
    version = call("GET", "/agent/version")[0]["version"]
    agent_src = pathlib.Path(ROOT, "agent", "pharmagent_agent.py").read_text(encoding="utf-8")
    check("version de l'agent servie", f'AGENT_VERSION = "{version}"' in agent_src, version)
finally:
    srv.terminate()
check.exit()
