import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, privateDecrypt, createDecipheriv, constants } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seal } from './diagnostics.mjs';

test('failure diagnostics round-trip only with the owner private key', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const plaintext = Buffer.from('synthetic private compiler output and sample credential');
  const envelope = seal(plaintext, publicKey);
  assert(!envelope.includes(plaintext.toString()));
  const value = JSON.parse(envelope);
  const key = privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(value.wrappedKey, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  assert.deepEqual(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]), plaintext);
  const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.throws(() => privateDecrypt({ key: wrongKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(value.wrappedKey, 'base64')));
});

test('public workflow has no PR/push triggers or source caches', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8');
  assert(!/pull_request|repository_dispatch|^\s+push:|actions\/cache|cache:\s*(npm|pnpm)/m.test(workflow));
  assert(workflow.includes('workflow_dispatch:'));
  assert(workflow.includes("github.actor == 'ESCANOR-001'"));
  assert(workflow.includes('contents: read'));
  assert(!workflow.includes('contents: write'));
  assert(workflow.includes('path: diagnostics/*.sealed.json'));
  assert(!workflow.includes('path: source/'));
});

test('raw stage output is file-only, diagnostics encryption has no plaintext fallback', () => {
  const runner = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  assert(runner.includes("stdio: ['ignore', fd, fd]"));
  assert(!/console\.(log|error)\((error|output|stderr|stdout)/.test(runner));
  assert(runner.includes('GITHUB_SHA: config.commit'));
  assert(runner.includes('if (process.argv[2] === \'build\')'));
  assert(runner.includes('Fail closed: no plaintext diagnostic fallback'));
});
