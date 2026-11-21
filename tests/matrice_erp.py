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
     "dateFmt": "%d/%m/%Y", "perFmt": "%m/%Y"},
    {"nom": "B — 10 lignes fixes, sans bouton (FR)", "url": (ICI / "erps" / "erp-b.html").as_uri(),
     "attendus": {"fournisseur": "#f1", "reference": "#f2", "date": "#f3"},
     "lignes": "#corps tr", "garde": None,
     "dateFmt": "%d/%m/%Y", "perFmt": "%m/%y"},
    {"nom": "C — liste de suggestions (EN)", "url": (ICI / "erps" / "erp-c.html").as_uri(),
     "attendus": {"fournisseur": "#sup", "reference": "#dn", "date": "#dt"},
     "lignes": "#tb tr:not(.head)", "garde": None,
     "dateFmt": "%Y-%m-%d", "perFmt": "%Y-%m"},
]

BONS = [
    {"nom": "bon simple, 3 produits du catalogue",
     "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-M1-001", "documentDate": "2026-11-21"},
     "lines": [
         {"index": 0, "product": "COTRIMOXAZOLE 480MG CP B/20", "quantity": 30,
          "lotNumber": "LOT-CTX-01", "expiryDate": "2028-08-31", "purchasePrice": 650},
         {"index": 1, "product": "QUININE 500MG CP B/20", "quantity": 25,
          "lotNumber": "LOT-QNI-02", "expiryDate": "2027-11-30", "purchasePrice": 1800},
         {"index": 2, "product": "FER SULFATE 200MG CP B/30", "quantity": 45,
          "lotNumber": "LOT-FER-03", "expiryDate": "2028-05-31", "purchasePrice": 720},
     ]},
    {"nom": "même produit deux fois, deux lots",
     "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-M2-002", "documentDate": "2026-11-21"},
     "lines": [
         {"index": 0, "product": "ALBENDAZOLE 400MG CP", "quantity": 20,
          "lotNumber": "LOT-ALB-AA", "expiryDate": "2028-10-31", "purchasePrice": 490},
         {"index": 1, "product": "ALBENDAZOLE 400MG CP", "quantity": 15,
          "lotNumber": "LOT-ALB-BB", "expiryDate": "2029-02-28", "purchasePrice": 490},
     ]},
    {"nom": "un produit sans lot",
     "header": {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-M3-003", "documentDate": "2026-11-21"},
     "lines": [
         {"index": 0, "product": "PARACETAMOL 250MG SUPP B/10", "quantity": 60,
          "lotNumber": "", "expiryDate": "2029-01-31", "purchasePrice": 420},
     ]},
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


def compare(erp, bon, vu):
    """Confronte case par case. Renvoie la liste des écarts."""
    out = []
    h = bon["header"]
    if (vu["fournisseur"] or "") != h["supplier"]:
        out.append("fournisseur : attendu « %s », trouvé « %s »" % (h["supplier"], vu["fournisseur"]))
    if (vu["reference"] or "") != h["documentNumber"]:
        out.append("référence : attendu « %s », trouvé « %s »" % (h["documentNumber"], vu["reference"]))
    d = attendu_date(h["documentDate"], erp["dateFmt"])
    if (vu["date"] or "") != d:
        out.append("date : attendu « %s », trouvé « %s »" % (d, vu["date"]))

    if len(vu["lignes"]) != len(bon["lines"]):
        out.append("nombre de lignes : attendu %d, trouvé %d" % (len(bon["lines"]), len(vu["lignes"])))
    for i, ligne in enumerate(bon["lines"]):
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
            diff = compare(erp, bon, vu)
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
