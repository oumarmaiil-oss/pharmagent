#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Trois ERP, plusieurs bons : on confronte ce qui est écrit à ce que portait le bon.

Les trois écrans n'ont presque rien en commun — intitulés, langue, format de
date, gestion des lignes, choix du produit — pour éprouver autre chose qu'une
seule façon de faire. Chaque case est relue dans la page et comparée au bon.
"""
import os
import pathlib
import sys

os.environ.setdefault("PHARMAGENT_HOME", "/tmp/pharmagent-matrice")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "agent"))
import pharmagent_agent as A  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ICI = pathlib.Path(__file__).resolve().parent
RACINE = ICI.parent

ERPS = [
    {"nom": "A — catalogue déroulant (FR)", "url": (RACINE / "agent" / "demo-erp.html").as_uri(),
     "attendus": {"fournisseur": "#fournisseur", "reference": "#reference_bl", "date": "#date_reception"},
     "lignes": "#lines-body tr", "garde": "#success-panel",
     "dateFmt": "%d/%m/%Y", "perFmt": "%m/%Y", "catalogue": True},
    {"nom": "B — 10 lignes fixes, sans bouton (FR)", "url": (ICI / "erps" / "erp-b.html").as_uri(),
     "attendus": {"fournisseur": "#f1", "reference": "#f2", "date": "#f3"},
     "lignes": "#corps tr", "garde": None,
     "dateFmt": "%d/%m/%Y", "perFmt": "%m/%y", "catalogue": False},
    {"nom": "C — liste de suggestions (EN)", "url": (ICI / "erps" / "erp-c.html").as_uri(),
     "attendus": {"fournisseur": "#sup", "reference": "#dn", "date": "#dt"},
     "lignes": "#tb tr:not(.head)", "garde": None,
     "dateFmt": "%Y-%m-%d", "perFmt": "%Y-%m", "catalogue": False,
     "fournisseursImposes": ["UBIPHARM SENEGAL", "LABOREX SENEGAL", "SODIPHARM"]},
]

# Dix bons de livraison, chacun pour éprouver autre chose : un produit absent du
# catalogue, un lot manquant, une quantité nulle, une date au 29 février, des
# montants élevés, une désignation à rallonge, des accents.
def _l(i, produit, qte, lot, per, prix, **extra):
    d = {"index": i, "product": produit, "quantity": qte, "lotNumber": lot,
         "expiryDate": per, "purchasePrice": prix}
    d.update(extra)
    return d


BONS = [
    {"nom": "3 produits du catalogue",
     "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-M01", "documentDate": "2026-11-21"},
     "lines": [_l(0, "COTRIMOXAZOLE 480MG CP B/20", 30, "LOT-CTX-01", "2028-08-31", 650),
               _l(1, "QUININE 500MG CP B/20", 25, "LOT-QNI-02", "2027-11-30", 1800),
               _l(2, "FER SULFATE 200MG CP B/30", 45, "LOT-FER-03", "2028-05-31", 720)]},

    {"nom": "même produit deux fois, deux lots",
     "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-M02", "documentDate": "2026-11-21"},
     "lines": [_l(0, "ALBENDAZOLE 400MG CP", 20, "LOT-ALB-AA", "2028-10-31", 490),
               _l(1, "ALBENDAZOLE 400MG CP", 15, "LOT-ALB-BB", "2029-02-28", 490)]},

    {"nom": "un produit sans numéro de lot",
     "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-M03", "documentDate": "2026-11-21"},
     "lines": [_l(0, "PARACETAMOL 250MG SUPP B/10", 60, "", "2029-01-31", 420)]},

    {"nom": "une seule ligne",
     "header": {"supplier": "LABOREX SENEGAL", "documentNumber": "BL-M04", "documentDate": "2026-01-05"},
     "lines": [_l(0, "ARTESUNATE 100MG CP B/12", 40, "LOT-ART-04", "2028-06-30", 3200)]},

    {"nom": "bon long : 8 lignes",
     "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-M05", "documentDate": "2026-11-21"},
     "lines": [_l(0, "COTRIMOXAZOLE 480MG CP B/20", 30, "LOT-A1", "2028-08-31", 650),
               _l(1, "METRONIDAZOLE 500MG SUPP B/10", 20, "LOT-A2", "2028-03-31", 1200),
               _l(2, "QUININE 500MG CP B/20", 25, "LOT-A3", "2027-11-30", 1800),
               _l(3, "ARTESUNATE 100MG CP B/12", 40, "LOT-A4", "2028-06-30", 3200),
               _l(4, "PARACETAMOL 250MG SUPP B/10", 60, "LOT-A5", "2029-01-31", 420),
               _l(5, "ACIDE FOLIQUE 5MG CP B/30", 50, "LOT-A6", "2028-07-31", 390),
               _l(6, "FER SULFATE 200MG CP B/30", 45, "LOT-A7", "2028-05-31", 720),
               _l(7, "ALBENDAZOLE 400MG CP", 35, "LOT-A8", "2027-10-31", 490)]},

    {"nom": "produit absent du catalogue",
     "header": {"supplier": "SODIPHARM", "documentNumber": "BL-M06", "documentDate": "2026-11-21"},
     "lines": [_l(0, "COTRIMOXAZOLE 480MG CP B/20", 10, "LOT-OK-06", "2028-08-31", 650),
               _l(1, "DOLIPRANE 1000MG CPR B/8", 12, "LOT-ABS-06", "2028-04-30", 1250,
                  absent_du_catalogue=True)]},

    {"nom": "montants et quantités élevés",
     "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-M07", "documentDate": "2026-12-31"},
     "lines": [_l(0, "QUININE 500MG CP B/20", 9999, "LOT-GROS-07", "2029-12-31", 650000)]},

    {"nom": "péremption au 29 février (année bissextile)",
     "header": {"supplier": "LABOREX SENEGAL", "documentNumber": "BL-M08", "documentDate": "2026-02-28"},
     "lines": [_l(0, "MEBENDAZOLE 100MG CP B/6", 30, "LOT-BIS-08", "2028-02-29", 560)]},

    {"nom": "désignation à rallonge et accents",
     "header": {"supplier": "PHARMACIE DU PLATEAU — DÉPÔT", "documentNumber": "BL-M09/É", "documentDate": "2026-11-21"},
     "lines": [_l(0, "AMOXICILLINE 250MG/5ML SUSP 100ML", 15, "LOT-ÉÀÇ-09", "2027-09-30", 2100)]},

    {"nom": "quantité nulle (produit annoncé, non livré)",
     "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-M10", "documentDate": "2026-11-21"},
     "lines": [_l(0, "ZINC SULFATE 20MG CP B/20", 0, "LOT-ZERO-10", "2028-04-30", 580)]},
]

ecarts = []


def lire_pages(page, erp):
    """Relit l'écran : en-tête et lignes réellement remplies."""
    return page.evaluate("""(sel) => {
      const val = (s) => { const e = document.querySelector(s); return e ? (e.value || '') : null; };
      const rows = [...document.querySelectorAll(sel.lignes)]
        .map((tr) => [...tr.querySelectorAll('input,select')].map((i) => i.value || ''))
        .filter((r) => r.some((v) => v !== ''));
      return {
        fournisseur: val(sel.attendus.fournisseur),
        reference:   val(sel.attendus.reference),
        date:        val(sel.attendus.date),
        lignes: rows,
        garde: sel.garde && document.querySelector(sel.garde)
               ? getComputedStyle(document.querySelector(sel.garde)).display : 'absent',
      };
    }""", {"attendus": erp["attendus"], "lignes": erp["lignes"], "garde": erp["garde"]})


