import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftChecks, expiryEnd } from '../src/components/draftChecks.ts';
import type { DraftRecord, ExtractedLineItem } from '../src/types/pharmagent.ts';

const TODAY = new Date(Date.UTC(2026, 10, 20));
const line = (o: Partial<ExtractedLineItem>): ExtractedLineItem =>
  ({ designation: 'Doliprane 1000mg', quantity: 10, unitPriceFCFA: 100, expiryDate: '09/2028', confidence: 0.95, ...o }) as ExtractedLineItem;
const draft = (lines: ExtractedLineItem[], total: number, extra: Partial<DraftRecord> = {}): DraftRecord => ({
  id: 'd1', pharmacyId: 'p1', status: 'pending', extractionStatus: 'ready', documentCategory: 'bon_livraison',
  extractedData: { documentType: 'bon_livraison', documentNumber: 'BL-1', supplierOrOrg: 'X', recipientPharmacy: '', documentDate: '', currency: 'FCFA', totalAmountFCFA: total, lineItems: lines },
  columnMapping: [], createdAt: '2026-11-20T00:00:00Z', updatedAt: '', actorId: '', actorName: '', tokensConsumed: 0, ...extra,
});

test('dates de péremption', () => {
  assert.equal(expiryEnd('09/2028')?.toISOString().slice(0, 10), '2028-09-30');
  assert.equal(expiryEnd('03/27')?.toISOString().slice(0, 10), '2027-03-31');
  assert.equal(expiryEnd('15/04/2029')?.toISOString().slice(0, 10), '2029-04-15');
  assert.equal(expiryEnd('2028-06-30')?.toISOString().slice(0, 10), '2028-06-30');
  assert.equal(expiryEnd('13/2028'), null);
  assert.equal(expiryEnd(''), null);
});

test('bon cohérent : aucune alerte', () => {
  assert.deepEqual(draftChecks(draft([line({}), line({ quantity: 5, unitPriceFCFA: 200 })], 2000), TODAY), []);
});

test('total différent du total imprimé', () => {
  const c = draftChecks(draft([line({ quantity: 100 })], 1000), TODAY);
  assert.ok(c.some((x) => x.level === 'error' && x.text.includes('ne correspond pas')));
});

test('produit périmé, péremption courte, quantité et prix manquants, lecture incertaine', () => {
  const c = draftChecks(draft([
    line({ expiryDate: '10/2026' }), line({ expiryDate: '02/2027' }), line({ quantity: 0 }),
    line({ unitPriceFCFA: 0 }), line({ confidence: 0.5 }),
  ], 0), TODAY);
  const texts = c.map((x) => `${x.level}:${x.text}`).join('\n');
  assert.match(texts, /error:Ligne 1 .*périmé/);
  assert.match(texts, /warn:Ligne 2 .*péremption courte/);
  assert.match(texts, /error:Ligne 3 .*quantité/);
  assert.match(texts, /error:Ligne 4 .*prix/);
  assert.match(texts, /warn:Ligne 5 .*incertaine/);
  assert.match(texts, /warn:Total du bon non lu/);
});

test('nouveau produit signalé (non saisi par l\'agent)', () => {
  const c = draftChecks(draft([line({ match: { status: 'new_product', method: 'manual', score: 1, erpLabel: 'X', candidates: [] } })], 1000), TODAY);
  assert.ok(c.some((x) => x.level === 'warn' && x.text.includes('nouveau produit')));
});

test('bon déjà importé', () => {
  const c = draftChecks(draft([line({})], 1000, { duplicateOf: { id: 'd0', createdAt: '2026-11-18T10:00:00Z', status: 'approved' } }), TODAY);
  assert.ok(c.some((x) => x.level === 'error' && x.text.includes('déjà importé')));
});

test('analyse en cours ou en échec : pas de contrôle', () => {
  assert.deepEqual(draftChecks(draft([line({ quantity: 0 })], 5, { extractionStatus: 'processing' }), TODAY), []);
});
