/**
 * WebCrypto helpers for encrypting API keys at rest in IndexedDB.
 * - With a passphrase: PBKDF2 (210k, SHA-256) → AES-GCM 256.
 * - Without: a device-local random key is generated once and kept in IndexedDB.
 *   Keys are never stored in plaintext and never leave the browser.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const PBKDF2_ITERATIONS = 210_000;

export interface EncryptedBlob {
  v: 1;
  iv: string; // base64
  ct: string; // base64
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function unb64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function randomSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function encryptWithPassphrase(
  plaintext: string,
  passphrase: string,
  salt: string
): Promise<EncryptedBlob> {
  const key = await deriveKey(passphrase, unb64(salt));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

export async function decryptWithPassphrase(blob: EncryptedBlob, passphrase: string, salt: string): Promise<string> {
  const key = await deriveKey(passphrase, unb64(salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) as BufferSource }, key, unb64(blob.ct) as BufferSource);
  return dec.decode(pt);
}

export async function generateDeviceKey(): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return b64(raw);
}

export async function encryptWithDeviceKey(plaintext: string, deviceKey: string): Promise<EncryptedBlob> {
  const key = await crypto.subtle.importKey("raw", unb64(deviceKey) as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

export async function decryptWithDeviceKey(blob: EncryptedBlob, deviceKey: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", unb64(deviceKey) as BufferSource, { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) as BufferSource }, key, unb64(blob.ct) as BufferSource);
  return dec.decode(pt);
}

/** Derive a fingerprint of the key for UI display (never reversible). */
export async function keyFingerprint(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(plaintext));
  return b64(digest).slice(0, 10);
}
