"""
PharmAgent — Garde-Fou de Sécurité Absolu (Draft-Only Security Guardrail)
Empêche formellement tout agent autonome de cliquer sur un bouton ou d'exécuter
une commande de validation finale, clôture comptable ou encaissement.
L'exécution s'arrête STRICTEMENT au stade de création du "Brouillon".
"""

import re
from dataclasses import dataclass
from typing import List, Optional


class SafetyViolationError(PermissionError):
    """Levée immédiatement si une action tente de franchir le stade Brouillon."""
    pass


FORBIDDEN_ACTION_PATTERNS = [
    r"\bvalid(er|ation)\b",
    r"\bd[eé]finitiv(e|ement)\b",
    r"\bcl[oô]tur(er|e)\b",
    r"\bcomptabilis(er|ation)\b",
    r"\bencaiss(er|ement)\b",
    r"\bconfirm(er|ation)\b",
    r"\bsoumettre\b",
    r"\bfinaliz(e|er)\b",
    r"\bsubmit\b",
    r"\bpost_invoice\b",
]

ALLOWED_DRAFT_PATTERNS = [
    r"\bbrouillon\b",
    r"\bdraft\b",
    r"\benregistrer\s+brouillon\b",
    r"\bsave\s+draft\b",
    r"\bsauvegarde\s+temporaire\b",
]


@dataclass
class GuardrailVerdict:
    allowed: bool
    reason: str
    enforced_stage: str = "DRAFT_ONLY"


class DraftOnlyGuardrail:
    """
    Politique Zero-Trust pour agents d'officine.
    Toute interaction UI ou écriture fichier passe par cette barrière déterministe.
    """

    def __init__(self) -> None:
        self._forbidden_regex = re.compile(
            "|".join(FORBIDDEN_ACTION_PATTERNS), re.IGNORECASE
        )
        self._draft_regex = re.compile(
            "|".join(ALLOWED_DRAFT_PATTERNS), re.IGNORECASE
        )

    def assert_element_safe(
        self,
        element_role: str,
        target_label: str,
        safety_status: Optional[str] = None,
    ) -> GuardrailVerdict:
        label_clean = (target_label or "").strip()

        if safety_status == "FORBIDDEN_BY_GUARDRAIL" or element_role == "forbidden_final_button":
            raise SafetyViolationError(
                f"[GARDE-FOU] Action bloquée sur '{label_clean}'. "
                "Interdiction absolue de validation finale : arrêt strict au stade Brouillon."
            )

        # Même si le label contient 'valider' sans 'brouillon', blocage immédiat
        if self._forbidden_regex.search(label_clean) and not self._draft_regex.search(label_clean):
            raise SafetyViolationError(
                f"[GARDE-FOU] Mot-clé critique détecté dans '{label_clean}'. "
                "Seule la création d'un Brouillon est autorisée."
            )

        return GuardrailVerdict(
            allowed=True,
            reason=f"Élément '{label_clean}' conforme à la politique Brouillon uniquement.",
        )

    def sanitize_execution_plan(self, steps: List[dict]) -> List[dict]:
        """Filtre et bloque toute étape suspecte avant exécution physique."""
        safe_steps = []
        for step in steps:
            role = step.get("elementRole", "")
            label = step.get("targetLabel", "")
            status = step.get("safetyStatus", "")
            try:
                self.assert_element_safe(role, label, status)
                safe_steps.append(step)
            except SafetyViolationError as exc:
                safe_steps.append({
                    **step,
                    "action": "BLOCK_FINAL_VALIDATION",
                    "status": "BLOCKED_BY_GUARDRAIL",
                    "message": str(exc),
                })
                break
        return safe_steps
