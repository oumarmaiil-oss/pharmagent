"""Corpus de simulation : 2 pharmacies (catalogues différents, produits communs) et 11 documents variés avec pièges.
Usage : python3 tests/corpus/make_corpus.py DOSSIER  (PDF, photos, catalogues et truth.json)."""
import json, os, subprocess, sys
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = sys.argv[1]; D = f"{OUT}/docs"
os.makedirs(D, exist_ok=True)
ss = getSampleStyleSheet(); N = ParagraphStyle("n", parent=ss["Normal"], fontSize=9, leading=12); H = ParagraphStyle("h", parent=ss["Title"], fontSize=15)
fr = lambda n: f"{n:,.0f}".replace(",", " ") if float(n).is_integer() else f"{n:,.2f}".replace(",", " ").replace(".", ",")
en = lambda n: f"{n:,.2f}"

# Produits : (clé, libellé pharmacie A, libellé pharmacie B, CIP13, prix achat FCFA, prix public FCFA)
P = [
 ("dol1000", "Doliprane 1000mg Comp. B/8", "DOLIPRANE 1000MG CPR BT8", "3400935955838", 780, 1200),
 ("amox500", "Amoxicilline 500mg Gélule B/12", "AMOXICILLINE 500 MG GEL BT12", "3400934998171", 950, 1400),
 ("coartem", "Coartem 20/120mg Comp. B/24", "COARTEM 20/120 CP BT24", "3400935683854", 2600, 3800),
 ("metf850", "Metformine 850mg Comp. B/30", "METFORMINE 850 MG CPR BT30", "3400936386471", 2400, 3300),
 ("omep20", "Oméprazole 20mg Gélule B/14", "OMEPRAZOLE 20MG GELULE BT14", "3400937411509", 3100, 4200),
 ("smecta", "Smecta 3g Sachet B/30", "SMECTA 3G SACHETS BT30", "3400933914638", 3200, 4400),
 ("cipro500", "Ciprofloxacine 500mg Comp. B/10", "CIPROFLOXACINE 500MG CPR BT10", "3400936125292", 2800, 3800),
 ("ventolin", "Ventoline 100µg Aérosol", "VENTOLINE 100MCG AEROSOL", "3400930117742", 2250, 3100),
]
ONLY_A = [("spasfon", "Spasfon Lyoc 80mg B/10", None, "3400932726324", 2750, 3800), ("vitc", "Vitamine C 500mg Comp. B/20", None, "3400930026778", 800, 1200)]
ONLY_B = [("efferal", None, "EFFERALGAN 500MG CPR EFF BT16", "3400932921286", 900, 1350), ("creme", None, "CREME SOLAIRE SPF50 50ML (PARA)", "3401560111111", 5500, 8500)]

def catalogs():
    wa = Workbook(); a = wa.active; a.title = "Catalogue"; a.append(["Code CIP", "Désignation", "Prix achat", "Prix vente", "Stock"])
    wb = Workbook(); b = wb.active; b.title = "Articles"; b.append(["Code EAN", "Libellé article", "PA", "PPV", "Qté stock"])
    for k, la, lb, cip, pa, pv in P + ONLY_A + ONLY_B:
        if la: a.append([cip, la, pa, pv, 50])
        if lb: b.append([cip, lb, pa, pv, 30])
    wa.save(f"{OUT}/catalogue_A_dakar.xlsx"); wb.save(f"{OUT}/catalogue_B_abidjan.xlsx")

def table(head, rows, widths, right=()):
    t = Table([head] + rows, colWidths=[w * mm for w in widths], repeatRows=1)
    st = [("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e6e6e6")),
          ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 7.8), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]
    st += [("ALIGN", (c, 1), (c, -1), "RIGHT") for c in right]
    t.setStyle(TableStyle(st)); return t

def doc(name, story, size=A4):
    SimpleDocTemplate(f"{D}/{name}.pdf", pagesize=size, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm).build(story)

