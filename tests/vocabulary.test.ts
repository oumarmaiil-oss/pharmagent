import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchColumn } from '../src/server/vocabulary.ts';

test('intitulés de colonnes : Afrique, France, Maroc, États-Unis', () => {
  const cases: Array<[string, string | undefined]> = [
    ['Désignation', 'product'], ['Libellé article', 'product'], ['Description', 'product'], ['Item', 'product'], ['Spécialité', 'product'],
    ['Code CIP', 'cip'], ['CIP13', 'cip'], ['EAN 13', 'cip'], ['NDC', 'cip'], ['Code', 'cip'],
    ['Qté', 'quantity'], ['Qté livrée', 'quantity'], ['Qty Ship', 'quantity'], ['Quantity', 'quantity'], ['Nb colis', 'quantity'],
    ['UG', 'freeUnits'], ['U.G.', 'freeUnits'], ['Qté gratuite', 'freeUnits'], ['Free goods', 'freeUnits'],
    ['N° Lot', 'lot'], ['Batch', 'lot'], ['Lot No', 'lot'],
    ['Date Exp.', 'expiry'], ['Péremption', 'expiry'], ['DLU', 'expiry'], ['Expiry', 'expiry'], ['Exp', 'expiry'],
    ['P.U.', 'purchase'], ['PU HT', 'purchase'], ['PU net HT', 'purchase'], ['Prix de cession', 'purchase'], ['PPH', 'purchase'], ['PGHT', 'purchase'],
    ['Unit Cost', 'purchase'], ['Prix achat', 'purchase'], ['PA', 'purchase'],
    ['PPV', 'sale'], ['PPA', 'sale'], ['PP TTC', 'sale'], ['Prix public', 'sale'], ['Prix de vente', 'sale'], ['AWP', 'sale'],
    ['Remise %', 'discount'], ['Rem.', 'discount'], ['Discount', 'discount'],
    ['TVA', 'vat'], ['TVA %', 'vat'], ['VAT', 'vat'],
    ['Montant', 'lineTotal'], ['Montant HT', 'lineTotal'], ['Extended', 'lineTotal'], ['Amount', 'lineTotal'],
    ['Stock', 'stock'], ['Qté stock', 'stock'], ['On hand', 'stock'],
  ];
  for (const [label, expected] of cases) assert.equal(matchColumn(label), expected, label);
});
