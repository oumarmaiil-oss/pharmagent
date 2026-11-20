"""Génère deux BL pour tester l'intégration Playwright du mock ERP :
  - BL-CONNU.xlsx   : produits présents dans le catalogue ERP
  - BL-INCONNU.xlsx : produits absents du catalogue ERP (noms inconnus)
Usage : python make_bl_playwright.py <dossier_sortie>
"""
import sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
thin = Side(style="thin", color="9CA3AF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
fill = lambda c: PatternFill("solid", fgColor=c)

# ── Produits connus (CIP + désignation correspondant exactement au catalogue ERP) ──
CONNUS = [
    ("3400935000011", "COTRIMOXAZOLE 480MG CP B/20",         20, 650,  950,  "08/2028"),
    ("3400935000035", "QUININE 500MG CP B/20",               15, 1800, 2600, "11/2027"),
    ("3400935000042", "ARTESUNATE 100MG CP B/12",            30, 3200, 4500, "06/2028"),
    ("3400935000103", "FER SULFATE 200MG CP B/30",           40, 720,  1050, "05/2028"),
    ("3400935000158", "FUROSEMIDE 40MG CP B/30",             10, 870,  1280, "11/2028"),
]

# ── Produits inconnus (non présents dans le catalogue ERP) ──
INCONNUS = [
    ("3400922222001", "DOLIPRANE 500MG CP B/16",             50, 480,  720,  "03/2029"),
    ("3400922222002", "AMPICLOX 500MG GELULE B/12",          25, 1650, 2400, "07/2027"),
    ("3400922222003", "PREDNISOLONE 20MG CP B/20",           30, 920,  1380, "12/2028"),
    ("3400922222004", "IBUPROFEN 400MG CP B/30",             45, 760,  1150, "09/2028"),
    ("3400922222005", "CHLOROQUINE 100MG CP B/30",           20, 1100, 1650, "04/2028"),
]


def make_bl(path, fournisseur, numero, produits):
    wb = Workbook()
    ws = wb.active
    ws.title = "Bon de livraison"

    # Titre
    ws.merge_cells("A1:G1")
    ws["A1"] = f"{fournisseur.upper()} — BON DE LIVRAISON"
    ws["A1"].font = Font(bold=True, size=14, color="FFFFFF")
    ws["A1"].fill = fill("1D4ED8")

    # Infos en-tête
    infos = [
        ("Fournisseur :", fournisseur),
        ("Adresse :",    "Route de Rufisque, Dakar"),
        ("N° BL :",      numero),
        ("Date :",       "20/11/2026"),
        ("Client :",     "PHARMACIE TEST PLAYWRIGHT"),
        ("Commande :",   "CMD-PW-001"),
    ]
    for i, (k, v) in enumerate(infos):
        r = 3 + i
        ws.cell(row=r, column=1, value=k).font = Font(bold=True)
        ws.cell(row=r, column=2, value=v)

    # En-tête tableau
    heads = ["N°", "Code CIP", "Désignation", "Quantité livrée", "Prix HT", "Prix de vente", "Date de péremption"]
    hr = 10
    for c, h in enumerate(heads, 1):
        x = ws.cell(row=hr, column=c, value=h)
        x.font = Font(bold=True, color="FFFFFF")
        x.fill = fill("1D4ED8")
        x.border = BOX
        x.alignment = Alignment(horizontal="center", wrap_text=True)

    # Lignes produits
    for k, (cip, des, q, pu, pv, exp) in enumerate(produits, 1):
        for c, v in enumerate([k, cip, des, q, pu, pv, exp], 1):
            x = ws.cell(row=hr + k, column=c, value=v)
            x.border = BOX

    # Largeurs colonnes
    for col, w in zip("ABCDEFG", [5, 16, 42, 15, 10, 13, 18]):
        ws.column_dimensions[col].width = w

    wb.save(path)
    print(f"Créé : {path}")


make_bl(f"{OUT}/BL-CONNU.xlsx",   "UBIPHARM SENEGAL",  "BL-PW-CONNU-001",   CONNUS)
make_bl(f"{OUT}/BL-INCONNU.xlsx", "COPHARMED SENEGAL", "BL-PW-INCONNU-001", INCONNUS)
print("ok")
