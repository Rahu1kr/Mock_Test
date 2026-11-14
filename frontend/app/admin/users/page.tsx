"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button, Card, ErrorNote, Field, Spinner, inputClass } from "@/components/ui";

interface UserRow {
  _id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
}

/** The app is invite-only: accounts are created here, there is no public signup. */
export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setUsers(await api<UserRow[]>("/admin/users"));
  }, []);

  useEffect(() => {
    api<UserRow[]>("/admin/users")
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load users"));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/admin/users", { method: "POST", body: { email, password } });
      setNotice(`Account created for ${email}. Share the password with them privately.`);
      setEmail("");
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: UserRow) {
    const ok = await confirm({
      title: "Remove account?",
      message: `${u.email} will no longer be able to sign in.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api(`/admin/users/${u._id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the account");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-semibold">Add a user</h2>
        <p className="mt-1 text-sm text-muted">
          The app is private — only accounts created here can sign in.
        </p>
        <form onSubmit={create} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password (min 8 characters)">
            <input
              className={inputClass}
              type="text"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add user"}
          </Button>
        </form>
        {notice && <p className="mt-3 text-sm text-correct">{notice}</p>}
      </Card>

      {error && <ErrorNote message={error} />}
      {!users && !error && <Spinner />}

      {users && (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u._id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.email}</p>
                  <p className="text-xs text-muted">
                    {u.role} · added {new Date(u.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {u._id !== me?.id && (
                  <Button variant="danger" onClick={() => remove(u)}>
                    Remove
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
