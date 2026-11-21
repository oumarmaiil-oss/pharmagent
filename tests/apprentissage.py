#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L'agent apprend les champs qu'aucun vocabulaire ne peut reconnaître.

Certains ERP ont des colonnes muettes : pas d'intitulé, pas d'indication, un
nom technique qui ne veut rien dire. Le vocabulaire ne peut rien pour elles.
L'agent doit alors deviner d'après la forme du champ, écrire, relire — et, si
l'ERP a bien repris la valeur, retenir l'association pour la fois suivante.
"""
import os
import pathlib
import sys
import tempfile

# À poser avant l'import : l'agent calcule son dossier au chargement du module.
os.environ["PHARMAGENT_HOME"] = tempfile.mkdtemp(prefix="pharmagent-appris-")
os.environ["PHARMAGENT_HEADLESS"] = "1"
if pathlib.Path("/opt/pw-browsers/chromium").exists():
    os.environ["PHARMAGENT_CHROMIUM_PATH"] = "/opt/pw-browsers/chromium"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "agent"))
import pharmagent_agent as A  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ERP = (pathlib.Path(__file__).resolve().parent / "erps" / "erp-d.html").as_uri()
HEADER = {"supplier": "UBIPHARM SENEGAL", "documentNumber": "BL-APP-001", "documentDate": "2026-11-21"}
LIGNES = [{"index": 0, "product": "COTRIMOXAZOLE 480MG CP B/20", "quantity": 30,
           "lotNumber": "LOT-APP-01", "expiryDate": "2028-08-31", "purchasePrice": 650}]

fails = []


def check(label, ok, detail=""):
    print(("  OK   " if ok else " ECHEC ") + label + (("  — " + str(detail)[:120]) if detail else ""))
    if not ok:
        fails.append(label)


def ouvrir(pw):
    kw = {"headless": True, "args": ["--no-sandbox"]}
    if pathlib.Path("/opt/pw-browsers/chromium").exists():
        kw["executable_path"] = "/opt/pw-browsers/chromium"
    try:
        b = pw.chromium.launch(**kw)
    except Exception:
        kw.pop("executable_path", None)
        b = pw.chromium.launch(channel="msedge", **kw)
    page = b.new_page(viewport={"width": 1400, "height": 900})
    page.goto(ERP, wait_until="domcontentloaded", timeout=60000)
    return b, page


def colonnes(page):
    return page.evaluate("() => [...document.querySelectorAll('#b tr')]"
                         ".map(tr => [...tr.querySelectorAll('input')].map(i => i.value))")


with sync_playwright() as pw:
    # ── 1. Le vocabulaire seul ne peut pas placer la colonne muette ──
    browser, page = ouvrir(pw)
    f0 = A.Filler(page)
    sv = f0.survey()
    f0.fill_header(HEADER, sv)
    rang = f0.ensure_row(0)
    for i, c in enumerate(rang or []):
        c["col"] = i
    seul_vocab = A.assign(rang or [], A.LINE_VOCAB)
    check("le vocabulaire ne reconnaît pas la colonne muette",
          "expiryDate" not in seul_vocab, sorted(seul_vocab))
    check("il reconnaît bien les quatre autres",
          {"designation", "lotNumber", "quantity", "purchasePrice"} <= set(seul_vocab),
          sorted(seul_vocab))
    browser.close()

    # ── 2. Première saisie : l'agent devine, écrit, relit, et retient ──
    browser, page = ouvrir(pw)
    f1 = A.Filler(page)
    sv = f1.survey()
    f1.fill_header(HEADER, sv)
    f1.fill_lines(LIGNES, sv)
    vu = colonnes(page)
    check("la colonne muette a bien été remplie", bool(vu) and vu[0][4] == "2028-08", vu)
    appris = f1.nouveau["line"]
    check("l'agent a retenu quelque chose", bool(appris), appris)
    check("il a retenu où se saisit la péremption", "expiryDate" in appris, appris)
    check("il repère la colonne par son rang, faute d'intitulé",
          str(appris.get("expiryDate", "")).startswith("#colonne-"), appris)
    check("GARDE-FOU : rien n'a été validé",
          page.evaluate("() => !!document.querySelector('#val')"))
    memoire = {"apprisLine": dict(appris), "apprisHeader": dict(f1.nouveau["header"])}
    browser.close()

    # ── 3. Deuxième saisie : il sait déjà, sans deviner ──
    browser, page = ouvrir(pw)
    f2 = A.Filler(page, overrides=memoire)
    sv = f2.survey()
    f2.fill_header(HEADER, sv)
    f2.fill_lines(LIGNES, sv)
    vu = colonnes(page)
    check("la colonne muette est remplie dès la première tentative",
          bool(vu) and vu[0][4] == "2028-08", vu)
    check("plus rien de nouveau à apprendre : il savait déjà",
          not f2.nouveau["line"], f2.nouveau["line"])
    browser.close()

    # ── 4. Le pharmacien garde le dernier mot ──
    browser, page = ouvrir(pw)
    correction = dict(memoire)
    correction["line"] = {"expiryDate": ""}      # « cette colonne n'existe pas »
    f3 = A.Filler(page, overrides=correction)
    sv = f3.survey()
    f3.fill_header(HEADER, sv)
    f3.fill_lines(LIGNES, sv)
    vu = colonnes(page)
    check("la correction du pharmacien l'emporte sur ce qui a été appris",
          bool(vu) and vu[0][4] == "", vu)
    browser.close()

# ── 5. L'apprentissage survit-il a l'arret de l'agent ? ──
# On rejoue le cycle complet par le moteur, pas par le Filler : c'est lui qui
# ecrit la memoire sur le disque et la relit au demarrage suivant.
print()
print("Et apres un redemarrage de l'agent :")
import json  # noqa: E402

cle = A.map_key(ERP)
moteur = A.Engine("http://127.0.0.1:9")
moteur.erp_url = ERP
moteur.mappings.setdefault(cle, {}).setdefault("apprisLine", {})["expiryDate"] = "#colonne-4"
moteur._persist()
moteur.browser.close()

fichier = A.CONFIG_PATH
check("la mémoire est bien écrite sur le disque", fichier.exists(), str(fichier))
if fichier.exists():
    disque = json.loads(fichier.read_text(encoding="utf-8"))
    retenu = ((disque.get("mappings") or {}).get(cle) or {}).get("apprisLine") or {}
    check("elle contient la colonne apprise", retenu.get("expiryDate") == "#colonne-4", retenu)

relance = A.Engine("http://127.0.0.1:9")   # comme si l'agent venait de redemarrer
relu = ((relance.mappings.get(cle) or {}).get("apprisLine") or {})
check("l'agent la retrouve au démarrage suivant", relu.get("expiryDate") == "#colonne-4", relu)
relance.browser.close()

print()
print("RESULTAT :", "TOUT PASSE" if not fails else "IL RESTE %d ECHEC(S) : %s" % (len(fails), ", ".join(fails)))
sys.exit(0 if not fails else 1)
