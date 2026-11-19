"""
PharmAgent — API Backend FastAPI (Supervision Multi-Officines & Orchestration Agents)
Lancement : uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
"""

from pathlib import Path
from typing import Dict, List
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.executor import AdaptiveExecutor
from app.safety_guardrail import DraftOnlyGuardrail, SafetyViolationError
from app.ui_grounding import UIGroundingAgent
from app.vision_extractor import GeminiVisionExtractor

app = FastAPI(
    title="PharmAgent Central Supervision API",
    version="1.0.0",
    description="Orchestrateur SaaS multi-officines avec Gemini Vision, UI Grounding et Garde-Fou Brouillon.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

extractor = GeminiVisionExtractor()
grounding_agent = UIGroundingAgent()
guardrail = DraftOnlyGuardrail()
executor = AdaptiveExecutor()

PHARMACY_TELEMETRY: Dict[str, dict] = {
    "officine-alpha": {
        "id": "officine-alpha",
        "name": "Pharmacie Alpha (Démo)",
        "city": "Secteur Nord (Démo)",
        "software": "ERP Officine Intégré",
        "documents": 142,
        "tokens": 184200,
        "drafts": 142,
        "guardrail_blocks": 8,
    },
    "officine-beta": {
        "id": "officine-beta",
        "name": "Pharmacie Bêta (Démo)",
        "city": "Secteur Sud (Démo)",
        "software": "Tableur Excel Stock",
        "documents": 96,
        "tokens": 121500,
        "drafts": 96,
        "guardrail_blocks": 5,
    },
}


class ExecuteDraftRequest(BaseModel):
    pharmacy_id: str
    extracted_data: dict
    grounded_elements: List[dict]
    attempt_final_validation: bool = False


@app.get("/api/pharmacies")
def list_pharmacies():
    return {"pharmacies": list(PHARMACY_TELEMETRY.values())}


@app.post("/api/agent/extract")
async def extract_document(
    pharmacy_id: str = Form(...),
    document_type: str = Form("bon_livraison"),
    file: UploadFile = File(...),
):
    raw_bytes = await file.read()
    extracted, tokens = extractor.extract_document(
        image_bytes=raw_bytes,
        mime_type=file.content_type or "image/jpeg",
        document_hint=document_type,
    )
    if pharmacy_id in PHARMACY_TELEMETRY:
        PHARMACY_TELEMETRY[pharmacy_id]["documents"] += 1
        PHARMACY_TELEMETRY[pharmacy_id]["tokens"] += tokens

    return {"extracted": extracted.model_dump(), "tokens_consumed": tokens}


@app.post("/api/agent/ground")
async def ground_interface(
    pharmacy_id: str = Form(...),
    extracted_json: str = Form(...),
    screenshot: UploadFile = File(...),
):
    import json

    raw_bytes = await screenshot.read()
    parsed_data = json.loads(extracted_json)
    grounding, tokens = grounding_agent.ground_target_screen(
        screenshot_bytes=raw_bytes,
        mime_type=screenshot.content_type or "image/png",
        extracted_json=parsed_data,
    )
    if pharmacy_id in PHARMACY_TELEMETRY:
        PHARMACY_TELEMETRY[pharmacy_id]["tokens"] += tokens

    return {"grounding": grounding.model_dump(), "tokens_consumed": tokens}


@app.post("/api/agent/execute-draft")
def execute_draft(payload: ExecuteDraftRequest):
    if payload.attempt_final_validation:
        try:
            guardrail.assert_element_safe(
                element_role="forbidden_final_button",
                target_label="Valider Définitivement",
                safety_status="FORBIDDEN_BY_GUARDRAIL",
            )
        except SafetyViolationError as exc:
            if payload.pharmacy_id in PHARMACY_TELEMETRY:
                PHARMACY_TELEMETRY[payload.pharmacy_id]["guardrail_blocks"] += 1
            raise HTTPException(status_code=403, detail=str(exc))

    logs = executor.execute_gui_draft(payload.grounded_elements, dry_run=True)
    draft_path = executor.write_excel_draft(
        payload.extracted_data,
        Path(f"/tmp/brouillon_{payload.pharmacy_id}.xlsx"),
    )
    if payload.pharmacy_id in PHARMACY_TELEMETRY:
        PHARMACY_TELEMETRY[payload.pharmacy_id]["drafts"] += 1

    return {
        "final_state": "DRAFT_SAVED_ONLY",
        "draft_file": str(draft_path),
        "execution_logs": logs,
    }
