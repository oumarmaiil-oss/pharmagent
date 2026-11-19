"""
PharmAgent — Module 1 : Extraction Structurée par Gemini Vision
Analyse les documents photographiés (Bon de Livraison, Facture, Mutuelle)
et retourne un JSON strictement typé via Pydantic.
"""

import os
from typing import List, Literal
from google import genai
from google.genai import types
from pydantic import BaseModel, Field


class ExtractedLineItem(BaseModel):
    designation: str = Field(..., description="Nom complet du médicament ou produit")
    quantity: int = Field(..., ge=0, description="Quantité livrée ou facturée")
    lotNumber: str = Field(default="N/A", description="Numéro de lot si présent")
    expiryDate: str = Field(default="N/A", description="Date de péremption (MM/AAAA)")
    unitPriceFCFA: float = Field(..., ge=0, description="Prix unitaire en FCFA")
    confidence: float = Field(..., ge=0.0, le=1.0)


class ExtractedDocument(BaseModel):
    documentType: Literal["bon_livraison", "facture", "mutuelle"]
    documentNumber: str
    supplierOrOrg: str
    recipientPharmacy: str
    documentDate: str
    currency: str = "FCFA"
    totalAmountFCFA: float
    lineItems: List[ExtractedLineItem]


class GeminiVisionExtractor:
    def __init__(self) -> None:
        self.client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    def extract_document(
        self,
        image_bytes: bytes,
        mime_type: str,
        document_hint: str = "bon_livraison",
    ) -> tuple[ExtractedDocument, int]:
        prompt = (
            "Tu es l'agent vision de PharmAgent pour les officines pharmaceutiques. "
            f"Analyse cette photographie de document ({document_hint}). "
            "Extrais fidèlement toutes les lignes de médicaments, quantités, numéros de lot, "
            "dates d'expiration et prix unitaires en FCFA. Ne rien inventer."
        )

        response = self.client.models.generate_content(
            model=self.model,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ExtractedDocument,
                temperature=0.1,
            ),
        )

        tokens_used = 0
        if response.usage_metadata:
            tokens_used = response.usage_metadata.total_token_count or 0

        extracted = ExtractedDocument.model_validate_json(response.text)
        return extracted, tokens_used
