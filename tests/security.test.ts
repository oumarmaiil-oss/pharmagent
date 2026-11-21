import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { checkPassword, hashPassword } from '../src/server/store.ts';

test('mots de passe : scrypt salé, deux empreintes différentes pour le même mot de passe', () => {
  const a = hashPassword('Secret-123'), b = hashPassword('Secret-123');
  assert.match(a, /^s1\$/);
  assert.notEqual(a, b);
  assert.ok(checkPassword('Secret-123', a));
  assert.ok(!checkPassword('secret-123', a));
});

test('ancien format accepté (puis remplacé à la connexion)', () => {
  const legacy = createHash('sha256').update('vieux' + 'pharmagent-salt').digest('hex');
  assert.ok(checkPassword('vieux', legacy));
  assert.ok(!checkPassword('autre', legacy));
});
