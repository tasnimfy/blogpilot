import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { getResearchConfig, updateResearchConfig, ResearchConfigError } from "@/server/research-config.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("research configuration", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  it("defaults to a null config", async () => {
    expect(await getResearchConfig(siteId)).toBeNull();
  });

  it("updates and returns research settings with array fields", async () => {
    const cfg = await updateResearchConfig(
      siteId,
      {
        enabled: true,
        researchInstructions: "Find first-hand rafting experiences",
        permittedDomains: ["reddit.com", "tripadvisor.com"],
        communityPlatforms: ["REDDIT", "TRIPADVISOR"],
        minIndependentSources: 4,
        minSourceQuality: "HIGH",
        communityEvidenceMandatory: true,
        countryScope: "USA",
      },
      admin.id
    );
    expect(cfg?.enabled).toBe(true);
    expect(cfg?.permittedDomains).toEqual(["reddit.com", "tripadvisor.com"]);
    expect(cfg?.communityPlatforms).toEqual(["REDDIT", "TRIPADVISOR"]);
    expect(cfg?.minIndependentSources).toBe(4);
    expect(cfg?.minSourceQuality).toBe("HIGH");
  });

  it("is isolated per site", async () => {
    const other = (await createTestSite("Other", "other.com")).id;
    await updateResearchConfig(siteId, { enabled: true, minIndependentSources: 5 }, admin.id);
    const otherCfg = await getResearchConfig(other);
    expect(otherCfg?.enabled).toBeFalsy();
    expect(otherCfg?.minIndependentSources ?? 3).toBe(3);
  });

  it("fails on a missing site", async () => {
    await expect(updateResearchConfig("missing", { enabled: true }, admin.id)).rejects.toThrow(ResearchConfigError);
  });
});
