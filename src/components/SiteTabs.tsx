"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteTabs({ siteId }: { siteId: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/dashboard/websites/${siteId}`, label: "Overview" },
    { href: `/dashboard/websites/${siteId}/settings`, label: "Policies" },
    { href: `/dashboard/websites/${siteId}/guidelines`, label: "Editorial" },
    { href: `/dashboard/websites/${siteId}/ai`, label: "AI" },
    { href: `/dashboard/websites/${siteId}/wordpress`, label: "WordPress" },
    { href: `/dashboard/websites/${siteId}/members`, label: "Members" },
    { href: `/dashboard/websites/${siteId}/integrations`, label: "Data" },
  ];
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 pb-3">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              active ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
