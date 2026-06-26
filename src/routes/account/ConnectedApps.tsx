import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Button, Alert } from "../../components/ui";
import { useSession } from "../../lib/session";

interface Access {
  id: string;
  name: string;
  type?: string;
  permissions?: Array<{ streamId?: string; level?: string }>;
  lastUsed?: number;
}

/** List the account's app accesses and let the subject revoke them. */
export default function ConnectedApps() {
  const { connection, setConnection } = useSession();
  const navigate = useNavigate();
  const [accesses, setAccesses] = useState<Access[] | null>(null);
  const [selfAccessId, setSelfAccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!connection) return;
    setError(null);
    try {
      const [res] = (await connection.api([
        { method: "accesses.get", params: {} },
      ])) as Array<{ accesses?: Access[]; error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      setAccesses(res?.accesses ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load connected apps.");
    }
  }, [connection]);

  // Note which access ID belongs to the current session so we can warn the
  // subject before they revoke themselves and clean up the local session
  // when they do.
  useEffect(() => {
    if (!connection) return;
    connection
      .accessInfo()
      .then((info: unknown) => {
        const id = (info as { id?: string } | null)?.id;
        if (id) setSelfAccessId(id);
      })
      .catch(() => {
        /* non-fatal — self-access marker is a UX helper, not required */
      });
  }, [connection]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    if (!connection) return;
    if (id === selfAccessId) {
      const ok = window.confirm(
        "This is the access you used to sign in. Revoking it will sign you out immediately. Continue?",
      );
      if (!ok) return;
    }
    setRevoking(id);
    setError(null);
    try {
      const [res] = (await connection.api([
        { method: "accesses.delete", params: { id } },
      ])) as Array<{ error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      if (id === selfAccessId) {
        setConnection(null);
        navigate("/signin", { replace: true });
        return;
      }
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not revoke access.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <section>
      <p className="mb-4 text-sm text-muted">
        Apps and services with access to your account. Revoke any you no longer use.
      </p>
      {error && <Alert>{error}</Alert>}
      {accesses === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {accesses?.length === 0 && <p className="text-sm text-muted">No connected apps.</p>}
      <div className="space-y-3">
        {accesses?.map((a) => (
          <Card key={a.id}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">
                  {a.name}
                  {a.id === selfAccessId && (
                    <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                      this session
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {a.type ?? "app"} · {a.permissions?.length ?? 0} permission(s)
                </div>
              </div>
              <button
                onClick={() => revoke(a.id)}
                disabled={revoking === a.id}
                className="rounded border border-danger px-3 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {revoking === a.id ? "Revoking…" : "Revoke"}
              </button>
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-4">
        <Button variant="ghost" type="button" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
    </section>
  );
}
