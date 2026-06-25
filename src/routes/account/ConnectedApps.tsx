import { useEffect, useState, useCallback } from "react";
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
  const { connection } = useSession();
  const [accesses, setAccesses] = useState<Access[] | null>(null);
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

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    if (!connection) return;
    setRevoking(id);
    setError(null);
    try {
      const [res] = (await connection.api([
        { method: "accesses.delete", params: { id } },
      ])) as Array<{ error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
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
                <div className="font-medium">{a.name}</div>
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
