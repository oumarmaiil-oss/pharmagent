#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test réel : l'agent remplit-il l'ERP en ligne sans toucher à Valider ?"""
import json
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent / "agent"))
import pharmagent_agent as A  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ERP = sys.argv[1] if len(sys.argv) > 1 else "https://oumarmaiil-oss.github.io/ERP/"

TASK = {
    "header": {
        "supplier": "UBIPHARM SENEGAL",
        "documentNumber": "BL-UBI-2026-0042",
        "documentDate": "2026-11-20",
        "totalAmount": 185000,
    },
    "lines": [
        {"index": 0, "product": "DOLIPRANE 1000MG CPR B/8", "designation": "DOLIPRANE 1000MG CPR B/8",
         "quantity": 20, "lotNumber": "LOT-A7731", "expiryDate": "2028-04-30", "purchasePrice": 1250},
        {"index": 1, "product": "AMOXICILLINE 500MG GELULE B/12", "designation": "AMOXICILLINE 500MG GELULE B/12",
         "quantity": 15, "lotNumber": "LOT-B2290", "expiryDate": "2027-09-30", "purchasePrice": 2100},
        {"index": 2, "product": "EFFERALGAN 500MG B/16", "designation": "EFFERALGAN 500MG B/16",
         "quantity": 30, "lotNumber": "LOT-C5512", "expiryDate": "2029-01-31", "purchasePrice": 900},
    ],
}

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path="/opt/pw-browsers/chromium",
                                 args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(ERP, wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_load_state("networkidle", timeout=6000)
    except Exception:
        pass

    filler = A.Filler(page)
    survey = filler.survey()
    print("URL           :", survey["url"])
    print("Champs en-tête:", [f["label"] or f["name"] for f in survey["header"]])
    print("Tableau lignes:", survey["hasLineTable"], "— lignes présentes :", len(survey["rows"]))
    print("Boutons       :", [(b["text"][:28], "INTERDIT" if b["forbidden"] else "ok") for b in survey["buttons"]])
    print()

    mapped = A.assign(survey["header"], A.HEADER_VOCAB)
    print("Mapping en-tête :", {k: v["label"] or v["name"] for k, v in mapped.items()})

    filler.fill_header(TASK["header"], survey)
    results = filler.fill_lines(TASK["lines"])
    print()
    print("Résultats lignes :", json.dumps(results, ensure_ascii=False))
    print("Champs remplis   :", filler.filled)
    print()

    # ── Vérification : ce qui est réellement dans la page ──
    got = page.evaluate("""() => {
      const v = (s) => { const e = document.querySelector(s); return e ? e.value : null; };
      const rows = [...document.querySelectorAll('#lines-body tr')].map(tr =>
        [...tr.querySelectorAll('input')].map(i => i.value));
      return {
        fournisseur: v('#fournisseur'), reference_bl: v('#reference_bl'), date_reception: v('#date_reception'),
        rows: rows,
        successVisible: !!document.querySelector('.success-panel.show, #success-panel.show'),
        successDisplay: getComputedStyle(document.querySelector('#success-panel')).display,
      };
    }""")
    print("DANS LA PAGE :")
    print(json.dumps(got, indent=2, ensure_ascii=False))

    page.screenshot(path="/tmp/erp_rempli.png", full_page=True)

    # ── Contrôles ──
    ok = True
    checks = [
        ("Fournisseur", got["fournisseur"], "UBIPHARM SENEGAL"),
        ("Référence BL", got["reference_bl"], "BL-UBI-2026-0042"),
        ("Date réception", got["date_reception"], "20/11/2026"),
    ]
    for name, actual, expected in checks:
        good = actual == expected
        ok &= good
        print(("  OK  " if good else " ÉCHEC") + " %-16s attendu %-20r obtenu %r" % (name, expected, actual))

    expected_rows = [
        ["DOLIPRANE 1000MG CPR B/8", "LOT-A7731", "20", "1250", "04/2028"],
        ["AMOXICILLINE 500MG GELULE B/12", "LOT-B2290", "15", "2100", "09/2027"],
        ["EFFERALGAN 500MG B/16", "LOT-C5512", "30", "900", "01/2029"],
    ]
    for i, exp in enumerate(expected_rows):
        actual = got["rows"][i] if i < len(got["rows"]) else None
        good = actual == exp
        ok &= good
        print(("  OK  " if good else " ÉCHEC") + " ligne %d  attendu %r" % (i + 1, exp))
        if not good:
            print("          obtenu  %r" % (actual,))

    guard = got["successDisplay"] == "none"
    ok &= guard
    print(("  OK  " if guard else " ÉCHEC") + " GARDE-FOU : la réception n'a PAS été validée")

    browser.close()
    print()
    print("RESULTAT :", "TOUT PASSE" if ok else "IL RESTE DES ECHECS")
    sys.exit(0 if ok else 1)
