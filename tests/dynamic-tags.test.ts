import { describe, it, expect } from "vitest";
import { expandDynamicTags, SUPPORTED_TAGS } from "@/lib/dynamic-tags";

describe("dynamic tags", () => {
  const ctx = {
    siteName: "White Rafting",
    siteDomain: "whiterafting.com",
    timezone: "UTC",
    now: new Date("2026-10-18T12:00:00Z"),
  };

  it("expands supported tags", () => {
    const r = expandDynamicTags("Best trips [year] — [month] [day]", ctx);
    expect(r.text).toContain("Best trips 2026");
    expect(r.text).toContain("October");
    expect(r.warnings).toHaveLength(0);
  });

  it("expands month_number, date and next year", () => {
    const r = expandDynamicTags("[date] [month_number] [current_year_plus_1]", ctx);
    expect(r.text).toBe("2026-10-18 10 2027");
  });

  it("expands site name and domain", () => {
    const r = expandDynamicTags("By [site_name] at [site_domain]", ctx);
    expect(r.text).toBe("By White Rafting at whiterafting.com");
  });

  it("warns on unknown tags and leaves them in place", () => {
    const r = expandDynamicTags("Hello [bogus_tag] [year]", ctx);
    expect(r.text).toContain("[bogus_tag]");
    expect(r.text).toContain("2026");
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("bogus_tag");
  });

  it("never executes arbitrary code from tag content", () => {
    const payload = "x [process]; [constructor]; [1+1]";
    const r = expandDynamicTags(payload, ctx);
    // `[process]` and `[constructor]` are unknown tags -> warnings, left in place.
    // `[1+1]` is not a valid tag name, so it is left completely untouched.
    expect(r.warnings.length).toBe(2);
    expect(r.text).toContain("[process]");
    expect(r.text).toContain("[constructor]");
    expect(r.text).toContain("[1+1]");
  });

  it("respects the site timezone for date tags", () => {
    // 2026-10-18 01:00 UTC == previous day in America/Los_Angeles
    const r = expandDynamicTags("[date]", { ...ctx, now: new Date("2026-10-18T01:00:00Z"), timezone: "America/Los_Angeles" });
    expect(r.text).toBe("2026-10-17");
  });

  it("exports a safe, explicit supported-tag registry", () => {
    expect(SUPPORTED_TAGS).toContain("year");
    expect(SUPPORTED_TAGS).toContain("site_domain");
    expect(SUPPORTED_TAGS).toContain("current_year_plus_1");
  });
});
