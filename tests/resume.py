#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reprise d'une saisie interrompue.

Scénario de l'officine : l'agent saisit 2 lignes sur 4, puis le navigateur
meurt. Le pharmacien renvoie le bon. L'agent doit reconnaître les 2 lignes
déjà là et n'ajouter que les 2 manquantes — ni tout refuser, ni tout doubler.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "agent"))
import pharmagent_agent as A  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ERP = (pathlib.Path(__file__).resolve().parent / "mock-erp" / "mock-erp.html").as_uri()

HEADER = {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-REPRISE-001",
          "documentDate": "2026-11-21"}
LINES = [
    {"index": 0, "product": "COTRIMOXAZOLE 480MG CP B/20", "designation": "COTRIMOXAZOLE 480MG CP B/20",
     "quantity": 30, "lotNumber": "LOT-CTX-2611", "expiryDate": "2028-08-31", "purchasePrice": 650},
    {"index": 1, "product": "QUININE 500MG CP B/20", "designation": "QUININE 500MG CP B/20",
     "quantity": 25, "lotNumber": "LOT-QNI-2613", "expiryDate": "2027-11-30", "purchasePrice": 1800},
    {"index": 2, "product": "ARTESUNATE 100MG CP B/12", "designation": "ARTESUNATE 100MG CP B/12",
     "quantity": 40, "lotNumber": "LOT-ART-2614", "expiryDate": "2028-06-30", "purchasePrice": 3200},
    {"index": 3, "product": "FER SULFATE 200MG CP B/30", "designation": "FER SULFATE 200MG CP B/30",
     "quantity": 45, "lotNumber": "LOT-FER-2620", "expiryDate": "2028-05-31", "purchasePrice": 720},
]

fails = []


def check(label, ok, detail=""):
    print(("  OK   " if ok else " ECHEC ") + label + (("  — " + str(detail)) if detail else ""))
    if not ok:
        fails.append(label)


def open_erp(pw):
    kw = {"headless": True, "args": ["--no-sandbox"]}
    if pathlib.Path("/opt/pw-browsers/chromium").exists():
        kw["executable_path"] = "/opt/pw-browsers/chromium"
    try:
        b = pw.chromium.launch(**kw)
    except Exception:
        kw.pop("executable_path", None)
        b = pw.chromium.launch(channel="msedge", **kw)
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(ERP, wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_load_state("networkidle", timeout=6000)
    except Exception:
        pass
    return b, page


def row_count(page):
    return page.evaluate("() => document.querySelectorAll('#lines-body tr').length")


with sync_playwright() as pw:
    browser, page = open_erp(pw)
    filler = A.Filler(page)
    survey = filler.survey()

    # ── 1. Écran vierge : rien n'est déjà saisi ──
    check("ecran vierge : aucune ligne reconnue comme deja saisie",
          A.lines_already_done(survey, LINES) == set())

    # ── 2. Saisie interrompue : seules les 2 premieres lignes passent ──
    filler.fill_header(HEADER, survey)
    filler.fill_lines(LINES[:2], survey)
    check("2 lignes saisies avant l'interruption", row_count(page) == 2, row_count(page))

    # ── 3. Le pharmacien renvoie le bon : l'agent doit reconnaitre les 2 ──
    survey2 = filler.survey()
    done = A.lines_already_done(survey2, LINES)
    check("les 2 lignes deja saisies sont reconnues", done == {0, 1}, sorted(done))
    check("l'en-tete est reconnu comme deja saisi", A.already_entered(survey2, HEADER))

    # ── 4. Seules les lignes manquantes sont ajoutees ──
    remaining = [l for i, l in enumerate(LINES) if i not in done]
    check("2 lignes restent a saisir", len(remaining) == 2, len(remaining))
    filler.fill_lines(remaining, survey2)
    check("le bon compte 4 lignes, sans doublon", row_count(page) == 4, row_count(page))

    produits = page.evaluate(
        "() => [...document.querySelectorAll('#lines-body tr')]"
        ".map(tr => (tr.querySelector('input') || {}).value || tr.cells[0].textContent.trim())")
    check("les 4 produits sont distincts", len(set(produits)) == 4, produits)

    # ── 5. Bon entierement saisi : tout est reconnu, rien a ajouter ──
    survey3 = filler.survey()
    done3 = A.lines_already_done(survey3, LINES)
    check("bon complet : les 4 lignes sont reconnues", done3 == {0, 1, 2, 3}, sorted(done3))

    # ── 6. Le garde-fou tient ──
    guard = page.evaluate("() => getComputedStyle(document.querySelector('#success-panel')).display")
    check("GARDE-FOU : la reception n'a PAS ete validee", guard == "none", guard)

    # ── 7. Un autre bon sur le meme ecran n'est pas confondu ──
    autres = [dict(l, lotNumber="LOT-AUTRE-%d" % i,
                   product="ALBENDAZOLE 400MG CP", designation="ALBENDAZOLE 400MG CP")
              for i, l in enumerate(LINES[:1])]
    check("un produit different n'est pas pris pour un deja saisi",
          A.lines_already_done(survey3, autres) == set())

    browser.close()

print()
print("RESULTAT :", "TOUT PASSE" if not fails else "IL RESTE %d ECHEC(S) : %s" % (len(fails), ", ".join(fails)))
sys.exit(0 if not fails else 1)
