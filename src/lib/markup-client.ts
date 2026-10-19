"use client";

// Client-side sanitization (DOMPurify) used by the editor for pasted content
// and by the preview renderer. Mirrors the server allowlist in ./markup.ts —
// keep the tags/attributes in sync.

import DOMPurify from "dompurify";
import { MARKUP_ALLOWED_TAGS } from "@/lib/markup";

export const CLIENT_ALLOWED_ATTRIBUTES = [
  "href", "title", "target", "rel",
  "src", "alt", "width", "height",
  "colspan", "rowspan", "scope",
];

// Runs only in the browser. In non-browser environments (SSR, tests that do
// not exercise DOMPurify) input passes through untouched.
export function sanitizeHtmlClient(html: string): string {
  if (typeof window === "undefined") return html;
  const dp = DOMPurify as unknown as {
    isSupported: boolean;
    sanitize: (input: string, config: Record<string, unknown>) => string;
  };
  if (!dp?.isSupported) return html;
  return dp.sanitize(html, {
    ALLOWED_TAGS: [...MARKUP_ALLOWED_TAGS],
    ALLOWED_ATTR: CLIENT_ALLOWED_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "textarea", "button"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick", "onmouseover", "onfocus", "formaction", "srcdoc"],
  });
}