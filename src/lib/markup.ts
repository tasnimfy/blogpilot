// Markup conversion + sanitization primitives for the Article Studio editor.
//
// Persisted and exported article content is HTML (the format WordPress
// expects). Legacy drafts are stored as markdown: they are detected and
// converted on read/export, and AI generators now save HTML directly. Nothing
// is ever rendered or exported without passing through sanitization.
//
// This module is server-safe (no DOM required). Client-side sanitization that
// mirrors this allowlist lives in ./markup-client.ts.

import { marked } from "marked";
import sanitizeHtmlLib from "sanitize-html";

// Allowlist shared conceptually with the client (markup-client.ts). Keep the
// two lists in sync: only tags/attributes listed here may survive rendering.
export const MARKUP_ALLOWED_TAGS = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "pre", "code",
  "strong", "b", "em", "i", "u", "s",
  "a", "img",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "figure", "figcaption", "hr", "br", "span",
] as const;

const MARKUP_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "title", "width", "height"],
  th: ["colspan", "rowspan", "scope"],
  td: ["colspan", "rowspan"],
  span: [],
  "*": [],
};

const MARKUP_ALLOWED_SCHEMES = ["http", "https", "mailto"] as const;

// Server-side sanitization (sanitize-html). Used before persisting HTML from
// the editor, before storing AI output, and before exporting to WordPress.
export function sanitizeHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: [...MARKUP_ALLOWED_TAGS],
    allowedAttributes: MARKUP_ALLOWED_ATTRIBUTES,
    allowedSchemes: [...MARKUP_ALLOWED_SCHEMES],
    // Anchor links with a target are forced to open safely (href preserved).
    transformTags: {
      a: (tagName, attribs) => ({ tagName: "a", attribs: { ...(attribs ?? {}), rel: "noopener noreferrer" } }),
    },
    // Anything not in the allowlist is discarded entirely (script, iframe,
    // object, embed, style, form, ...), including their contents.
    disallowedTagsMode: "discard",
  });
}

// Convert model/legacy markdown to sanitized HTML. marked does not sanitize;
// we always run the result through the allowlist before it can be stored.
export function markdownToHtml(markdown: string): string {
  const raw = marked.parse(markdown ?? "", { async: false, gfm: true, breaks: false }) as string;
  return sanitizeHtml(raw);
}

export function looksLikeHtml(body: string | null | undefined): boolean {
  if (!body) return false;
  return /<(p|h[1-6]|ul|ol|li|blockquote|pre|table|figure|img|a|div|hr|br|strong|em)\b[^>]*>/i.test(body);
}

// Heuristic used to detect legacy markdown bodies. Deliberately conservative:
// plain text and HTML are never misclassified as markdown, so existing drafts
// are never rewritten unexpectedly.
export function looksLikeMarkdown(body: string | null | undefined): boolean {
  if (!body || !body.trim()) return false;
  if (looksLikeHtml(body)) return false;
  return (
    /(?:^|\n)\s{0,3}#{1,6}\s/.test(body) || // ATX headings
    /(?:^|\n)\s{0,3}[-*+]\s+/.test(body) || // bullet lists
    /(?:^|\n)\s{0,3}\d+[.)]\s+/.test(body) || // ordered lists
    /(?:^|\n)\s{0,3}>\s/.test(body) || // blockquotes
    /```/.test(body) || // fenced code blocks
    /\*\*[^*]+\*\*/.test(body) || // bold
    /__[^_]+__/.test(body) || // bold alt
    /\[[^\]]+\]\([^)\s)]+\)/.test(body) // links [t](url)
  );
}

// Best-effort HTML → readable text (used for stats and SEO analysis only;
// the output is never re-inserted into documents).
export function htmlToText(html: string): string {
  return (html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize any stored body into editor-ready HTML: legacy markdown is
// converted, HTML is sanitized, plain text passes through unchanged.
export function toEditorHtml(body: string | null | undefined): string {
  if (!body) return "";
  if (looksLikeMarkdown(body)) return markdownToHtml(body);
  if (looksLikeHtml(body)) return sanitizeHtml(body);
  return body;
}