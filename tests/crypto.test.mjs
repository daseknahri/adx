import assert from 'node:assert/strict';
import test from 'node:test';

import { decryptSecret, encryptSecret } from '../server/crypto.js';

test('encrypts and decrypts stored Google token values', () => {
  const key = 'a'.repeat(64);
  const encrypted = encryptSecret('refresh-token-value', key);

  assert.notEqual(encrypted, 'refresh-token-value');
  assert.match(encrypted, /^v1:/);
  assert.equal(decryptSecret(encrypted, key), 'refresh-token-value');
});

test('passes through secrets when no encryption key is configured', () => {
  assert.equal(encryptSecret('plain-token', ''), 'plain-token');
  assert.equal(decryptSecret('plain-token', ''), 'plain-token');
});

