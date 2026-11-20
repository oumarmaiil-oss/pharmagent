// ============================================================
// PharmAgent — Moteur de correspondance libellé grossiste → produit ERP
// Cascade : CIP → mémoire → score local → IA (cas ambigus seulement)
// ============================================================

import { PRICE_TOLERANCE } from '../components/draftChecks.ts';
import type {
  CatalogProduct,
  ExtractedLineItem,
  MatchCandidate,
  ProductAlias,
  ProductMatch,
} from '../types/pharmagent.ts';

export const AUTO_THRESHOLD = 0.9;
const AUTO_MARGIN = 0.08;
const AI_FLOOR = 0.3;

// ─── Normalisation & analyse du libellé ───────────────────

export function normalizeLabel(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^A-Z0-9.%/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSupplier(s: string | undefined): string {
  return s ? normalizeLabel(s).split(' ').slice(0, 2).join(' ') : '';
}

const FORMS: Array<[RegExp, string]> = [
  [/^(CP|CPR|CPS|COMP|COMPR|COMPRIMES?|CPRS)$/, 'CP'],
  [/^(GEL|GELU|GELUL|GELULES?|GLES?|CAPS|CAPSULES?)$/, 'GEL'],
  [/^(SIR|SIROP|SRP)$/, 'SIROP'],
  [/^(SUSP|SUSPENSION)$/, 'SUSP'],
  [/^(INJ|INJECTABLE|AMP|AMPOULES?|FL|FLACON)$/, 'INJ'],
  [/^(SACH|SACHETS?|SAC)$/, 'SACHET'],
  [/^(CR|CREME|CRM)$/, 'CREME'],
  [/^(POM|POMM|POMMADE)$/, 'POMMADE'],
  [/^(COLL|COLLYRE)$/, 'COLLYRE'],
  [/^(SUPPO|SUPP|SUPPOSITOIRES?)$/, 'SUPPO'],
  [/^(SOL|SOLUTION|SOLBUV)$/, 'SOL'],
  [/^(GTT|GOUTTES?)$/, 'GOUTTES'],
  [/^(PDRE|POUDRE|PDR)$/, 'POUDRE'],
  [/^(EFF|EFFERV|EFFERVESCENTS?)$/, 'EFF'],
];

const NOISE = new Set(['BTE', 'BOITE', 'B', 'X', 'DE', 'LE', 'LA', 'ET', 'EN', 'PAR', 'MG', 'G', 'ML', 'UI', 'MCG']);

export interface LabelFeatures {
  words: string[];
  doses: string[];      // normalisées en mg (ou ml/ui/%)
  form?: string;
  pack?: number;
}

export function parseLabel(raw: string): LabelFeatures {
  const n = normalizeLabel(raw);
  const doses: string[] = [];
  const doseRe = /(\d+(?:\.\d+)?)\s*(MG|G|MCG|UG|ML|UI|%)(?![A-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = doseRe.exec(n))) {
    let v = parseFloat(m[1]);
    let unit = m[2];
    if (unit === 'G') { v *= 1000; unit = 'MG'; }
    if (unit === 'MCG' || unit === 'UG') { v /= 1000; unit = 'MG'; }
    doses.push(`${+v.toFixed(3)}${unit}`);
  }

  const FORM_TOK = '(?:CP|CPR|CPS|COMP|GEL|GELULES?|SACH|SACHETS?|AMP|SUPPO|CAPS)';
  const packMatch =
    n.match(/(?:\bB|\bBTE|\bBOITE|\bX)\s*\/?\s*(\d{1,4})\b/) ??
    n.match(/\/\s*(\d{1,4})\b/) ??
    // « 500 CPR » : 500 est le dosage si aucun dosage avec unité n'est écrit
    (doses.length ? n.match(new RegExp(`\\b(\\d{1,4})\\s*${FORM_TOK}\\b`)) ?? n.match(new RegExp(`\\b${FORM_TOK}\\s*(\\d{1,4})\\b`)) : null) ??
    n.match(new RegExp(`\\b\\d{2,4}\\s*${FORM_TOK}\\s*(\\d{1,4})\\b`));
  const pack = packMatch ? parseInt(packMatch[1], 10) : undefined;

  let form: string | undefined;
  const words: string[] = [];
  for (const rawTok of n.split(/[\s/]+/)) {
    const tok = /\d/.test(rawTok) ? rawTok : rawTok.replace(/\./g, '');
    if (!tok) continue;
    const f = FORMS.find(([re]) => re.test(tok));
    if (f) { form ??= f[1]; continue; }
    if (/\d/.test(tok) || NOISE.has(tok) || tok.length < 2) continue;
    words.push(tok);
  }
  if (!doses.length) {
    // Dosage sans unité : "AMOX 500", "DOLIPRANE 1000"
    const bare = n.match(/\b(\d{2,4})\b/);
    if (bare && parseInt(bare[1], 10) !== pack) doses.push(`${parseInt(bare[1], 10)}MG`);
  }
  return { words, doses, form, pack };
}

// ─── Similarité ──────────────────────────────────────────

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length >= 3 && b.startsWith(a)) return 0.92;   // abréviation : AMOX ⊂ AMOXICILLINE
  if (b.length >= 3 && a.startsWith(b)) return 0.92;
  const ta = trigrams(a), tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

