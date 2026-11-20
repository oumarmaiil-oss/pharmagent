// ============================================================
// PharmAgent — Journal des ventes → proposition de commande (méthode des logiciels d'officine)
// Besoin = ventes par jour × (couverture + délai de livraison + sécurité) − stock, arrondi à la boîte supérieure.
// ============================================================

import * as XLSX from 'xlsx';
import type { CatalogProduct, ProductAlias } from '../types/pharmagent.ts';
import { matchLine } from './productMatcher.ts';
import { parseAmount, readWorkbook } from './sheetDocument.ts';
import { matchColumn, normLabel } from './vocabulary.ts';

export interface SalesItem { productId?: string; label: string; cip?: string; sold: number }
export interface SalesSummary {
  pharmacyId: string;
  importedAt: string;
  fileName: string;
  periodDays: number;
  /** D'où vient la durée : dates du fichier ou saisie du pharmacien. */
  periodSource: 'dates' | 'saisie';
  items: SalesItem[];
  unmatched: string[];    // libellés vendus sans fiche reconnue dans le catalogue
}

export interface OrderParams { coverDays: number; leadDays: number; safetyDays: number }
export const DEFAULT_ORDER_PARAMS: OrderParams = { coverDays: 7, leadDays: 1, safetyDays: 2 };

export interface OrderLine {
  productId: string; label: string; cip?: string;
  soldPerDay: number; stock?: number; daysLeft?: number;
  proposed: number; purchasePrice?: number; supplier?: string;
  /** Rupture : déjà plus de stock alors que le produit se vend. */
  outOfStock: boolean;
}

const isDateLabel = (s: string) => /^(date|jour|date (de )?vente|date facture|date ticket|day|sale date)$/.test(normLabel(s));
const isSoldLabel = (s: string) => /vendu|ventes?$|^ventes?|sold|sales|debit|sortie/.test(normLabel(s));

function toDay(v: unknown): number | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return Math.floor(v.getTime() / 86_400_000);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(String(v ?? '').trim());
  if (!m) return undefined;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return Math.floor(Date.UTC(y, Number(m[2]) - 1, Number(m[1])) / 86_400_000);
}

/** Journal des ventes (une ligne par vente OU une ligne par produit) → quantités vendues par produit du catalogue. */
export function parseSalesJournal(buf: Buffer, catalog: CatalogProduct[], aliases: ProductAlias[]): Omit<SalesSummary, 'pharmacyId' | 'importedAt' | 'fileName' | 'periodDays' | 'periodSource'> & { days?: number } {
  const wb = readWorkbook(buf);
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true });
    for (let h = 0; h < Math.min(rows.length, 30); h++) {
      const labels = rows[h].map((c) => String(c ?? ''));
      const col = (pred: (s: string) => boolean) => labels.findIndex(pred);
      const product = col((s) => matchColumn(s) === 'product');
      const cip = col((s) => matchColumn(s) === 'cip');
      // « Qté vendue », « Ventes », « Quantité » : la colonne des ventes prime sur une quantité générique
      const sold = col(isSoldLabel) >= 0 ? col(isSoldLabel) : col((s) => matchColumn(s) === 'quantity');
      if ((product < 0 && cip < 0) || sold < 0) continue;
      const date = col(isDateLabel);

      const byKey = new Map<string, SalesItem>();
      let first: number | undefined, last: number | undefined;
      for (const r of rows.slice(h + 1)) {
        const label = product >= 0 ? String(r[product] ?? '').trim() : '';
        const code = cip >= 0 ? String(r[cip] ?? '').replace(/\D/g, '') : '';
        const qty = parseAmount(r[sold]);
        if ((!label && !code) || qty === undefined || /^total/i.test(label)) continue;
        if (date >= 0) {
          const d = toDay(r[date]);
          if (d !== undefined) { first = Math.min(first ?? d, d); last = Math.max(last ?? d, d); }
        }
        const key = code || normLabel(label);
        const it = byKey.get(key) ?? { label, cip: code || undefined, sold: 0 };
        it.sold += qty;
        byKey.set(key, it);
      }

      const items: SalesItem[] = []; const unmatched: string[] = [];
      for (const it of byKey.values()) {
        const m = matchLine({ designation: it.label || it.cip || '', cip: it.cip, quantity: it.sold, unitPriceFCFA: 0, confidence: 1 }, { catalog, aliases, supplier: '' }).match;
        // Seules les correspondances sûres comptent : on ne commande jamais sur une supposition
        if (m.productId && (m.status === 'auto' || m.status === 'confirmed')) items.push({ ...it, productId: m.productId });
        else unmatched.push(it.label || it.cip || '');
      }
      return { items, unmatched, days: first !== undefined && last !== undefined ? last - first + 1 : undefined };
    }
  }
  throw new Error('Colonnes introuvables : il faut au moins « Désignation » (ou « Code CIP ») et « Qté vendue » (ou « Quantité »).');
}

export function proposeOrder(catalog: CatalogProduct[], sales: SalesSummary, p: OrderParams): OrderLine[] {
  const sold = new Map<string, number>();
  for (const it of sales.items) if (it.productId) sold.set(it.productId, (sold.get(it.productId) ?? 0) + it.sold);
  const horizon = p.coverDays + p.leadDays + p.safetyDays;
  const out: OrderLine[] = [];
  for (const prod of catalog) {
    const total = sold.get(prod.id) ?? 0;
    if (total <= 0) continue;
    const perDay = total / sales.periodDays;
    const stock = prod.stockQty;
    const proposed = Math.max(0, Math.ceil(perDay * horizon - (stock ?? 0)));
    if (!proposed) continue;
    out.push({
      productId: prod.id, label: prod.erpLabel, cip: prod.cip,
      soldPerDay: Math.round(perDay * 100) / 100, stock,
      daysLeft: stock === undefined ? undefined : Math.floor(Math.max(0, stock) / perDay),
      proposed, purchasePrice: prod.purchasePriceFCFA, supplier: prod.suppliers[prod.suppliers.length - 1],
      outOfStock: stock !== undefined && stock <= 0,
    });
  }
  // Les plus urgents d'abord : rupture, puis moins de jours de stock
  return out.sort((a, b) => (a.daysLeft ?? -1) - (b.daysLeft ?? -1) || b.soldPerDay - a.soldPerDay);
}

/** Panier à déposer sur le site du grossiste (import de commande) ou à envoyer par mail. */
export function orderFile(lines: Array<{ label: string; cip?: string; quantity: number }>, format: 'xlsx' | 'csv'): Buffer {
  // Un libellé commençant par = + - @ serait exécuté comme formule à l'ouverture dans Excel : on le neutralise
  const cell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const rows = lines.filter((l) => l.quantity > 0).map((l) => ({ 'Code CIP': cell(l.cip ?? ''), 'Désignation': cell(l.label), 'Quantité': l.quantity }));
  const ws = XLSX.utils.json_to_sheet(rows, { header: ['Code CIP', 'Désignation', 'Quantité'] });
  if (format === 'csv') return Buffer.from('﻿' + XLSX.utils.sheet_to_csv(ws, { FS: ';' }), 'utf-8');
  ws['!cols'] = [{ wch: 14 }, { wch: 45 }, { wch: 10 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Commande');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
