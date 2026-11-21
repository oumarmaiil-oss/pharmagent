import assert from 'node:assert/strict';
import { test } from 'node:test';

// Les plafonds de conservation sont lus au chargement du module : on les fixe
// avant d'importer le magasin.
process.env.PHARMAGENT_MAX_BONS_PAR_OFFICINE = '5';
process.env.PHARMAGENT_MAX_AUDIT_PAR_OFFICINE = '5';
process.env.PHARMAGENT_RETENTION_BONS_JOURS = '30';
process.env.PHARMAGENT_RETENTION_AUDIT_JOURS = '30';
process.env.DATA_DIR = `/tmp/pharmagent-conservation-${Date.now()}`;

const { store } = await import('../src/server/store.ts');

function officine(nom: string) {
  return store.createPharmacy({
    name: nom, city: 'Dakar', pharmacist: 'Dr T', targetSoftware: 'ERP Officine Intégré',
  }).pharmacy;
}

function bon(pharmacyId: string, numero: string) {
  return store.createDraft({
    pharmacyId, status: 'pending', documentCategory: 'bon_livraison',
    extractedData: {
      documentType: 'bon_livraison', documentNumber: numero, supplierOrOrg: 'UBIPHARM',
      documentDate: '2026-11-21', totalAmount: 0, lineItems: [], photoQuality: 'bonne',
    } as never,
    columnMapping: [], actorId: 'T', actorName: 'Test', tokensConsumed: 0,
  });
}

test("une officine active n'efface pas l'historique d'une autre", () => {
  const a = officine('Officine A');
  const b = officine('Officine B');

  // B dépose deux bons, puis A en dépose bien plus que son plafond.
  bon(b.id, 'B-1');
  bon(b.id, 'B-2');
  for (let i = 1; i <= 20; i++) bon(a.id, `A-${i}`);

  const bonsDeB = store.getDrafts(b.id);
  assert.equal(bonsDeB.length, 2, "les bons de l'officine B ont été effacés par l'activité de A");
  assert.deepEqual(bonsDeB.map((d) => d.extractedData.documentNumber).sort(), ['B-1', 'B-2']);

  // A est bien ramenée à son propre plafond, et garde les plus récents.
  const bonsDeA = store.getDrafts(a.id);
  assert.equal(bonsDeA.length, 5, 'le plafond par officine ne joue pas');
  assert.equal(bonsDeA[0].extractedData.documentNumber, 'A-20', 'ce sont les plus anciens qui doivent partir');
});

test("le journal d'audit de chaque officine est préservé séparément", () => {
  const a = officine('Journal A');
  const b = officine('Journal B');

  store.addAuditLog({ pharmacyId: b.id, actorId: 'T', actorName: 'Test', action: 'B garde ceci', level: 'info' });
  for (let i = 1; i <= 20; i++) {
    store.addAuditLog({ pharmacyId: a.id, actorId: 'T', actorName: 'Test', action: `A ${i}`, level: 'info' });
  }

  const journalB = store.getAuditLogs(b.id);
  assert.ok(journalB.some((l) => l.action === 'B garde ceci'),
    "le journal de B a été effacé par l'activité de A — la traçabilité ne tient pas");
  assert.equal(store.getAuditLogs(a.id).length, 5, 'le plafond par officine ne joue pas sur le journal');
});

test('ce qui a dépassé la durée de conservation est retiré', () => {
  const a = officine('Vieille officine');
  const d = bon(a.id, 'ANCIEN');
  // On le vieillit de deux ans.
  d.createdAt = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

  const retirees = store.purgerAnciennes();
  assert.ok(retirees.bons >= 1, 'le bon périmé est resté');
  assert.equal(store.getDrafts(a.id).find((x) => x.id === d.id), undefined,
    'le bon périmé est toujours consultable');
});

test('la purge ne touche pas à ce qui est encore dans les délais', () => {
  const a = officine('Officine récente');
  bon(a.id, 'RECENT-1');
  bon(a.id, 'RECENT-2');
  store.purgerAnciennes();
  assert.equal(store.getDrafts(a.id).length, 2, 'des bons récents ont été effacés');
});
