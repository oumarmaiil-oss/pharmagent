// ============================================================
// PharmAgent — Bon de livraison reçu en fichier (Excel, CSV, LibreOffice) : lu tel quel, sans IA
// ============================================================

import * as XLSX from 'xlsx';
import type { ExtractedDocumentData, ExtractedLineItem } from '../types/pharmagent.ts';
import { HEADER_PATTERNS, matchColumn, normLabel, type ColumnField } from './vocabulary.ts';

export const SHEET_MIME = /^(text\/csv|text\/plain|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.oasis\.opendocument\.spreadsheet)$/;

/** Classeur depuis un fichier : CSV UTF-8 (avec ou sans BOM) ou Windows-1252 (exports ERP Windows), .xlsx, .xls, .ods. */
export function readWorkbook(input: Buffer): XLSX.WorkBook {
  let buf = input;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  let isUtf8 = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { isUtf8 = false; }
  // CSV : cellules gardées en texte, sinon « 6.382 » (6 382 FCFA) deviendrait 6,382
  const isText = !(buf[0] === 0x50 && buf[1] === 0x4b) && !(buf[0] === 0xd0 && buf[1] === 0xcf);
  return XLSX.read(buf, { type: 'buffer', codepage: isUtf8 ? 65001 : 1252, cellDates: true, raw: isText });
}

/** « 638.200 » (milliers FCFA), « 6 382 », « 1 234,50 », 6382 → nombre. */
export function parseAmount(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  let s = String(v ?? '').replace(/[\s  ]|FCFA|F CFA|CFA|€|\$|EUR|USD/gi, '');
  if (!s) return undefined;
  const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',');
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');                 // 638.200
  else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');               // 638,200 (anglais)
  else if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.'); // 1,234.50 / 1.234,50
  else s = s.replace(',', '.');                                                  // 12,5
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');
function dateText(v: unknown, monthOnly: boolean): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return monthOnly ? `${pad(v.getMonth() + 1)}/${v.getFullYear()}` : `${pad(v.getDate())}/${pad(v.getMonth() + 1)}/${v.getFullYear()}`;
  }
  return String(v ?? '').trim();
}

type Row = unknown[];
const cellText = (v: unknown) => (v instanceof Date ? dateText(v, false) : String(v ?? '').trim());

function columnsOf(row: Row): Partial<Record<ColumnField, number>> {
  const cols: Partial<Record<ColumnField, number>> = {};
  row.forEach((cell, i) => {
    const f = matchColumn(cellText(cell));
    if (f && cols[f] === undefined) cols[f] = i;
  });
  return cols;
}

/** Bon de livraison tabulaire → données du brouillon. undefined si aucune ligne d'intitulés reconnue. */
export function sheetToDelivery(buf: Buffer, fileName = ''): ExtractedDocumentData | undefined {
  const wb = readWorkbook(buf);
  let best: { rows: Row[]; header: number; cols: Partial<Record<ColumnField, number>>; score: number } | undefined;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { header: 1, defval: '', raw: true });
    for (let r = 0; r < Math.min(rows.length, 60); r++) {
      const cols = columnsOf(rows[r]);
      const score = Object.keys(cols).length;
      const usable = cols.product !== undefined && cols.quantity !== undefined && (cols.purchase !== undefined || cols.lineTotal !== undefined);
      if (usable && (!best || score > best.score)) best = { rows, header: r, cols, score };
    }
  }
  if (!best) return undefined;
  const { rows, header, cols } = best;
  const at = (row: Row, f: ColumnField) => (cols[f] === undefined ? '' : row[cols[f] as number]);

  const lines: ExtractedLineItem[] = [];
  let printedTotal: number | undefined;
  for (const row of rows.slice(header + 1)) {
    const designation = cellText(at(row, 'product'));
    const quantity = parseAmount(at(row, 'quantity'));
    if (!designation) continue;
    // Ligne de total en bas du tableau (« Total », « Net à payer ») : sert au recoupement, pas un produit
    if (/^(total|sous total|net a payer|montant total|total general|a reporter|report)\b/.test(normLabel(designation))) {
      printedTotal = parseAmount(at(row, 'lineTotal')) ?? row.map(parseAmount).filter((x): x is number => x !== undefined).pop();
      continue;
    }
    if (quantity === undefined) continue;
    const lineTotal = parseAmount(at(row, 'lineTotal'));
    const pu = parseAmount(at(row, 'purchase')) ?? (lineTotal !== undefined && quantity ? lineTotal / quantity : 0);
    lines.push({
      designation, quantity: Math.round(quantity), unitPriceFCFA: pu, confidence: 1,
      cip: cellText(at(row, 'cip')) || undefined,
      lotNumber: cellText(at(row, 'lot')) || undefined,
      expiryDate: dateText(at(row, 'expiry'), true) || undefined,
      salePriceFCFA: parseAmount(at(row, 'sale')),
      freeUnits: parseAmount(at(row, 'freeUnits')),
      discountPercent: parseAmount(at(row, 'discount')),
      vatRate: parseAmount(at(row, 'vat')),
      lineTotal,
    } as ExtractedLineItem);
  }

  // En-tête au-dessus du tableau : « Fournisseur : X », « N° BL | 123 », « Date » …
  const head: Record<'supplier' | 'documentNumber' | 'documentDate', string> = { supplier: '', documentNumber: '', documentDate: '' };
  for (let r = 0; r < header; r++) {
    rows[r].forEach((cell, c) => {
      const raw = cellText(cell);
      const [label, inline] = raw.split(/\s*:\s*(.+)/);
      for (const [key, re] of HEADER_PATTERNS) {
        if (head[key] || !re.test(normLabel(label))) continue;
        head[key] = (inline ?? '').trim() || cellText(rows[r][c + 1]) || cellText(rows[r + 1]?.[c]);
      }
    });
  }
  if (!head.documentNumber) head.documentNumber = fileName.replace(/\.[^.]+$/, '');

  const computed = lines.reduce((s, l) => s + (l.lineTotal ?? l.quantity * l.unitPriceFCFA), 0);
  return {
    documentType: lines.some((l) => l.quantity < 0) ? 'avoir' : 'bon_livraison',
    documentCount: 1, photoQuality: 'bonne',
    documentNumber: head.documentNumber, supplierOrOrg: head.supplier, recipientPharmacy: '',
    documentDate: head.documentDate, currency: 'FCFA',
    totalAmountFCFA: printedTotal ?? Math.round(computed * 100) / 100,
    agentObservations: `Fichier lu directement (${lines.length} lignes), sans lecture d'image.`,
    lineItems: lines,
  };
}