def head(sup, addr, title, number, date, client, extra=""):
    return [Paragraph("<font color='#b00020'><b>DOCUMENT DE TEST — SIMULATION</b></font>", N), Spacer(1, 3 * mm),
            Table([[Paragraph(f"<b>{sup}</b><br/>{addr}", N), Paragraph(f"<b>Client :</b><br/>{client}{extra}", N)]], colWidths=[95 * mm, 90 * mm]),
            Spacer(1, 4 * mm), Paragraph(title, H), Paragraph(f"N° {number} — Date : {date}", ParagraphStyle("c", parent=N, alignment=1)), Spacer(1, 4 * mm)]

truth = {}
def L(key, qty, lot, exp, pu, ug=0, disc=None, vat=None, total=None, label_override=None):
    return {"key": key, "qty": qty, "ug": ug, "lot": lot, "exp": exp, "pu": pu, "disc": disc, "vat": vat, "total": total, "label": label_override}
lab = {k: (la or lb) for k, la, lb, *_ in P + ONLY_A + ONLY_B}
labB = {k: (lb or la) for k, la, lb, *_ in P + ONLY_A + ONLY_B}
cipOf = {k: c for k, la, lb, c, *_ in P + ONLY_A + ONLY_B}

# 1. Sénégal, BL avec UG et montant (pharmacie A) + version photo
l1 = [L("dol1000", 100, "DL6A21", "09/2028", 780, ug=10), L("amox500", 60, "AX5512", "05/2028", 950), L("coartem", 40, "CT2290", "11/2027", 2600, ug=4),
      L("metf850", 30, "MF4410", "08/2028", 2400), L("smecta", 24, "SM8812", "02/2029", 3200), L("spasfon", 20, "SP1177", "12/2027", 2750)]
for x in l1: x["total"] = x["qty"] * x["pu"]
rows = [[lab[x["key"]].upper(), str(x["qty"]), str(x["ug"] or ""), x["lot"], x["exp"], fr(x["pu"]), fr(x["total"])] for x in l1]
tot1 = sum(x["total"] for x in l1)
doc("SN1_bl_laborex_like", head("LABOREX SÉNÉGAL (TEST)", "Km 10 route de Rufisque, Dakar", "BON DE LIVRAISON", "BL-26-118804", "19/11/2026", "PHARMACIE DU CENTRE — Dakar") +
    [table(["Désignation", "Qté", "UG", "N° Lot", "Date Exp.", "P.U.", "Montant"], rows, [70, 13, 11, 22, 20, 22, 26], right=(1, 2, 5, 6)), Spacer(1, 3 * mm),
     Paragraph(f"<b>Total général (FCFA) : {fr(tot1)}</b> — Médicaments exonérés de TVA.", N)])
truth["SN1_bl_laborex_like"] = {"pharmacy": "A", "currency": "FCFA", "lines": l1, "total": tot1, "expect": []}

# 2. Côte d'Ivoire, facture : qté commandée ≠ livrée, remise, TVA 18 % parapharmacie (pharmacie B)
l2 = [L("dol1000", 120, "DL6A30", "10/2028", 780, disc=5), L("cipro500", 12, "CP9921", "06/2028", 2800, disc=5), L("efferal", 50, "EF4410", "03/2029", 900),
      L("creme", 6, "SOL555", "01/2029", 5500, vat=18), L("ventolin", 10, "VT1281", "09/2027", 2250, disc=5)]
cmd2 = {"cipro500": 20}
for x in l2:
    x["vat"] = x["vat"] or 0; x["total"] = round(x["qty"] * x["pu"] * (1 - (x["disc"] or 0) / 100))
