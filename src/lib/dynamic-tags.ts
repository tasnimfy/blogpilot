// Dynamic-tag engine. Tags are expanded from an explicit registry only —
// arbitrary code is never executed from tag strings. Unknown tags produce a
// warning and are left in place (never silently replaced with empty text).

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface DynamicTagContext {
  siteName: string;
  siteDomain: string;
  timezone?: string; // IANA tz; defaults to UTC
  now?: Date;
}

export interface TagResolution {
  text: string;
  warnings: string[];
  usedTags: string[];
}

export const SUPPORTED_TAGS = [
  "year",
  "month",
  "month_number",
  "date",
  "day",
  "site_name",
  "site_domain",
  "current_year_plus_1",
] as const;

function formatDateParts(ctx: DynamicTagContext): { year: string; month: string; monthNumber: string; date: string; day: string } {
  const now = ctx.now ?? new Date();
  const tz = ctx.timezone && isTz(ctx.timezone) ? ctx.timezone : "UTC";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const monthNumber = get("month").padStart(2, "0");
  const year = get("year");
  const day = get("day").padStart(2, "0");
  // Recompute month name and weekday in the site timezone.
  const long = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long" }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);
  return {
    year,
    month: long,
    monthNumber,
    date: `${year}-${monthNumber}-${day}`,
    day: weekday,
  };
}

function isTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function expandDynamicTags(input: string, ctx: DynamicTagContext): TagResolution {
  const warnings: string[] = [];
  const usedTags: string[] = [];
  const p = formatDateParts(ctx);
  const nextYear = String(Number(p.year) + 1);

  const resolve: Record<string, string> = {
    year: p.year,
    month: p.month,
    month_number: p.monthNumber,
    date: p.date,
    day: p.day,
    site_name: ctx.siteName,
    site_domain: ctx.siteDomain,
    current_year_plus_1: nextYear,
  };

  // Regex matches [tag] where tag is alphanumeric + underscore.
  const text = input.replace(/\[([a-z0-9_]+)\]/gi, (match, name: string) => {
    const key = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(resolve, key)) {
      usedTags.push(key);
      return resolve[key];
    }
    warnings.push(`Unknown dynamic tag [${name}] was left unresolved`);
    return match;
  });

  return { text, warnings, usedTags };
}
