"""
PharmAgent — Agent Desktop Autonome (À exécuter sur le PC / Mac de l'officine)
Connecte un poste Windows/Mac (Logiciel Comptoir Local, Progiciel Stock, Excel ouvert) au serveur central PharmAgent.
1. Interroge la file d'attente du serveur pour l'officine (--key PA-XXX-0000)
2. Utilise le profil logiciel mémorisé ou capture l'écran pour UI Grounding Gemini Vision
3. Pilote clavier/souris (PyAutoGUI) et s'arrête STRICTEMENT au stade Brouillon.

Usage :
  pip install requests pyautogui pillow
  python pharmagent_local_agent.py --server https://VOTRE_URL_PHARMAGENT --key PA-ALP-1001
"""

import argparse
import base64
import io
import logging
import os
import sys
import time
import pyautogui
import requests
from PIL import ImageGrab

from app.safety_guardrail import DraftOnlyGuardrail, SafetyViolationError

if sys.platform == "win32":
    try:
        import ctypes
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pharmagent.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("PharmAgentLocal")


def capture_screen_base64() -> str:
    screenshot = ImageGrab.grab()
    buf = io.BytesIO()
    screenshot.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def type_text_utf8(text: str) -> None:
    """Saisit fidèlement les accents français (é, è, à, ç) via presse-papier + collage."""
    if not text:
        return
    try:
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update()
        hotkey_mod = "command" if sys.platform == "darwin" else "ctrl"
        pyautogui.hotkey(hotkey_mod, "v")
        time.sleep(0.05)
        root.destroy()
        return
    except Exception:
        pyautogui.write(text, interval=0.02)


def resolve_value_from_task(elem: dict, extracted: dict) -> str:
    mapping = elem.get("semanticMapping") or {}
    path_str = (mapping.get("sourceJsonPath") or "").strip()
    items = extracted.get("lineItems") or []
    first_item = items[0] if items else {}
    clean = (
        path_str.replace("extracted.", "")
        .replace("firstLineItem.", "item.")
        .replace("lineItems[0].", "item.")
    )
    if clean.startswith("extra:"):
        target_key = clean[6:].strip().lower()
        for ef in extracted.get("extraFields") or []:
            if str(ef.get("key", "")).strip().lower() == target_key:
                return str(ef.get("value", ""))
    if clean.startswith("item."):
        field = clean[5:]
        if field in first_item and first_item[field] is not None:
            return str(first_item[field])
    if clean and clean in extracted and extracted[clean] is not None:
        return str(extracted[clean])
    return str(mapping.get("sampleValueToInsert") or "")


def run_agent_loop(server_url: str, agent_key: str, dry_run: bool = False) -> None:
    guardrail = DraftOnlyGuardrail()
    screen_w, screen_h = pyautogui.size()
    logger.info(
        "Connecté à %s | Clé : %s | Écran : %sx%s",
        server_url,
        agent_key,
        screen_w,
        screen_h,
    )

    while True:
        try:
            resp = requests.get(
                f"{server_url.rstrip('/')}/api/agent-client/next-task",
                params={"agentKey": agent_key},
                timeout=15,
            )
            data = resp.json()
            task = data.get("task")
            if not task:
                time.sleep(4)
                continue

            logger.info("Tâche reçue %s — Document %s", task["id"], task["extracted"].get("documentNumber"))
            profile = data.get("softwareProfile")

            if profile and profile.get("elements"):
                logger.info("Profil mémorisé trouvé : '%s'", profile.get("softwareName"))
                elements = profile["elements"]
            else:
                logger.info("Analyse de l'écran en direct via Gemini Vision...")
                screenshot_b64 = capture_screen_base64()
                ground_resp = requests.post(
                    f"{server_url.rstrip('/')}/api/agent/ground",
                    json={
                        "pharmacyId": task["pharmacyId"],
                        "agentKey": agent_key,
                        "extractedData": task["extracted"],
                        "screenshotBase64": screenshot_b64,
                        "mimeType": "image/png",
                    },
                    timeout=60,
                )
                ground_resp.raise_for_status()
                elements = ground_resp.json()["grounding"]["elements"]

            executed_count = 0
            blocked_labels = []
            for elem in elements:
                role = elem["elementRole"]
                label = elem["detectedLabel"]
                safety = elem.get("safetyStatus")

                if safety == "FORBIDDEN_BY_GUARDRAIL" or role == "forbidden_final_button":
                    logger.warning("[GARDE-FOU] Bouton final ignoré et verrouillé : %s", label)
                    blocked_labels.append(label)
                    continue

                try:
                    guardrail.assert_element_safe(role, label, safety)
                except SafetyViolationError as exc:
                    logger.warning("[GARDE-FOU] %s", exc)
                    requests.post(
                        f"{server_url.rstrip('/')}/api/agent-client/report",
                        json={"taskId": task["id"], "status": "BLOQUE_GARDE_FOU", "report": str(exc)},
                        timeout=15,
                    )
                    break

                cx = int((elem["centerPoint"]["x"] / 1000.0) * screen_w)
                cy = int((elem["centerPoint"]["y"] / 1000.0) * screen_h)

                if role in ("input_field", "table_column") and elem.get("semanticMapping"):
                    val = resolve_value_from_task(elem, task["extracted"])
                    if not dry_run:
                        pyautogui.click(cx, cy)
                        time.sleep(0.08)
                        type_text_utf8(val)
                    executed_count += 1
                    logger.info("  -> Saisi '%s' dans [%s] (%s, %s)", val, label, cx, cy)
                elif role == "draft_button":
                    if not dry_run:
                        pyautogui.click(cx, cy)
                    logger.info("  -> Clic Brouillon [%s] (%s, %s). Arrêt obligatoire.", label, cx, cy)
                    break

            requests.post(
                f"{server_url.rstrip('/')}/api/agent-client/report",
                json={
                    "taskId": task["id"],
                    "status": "BROUILLON_CREE_LOCALEMENT",
                    "report": f"{executed_count} champs remplis sur le poste officine. Bouton(s) final(aux) verrouillé(s) : {', '.join(blocked_labels) or 'aucun'}. Arrêt strict au Brouillon.",
                },
                timeout=15,
            )
        except KeyboardInterrupt:
            logger.info("Arrêt manuel de l'agent local.")
            break
        except Exception as exc:
            logger.error("Erreur boucle agent : %s", exc)
            time.sleep(5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PharmAgent Local Desktop Worker")
    parser.add_argument("--server", required=True, help="URL du serveur PharmAgent")
    parser.add_argument("--key", required=True, help="Clé d'appairage officine (ex: PA-ALP-1001)")
    parser.add_argument("--dry-run", action="store_true", help="Simule sans bouger la souris")
    args = parser.parse_args()
    run_agent_loop(args.server, args.key, dry_run=args.dry_run)
