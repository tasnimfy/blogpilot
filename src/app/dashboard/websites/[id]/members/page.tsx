"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Button, Card, Badge, Input, Field, EmptyState, Alert } from "@/components/ui";
import { SiteTabs } from "@/components/SiteTabs";

// Role labels follow the approved RBAC plan.
const ROLES = [
  { value: "OWNER", label: "Owner" },
  { value: "ADMIN", label: "Administrator" },
  { value: "SEO_MANAGER", label: "SEO Manager" },
  { value: "EDITOR", label: "Editor" },
  { value: "WRITER", label: "Writer" },
  { value: "VIEWER", label: "Viewer" },
];

interface Member {
  userId: string;
  websiteId: string;
  role: string;
  canPublish: boolean;
  createdAt: string;
  user: { id: string; email: string; name: string | null; globalRole: string; isActive: boolean };
}

export default function SiteMembersPage() {
  const { id } = useParams<{ id: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("VIEWER");
  const [canPublish, setCanPublish] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/websites/${id}/users`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "You do not have access to manage members on this website");
        return;
      }
      setMembers(data.members ?? []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/websites/${id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, canPublish }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to grant membership");
        return;
      }
      setEmail("");
      setRole("VIEWER");
      setCanPublish(false);
      setGrantOpen(false);
      setMessage("Membership granted.");
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function update(m: Member, patch: { role?: string; canPublish?: boolean }) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/websites/${id}/users/${m.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to update membership");
      return;
    }
    setMessage("Membership updated.");
    await load();
  }

  async function revoke(m: Member) {
    if (!confirm(`Remove ${m.user.email} from this website?`)) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/websites/${id}/users/${m.userId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to remove membership");
      return;
    }
    setMessage("Membership removed.");
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Members</h1>
          <p className="mt-1 text-sm text-slate-500">
            Roles are per website. Membership on this website never grants access to another.
          </p>
        </div>
        <Button onClick={() => setGrantOpen((v) => !v)}>{grantOpen ? "Cancel" : "Add member"}</Button>
      </div>

      {error && <Alert tone="red">{error}</Alert>}
      {message && <Alert tone="green">{message}</Alert>}

      {grantOpen && (
        <Card title="Add member" description="Assign an existing account a role on this website. The account must already exist.">
          <form onSubmit={grant} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Account email">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="writer@example.com" />
            </Field>
            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
            <div className="md:col-span-2 flex items-center gap-2">
              <input
                id="canPublish"
                type="checkbox"
                checked={canPublish}
                onChange={(e) => setCanPublish(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <label htmlFor="canPublish" className="text-sm text-slate-700">
                Can publish to WordPress (only honored for Editor role)
              </label>
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={saving}>{saving ? "Adding…" : "Add member"}</Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : members.length === 0 ? (
        <EmptyState title="No members yet" body="Add members to let them work on this website." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Publish</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.userId} className="hover:bg-slate-50">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-slate-900">{m.user.name || m.user.email}</div>
                    <div className="text-xs text-slate-500">{m.user.email}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <select
                      value={m.role}
                      onChange={(e) => update(m, { role: e.target.value })}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 pr-4">
                    {m.role === "EDITOR" ? (
                      <input
                        type="checkbox"
                        checked={m.canPublish}
                        onChange={(e) => update(m, { canPublish: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300"
                        title="Allow publishing to WordPress"
                      />
                    ) : (
                      <Badge tone={m.role === "OWNER" || m.role === "ADMIN" ? "green" : "slate"}>
                        {m.role === "OWNER" || m.role === "ADMIN" ? "Always" : "No"}
                      </Badge>
                    )}
                  </td>
                  <td className="py-3">
                    <Button variant="danger" onClick={() => revoke(m)}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}