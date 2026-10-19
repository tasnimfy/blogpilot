// Central, deny-by-default role/permission model for per-website access.
// Roles are stored as strings on WebsiteUserRole (SQLite has no enums) and
// validated here. The UI must never be treated as authorization — every
// protected operation goes through requireSitePermission() in lib/access.

export const SITE_ROLES = [
  "OWNER",
  "ADMIN",
  "SEO_MANAGER",
  "EDITOR",
  "WRITER",
  "VIEWER",
] as const;

export type SiteRole = (typeof SITE_ROLES)[number];

export const SITE_PERMISSIONS = [
  "site.view", // read access to the website and its data
  "site.delete", // destroy the website and all its data
  "settings.manage", // site policies, editorial guidelines, AI config, WordPress connection
  "access.manage", // manage memberships/roles on the website
  "keywords.manage", // keyword buckets, keyword records, CSV/GSC imports
  "research.manage", // research configuration, jobs, sources, findings
  "opportunities.manage", // content opportunities, scoring, approvals
  "trends.manage", // trends monitoring configs, runs, CSV import
  "automation.manage", // background jobs and scheduled runs
  "drafts.create",
  "drafts.edit",
  "drafts.generate", // run AI outline/article generation
  "drafts.approve", // approve/reject editorial generation requests
  "drafts.publish", // publish to WordPress (explicit operator action)
  "images.manage",
  "seo.analyze", // run/store SEO analysis, query Rank Math status
] as const;

export type SitePermission = (typeof SITE_PERMISSIONS)[number];

// Role -> permissions matrix (deny by default: anything not listed is denied).
const ROLE_PERMISSIONS: Record<SiteRole, ReadonlySet<SitePermission>> = {
  VIEWER: new Set<SitePermission>(["site.view"]),

  WRITER: new Set<SitePermission>([
    "site.view",
    "drafts.create",
    "drafts.edit",
    "drafts.generate",
    "images.manage",
    "seo.analyze",
  ]),

  EDITOR: new Set<SitePermission>([
    "site.view",
    "drafts.create",
    "drafts.edit",
    "drafts.generate",
    "drafts.approve",
    "images.manage",
    "seo.analyze",
  ]),

  SEO_MANAGER: new Set<SitePermission>([
    "site.view",
    "keywords.manage",
    "research.manage",
    "opportunities.manage",
    "trends.manage",
    "automation.manage",
    "seo.analyze",
  ]),

  ADMIN: new Set<SitePermission>([
    "site.view",
    "settings.manage",
    "access.manage",
    "keywords.manage",
    "research.manage",
    "opportunities.manage",
    "trends.manage",
    "automation.manage",
    "drafts.create",
    "drafts.edit",
    "drafts.generate",
    "drafts.approve",
    "drafts.publish",
    "images.manage",
    "seo.analyze",
  ]),

  // OWNER has every permission, including the destructive site.delete.
  OWNER: new Set<SitePermission>(SITE_PERMISSIONS),
};

export function isSiteRole(value: string): value is SiteRole {
  return (SITE_ROLES as readonly string[]).includes(value);
}

export function hasSitePermission(role: SiteRole, permission: SitePermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

// Publication is additionally gated: EDITOR may publish only when the
// membership carries an explicit canPublish grant; WRITER/SEO_MANAGER/VIEWER
// can never publish. OWNER and ADMIN always can.
export function permitsPublish(role: SiteRole, canPublish: boolean): boolean {
  if (role === "OWNER" || role === "ADMIN") return true;
  if (role === "EDITOR") return canPublish;
  return false;
}