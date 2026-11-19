// ============================================================
// PharmAgent — Garde-fou « Brouillon uniquement »
// L'agent ne peut JAMAIS valider, soumettre ou clôturer.
// Il s'arrête strictement au stade Brouillon.
// ============================================================

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
  /\bfinali(s|z)(er|ation)\b/i,
  /\bsubmit\b/i,
  /\bcommit\b/i,
  /\bpost(?:er)?\b/i,
  /\benvoyer\b/i,
];

const DRAFT_PATTERNS = [
  /\bbrouillon\b/i,
  /\bdraft\b/i,
  /\btemporaire\b/i,
  /\bprovisoire\b/i,
];

export function checkTextSafety(text: string): { safe: boolean; reason?: string } {
  const lc = text.toLowerCase();
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(lc)) {
      return {
        safe: false,
        reason: `Action interdite détectée : "${text}". L'agent doit s'arrêter strictement au stade Brouillon.`,
      };
    }
  }
  return { safe: true };
}

export class DraftOnlyGuardrail {
  assertElementSafe(el: Pick<GroundedTargetElement, 'elementRole' | 'detectedLabel' | 'safetyStatus'>): void {
    if (el.safetyStatus === 'FORBIDDEN_BY_GUARDRAIL' || el.elementRole === 'forbidden_final_button') {
      throw new SafetyViolationError(
        `[GARDE-FOU] Élément interdit "${el.detectedLabel}". L'agent s'arrête au stade Brouillon.`
      );
    }
    const check = checkTextSafety(el.detectedLabel || '');
    if (!check.safe) {
      throw new SafetyViolationError(`[GARDE-FOU] ${check.reason}`);
    }
  }

  classifyElement(label: string): 'SAFE_DRAFT' | 'FORBIDDEN_BY_GUARDRAIL' | 'UNKNOWN' {
    if (!label) return 'UNKNOWN';
    const forbidden = FORBIDDEN_PATTERNS.some((p) => p.test(label));
    if (forbidden) return 'FORBIDDEN_BY_GUARDRAIL';
    const draft = DRAFT_PATTERNS.some((p) => p.test(label));
    if (draft) return 'SAFE_DRAFT';
    return 'UNKNOWN';
  }
}

export const guardrail = new DraftOnlyGuardrail();