def attendu_date(iso, fmt):
    from datetime import datetime
    return datetime.strptime(iso, "%Y-%m-%d").strftime(fmt)


def lignes_attendues(erp, bon):
    """Les lignes que CET ERP doit contenir.

    Un produit absent du catalogue ne doit surtout pas être écrit par un ERP qui
    impose de choisir dans sa liste : l'agent doit refuser la ligne plutôt que
    d'y mettre un médicament voisin. Sur un ERP en texte libre, la même ligne
    s'écrit normalement.
    """
    if not erp.get("catalogue"):
        return list(bon["lines"])
    return [l for l in bon["lines"] if not l.get("absent_du_catalogue")]


def compare(erp, bon, vu, resultats):
    """Confronte case par case. Renvoie la liste des écarts."""
    out = []
    h = bon["header"]
    # Un ERP qui impose sa liste de fournisseurs ne peut pas en recevoir un autre.
    # L'agent doit laisser le champ vide plutôt que de choisir un fournisseur
    # voisin — et le dire. Écrire « LABOREX » à la place de « PLATEAU »
    # rattacherait la livraison au mauvais grossiste.
    imposes = erp.get("fournisseursImposes")
    if imposes is not None and h["supplier"] not in imposes:
        if (vu["fournisseur"] or "") != "":
            out.append("fournisseur : « %s » n'est pas dans la liste de l'ERP, or « %s » a été écrit"
                       % (h["supplier"], vu["fournisseur"]))
    elif (vu["fournisseur"] or "") != h["supplier"]:
        out.append("fournisseur : attendu « %s », trouvé « %s »" % (h["supplier"], vu["fournisseur"]))
    if (vu["reference"] or "") != h["documentNumber"]:
        out.append("référence : attendu « %s », trouvé « %s »" % (h["documentNumber"], vu["reference"]))
    d = attendu_date(h["documentDate"], erp["dateFmt"])
    if (vu["date"] or "") != d:
        out.append("date : attendu « %s », trouvé « %s »" % (d, vu["date"]))

    attendues = lignes_attendues(erp, bon)
    if len(vu["lignes"]) != len(attendues):
        out.append("nombre de lignes : attendu %d, trouvé %d" % (len(attendues), len(vu["lignes"])))

    # Un produit absent du catalogue doit être refusé, et dit au pharmacien.
    for ligne in bon["lines"]:
        if not ligne.get("absent_du_catalogue") or not erp.get("catalogue"):
            continue
        r = next((x for x in resultats if x.get("index") == ligne["index"]), None)
        if r is None or r.get("ok"):
            out.append("ligne %d : « %s » est absent du catalogue et aurait dû être refusée"
                       % (ligne["index"] + 1, ligne["product"]))
        elif "catalogue" not in (r.get("message") or "").lower():
            out.append("ligne %d : refusée, mais sans dire que le produit manque au catalogue (« %s »)"
                       % (ligne["index"] + 1, (r.get("message") or "")[:60]))
        # Et surtout : aucun autre médicament ne doit avoir pris sa place.
        for cells in vu["lignes"]:
            if A.norm(ligne["product"]) in A.norm(" | ".join(str(c) for c in cells)):
                out.append("ligne %d : le produit absent a tout de même été écrit" % (ligne["index"] + 1))

    for i, ligne in enumerate(attendues):
        if i >= len(vu["lignes"]):
            break
        cells = [str(c) for c in vu["lignes"][i]]
        joint = " | ".join(cells)
        if A.norm(ligne["product"]) not in A.norm(joint):
            out.append("ligne %d produit : « %s » absent de « %s »" % (i + 1, ligne["product"], joint[:70]))
        if ligne["lotNumber"] and ligne["lotNumber"] not in joint:
            out.append("ligne %d lot : « %s » absent" % (i + 1, ligne["lotNumber"]))
        if str(ligne["quantity"]) not in cells:
            out.append("ligne %d quantité : « %s » absente de %r" % (i + 1, ligne["quantity"], cells))
        per = attendu_date(ligne["expiryDate"], erp["perFmt"])
        if per not in joint:
            out.append("ligne %d péremption : attendu « %s », ligne = « %s »" % (i + 1, per, joint[:70]))
    if vu["garde"] not in ("none", "absent"):
        out.append("GARDE-FOU : la réception semble validée (%s)" % vu["garde"])
    return out


