"""
PharmAgent — Module 2 : UI Grounding Adaptatif & Mapping Sémantique
Analyse une capture d'écran du logiciel cible (ERP officine ou Excel),
détecte les étiquettes des champs, calcule les coordonnées normalisées [0..1000]
et isole impérativement les boutons de validation finale.
"""

import json
import os
from typing import List, Literal, Optional
from google import genai
from google.genai import types
from pydantic import BaseModel, Field


class SemanticMapping(BaseModel):
    sourceJsonPath: str
    targetFieldName: str
    sampleValueToInsert: str
    confidence: float


class GroundedElement(BaseModel):
    id: str
    detectedLabel: str
    elementRole: Literal[
        "input_field",
        "table_column",
        "draft_button",
        "forbidden_final_button",
    ]
    box_2d: List[int] = Field(..., min_length=4, max_length=4)  # [ymin, xmin, ymax, xmax]
    semanticMapping: Optional[SemanticMapping] = None
    safetyStatus: Literal[
        "AUTHORIZED_INPUT",
        "AUTHORIZED_DRAFT_SAVE",
        "FORBIDDEN_BY_GUARDRAIL",
    ]
    guardrailReason: Optional[str] = None


class GroundingResult(BaseModel):
    targetInterfaceTitle: str
    detectedSoftwareType: Literal["erp_form", "excel_grid", "desktop_app"]
    elements: List[GroundedElement]
    executionPlanSummary: str


class UIGroundingAgent:
    def __init__(self) -> None:
        self.client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    def ground_target_screen(
        self,
        screenshot_bytes: bytes,
        mime_type: str,
        extracted_json: dict,
    ) -> tuple[GroundingResult, int]:
        prompt = (
            "Tu es le module UI Grounding de PharmAgent. Analyse cette capture d'écran du "
            "logiciel cible (ERP de stock ou classeur Excel). "
            "1) Localise chaque champ de saisie, colonne de tableau, bouton Brouillon et bouton de Validation finale.\n"
            "2) Retourne box_2d [ymin, xmin, ymax, xmax] sur une échelle normalisée 0 à 1000.\n"
            "3) Effectue le mapping sémantique avec les données JSON ci-dessous.\n"
            "4) RÈGLE CRITIQUE : Tout bouton de validation définitive (ex: 'Valider Définitivement', "
            "'Confirmer', 'Clôturer') DOIT recevoir elementRole='forbidden_final_button' et "
            "safetyStatus='FORBIDDEN_BY_GUARDRAIL'.\n\n"
            f"Données JSON extraites :\n{json.dumps(extracted_json, ensure_ascii=False)}"
        )

        response = self.client.models.generate_content(
            model=self.model,
            contents=[
                types.Part.from_bytes(data=screenshot_bytes, mime_type=mime_type),
                prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GroundingResult,
                temperature=0.0,
            ),
        )

        tokens_used = 0
        if response.usage_metadata:
            tokens_used = response.usage_metadata.total_token_count or 0

        result = GroundingResult.model_validate_json(response.text)
        return result, tokens_used