function nameScore(src: string[], dst: string[]): number {
  if (!src.length || !dst.length) return 0;
  // Le 1er mot (molécule ou marque) pèse double
  let total = 0, weight = 0;
  src.forEach((w, i) => {
    const best = Math.max(...dst.map((d) => dice(w, d)));
    const k = i === 0 ? 2 : 1;
    total += best * k; weight += k;
  });
  return total / weight;
}

function priceScore(a?: number, b?: number): number | undefined {
  if (!a || !b) return undefined;
  const r = Math.abs(a - b) / Math.max(a, b);
  if (r <= 0.03) return 1;
  if (r <= 0.1) return 0.8;
  if (r <= 0.25) return 0.45;
  return 0.1;
}

interface Scored {
  product: CatalogProduct; score: number; attrScore: number;
  name: number; conflict: boolean; priceGap?: number;   // conflict = dosage, forme ou taille de boîte différents
}

/** Écart de prix relatif (0,05 = 5 %) entre la ligne et la fiche du produit : prix d'achat, sinon prix public. */
export function priceGap(line: Pick<ExtractedLineItem, 'unitPriceFCFA' | 'salePriceFCFA'>, ref: { purchase?: number; sale?: number }): number | undefined {
  const gap = (a?: number, b?: number) => (a && b ? Math.abs(a - b) / b : undefined);
  return gap(line.unitPriceFCFA, ref.purchase) ?? gap(line.salePriceFCFA, ref.sale);
}


function scoreProduct(
  line: ExtractedLineItem, lf: LabelFeatures, p: CatalogProduct, pf: LabelFeatures, supplier: string,
): Scored {
  const name = nameScore(lf.words, pf.words);

  const parts: Array<[number, number]> = [];  // [valeur, poids]
  let doseConflict = false;
  if (lf.doses.length && pf.doses.length) {
    const ok = lf.doses.some((d) => pf.doses.includes(d));
    doseConflict = !ok;
    parts.push([ok ? 1 : 0, 0.25]);
  }
  if (lf.form && pf.form) parts.push([lf.form === pf.form ? 1 : 0.3, 0.1]);
  if (lf.pack && pf.pack) parts.push([lf.pack === pf.pack ? 1 : 0.2, 0.15]);
  const ps = priceScore(line.unitPriceFCFA, p.purchasePriceFCFA) ?? priceScore(line.salePriceFCFA, p.salePriceFCFA);
  if (ps !== undefined) parts.push([ps, 0.25]);

  const attrWeight = parts.reduce((s, [, w]) => s + w, 0);
  const attrScore = attrWeight ? parts.reduce((s, [v, w]) => s + v * w, 0) / attrWeight : 0.5;

  // Le nom domine quand peu d'attributs sont comparables
  const nameWeight = Math.max(0.45, 1 - attrWeight);
  let score = (name * nameWeight + attrScore * attrWeight) / (nameWeight + attrWeight);

  if (doseConflict) score *= 0.5;
  if ((p.stockQty ?? 0) > 0) score += 0.03;
  if (supplier && p.suppliers.includes(supplier)) score += 0.03;

  const conflict = doseConflict || (!!lf.form && !!pf.form && lf.form !== pf.form) || (!!lf.pack && !!pf.pack && lf.pack !== pf.pack);
  return {
    product: p, score: Math.min(1, score), attrScore: doseConflict ? 0 : attrScore, name, conflict,
    priceGap: priceGap(line, { purchase: p.purchasePriceFCFA, sale: p.salePriceFCFA }),
  };
}

// ─── Cascade ─────────────────────────────────────────────

export interface MatchContext {
  catalog: CatalogProduct[];
  aliases: ProductAlias[];
  supplier: string;
}

export interface PendingAI {
  index: number;
  candidates: MatchCandidate[];
}

const featureCache = new WeakMap<CatalogProduct, { label: string; f: LabelFeatures }>();

function featuresOf(p: CatalogProduct): LabelFeatures {
  const c = featureCache.get(p);
  if (c && c.label === p.erpLabel) return c.f;
  const f = parseLabel(p.erpLabel);
  featureCache.set(p, { label: p.erpLabel, f });
  return f;
}

function toCandidate(s: Scored): MatchCandidate {
  return { productId: s.product.id, erpLabel: s.product.erpLabel, score: Math.round(s.score * 100) / 100 };
}

