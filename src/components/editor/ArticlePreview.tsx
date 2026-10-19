"use client";

// Read-only article preview. The stored HTML is sanitized with DOMPurify
// before rendering (mirrors the server allowlist) — nothing unsafe is ever
// injected into the DOM.

import { useMemo } from "react";
import { sanitizeHtmlClient } from "@/lib/markup-client";

export function ArticlePreview({ html, title }: { html: string; title?: string }) {
  const clean = useMemo(() => sanitizeHtmlClient(html ?? ""), [html]);
  return (
    <div className="rounded-md border border-slate-200 bg-white p-8" data-testid="article-preview">
      {title ? <h1 className="mb-6 text-3xl font-bold text-slate-900">{title}</h1> : null}
      {/* Sanitized above; never render unsanitized content. */}
      <div
        className="prose-preview mx-auto max-w-3xl"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      <p className="mt-6 border-t border-slate-100 pt-3 text-xs text-slate-400">
        Preview only — dynamic tags ([year], [month], [date], …) expand at save/publication time using the site&apos;s timezone.
      </p>
    </div>
  );
}