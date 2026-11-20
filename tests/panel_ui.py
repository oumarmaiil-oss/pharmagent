"""Panneau de l'agent dans un vrai navigateur (Playwright) : choix de la fenêtre, démo, alertes macOS."""
import os
import pathlib
import sys
import threading
import time
from concurrent.futures import Future
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _agent import Checker, load_agent  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

A = load_agent()
check = Checker()
A.SYSTEM = "Darwin"
A.mac_accessibility_ok = lambda: False
A.mac_input_monitoring_ok = lambda: False
A.list_windows = lambda: ["Google Chrome", "Numbers"]
asked = []
A.mac_request_permissions = lambda: asked.append(1)

e = A.Engine("http://127.0.0.1:9")
e.api.key = "k"
e.server_ok = True


def submit(name, payload):
    f = Future()
    try:
        f.set_result(e._handle(name, payload))
    except Exception as ex:
        f.set_exception(ex)
    return f


e.submit = submit
A.Panel.engine = e
srv = ThreadingHTTPServer(("127.0.0.1", 0), A.Panel)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}/"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get("PW_CHROMIUM") or None)
    page = browser.new_page(viewport={"width": 900, "height": 900})
    errors = []
    page.on("pageerror", lambda x: errors.append(str(x)))
    page.on("dialog", lambda d: (errors.append("alerte : " + d.message), d.dismiss()))
    page.goto(url)
    page.wait_for_selector("text=Où se trouve l'ERP")
    page.click("text=Logiciel installé ou autre")
    page.wait_for_selector("#win")
    check("alerte macOS avec bouton d'autorisation", "Autoriser sur ce Mac" in page.inner_text("#app"))
    options = page.eval_on_selector_all("#win option", "o => o.map(x => x.textContent)")
    check("liste : choix obligatoire, sans Finder", options[0].startswith("— Choisissez") and "Numbers" in options and "Finder" not in options, options)
    page.select_option("#win", "Numbers")
    time.sleep(2.5)
    check("choix conservé malgré l'actualisation du panneau", page.input_value("#win") == "Numbers")
    page.click("text=Continuer")
    page.wait_for_selector("text=Démonstration (une seule fois)", timeout=5000)
    check("Continuer => démonstration, fenêtre surveillée affichée", "Fenêtre surveillée : Numbers" in page.inner_text("#app"))
    page.click("text=Autoriser sur ce Mac")
    time.sleep(1)
    check("bouton d'autorisation transmis à l'agent", asked == [1])

    e.recording = {"phase": "header", "mode": "desktop", "events": [], "started": time.time()}
    e.key_recorder = A.KeyRecorder("Numbers")
    e.key_recorder.fg_ok, e.key_recorder.fg_title = False, "Safari"
    page.wait_for_selector("text=vos touches sont ignorées", timeout=5000)
    check("alerte : mauvaise fenêtre au premier plan", True)
    e.key_recorder.fg_ok, e.key_recorder.fg_title, e.key_recorder.buf = True, "Numbers", "UBIPHARM"
    page.wait_for_selector("text=Fenêtre active : Numbers", timeout=5000)
    check("compteur et saisie visibles pendant la démo", "Actions vues : 1" in page.inner_text("#app") and "UBIPHARM" in page.inner_text("#app"))
    check("aucune erreur JavaScript", not errors, errors)
    browser.close()
srv.shutdown()
check.exit()
