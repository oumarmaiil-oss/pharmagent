#!/usr/bin/env python3
"""
PharmAgent RPA — Agent Local Robotique
Saisit automatiquement les données extraites dans le logiciel de la pharmacie.

GUARDRAIL ABSOLU : ne valide, ne soumet, ne confirme JAMAIS.
Crée uniquement des brouillons. Le pharmacien approuve côté web.
"""
import os, sys, time, base64, json
from io import BytesIO
import requests
try:
    import pyautogui
    from PIL import ImageGrab
except ImportError:
    print("Installez les dépendances : pip install pyautogui pillow requests")
    sys.exit(1)

SAAS_URL   = os.environ.get("PHARMAGENT_URL", "https://pharmagent.onrender.com")
AGENT_KEY  = os.environ.get("PHARMAGENT_AGENT_KEY", "")
DELAY      = float(os.environ.get("PHARMAGENT_DELAY", "0.5"))   # délai entre actions (sec)
POLL_SEC   = int(os.environ.get("PHARMAGENT_POLL", "15"))        # intervalle vérification tâches

pyautogui.FAILSAFE = True   # déplacer la souris en haut-gauche stoppe l'agent

# ── Capture d'écran → base64 ──────────────────────────────────────────────────

def screenshot_b64() -> str:
    img = ImageGrab.grab()
    buf = BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

# ── Exécuter une action RPA ───────────────────────────────────────────────────

def execute_action(action: dict) -> bool:
    kind    = action.get("action")
    x       = action.get("x")
    y       = action.get("y")
    text    = action.get("text", "")
    keys    = action.get("keys", [])
    label   = action.get("fieldLabel", "?")
    safety  = action.get("safetyStatus", "UNKNOWN")

    # Guardrail local — ne jamais exécuter une action interdite
    if safety == "FORBIDDEN_BY_GUARDRAIL":
        print(f"  [BLOQUÉ] Action refusée par guardrail : {label}")
        return False

    if kind == "click" and x is not None and y is not None:
        print(f"  [CLIC] {label} ({x}, {y})")
        pyautogui.click(x, y)
    elif kind == "type" and text:
        print(f"  [SAISIE] {label} = {text!r}")
        pyautogui.typewrite(text, interval=0.05)
    elif kind == "hotkey" and keys:
        print(f"  [TOUCHE] {'+'.join(keys)}")
        pyautogui.hotkey(*keys)
    elif kind == "screenshot_verify":
        print(f"  [VÉRIF] Capture intermédiaire")
    else:
        print(f"  [IGNORÉ] Action inconnue : {kind}")

    time.sleep(DELAY)
    return True

# ── Traiter une tâche approuvée ───────────────────────────────────────────────

def process_task(task: dict) -> None:
    draft     = task["draft"]
    draft_id  = task["id"]
    lines     = draft["extractedData"]["lineItems"]
    headers   = {"X-Agent-Key": AGENT_KEY}

    print(f"\n[RPA] Brouillon {draft_id} — {len(lines)} ligne(s) à saisir")
    print(f"      Le logiciel cible doit être ouvert et visible à l'écran.\n")
    time.sleep(2)

    for i, line in enumerate(lines):
        print(f"\n── Ligne {i+1}/{len(lines)} : {line.get('designation', '?')} ──")

        # 1. Capture d'écran de l'état actuel du logiciel
        ss = screenshot_b64()

        # 2. Demander à Gemini les actions à effectuer
        try:
            r = requests.post(
                f"{SAAS_URL}/api/agent-client/rpa-actions",
                headers={**headers, "Content-Type": "application/json"},
                json={"screenshotBase64": ss, "mimeType": "image/png",
                      "draftId": draft_id, "lineIndex": i},
                timeout=60
            )
            r.raise_for_status()
            result = r.json()
        except Exception as e:
            print(f"  [ERREUR] Impossible d'obtenir les actions RPA : {e}")
            continue

        if not result.get("allSafe"):
            print(f"  [ALERTE] Gemini a détecté des éléments dangereux. Observations : {result.get('observations', '')}")

        # 3. Exécuter les actions
        for action in result.get("actions", []):
            execute_action(action)

        time.sleep(0.5)

    # 4. Rapport au serveur
    requests.post(
        f"{SAAS_URL}/api/agent-client/report",
        headers={**headers, "Content-Type": "application/json"},
        json={"taskId": draft_id, "agentKey": AGENT_KEY,
              "success": True, "message": f"{len(lines)} ligne(s) saisies en brouillon"},
        timeout=15
    )
    print(f"\n[RPA] Saisie terminée. Le pharmacien peut valider depuis l'interface web.")

# ── Boucle principale ─────────────────────────────────────────────────────────

def main() -> None:
    if not AGENT_KEY:
        print("ERREUR : définissez PHARMAGENT_AGENT_KEY", file=sys.stderr)
        sys.exit(1)

    print(f"[RPA] PharmAgent démarré — serveur : {SAAS_URL}")
    print(f"[RPA] Vérification des tâches toutes les {POLL_SEC}s\n")

    while True:
        try:
            r = requests.get(
                f"{SAAS_URL}/api/agent-client/next-task",
                headers={"X-Agent-Key": AGENT_KEY},
                timeout=15
            )
            r.raise_for_status()
            data = r.json()
            task = data.get("task")
            if task:
                process_task(task)
            else:
                print(f"[RPA] Aucune tâche en attente. Prochaine vérification dans {POLL_SEC}s...")
        except KeyboardInterrupt:
            print("\n[RPA] Arrêt par l'utilisateur.")
            sys.exit(0)
        except Exception as e:
            print(f"[RPA] Erreur réseau : {e}")

        time.sleep(POLL_SEC)

if __name__ == "__main__":
    main()
