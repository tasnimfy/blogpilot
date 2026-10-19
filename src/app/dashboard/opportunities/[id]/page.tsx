"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Card, Badge, EmptyState, Alert, Textarea, workflowTone } from "@/components/ui";

interface Site { id: string; name: string; domain: string; }
interface Score {
  demandScore: number; demandJustification: string;
  competitionScore: number; competitionJustification: string;
  valueScore: number; valueJustification: string;
  originalScore: number; originalJustification: string;
  relevanceScore: number; relevanceJustification: string;
  total: number; confidence: string;
  evidence: string | null; sources: string | null;
  missingData: string | null; dataFreshness: string | null;
  isOverride: boolean;
}
interface DraftRef { id: string; title: string; status: string; slug: string | null; }
interface Opp {
  id: string; title: string; keyword: string | null; keywords: string | null;
  source: string; status: string; reviewStatus: string;
  searchIntent: string | null; contentType: string | null; action: string | null;
  commercialIntent: boolean; seasonal: boolean; notes: string | null;
  recommendedAction: string | null; existingPageOverlap: boolean;
  approvedAt: string | null; rejectedAt: string | null; rejectionReason: string | null;
  createdAt: string; score: Score | null;
  drafts: DraftRef[]; existingDraft: DraftRef | null; existingUrl: string | null;
}

const CRITERIA: { key: keyof Score; label: string; desc: string }[] = [
  { key: "demandScore", label: "Search demand", desc: "Evidence of actual search demand" },
  { key: "competitionScore", label: "Competition (realistic)", desc: "Higher = more realistic for a NEW site" },
  { key: "valueScore", label: "Commercial / practical value", desc: "Booking intent, affiliate potential, lead gen" },
  { key: "originalScore", label: "Original content potential", desc: "Supports original research, expert input" },
  { key: "relevanceScore", label: "Website relevance", desc: "Match with the site niche and audience" },
];
const JUST_KEY: Record<string, keyof Score & string> = {
  demandScore: "demandJustification",
  competitionScore: "competitionJustification",
  valueScore: "valueJustification",
  originalScore: "originalJustification",
  relevanceScore: "relevanceJustification",
};

