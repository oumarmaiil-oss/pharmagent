// ============================================================
// PharmAgent — Remplissage d'un fichier Excel du pharmacien d'après les intitulés des colonnes
// ============================================================

import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { FIELD_LABELS, matchColumn, matchHeaderLabel, type ColumnField, type HeaderField } from './vocabulary.ts';

export type FillField = Exclude<ColumnField, 'stock'>;

export interface FillHeader { supplier: string; documentNumber: string; documentDate: string }
export interface FillLine {
  product: string; cip: string; quantity: number; lotNumber: string; expiryDate: string;
  purchasePrice: number; salePrice: number | string;
  freeUnits?: number | string; discountPercent?: number | string; vatRate?: number | string; lineTotal?: number | string;
}
export interface FillReport {
  sheet: string;
  headerRow: number;
  columns: Partial<Record<FillField, string>>;
  missing: FillField[];
  linesWritten: number;
  headerFilled: string[];
  converted?: 'ods' | 'csv' | 'xls' | 'numbers' | 'simplifie';
}

// .ods (LibreOffice) et .csv (Google Sheets, export simple) : convertis en .xlsx, la mise en forme est simplifiée
function toXlsx(buf: Buffer): { xlsx: Buffer; converted?: FillReport['converted'] } {
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const isOle = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;   // Excel 97-2003 (.xls)
  // Un vrai .xlsx contient « xl/workbook » ; les autres zips (.ods, .numbers d'Apple) sont convertis
  if (isZip && buf.includes('xl/workbook')) return { xlsx: buf };
  const converted = isOle ? 'xls' : isZip ? (buf.includes('Index/Document.iwa') ? 'numbers' : 'ods') : 'csv';
  const wb = isZip || isOle ? XLSX.read(buf, { type: 'buffer' }) : XLSX.read(buf.toString('utf-8').replace(/^\uFEFF/, ''), { type: 'string', raw: true });
  return { xlsx: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, converted };
}

export { FIELD_LABELS };

const colLetter = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
// Texte d'une cellule : une cellule fusionnée vide fait planter ExcelJS (« reading 'toString' »)
const textOf = (c: ExcelJS.Cell): string => { try { return String(c.text ?? '').trim(); } catch { return ''; } };
const isEmpty = (c: ExcelJS.Cell) => c.value === null || c.value === undefined || textOf(c) === '';
const hasFormula = (c: ExcelJS.Cell) => { try { return !!c.formula || !!(c.value as { sharedFormula?: string } | null)?.sharedFormula; } catch { return false; } };

function columnsOfRow(row: ExcelJS.Row): Partial<Record<FillField, number>> {
  const found: Partial<Record<FillField, number>> = {};
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const field = matchColumn(textOf(cell));
    if (field && field !== 'stock' && found[field] === undefined) found[field] = col;
  });
  return found;
}

export function toDisplayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// 2028-09-30 (fin de mois) → 09/2028, comme imprimé sur les boîtes
export function toExpiryDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[1]}` : iso;
}

export async function fillWorkbook(template: Buffer, header: FillHeader, lines: FillLine[]): Promise<{ buffer: Buffer; report: FillReport }> {
  let { xlsx, converted } = toXlsx(template);
  let wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(xlsx as unknown as ExcelJS.Buffer);
  } catch {
    // Classeur que ExcelJS ne sait pas ouvrir (Google Sheets, Numbers, fonctions avancées) : copie simplifiée des valeurs
    xlsx = XLSX.write(XLSX.read(template, { type: 'buffer' }), { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    converted = 'simplifie';
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ExcelJS.Buffer);
  }

  let best: { ws: ExcelJS.Worksheet; row: number; cols: Partial<Record<FillField, number>>; score: number } | undefined;
  for (const ws of wb.worksheets) {
    const last = Math.min(ws.rowCount, 60);
    for (let r = 1; r <= last; r++) {
      const cols = columnsOfRow(ws.getRow(r));
      const score = Object.keys(cols).length;
      if (cols.product !== undefined && score >= 3 && (!best || score > best.score)) best = { ws, row: r, cols, score };
    }
  }
  if (!best) {
    throw new Error("Aucune ligne d'intitulés reconnue : le fichier doit avoir des colonnes du type Désignation, Quantité, N° Lot, Péremption, Prix achat.");
  }
  const { ws, row: headerRow, cols } = best;
  const productCol = cols.product as number;

  let target = headerRow + 1;
  while (target <= ws.rowCount && !isEmpty(ws.getRow(target).getCell(productCol))) target++;

  // N°, fournisseur, date en colonnes du tableau (une ligne = un produit) : recopiés sur chaque ligne
  const headerValues: Record<HeaderField, string> = {
    supplier: header.supplier, documentNumber: header.documentNumber, documentDate: toDisplayDate(header.documentDate),
  };
  const headerCols: Array<[number, HeaderField]> = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = matchHeaderLabel(textOf(cell));
    if (key && !Object.values(cols).includes(col)) headerCols.push([col, key]);
  });

  let written = 0;
  for (const l of lines) {
    if (!isEmpty(ws.getRow(target).getCell(productCol))) ws.insertRow(target, [], 'i');
    const row = ws.getRow(target);
    const put = (field: FillField, value: string | number) => {
      const col = cols[field];
      // Une formule du modèle (ex. Total HT = Qté × Prix) est gardée : c'est le modèle qui calcule
      if (col !== undefined && value !== '' && value !== undefined && !hasFormula(row.getCell(col))) row.getCell(col).value = value;
    };
    put('product', l.product);
    put('cip', l.cip);
    put('quantity', l.quantity);
    put('lot', l.lotNumber);
    put('expiry', toExpiryDisplay(l.expiryDate));
    put('purchase', l.purchasePrice);
    put('sale', l.salePrice);
    put('freeUnits', l.freeUnits ?? '');
    put('discount', l.discountPercent ?? '');
    put('vat', l.vatRate ?? '');
    put('lineTotal', l.lineTotal ?? '');
    for (const [col, key] of headerCols) if (!hasFormula(row.getCell(col)) && headerValues[key]) row.getCell(col).value = headerValues[key];
    row.commit();
    target++; written++;
  }

  // En-tête du bon (fournisseur, N° BL, date) : cases voisines des libellés situés au-dessus du tableau
  const headerFilled: string[] = [];
  const done = new Set<string>(headerCols.map(([, k]) => k));
  for (let r = 1; r < headerRow; r++) {
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const key = matchHeaderLabel(textOf(cell));
      if (!key || done.has(key) || !headerValues[key]) return;
      const right = ws.getRow(r).getCell(col + 1);
      const below = ws.getRow(r + 1).getCell(col);
      const slot = isEmpty(right) ? right : (r + 1 < headerRow && isEmpty(below) ? below : null);
      if (!slot) return;
      slot.value = headerValues[key];
      done.add(key);
      headerFilled.push(key === 'supplier' ? 'Fournisseur' : key === 'documentNumber' ? 'N° BL' : 'Date');
    });
  }

  const missing = (['quantity', 'lot', 'expiry', 'purchase'] as FillField[]).filter((f) => cols[f] === undefined);
  const out = await wb.xlsx.writeBuffer();
  const columns: Partial<Record<FillField, string>> = {};
  for (const [f, c] of Object.entries(cols) as Array<[FillField, number]>) columns[f] = colLetter(c);
  return {
    buffer: Buffer.from(out as ArrayBuffer),
    report: { sheet: ws.name, headerRow, columns, missing, linesWritten: written, headerFilled, converted },
  };
}
