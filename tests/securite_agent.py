#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Le panneau de l'agent face à un site web malveillant.

L'agent ouvre un service sur le poste du pharmacien. Vérifier que la requête
vient bien de cette machine ne suffit pas : un site peut faire pointer son
propre nom de domaine vers 127.0.0.1 (réassociation DNS). La requête part alors
du navigateur du pharmacien, arrive de 127.0.0.1, et le navigateur la traite
comme de même origine — sans aucune protection.

Ce qui serait en jeu : le journal, l'adresse de l'ERP, le code de support, une
capture d'écran de l'ERP de l'officine, et la possibilité de rebrancher l'agent
sur un faux ERP.
"""
import http.client
import os
import pathlib
import sys
import tempfile
import threading
import time

os.environ["PHARMAGENT_HOME"] = tempfile.mkdtemp(prefix="pharmagent-secu-")
os.environ["PHARMAGENT_HEADLESS"] = "1"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "agent"))
import pharmagent_agent as A  # noqa: E402

fails = []


def check(label, ok, detail=""):
    print(("  OK   " if ok else " ECHEC ") + label + (("  — " + str(detail)[:110]) if (detail and not ok) else ""))
    if not ok:
        fails.append(label)


moteur = A.Engine("http://127.0.0.1:9")
A.Panel.engine = moteur
from http.server import ThreadingHTTPServer  # noqa: E402

srv = ThreadingHTTPServer(("127.0.0.1", A.PANEL_PORT), A.Panel)
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(0.4)


def appel(methode, chemin, hote=None, origine=None, corps=b""):
    c = http.client.HTTPConnection("127.0.0.1", A.PANEL_PORT, timeout=5)
    entetes = {"Host": hote if hote is not None else "127.0.0.1:%d" % A.PANEL_PORT}
    if origine:
        entetes["Origin"] = origine
    if methode == "POST":
        entetes["X-PharmAgent"] = "1"
        entetes["Content-Type"] = "application/json"
        entetes["Content-Length"] = str(len(corps))
    c.request(methode, chemin, body=corps or None, headers=entetes)
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, data


print("USAGE NORMAL — le pharmacien ouvre son panneau")
code, data = appel("GET", "/api/state")
check("le panneau répond au poste lui-même", code == 200, code)
check("il renvoie bien son état", b'"version"' in data, data[:60])

print()
print("ATTAQUE 1 — réassociation DNS : un site détourne son nom vers 127.0.0.1")
for hote in ["evil.example.com:8765", "pharmagent-support.com:8765", "localhost.evil.com:8765"]:
    code, _ = appel("GET", "/api/state", hote=hote)
    check("lecture de l'état refusée depuis « %s »" % hote[:34], code == 403, "code %s" % code)

code, _ = appel("POST", "/api/support", hote="evil.example.com:8765", corps=b"{}")
check("envoi d'une capture de l'ERP refusé", code == 403, "code %s" % code)
code, _ = appel("POST", "/api/set_url", hote="evil.example.com:8765",
                corps=b'{"erpUrl":"https://faux-erp.example.com"}')
check("rebranchement sur un faux ERP refusé", code == 403, "code %s" % code)
check("l'adresse de l'ERP n'a pas bougé", not moteur.erp_url, moteur.erp_url)

print()
print("ATTAQUE 2 — une page web appelle le panneau en annonçant son origine")
code, _ = appel("GET", "/api/state", origine="https://evil.example.com")
check("requête venant d'une page extérieure refusée", code == 403, "code %s" % code)
code, _ = appel("GET", "/api/state", origine="http://127.0.0.1:%d" % A.PANEL_PORT)
check("requête venant du panneau lui-même acceptée", code == 200, "code %s" % code)

print()
print("ATTAQUE 3 — une valeur piégée dans un bouton « copier »")
# L'apostrophe est ce qui permettait de sortir d'une chaîne JavaScript.
piege = "X'+alert(document.cookie)+'"
echappe = A.PANEL_HTML  # le panneau échappe désormais l'apostrophe
check("le panneau échappe l'apostrophe", "&#39;" in echappe, "non trouvé")
check("plus aucune donnée dans un gestionnaire en ligne",
      "onclick=\"copyText('" not in echappe)
check("les valeurs à copier passent par un attribut", "data-copie=" in echappe)

srv.shutdown()
moteur.browser.close()
print()
print("RESULTAT :", "TOUT PASSE" if not fails else "IL RESTE %d ECHEC(S) : %s" % (len(fails), ", ".join(fails)))
sys.exit(0 if not fails else 1)
