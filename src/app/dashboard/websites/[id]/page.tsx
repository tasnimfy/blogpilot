"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Input, Alert, Badge } from "@/components/ui";
import { SiteTabs } from "@/components/SiteTabs";

interface Site {
  id: string;
  name: string;
  domain: string;
  url: string;
  description: string | null;
  niche: string | null;
  targetAudience: string | null;
  primaryCountry: string | null;
  primaryLanguage: string;
  timezone: string;
  status: string;
}

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/websites/${id}`);
        const data = await res.json();
        if (data.site) setSite(data.site);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!site) return;
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/websites/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: site.name,
        domain: site.domain,
        url: site.url,
        description: site.description,
        niche: site.niche,
        targetAudience: site.targetAudience,
        primaryCountry: site.primaryCountry,
        primaryLanguage: site.primaryLanguage,
        timezone: site.timezone,
      }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || "Failed to save");
    else {
      setSaved(true);
      if (data.site) setSite(data.site);
    }
  }

  async function changeStatus(status: string) {
    if (!site) return;
    const res = await fetch(`/api/websites/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (data.site) setSite(data.site);
  }

  async function remove() {
    if (!site) return;
    if (!confirm(`Delete "${site.name}" and ALL of its data? This cannot be undone.`)) return;
    await fetch(`/api/websites/${id}`, { method: "DELETE" });
    window.location.href = "/dashboard/websites";
  }

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!site) return <div className="text-sm text-red-600">Website not found</div>;

  const set = (k: keyof Site) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setSite((s) => (s ? { ...s, [k]: e.target.value } : s));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/websites" className="text-sm text-blue-600 hover:underline">
            ← Websites
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{site.name}</h1>
          <p className="text-sm text-slate-500">{site.domain}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={site.status === "ACTIVE" ? "green" : site.status === "DISABLED" ? "amber" : "slate"}>
            {site.status}
          </Badge>
          {site.status === "ACTIVE" ? (
            <Button variant="secondary" onClick={() => changeStatus("DISABLED")}>Disable</Button>
          ) : (
            <Button onClick={() => changeStatus("ACTIVE")}>Enable</Button>
          )}
          <Button variant="danger" onClick={remove}>Delete</Button>
        </div>
      </div>

      <SiteTabs siteId={site.id} />

      <Card title="Basic information">
        <form onSubmit={save} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Name"><Input value={site.name} onChange={set("name")} required /></Field>
          <Field label="Domain"><Input value={site.domain} onChange={set("domain")} required /></Field>
          <Field label="URL"><Input value={site.url} onChange={set("url")} required /></Field>
          <Field label="Primary language"><Input value={site.primaryLanguage} onChange={set("primaryLanguage")} /></Field>
          <Field label="Niche"><Input value={site.niche ?? ""} onChange={set("niche")} placeholder="e.g. Example niche or topic" /></Field>
          <Field label="Primary country"><Input value={site.primaryCountry ?? ""} onChange={set("primaryCountry")} /></Field>
          <Field label="Target audience"><Input value={site.targetAudience ?? ""} onChange={set("targetAudience")} placeholder="e.g. Example audience" /></Field>
          <Field label="Time zone"><Input value={site.timezone} onChange={set("timezone")} /></Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <textarea value={site.description ?? ""} onChange={set("description")} rows={3}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </Field>
          </div>
          {error && <div className="md:col-span-2"><Alert tone="red">{error}</Alert></div>}
          {saved && <div className="md:col-span-2"><Alert tone="green">Saved.</Alert></div>}
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
