"""Interface web réelle (Playwright) : connexion Pharmacie (Pharmacien / Équipe) et Superviseur, onglets visibles, comptes.
Prérequis : npm run build."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _agent import ROOT, Checker  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = int(os.environ.get("WEB_UI_PORT", "4078"))
B = f"http://127.0.0.1:{PORT}"
SHOTS = os.environ.get("SHOTS")
check = Checker()
env = {**os.environ, "DATA_DIR": tempfile.mkdtemp(), "PORT": str(PORT), "NODE_ENV": "production",
       "PHARMAGENT_OWNER_PASSWORD": "ownerpw", "PHARMAGENT_PHARMACY_DEFAULT_PASSWORD": "phpw"}
for k in ("ANTHROPIC_API_KEY", "DATABASE_URL"):
    env.pop(k, None)
srv = subprocess.Popen(["npx", "tsx", "server.ts"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


def api(path, body, token=None):
    headers = {"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})}
    req = urllib.request.Request(B + path, data=json.dumps(body).encode(), headers=headers, method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def nav(page):
    return page.eval_on_selector_all("aside nav button", "b => b.map(x => x.innerText.trim())")


try:
    for _ in range(60):
        try:
            urllib.request.urlopen(B + "/api/health", timeout=2)
            break
        except Exception:
            time.sleep(1)
    owner = api("/api/owner/auth/login", {"loginId": "dr.oumar", "password": "ownerpw"})["token"]
    cred = api("/api/pharmacies", {"name": "Pharmacie Test UI", "city": "Dakar", "pharmacist": "Dr Ndiaye", "targetSoftware": "ERP Officine Intégré"}, owner)["credentials"]

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get("PW_CHROMIUM") or None)
        errors = []

        def new_page(width=1200, height=900):
            p = browser.new_page(viewport={"width": width, "height": height})
            p.on("pageerror", lambda x: errors.append(str(x)))
            p.on("dialog", lambda d: d.accept())
            return p

        def login(page, identifiant, password):
            page.goto(B)
            page.fill("input[autocomplete='username']", identifiant)
            page.fill("input[type='password']", password)
            page.click("button[type='submit']")

        def login_pharmacy(page, _profile, password):
            login(page, cred["code"].lower(), password)

        def wait_text(page, text, timeout=15):
            end = time.time() + timeout
            while time.time() < end:
                if text in page.inner_text("body"):
                    return True
                time.sleep(0.2)
            return False

        # Écran de connexion sur téléphone
        m = new_page(390, 844)
        m.goto(B)
        m.wait_for_selector("input[autocomplete='username']")
        check("connexion : un seul formulaire Identifiant + Mot de passe, sans onglets", m.locator("input[autocomplete='username']").count() == 1 and "Superviseur" not in m.inner_text("form"))
        m.fill("input[autocomplete='username']", "abcXYZ")
        check("l'identifiant garde ce qui est tapé (pas de majuscules forcées)", m.input_value("input[autocomplete='username']") == "abcXYZ")
        if SHOTS:
            m.screenshot(path=f"{SHOTS}/login_mobile.png")
        m.close()

        # Pharmacien
        p = new_page()
        login_pharmacy(p, "Pharmacien", cred["password"])
        p.wait_for_selector("aside >> text=Mutuelle")
        tabs = nav(p)
        check("Pharmacien : Bons, Mutuelle, Commande, Autre, Agent local, Mon compte, Guide", tabs == ["Bons", "Mutuelle", "Commande", "Autre", "Agent local", "Mon compte", "Guide"], tabs)
        check("nom et pharmacie affichés", "Dr Ndiaye" in p.inner_text("aside") and "Pharmacie Test UI" in p.inner_text("aside"))
        p.click("aside >> text=Mon compte")
        p.wait_for_selector("text=Code de connexion de la pharmacie")
        check("Mon compte : code affiché", cred["code"] in p.inner_text("main"))
        p.click("text=Créer le compte Équipe")
        p.wait_for_selector("text=Mot de passe du compte Équipe")
        team_pw = p.inner_text("main .mono.font-bold.tracking-wider").strip()
        check("mot de passe Équipe affiché une fois", len(team_pw) == 8, team_pw)
        check("bouton devenu « Réinitialiser »", p.is_visible("text=Réinitialiser le mot de passe Équipe"))
        p.click("aside >> text=Bons")
        p.wait_for_selector("text=Analyser un document")
        check("poste pharmacien accessible", True)
        p.close()

        # Équipe
        t = new_page()
        login_pharmacy(t, "Équipe", team_pw)
        t.wait_for_selector("aside >> text=Mutuelle")
        tabs = nav(t)
        check("Équipe : mêmes onglets sans Agent local", tabs == ["Bons", "Mutuelle", "Commande", "Autre", "Mon compte", "Guide"], tabs)
        t.click("aside >> text=Mon compte")
        t.wait_for_selector("text=Changer mon mot de passe")
        check("Équipe : pas de gestion du compte Équipe", "Compte Équipe (facultatif)" not in t.inner_text("main"))
        t.close()

        # Superviseur
        o = new_page()
        login(o, "Dr.Oumar", "ownerpw")
        o.wait_for_selector("aside >> text=Tableau de bord")
        check("Superviseur : 4 entrées seulement", nav(o) == ["Tableau de bord", "Officines", "Administration", "Guide"], nav(o))
        o.click("aside >> text=Officines")
        o.click("text=Nouvelle officine")
        o.fill("input[placeholder='Pharmacie du Centre']", "Pharmacie Créée UI")
        o.fill("input[placeholder='Dr. Nom Prénom']", "Dr Sow")
        o.fill("input[placeholder='Dakar'] >> nth=0", "Dakar")
        o.click("button:has-text('Créer')")
        o.wait_for_selector("text=Connexion de Pharmacie Créée UI")
        check("création : code et mot de passe affichés dans une fenêtre", o.is_visible("[data-testid=cred-password]"))
        o.click("button:has-text(\"J'ai noté\")")
        # Réinitialisation depuis la fiche (en bas de page) : la fenêtre doit apparaître quand même, au centre
        o.click("text=Pharmacie Créée UI")
        o.wait_for_selector("text=Toutes les officines")
        check("on entre dans l'officine : Bons, Mutuelle, Commande, Autre, Agent, Fiche", all(o.is_visible(f"main button:has-text('{t}')") for t in ("Bons", "Mutuelle", "Commande", "Autre", "Agent", "Fiche")))
        check("plus de « Facture fournisseur »", "Facture fournisseur" not in o.inner_text("main"))
        o.click("main button:has-text('Autre')")
        check("« Autre » ouvre le remplissage d'un tableau", o.is_visible("text=Tableau à remplir"))
        o.click("main button:has-text('Fiche')")
        o.click("button:has-text('Nouveau mot de passe Pharmacien')")
        o.wait_for_selector("text=Votre mot de passe superviseur")
        check("réinitialisation : confirmation par le mot de passe superviseur demandée", o.is_disabled("button:has-text('Confirmer')"))
        o.fill("[role=dialog] input[type='password']", "ownerpw")
        o.click("button:has-text('Confirmer')")
        o.wait_for_selector("[data-testid=cred-password]")
        box = o.locator("[data-testid=cred-password]").bounding_box()
        check("réinitialisation : mot de passe visible à l'écran sans défiler", box is not None and 0 <= box["y"] <= 900, box)
        code, pw = o.inner_text("[data-testid=cred-code]").strip(), o.inner_text("[data-testid=cred-password]").strip()
        o.close()
        q = new_page(390, 844)
        login(q, code.lower(), pw.lower())
        check("connexion avec l'identifiant et le mot de passe affichés (tapés en minuscules, sur téléphone)", wait_text(q, "Pharmacie Créée UI"))
        q.close()

        check("aucune erreur JavaScript", not errors, errors)
        browser.close()
finally:
    srv.terminate()
check.exit()
