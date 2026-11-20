import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmagent-test-'));
process.env.PHARMAGENT_OWNER_PASSWORD = 'test-owner';
process.env.PHARMAGENT_PHARMACY_DEFAULT_PASSWORD = 'test-pharmacy';
delete process.env.DATABASE_URL;
const { store } = await import('../src/server/store.ts');

const empty = { documentType: 'bon_livraison' as const, documentNumber: '', supplierOrOrg: '', recipientPharmacy: '', documentDate: '', currency: 'FCFA', totalAmountFCFA: 0, lineItems: [] };
const newDraft = (pharmacyId: string) => store.createDraft({
  pharmacyId, status: 'pending', extractionStatus: 'processing', documentCategory: 'bon_livraison',
  extractedData: { ...empty }, columnMapping: [], actorId: 'a', actorName: 'a', tokensConsumed: 0,
});

test("quota mensuel appliqué et rendu en cas d'échec", () => {
  const ph = store.createPharmacy({ name: 'Quota', city: 'Dakar', pharmacist: 'T', targetSoftware: 'Excel / Tableur' }).pharmacy;
  store.updatePharmacySubscription(ph.id, 'trial', 2);
  assert.equal(store.checkQuota(ph.id).ok, true);
  newDraft(ph.id); const d2 = newDraft(ph.id);
  const blocked = store.checkQuota(ph.id);
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? '' : blocked.reason, /Quota mensuel atteint \(2\/2/);
  store.failExtraction(d2.id, 'erreur');
  assert.equal(store.checkQuota(ph.id).ok, true);
  store.updatePharmacySubscription(ph.id, 'suspended');
  assert.match((store.checkQuota(ph.id) as { reason: string }).reason, /suspendu/);
});

test('compteur remis à zéro au changement de mois', () => {
  const ph = store.createPharmacy({ name: 'Mois', city: 'Dakar', pharmacist: 'T', targetSoftware: 'Excel / Tableur' }).pharmacy;
  store.updatePharmacySubscription(ph.id, 'trial', 1);
  newDraft(ph.id);
  assert.equal(store.checkQuota(ph.id).ok, false);
  store.getPharmacy(ph.id)!.quotaMonth = '2020-01';
  assert.equal(store.checkQuota(ph.id).ok, true);
});

test('bon déjà importé détecté (même fournisseur et numéro, casse et espaces ignorés)', () => {
  const ph = store.createPharmacy({ name: 'Doublon', city: 'Dakar', pharmacist: 'T', targetSoftware: 'Excel / Tableur' }).pharmacy;
  const a = newDraft(ph.id); const b = newDraft(ph.id); const c = newDraft(ph.id);
  store.finalizeExtraction(a.id, { ...empty, documentNumber: 'BL-2026-1', supplierOrOrg: 'Laborex' }, [], 0);
  store.finalizeExtraction(b.id, { ...empty, documentNumber: 'bl 2026 1', supplierOrOrg: 'LABOREX' }, [], 0);
  store.finalizeExtraction(c.id, { ...empty, documentNumber: 'BL-2026-2', supplierOrOrg: 'Laborex' }, [], 0);
  assert.equal(store.getDraft(b.id)!.duplicateOf?.id, a.id);
  assert.equal(store.getDraft(c.id)!.duplicateOf, undefined);
  // même bon lu différemment (photo puis PDF) ; même numéro chez un autre grossiste = pas un doublon
  const d = newDraft(ph.id); const e = newDraft(ph.id);
  store.finalizeExtraction(d.id, { ...empty, documentNumber: 'BL-2026-1', supplierOrOrg: 'Laborex (eurapharma), Dakar' }, [], 0);
  store.finalizeExtraction(e.id, { ...empty, documentNumber: 'BL-2026-1', supplierOrOrg: 'UbiPharm Sénégal' }, [], 0);
  assert.ok([a.id, b.id].includes(store.getDraft(d.id)!.duplicateOf?.id ?? ''));
  assert.equal(store.getDraft(e.id)!.duplicateOf, undefined);
});

test('sauvegarde puis restauration', async () => {
  const backup = store.exportState();
  const before = backup.pharmacies.length;
  backup.pharmacies[0].name = 'Restaurée';
  store.createPharmacy({ name: 'Après sauvegarde', city: 'Dakar', pharmacist: 'T', targetSoftware: 'Excel / Tableur' });
  const r = await store.importState(backup);
  assert.equal(r.pharmacies, before);
  assert.equal(store.getPharmacy(backup.pharmacies[0].id)!.name, 'Restaurée');
  await assert.rejects(store.importState({ nimporte: 'quoi' }), /invalide/);
});

test('comptes : code pharmacie, Pharmacien, Équipe facultatif, mot de passe modifiable', () => {
  const { pharmacy, password } = store.createPharmacy({ name: 'Comptes', city: 'Dakar', pharmacist: 'Dr Diallo', targetSoftware: 'Excel / Tableur' });
  assert.match(pharmacy.code ?? '', /^[A-Z2-9]{6}$/);
  assert.ok(store.loginPharmacyProfile(pharmacy.code!.toLowerCase(), 'pharmacien', password), 'code insensible à la casse');
  assert.equal(store.loginPharmacyProfile(pharmacy.code!, 'equipe', password), null);
  assert.equal(store.hasTeamAccount(pharmacy.id), false, 'compte Équipe non créé par défaut');
  const teamPw = store.resetTeamAccount(pharmacy.id);
  const team = store.loginPharmacyProfile(pharmacy.code!, 'equipe', teamPw);
  assert.equal(team?.user.role, 'assistant');
  assert.equal(store.loginPharmacyProfile(pharmacy.code!, 'pharmacien', teamPw), null);
  store.setUserPassword(team!.user.id, 'nouveau1');
  assert.ok(store.loginPharmacyProfile(pharmacy.code!, 'equipe', 'nouveau1'));
  const other = store.createPharmacy({ name: 'Autre', city: 'Thiès', pharmacist: 'T', targetSoftware: 'Excel / Tableur' }).pharmacy;
  assert.notEqual(other.code, pharmacy.code);
  assert.equal(store.loginPharmacyProfile(other.code!, 'pharmacien', password), null, 'chaque pharmacie a son mot de passe');
  const fresh = store.resetPharmacistPassword(pharmacy.id)!;
  assert.equal(store.loginPharmacyProfile(pharmacy.code!, 'pharmacien', password), null);
  assert.ok(store.loginPharmacyProfile(pharmacy.code!, 'pharmacien', fresh));
});

test('tableau de bord limité à une pharmacie', () => {
  const a = store.createPharmacy({ name: 'Vue A', city: 'Dakar', pharmacist: 'T', targetSoftware: 'Excel / Tableur' }).pharmacy;
  const b = store.createPharmacy({ name: 'Vue B', city: 'Dakar', pharmacist: 'T', targetSoftware: 'Excel / Tableur' }).pharmacy;
  store.finalizeExtraction(newDraft(a.id).id, { ...empty, documentNumber: 'A-1' }, [], 0);
  store.finalizeExtraction(newDraft(b.id).id, { ...empty, documentNumber: 'B-1' }, [], 0);
  const snap = store.getDashboard(a.id);
  assert.deepEqual(snap.pharmacies.map((p) => p.id), [a.id]);
  assert.ok(snap.pendingDrafts.length > 0 && snap.pendingDrafts.every((d) => d.pharmacyId === a.id));
});
