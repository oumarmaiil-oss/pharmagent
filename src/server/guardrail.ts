import type { GroundedTargetElement } from '../types/pharmagent.ts';

export class SafetyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyViolationError';
  }
}

const FORBIDDEN_PATTERNS = [
  /\bvalid(er|ation)\b/i,
  /\bd[eé]finitiv(e|ement)\b/i,
  /\bcl[oô]tur(er|e)\b/i,
  /\bcomptabilis(er|ation)\b/i,
  /\bencaiss(er|ement)\b/i,
  /\bconfirm(er|ation)\b/i,
  /\bsoumettre\b/i,
  /\bfinaliz(e|er)\b/i,
  /\bsubmit\b/i,
];

const ALLOWED_DRAFT_PATTERNS = [
  /\bbrouillon\b/i,
  /\bdraft\b/i,
  /\bsauvegard(er|e)\s+temporaire\b/i,
];

export class DraftOnlyGuardrail {
  assertElementSafe(element: Pick<GroundedTargetElement, 'elementRole' | 'detectedLabel' | 'safetyStatus'>): void {
    const label = (element.detectedLabel || '').trim();

    if (
      element.safetyStatus === 'FORBIDDEN_BY_GUARDRAIL' ||
      element.elementRole === 'forbidden_final_button'
    ) {
      throw new SafetyViolationError(
        `[GARDE-FOU] Action formellement interdite sur "${label}". L'agent doit s'arrêter strictement au stade Brouillon.`
      );
    }

    const matchesForbidden = FORBIDDEN_PATTERNS.some((rx) => rx.test(label));
    const matchesDraft = ALLOWED_DRAFT_PATTERNS.some((rx) => rx.test(label));

    if (matchesForbidden && !matchesDraft) {
      throw new SafetyViolationError(
        `[GARDE-FOU] Libellé critique détecté ("${label}"). Toute validation finale est bloquée par politique de sécurité.`
      );
    }
  }

  enforceClassification(element: GroundedTargetElement): GroundedTargetElement {
    const label = (element.detectedLabel || '').trim();
    const matchesForbidden = FORBIDDEN_PATTERNS.some((rx) => rx.test(label));
    const matchesDraft = ALLOWED_DRAFT_PATTERNS.some((rx) => rx.test(label));

    if (
      element.elementRole === 'forbidden_final_button' ||
      (matchesForbidden && !matchesDraft)
    ) {
      return {
        ...element,
        elementRole: 'forbidden_final_button',
        safetyStatus: 'FORBIDDEN_BY_GUARDRAIL',
        guardrailReason:
          element.guardrailReason ||
          'Bouton de validation finale isolé par le Garde-Fou PharmAgent : clic interdit.',
      };
    }

    if (element.elementRole === 'draft_button' || matchesDraft) {
      return {
        ...element,
        elementRole: 'draft_button',
        safetyStatus: 'AUTHORIZED_DRAFT_SAVE',
      };
    }

    return {
      ...element,
      safetyStatus: 'AUTHORIZED_INPUT',
    };
  }
}

export const guardrail = new DraftOnlyGuardrail();