ht2 = sum(x["total"] for x in l2); tva2 = round(sum(x["total"] * x["vat"] / 100 for x in l2)); ttc2 = ht2 + tva2
rows = [[cipOf[x["key"]], labB[x["key"]], str(cmd2.get(x["key"], x["qty"])), str(x["qty"]), fr(x["pu"]), str(x["disc"] or ""), fr(x["total"]), str(x["vat"])] for x in l2]
doc("CI2_facture_remise_tva", head("UBIPHARM CÔTE D'IVOIRE (TEST)", "Zone 4, Abidjan", "FACTURE", "FA-2026-07731", "18/11/2026", "PHARMACIE DES ROSES — Abidjan") +
    [table(["Code CIP", "Désignation", "Qté cmd", "Qté livrée", "PU HT", "Rem %", "Montant HT", "TVA %"], rows, [27, 58, 15, 17, 19, 13, 24, 13], right=(2, 3, 4, 5, 6, 7)), Spacer(1, 3 * mm),
     Table([["Total HT", fr(ht2)], ["TVA 18 %", fr(tva2)], ["NET À PAYER (FCFA)", fr(ttc2)]], colWidths=[50 * mm, 30 * mm], style=[("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"), ("ALIGN", (1, 0), (1, -1), "RIGHT")]),
     Paragraph("Reliquat : CIPROFLOXACINE 8 boîtes en attente de livraison.", N)])
for x in l2: x["lot"] = x["exp"] = None
truth["CI2_facture_remise_tva"] = {"pharmacy": "B", "currency": "FCFA", "lines": l2, "total": ttc2, "ht": ht2, "tva": tva2, "expect": []}

# 3. Maroc : PPH / PPV, TVA 7 %, dirhams (pharmacie B)
l3 = [L("dol1000", 30, "MA2201", "07/2028", 9.8, vat=7), L("amox500", 20, "MA7710", "04/2028", 14.5, vat=7), L("omep20", 15, "MA3321", "12/2028", 42.3, vat=7)]
ppv3 = {"dol1000": 15.6, "amox500": 22.9, "omep20": 66.7}
for x in l3: x["total"] = round(x["qty"] * x["pu"], 2)
ht3 = round(sum(x["total"] for x in l3), 2); tva3 = round(ht3 * 0.07, 2); ttc3 = round(ht3 + tva3, 2)
rows = [[labB[x["key"]], str(x["qty"]), x["lot"], x["exp"], fr(x["pu"]), fr(ppv3[x["key"]]), "7%", fr(x["total"])] for x in l3]
doc("MA3_facture_dirham", head("SOPHADIMS MAROC (TEST)", "Bd Zerktouni, Casablanca", "FACTURE", "F 26/04512", "17/11/2026", "PHARMACIE AL AMAL — Casablanca") +
    [table(["Désignation", "Qté", "Lot", "Péremption", "PPH", "PPV", "TVA", "Montant HT"], rows, [60, 12, 18, 20, 17, 17, 12, 25], right=(1, 4, 5, 7)), Spacer(1, 3 * mm),
     Paragraph(f"Total HT : {fr(ht3)} DH — TVA 7 % : {fr(tva3)} DH — <b>Total TTC : {fr(ttc3)} DH</b>", N)])
truth["MA3_facture_dirham"] = {"pharmacy": "B", "currency": "MAD", "lines": l3, "total": ttc3, "ht": ht3, "tva": tva3, "expect": []}

# 4. France : 2 pages, report, PU brut + remise + PU net, TVA 2,1 / 20 %, euros (pharmacie A)
keys4 = ["dol1000", "amox500", "metf850", "omep20", "smecta", "cipro500", "ventolin", "vitc", "spasfon", "coartem"]
eur = {"dol1000": 1.69, "amox500": 2.10, "metf850": 2.95, "omep20": 3.40, "smecta": 3.85, "cipro500": 4.20, "ventolin": 3.05, "vitc": 2.50, "spasfon": 3.20, "coartem": 21.40}
l4 = []
for i, k in enumerate(keys4):
    tarif = eur[k]; net = round(tarif * 0.975, 2); q = [12, 10, 6, 8, 5, 4, 6, 10, 6, 3][i]
    l4.append(L(k, q, f"FR{3100 + i * 7}", ["06/2028", "03/2028", "09/2028", "11/2028", "02/2029", "05/2028", "08/2027", "10/2028", "12/2027", "04/2028"][i], net, vat=20 if k == "vitc" else 2.1, total=round(q * net, 2)))
