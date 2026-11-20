// ============================================================
// PharmAgent — Remplissage d'un fichier Excel du pharmacien d'après les intitulés des colonnes
// ============================================================

import ExcelJS from 'exceljs';

export type FillField = 'product' | 'cip' | 'quantity' | 'lot' | 'expiry' | 'purchase' | 'sale';

export interface FillHeader { supplier: string; documentNumber: string; documentDate: string }
export interface FillLine {
  product: string; cip: string; quantity: number; lotNumber: string; expiryDate: string;
  purchasePrice: number; salePrice: number | string;
}
export interface FillReport {
  sheet: string;
  headerRow: number;
  columns: Partial<Record<FillField, string>>;
  missing: FillField[];
  linesWritten: number;
  headerFilled: string[];
}

export const FIELD_LABELS: Record<FillField, string> = {
  product: 'Désignation', cip: 'Code CIP', quantity: 'Quantité', lot: 'N° de lot',
  expiry: 'Péremption', purchase: 'Prix d\'achat', sale: 'Prix de vente',
};

const norm = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// L'ordre compte : le premier intitulé reconnu l'emporte (ex. « Date Exp. » est une péremption, pas une date)
const COLUMN_RULES: Array<[FillField, RegExp]> = [
  ['cip', /^(cip|ean)( \d+)?$|^code (cip|ean|barre|barres|produit)$|^code$/],
  ['quantity', /^(qte|qty|quantite|nb|nombre)( |$)|quantite/],
  ['expiry', /peremption|^exp( |$)|date exp|dlu|dluo|expir/],
  ['lot', /(^|\s)lot(\s|$)/],
  ['sale', /prix (de )?(vente|public)|^pv( |$)|^ppv|^vente$|tarif/],
  ['purchase', /prix (d )?achat|^pa( |$)|^achat|cout|^p u( |$)|prix unitaire/],
  ['product', /designation|libelle|produit|denomination|article|^nom$/],
];

const HEADER_RULES: Array<[keyof FillHeader, RegExp]> = [
  ['supplier', /^(fournisseur|grossiste|laboratoire|expediteur|origine)$/],
  ['documentNumber', /^(n bl|n bon|bl|numero bl|num bl|n de bl|n livraison|numero|numero de livraison|bon de livraison|n piece|n facture)$/],
  ['documentDate', /^(date|date de livraison|date bl|date de reception|date reception)$/],
];

const colLetter = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const isEmpty = (c: ExcelJS.Cell) => c.value === null || c.value === undefined || String(c.text ?? '').trim() === '';

function columnsOfRow(row: ExcelJS.Row): Partial<Record<FillField, number>> {
  const found: Partial<Record<FillField, number>> = {};
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const text = norm(cell.text);
    if (!text) return;
    for (const [field, re] of COLUMN_RULES) {
      if (re.test(text)) { if (found[field] === undefined) found[field] = col; break; }
    }
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
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as unknown as ExcelJS.Buffer);

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
      const text = norm(cell.text);
      for (const [key, re] of HEADER_RULES) {
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

  const missing = (['quantity', 'lot', 'expiry', 'purchase', 'sale'] as FillField[]).filter((f) => cols[f] === undefined);
  const out = await wb.xlsx.writeBuffer();
  const columns: Partial<Record<FillField, string>> = {};
  for (const [f, c] of Object.entries(cols) as Array<[FillField, number]>) columns[f] = colLetter(c);
  return {
    buffer: Buffer.from(out as ArrayBuffer),
    report: { sheet: ws.name, headerRow, columns, missing, linesWritten: written, headerFilled },
  };
}
