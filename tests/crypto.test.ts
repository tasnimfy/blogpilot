import { describe, it, expect, beforeEach } from "vitest";
import { encryptSecret, decryptSecret, redactSecrets, isEncrypted } from "@/lib/crypto";
import { resetDb } from "./helpers";

describe("credential encryption", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("round-trips a secret", () => {
    const enc = encryptSecret("sk-or-very-secret-key");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("sk-or-very-secret-key");
    expect(decryptSecret(enc)).toBe("sk-or-very-secret-key");
  });

  it("produces unique ciphertext each time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptSecret("secret");
    const tampered = enc.slice(0, -2) + (enc.endsWith("00") ? "ff" : "00");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("redacts sensitive keys from objects and logs", () => {
    const out = redactSecrets({
      apiKey: "sk-secret",
      password: "pw",
      username: "bob",
      nested: { token: "abc", safe: "keep" },
      list: ["a", "b"],
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe("••••••••");
    expect(out.password).toBe("••••••••");
    expect((out.nested as Record<string, unknown>).token).toBe("••••••••");
    expect((out.nested as Record<string, unknown>).safe).toBe("keep");
    expect(out.username).toBe("bob");
  });
});
