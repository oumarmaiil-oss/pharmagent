"""
PharmAgent — Agent Desktop Autonome (À exécuter sur le PC de l'officine)
Connecte un poste Windows/Mac (Logiciel Comptoir Local, Progiciel Stock, Excel ouvert) au serveur central PharmAgent.
1. Interroge la file d'attente du serveur pour l'officine (--key PA-XXX-0000)
2. Prend une capture d'écran réelle du logiciel ouvert sur le PC
3. Envoie la capture au serveur pour UI Grounding Gemini Vision
4. Pilote clavier/souris (PyAutoGUI) et s'arrête STRICTEMENT au stade Brouillon.

Usage :
  pip install requests pyautogui pillow mss
  python pharmagent_local_agent.py --server https://VOTRE_URL_PHARMAGENT --key PA-DKR-4891
"""

import argparse
import base64
import io
import time
import pyautogui
import requests
from PIL import ImageGrab

from app.safety_guardrail import DraftOnlyGuardrail, SafetyViolationError


def capture_screen_base64() -> str:
    screenshot = ImageGrab.grab()
    buf = io.BytesIO()
    screenshot.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def run_agent_loop(server_url: str, agent_key: str, dry_run: bool = False) -> None:
    guardrail = DraftOnlyGuardrail()
    screen_w, screen_h = pyautogui.size()
    print(f"[PharmAgent Local] Connecté à {server_url} | Clé : {agent_key} | Écran : {screen_w}x{screen_h}")

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

            print(f"[Tâche reçue] {task['id']} — Document {task['extracted']['documentNumber']}")
            screenshot_b64 = capture_screen_base64()

            ground_resp = requests.post(
                f"{server_url.rstrip('/')}/api/agent/ground",
                json={
                    "pharmacyId": task["pharmacyId"],
                    "extractedData": task["extracted"],
                    "screenshotBase64": screenshot_b64,
                    "mimeType": "image/png",
                },
                timeout=60,
            )
            ground_resp.raise_for_status()
            elements = ground_resp.json()["grounding"]["elements"]

            executed_count = 0
            for elem in elements:
                role = elem["elementRole"]
                label = elem["detectedLabel"]
                safety = elem["safetyStatus"]

                try:
                    guardrail.assert_element_safe(role, label, safety)
                except SafetyViolationError as exc:
                    print(f"[GARDE-FOU] {exc}")
                    continue

                cx = int((elem["centerPoint"]["x"] / 1000.0) * screen_w)
                cy = int((elem["centerPoint"]["y"] / 1000.0) * screen_h)

                if role in ("input_field", "table_column") and elem.get("semanticMapping"):
                    val = str(elem["semanticMapping"]["sampleValueToInsert"])
                    if not dry_run:
                        pyautogui.click(cx, cy)
                        pyautogui.write(val, interval=0.02)
                    executed_count += 1
                    print(f"  -> Saisi '{val}' dans [{label}] ({cx}, {cy})")
                elif role == "draft_button":
                    if not dry_run:
                        pyautogui.click(cx, cy)
                    print(f"  -> Clic Brouillon [{label}] ({cx}, {cy}). Arrêt obligatoire.")
                    break

            requests.post(
                f"{server_url.rstrip('/')}/api/agent-client/report",
                json={
                    "taskId": task["id"],
                    "status": "BROUILLON_CREE_LOCALEMENT",
                    "report": f"{executed_count} champs remplis sur le poste officine. Arrêt strict au Brouillon.",
                },
                timeout=15,
            )
        except KeyboardInterrupt:
            print("\nArrêt manuel de l'agent local.")
            break
        except Exception as exc:
            print(f"[Erreur boucle agent] {exc}")
            time.sleep(5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PharmAgent Local Desktop Worker")
    parser.add_argument("--server", required=True, help="URL du serveur PharmAgent")
    parser.add_argument("--key", required=True, help="Clé d'appairage officine (ex: PA-DKR-4891)")
    parser.add_argument("--dry-run", action="store_true", help="Simule sans bouger la souris")
    args = parser.parse_args()
    run_agent_loop(args.server, args.key, dry_run=args.dry_run)
