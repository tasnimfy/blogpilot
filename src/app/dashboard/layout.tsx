import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { LogoutButton } from "@/components/LogoutButton";
import SidebarNav from "@/components/SidebarNav";

const NAV = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/websites", label: "Websites" },
  { href: "/dashboard/keywords", label: "Keyword Library" },
  { href: "/dashboard/opportunities", label: "Content Opportunities" },
  { href: "/dashboard/research", label: "Research Center" },
  { href: "/dashboard/articles", label: "Article Studio" },
  { href: "/dashboard/seo", label: "SEO Analyzer" },
  { href: "/dashboard/publishing", label: "Publishing Queue" },
  { href: "/dashboard/images", label: "Image Library" },
  { href: "/dashboard/automation", label: "Automation & Jobs" },
  { href: "/dashboard/settings", label: "Global Settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: { id: string; email: string; name: string | null; globalRole: string; isActive: boolean };
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const navItems = user.globalRole === "OPERATOR"
    ? [...NAV, { href: "/dashboard/users", label: "Users" }]
    : NAV;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-800 bg-slate-900">
        <div className="flex items-center gap-2 px-5 py-4">
          <span className="text-lg font-bold text-white">BlogPilot</span>
        </div>
        <SidebarNav items={navItems} />
        <div className="border-t border-slate-800 p-3">
          <div className="mb-2 truncate px-1 text-xs text-slate-400">{user.email}</div>
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