with sync_playwright() as pw:
    kw = {"headless": True, "args": ["--no-sandbox"]}
    if pathlib.Path("/opt/pw-browsers/chromium").exists():
        kw["executable_path"] = "/opt/pw-browsers/chromium"
    try:
        navigateur = pw.chromium.launch(**kw)
    except Exception:
        kw.pop("executable_path", None)
        navigateur = pw.chromium.launch(channel="msedge", **kw)

    for erp in ERPS:
        print("=" * 78)
        print("ERP %s" % erp["nom"])
        print("=" * 78)
        for bon in BONS:
            page = navigateur.new_page(viewport={"width": 1500, "height": 1000})
            page.goto(erp["url"], wait_until="domcontentloaded", timeout=60000)
            try:
                page.wait_for_load_state("networkidle", timeout=4000)
            except Exception:
                pass
            filler = A.Filler(page)
            survey = filler.survey()
            try:
                filler.fill_header(bon["header"], survey)
                resultats = filler.fill_lines(bon["lines"], survey)
            except Exception as e:
                resultats = []
                print("  %-36s PLANTAGE : %s" % (bon["nom"], str(e)[:70]))
                ecarts.append((erp["nom"], bon["nom"], ["plantage : %s" % str(e)[:120]]))
                page.close()
                continue
            vu = lire_pages(page, erp)
            diff = compare(erp, bon, vu, resultats)
            refus = [r.get("message") for r in resultats if not r.get("ok")]
            etat = "OK " if not diff else "ECART"
            print("  [%s] %-36s %d ligne(s) écrite(s)%s"
                  % (etat, bon["nom"], len(vu["lignes"]),
                     (" — refus : " + "; ".join(str(m)[:60] for m in refus if m)) if refus else ""))
            for d in diff:
                print("          · %s" % d)
            if diff:
                ecarts.append((erp["nom"], bon["nom"], diff))
            page.close()
        print()

    navigateur.close()

print("=" * 78)
if not ecarts:
    print("RESULTAT : les 3 ERP x %d bons concordent avec le bon de livraison." % len(BONS))
else:
    print("RESULTAT : %d couple(s) en écart" % len(ecarts))
    for nom_erp, nom_bon, d in ecarts:
        print("  %s / %s : %d écart(s)" % (nom_erp, nom_bon, len(d)))
sys.exit(0 if not ecarts else 1)
