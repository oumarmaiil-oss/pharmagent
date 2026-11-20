import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { fillWorkbook } from '../src/server/excelFill.ts';

async function template(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Catalogue').addRow(['Désignation', 'Prix']);
  const ws = wb.addWorksheet('Réception');
  ws.getCell('A3').value = 'Fournisseur'; ws.getCell('A4').value = 'N° BL'; ws.getCell('A5').value = 'Date';
  ws.getRow(7).values = ['Désignation ERP', 'Qté', 'N° Lot', 'Péremption', 'Prix achat', 'Prix vente'];
  ws.getCell('A29').value = 'VALIDER LA RÉCEPTION';
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

const LINES = [
  { product: 'Doliprane 1000mg Comp. B/8', cip: '', quantity: 100, lotNumber: 'DL1', expiryDate: '2028-09-30', purchasePrice: 780, salePrice: 1200 },
  { product: 'Smecta 3g Sachet B/30', cip: '', quantity: 20, lotNumber: 'SM9', expiryDate: '04/2029', purchasePrice: 3200, salePrice: '' as const },
];

test('remplit en-tête et lignes sous les bons intitulés', async () => {
  const { buffer, report } = await fillWorkbook(await template(), { supplier: 'PHARMADIS', documentNumber: 'BL-9', documentDate: '2026-11-19' }, LINES);
  assert.equal(report.sheet, 'Réception');
  assert.equal(report.linesWritten, 2);
  assert.deepEqual(report.missing, []);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet('Réception')!;
  assert.equal(ws.getCell('B3').value, 'PHARMADIS');
  assert.equal(ws.getCell('B4').value, 'BL-9');
  assert.equal(ws.getCell('B5').value, '19/11/2026');
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((c) => ws.getRow(8).getCell(c).value), ['Doliprane 1000mg Comp. B/8', 100, 'DL1', '09/2028', 780, 1200]);
  assert.equal(ws.getCell('A9').value, 'Smecta 3g Sachet B/30');
  assert.equal(ws.getCell('F9').value, null);
  assert.equal(ws.getCell('A29').value, 'VALIDER LA RÉCEPTION');
  assert.equal(wb.getWorksheet('Catalogue')!.getCell('A1').value, 'Désignation');
});

test('ajoute à la suite des lignes déjà présentes', async () => {
  const first = await fillWorkbook(await template(), { supplier: '', documentNumber: '', documentDate: '' }, LINES.slice(0, 1));
  const second = await fillWorkbook(first.buffer, { supplier: '', documentNumber: '', documentDate: '' }, LINES.slice(1));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(second.buffer as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet('Réception')!;
  assert.equal(ws.getCell('A8').value, 'Doliprane 1000mg Comp. B/8');
  assert.equal(ws.getCell('A9').value, 'Smecta 3g Sachet B/30');
});

test('modèle anglais (Item, Qty, Free, Batch…) avec UG, remise, TVA et montant', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Receiving');
  ws.getCell('A1').value = 'Supplier'; ws.getCell('A2').value = 'Invoice No';
  ws.getRow(4).values = ['Item', 'Qty', 'Free', 'Batch', 'Expiry', 'Unit cost', 'VAT', 'Discount', 'Amount'];
  const tpl = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  const { buffer, report } = await fillWorkbook(tpl, { supplier: 'ACME', documentNumber: 'INV-1', documentDate: '' },
    [{ ...LINES[0], freeUnits: 10, discountPercent: 5, vatRate: 0, lineTotal: 74100 }]);
  assert.equal(report.linesWritten, 1);
  const out = new ExcelJS.Workbook(); await out.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const r = out.getWorksheet('Receiving')!;
  assert.equal(r.getCell('B1').value, 'ACME');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => r.getRow(5).getCell(c).value), ['Doliprane 1000mg Comp. B/8', 100, 10, 'DL1', '09/2028', 780, 0, 5, 74100]);
});

test('fichier CSV (export Google Sheets) converti puis rempli', async () => {
  const csv = Buffer.from('Produit,Qté,UG,Lot,Péremption,PU HT\n', 'utf-8');
  const { buffer, report } = await fillWorkbook(csv, { supplier: '', documentNumber: '', documentDate: '' }, LINES);
  assert.equal(report.converted, 'csv');
  assert.equal(report.linesWritten, 2);
  const out = new ExcelJS.Workbook(); await out.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  assert.equal(out.worksheets[0].getCell('A3').value, 'Smecta 3g Sachet B/30');
});

test('refuse un fichier sans intitulés reconnus', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Feuille').addRow(['a', 'b', 'c']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  await assert.rejects(fillWorkbook(buf, { supplier: '', documentNumber: '', documentDate: '' }, LINES), /intitulés/);
});

test('ancien format Excel 97-2003 (.xls) converti puis rempli', async () => {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Désignation', 'Quantité', 'Lot', 'Péremption', 'Prix achat']]), 'BL');
  const xls = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
  const { report } = await fillWorkbook(xls, { supplier: '', documentNumber: '', documentDate: '' }, LINES);
  assert.equal(report.converted, 'xls');
  assert.equal(report.linesWritten, 2);
});