for x, k in zip(l4, keys4): x["tarif"] = eur[k]
def rows4(xs): return [[cipOf[x["key"]], lab[x["key"]], str(x["qty"]), fr(x["tarif"]), "2,5", fr(x["pu"]), fr(x["total"]), fr(x["vat"])] for x in xs]
p1 = round(sum(x["total"] for x in l4[:6]), 2); ht4 = round(sum(x["total"] for x in l4), 2)
tva4 = round(sum(x["total"] * x["vat"] / 100 for x in l4), 2); ttc4 = round(ht4 + tva4, 2)
cols4 = ["CIP13", "Désignation", "Qté", "Prix tarif HT", "Rem. %", "PU net HT", "Montant HT", "TVA %"]; w4 = [27, 58, 11, 21, 13, 19, 22, 13]
doc("FR4_bl_repartiteur_2pages", head("RÉPARTITEUR PHARMA FRANCE (TEST)", "ZI Nord, 69000 Lyon", "BON DE LIVRAISON / FACTURE", "BL 2611-55821", "19/11/2026", "PHARMACIE DU PORT — Marseille") +
    [table(cols4, rows4(l4[:6]) + [["", "À REPORTER", "", "", "", "", fr(p1), ""]], w4, right=(2, 3, 4, 5, 6, 7)), PageBreak(),
     Paragraph("Suite BL 2611-55821 — page 2/2", N), Spacer(1, 3 * mm),
     table(cols4, [["", "REPORT", "", "", "", "", fr(p1), ""]] + rows4(l4[6:]), w4, right=(2, 3, 4, 5, 6, 7)), Spacer(1, 3 * mm),
     Paragraph(f"Récapitulatif TVA — base 2,1 % : {fr(round(sum(x['total'] for x in l4 if x['vat'] == 2.1), 2))} € ; base 20 % : {fr(round(sum(x['total'] for x in l4 if x['vat'] == 20), 2))} €", N),
     Paragraph(f"Total HT : {fr(ht4)} € — Total TVA : {fr(tva4)} € — <b>NET À PAYER : {fr(ttc4)} €</b>", N)])
for x in l4: x["lot"] = x["exp"] = None
truth["FR4_bl_repartiteur_2pages"] = {"pharmacy": "A", "currency": "EUR", "lines": l4, "total": ttc4, "ht": ht4, "tva": tva4, "expect": []}

# 5. États-Unis : invoice NDC, qty ordered/shipped, unit cost, extended (pharmacie B)
l5 = [{"key": None, "label": "AMOXICILLIN 500MG CAP 100CT", "ndc": "65862-0017-01", "qty": 6, "ord": 6, "lot": "AMX24K19", "exp": "07/2027", "pu": 8.42},
      {"key": None, "label": "LISINOPRIL 10MG TAB 1000CT", "ndc": "68180-0514-03", "qty": 2, "ord": 3, "lot": "L2309A", "exp": "11/2027", "pu": 24.10},
      {"key": None, "label": "ATORVASTATIN 20MG TAB 90CT", "ndc": "00093-5057-98", "qty": 4, "ord": 4, "lot": "AT77812", "exp": "03/2028", "pu": 6.75},
      {"key": None, "label": "ALBUTEROL HFA 90MCG INH 18G", "ndc": "00093-3174-31", "qty": 5, "ord": 5, "lot": "AB0951", "exp": "09/2027", "pu": 19.99}]
