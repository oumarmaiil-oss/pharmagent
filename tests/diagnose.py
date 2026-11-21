#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""La boîte « Un problème ? » : l'agent se relit et se répare seul.

Chaque scénario est une panne vue en vrai. On vérifie que l'agent la nomme,
qu'il répare ce qui est sans risque, et qu'il ne prétend pas avoir réparé
ce qu'il n'a pas réparé.
"""
import os
import pathlib
import sys
import tempfile

HOME = tempfile.mkdtemp(prefix="pharmagent-diag-")
os.environ["PHARMAGENT_HOME"] = HOME
os.environ["PHARMAGENT_HEADLESS"] = "1"
if pathlib.Path("/opt/pw-browsers/chromium").exists():
    os.environ["PHARMAGENT_CHROMIUM_PATH"] = "/opt/pw-browsers/chromium"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "agent"))
import pharmagent_agent as A  # noqa: E402

FIXTURES = pathlib.Path(os.environ.get("PHARMAGENT_FIXTURES", "")) if os.environ.get("PHARMAGENT_FIXTURES") else None
ERP = (pathlib.Path(__file__).resolve().parent.parent / "agent" / "demo-erp.html").as_uri()

fails = []


def check(label, ok, detail=""):
    print(("  OK   " if ok else " ECHEC ") + label + (("  — " + str(detail)[:120]) if detail else ""))
    if not ok:
        fails.append(label)


def titres(d):
    return [c["titre"] for c in d["constats"]]


def trouve(d, fragment):
    return next((c for c in d["constats"] if fragment.lower() in c["titre"].lower()), None)


# Un vrai faux serveur, pour que « liaison en ordre » veuille dire quelque chose.
import socket  # noqa: E402
import subprocess  # noqa: E402
import time  # noqa: E402
import urllib.request  # noqa: E402

with socket.socket() as sk:
    sk.bind(("127.0.0.1", 0))
    PORT = sk.getsockname()[1]
SERVEUR = subprocess.Popen(
    [sys.executable, str(pathlib.Path(__file__).resolve().parent / "fake_server.py"),
     "--port", str(PORT)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(30):
    try:
        urllib.request.urlopen("http://127.0.0.1:%d/ci/state" % PORT, timeout=1).read()
        break
    except Exception:
        time.sleep(0.5)

engine = A.Engine("http://127.0.0.1:9")   # serveur volontairement injoignable
engine.api.key = "cle-de-test"

print("SCENARIO 1 — aucune adresse d'ERP enregistree")
engine.erp_url = ""
d = engine._diagnose()
c = trouve(d, "Aucune adresse")
check("la cause est nommee", c is not None, titres(d))
inj = trouve(d, "injoignable")
check("le serveur injoignable est detecte pour de bon", inj is not None, titres(d))
check("un geste precis est donne", bool(c and c["geste"]), c and c["geste"])
check("rien n'est pretendu repare", d["repares"] == 0, d["repares"])

print()
print("SCENARIO 2 — l'agent etait en pause (reparable seul)")
engine.erp_url = ERP
engine.paused = True
d = engine._diagnose()
c = trouve(d, "pause")
check("la pause est reperee", c is not None, titres(d))
check("elle est reparee d'office", bool(c and c["repare"]))
check("l'agent n'est plus en pause", engine.paused is False)

print()
print("SCENARIO 3 — ecran de l'ERP normal, serveur joignable, tout va bien")
engine.api.server = "http://127.0.0.1:%d" % PORT
d = engine._diagnose()
check("la liaison est annoncee en ordre", trouve(d, "en ordre") is not None, titres(d))
check("l'ecran est reconnu", trouve(d, "bien reconnu") is not None, titres(d))
g = trouve(d, "garde-fou")
check("le garde-fou est annonce", g is not None, g and g["explication"])
check("« Valider » est nomme comme jamais clique",
      bool(g and "valider" in (g["explication"] or "").lower()), g and g["explication"])
check("aucun point bloquant", d["restants"] == 0, d["restants"])

print()
print("SCENARIO 4 — le pharmacien a ferme la fenetre")
engine.browser.close()
engine.browser.ctx = None
d = engine._diagnose()
c = trouve(d, "fenêtre")
check("la fermeture est reperee", c is not None, titres(d))
check("la fenetre est rouverte d'office", bool(c and c["repare"]))

print()
print("SCENARIO 5 — la derniere saisie s'etait arretee en route")
engine.last_result = {"status": "failed", "at": "21/11 08:00",
                      "message": "Le bouton « Ajouter » n'a pas pu etre clique."}
d = engine._diagnose()
c = trouve(d, "derni")
check("l'echec precedent est rappele", c is not None, titres(d))
check("la reprise est expliquee au pharmacien",
      bool(c and "reprend" in (c["geste"] or "").lower()), c and c["geste"])

print()
print("SCENARIO 6 — ecran de connexion de l'ERP")
if FIXTURES and (FIXTURES / "login.html").exists():
    engine.erp_url = (FIXTURES / "login.html").as_uri()
    engine.browser.close()
    engine.browser.ctx = None
    d = engine._diagnose()
    c = trouve(d, "connexion")
    check("l'ecran de connexion est reconnu", c is not None, titres(d))
    check("l'agent dit qu'il n'ecrira pas",
          bool(c and "jamais" in (c["explication"] or "").lower()), c and c["explication"])
    check("rien n'est pretendu repare sur ce point", not (c and c["repare"]))
else:
    print("  (ignore : fixture login.html absente)")

engine.browser.close()
SERVEUR.terminate()
print()
print("RESULTAT :", "TOUT PASSE" if not fails else "IL RESTE %d ECHEC(S) : %s" % (len(fails), ", ".join(fails)))
sys.exit(0 if not fails else 1)
