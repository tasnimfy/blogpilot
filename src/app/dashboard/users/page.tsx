"use client";

import { useEffect, useState, useCallback } from "react";
import { Button, Card, Badge, Input, Field, EmptyState, Alert } from "@/components/ui";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  globalRole: string;
  isActive: boolean;
  createdAt: string;
  _count: { memberships: number };
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", globalRole: "MEMBER" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (res.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Failed to load users");
        return;
      }
      setUsers(data.users ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create user");
        return;
      }
      setForm({ email: "", name: "", password: "", globalRole: "MEMBER" });
      setShowCreate(false);
      setMessage("User created. Assign website memberships from each site's Members tab.");
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function update(u: UserRow, patch: Record<string, unknown>) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to update user");
      return;
    }
    setMessage("User updated.");
    await load();
  }

  if (accessDenied) {
    return <Alert tone="red">Operator access is required to manage user accounts.</Alert>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Create and manage accounts. Website access is assigned per site from each website&apos;s Members tab.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Cancel" : "Add user"}</Button>
      </div>

      {error && <Alert tone="red">{error}</Alert>}
      {message && <Alert tone="green">{message}</Alert>}

      {showCreate && (
        <Card title="Add user" description="New accounts are MEMBERs by default; grant them OPERATOR only when they manage the whole installation.">
          <form onSubmit={createUser} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Email">
              <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required type="email" placeholder="writer@example.com" />
            </Field>
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Optional" />
            </Field>
            <Field label="Password">
              <Input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required type="password" placeholder="At least 8 characters" />
            </Field>
            <Field label="Account role">
              <select
                value={form.globalRole}
                onChange={(e) => setForm((f) => ({ ...f, globalRole: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="MEMBER">Member (site-scoped access)</option>
                <option value="OPERATOR">Operator (full access)</option>
              </select>
            </Field>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create user"}</Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : users.length === 0 ? (
        <EmptyState title="No users yet" body="Create accounts so website owners can assign them memberships." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Account role</th>
                <th className="py-2 pr-4">Memberships</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-slate-900">{u.name || u.email}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <select
                      value={u.globalRole}
                      onChange={(e) => update(u, { globalRole: e.target.value })}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="OPERATOR">Operator</option>
                    </select>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{u._count.memberships}</td>
                  <td className="py-3 pr-4">
                    <Badge tone={u.isActive ? "green" : "red"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="py-3">
                    {u.isActive ? (
                      <Button variant="secondary" onClick={() => update(u, { isActive: false })}>Deactivate</Button>
                    ) : (
                      <Button variant="secondary" onClick={() => update(u, { isActive: true })}>Activate</Button>
                    )}
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