for x in l5: x.update({"ug": 0, "disc": None, "vat": None, "total": round(x["qty"] * x["pu"], 2)})
tot5 = round(sum(x["total"] for x in l5), 2)
rows = [[x["ndc"], x["label"], str(x["ord"]), str(x["qty"]), x["lot"], x["exp"], en(x["pu"]), en(x["total"])] for x in l5]
doc("US5_invoice_ndc", [Paragraph("<font color='#b00020'><b>TEST DOCUMENT — SIMULATION</b></font>", N), Spacer(1, 3 * mm),
    Paragraph("<b>ACME DRUG WHOLESALE (TEST)</b> — 100 Main St, Columbus OH", N), Paragraph("Ship to: CORNER PHARMACY, Austin TX — Account 448812", N), Spacer(1, 4 * mm),
    Paragraph("INVOICE", H), Paragraph("Invoice # 9006632145 — Invoice date: 11/18/2026 — PO# 77120", ParagraphStyle("c", parent=N, alignment=1)), Spacer(1, 4 * mm),
    table(["NDC", "Description", "Qty Ord", "Qty Ship", "Lot", "Exp", "Unit Cost", "Extended"], rows, [24, 60, 13, 14, 19, 14, 19, 22], right=(2, 3, 6, 7)), Spacer(1, 3 * mm),
    Paragraph(f"Subtotal: ${en(tot5)} — Tax: $0.00 — <b>Invoice Total: ${en(tot5)}</b>", N)], size=letter)
truth["US5_invoice_ndc"] = {"pharmacy": "B", "currency": "USD", "lines": l5, "total": tot5, "expect": []}

# 7. Sénégal, pièges : total imprimé faux, produit périmé, péremption courte, prix manquant (pharmacie B)
l7 = [L("dol1000", 50, "DL5502", "10/2028", 780), L("amox500", 30, "AX0112", "06/2025", 950), L("coartem", 20, "CT7781", "03/2027", 2600), L("smecta", 10, "SM3301", "01/2029", 0)]
for x in l7: x["total"] = x["qty"] * x["pu"]
tot7_true = sum(x["total"] for x in l7); tot7_printed = tot7_true + 50000
rows = [[labB[x["key"]], str(x["qty"]), x["lot"], x["exp"], fr(x["pu"]) if x["pu"] else "—", fr(x["total"]) if x["pu"] else "—"] for x in l7]
doc("SN7_pieges_total_peremption", head("COPHASE (TEST)", "Rue 10, Dakar", "BON DE LIVRAISON", "BL/2026/3381", "19/11/2026", "PHARMACIE DES ROSES") +
    [table(["Produit", "Qté", "Lot", "Exp", "PU", "Montant"], rows, [75, 15, 25, 20, 22, 26], right=(1, 4, 5)), Spacer(1, 3 * mm), Paragraph(f"<b>Total : {fr(tot7_printed)} FCFA</b>", N)])
truth["SN7_pieges_total_peremption"] = {"pharmacy": "B", "currency": "FCFA", "lines": l7, "total": tot7_printed, "expect": ["total", "périmé", "péremption courte", "prix d'achat manquant"]}

# 8. Relevé de mutuelle / tiers payant (pharmacie A)
l8 = [{"key": None, "label": "Doliprane 1000mg Comp. B/8", "qty": 2, "pu": 1200, "lot": "", "exp": "", "ug": 0, "disc": None, "vat": None, "total": 2400},
      {"key": None, "label": "Amoxicilline 500mg Gélule B/12", "qty": 1, "pu": 1400, "lot": "", "exp": "", "ug": 0, "disc": None, "vat": None, "total": 1400},
      {"key": None, "label": "Ventoline 100µg Aérosol", "qty": 1, "pu": 3100, "lot": "", "exp": "", "ug": 0, "disc": None, "vat": None, "total": 3100}]
