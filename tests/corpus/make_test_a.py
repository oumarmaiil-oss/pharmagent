"""Fichiers de test « A » : BL du grossiste (20 médicaments, 2 quantités vides) et fiche de réception ERP
(synonymes dans l'en-tête, formules de total par ligne, Total HT, TVA, Total TTC, couleurs distinctes)."""
import sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
thin = Side(style="thin", color="9CA3AF"); BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
fill = lambda c: PatternFill("solid", fgColor=c)

PRODUITS = [  # CIP, désignation, quantité (None = vide, piège), prix HT, prix de vente, péremption
    ("3400930000011", "DOLIPRANE 1000MG CP B/8", 100, 780, 1200, "09/2028"),
    ("3400930000028", "AMOXICILLINE 500MG GELULE B/12", 40, 1850, 2600, "05/2028"),
    ("3400930000035", "SMECTA 3G SACHET B/30", 20, 3200, 4500, "02/2029"),
    ("3400930000042", "IBUPROFENE 400MG CP B/30", 35, 1400, 2000, "10/2027"),
    ("3400930000059", "VITAMINE C 500MG CP B/20", 50, 800, 1150, "12/2027"),
    ("3400930000066", "METFORMINE 850MG CP B/30", 60, 1250, 1800, "07/2028"),
    ("3400930000073", "AMLODIPINE 5MG CP B/30", None, 2100, 3000, "11/2028"),   # quantité vide
    ("3400930000080", "OMEPRAZOLE 20MG GELULE B/14", 30, 1650, 2400, "03/2028"),
    ("3400930000097", "CIPROFLOXACINE 500MG CP B/10", 25, 2300, 3300, "08/2027"),
    ("3400930000103", "ARTEMETHER LUMEFANTRINE 20/120 CP B/24", 45, 2900, 4100, "06/2028"),
    ("3400930000110", "PARACETAMOL 500MG CP B/20", 120, 450, 700, "01/2029"),
    ("3400930000127", "SALBUTAMOL 100MCG AEROSOL", 15, 2750, 3900, "04/2028"),
    ("3400930000134", "METRONIDAZOLE 250MG CP B/20", 40, 900, 1300, "09/2027"),
    ("3400930000141", "LORATADINE 10MG CP B/10", None, 1100, 1600, "12/2028"),     # quantité vide
    ("3400930000158", "CEFIXIME 200MG CP B/8", 20, 3600, 5100, "05/2028"),
    ("3400930000165", "DICLOFENAC 50MG CP B/30", 30, 950, 1400, "10/2028"),
    ("3400930000172", "FER ACIDE FOLIQUE CP B/30", 50, 700, 1050, "02/2028"),
    ("3400930000189", "ZINC 20MG CP DISPERSIBLE B/10", 60, 600, 900, "07/2028"),
    ("3400930000196", "SRO SACHET B/20", 80, 350, 550, "03/2029"),
    ("3400930000202", "HYDROXYDE ALUMINIUM MAGNESIUM SUSP 250ML", 25, 1500, 2200, "11/2027"),
]


