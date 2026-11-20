// ============================================================
// PharmAgent — Contrôles de cohérence d'un brouillon (avant approbation)
// ============================================================

import type { DraftRecord } from '../types/pharmagent.ts';

export interface DraftCheck { level: 'error' | 'warn'; text: string }

const SHORT_EXPIRY_MONTHS = 6;
const LOW_CONFIDENCE = 0.8;

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

// Date de fin de validité : « 09/2028 » ou « 09/28 » = dernier jour du mois (convention péremption)
export function expiryEnd(raw?: string): Date | null {
  const s = (raw ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return valid(fullYear(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return valid(fullYear(m[2]), Number(m[1]), 0);
  m = /^(\d{4})[/.-](\d{1,2})$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), 0);
  return null;

  function valid(y: number, mo: number, d: number): Date | null {
    if (mo < 1 || mo > 12) return null;
    return d === 0 ? new Date(Date.UTC(y, mo, 0)) : new Date(Date.UTC(y, mo - 1, d));
  }
}

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;

export function draftChecks(draft: DraftRecord, today = new Date()): DraftCheck[] {
  if (draft.extractionStatus === 'processing' || draft.extractionStatus === 'error') return [];
  const out: DraftCheck[] = [];
  const data = draft.extractedData;
  const lines = data.lineItems ?? [];

  if (draft.duplicateOf) {
    out.push({ level: 'error', text: `Ce bon semble déjà importé le ${new Date(draft.duplicateOf.createdAt).toLocaleDateString('fr-FR')} (même fournisseur et même numéro) : risque de saisie en double.` });
  }

  const sum = lines.reduce((s, l) => s + (l.quantity || 0) * (l.unitPriceFCFA || 0), 0);
  const printed = data.totalAmountFCFA || 0;
  if (printed > 0 && Math.abs(sum - printed) > Math.max(1, printed * 0.005)) {
    out.push({ level: 'error', text: `Le total des lignes (${fcfa(sum)}) ne correspond pas au total du bon (${fcfa(printed)}) : une quantité ou un prix est peut-être mal lu.` });
  } else if (!printed && lines.length) {
    out.push({ level: 'warn', text: 'Total du bon non lu : impossible de recouper les quantités et les prix.' });
  }

  const limit = new Date(today);
  limit.setMonth(limit.getMonth() + SHORT_EXPIRY_MONTHS);
  lines.forEach((l, i) => {
    const name = `Ligne ${i + 1} (${(l.designation ?? '').slice(0, 30)})`;
    if (!(l.quantity > 0)) out.push({ level: 'error', text: `${name} : quantité manquante ou nulle.` });
    else if (l.quantity > 5000) out.push({ level: 'warn', text: `${name} : quantité inhabituelle (${l.quantity}).` });
    if (!(l.unitPriceFCFA > 0)) out.push({ level: 'error', text: `${name} : prix d'achat manquant.` });
    const exp = expiryEnd(l.expiryDate);
    if (exp && exp < today) out.push({ level: 'error', text: `${name} : produit périmé (${l.expiryDate}).` });
    else if (exp && exp < limit) out.push({ level: 'warn', text: `${name} : péremption courte (${l.expiryDate}), moins de ${SHORT_EXPIRY_MONTHS} mois.` });
    if (l.match?.status === 'new_product') {
      out.push({ level: 'warn', text: `${name} : nouveau produit, l'agent ne le saisira pas. Créez-le d'abord dans votre logiciel, puis saisissez cette ligne à la main.` });
    }
    if (typeof l.confidence === 'number' && l.confidence < LOW_CONFIDENCE) {
      out.push({ level: 'warn', text: `${name} : lecture incertaine, comparez avec la photo.` });
    }
  });
  return out;
}