rows = [["DIOP Awa", "ORD-55120", x["label"], str(x["qty"]), fr(x["pu"]), fr(x["total"]), "80 %", fr(x["total"] * 0.8), fr(x["total"] * 0.2)] for x in l8]
doc("MUT8_releve_tiers_payant", head("IPM SANTÉ PLUS (TEST)", "Plateau, Dakar", "BORDEREAU TIERS PAYANT", "TP-2026-1102", "15/11/2026", "PHARMACIE DU CENTRE") +
    [table(["Assuré", "Ordonnance", "Médicament", "Qté", "PU", "Montant", "Taux PEC", "Part IPM", "Part assuré"], rows, [24, 22, 50, 10, 15, 18, 15, 17, 19], right=(3, 4, 5, 7, 8)), Spacer(1, 3 * mm),
     Paragraph(f"Total à rembourser par l'IPM : <b>{fr(sum(x['total'] for x in l8) * 0.8)} FCFA</b>", N)])
truth["MUT8_releve_tiers_payant"] = {"pharmacy": "A", "currency": "FCFA", "lines": l8, "total": sum(x['total'] for x in l8) * 0.8, "expect": [], "kind": "mutuelle"}

# 9. Avoir (retour de marchandise) : quantités négatives (pharmacie B)
l9 = [L("ventolin", -3, "VT1281", "09/2027", 2250), L("smecta", -2, "SM3301", "01/2029", 3200)]
for x in l9: x["total"] = x["qty"] * x["pu"]
rows = [[labB[x["key"]], str(x["qty"]), x["lot"], fr(x["pu"]), fr(x["total"])] for x in l9]
doc("AV9_avoir_retour", head("UBIPHARM CÔTE D'IVOIRE (TEST)", "Zone 4, Abidjan", "AVOIR (retour de marchandise)", "AV-2026-0091", "19/11/2026", "PHARMACIE DES ROSES") +
    [table(["Désignation", "Qté", "Lot", "PU", "Montant"], rows, [80, 15, 25, 25, 30], right=(1, 3, 4)), Spacer(1, 3 * mm), Paragraph(f"<b>Total avoir : {fr(sum(x['total'] for x in l9))} FCFA</b>", N)])
for x in l9: x["exp"] = None
truth["AV9_avoir_retour"] = {"pharmacy": "B", "currency": "FCFA", "lines": l9, "total": sum(x['total'] for x in l9), "expect": ["avoir"], "kind": "avoir"}

catalogs()
# Photos : version téléphone du bon SN1 (inclinée, floue, bruitée, compressée) et version tachée (SN6)
subprocess.run(["pdftoppm", "-r", "150", "-jpeg", "-singlefile", f"{D}/SN1_bl_laborex_like.pdf", f"{OUT}/sn1_scan"], check=True)
subprocess.run(["convert", f"{OUT}/sn1_scan.jpg", "-background", "#d8d2c4", "-rotate", "2.7", "-blur", "0x0.8", "-attenuate", "0.6", "+noise", "Gaussian",
                "-brightness-contrast", "-6x-12", "-quality", "55", f"{D}/SN1_photo_telephone.jpg"], check=True)
from PIL import Image, ImageDraw
im = Image.open(f"{OUT}/sn1_scan.jpg").convert("RGB"); W, Hh = im.size; d = ImageDraw.Draw(im)
# tache sur la quantité de la 3e ligne (COARTEM) : on ne doit pas inventer un chiffre
d.ellipse((int(W * 0.400), int(Hh * 0.2465), int(W * 0.448), int(Hh * 0.2645)), fill=(70, 55, 40))
im.save(f"{D}/SN6_photo_tache.jpg", quality=70)
truth["SN1_photo_telephone"] = {**truth["SN1_bl_laborex_like"], "image": True}
truth["SN6_photo_tache"] = {**truth["SN1_bl_laborex_like"], "image": True, "expect": ["incertaine"], "blot_line": 2}
json.dump({"truth": truth, "labA": lab, "labB": labB}, open(f"{OUT}/truth.json", "w"), ensure_ascii=False, indent=1)
print(len(truth), "documents ->", sorted(os.listdir(D)))
