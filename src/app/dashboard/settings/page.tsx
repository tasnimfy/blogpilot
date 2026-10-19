"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Alert, Badge } from "@/components/ui";

export default function SettingsPage() {
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/password");
    const data = await res.json();
    if (data.account) setEmail(data.account.email);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setNotice(null);
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || "Failed to change password");
    else { setNotice("Password updated."); setCurrent(""); setNext(""); }
  }

  const globalKeySet = true; // indicator only; presence is controlled by the server env

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Global Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Operator account and global defaults.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Operator account">
          <div className="mb-3 text-sm text-slate-600">
            Signed in as <strong>{email || "…"}</strong>.
          </div>
          <form onSubmit={changePassword} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Current password</label>
              <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">New password (min 8 chars)</label>
              <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
            </div>
            {error && <Alert tone="red">{error}</Alert>}
            {notice && <Alert tone="green">{notice}</Alert>}
            <Button type="submit">Update password</Button>
          </form>
        </Card>

        <Card title="Global defaults & integrations">
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex items-center justify-between">
              <span>Global OpenRouter API key</span>
              <Badge>env-driven</Badge>
            </li>
            <li className="flex items-center justify-between">
              <span>Session</span>
              <Badge>7-day signed cookie</Badge>
            </li>
          </ul>
          <div className="mt-3"><Alert tone="blue">
            The optional global OpenRouter key is read from <code>OPENROUTER_API_KEY</code> and used as a default for
            sites that do not set their own key. Per-site keys (encrypted) override it.
          </Alert></div>
        </Card>
      </div>
    </div>
  );
}
