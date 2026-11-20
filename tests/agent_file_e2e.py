"""Bout en bout, avec le VRAI agent (processus séparé) et un vrai serveur : appairage, réglage « Fichier Excel »
(sans démo), bon approuvé, l'agent le prend, écrit une copie remplie du modèle et renvoie le résultat."""
import base64, io, json, os, pathlib, subprocess, sys, tempfile, time, urllib.error, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _agent import ROOT, Checker  # noqa: E402

import openpyxl  # noqa: E402

check = Checker()
PORT = 4131; B = f"http://127.0.0.1:{PORT}"; PANEL = "http://127.0.0.1:8765"
work = pathlib.Path(tempfile.mkdtemp())
env = {**os.environ, "DATA_DIR": str(work / "data"), "PORT": str(PORT), "NODE_ENV": "production", "PHARMAGENT_OWNER_PASSWORD": "ownerpw"}
env.pop("DATABASE_URL", None); env.pop("ANTHROPIC_API_KEY", None)
srv = subprocess.Popen(["npx", "tsx", "server.ts"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
agent = None


def call(m, url, b=None, t=None, h=None):
    hdr = {"Content-Type": "application/json", **({"Authorization": "Bearer " + t} if t else {}), **(h or {})}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(b).encode() if b is not None else None, headers=hdr, method=m), timeout=60) as r:
            return json.loads(r.read() or b"{}"), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}"), e.code


def wait(pred, timeout=60, step=0.5):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = pred()
        except (urllib.error.URLError, ConnectionError, OSError):
            v = None   # serveur ou panneau pas encore démarré
        if v:
            return v
        time.sleep(step)
    return None


panel = lambda m, path, b=None: call(m, PANEL + path, b, h={"X-PharmAgent": "1"})
try:
    wait(lambda: call("GET", B + "/api/health")[1] == 200, 60)
    owner = call("POST", B + "/api/auth/login", {"identifiant": "dr.oumar", "password": "ownerpw"})[0]["token"]
    pid = call("POST", B + "/api/pharmacies", {"name": "E2E", "city": "Dakar", "pharmacist": "Dr T", "targetSoftware": "Excel / Tableur"}, owner)[0]["pharmacy"]["id"]

    # Modèle de réception (comme celui envoyé au pharmacien) : en-tête, 15 lignes numérotées, formules
    tpl = work / "Reception.xlsx"
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Réception"
    ws["A1"] = "RÉCEPTION DE BONS DE LIVRAISON"; ws["A3"] = "Fournisseur :"; ws["D3"] = "N° BL :"
    ws.append([]); ws.append([])
    for i, h in enumerate(["N°", "Code CIP", "Désignation", "N° Lot", "Péremption", "Quantité", "UG", "Prix achat HT", "Prix vente", "Total HT"], 1):
        ws.cell(row=6, column=i, value=h)
    for k in range(1, 16):
        ws.cell(row=6 + k, column=1, value=k); ws.cell(row=6 + k, column=10, value=f"=F{6 + k}*H{6 + k}")
    wb.save(tpl)

    # Bon de livraison en fichier (lu sans IA), libellés gardés, approuvé
    csv = ("Fournisseur : LABOREX SENEGAL;;;;\nN° BL;BL-TEST-2611;;;\n;;;;\n"
           "Libellé;Qté livrée;UG;N° lot;Date exp.;P.U. HT;Montant HT\n"
           "DOLIPRANE 1000MG CP B/8;100;10;DL2611A;09/2028;780;78.000\nSMECTA 3G SACHET B/30;20;;SM26D9;03/2028;3200;64.000\n")
    d = call("POST", B + "/api/agent/extract", {"pharmacyId": pid, "imageBase64": "data:text/csv;base64," + base64.b64encode(csv.encode()).decode(), "fileName": "bl.csv"}, owner)[0]["draft"]
    wait(lambda: call("GET", B + f"/api/drafts/{d['id']}", t=owner)[0]["draft"]["extractionStatus"] == "ready", 30)
    call("POST", B + f"/api/drafts/{d['id']}/accept-labels", {}, owner)

    # Le vrai agent, comme sur l'ordinateur de la pharmacie
    aenv = {**os.environ, "PHARMAGENT_HOME": str(work / "agent"), "PHARMAGENT_NO_UPDATE": "1"}
    agent = subprocess.Popen([sys.executable, str(pathlib.Path(ROOT) / "agent" / "pharmagent_agent.py"), "--server", B, "--background"], env=aenv,
                             stdout=open(work / "agent.log", "w"), stderr=subprocess.STDOUT)
    code = wait(lambda: (panel("GET", "/api/state")[0] or {}).get("pairingCode") if agent.poll() is None else None, 60)
    check("agent démarré, code d'appairage affiché", bool(code), (work / "agent.log").read_text()[-500:])
    check("ordinateur relié à l'officine", call("POST", B + f"/api/pharmacies/{pid}/pair", {"code": code}, owner)[1] == 200)
    wait(lambda: panel("GET", "/api/state")[0].get("paired"), 30)
    r, st = panel("POST", "/api/setup", {"mode": "file", "filePath": str(tpl)})
    check("réglage « Fichier Excel » accepté sans démo", st == 200, r)
    state = wait(lambda: (lambda s: s if s.get("status") == "ready" else None)(panel("GET", "/api/state")[0]), 20)
    check("agent prêt (mode fichier)", bool(state) and state["profile"]["mode"] == "file", state and state.get("status"))

    check("bon approuvé", call("POST", B + f"/api/drafts/{d['id']}/approve", {}, owner)[1] == 200)
    ex = wait(lambda: (lambda e: e if e and e.get("status") in ("done", "failed") else None)(call("GET", B + f"/api/drafts/{d['id']}", t=owner)[0]["draft"].get("execution")), 90, 1)
    check("l'agent a pris le bon et l'a terminé", bool(ex) and ex["status"] == "done", ex)
    out = work / "Reception - BL-TEST-2611.xlsx"
    check("copie remplie créée à côté du modèle", out.exists(), sorted(p.name for p in work.iterdir()))
    if out.exists():
        w = openpyxl.load_workbook(out).active
        check("en-tête rempli (fournisseur, N° BL)", w["B3"].value == "LABOREX SENEGAL" and w["E3"].value == "BL-TEST-2611", [w["B3"].value, w["E3"].value])
        check("lignes dans les cases prévues (désignation, quantité, UG, lot, prix)",
              [w["C7"].value, w["F7"].value, w["G7"].value, w["D7"].value, w["H7"].value] == ["DOLIPRANE 1000MG CP B/8", 100, 10, "DL2611A", 780]
              and w["C8"].value == "SMECTA 3G SACHET B/30", [c.value for c in w[7]])
        check("numéros et formules du modèle gardés", w["A7"].value == 1 and str(w["J7"].value).startswith("="), [w["A7"].value, w["J7"].value])
    check("modèle d'origine jamais modifié", openpyxl.load_workbook(tpl).active["C7"].value is None)
    pres = call("GET", B + f"/api/pharmacies/{pid}/agent", t=owner)[0]["presence"]
    check("diagnostic de l'agent visible sur le site (version, mode, fichier, dernier bon)",
          pres and pres.get("mode") == "file" and pres.get("target") == "Reception.xlsx" and "BL-TEST-2611" in (pres.get("lastResult") or ""), pres)
finally:
    if agent:
        agent.terminate()
    srv.terminate()
check.exit()
