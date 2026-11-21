#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mode essai : montrer l'agent au pharmacien sans brancher son vrai ERP.

On vérifie qu'il remplit bien l'ERP d'exemple, qu'il ne touche à rien d'autre,
et surtout qu'il ne valide pas la réception de démonstration non plus.
"""
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

os.environ["PHARMAGENT_HOME"] = tempfile.mkdtemp(prefix="pharmagent-demo-")
os.environ["PHARMAGENT_HEADLESS"] = "1"
if pathlib.Path("/opt/pw-browsers/chromium").exists():
    os.environ["PHARMAGENT_CHROMIUM_PATH"] = "/opt/pw-browsers/chromium"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "agent"))
import pharmagent_agent as A  # noqa: E402

fails = []


def check(label, ok, detail=""):
    print(("  OK   " if ok else " ECHEC ") + label + (("  — " + str(detail)[:130]) if detail else ""))
    if not ok:
        fails.append(label)


with socket.socket() as sk:
    sk.bind(("127.0.0.1", 0))
    PORT = sk.getsockname()[1]
serveur = subprocess.Popen(
    [sys.executable, str(pathlib.Path(__file__).resolve().parent / "fake_server.py"),
     "--port", str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(30):
    try:
        urllib.request.urlopen("http://127.0.0.1:%d/ci/state" % PORT, timeout=1).read()
        break
    except Exception:
        time.sleep(0.5)

try:
    engine = A.Engine("http://127.0.0.1:%d" % PORT)
    engine.api.server = "http://127.0.0.1:%d" % PORT
    # Aucune adresse d'ERP reglee : la demonstration doit marcher quand meme,
    # c'est tout l'interet avant une installation.
    engine.erp_url = ""

    r = engine._demo()
    print(r["message"])
    print()
    check("les 3 lignes d'exemple sont saisies", r["lignes"] == 3, r["lignes"])
    check("le bouton de validation est repere comme jamais clique",
          any("valider" in t.lower() for t in r["jamaisClique"]), r["jamaisClique"])

    page = engine.browser.ctx.pages[0]
    vu = page.evaluate("""() => ({
        fournisseur: (document.querySelector('#fournisseur')||{}).value,
        reference:   (document.querySelector('#reference_bl')||{}).value,
        lignes: [...document.querySelectorAll('#lines-body tr')].length,
        valide: getComputedStyle(document.querySelector('#success-panel')).display,
    })""")
    check("le fournisseur d'exemple est ecrit", vu["fournisseur"] == "UBIPHARM SENEGAL", vu["fournisseur"])
    check("la reference d'exemple est ecrite", vu["reference"] == "BL-DEMO-001", vu["reference"])
    check("l'ERP d'exemple compte 3 lignes", vu["lignes"] == 3, vu["lignes"])
    check("GARDE-FOU : la demonstration non plus n'est pas validee", vu["valide"] == "none", vu["valide"])

    etat = urllib.request.urlopen("http://127.0.0.1:%d/ci/state" % PORT, timeout=5).read().decode()
    check("rien n'a ete envoye au serveur pendant la demonstration",
          '"result": null' in etat or '"result":null' in etat, etat[:120])

    engine.browser.close()
finally:
    serveur.terminate()

print()
print("RESULTAT :", "TOUT PASSE" if not fails else "IL RESTE %d ECHEC(S) : %s" % (len(fails), ", ".join(fails)))
sys.exit(0 if not fails else 1)
