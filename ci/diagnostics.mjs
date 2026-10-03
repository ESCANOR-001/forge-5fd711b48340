import { randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto';

export function seal(bytes, publicKey) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const wrappedKey = publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, key);
  return JSON.stringify({ schemaVersion: 1, algorithm: 'RSA-OAEP-SHA256+AES-256-GCM',
    wrappedKey: wrappedKey.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
}
