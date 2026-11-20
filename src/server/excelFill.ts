// ============================================================
// PharmAgent — Remplissage d'un fichier Excel du pharmacien d'après les intitulés des colonnes
// ============================================================

import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { FIELD_LABELS, HEADER_PATTERNS, matchColumn, normLabel, type ColumnField } from './vocabulary.ts';

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
  converted?: 'ods' | 'csv';
}

// .ods (LibreOffice) et .csv (Google Sheets, export simple) : convertis en .xlsx, la mise en forme est simplifiée
function toXlsx(buf: Buffer): { xlsx: Buffer; converted?: 'ods' | 'csv' } {
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip && !buf.subarray(0, 200).toString('latin1').includes('opendocument.spreadsheet')) return { xlsx: buf };
  const converted = isZip ? 'ods' : 'csv';
  const wb = isZip ? XLSX.read(buf, { type: 'buffer' }) : XLSX.read(buf.toString('utf-8').replace(/^\uFEFF/, ''), { type: 'string', raw: true });
  return { xlsx: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, converted };
}

export { FIELD_LABELS };

const colLetter = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const isEmpty = (c: ExcelJS.Cell) => c.value === null || c.value === undefined || String(c.text ?? '').trim() === '';

function columnsOfRow(row: ExcelJS.Row): Partial<Record<FillField, number>> {
  const found: Partial<Record<FillField, number>> = {};
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const field = matchColumn(cell.text);
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
  const { xlsx, converted } = toXlsx(template);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ExcelJS.Buffer);

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

  let written = 0;
  for (const l of lines) {
    if (!isEmpty(ws.getRow(target).getCell(productCol))) ws.insertRow(target, [], 'i');
    const row = ws.getRow(target);
    const put = (field: FillField, value: string | number) => {
      const col = cols[field];
      if (col !== undefined && value !== '' && value !== undefined) row.getCell(col).value = value;
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
    row.commit();
    target++; written++;
  }

  // En-tête du bon (fournisseur, N° BL, date) : cases voisines des libellés situés au-dessus du tableau
  const headerFilled: string[] = [];
  const values: Record<keyof FillHeader, string> = {
    supplier: header.supplier, documentNumber: header.documentNumber, documentDate: toDisplayDate(header.documentDate),
  };
  const done = new Set<string>();
  for (let r = 1; r < headerRow; r++) {
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const text = normLabel(cell.text);
      for (const [key, re] of HEADER_PATTERNS) {
        if (done.has(key) || !re.test(text) || !values[key]) continue;
        const right = ws.getRow(r).getCell(col + 1);
        const below = ws.getRow(r + 1).getCell(col);
        const slot = isEmpty(right) ? right : (r + 1 < headerRow && isEmpty(below) ? below : null);
        if (!slot) continue;
        slot.value = values[key];
        done.add(key);
        headerFilled.push(key === 'supplier' ? 'Fournisseur' : key === 'documentNumber' ? 'N° BL' : 'Date');
      }
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
