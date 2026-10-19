"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; exact?: boolean };

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export default function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              "group relative flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 " +
              (active
                ? "bg-indigo-500/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                : "text-slate-400 hover:bg-slate-800/80 hover:text-white")
            }
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-indigo-400" />
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
