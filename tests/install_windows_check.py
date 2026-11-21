#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Contrôle de ce que l'installeur Windows a réellement produit.

À lancer APRÈS install.ps1, sur une vraie machine Windows (ou un runner
windows-latest). Ne vérifie pas le script : vérifie son résultat sur le disque.
"""
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

if sys.platform != "win32":
    print("(ignoré : Windows uniquement)")
    raise SystemExit(0)

APP = pathlib.Path(os.environ["LOCALAPPDATA"]) / "PharmAgent"
PY_EXE = APP / "venv" / "Scripts" / "python.exe"
AGENT = APP / "pharmagent_agent.py"

fails = []


def check(label, ok, detail=""):
    print(("  OK   " if ok else " ECHEC ") + label + (("  — " + detail) if detail else ""))
    if not ok:
        fails.append(label)
    return ok


def shell_folder(name):
    """Bureau et Démarrage, demandés à Windows (ils sont parfois déplacés)."""
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "[Environment]::GetFolderPath('%s')" % name],
        capture_output=True, text=True)
    return pathlib.Path(out.stdout.strip())


print("Dossier de l'agent :", APP)
print()

check("Le dossier de l'agent existe", APP.is_dir(), str(APP))
check("Python a bien été installé", PY_EXE.is_file(), str(PY_EXE))
check("L'agent a bien été téléchargé", AGENT.is_file() and AGENT.stat().st_size > 10000,
      "%d octets" % (AGENT.stat().st_size if AGENT.is_file() else 0))

# ── L'agent est-il du code Python valide, et la bonne version ? ──
if AGENT.is_file():
    out = subprocess.run([str(PY_EXE), "-c",
                          "import ast,sys,io;"
                          "src=io.open(sys.argv[1],encoding='utf-8').read();"
                          "ast.parse(src);"
                          "print([l for l in src.splitlines() if 'VERSION' in l][:1])",
                          str(AGENT)], capture_output=True, text=True)
    check("L'agent est du Python valide", out.returncode == 0, (out.stderr or out.stdout).strip()[:120])

# ── Playwright pilote-t-il vraiment un navigateur sur cette machine ? ──
PROBE = (
    "import sys\n"
    "from playwright.sync_api import sync_playwright\n"
    "last='aucun'\n"
    "with sync_playwright() as p:\n"
    "    for ch in ['msedge','chrome',None]:\n"
    "        kw={'headless':True}\n"
    "        if ch: kw['channel']=ch\n"
    "        try:\n"
    "            b=p.chromium.launch(**kw); b.close(); print('OK|'+(ch or 'Chromium')); sys.exit(0)\n"
    "        except Exception as e: last=str(e).splitlines()[0][:140]\n"
    "print('ECHEC|'+last)\n"
)
if PY_EXE.is_file():
    out = subprocess.run([str(PY_EXE), "-c", PROBE], capture_output=True, text=True)
    line = (out.stdout.strip().splitlines() or [""])[-1]
    check("Un navigateur démarre réellement", line.startswith("OK|"),
          line.split("|", 1)[-1] or (out.stderr.strip()[:140]))

# ── Les raccourcis ──
for folder, arg, label in [("Desktop", "--server", "Raccourci sur le Bureau"),
                           ("Startup", "--background", "Lancement au démarrage")]:
    lnk = shell_folder(folder) / "PharmAgent.lnk"
    if not check(label + " créé", lnk.is_file(), str(lnk)):
        continue
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');"
         "$s.TargetPath + '||' + $s.Arguments" % lnk],
        capture_output=True, text=True)
    target, _, args = out.stdout.strip().partition("||")
    check(label + " pointe vers le bon Python", pathlib.Path(target).is_file(), target)
    check(label + " passe « %s »" % arg, arg in args, args[:120])

# ── Le panneau répond-il ? ──
panel = None
for _ in range(30):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8765/api/state", timeout=2) as r:
            panel = json.loads(r.read().decode("utf-8"))
        break
    except (urllib.error.URLError, OSError, ValueError):
        time.sleep(1)
check("Le panneau de l'agent répond sur 127.0.0.1:8765", panel is not None)
if panel is not None:
    check("Le panneau annonce un code d'appairage ou une pharmacie",
          bool(panel.get("pairingCode") or panel.get("pharmacyName")),
          json.dumps({k: panel.get(k) for k in ("pairingCode", "pharmacyName", "version")},
                     ensure_ascii=False))

print()
print("RESULTAT :", "TOUT PASSE" if not fails else "IL RESTE DES ECHECS : " + ", ".join(fails))
sys.exit(0 if not fails else 1)
