"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Input, Alert, Badge } from "@/components/ui";
import { SiteTabs } from "@/components/SiteTabs";

const empty = {
  preferredModel: "", fallbackModel: "", researchModel: "", writingModel: "",
  seoModel: "", maxOutputTokens: 4096, temperature: 0.7, maxRetries: 2,
  monthlyBudgetCents: null as number | null, maxCostPerArticleCents: null as number | null,
  hasApiKey: false,
};

type AI = typeof empty;

export default function AiConfigPage() {
  const { id } = useParams<{ id: string }>();
  const [ai, setAi] = useState<AI>(empty);
  const [newKey, setNewKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/websites/${id}/ai`);
      const data = await res.json();
      if (data.ai) setAi({ ...empty, ...data.ai });
      setLoaded(true);
    })();
  }, [id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false); setError(null);
    const payload: Record<string, unknown> = {
      preferredModel: ai.preferredModel || null, fallbackModel: ai.fallbackModel || null,
      researchModel: ai.researchModel || null, writingModel: ai.writingModel || null,
      seoModel: ai.seoModel || null, maxOutputTokens: ai.maxOutputTokens,
      temperature: ai.temperature, maxRetries: ai.maxRetries,
      monthlyBudgetCents: ai.monthlyBudgetCents, maxCostPerArticleCents: ai.maxCostPerArticleCents,
    };
    if (newKey.trim()) payload.apiKey = newKey.trim();
    const res = await fetch(`/api/websites/${id}/ai`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || "Failed to save");
    else { setSaved(true); setNewKey(""); if (data.ai) setAi({ ...empty, ...data.ai }); }
  }

  if (!loaded) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/websites/${id}`} className="text-sm text-blue-600 hover:underline">← Back to site</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">AI configuration</h1>
      </div>
      <SiteTabs siteId={id} />
      <Alert tone="blue">
        API keys are encrypted at rest with AES-256-GCM and are never returned to the browser or shown in logs. A global key from <code>OPENROUTER_API_KEY</code> is used as a default when no per-site key is set.
      </Alert>
      <Card title="OpenRouter settings">
        <form onSubmit={save} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label="OpenRouter API key" hint={ai.hasApiKey ? "A key is stored for this site. Enter a new value to replace it." : "No per-site key stored."}>
              <div className="flex items-center gap-2">
                <Input type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="sk-or-…" autoComplete="off" />
                <Badge tone={ai.hasApiKey ? "green" : "slate"}>{ai.hasApiKey ? "Key stored" : "No key"}</Badge>
              </div>
            </Field>
          </div>
          <Field label="Preferred model"><Input value={ai.preferredModel} onChange={(e) => setAi({ ...ai, preferredModel: e.target.value })} placeholder="openai/gpt-4o" /></Field>
          <Field label="Fallback model"><Input value={ai.fallbackModel} onChange={(e) => setAi({ ...ai, fallbackModel: e.target.value })} placeholder="openai/gpt-4o-mini" /></Field>
          <Field label="Research model"><Input value={ai.researchModel} onChange={(e) => setAi({ ...ai, researchModel: e.target.value })} /></Field>
          <Field label="Writing model"><Input value={ai.writingModel} onChange={(e) => setAi({ ...ai, writingModel: e.target.value })} /></Field>
          <Field label="SEO analysis model"><Input value={ai.seoModel} onChange={(e) => setAi({ ...ai, seoModel: e.target.value })} /></Field>
          <Field label="Max output tokens"><Input type="number" value={ai.maxOutputTokens} onChange={(e) => setAi({ ...ai, maxOutputTokens: Number(e.target.value) })} /></Field>
          <Field label="Temperature (0-2)"><Input type="number" step="0.1" min="0" max="2" value={ai.temperature} onChange={(e) => setAi({ ...ai, temperature: Number(e.target.value) })} /></Field>
          <Field label="Max retries"><Input type="number" min="0" value={ai.maxRetries} onChange={(e) => setAi({ ...ai, maxRetries: Number(e.target.value) })} /></Field>
          <Field label="Monthly budget (USD)" hint="Optional cap on AI spend for this site.">
            <Input type="number" min="0" value={ai.monthlyBudgetCents ? (ai.monthlyBudgetCents / 100).toFixed(2) : ""} placeholder="0.00" onChange={(e) => setAi({ ...ai, monthlyBudgetCents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} />
          </Field>
          <Field label="Max cost per article (USD)">
            <Input type="number" min="0" value={ai.maxCostPerArticleCents ? (ai.maxCostPerArticleCents / 100).toFixed(2) : ""} placeholder="0.00" onChange={(e) => setAi({ ...ai, maxCostPerArticleCents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} />
          </Field>
          {error && <div className="md:col-span-2"><Alert tone="red">{error}</Alert></div>}
          {saved && <div className="md:col-span-2"><Alert tone="green">Saved.</Alert></div>}
          <div className="md:col-span-2 flex justify-end"><Button type="submit">Save AI configuration</Button></div>
        </form>
      </Card>
    </div>
  );
}
