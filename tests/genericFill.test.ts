import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { loadTemplate, templateShape, writeRows } from '../src/server/genericFill.ts';

async function model(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Recueil');
  ws.mergeCells('A1:E1'); ws.getCell('A1').value = 'FEUILLE DE RECUEIL — TITRE FUSIONNÉ';
  ws.getCell('A2').value = 'Numéro de BL :'; ws.getCell('C2').value = 'Fournisseur'; ws.getCell('E2').value = 'Pharmacien :';
  ws.getRow(4).values = ['N°', 'Désignation', 'Qté', 'Prix', 'Total'];
  for (let i = 1; i <= 3; i++) { ws.getCell(`A${4 + i}`).value = i; ws.getCell(`E${4 + i}`).value = { formula: `C${4 + i}*D${4 + i}` } as ExcelJS.CellFormulaValue; }
  ws.getCell('A8').value = 'TOTAUX'; ws.getCell('E8').value = { formula: 'SUM(E5:E7)' } as ExcelJS.CellFormulaValue;
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

test('tableau trouvé malgré un titre fusionné ; champs d’en-tête avec ou sans « : »', async () => {
  const { wb } = await loadTemplate(await model());
  const s = templateShape(wb)!;
  assert.equal(s.headerRow, 4);
  assert.deepEqual(s.columns.map((c) => c.label), ['N°', 'Désignation', 'Qté', 'Prix', 'Total']);
  assert.deepEqual(s.fields.map((f) => f.label), ['Numéro de BL', 'Fournisseur', 'Pharmacien']);
});

test('lignes écrites dans les lignes prévues (numéros et formules gardés), puis insérées avant TOTAUX', async () => {
  const { wb } = await loadTemplate(await model());
  const s = templateShape(wb)!;
  const rows = [['', 'Doliprane', '10', '1000', '999'], ['', 'Smecta', '2', '3200', ''], ['', 'Amox', '1', '1850', ''], ['', 'Ibu', '5', '1400', '']];
  const r = writeRows(wb, s, rows, { 'Numéro de BL': 'BL-77', Fournisseur: 'LABOREX' });
  assert.equal(r.linesWritten, 4);
  const ws = wb.getWorksheet('Recueil')!;
  assert.equal(ws.getCell('B5').value, 'Doliprane');
  assert.equal(ws.getCell('A5').value, 1);                       // numéro de ligne du modèle gardé
  assert.deepEqual((ws.getCell('E5').value as { formula: string }).formula, 'C5*D5'); // formule gardée, pas écrasée par 999
  assert.equal(ws.getCell('B8').value, 'Ibu');                    // 4e ligne insérée avant TOTAUX…
  assert.equal(ws.getCell('A9').value, 'TOTAUX');                 // …qui descend d'une ligne
  assert.equal(ws.getCell('B2').value, 'BL-77');
  assert.equal(ws.getCell('D2').value, 'LABOREX');
  assert.deepEqual(r.fieldsFilled, ['Numéro de BL', 'Fournisseur']);
});
