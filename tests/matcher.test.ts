import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftChecks } from '../src/components/draftChecks.ts';
import { attachReference, matchLine } from '../src/server/productMatcher.ts';
import type { CatalogProduct, DraftRecord, ExtractedLineItem } from '../src/types/pharmagent.ts';

const cat = (erpLabel: string, purchase: number, id = erpLabel) =>
  ({ id, pharmacyId: 'p', erpLabel, purchasePriceFCFA: purchase, suppliers: [], source: 'import', updatedAt: '' }) as CatalogProduct;
const catalog = [cat('CEFOLAC 400MG GELULE B/10', 3500), cat('CEFOLAC 200MG GELULE B/10', 2100), cat('ESOREZ 40MG GELULE B/30', 4000), cat('ESOREZ 20MG GELULE B/14', 2500)];
const line = (designation: string, pu: number) => ({ designation, quantity: 2, unitPriceFCFA: pu, confidence: 0.9 }) as ExtractedLineItem;
const ctx = { catalog, aliases: [], supplier: '' };

test('nom mal lu mais même dosage et prix à moins de 10 % : rapproché automatiquement par le prix', () => {
  const m = matchLine(line('CEFDLAC 400MG GEL B/10', 3545), ctx).match;
  assert.equal(m.status, 'auto'); assert.equal(m.method, 'price'); assert.equal(m.erpLabel, 'CEFOLAC 400MG GELULE B/10');
});

test('prix proche mais dosage différent : jamais choisi par le prix', () => {
  const m = matchLine(line('CEFDLAC 200MG GEL B/10', 3545), ctx).match;
  assert.notEqual(m.erpLabel, 'CEFOLAC 400MG GELULE B/10');
});

test('prix à plus de 10 % : pas de choix automatique par le prix', () => {
  const m = matchLine(line('ESDREZ 40MG GEL B/30', 5200), ctx).match;
  assert.notEqual(m.method, 'price');
});

test('écart de prix de plus de 10 % avec la fiche : alerte sur le brouillon', () => {
  const lines = attachReference([{ ...line('ESOREZ 40MG GELULE B/30', 4600), match: { status: 'confirmed', method: 'manual', score: 1, productId: 'ESOREZ 40MG GELULE B/30', candidates: [] } }], catalog);
  const d = { id: 'd', pharmacyId: 'p', status: 'pending', extractionStatus: 'ready', documentCategory: 'bon_livraison', columnMapping: [], createdAt: '', updatedAt: '', actorId: '', actorName: '', tokensConsumed: 0,
    extractedData: { documentType: 'bon_livraison', documentNumber: '1', supplierOrOrg: 'X', recipientPharmacy: '', documentDate: '', currency: 'FCFA', totalAmountFCFA: 9200, lineItems: lines } } as DraftRecord;
  const t = draftChecks(d).map((c) => c.text).join('\n');
  assert.match(t, /\+15 %/);
  d.extractedData.lineItems[0].unitPriceFCFA = 4200; d.extractedData.totalAmountFCFA = 8400;
  assert.doesNotMatch(draftChecks(d).map((c) => c.text).join('\n'), /fiche de la pharmacie/);
});

test('sans dosage lu et plusieurs présentations : le prix ne décide pas seul', () => {
  const c2 = [cat('DOLIPRANE 500MG CP B/16', 1000), cat('DOLIPRANE 1000MG CP B/8', 1050)];
  const m = matchLine(line('DOLIPRANE CP', 1020), { catalog: c2, aliases: [], supplier: '' }).match;
  assert.notEqual(m.method, 'price');
});
