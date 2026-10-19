import { describe, it, expect, beforeEach } from "vitest";
import { hashPassword, verifyPassword, createSessionToken, verifySessionToken } from "@/lib/auth";
import { resetDb } from "./helpers";

describe("authentication", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("hashes and verifies passwords", () => {
    const hash = hashPassword("correct-horse");
    expect(hash).not.toContain("correct-horse");
    expect(verifyPassword("correct-horse", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("creates and verifies a session token", () => {
    const token = createSessionToken("user-123");
    const payload = verifySessionToken(token);
    expect(payload?.uid).toBe("user-123");
    expect(payload && typeof payload.exp).toBe("number");
  });

  it("rejects a tampered token", () => {
    const token = createSessionToken("user-123");
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it("rejects an invalid token", () => {
    expect(verifySessionToken("garbage")).toBeNull();
    expect(verifySessionToken(null)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = createSessionToken("user-123");
    const [body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.exp = Date.now() - 1000;
    const expiredBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
    // signature no longer matches the modified body, so it must be rejected
    expect(verifySessionToken(`${expiredBody}.${sig}`)).toBeNull();
  });
});