export function matchLine(line: ExtractedLineItem, ctx: MatchContext): { match: ProductMatch; needsAI: boolean } {
  const rawKey = normalizeLabel(line.designation);
  const byId = new Map(ctx.catalog.map((p) => [p.id, p]));

  // 1. Code CIP/EAN
  if (line.cip) {
    const cip = line.cip.replace(/\D/g, '');
    const p = cip.length >= 7 ? ctx.catalog.find((c) => c.cip && c.cip.replace(/\D/g, '') === cip) : undefined;
    if (p) {
      return { needsAI: false, match: { status: 'auto', method: 'cip', score: 1, productId: p.id, erpLabel: p.erpLabel, candidates: [] } };
    }
  }

  // 2. Mémoire (grossiste + libellé, puis libellé seul)
  const alias =
    ctx.aliases.find((a) => a.supplier === ctx.supplier && normalizeLabel(a.rawLabel) === rawKey) ??
    ctx.aliases.find((a) => !a.supplier && normalizeLabel(a.rawLabel) === rawKey) ??
    ctx.aliases.find((a) => normalizeLabel(a.rawLabel) === rawKey);
  if (alias) {
    const p = alias.productId ? byId.get(alias.productId) : undefined;
    return {
      needsAI: false,
      match: { status: 'auto', method: 'memory', score: 1, productId: p?.id, erpLabel: p?.erpLabel ?? alias.canonicalName, candidates: [] },
    };
  }

  if (!ctx.catalog.length) {
    return { needsAI: false, match: { status: 'to_review', method: 'none', score: 0, candidates: [] } };
  }

  // 3. Score local
  const lf = parseLabel(line.designation);
  const scored = ctx.catalog.map((p) => scoreProduct(line, lf, p, featuresOf(p), ctx.supplier));
  const byScore = [...scored].sort((a, b) => b.score - a.score);
  const top = byScore[0];
  const margin = top.score - (byScore[1]?.score ?? 0);

  if (top.score >= AUTO_THRESHOLD && margin >= AUTO_MARGIN) {
    return {
      needsAI: false,
      match: { status: 'auto', method: 'score', score: top.score, productId: top.product.id, erpLabel: top.product.erpLabel, candidates: byScore.slice(1, 3).map(toCandidate) },
    };
  }

  // Confirmation par le prix : un seul produit au nom proche, même dosage/forme/boîte, et prix à moins de 10 % de la fiche
  const priceConfirmed = scored.filter((x) => x.name >= 0.5 && !x.conflict && x.priceGap !== undefined && x.priceGap <= PRICE_TOLERANCE);
  // Sans dosage lu sur la ligne, le prix ne départage pas plusieurs présentations du même produit
  const sameName = scored.filter((x) => x.name >= 0.5 && !x.conflict).length;
  if (priceConfirmed.length === 1 && priceConfirmed[0].score >= AI_FLOOR + 0.2 && (lf.doses.length > 0 || sameName === 1)) {
    const pick = priceConfirmed[0];
    return {
      needsAI: false,
      match: { status: 'auto', method: 'price', score: Math.max(pick.score, AUTO_THRESHOLD), productId: pick.product.id, erpLabel: pick.product.erpLabel,
        candidates: byScore.filter((x) => x !== pick).slice(0, 2).map(toCandidate) },
    };
  }

  // Candidats pour l'IA : meilleurs par score global + meilleurs par attributs
  // (couvre marque ↔ générique où le nom ne ressemble pas)
  const byAttr = [...scored].sort((a, b) => b.attrScore - a.attrScore);
  const seen = new Set<string>();
  const pool: Scored[] = [];
  for (const s of [...byScore.slice(0, 5), ...byAttr.slice(0, 5)]) {
    if (!seen.has(s.product.id)) { seen.add(s.product.id); pool.push(s); }
  }

  return {
    needsAI: top.score >= AI_FLOOR || byAttr[0].attrScore >= 0.8,
    match: { status: 'to_review', method: 'score', score: top.score, candidates: pool.map(toCandidate) },
  };
}

/** Recopie sur chaque ligne rapprochée les prix et le stock de la fiche du produit (contrôle d'écart de prix). */
export function attachReference(lines: ExtractedLineItem[], catalog: CatalogProduct[]): ExtractedLineItem[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return lines.map((l) => {
    const p = l.match?.productId ? byId.get(l.match.productId) : undefined;
    if (!p || !l.match || l.match.reference) return l;
    return { ...l, match: { ...l.match, reference: { purchase: p.purchasePriceFCFA, sale: p.salePriceFCFA, stock: p.stockQty } } };
  });
}

export function matchLines(lines: ExtractedLineItem[], ctx: MatchContext): { lines: ExtractedLineItem[]; pendingAI: PendingAI[] } {
  const pendingAI: PendingAI[] = [];
  const out = lines.map((line, index) => {
    const { match, needsAI } = matchLine(line, ctx);
    if (needsAI) pendingAI.push({ index, candidates: match.candidates });
    return { ...line, match };
  });
  return { lines: out, pendingAI };
}
