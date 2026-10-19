import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { Card, Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requireUser();

  const [sites, keywords, drafts, opportunities, activeJobs, recentAudit] = await Promise.all([
    prisma.website.count(),
    prisma.keywordRecord.count(),
    prisma.articleDraft.count(),
    prisma.contentOpportunity.count(),
    prisma.backgroundJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
    prisma.website.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, domain: true, status: true },
      take: 10,
    }),
  ]);

  const stats = [
    { label: "Websites", value: sites, href: "/dashboard/websites" },
    { label: "Keywords", value: keywords, href: "/dashboard/keywords" },
    { label: "Opportunities", value: opportunities, href: "/dashboard/opportunities" },
    { label: "Drafts", value: drafts, href: "/dashboard/articles" },
    { label: "Active jobs", value: activeJobs, href: "/dashboard/automation" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <p className="mt-1 text-sm text-slate-500">Operational snapshot across all connected websites.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"
          >
            <div className="text-3xl font-bold text-slate-900">{s.value}</div>
            <div className="mt-1 text-sm text-slate-500">{s.label}</div>
          </Link>
        ))}
      </div>

      <Card title="Websites">
        {sites === 0 ? (
          <EmptyState
            title="No websites yet"
            body="Add your first WordPress site to begin."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentAudit.map((site) => (
              <li key={site.id} className="flex items-center justify-between py-3">
                <div>
                  <Link href={`/dashboard/websites/${site.id}`} className="font-medium text-slate-900 hover:text-blue-600">
                    {site.name}
                  </Link>
                  <div className="text-sm text-slate-500">{site.domain}</div>
                </div>
                <Badge tone={site.status === "ACTIVE" ? "green" : site.status === "DISABLED" ? "amber" : "slate"}>
                  {site.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
