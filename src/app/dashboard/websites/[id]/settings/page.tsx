"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Input, Alert } from "@/components/ui";
import { SiteTabs } from "@/components/SiteTabs";

interface Settings {
  defaultPostType: string | null;
  defaultCategory: string | null;
  defaultTags: string | null;
  defaultAuthor: string | null;
  workflow: string;
  autoSeoMetadata: boolean;
  dynamicTags: boolean;
  imageInsertion: string;
  researchEnabled: boolean;
  minSources: number;
  minEditorialScore: number | null;
  defaultArticleLanguage: string;
}

const empty: Settings = {
  defaultPostType: "post",
  defaultCategory: null,
  defaultTags: "[]",
  defaultAuthor: null,
  workflow: "DRAFT_FIRST",
  autoSeoMetadata: true,
  dynamicTags: true,
  imageInsertion: "MANUAL",
  researchEnabled: true,
  minSources: 3,
  minEditorialScore: null,
  defaultArticleLanguage: "en",
};

export default function SiteSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Settings>(empty);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/websites/${id}/settings`);
      const data = await res.json();
      if (data.settings) setS({ ...empty, ...data.settings });
      setLoaded(true);
    })();
  }, [id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    const payload = { ...s, defaultTags: safeParseArr(s.defaultTags), minEditorialScore: s.minEditorialScore ?? null };
    const res = await fetch(`/api/websites/${id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || "Failed to save");
    else { setSaved(true); if (data.settings) setS({ ...empty, ...data.settings }); }
  }

  if (!loaded) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/websites/${id}`} className="text-sm text-blue-600 hover:underline">← Back to site</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Content policies</h1>
      </div>
      <SiteTabs siteId={id} />
      <Card title="Publishing & content policies">
        <form onSubmit={save} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Default post type"><Input value={s.defaultPostType ?? ""} onChange={(e) => setS({ ...s, defaultPostType: e.target.value })} /></Field>
          <Field label="Default category"><Input value={s.defaultCategory ?? ""} onChange={(e) => setS({ ...s, defaultCategory: e.target.value })} /></Field>
          <Field label="Default author"><Input value={s.defaultAuthor ?? ""} onChange={(e) => setS({ ...s, defaultAuthor: e.target.value })} /></Field>
          <Field label="Workflow">
            <select value={s.workflow} onChange={(e) => setS({ ...s, workflow: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="DRAFT_FIRST">Draft first, then publish manually</option>
              <option value="PUBLISH_DIRECT">Publish directly</option>
            </select>
          </Field>
          <Field label="Image insertion">
            <select value={s.imageInsertion} onChange={(e) => setS({ ...s, imageInsertion: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="NONE">None</option>
              <option value="MANUAL">Manual</option>
              <option value="AUTO">Automatic</option>
            </select>
          </Field>
          <Field label="Default article language"><Input value={s.defaultArticleLanguage} onChange={(e) => setS({ ...s, defaultArticleLanguage: e.target.value })} /></Field>
          <Field label="Minimum sources" hint="Research requires at least this many independent sources">
            <Input type="number" min={0} value={s.minSources} onChange={(e) => setS({ ...s, minSources: Number(e.target.value) })} />
          </Field>
          <Field label="Minimum editorial score (0-100)" hint="Optional. If set, publication is blocked below this score.">
            <Input type="number" min={0} max={100} value={s.minEditorialScore ?? ""} onChange={(e) => setS({ ...s, minEditorialScore: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Default tags (comma separated)">
            <Input value={arrToCsv(s.defaultTags)} onChange={(e) => setS({ ...s, defaultTags: csvToArr(e.target.value) })} />
          </Field>
          <div className="md:col-span-2 space-y-3">
            {[
              ["autoSeoMetadata", "Auto-generate SEO metadata"],
              ["dynamicTags", "Enable dynamic tags ([year], [site_name], …)"],
              ["researchEnabled", "Research enabled for this site"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={Boolean((s as unknown as Record<string, unknown>)[key])}
                  onChange={(e) => setS({ ...s, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          {error && <div className="md:col-span-2"><Alert tone="red">{error}</Alert></div>}
          {saved && <div className="md:col-span-2"><Alert tone="green">Saved.</Alert></div>}
          <div className="md:col-span-2 flex justify-end"><Button type="submit">Save policies</Button></div>
        </form>
      </Card>
    </div>
  );
}

function safeParseArr(v: string | null): string[] {
  if (!v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}
function arrToCsv(v: string | null): string { return safeParseArr(v).join(", "); }
function csvToArr(v: string): string { return JSON.stringify(v.split(",").map((x) => x.trim()).filter(Boolean)); }
