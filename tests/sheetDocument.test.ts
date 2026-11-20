import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { parseAmount, sheetToDelivery } from '../src/server/sheetDocument.ts';

test('montants : milliers FCFA, virgule décimale, formats anglais', () => {
  assert.equal(parseAmount('638.200'), 638200);
  assert.equal(parseAmount('6 382'), 6382);
  assert.equal(parseAmount('1 234,50'), 1234.5);
  assert.equal(parseAmount('1.234,50'), 1234.5);
  assert.equal(parseAmount('1,234.50'), 1234.5);
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount('8 977 FCFA'), 8977);
  assert.equal(parseAmount(''), undefined);
});

test('bon CSV du grossiste (point-virgule, en-tête, ligne de total) lu sans IA', () => {
  const csv = [
    'Fournisseur : LABOREX SENEGAL;;;;;;',
    'N° BL;20-097490-00;;;;;',
    'Date;18/07/2026;;;;;',
    ';;;;;;',
    'Code CIP;Désignation;Qté livrée;UG;N° Lot;Péremption;P.U. HT;Montant HT',
    '1937061;DAPAGEN 10MG CP PELL B/30;100;2;A123;09/2028;6.382;638.200',
    '1937091;DAPAGEN-M 10MG/1000MG CP/30;52;;B77;03/2029;9.041;470.132',
    ';Total;;;;;;1.108.332',
  ].join('\n');
  const d = sheetToDelivery(Buffer.from(csv, 'utf-8'), 'bl.csv')!;
  assert.equal(d.supplierOrOrg, 'LABOREX SENEGAL');
  assert.equal(d.documentNumber, '20-097490-00');
  assert.equal(d.documentDate, '18/07/2026');
  assert.equal(d.lineItems.length, 2);
  assert.deepEqual([d.lineItems[0].quantity, d.lineItems[0].unitPriceFCFA, d.lineItems[0].lineTotal, d.lineItems[0].freeUnits], [100, 6382, 638200, 2]);
  assert.equal(d.lineItems[1].lotNumber, 'B77');
  assert.equal(d.lineItems[0].cip, '1937061');
  assert.equal(d.totalAmountFCFA, 1108332);
});

test('bon Excel avec vraies dates et sans prix unitaire (déduit du montant)', () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Grossiste', 'UbiPharm'], ['N° facture', 'BEL/797654'], [],
    ['Libellé', 'Quantité', 'Lot', 'Date exp.', 'Montant'],
    ['ADHA DIABETE GEL B/30', 10, 'G18250209', new Date(Date.UTC(2028, 0, 31)), 42070],
  ]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'BL');
  const d = sheetToDelivery(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)!;
  assert.equal(d.supplierOrOrg, 'UbiPharm');
  assert.equal(d.documentNumber, 'BEL/797654');
  assert.equal(d.lineItems[0].unitPriceFCFA, 4207);
  assert.equal(d.lineItems[0].expiryDate, '01/2028');
});

test('fichier sans colonnes reconnaissables : rien (l’IA prendra le relais)', () => {
  assert.equal(sheetToDelivery(Buffer.from('a;b\n1;2', 'utf-8')), undefined);
});
