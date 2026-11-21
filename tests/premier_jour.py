#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Le parcours du premier jour, vu par le pharmacien.

Il ouvre le panneau, seul. Il doit comprendre où il en est, ce qu'on attend de
lui maintenant, et voir le chemin disparaître quand tout est en place.
"""
import os
import pathlib
import sys
import tempfile

os.environ["PHARMAGENT_HOME"] = tempfile.mkdtemp(prefix="pharmagent-jour1-")
os.environ["PHARMAGENT_HEADLESS"] = "1"
if pathlib.Path("/opt/pw-browsers/chromium").exists():
    os.environ["PHARMAGENT_CHROMIUM_PATH"] = "/opt/pw-browsers/chromium"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "agent"))
import pharmagent_agent as A  # noqa: E402

fails = []


def check(label, ok, detail=""):
    print(("  OK   " if ok else " ECHEC ") + label + (("  — " + str(detail)[:120]) if detail else ""))
    if not ok:
        fails.append(label)


def actif(e):
    return next((x["cle"] for x in e if x["actif"]), None)


def faits(e):
    return [x["cle"] for x in e if x["fait"]]


moteur = A.Engine("http://127.0.0.1:9")

# ── 1. Tout début : rien n'est fait, on attend l'appairage ──
e = moteur.etapes()
check("cinq étapes sont proposées", len(e) == 5, [x["cle"] for x in e])
check("rien n'est encore fait", faits(e) == [], faits(e))
check("l'étape en cours est l'appairage", actif(e) == "relier", actif(e))
courant = next(x for x in e if x["actif"])
check("elle dit quoi faire, sans jargon", "code" in courant["aide"].lower(), courant["aide"])
check("seule l'étape en cours porte une aide",
      sum(1 for x in e if x["actif"]) == 1, [x["cle"] for x in e if x["actif"]])

# ── 2. Relié : on attend maintenant l'adresse de l'ERP ──
moteur.api.key = "cle-de-test"
e = moteur.etapes()
check("l'appairage est marqué fait", "relier" in faits(e), faits(e))
check("on attend l'adresse de l'ERP", actif(e) == "adresse", actif(e))
courant = next(x for x in e if x["actif"])
check("l'aide dit d'ouvrir l'écran de réception, pas l'accueil",
      "reception" in A.norm(courant["aide"]), courant["aide"])

# ── 3. Adresse donnée : on propose la vérification ──
moteur.erp_url = (pathlib.Path(__file__).resolve().parent.parent / "agent" / "demo-erp.html").as_uri()
e = moteur.etapes()
check("on en est à la vérification de l'ERP", actif(e) == "reconnu", actif(e))
courant = next(x for x in e if x["actif"])
check("elle est annoncée comme facultative",
      "facultatif" in A.norm(courant["aide"]), courant["aide"])

# ── 4. Vérification faite : on propose l'essai à blanc ──
moteur.cfg["erpReconnu"] = True
e = moteur.etapes()
check("on en est à l'essai à blanc", actif(e) == "essai", actif(e))
courant = next(x for x in e if x["actif"])
check("l'essai est annoncé comme sans risque pour le vrai ERP",
      "sans toucher" in A.norm(courant["aide"]) or "exemple" in A.norm(courant["aide"]),
      courant["aide"])

# ── 5. Essai fait : il ne reste qu'à recevoir un bon ──
moteur.cfg["essaiFait"] = True
e = moteur.etapes()
check("il ne reste que le premier bon", actif(e) == "saisie", actif(e))
check("quatre étapes sur cinq sont franchies", len(faits(e)) == 4, faits(e))

# ── 6. Premier bon saisi : le chemin disparaît ──
moteur.last_result = {"status": "done", "message": "3 lignes", "at": "21/11 09:00"}
e = moteur.etapes()
check("tout est franchi", len(faits(e)) == 5, faits(e))
check("plus aucune étape en cours : le bloc s'efface", actif(e) is None, actif(e))

# ── 7. L'état envoyé au panneau porte bien le parcours ──
etat = moteur.state()
check("le panneau reçoit les étapes", isinstance(etat.get("etapes"), list) and len(etat["etapes"]) == 5)

# ── 8. La fiche d'installation existe et dit l'essentiel ──
fiche = pathlib.Path(__file__).resolve().parent.parent / "agent" / "fiche-installation.html"
check("la fiche d'installation est livrée avec l'agent", fiche.exists(), str(fiche))
if fiche.exists():
    texte = fiche.read_text(encoding="utf-8")
    for mot, pourquoi in [("JAMAIS CLIQUÉ", "la promesse doit être montrée au titulaire"),
                          ("Un problème ?", "le bouton d'auto-dépannage doit être expliqué"),
                          ("Valider", "le garde-fou doit être nommé"),
                          ("relire avant de valider", "la responsabilité du pharmacien")]:
        check("la fiche mentionne « %s »" % mot[:28], mot in texte, pourquoi)

moteur.browser.close()
print()
print("RESULTAT :", "TOUT PASSE" if not fails else "IL RESTE %d ECHEC(S) : %s" % (len(fails), ", ".join(fails)))
sys.exit(0 if not fails else 1)
