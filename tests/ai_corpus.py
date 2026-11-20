"""Banc d'essai de lecture par l'IA : 11 documents (Sénégal, Côte d'Ivoire, Maroc, France, États-Unis, mutuelle, avoir, photos),
2 pharmacies aux catalogues différents. Compare chaque champ à la vérité et vérifie que les pièges sont signalés.
Nécessite ANTHROPIC_API_KEY (environ 0,01 $ par passage) ; ignoré sinon. Prérequis : npm run build."""
import base64, json, os, pathlib, subprocess, sys, tempfile, time, urllib.error, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _agent import ROOT, Checker  # noqa: E402

if not os.environ.get("ANTHROPIC_API_KEY"):
    print("(ignoré : ANTHROPIC_API_KEY absente)")
    raise SystemExit(0)

W = tempfile.mkdtemp()
subprocess.run([sys.executable, str(pathlib.Path(__file__).parent / "corpus" / "make_corpus.py"), W], check=True, stdout=subprocess.DEVNULL)
T = json.load(open(f"{W}/truth.json"))["truth"]
PORT = int(os.environ.get("CORPUS_PORT", "4096")); B = f"http://127.0.0.1:{PORT}"; check = Checker()
env = {**os.environ, "DATA_DIR": tempfile.mkdtemp(), "PORT": str(PORT), "NODE_ENV": "production", "PHARMAGENT_OWNER_PASSWORD": "ownerpw"}
env.pop("DATABASE_URL", None)
srv = subprocess.Popen(["npx", "tsx", "server.ts"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


def call(m, p, b=None, t=None):
    h = {"Content-Type": "application/json", **({"Authorization": "Bearer " + t} if t else {})}
    try:
        with urllib.request.urlopen(urllib.request.Request(B + p, data=json.dumps(b).encode() if b is not None else None, headers=h, method=m), timeout=180) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}"), e.code


num = lambda v: None if v in (None, "") else float(v)
same = lambda a, b, tol=0.011: (num(a) or 0) == (num(b) or 0) if num(a) is None or num(b) is None else abs(num(a) - num(b)) <= tol
squash = lambda s: (s or "").replace(" ", "").upper()
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(B + "/api/health", timeout=2)
            break
        except Exception:
            time.sleep(1)
    owner = call("POST", "/api/owner/auth/login", {"loginId": "dr.oumar", "password": "ownerpw"})[0]["token"]
    ph = {}
    for k, name, cat in (("A", "Pharmacie A (Dakar)", "catalogue_A_dakar.xlsx"), ("B", "Pharmacie B (Abidjan)", "catalogue_B_abidjan.xlsx")):
        r = call("POST", "/api/pharmacies", {"name": name, "city": "Ville", "pharmacist": "Dr Test", "targetSoftware": "ERP Officine Intégré"}, owner)[0]
        tok = call("POST", "/api/pharmacy/auth/login", {"code": r["credentials"]["code"], "profile": "pharmacien", "password": r["credentials"]["password"]})[0]["token"]
        imp = call("POST", f"/api/pharmacies/{r['pharmacy']['id']}/catalog/import", {"fileBase64": base64.b64encode(open(f"{W}/{cat}", "rb").read()).decode()}, tok)[0]
        check(f"catalogue {k} importé ({imp.get('total')} produits)", imp.get("total") == 10, imp)
        ph[k] = {"id": r["pharmacy"]["id"], "tok": tok}
    runs = [("SN1_bl_laborex_like", "A"), ("SN1_photo_telephone", "A"), ("SN6_photo_tache", "A"), ("CI2_facture_remise_tva", "B"), ("MA3_facture_dirham", "B"),
            ("FR4_bl_repartiteur_2pages", "A"), ("US5_invoice_ndc", "B"), ("SN7_pieges_total_peremption", "B"), ("MUT8_releve_tiers_payant", "A"),
            ("AV9_avoir_retour", "B"), ("SN1_bl_laborex_like", "B")]
    drafts = {}
    for name, who in runs:
        t = T[name]
        f = f"{W}/docs/{name}." + ("jpg" if t.get("image") else "pdf")
        mime = "image/jpeg" if f.endswith(".jpg") else "application/pdf"
        hint = "mutuelle" if t.get("kind") == "mutuelle" else ("facture" if ("facture" in name or "invoice" in name) else "bon_livraison")
        d = call("POST", "/api/agent/extract", {"pharmacyId": ph[who]["id"], "imageBase64": f"data:{mime};base64," + base64.b64encode(open(f, "rb").read()).decode(), "documentHint": hint}, ph[who]["tok"])[0]
        did = d["draft"]["id"]
        while True:
            time.sleep(2)
            g = call("GET", f"/api/drafts/{did}", t=ph[who]["tok"])[0]["draft"]
            if g["extractionStatus"] != "processing":
                break
        drafts[f"{name}@{who}"] = g
    json.dump(drafts, open(f"{W}/drafts.json", "w"), ensure_ascii=False)
    checks = json.loads(subprocess.run(["npx", "tsx", str(pathlib.Path(__file__).parent / "corpus" / "checks_cli.mts"), f"{W}/drafts.json"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)

    for key, g in drafts.items():
        name = key.split("@")[0]; t = T[name]; e = g["extractedData"]; L = e["lineItems"]; errs = []
        if g["extractionStatus"] != "ready":
            check(f"{key} lu", False, g.get("extractionError"))
            continue
        if len(L) != len(t["lines"]):
            errs.append(f"lignes {len(L)}≠{len(t['lines'])}")
        blot = t.get("blot_line")
        for i, (x, y) in enumerate(zip(L, t["lines"])):
            if i == blot:
                # Chiffre caché : acceptable si l'IA le déduit en le marquant incertain, ou s'abstient (quantité vide/0 signalée).
                # Inacceptable : un chiffre faux, ou présenté comme sûr.
                q, conf = num(x.get("quantity")), x.get("confidence") or 1
                # Accepté aussi : un chiffre faux mais marqué incertain ET contredit par le montant imprimé (le contrôle le bloque)
                amt = x.get("lineTotal"); pu = num(x.get("unitPriceFCFA")) or 0
                caught = conf < 0.8 and amt is not None and q is not None and abs(q * pu - amt) > 1
                if not ((q == num(y["qty"]) and conf < 0.8) or q in (None, 0) or caught):
                    errs.append(f"L{i+1} chiffre caché mal traité : qté {q}, confiance {conf}")
                continue
            if num(x.get("quantity")) != num(y["qty"]): errs.append(f"L{i+1} qté {x.get('quantity')}≠{y['qty']}")
            if (x.get("freeUnits") or 0) != (y.get("ug") or 0): errs.append(f"L{i+1} UG {x.get('freeUnits')}≠{y.get('ug')}")
            if y.get("lot") and squash(x.get("lotNumber")) != squash(y["lot"]): errs.append(f"L{i+1} lot {x.get('lotNumber')}≠{y['lot']}")
            if y.get("exp") and squash(x.get("expiryDate")) != squash(y["exp"]): errs.append(f"L{i+1} exp {x.get('expiryDate')}≠{y['exp']}")
            if not same(x.get("unitPriceFCFA"), y["pu"]): errs.append(f"L{i+1} PU {x.get('unitPriceFCFA')}≠{y['pu']}")
            if y.get("vat") is not None and not same(x.get("vatRate"), y["vat"]): errs.append(f"L{i+1} TVA {x.get('vatRate')}≠{y['vat']}")
        if not same(e.get("totalAmountFCFA"), t["total"], 0.02): errs.append(f"total {e.get('totalAmountFCFA')}≠{t['total']}")
        check(f"{key} : lecture exacte", not errs, errs)
        texts = " | ".join(c["text"] for c in checks[key]).lower()
        expect = list(t.get("expect", []))
        if key in ("SN1_photo_telephone@A", "SN6_photo_tache@A"):
            expect.append("déjà importé")
        allowed = list(expect)
        if t.get("blot_line") is not None:
            # au moins une alerte sur la ligne cachée : « incertaine » ou « quantité manquante »
            expect = [w for w in expect if w != "incertaine"] + (["incertaine"] if "incertaine" in texts else ["quantité"])
            allowed = expect + ["incertaine", "quantité", "ne donne pas le montant"]
        missing = [w for w in expect if w.lower() not in texts]
        extra = [c["text"][:80] for c in checks[key] if c["level"] == "error" and not any(w.lower() in c["text"].lower() for w in allowed)]
        check(f"{key} : alertes attendues, aucune fausse alerte", not missing and not extra, {"manquantes": missing, "en trop": extra})
finally:
    srv.terminate()
check.exit()
