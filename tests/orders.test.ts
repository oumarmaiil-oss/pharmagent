import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { orderFile, parseSalesJournal, proposeOrder, type SalesSummary } from '../src/server/orders.ts';
import type { CatalogProduct } from '../src/types/pharmagent.ts';

const cat = (id: string, erpLabel: string, stockQty?: number, cip?: string) =>
  ({ id, pharmacyId: 'p', erpLabel, stockQty, cip, purchasePriceFCFA: 1000, suppliers: ['laborex'], source: 'import', updatedAt: '' }) as CatalogProduct;
const catalog = [cat('a', 'DOLIPRANE 1000MG CP B/8', 10), cat('b', 'AMOXICILLINE 500MG GELULE B/12', 0), cat('c', 'GENVAS 20MG CP B/30', 100, '3400930000001')];

test('journal des ventes ticket par ticket : quantités cumulées, durée lue sur les dates', () => {
  const csv = ['Date;Désignation;Qté vendue', '01/11/2026;DOLIPRANE 1000MG CP B/8;3', '05/11/2026;DOLIPRANE 1000MG CP B/8;2',
    '10/11/2026;AMOXICILLINE 500MG GELULE B/12;6', '10/11/2026;PRODUIT INCONNU XYZ;1'].join('\n');
  const r = parseSalesJournal(Buffer.from(csv), catalog, []);
  assert.equal(r.days, 10);
  assert.deepEqual(r.items.map((i) => [i.productId, i.sold]), [['a', 5], ['b', 6]]);
  assert.deepEqual(r.unmatched, ['PRODUIT INCONNU XYZ']);
});

test('récapitulatif par code CIP sans date', () => {
  const ws = XLSX.utils.aoa_to_sheet([['Code CIP', 'Ventes'], ['3400930000001', 30]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'V');
  const r = parseSalesJournal(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, catalog, []);
  assert.equal(r.days, undefined);
  assert.deepEqual(r.items.map((i) => [i.productId, i.sold]), [['c', 30]]);
});

test('proposition : ventes/jour × (couverture + délai + sécurité) − stock, ruptures en premier', () => {
  const sales: SalesSummary = { pharmacyId: 'p', importedAt: '', fileName: '', periodDays: 10, periodSource: 'dates', unmatched: [],
    items: [{ productId: 'a', label: '', sold: 20 }, { productId: 'b', label: '', sold: 5 }, { productId: 'c', label: '', sold: 10 }] };
  const lines = proposeOrder(catalog, sales, { coverDays: 7, leadDays: 1, safetyDays: 2 });
  // a : 2/j × 10 j = 20 − 10 = 10 ; b : 0,5/j × 10 = 5 − 0 = 5 (rupture) ; c : 1/j × 10 = 10 − 100 → rien
  assert.deepEqual(lines.map((l) => [l.productId, l.proposed, l.outOfStock]), [['b', 5, true], ['a', 10, false]]);
  assert.equal(lines[1].daysLeft, 5);
});

test('panier exporté en CSV (Excel français) et Excel', () => {
  const csv = orderFile([{ label: 'DOLIPRANE 1000MG', cip: '123', quantity: 10 }, { label: 'X', quantity: 0 }], 'csv').toString('utf-8');
  assert.equal(csv, '﻿Code CIP;Désignation;Quantité\n123;DOLIPRANE 1000MG;10');
  const wb = XLSX.read(orderFile([{ label: 'A', quantity: 2 }], 'xlsx'));
  assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets.Commande), [{ 'Code CIP': '', 'Désignation': 'A', 'Quantité': 2 }]);
});
