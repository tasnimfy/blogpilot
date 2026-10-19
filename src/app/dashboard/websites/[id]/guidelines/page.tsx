"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Input, Alert } from "@/components/ui";
import { SiteTabs } from "@/components/SiteTabs";

const empty = {
  brandVoice: "", writingStyle: "", spellingVariant: "", formalityLevel: "",
  targetReader: "", readingComplexity: "", contentDepth: "", articleStructure: "",
  introStyle: "", internalLinking: "", externalLinking: "", brandInstructions: "",
  customInstructions: "", avoidPhrases: "[]", verifyClaims: "[]", editorialChecklist: "[]",
};

type G = typeof empty;

export default function GuidelinesPage() {
  const { id } = useParams<{ id: string }>();
  const [g, setG] = useState<G>(empty);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/websites/${id}/guidelines`);
      const data = await res.json();
      if (data.guidelines) setG({ ...empty, ...data.guidelines });
      setLoaded(true);
    })();
  }, [id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false); setError(null);
    const payload = {
      ...g,
      avoidPhrases: parseArr(g.avoidPhrases),
      verifyClaims: parseArr(g.verifyClaims),
      editorialChecklist: parseArr(g.editorialChecklist),
      brandVoice: g.brandVoice || null, writingStyle: g.writingStyle || null,
      spellingVariant: g.spellingVariant || null, formalityLevel: g.formalityLevel || null,
      targetReader: g.targetReader || null, readingComplexity: g.readingComplexity || null,
      contentDepth: g.contentDepth || null, articleStructure: g.articleStructure || null,
      introStyle: g.introStyle || null, internalLinking: g.internalLinking || null,
      externalLinking: g.externalLinking || null, brandInstructions: g.brandInstructions || null,
      customInstructions: g.customInstructions || null,
    };
    const res = await fetch(`/api/websites/${id}/guidelines`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || "Failed to save");
    else { setSaved(true); if (data.guidelines) setG({ ...empty, ...data.guidelines }); }
  }

  if (!loaded) return <div className="text-sm text-slate-500">Loading…</div>;

  const fields: [keyof G, string, string][] = [
    ["brandVoice", "Brand voice", ""],
    ["writingStyle", "Writing style", ""],
    ["spellingVariant", "Spelling variant", "e.g. en-US, en-GB"],
    ["formalityLevel", "Formality level", "e.g. Casual, Neutral, Formal"],
    ["targetReader", "Target reader", ""],
    ["readingComplexity", "Reading complexity", "e.g. Simple, Moderate, Advanced"],
    ["contentDepth", "Content depth", "e.g. Beginner guide, In-depth expert"],
    ["articleStructure", "Preferred article structure", ""],
    ["introStyle", "Preferred introduction style", ""],
    ["internalLinking", "Internal linking guidelines", ""],
    ["externalLinking", "External linking guidelines", ""],
    ["brandInstructions", "Brand-specific instructions", ""],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/websites/${id}`} className="text-sm text-blue-600 hover:underline">← Back to site</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Editorial guidelines</h1>
      </div>
      <SiteTabs siteId={id} />
      <Card title="Writing guidelines for this site" description="These instructions are incorporated into research and article generation.">
        <form onSubmit={save} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {fields.map(([key, label, hint]) => (
            <Field key={key} label={label} hint={hint}>
              <Input value={String(g[key] ?? "")} onChange={(e) => setG({ ...g, [key]: e.target.value })} />
            </Field>
          ))}
          <div className="md:col-span-2">
            <Field label="Phrases/expressions to avoid (one per line)">
              <textarea rows={3} value={arrToLines(g.avoidPhrases)} onChange={(e) => setG({ ...g, avoidPhrases: linesToArr(e.target.value) })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Claims that require verification (one per line)">
              <textarea rows={3} value={arrToLines(g.verifyClaims)} onChange={(e) => setG({ ...g, verifyClaims: linesToArr(e.target.value) })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Required editorial checklist (one per line)">
              <textarea rows={4} value={arrToLines(g.editorialChecklist)} onChange={(e) => setG({ ...g, editorialChecklist: linesToArr(e.target.value) })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Custom instructions for the AI">
              <textarea rows={6} value={g.customInstructions} onChange={(e) => setG({ ...g, customInstructions: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
          </div>
          {error && <div className="md:col-span-2"><Alert tone="red">{error}</Alert></div>}
          {saved && <div className="md:col-span-2"><Alert tone="green">Saved.</Alert></div>}
          <div className="md:col-span-2 flex justify-end"><Button type="submit">Save guidelines</Button></div>
        </form>
      </Card>
    </div>
  );
}

function parseArr(v: string): string[] { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
function arrToLines(v: string): string { return parseArr(v).join("\n"); }
function linesToArr(v: string): string { return JSON.stringify(v.split("\n").map((x) => x.trim()).filter(Boolean)); }
