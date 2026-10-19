"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Input, Alert, Badge } from "@/components/ui";
import { SiteTabs } from "@/components/SiteTabs";

interface WP {
  siteUrl: string;
  username: string;
  status: string;
  lastTestedAt: string | null;
  lastError: string | null;
  hasAppPassword: boolean;
}

type TestResult = {
  ok: boolean;
  name?: string;
  postTypes?: string[];
  categories?: { id: number; name: string; slug: string }[];
  tags?: { id: number; name: string; slug: string }[];
  mediaCapable?: boolean;
  hasRankMathMeta?: boolean;
  lastError?: string;
};

const empty: WP = { siteUrl: "", username: "", status: "UNKNOWN", lastTestedAt: null, lastError: null, hasAppPassword: false };

export default function WordpressPage() {
  const { id } = useParams<{ id: string }>();
  const [wp, setWp] = useState<WP>(empty);
  const [appPassword, setAppPassword] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/websites/${id}/wordpress`);
      const data = await res.json();
      if (data.wordpress) setWp({ ...empty, ...data.wordpress });
      setLoaded(true);
    })();
  }, [id]);

  async function testConnection() {
    setTesting(true);
    setError(null);
    const res = await fetch(`/api/websites/${id}/wordpress/test`, { method: "POST" });
    const data = await res.json();
    setTesting(false);
    if (!res.ok) {
      setError(data.error || "Connection test failed");
      setTestResult({ ok: false, lastError: data.error });
    } else {
      setTestResult(data as TestResult);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false); setError(null);
    if (!wp.siteUrl || !wp.username || !appPassword) {
      setError("Site URL, username and application password are required");
      return;
    }
    const res = await fetch(`/api/websites/${id}/wordpress`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUrl: wp.siteUrl, username: wp.username, appPassword }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || "Failed to save");
    else { setSaved(true); setAppPassword(""); if (data.wordpress) setWp({ ...empty, ...data.wordpress }); }
  }

  if (!loaded) return <div className="text-sm text-slate-500">Loading…</div>;

  const statusTone = wp.status === "OK" ? "green" : wp.status === "FAILED" ? "red" : "slate";

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/websites/${id}`} className="text-sm text-blue-600 hover:underline">← Back to site</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">WordPress connection</h1>
      </div>
      <SiteTabs siteId={id} />
      <Alert tone="blue">
        Uses WordPress Application Passwords over HTTPS. Credentials are encrypted at rest and never returned to the browser. Connection testing is performed server-side. SSRF protections block requests to localhost and private addresses.
      </Alert>
      <Card title="Connection settings">
        <form onSubmit={save} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Site URL" hint="Must use HTTPS"><Input value={wp.siteUrl} onChange={(e) => setWp({ ...wp, siteUrl: e.target.value })} placeholder="https://example.com" /></Field>
          <Field label="WordPress username"><Input value={wp.username} onChange={(e) => setWp({ ...wp, username: e.target.value })} /></Field>
          <div className="md:col-span-2">
            <Field label="Application password" hint={wp.hasAppPassword ? "A password is stored. Enter a new one to replace it." : "No password stored yet."}>
              <div className="flex items-center gap-2">
                <Input type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" autoComplete="off" />
                <Badge tone={wp.hasAppPassword ? "green" : "slate"}>{wp.hasAppPassword ? "Stored" : "None"}</Badge>
              </div>
            </Field>
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <Badge tone={statusTone}>{wp.status}</Badge>
            {wp.lastTestedAt && <span className="text-xs text-slate-500">Last tested {new Date(wp.lastTestedAt).toLocaleString()}</span>}
            {wp.lastError && <span className="text-xs text-red-600">{wp.lastError}</span>}
          </div>
          {error && <div className="md:col-span-2"><Alert tone="red">{error}</Alert></div>}
          {saved && <div className="md:col-span-2"><Alert tone="green">Saved.</Alert></div>}
          <div className="md:col-span-2 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={testConnection} disabled={testing}>
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button type="submit">Save connection</Button>
          </div>
        </form>
      </Card>

      {testResult && (
        <Card title="Connection test result">
          {testResult.ok ? (
            <div className="space-y-2 text-sm text-slate-700">
              <div><strong>{testResult.name}</strong> — connected.</div>
              <div>Post types: {(testResult.postTypes ?? []).join(", ")}</div>
              <div>Categories ({(testResult.categories ?? []).length}): {(testResult.categories ?? []).slice(0, 8).map((c: { name: string }) => c.name).join(", ")}{(testResult.categories ?? []).length > 8 ? "…" : ""}</div>
              <div>Tags ({(testResult.tags ?? []).length}): {(testResult.tags ?? []).slice(0, 8).map((t: { name: string }) => t.name).join(", ")}{(testResult.tags ?? []).length > 8 ? "…" : ""}</div>
              <div>Media uploads: <Badge tone={testResult.mediaCapable ? "green" : "amber"}>{testResult.mediaCapable ? "available" : "not available"}</Badge></div>
              <div>Rank Math meta exposed: <Badge tone={testResult.hasRankMathMeta ? "green" : "slate"}>{testResult.hasRankMathMeta ? "yes" : "no / not detected"}</Badge></div>
            </div>
          ) : (
            <Alert tone="red">{testResult.lastError || "Connection failed."}</Alert>
          )}
        </Card>
      )}
    </div>
  );
}
