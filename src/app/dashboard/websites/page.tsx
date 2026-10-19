"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button, Card, Badge, Input, Field, EmptyState, Alert } from "@/components/ui";

interface SiteRow {
  id: string;
  name: string;
  domain: string;
  url: string;
  niche: string | null;
  primaryLanguage: string;
  status: string;
  createdAt: string;
  _count: { keywordRecords: number; drafts: number; opportunities: number };
}

const emptyForm = {
  name: "",
  domain: "",
  url: "",
  description: "",
  niche: "",
  targetAudience: "",
  primaryCountry: "",
  primaryLanguage: "en",
  timezone: "UTC",
};

export default function WebsitesPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cosmetic only: the API enforces that only OPERATORs can create websites.
  const [canCreate, setCanCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/websites");
      const data = await res.json();
      if (data.sites) setSites(data.sites);
      if (data.user) setCanCreate(data.user.globalRole === "OPERATOR");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createSite(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create website");
        return;
      }
      setForm(emptyForm);
      setShowCreate(false);
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Websites</h1>
          <p className="mt-1 text-sm text-slate-500">Manage the WordPress blogs you operate from BlogPilot.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Cancel" : "Add website"}</Button>
        )}
      </div>

      {showCreate && (
        <Card title="Add a website" description="Basic site information. Per-site settings can be configured next.">
          <form onSubmit={createSite} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name" hint="e.g. Example Site">
              <Input value={form.name} onChange={set("name")} required placeholder="Example Site" />
            </Field>
            <Field label="Domain" hint="No protocol, e.g. example.com">
              <Input value={form.domain} onChange={set("domain")} required placeholder="example.com" />
            </Field>
            <Field label="URL">
              <Input value={form.url} onChange={set("url")} required placeholder="https://example.com" />
            </Field>
            <Field label="Primary language">
              <Input value={form.primaryLanguage} onChange={set("primaryLanguage")} placeholder="en" />
            </Field>
            <Field label="Niche / topic">
              <Input value={form.niche} onChange={set("niche")} placeholder="e.g. Example niche or topic" />
            </Field>
            <Field label="Primary country">
              <Input value={form.primaryCountry} onChange={set("primaryCountry")} placeholder="USA" />
            </Field>
            <Field label="Target audience">
              <Input value={form.targetAudience} onChange={set("targetAudience")} placeholder="e.g. Example audience" />
            </Field>
            <Field label="Time zone">
              <Input value={form.timezone} onChange={set("timezone")} placeholder="UTC" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={set("description")}
                  rows={3}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>
            </div>
            {error && (
              <div className="md:col-span-2">
                <Alert tone="red">{error}</Alert>
              </div>
            )}
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create website"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : sites.length === 0 ? (
        <EmptyState title="No websites yet" body="Add your first WordPress site to get started." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">Website</th>
                <th className="py-2 pr-4">Niche</th>
                <th className="py-2 pr-4">Keywords</th>
                <th className="py-2 pr-4">Opportunities</th>
                <th className="py-2 pr-4">Drafts</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sites.map((site) => (
                <tr key={site.id} className="hover:bg-slate-50">
                  <td className="py-3 pr-4">
                    <Link href={`/dashboard/websites/${site.id}`} className="font-medium text-slate-900 hover:text-blue-600">
                      {site.name}
                    </Link>
                    <div className="text-xs text-slate-500">{site.domain}</div>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{site.niche || "—"}</td>
                  <td className="py-3 pr-4 text-slate-600">{site._count.keywordRecords}</td>
                  <td className="py-3 pr-4 text-slate-600">{site._count.opportunities}</td>
                  <td className="py-3 pr-4 text-slate-600">{site._count.drafts}</td>
                  <td className="py-3">
                    <Badge tone={site.status === "ACTIVE" ? "green" : site.status === "DISABLED" ? "amber" : "slate"}>
                      {site.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
