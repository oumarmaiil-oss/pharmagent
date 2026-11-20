// ============================================================
// PharmAgent — Contrôles de cohérence d'un brouillon (avant approbation)
// ============================================================

import type { DraftRecord } from '../types/pharmagent.ts';

export interface DraftCheck { level: 'error' | 'warn'; text: string }

const SHORT_EXPIRY_MONTHS = 6;
/** Écart de prix accepté entre grossistes (au-delà : alerte). Même valeur que le rapprochement des produits. */
export const PRICE_TOLERANCE = 0.10;
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

const money = (n: number, cur: string) => `${(Math.round(n * 100) / 100).toLocaleString('fr-FR')} ${cur}`;
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
const netLine = (q: number, pu: number, discount?: number) => q * pu * (1 - (discount ?? 0) / 100);

/** Ce qui interdit l'approbation, quel que soit l'avis du pharmacien (vérifié aussi par le serveur). */
export function blockingReason(draft: DraftRecord): string | undefined {
  const data = draft.extractedData;
  const lines = data.lineItems ?? [];
  if (data.documentType === 'ordonnance') {
    return "C'est une ordonnance, pas un bon de livraison ni une facture fournisseur : PharmAgent ne la saisit pas en stock. Rejetez ce brouillon.";
  }
  if (data.documentType === 'autre') {
    return "Ce document n'est ni un bon de livraison ni une facture fournisseur : rien à saisir. Rejetez ce brouillon.";
  }
  if (data.documentType === 'avoir' || lines.some((l) => l.quantity < 0)) {
    return "Avoir ou retour de marchandise : PharmAgent ne saisit pas les avoirs. Traitez-le directement dans votre logiciel.";
  }
  if ((data.documentCount ?? 1) > 1) {
    return `${data.documentCount} documents sur la même photo : seul le premier a été lu. Prenez une photo par bon, puis rejetez ce brouillon.`;
  }
  const unreadable = lines.filter((l) => /illisible/i.test(l.designation ?? '')).length;
  if (data.photoQuality === 'illisible' || (lines.length && unreadable * 2 >= lines.length)) {
    return 'Photo illisible : reprenez-la à plat, bien éclairée, le bon entier dans le cadre, sans compression (pas de capture WhatsApp).';
  }
  if (!lines.length) {
    return 'Aucune ligne de produit lue : photo trop petite, floue ou coupée. Reprenez-la à plat, le bon entier dans le cadre.';
  }
  return undefined;
}

/** Recoupement des totaux : HT ou TTC, remise déjà incluse ou non, montants de ligne imprimés ou recalculés. */
export function totalsCheck(data: DraftRecord['extractedData']) {
  const lines = data.lineItems ?? [];
  const computed = lines.reduce((s, l) => s + netLine(l.quantity || 0, l.unitPriceFCFA || 0, l.discountPercent), 0);
  const gross = lines.reduce((s, l) => s + (l.quantity || 0) * (l.unitPriceFCFA || 0), 0);
  const printedLines = lines.every((l) => typeof l.lineTotal === 'number') ? lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0) : undefined;
  const withVat = lines.reduce((s, l) => s + netLine(l.quantity || 0, l.unitPriceFCFA || 0, l.discountPercent) * (1 + (l.vatRate ?? 0) / 100), 0);
  const printed = data.totalAmountFCFA || 0;
  const targets = [printed, data.totalHT, data.totalHT !== undefined && data.totalTVA !== undefined ? data.totalHT + data.totalTVA : undefined,
    data.totalTVA !== undefined ? printed - data.totalTVA : undefined].filter((x): x is number => typeof x === 'number' && x > 0);
  const sums = [computed, gross, withVat, printedLines].filter((x): x is number => typeof x === 'number');
  return { computed, printed, targets, matches: targets.some((t) => sums.some((s) => close(s, t))) };
}

/** Lecture à refaire plus attentivement : bon ou facture dont le total manque ou ne recoupe pas les lignes. */
export function needsSecondLook(data: DraftRecord['extractedData']): boolean {
  if (!['bon_livraison', 'facture'].includes(data.documentType) || (data.documentCount ?? 1) > 1) return false;
  const lines = data.lineItems ?? [];
  if (!lines.length) return data.photoQuality !== 'illisible';
  return !totalsCheck(data).matches;
}

