// Lightweight structural analysis used by the SEO analyzer. Supports both
// markdown bodies (legacy drafts) and HTML bodies (the current editor format).

import { looksLikeHtml, htmlToText } from "@/lib/markup";

export interface MarkdownAnalysis {
  headings: { level: number; text: string }[];
  h1: { level: number; text: string }[];
  h2: { level: number; text: string }[];
  h3plus: { level: number; text: string }[];
  links: { text: string; href: string }[];
  words: number;
  sentences: number;
  paragraphs: number;
  avgSentenceWords: number | null;
  hasStructuredData: boolean;
}

export function analyzeMarkdown(body: string): MarkdownAnalysis {
  const headings: { level: number; text: string }[] = [];
  const links: { text: string; href: string }[] = [];
  let hasStructuredData = /"@type"\s*:|application\/ld\+json/i.test(body);
  let sentenceCount = 0;
  let paragraphCount = 0;

  const lines = body.split(/\r?\n/);
  const textChunks: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      headings.push({ level: h[1].length, text: stripMd(h[2].trim()) });
      continue;
    }
    if (/^\s*[-*]\s|^\s*\d+[.)]\s/.test(line)) {
      textChunks.push(line);
      continue;
    }
    if (line === "") {
      if (textChunks.length && textChunks[textChunks.length - 1] !== "") paragraphCount++;
      continue;
    }
    // links
    const linkRe = /\[([^\]]*)\]\(([^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(line)) !== null) {
      links.push({ text: m[1].trim(), href: m[2] });
    }
    textChunks.push(line);
  }
  if (textChunks.length && textChunks[textChunks.length - 1] !== "") paragraphCount++;

  const fullText = textChunks.join(" ").replace(/[#*`>]/g, " ");
  const words = fullText.split(/\s+/).filter(Boolean).length;
  // Sentence splitting: count sentence-ending punctuation.
  const sentences = (fullText.match(/[.!?]+(\s|$)/g) || []).length || (words > 0 ? 1 : 0);
  const avgSentenceWords = sentences > 0 ? Math.round(words / sentences) : null;

  return {
    headings,
    h1: headings.filter((h) => h.level === 1),
    h2: headings.filter((h) => h.level === 2),
    h3plus: headings.filter((h) => h.level >= 3),
    links,
    words,
    sentences,
    paragraphs: Math.max(paragraphCount, 1),
    avgSentenceWords,
    hasStructuredData,
  };
}

function stripMd(s: string): string {
  return s.replace(/[*_`]/g, "").trim();
}

// --- HTML analysis (regex/tokenizer on trusted, sanitized content) ----------
// Analysis only: extracted text/links are never re-inserted into documents, so
// a lightweight tokenizer is sufficient and avoids a full DOM dependency.

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export function analyzeHtml(body: string): MarkdownAnalysis {
  const headings: { level: number; text: string }[] = [];
  const links: { text: string; href: string }[] = [];

  const hRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hRe.exec(body)) !== null) {
    headings.push({ level: Number(hm[1]), text: stripHtmlTags(hm[2]) });
  }

  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = aRe.exec(body)) !== null) {
    links.push({ text: stripHtmlTags(am[2]), href: am[1] });
  }

  const fullText = htmlToText(body);
  const words = fullText.split(/\s+/).filter(Boolean).length;
  const sentences = (fullText.match(/[.!?]+(\s|$)/g) || []).length || (words > 0 ? 1 : 0);
  const paragraphs = (body.match(/<(p|blockquote|pre|table)\b/gi) || []).length || (words > 0 ? 1 : 0);
  const avgSentenceWords = sentences > 0 ? Math.round(words / sentences) : null;

  return {
    headings,
    h1: headings.filter((h) => h.level === 1),
    h2: headings.filter((h) => h.level === 2),
    h3plus: headings.filter((h) => h.level >= 3),
    links,
    words,
    sentences,
    paragraphs: Math.max(paragraphs, 1),
    avgSentenceWords,
    hasStructuredData: /"@type"\s*:|application\/ld\+json/i.test(body),
  };
}

// Dispatch: HTML bodies go through the HTML analyzer, everything else (legacy
// markdown + plain text) through the markdown analyzer.
export function analyzeBody(body: string): MarkdownAnalysis {
  return looksLikeHtml(body) ? analyzeHtml(body) : analyzeMarkdown(body);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
