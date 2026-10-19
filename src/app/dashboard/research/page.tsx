"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input, Badge, Alert, Textarea } from "@/components/ui";
import { SiteSelect } from "@/components/SiteSelect";

interface Site {
  id: string;
  name: string;
  domain: string;
}
interface Config {
  enabled: boolean;
  researchInstructions: string | null;
  permittedDomains: string[];
  preferredSourceTypes: string[];
  communityPlatforms: string[];
  excludedDomains: string[];
  requiredOfficialSources: string[];
  minIndependentSources: number;
  researchDepth: number;
  researchLanguage: string;
  countryScope: string | null;
  minSourceQuality: string;
  communityEvidenceMandatory: boolean;
}
interface Preset {
  key: string;
  label: string;
}

const empty: Config = {
  enabled: false,
  researchInstructions: "",
  permittedDomains: [],
  preferredSourceTypes: [],
  communityPlatforms: [],
  excludedDomains: [],
  requiredOfficialSources: [],
  minIndependentSources: 3,
  researchDepth: 2,
  researchLanguage: "en",
  countryScope: "",
  minSourceQuality: "MEDIUM",
  communityEvidenceMandatory: false,
};

export default function ResearchCenterPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Config>(empty);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadSites = async () => {
    const res = await fetch("/api/websites");
    const data = await res.json();
    setSites(data.sites || []);
    if (data.sites?.length && !siteId) setSiteId(data.sites[0].id);
  };
  useEffect(() => {
    loadSites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConfig = async (id: string) => {
    setLoaded(false);
    const res = await fetch(`/api/websites/${id}/research/config`);
    const data = await res.json();
    setPresets(data.presets || []);
    if (data.config) setCfg({ ...empty, ...data.config });
    else setCfg(empty);
    setLoaded(true);
  };
  useEffect(() => {
    if (siteId) loadConfig(siteId);
  }, [siteId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/websites/${siteId}/research/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else {
      setSaved(true);
      if (data.config) setCfg({ ...empty, ...data.config });
    }
  }

  const toggle = (key: "communityPlatforms" | "permittedDomains", value: string) =>
    setCfg((c) => ({
      ...c,
      [key]: c[key].includes(value) ? c[key].filter((v) => v !== value) : [...c[key], value],
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Research Center</h1>
          <p className="mt-1 text-sm text-slate-500">Configure sources, run research, and review evidence briefs per site.</p>
        </div>
        <SiteSelect sites={sites} value={siteId} onChange={setSiteId} />
      </div>

      {!siteId ? (
        <Alert tone="blue">Select a website to configure research.</Alert>
      ) : !loaded ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Research settings">
            <form onSubmit={save} className="space-y-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
                Enable research for this site
              </label>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Research instructions</label>
                <Textarea rows={4} value={cfg.researchInstructions ?? ""} onChange={(e) => setCfg({ ...cfg, researchInstructions: e.target.value })} placeholder="What to look for, angles, evidence needed…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Min independent sources</span>
                  <Input type="number" min={0} value={cfg.minIndependentSources} onChange={(e) => setCfg({ ...cfg, minIndependentSources: Number(e.target.value) })} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Research depth (0–10)</span>
                  <Input type="number" min={0} max={10} value={cfg.researchDepth} onChange={(e) => setCfg({ ...cfg, researchDepth: Number(e.target.value) })} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Research language</span>
                  <Input value={cfg.researchLanguage} onChange={(e) => setCfg({ ...cfg, researchLanguage: e.target.value })} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Country / destination scope</span>
                  <Input value={cfg.countryScope ?? ""} onChange={(e) => setCfg({ ...cfg, countryScope: e.target.value })} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Min source quality</span>
                  <select value={cfg.minSourceQuality} onChange={(e) => setCfg({ ...cfg, minSourceQuality: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                  </select>
                </label>
                <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
                  <input type="checkbox" checked={cfg.communityEvidenceMandatory} onChange={(e) => setCfg({ ...cfg, communityEvidenceMandatory: e.target.checked })} />
                  Community evidence mandatory
                </label>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Permitted source domains (one per line)</label>
                <Textarea rows={3} value={cfg.permittedDomains.join("\n")} onChange={(e) => setCfg({ ...cfg, permittedDomains: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Excluded domains (one per line)</label>
                <Textarea rows={2} value={cfg.excludedDomains.join("\n")} onChange={(e) => setCfg({ ...cfg, excludedDomains: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
              </div>
              {error && <Alert tone="red">{error}</Alert>}
              {saved && <Alert tone="green">Saved.</Alert>}
              <div className="flex justify-end">
                <Button type="submit">Save research settings</Button>
              </div>
            </form>
          </Card>

          <div className="space-y-4">
            <Card title="Community platforms & source presets" description="Legitimate/accessible platforms only. Toggle the ones to investigate.">
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => {
                  const on = cfg.communityPlatforms.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      onClick={() => toggle("communityPlatforms", p.key)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
                      title={p.label}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-slate-700">Required official sources (one per line)</label>
                <Textarea rows={2} value={cfg.requiredOfficialSources.join("\n")} onChange={(e) => setCfg({ ...cfg, requiredOfficialSources: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
              </div>
            </Card>
            <Card title="Access limitation" description="Automated search providers">
              <Alert tone="amber">
                No automated research search provider is configured or verified in this build. Research runs record this
                limitation honestly and do not fabricate sources. Add sources and findings manually; respect robots
                directives, platform terms, and rate limits.
              </Alert>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