export function draftChecks(draft: DraftRecord, today = new Date()): DraftCheck[] {
  if (draft.extractionStatus === 'processing' || draft.extractionStatus === 'error') return [];
  const out: DraftCheck[] = [];
  const data = draft.extractedData;
  const lines = data.lineItems ?? [];

  const blocked = blockingReason(draft);
  if (blocked) return [{ level: 'error', text: blocked }];

  // Photo moyenne : un caractère de lot ou de date peut être mal lu sans que rien ne permette de le recouper
  if (data.source === 'photo' && data.photoQuality === 'moyenne' && lines.some((l) => l.lotNumber || l.expiryDate)) {
    out.push({ level: 'warn', text: 'Photo de qualité moyenne : contrôlez les n° de lot et les péremptions sur les boîtes (ou importez le PDF ou un scan du bon).' });
  }
  if (draft.duplicateOf) {
    out.push({ level: 'error', text: `Ce bon semble déjà importé le ${new Date(draft.duplicateOf.createdAt).toLocaleDateString('fr-FR')} (même fournisseur et même numéro) : risque de saisie en double.` });
  }
  // Un relevé de mutuelle n'affiche souvent que la part remboursée : pas de recoupement avec le total
  const isClaim = draft.documentCategory === 'mutuelle';

  const cur = data.currency || 'FCFA';
  const { computed, printed, targets, matches } = totalsCheck(data);
  if (isClaim) {
    // rien : le total du relevé est la part prise en charge, pas la somme des lignes
  } else if (targets.length && lines.length && !matches) {
    out.push({ level: 'error', text: `Le total des lignes (${money(computed, cur)}) ne correspond pas au total du bon (${money(printed || targets[0], cur)}) : une quantité ou un prix est peut-être mal lu.` });
  } else if (!targets.length && lines.length) {
    out.push({ level: 'warn', text: 'Total du bon non lu : impossible de recouper les quantités et les prix.' });
  }
  if (data.totalHT && data.totalTVA !== undefined && printed && !close(data.totalHT + data.totalTVA, printed)) {
    out.push({ level: 'warn', text: `Total HT (${money(data.totalHT, cur)}) + TVA (${money(data.totalTVA, cur)}) ne donne pas le total à payer (${money(printed, cur)}).` });
  }

  const uncertain: number[] = [];
  const limit = new Date(today);
  limit.setMonth(limit.getMonth() + SHORT_EXPIRY_MONTHS);
  lines.forEach((l, i) => {
    const name = `Ligne ${i + 1} (${(l.designation ?? '').slice(0, 30)})`;
    if (!(l.quantity > 0)) out.push({ level: 'error', text: `${name} : quantité manquante ou nulle.` });
    else if (l.quantity > 5000) out.push({ level: 'warn', text: `${name} : quantité inhabituelle (${l.quantity}).` });
    if (!(l.unitPriceFCFA > 0)) out.push({ level: 'error', text: `${name} : prix d'achat manquant.` });
    else if (typeof l.lineTotal === 'number' && l.quantity > 0
      && !close(netLine(l.quantity, l.unitPriceFCFA, l.discountPercent), l.lineTotal) && !close(l.quantity * l.unitPriceFCFA, l.lineTotal)) {
      out.push({ level: 'error', text: `${name} : ${l.quantity} × ${l.unitPriceFCFA} ne donne pas le montant imprimé (${l.lineTotal}).` });
    }
    const exp = expiryEnd(l.expiryDate);
    if (exp && exp < today) out.push({ level: 'error', text: `${name} : produit périmé (${l.expiryDate}) ou date mal lue : vérifiez sur la boîte.` });
    else if (exp && exp < limit) out.push({ level: 'warn', text: `${name} : péremption courte (${l.expiryDate}), moins de ${SHORT_EXPIRY_MONTHS} mois.` });
    // Écart avec la fiche de la pharmacie : au-delà de 10 %, hausse de prix réelle ou mauvais produit
    const ref = l.match?.reference;
    if (ref && l.match?.productId) {
      const [mine, theirs, what] = ref.purchase && l.unitPriceFCFA > 0 ? [l.unitPriceFCFA, ref.purchase, "prix d'achat"] : [l.salePriceFCFA ?? 0, ref.sale ?? 0, 'prix public'];
      if (mine > 0 && theirs > 0 && Math.abs(mine - theirs) / theirs > PRICE_TOLERANCE) {
        const pct = Math.round(((mine - theirs) / theirs) * 100);
        out.push({ level: 'warn', text: `${name} : ${what} ${money(mine, cur)}, fiche de la pharmacie ${money(theirs, cur)} (${pct > 0 ? '+' : ''}${pct} %) : hausse de prix ou mauvais produit ?` });
      }
    }
    if (l.match?.status === 'new_product') {
      out.push({ level: 'warn', text: `${name} : nouveau produit, l'agent ne le saisira pas. Créez-le d'abord dans votre logiciel, puis saisissez cette ligne à la main.` });
    }
    if (typeof l.confidence === 'number' && l.confidence < LOW_CONFIDENCE) uncertain.push(i + 1);
  });
  // Une seule alerte pour toutes les lignes incertaines : trop d'alertes et plus personne ne les lit
  if (uncertain.length) {
    const which = uncertain.length === lines.length ? 'toutes les lignes' : `ligne${uncertain.length > 1 ? 's' : ''} ${uncertain.join(', ')}`;
    out.push({ level: 'warn', text: `Lecture incertaine (${which}) : comparez avec la photo.` });
  }
  return out;
}
