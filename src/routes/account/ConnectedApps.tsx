import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, ScrollText } from "lucide-react";
import { Card, Button, Alert } from "../../components/ui";
import { useSession } from "../../lib/session";
import { subscribeToAccessChanges } from "../../lib/socket";

interface Access {
  id: string;
  name: string;
  type?: string;
  permissions?: Array<{ streamId?: string; level?: string }>;
  lastUsed?: number;
}

/**
 * List the account's app accesses. Each row links to the audit-access
 * details page, which hosts the Revoke action.
 */
export default function ConnectedApps() {
  const { connection } = useSession();
  const [accesses, setAccesses] = useState<Access[] | null>(null);
  const [selfAccessId, setSelfAccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Live refresh: the server pushes `accessChanged` over Socket.IO whenever
  // an access is created, modified or revoked (e.g. by another app or an
  // access-request consent in a different tab). Loss of the socket is
  // non-fatal — the manual Refresh path stays available.
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!connection) return;
    setLive(true);
    const unsubscribe = subscribeToAccessChanges(
      connection,
      () => void load(),
      () => setLive(false),
    );
    return () => {
      setLive(false);
      unsubscribe();
    };
  }, [connection, load]);

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
              <Link
                to={`/account/audit-access/${encodeURIComponent(a.id)}`}
                className="inline-flex items-center gap-1 rounded border border-divider px-3 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ScrollText size={14} aria-hidden />
                Details
              </Link>
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="ghost" type="button" onClick={() => void load()} className="w-auto">
          <RefreshCw size={14} aria-hidden className="mr-1" /> Refresh
        </Button>
        {live && (
          <span className="text-xs text-muted" title="Connected via Socket.IO — this list updates automatically">
            ● live updates on
          </span>
        )}
      </div>
    </section>
  );
}
