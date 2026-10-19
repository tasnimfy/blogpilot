import { describe, it, expect } from "vitest";
import {
  SITE_ROLES,
  SITE_PERMISSIONS,
  hasSitePermission,
  permitsPublish,
  isSiteRole,
} from "@/lib/permissions";

describe("permission matrix (deny by default)", () => {
  it("every declared permission is granted to the OWNER", () => {
    for (const p of SITE_PERMISSIONS) {
      expect(hasSitePermission("OWNER", p)).toBe(true);
    }
  });

  it("VIEWER is read-only", () => {
    expect(hasSitePermission("VIEWER", "site.view")).toBe(true);
    for (const p of SITE_PERMISSIONS) {
      if (p !== "site.view") expect(hasSitePermission("VIEWER", p)).toBe(false);
    }
  });

  it("WRITER can create/edit/generate drafts and manage images, but never publish or approve", () => {
    for (const p of ["site.view", "drafts.create", "drafts.edit", "drafts.generate", "images.manage", "seo.analyze"]) {
      expect(hasSitePermission("WRITER", p as any)).toBe(true);
    }
    for (const p of ["drafts.approve", "drafts.publish", "settings.manage", "keywords.manage", "access.manage"]) {
      expect(hasSitePermission("WRITER", p as any)).toBe(false);
    }
  });

  it("EDITOR adds approval but publication stays gated on an explicit grant", () => {
    expect(hasSitePermission("EDITOR", "drafts.approve")).toBe(true);
    expect(hasSitePermission("EDITOR", "drafts.publish")).toBe(false);
    expect(permitsPublish("EDITOR", false)).toBe(false);
    expect(permitsPublish("EDITOR", true)).toBe(true);
  });

  it("SEO_MANAGER manages research surfaces but not drafts or settings", () => {
    for (const p of ["site.view", "keywords.manage", "research.manage", "opportunities.manage", "trends.manage", "automation.manage", "seo.analyze"]) {
      expect(hasSitePermission("SEO_MANAGER", p as any)).toBe(true);
    }
    for (const p of ["drafts.create", "drafts.edit", "drafts.publish", "settings.manage", "access.manage"]) {
      expect(hasSitePermission("SEO_MANAGER", p as any)).toBe(false);
    }
  });

  it("ADMIN manages settings/access/integrations but cannot destroy the site", () => {
    expect(hasSitePermission("ADMIN", "site.delete")).toBe(false);
    for (const p of ["site.view", "settings.manage", "access.manage", "keywords.manage", "research.manage", "opportunities.manage", "trends.manage", "automation.manage", "drafts.publish"]) {
      expect(hasSitePermission("ADMIN", p as any)).toBe(true);
    }
  });

  it("permitsPublish only ever allows OWNER/ADMIN unconditionally", () => {
    expect(permitsPublish("OWNER", false)).toBe(true);
    expect(permitsPublish("ADMIN", false)).toBe(true);
    for (const role of ["WRITER", "SEO_MANAGER", "VIEWER"] as const) {
      expect(permitsPublish(role, true)).toBe(false);
      expect(permitsPublish(role, false)).toBe(false);
    }
  });

  it("isSiteRole accepts only the six site roles", () => {
    for (const r of SITE_ROLES) expect(isSiteRole(r)).toBe(true);
    expect(isSiteRole("OPERATOR")).toBe(false);
    expect(isSiteRole("superuser")).toBe(false);
  });

  it("denies unknown permission strings (no accidental grants)", () => {
    expect(hasSitePermission("OWNER", "anything.else" as any)).toBe(false);
    expect(hasSitePermission("ADMIN", "site.export" as any)).toBe(false);
  });
});