import { EmptyState } from "@/components/ui";

export function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{note}</p>
      </div>
      <EmptyState
        title="Module not implemented yet"
        body="This section ships in a later phase. The database schema already supports it."
      />
    </div>
  );
}
