import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockingReason, draftChecks, expiryEnd } from '../src/components/draftChecks.ts';
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
  assert.match(texts, /warn:Lecture incertaine \(ligne 5\)/);
  assert.match(texts, /warn:Total du bon non lu/);
});

test('nouveau produit signalé (non saisi par l\'agent)', () => {
  const c = draftChecks(draft([line({ match: { status: 'new_product', method: 'manual', score: 1, erpLabel: 'X', candidates: [] } })], 1000), TODAY);
  assert.ok(c.some((x) => x.level === 'warn' && x.text.includes('nouveau produit')));
});

test('facture HT/TTC avec remise et TVA : pas de fausse alerte', () => {
  const lines = [line({ quantity: 10, unitPriceFCFA: 1000, discountPercent: 5, vatRate: 0, lineTotal: 9500 }), line({ quantity: 2, unitPriceFCFA: 5000, vatRate: 18, lineTotal: 10000 })];
  const d = draft(lines, 21300, {});
  d.extractedData.totalHT = 19500; d.extractedData.totalTVA = 1800;
  assert.deepEqual(draftChecks(d, TODAY), []);
});

test('montant de ligne incohérent', () => {
  const c = draftChecks(draft([line({ quantity: 10, unitPriceFCFA: 100, lineTotal: 1500 })], 1500), TODAY);
  assert.ok(c.some((x) => x.level === 'error' && x.text.includes('ne donne pas le montant imprimé')));
});

test('relevé de mutuelle : le total (part remboursée) n\'est pas recoupé', () => {
  const c = draftChecks(draft([line({ quantity: 2, unitPriceFCFA: 1200 })], 1920, { documentCategory: 'mutuelle' }), TODAY);
  assert.ok(!c.some((x) => x.text.includes('ne correspond pas')));
});

test('avoir (quantités négatives) : une seule alerte claire', () => {
  const c = draftChecks(draft([line({ quantity: -3 }), line({ quantity: -2 })], -500), TODAY);
  assert.equal(c.length, 1);
  assert.match(c[0].text, /Avoir/);
});

test('bon déjà importé', () => {
  const c = draftChecks(draft([line({})], 1000, { duplicateOf: { id: 'd0', createdAt: '2026-11-18T10:00:00Z', status: 'approved' } }), TODAY);
  assert.ok(c.some((x) => x.level === 'error' && x.text.includes('déjà importé')));
});

test('analyse en cours ou en échec : pas de contrôle', () => {
  assert.deepEqual(draftChecks(draft([line({ quantity: 0 })], 5, { extractionStatus: 'processing' }), TODAY), []);
});

test('ordonnance, document hors sujet, plusieurs bons, photo illisible : approbation impossible', () => {
  const base = draft([line({})], 1000);
  const as = (o: Partial<DraftRecord['extractedData']>) => ({ ...base, extractedData: { ...base.extractedData, ...o } });
  for (const [o, word] of [[{ documentType: 'ordonnance', lineItems: [] }, 'ordonnance'], [{ documentType: 'autre', lineItems: [] }, 'ni un bon'],
    [{ documentType: 'avoir' }, 'avoir'], [{ documentCount: 2 }, '2 documents'], [{ photoQuality: 'illisible' }, 'illisible'], [{ lineItems: [] }, 'aucune ligne'], [{ lineItems: [line({ confidence: 0.45, quantity: 3 })], totalAmountFCFA: 99999 }, 'illisible'], [{ lineItems: [line({ designation: 'illisible (ligne 1)' })] }, 'illisible']] as const) {
    const d = as(o as never);
    assert.match(blockingReason(d) ?? '', new RegExp(word, 'i'));
    const c = draftChecks(d, TODAY);
    assert.equal(c.length, 1); assert.equal(c[0].level, 'error');
  }
  assert.equal(blockingReason(as({ documentCount: 1, photoQuality: 'moyenne' })), undefined);
});

test('lignes incertaines regroupées en une seule alerte', () => {
  const c = draftChecks(draft([line({ confidence: 0.6 }), line({ confidence: 0.7 })], 2000), TODAY);
  assert.deepEqual(c.map((x) => x.text), ['Lecture incertaine (toutes les lignes) : comparez avec la photo.']);
});

test('seconde lecture : seulement si le total manque ou ne recoupe pas', async () => {
  const { needsSecondLook } = await import('../src/components/draftChecks.ts');
  assert.equal(needsSecondLook(draft([line({})], 1000).extractedData), false);
  assert.equal(needsSecondLook(draft([line({})], 0).extractedData), true);
  assert.equal(needsSecondLook(draft([line({})], 5000).extractedData), true);
  assert.equal(needsSecondLook(draft([], 0, {}).extractedData), true);
  assert.equal(needsSecondLook({ ...draft([], 0).extractedData, documentType: 'ordonnance' }), false);
  assert.equal(needsSecondLook({ ...draft([line({})], 0).extractedData, documentCount: 2 }), false);
});

test('photo moyenne avec lots : contrôle des lots sur les boîtes demandé ; fichier ou PDF : rien', () => {
  const base = draft([line({ lotNumber: 'G123' })], 1000);
  const as = (o: Partial<DraftRecord['extractedData']>) => ({ ...base, extractedData: { ...base.extractedData, ...o } });
  assert.match(draftChecks(as({ source: 'photo', photoQuality: 'moyenne' }), TODAY).map((c) => c.text).join(), /contrôlez les n° de lot/);
  assert.deepEqual(draftChecks(as({ source: 'pdf', photoQuality: 'moyenne' }), TODAY), []);
  assert.deepEqual(draftChecks(as({ source: 'photo', photoQuality: 'bonne' }), TODAY), []);
});

test('lecture douteuse mais total qui recoupe : pas bloqué, simple alerte', () => {
  const c = draftChecks(draft([line({ confidence: 0.5 })], 1000), TODAY);
  assert.deepEqual(c.map((x) => x.level), ['warn']);
});