export default function OpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const oppId = params.id;
  const [siteId, setSiteId] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [opp, setOpp] = useState<Opp | null>(null);
  const [workflow, setWorkflow] = useState<{ state: string; allowed: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const load = useCallback(async () => {
    if (!oppId) return;
    setLoading(true);
    setError(null);
    try {
      // The list page passes ?site=; guard for direct navigation.
      const site = new URLSearchParams(window.location.search).get("site");
      if (!site) {
        const sitesRes = await fetch("/api/websites");
        const sitesData = await sitesRes.json();
        const sites: Site[] = sitesData.sites || [];
        // Find the site that owns this opportunity by probing each (small N).
        for (const s of sites) {
          const probe = await fetch(`/api/websites/${s.id}/opportunities/${oppId}`);
          if (probe.ok) { setSiteId(s.id); setSiteName(s.name); break; }
        }
      } else {
        setSiteId(site);
        const sitesRes = await fetch("/api/websites");
        const sitesData = await sitesRes.json();
        setSiteName((sitesData.sites || []).find((s: Site) => s.id === site)?.name ?? site);
      }
      setLoading(false);
    } catch {
      setError("Failed to identify the website for this opportunity.");
      setLoading(false);
      return;
    }
  }, [oppId]);

  const loadData = useCallback(async () => {
    if (!siteId || !oppId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [oppRes, wfRes] = await Promise.all([
        fetch(`/api/websites/${siteId}/opportunities/${oppId}`),
        fetch(`/api/websites/${siteId}/opportunities/${oppId}/workflow`),
      ]);
      const oppData = await oppRes.json();
      if (!oppRes.ok) throw new Error(oppData.error || "Failed to load opportunity");
      setOpp(oppData.opportunity);
      if (wfRes.ok) {
        const wf = await wfRes.json();
        setWorkflow(wf || null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load opportunity");
    } finally {
      setLoading(false);
    }
  }, [siteId, oppId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (siteId) loadData(); }, [siteId, loadData]);

  async function transition(to: string) {
    if (!siteId || !oppId) return;
    setBusy(to); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/websites/${siteId}/opportunities/${oppId}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transition failed");
      setNotice(`Moved to ${to.replace(/_/g, " ").toLowerCase()}.`);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!siteId || !oppId) return;
    setBusy("APPROVE"); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/websites/${siteId}/opportunities/${oppId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approval failed");
      setNotice(
        data.draftCreated
          ? "Approved. Article Studio item created and queued for daily generation."
          : "Approved. Linked to the existing Article Studio item; queue eligibility ensured."
      );
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!siteId || !oppId) return;
    setBusy("REJECT"); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/websites/${siteId}/opportunities/${oppId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rejection failed");
      setNotice("Opportunity rejected.");
      setShowReject(false);
      setRejectReason("");
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rejection failed");
    } finally {
      setBusy(null);
    }
  }

  const related: string[] = safeArr(opp?.keywords ?? null);
  const evidence: string[] = opp?.score ? safeArr(opp.score.evidence) : [];
  const sources: string[] = opp?.score ? safeArr(opp.score.sources) : [];
  const missing: string[] = opp?.score ? safeArr(opp.score.missingData) : [];

  return (
    <div className="space-y-6">
      {loading ? (
        <EmptyState title="Loading opportunity…" body="Fetching evidence and workflow state." />
      ) : !siteId || !opp ? (
        <>
          {error && <Alert tone="red">{error}</Alert>}
          <EmptyState title="Opportunity not found" body="It may have been deleted or you may not have access to its website." />
          <Link href="/dashboard/opportunities"><Button variant="secondary">Back to opportunities</Button></Link>
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={workflowTone(opp.reviewStatus)}>{opp.reviewStatus.replace(/_/g, " ").toLowerCase()}</Badge>
                <Badge>{opp.source}</Badge>
                <Badge tone={opp.action === "UPDATE_EXISTING" ? "amber" : "blue"}>{opp.action ?? "NEW_ARTICLE"}</Badge>
                {opp.searchIntent && <Badge>{opp.searchIntent}</Badge>}
                {opp.contentType && <Badge tone="slate">{opp.contentType}</Badge>}
              </div>
              <h1 className="text-2xl font-semibold text-slate-900">{opp.title}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {siteName} · {opp.keyword ? `Target keyword: ${opp.keyword}` : "No target keyword recorded"}
              </p>
            </div>
            <Link href="/dashboard/opportunities"><Button variant="secondary">Back</Button></Link>
          </div>

          {error && <Alert tone="red">{error}</Alert>}
          {notice && <Alert tone="green">{notice}</Alert>}

          {/* Workflow actions */}
          <Card title="Workflow" description={`Current state: ${opp.reviewStatus.replace(/_/g, " ").toLowerCase()}. Only valid transitions are shown.`}>
            <div className="flex flex-wrap gap-2">
              {(workflow?.allowed ?? []).includes("REVIEWED") && (
                <Button variant="secondary" disabled={busy !== null} onClick={() => transition("REVIEWED")}>
                  {busy === "REVIEWED" ? "…" : "Mark reviewed"}
                </Button>
              )}
              {(workflow?.allowed ?? []).includes("APPROVED") && (
                <Button disabled={busy !== null} onClick={approve}>{busy === "APPROVE" ? "Approving…" : "Approve & queue for Article Studio"}</Button>
              )}
              {(workflow?.allowed ?? []).includes("QUEUED_FOR_ARTICLE_STUDIO") && (
                <Button variant="secondary" disabled={busy !== null} onClick={() => transition("QUEUED_FOR_ARTICLE_STUDIO")}>
                  {busy === "QUEUED_FOR_ARTICLE_STUDIO" ? "…" : "Queue for Article Studio"}
                </Button>
              )}
              {(workflow?.allowed ?? []).includes("GENERATING") && (
                <Button variant="secondary" disabled={busy !== null} onClick={() => transition("GENERATING")}>
                  {busy === "GENERATING" ? "…" : "Mark generating"}
                </Button>
              )}
              {(workflow?.allowed ?? []).includes("DRAFT_READY") && (
                <Button variant="secondary" disabled={busy !== null} onClick={() => transition("DRAFT_READY")}>
                  {busy === "DRAFT_READY" ? "…" : "Mark draft ready"}
                </Button>
              )}
              {(workflow?.allowed ?? []).includes("FAILED") && (
                <Button variant="danger" disabled={busy !== null} onClick={() => transition("FAILED")}>
                  {busy === "FAILED" ? "…" : "Mark failed"}
                </Button>
              )}
              {(workflow?.allowed ?? []).includes("REJECTED") && (
                <Button variant="danger" disabled={busy !== null} onClick={() => setShowReject((v) => !v)}>
                  Reject
                </Button>
              )}
            </div>
            {showReject && (
              <div className="mt-3 space-y-2">
                <Textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Optional reason for rejection" />
                <div className="flex gap-2">
                  <Button variant="danger" onClick={reject} disabled={busy !== null}>{busy === "REJECT" ? "Rejecting…" : "Confirm rejection"}</Button>
                  <Button variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
                </div>
              </div>
            )}
            {opp.approvedAt && (
              <p className="mt-3 text-xs text-slate-500">Approved at {new Date(opp.approvedAt).toLocaleString()}.</p>
            )}
            {opp.rejectedAt && (
              <p className="mt-3 text-xs text-slate-500">
                Rejected at {new Date(opp.rejectedAt).toLocaleString()}{opp.rejectionReason ? ` — reason: ${opp.rejectionReason}` : " (no reason given)"}.
              </p>
            )}
            {opp.drafts.length > 0 && (
              <div className="mt-3">
                <Alert tone="blue">
                  Linked Article Studio item: <strong>{opp.drafts[0].title}</strong> (status {opp.drafts[0].status.toLowerCase()}) ·{" "}
                  <Link className="underline" href="/dashboard/articles">open Article Studio</Link>
                </Alert>
              </div>
            )}
            {opp.existingUrl && (
              <p className="mt-3 text-xs text-slate-500">Existing URL: <a className="text-blue-600 underline" href={opp.existingUrl} target="_blank" rel="noreferrer">{opp.existingUrl}</a></p>
            )}
          </Card>

          {/* Evidence */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Search evidence" description="What the research layer actually observed — never fabricated.">
              <dl className="space-y-2 text-sm">
                {opp.keyword && (
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Target keyword</dt><dd className="text-right font-medium text-slate-900">{opp.keyword}</dd></div>
                )}
                {related.length > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Related queries</dt>
                    <dd className="max-w-xs text-right text-slate-700">{related.join(" · ")}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Data freshness</dt><dd className="text-right text-slate-700">{opp.score?.dataFreshness || "—"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Confidence</dt><dd className="text-right"><Badge tone={opp.score?.confidence === "HIGH" ? "green" : opp.score?.confidence === "LOW" ? "red" : "amber"}>{opp.score?.confidence ?? "-"}</Badge></dd></div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Sources</dt>
                  <dd className="flex flex-wrap justify-end gap-1 text-right">{sources.length ? sources.map((s) => <Badge key={s}>{s}</Badge>) : <span className="text-slate-400">none recorded</span>}</dd>
                </div>
              </dl>
              {evidence.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                  {evidence.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
            </Card>

            <Card title="Missing evidence" description="Named gaps — the engine never invents numbers.">
              {missing.length === 0 ? (
                <Alert tone="green">No missing evidence — every scoring dimension had a real signal.</Alert>
              ) : (
                <ul className="space-y-2">
                  {missing.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-700">
                      <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      {m}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Scoring */}
          <Card
            title="Five-part score"
            description="0-5 per dimension, 25 total. Justifications are stored with each score."
            actions={opp.score && (
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${opp.score.total >= 20 ? "text-emerald-600" : opp.score.total >= 15 ? "text-blue-600" : opp.score.total >= 10 ? "text-amber-600" : "text-slate-400"}`}>
                  {opp.score.total}
                </span>
                <span className="text-sm text-slate-400">/25</span>
              </div>
            )}
          >
            {!opp.score ? (
              <EmptyState title="Not scored yet" body="Score it from the list view to populate the five dimensions." />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {CRITERIA.map((c) => (
                  <div key={c.key} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">{c.label}</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900">{opp.score![c.key]}</div>
                    <div className="mt-1 text-[11px] text-slate-400">{c.desc}</div>
                    <p className="mt-2 text-xs text-slate-600">{String(opp.score![JUST_KEY[c.key]] ?? "")}</p>
                  </div>
                ))}
              </div>
            )}
            {opp.recommendedAction && <p className="mt-3 text-xs text-slate-500">Recommended action: <strong>{opp.recommendedAction}</strong></p>}
          </Card>

          {/* Why is it worth considering */}
          <Card title="Why this topic is worth considering" description="Engine explanation recorded at discovery time.">
            {opp.notes ? (
              <p className="text-sm leading-relaxed text-slate-700">{opp.notes}</p>
            ) : (
              <p className="text-sm text-slate-400">No explanation recorded for this opportunity.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              {opp.seasonal && <Badge tone="amber">seasonal</Badge>}
              {opp.commercialIntent && <Badge tone="green">commercial intent</Badge>}
              {opp.existingPageOverlap && <Badge tone="amber">overlaps an existing page</Badge>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function safeArr(v: string | null): string[] {
  try {
    const p = JSON.parse(v ?? "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}