def bl(path):
    wb = Workbook(); ws = wb.active; ws.title = "Bon de livraison"
    ws.merge_cells("A1:G1"); ws["A1"] = "LABOREX SÉNÉGAL — BON DE LIVRAISON"; ws["A1"].font = Font(bold=True, size=14, color="FFFFFF"); ws["A1"].fill = fill("1F4E79")
    infos = [("Fournisseur :", "LABOREX SENEGAL"), ("Adresse :", "Km 2,5 Bd du Centenaire, Dakar"), ("N° BL :", "BL-TEST-A-001"), ("Date :", "20/11/2026"),
             ("Client :", "PHARMACIE TEST A"), ("Commande :", "CMD-7781")]
    for i, (k, v) in enumerate(infos):
        r = 3 + i
        ws.cell(row=r, column=1, value=k).font = Font(bold=True); ws.cell(row=r, column=2, value=v)
    heads = ["N°", "Code CIP", "Désignation", "Quantité livrée", "Prix HT", "Prix de vente", "Date de péremption"]
    hr = 10
    for c, h in enumerate(heads, 1):
        x = ws.cell(row=hr, column=c, value=h); x.font = Font(bold=True, color="FFFFFF"); x.fill = fill("2E75B6"); x.border = BOX
        x.alignment = Alignment(horizontal="center", wrap_text=True)
    for k, (cip, des, q, pu, pv, exp) in enumerate(PRODUITS, 1):
        for c, v in enumerate([k, cip, des, q, pu, pv, exp], 1):
            x = ws.cell(row=hr + k, column=c, value=v); x.border = BOX
    for col, w in zip("ABCDEFG", [5, 16, 42, 15, 10, 13, 18]):
        ws.column_dimensions[col].width = w
    wb.save(path)


def erp(path):
    wb = Workbook(); ws = wb.active; ws.title = "Réception"
    ws.merge_cells("A1:F1"); ws["A1"] = "ERP TEST A — RÉCEPTION DE MARCHANDISE"; ws["A1"].font = Font(bold=True, size=14, color="FFFFFF"); ws["A1"].fill = fill("375623")
    # En-tête avec des synonymes : Grossiste (= fournisseur), Numéro de bordereau (= N° BL), Date de livraison (= date)
    for r, (k, k2) in enumerate([("Grossiste :", "Numéro de bordereau :"), ("Date de livraison :", "Réceptionné par :")], 3):
        ws.cell(row=r, column=1, value=k).font = Font(bold=True); ws.cell(row=r, column=4, value=k2).font = Font(bold=True)
        for c in (2, 5):
            ws.cell(row=r, column=c).fill = fill("FFF2CC"); ws.cell(row=r, column=c).border = BOX
    heads = ["Désignation", "N° de lot", "Quantité reçue", "Prix d'achat", "Péremption", "Total"]
    hr = 6
    for c, h in enumerate(heads, 1):
        x = ws.cell(row=hr, column=c, value=h); x.font = Font(bold=True, color="FFFFFF"); x.fill = fill("548235"); x.border = BOX
        x.alignment = Alignment(horizontal="center")
    first, last = hr + 1, hr + 25
    for r in range(first, last + 1):
        for c in range(1, 7):
            ws.cell(row=r, column=c).border = BOX
        ws.cell(row=r, column=6, value=f'=IF(OR(C{r}="",D{r}=""),"",C{r}*D{r})').fill = fill("E2EFDA")
    t = last + 2
    ws.cell(row=t, column=5, value="Total HT").font = Font(bold=True)
    ws.cell(row=t, column=6, value=f"=SUM(F{first}:F{last})").fill = fill("DDEBF7")
    ws.cell(row=t + 1, column=4, value="Taux TVA").font = Font(italic=True)
    ws.cell(row=t + 1, column=5, value=0.18).number_format = "0%"
    ws.cell(row=t + 1, column=6, value=f"=F{t}*E{t + 1}").fill = fill("FCE4D6")
    ws.cell(row=t + 2, column=5, value="Total TTC").font = Font(bold=True, color="C00000")
    ws.cell(row=t + 2, column=6, value=f"=F{t}+F{t + 1}").fill = fill("F8CBAD")
    for r in (t, t + 2):
        ws.cell(row=r, column=6).font = Font(bold=True)
    ws.cell(row=t + 4, column=1, value="VALIDER LA RÉCEPTION (à faire par le pharmacien)").font = Font(bold=True, color="C00000")
    for col, w in zip("ABCDEF", [42, 12, 15, 13, 12, 14]):
        ws.column_dimensions[col].width = w
    wb.save(path)


bl(f"{OUT}/BL test A.xlsx")
erp(f"{OUT}/ERP test A.xlsx")
print("ok")
