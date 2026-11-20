"""Test A de bout en bout avec le VRAI agent : « BL test A » (20 médicaments, 2 quantités vides) importé,
les 2 quantités vides signalées puis corrigées, bon approuvé, l'agent remplit « ERP test A » (en-tête aux synonymes,
formules de total par ligne, Total HT, TVA, Total TTC). Les totaux sont recalculés par LibreOffice et contrôlés."""
import base64, json, os, pathlib, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _agent import ROOT, Checker  # noqa: E402

import openpyxl  # noqa: E402

check = Checker()
PORT = 4132; B = f"http://127.0.0.1:{PORT}"; PANEL = "http://127.0.0.1:8765"
work = pathlib.Path(tempfile.mkdtemp())
subprocess.run([sys.executable, str(pathlib.Path(ROOT) / "tests" / "corpus" / "make_test_a.py"), str(work)], check=True, stdout=subprocess.DEVNULL)
sys.path.insert(0, str(pathlib.Path(ROOT) / "tests" / "corpus"))
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
            v = None
        if v:
            return v
        time.sleep(step)
    return None


panel = lambda m, path, b=None: call(m, PANEL + path, b, h={"X-PharmAgent": "1"})
try:
    wait(lambda: call("GET", B + "/api/health")[1] == 200, 60)
    owner = call("POST", B + "/api/auth/login", {"identifiant": "dr.oumar", "password": "ownerpw"})[0]["token"]
    pid = call("POST", B + "/api/pharmacies", {"name": "Pharmacie Test A", "city": "Dakar", "pharmacist": "Dr T", "targetSoftware": "Excel / Tableur"}, owner)[0]["pharmacy"]["id"]

    # 1. Import du BL (fichier Excel du grossiste)
    raw = base64.b64encode((work / "BL test A.xlsx").read_bytes()).decode()
    d = call("POST", B + "/api/agent/extract", {"pharmacyId": pid, "imageBase64": "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + raw, "fileName": "BL test A.xlsx"}, owner)[0]["draft"]
    d = wait(lambda: (lambda x: x if x["extractionStatus"] != "processing" else None)(call("GET", B + f"/api/drafts/{d['id']}", t=owner)[0]["draft"]), 30)
    e = d["extractedData"]; L = e["lineItems"]
    check("BL lu : 20 lignes, n°, fournisseur, date", len(L) == 20 and e["documentNumber"] == "BL-TEST-A-001" and e["supplierOrOrg"] == "LABOREX SENEGAL" and e["documentDate"] == "20/11/2026",
          [len(L), e["documentNumber"], e["supplierOrOrg"], e["documentDate"]])
    check("« Prix HT » lu comme prix d'achat", L[0]["unitPriceFCFA"] == 780 and L[0]["salePriceFCFA"] == 1200, L[0])
    empty = [i for i, l in enumerate(L) if l["quantity"] == 0]
    check("les 2 quantités vides sont gardées (lignes 7 et 14), pas ignorées", empty == [6, 13], empty)

    # 2. Les contrôles les signalent
    from make_test_a import PRODUITS  # noqa: E402
    msgs = subprocess.run(["npx", "tsx", "-e", f"""
import {{ draftChecks }} from './src/components/draftChecks.ts';
console.log(JSON.stringify(draftChecks({json.dumps(d)}, new Date('2026-11-20'))));"""], cwd=ROOT, capture_output=True, text=True).stdout
    checks = json.loads(msgs)
    bad = [c["text"] for c in checks if c["level"] == "error"]
    check("erreurs « quantité manquante » sur AMLODIPINE et LORATADINE", sum("quantité manquante" in t for t in bad) == 2
          and any("AMLODIPINE" in t for t in bad) and any("LORATADINE" in t for t in bad), bad)

    # 3. Le pharmacien corrige les 2 quantités, garde les libellés, approuve
    for i, q in ((6, 30), (13, 12)):
        check(f"quantité corrigée ligne {i + 1}", call("PATCH", B + f"/api/drafts/{d['id']}/lines/{i}", {"quantity": q}, owner)[1] == 200)
    call("POST", B + f"/api/drafts/{d['id']}/accept-labels", {}, owner)

    # 4. Le vrai agent, en mode fichier sur « ERP test A »
    aenv = {**os.environ, "PHARMAGENT_HOME": str(work / "agent"), "PHARMAGENT_NO_UPDATE": "1"}
    agent = subprocess.Popen([sys.executable, str(pathlib.Path(ROOT) / "agent" / "pharmagent_agent.py"), "--server", B, "--background"], env=aenv,
                             stdout=open(work / "agent.log", "w"), stderr=subprocess.STDOUT)
    code = wait(lambda: (panel("GET", "/api/state")[0] or {}).get("pairingCode") if agent.poll() is None else None, 60)
    call("POST", B + f"/api/pharmacies/{pid}/pair", {"code": code}, owner)
    wait(lambda: panel("GET", "/api/state")[0].get("paired"), 30)
    tpl = work / "ERP test A.xlsx"
    check("agent réglé sur « ERP test A » (sans démo)", panel("POST", "/api/setup", {"mode": "file", "filePath": str(tpl)})[1] == 200)
    check("bon approuvé", call("POST", B + f"/api/drafts/{d['id']}/approve", {}, owner)[1] == 200)
    ex = wait(lambda: (lambda x: x if x and x.get("status") in ("done", "failed") else None)(call("GET", B + f"/api/drafts/{d['id']}", t=owner)[0]["draft"].get("execution")), 90, 1)
    check("l'agent a rempli le fichier", bool(ex) and ex["status"] == "done", ex)
    out = work / "ERP test A - BL-TEST-A-001.xlsx"
    check("copie remplie créée, modèle intact", out.exists() and openpyxl.load_workbook(tpl).active["A7"].value is None, sorted(p.name for p in work.iterdir()))

    # 5. Contenu : en-tête aux synonymes, 20 lignes, formules gardées
    ws = openpyxl.load_workbook(out).active
    check("en-tête : Grossiste, Numéro de bordereau, Date de livraison", [ws["B3"].value, ws["E3"].value, ws["B4"].value] == ["LABOREX SENEGAL", "BL-TEST-A-001", "20/11/2026"],
          [ws["B3"].value, ws["E3"].value, ws["B4"].value])
    rows = [[ws.cell(row=r, column=c).value for c in range(1, 7)] for r in range(7, 27)]
    check("20 produits écrits dans l'ordre", [r[0] for r in rows] == [p[1] for p in PRODUITS], [r[0] for r in rows][:3])
    check("quantité, prix d'achat, péremption au bon endroit", rows[0][2:5] == [100, 780, "09/2028"] and rows[6][2] == 30 and rows[13][2] == 12, rows[0])
    check("formules du modèle gardées (Total par ligne)", all(str(r[5]).startswith("=") for r in rows), rows[0][5])

    # 6. Totaux recalculés comme dans un tableur (LibreOffice)
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice:
        csvdir = work / "csv"; csvdir.mkdir()
        subprocess.run([soffice, "--headless", "--convert-to", "csv", "--outdir", str(csvdir), str(out)], capture_output=True, timeout=120)
        lines = (csvdir / (out.stem + ".csv")).read_text(encoding="utf-8", errors="replace").splitlines()
        qty = {6: 30, 13: 12}
        ht = sum((qty.get(i, p[2]) or 0) * p[3] for i, p in enumerate(PRODUITS))
        val = lambda label: next((float(x.split(",")[-1].strip('"')) for x in lines if label in x), None)
        check(f"Total HT recalculé = {ht:,} FCFA".replace(",", " "), val("Total HT") == ht, val("Total HT"))
        check("Total TTC = HT + 18 % de TVA", abs((val("Total TTC") or 0) - ht * 1.18) < 0.01, val("Total TTC"))
    else:
        print("(recalcul des totaux ignoré : LibreOffice absent)")
finally:
    if agent:
        agent.terminate()
    srv.terminate()
check.exit()
