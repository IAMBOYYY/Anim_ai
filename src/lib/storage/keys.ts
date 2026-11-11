import {
  decryptWithDeviceKey,
  decryptWithPassphrase,
  encryptWithDeviceKey,
  encryptWithPassphrase,
  generateDeviceKey,
  randomSalt,
  type EncryptedBlob,
} from "@/lib/crypto";
import { idbDelete, idbGet, idbGetAll, idbPut } from "./db";

export interface EncryptedKeyRecord {
  providerId: string;
  blob: EncryptedBlob;
  salt: string;
  /** "device" = random local key; "passphrase" = PBKDF2 from user passphrase */
  mode: "device" | "passphrase";
  updatedAt: number;
  /** non-reversible display hint */
  fingerprint: string;
}

interface MetaRecord {
  id: "crypto";
  deviceKey?: string;
  salt?: string;
  passphraseProtected?: boolean;
  keyCount?: number;
}

async function getMeta(): Promise<MetaRecord> {
  return (await idbGet<MetaRecord>("meta", "crypto")) ?? { id: "crypto" };
}

async function setMeta(patch: Partial<MetaRecord>): Promise<void> {
  const current = await getMeta();
  await idbPut("meta", { ...current, ...patch, id: "crypto" });
}

export async function ensureDeviceKey(): Promise<string> {
  const meta = await getMeta();
  if (meta.deviceKey) return meta.deviceKey;
  const key = await generateDeviceKey();
  await setMeta({ deviceKey: key });
  return key;
}

export async function isPassphraseProtected(): Promise<boolean> {
  return Boolean((await getMeta()).passphraseProtected);
}

export async function hasStoredKeys(): Promise<boolean> {
  const all = await idbGetAll<EncryptedKeyRecord>("keys");
  return all.length > 0;
}

export async function listKeyRecords(): Promise<EncryptedKeyRecord[]> {
  return idbGetAll<EncryptedKeyRecord>("keys");
}

/**
 * Save an API key encrypted at rest.
 * If a passphrase is in use (`passphrase` provided), the key is bound to it.
 */
export async function saveKey(
  providerId: string,
  plaintext: string,
  fingerprint: string,
  passphrase?: string | null
): Promise<void> {
  const existing = await idbGet<EncryptedKeyRecord>("keys", providerId);
  const mode: EncryptedKeyRecord["mode"] = passphrase ? "passphrase" : existing?.mode === "passphrase" ? "passphrase" : "device";

  if (mode === "passphrase") {
    if (!passphrase) throw new Error("Passphrase required to store this key");
    const salt = existing?.mode === "passphrase" && existing.salt ? existing.salt : (await getMeta()).salt ?? randomSalt();
    const blob = await encryptWithPassphrase(plaintext, passphrase, salt);
    await idbPut<EncryptedKeyRecord>("keys", { providerId, blob, salt, mode, updatedAt: Date.now(), fingerprint });
    await setMeta({ salt, passphraseProtected: true });
  } else {
    const deviceKey = await ensureDeviceKey();
    const blob = await encryptWithDeviceKey(plaintext, deviceKey);
    await idbPut<EncryptedKeyRecord>("keys", { providerId, blob, salt: "", mode: "device", updatedAt: Date.now(), fingerprint });
  }

  const all = await listKeyRecords();
  await setMeta({ keyCount: all.length });
}

export async function removeKey(providerId: string): Promise<void> {
  await idbDelete("keys", providerId);
  const all = await listKeyRecords();
  await setMeta({ keyCount: all.length });
  if (all.length === 0) await setMeta({ passphraseProtected: false, salt: undefined });
}

export async function readKey(providerId: string, passphrase?: string | null): Promise<string | undefined> {
  const rec = await idbGet<EncryptedKeyRecord>("keys", providerId);
  if (!rec) return undefined;
  if (rec.mode === "passphrase") {
    if (!passphrase) throw new Error("UNLOCK_REQUIRED");
    try {
      return await decryptWithPassphrase(rec.blob, passphrase, rec.salt);
    } catch {
      throw new Error("WRONG_PASSPHRASE");
    }
  }
  const deviceKey = await ensureDeviceKey();
  try {
    return await decryptWithDeviceKey(rec.blob, deviceKey);
  } catch {
    throw new Error("KEY_DECRYPT_FAILED");
  }
}

export async function readAllKeys(passphrase?: string | null): Promise<Record<string, string>> {
  const records = await listKeyRecords();
  const out: Record<string, string> = {};
  for (const rec of records) {
    const value = await readKey(rec.providerId, passphrase);
    if (value) out[rec.providerId] = value;
  }
  return out;
}

/** Set / change the app passphrase (re-encrypts all stored keys). */
export async function setPassphrase(passphrase: string | null, currentPassphrase?: string | null): Promise<void> {
  const records = await listKeyRecords();

  if (passphrase) {
    const salt = randomSalt();
    for (const rec of records) {
      const plain = await readKey(rec.providerId, currentPassphrase ?? undefined);
      if (!plain) continue;
      const blob = await encryptWithPassphrase(plain, passphrase, salt);
      await idbPut<EncryptedKeyRecord>("keys", { ...rec, blob, salt, mode: "passphrase", updatedAt: Date.now() });
    }
    await setMeta({ passphraseProtected: true, salt });
  } else {
    const deviceKey = await ensureDeviceKey();
    for (const rec of records) {
      const plain = await readKey(rec.providerId, currentPassphrase ?? undefined);
      if (!plain) continue;
      const blob = await encryptWithDeviceKey(plain, deviceKey);
      await idbPut<EncryptedKeyRecord>("keys", { ...rec, blob, salt: "", mode: "device", updatedAt: Date.now() });
    }
    await setMeta({ passphraseProtected: false, salt: undefined });
  }
}
