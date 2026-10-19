"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Badge, EmptyState, Alert } from "@/components/ui";
import { SiteSelect } from "@/components/SiteSelect";

interface Site {
  id: string;
  name: string;
  domain: string;
}
interface ImgResult {
  provider: "openverse" | "wikimedia";
  providerId: string;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  creator?: string;
  attribution?: string;
  license?: string;
  licenseUrl?: string;
  attributionRequired: boolean;
  commercialUse: boolean;
  width?: number;
  height?: number;
  mimeType?: string;
  sourcePage?: string;
}
interface StoredImg {
  id: string;
  provider: string;
  url: string;
  thumbnailUrl: string | null;
  title: string | null;
  creator: string | null;
  license: string | null;
  licenseUrl: string | null;
  attributionRequired: boolean;
  commercialUse: boolean;
  altText: string | null;
}

export default function ImageLibraryPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [provider, setProvider] = useState<"openverse" | "wikimedia">("openverse");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ImgResult[]>([]);
  const [library, setLibrary] = useState<StoredImg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/websites");
    const data = await res.json();
    setSites(data.sites || []);
    if (data.sites?.length && !siteId) setSiteId(data.sites[0].id);
  }, [siteId]);
  useEffect(() => { loadSites(); }, [loadSites]);

  const loadLibrary = useCallback(async () => {
    if (!siteId) return;
    const res = await fetch(`/api/websites/${siteId}/images`);
    const data = await res.json();
    setLibrary(data.images || []);
  }, [siteId]);
  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  async function search() {
    if (!query.trim()) return;
    setBusy(true); setError(null); setResults([]);
    const res = await fetch(`/api/websites/${siteId}/images/search?provider=${provider}&q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error);
    else setResults(data.items || []);
  }

  async function save(item: ImgResult) {
    const res = await fetch(`/api/websites/${siteId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else loadLibrary();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Image Library</h1>
          <p className="mt-1 text-sm text-slate-500">Discover permissively licensed images and preserve attribution. Verify licenses before commercial use.</p>
        </div>
        <SiteSelect sites={sites} value={siteId} onChange={setSiteId} />
      </div>

      {!siteId ? (
        <EmptyState title="Select a website" body="Choose a website to manage images." />
      ) : (
        <>
          <Card title="Search providers">
            <div className="flex flex-wrap items-center gap-2">
              <select value={provider} onChange={(e) => setProvider(e.target.value as "openverse" | "wikimedia")} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="openverse">Openverse</option>
                <option value="wikimedia">Wikimedia Commons</option>
              </select>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Search images (keyword, destination, type)…" className="flex-1" />
              <Button onClick={search} disabled={busy}>{busy ? "Searching…" : "Search"}</Button>
            </div>
            {error && <div className="mt-3"><Alert tone="red">{error}</Alert></div>}
          </Card>

          {results.length > 0 && (
            <Card title={`Results (${results.length})`}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {results.map((r, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-2">
                    <img src={r.thumbnailUrl ?? r.url} alt={r.title ?? "image"} className="h-32 w-full rounded object-cover" loading="lazy" />
                    <div className="mt-2 text-xs font-medium text-slate-900 line-clamp-2">{r.title || r.providerId}</div>
                    {r.creator && <div className="text-xs text-slate-500">{r.creator}</div>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.license && <Badge>{r.license}</Badge>}
                      <Badge tone={r.commercialUse ? "green" : "amber"}>{r.commercialUse ? "Commercial OK" : "Verify commercial use"}</Badge>
                      {r.attributionRequired && <Badge tone="blue">attribution</Badge>}
                    </div>
                    <Button variant="secondary" className="mt-2 w-full" onClick={() => save(r)}>Save to library</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title={`Saved images (${library.length})`}>
            {library.length === 0 ? (
              <EmptyState title="No saved images" body="Search above and save images to build the site library." />
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {library.map((img) => (
                  <div key={img.id} className="rounded-lg border border-slate-200 p-2">
                    <img src={img.thumbnailUrl ?? img.url} alt={img.altText ?? img.title ?? "image"} className="h-28 w-full rounded object-cover" loading="lazy" />
                    <div className="mt-2 text-xs font-medium text-slate-900 line-clamp-2">{img.title || img.url}</div>
                    <div className="text-xs text-slate-500">{img.creator || "—"}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {img.license && <Badge>{img.license}</Badge>}
                      <Badge tone={img.commercialUse ? "green" : "amber"}>{img.commercialUse ? "Commercial OK" : "Verify"}</Badge>
                    </div>
                    <Button variant="danger" className="mt-2 w-full" onClick={async () => { await fetch(`/api/websites/${siteId}/images/${img.id}`, { method: "DELETE" }); loadLibrary(); }}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
