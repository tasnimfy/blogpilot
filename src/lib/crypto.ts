import crypto from "node:crypto";
import { env } from "@/lib/env";

const ALGO = "aes-256-gcm";
const VERSION = "v1";

// Encrypted payload format: enc:v1:<ivHex>:<authTagHex>:<ciphertextHex>
export function encryptSecret(plaintext: string): string {
  const key = Buffer.from(env().APP_ENC_KEY, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    "enc",
    VERSION,
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== VERSION) {
    throw new Error("Unsupported or malformed encrypted payload");
  }
  const key = Buffer.from(env().APP_ENC_KEY, "hex");
  const iv = Buffer.from(parts[2], "hex");
  const authTag = Buffer.from(parts[3], "hex");
  const data = Buffer.from(parts[4], "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Failed to decrypt secret (encryption key may have changed)");
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith("enc:v1:");
}

// Redact sensitive values in logs/errors. Never log plaintext secrets.
const SENSITIVE_KEY = /key|secret|password|token|credential|authorization|api[-_]?key/i;

export function redactSecrets(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") {
    // Values themselves are preserved; sensitivity is decided by their key.
    return input;
  }
  if (Array.isArray(input)) return input.map((v) => redactSecrets(v));
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "••••••••";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return input;
}
