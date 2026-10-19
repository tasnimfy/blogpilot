import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createSite } from "@/server/website.service";
import {
  updateSettings,
  updateGuidelines,
  updateAiConfig,
  updateWordpress,
  serializeAiConfig,
  serializeWordpress,
  getDecryptedOpenRouterKey,
  getDecryptedWordpressPassword,
  SettingsServiceError,
} from "@/server/settings.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("per-site settings", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    const site = await createSite({ name: "Site", domain: "site.com", url: "https://site.com" }, admin.id);
    siteId = site.id;
  });

  it("updates settings scoped to the site", async () => {
    const s = await updateSettings(siteId, { minSources: 5, workflow: "DRAFT_FIRST", dynamicTags: false }, admin.id);
    expect(s.minSources).toBe(5);
    expect(s.dynamicTags).toBe(false);
  });

  it("updates guidelines", async () => {
    const g = await updateGuidelines(siteId, { brandVoice: "Adventurous", avoidPhrases: ["elevate", "game-changer"] }, admin.id);
    expect(g.brandVoice).toBe("Adventurous");
    expect(JSON.parse(g.avoidPhrases ?? "[]")).toEqual(["elevate", "game-changer"]);
  });

  it("encrypts the OpenRouter key and never exposes it via serialization", async () => {
    await updateAiConfig(siteId, { apiKey: "sk-or-secret-123", preferredModel: "openai/gpt-4o" }, admin.id);
    const row = await prisma.aIProviderConfiguration.findUniqueOrThrow({ where: { websiteId: siteId } });
    expect(row.apiKeyEncrypted).not.toContain("sk-or-secret-123");
    expect(row.apiKeyEncrypted).toMatch(/^enc:v1:/);

    // Decrypted only through the server-side helper.
    expect(await getDecryptedOpenRouterKey(siteId)).toBe("sk-or-secret-123");

    // Serialized form hides the key.
    const safe = serializeAiConfig(row as never);
    expect(safe.hasApiKey).toBe(true);
    expect(JSON.stringify(safe)).not.toContain("sk-or-secret-123");
    expect(JSON.stringify(safe)).not.toContain("apiKeyEncrypted");
  });

  it("encrypts the WordPress application password and hides it on serialization", async () => {
    await updateWordpress(siteId, { siteUrl: "https://site.com", username: "admin", appPassword: "xxxx yyyy zzzz" }, admin.id);
    const row = await prisma.wordPressConnection.findUniqueOrThrow({ where: { websiteId: siteId } });
    expect(row.appPasswordEncrypted).toMatch(/^enc:v1:/);
    expect(await getDecryptedWordpressPassword(siteId)).toBe("xxxx yyyy zzzz");
    const safe = serializeWordpress(row as never);
    expect(safe.hasAppPassword).toBe(true);
    expect(JSON.stringify(safe)).not.toContain("xxxx");
  });

  it("requires HTTPS for the WordPress site URL", async () => {
    await expect(
      updateWordpress(siteId, { siteUrl: "http://site.com", username: "a", appPassword: "x" }, admin.id)
    ).rejects.toThrow(SettingsServiceError);
  });

  it("fails on a missing site", async () => {
    await expect(updateSettings("missing", {}, admin.id)).rejects.toThrow(SettingsServiceError);
  });

  it("keeps settings isolated between two sites", async () => {
    const other = await createTestSite("Other", "other.com");
    await updateSettings(siteId, { minSources: 9 }, admin.id);
    await updateSettings(other.id, { minSources: 2 }, admin.id);
    const s1 = await prisma.websiteSettings.findUniqueOrThrow({ where: { websiteId: siteId } });
    const s2 = await prisma.websiteSettings.findUniqueOrThrow({ where: { websiteId: other.id } });
    expect(s1.minSources).toBe(9);
    expect(s2.minSources).toBe(2);
  });
});
