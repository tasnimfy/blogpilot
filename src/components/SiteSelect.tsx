"use client";

import { useEffect, useState } from "react";

interface Site {
  id: string;
  name: string;
  domain: string;
}

export function SiteSelect({
  sites,
  value,
  onChange,
  placeholder = "Select a website",
}: {
  sites: Site[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-72 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.domain})
        </option>
      ))}
    </select>
  );
}
