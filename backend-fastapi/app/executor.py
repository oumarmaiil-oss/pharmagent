"""
PharmAgent — Module 3 : Exécuteur Adaptatif (GUI PyAutoGUI & Excel OpenPyXL)
Exécute les saisies aux coordonnées détectées par UI Grounding ou écrit un
classeur Excel Brouillon, sous le contrôle strict de DraftOnlyGuardrail.
"""

from pathlib import Path
from typing import Dict, List
import openpyxl
from openpyxl.styles import Font, PatternFill

from app.safety_guardrail import DraftOnlyGuardrail, SafetyViolationError


class AdaptiveExecutor:
    def __init__(self, screen_width: int = 1920, screen_height: int = 1080) -> None:
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.guardrail = DraftOnlyGuardrail()

    def _to_pixels(self, box_2d: List[int]) -> tuple[int, int]:
        ymin, xmin, ymax, xmax = box_2d
        cx = int(((xmin + xmax) / 2.0 / 1000.0) * self.screen_width)
        cy = int(((ymin + ymax) / 2.0 / 1000.0) * self.screen_height)
        return cx, cy

    def execute_gui_draft(self, grounded_elements: List[dict], dry_run: bool = True) -> List[dict]:
        """
        Pilote PyAutoGUI sur le poste officine (mode dry_run par défaut pour sécurité).
        S'arrête obligatoirement après le clic sur 'Enregistrer Brouillon'.
        """
        import pyautogui  # Import tardif pour compatibilité serveur headless

        logs = []
        for elem in grounded_elements:
            role = elem["elementRole"]
            label = elem["detectedLabel"]
            safety = elem["safetyStatus"]

            try:
                self.guardrail.assert_element_safe(role, label, safety)
            except SafetyViolationError as exc:
                logs.append({
                    "target": label,
                    "status": "BLOCKED_BY_GUARDRAIL",
                    "detail": str(exc),
                })
                continue

            px, py = self._to_pixels(elem["box_2d"])
            mapping = elem.get("semanticMapping")

            if role in ("input_field", "table_column") and mapping:
                val = str(mapping["sampleValueToInsert"])
                if not dry_run:
                    pyautogui.click(px, py)
                    pyautogui.write(val, interval=0.02)
                logs.append({
                    "target": label,
                    "coords": [px, py],
                    "value": val,
                    "status": "EXECUTED",
                })
            elif role == "draft_button":
                if not dry_run:
                    pyautogui.click(px, py)
                logs.append({
                    "target": label,
                    "coords": [px, py],
                    "status": "STOPPED_AT_DRAFT",
                    "detail": "Brouillon enregistré. Fin de cycle agent (validation humaine requise).",
                })
                break

        return logs

    def write_excel_draft(self, extracted_data: Dict, output_path: Path) -> Path:
        """Crée un fichier Excel marqué explicitement BROUILLON (jamais validé)."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "BROUILLON_RECEPTION"

        headers = [
            "N° Document",
            "Fournisseur / Organisme",
            "Désignation Médicament",
            "Quantité",
            "N° Lot",
            "Date Exp.",
            "Prix Unitaire FCFA",
            "Statut Agent",
        ]
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill(start_color="065F46", end_color="065F46", fill_type="solid")

        for item in extracted_data.get("lineItems", []):
            ws.append([
                extracted_data.get("documentNumber", ""),
                extracted_data.get("supplierOrOrg", ""),
                item.get("designation", ""),
                item.get("quantity", 0),
                item.get("lotNumber", ""),
                item.get("expiryDate", ""),
                item.get("unitPriceFCFA", 0),
                "BROUILLON - EN ATTENTE VALIDATION PHARMACIEN",
            ])

        wb.save(output_path)
        return output_path
