import { useEffect, useState, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { RefreshCw, ScrollText } from "lucide-react";
import { Card, Button, Alert } from "../../components/ui";
import { useSession } from "../../lib/session";
import { subscribeToAccessChanges } from "../../lib/socket";
import { delegationManagedKind, managedKindLabel } from "../../lib/delegation";

interface Access {
  id: string;
  name: string;
  type?: string;
  permissions?: Array<{ streamId?: string; level?: string }>;
  lastUsed?: number;
  clientData?: Record<string, unknown> | null;
}

/**
 * List the account's app accesses. Each row links to the audit-access
 * details page, which hosts the Revoke action.
 *
 * Accesses that run an account delegation (the control access, the
 * delegate's session, ...) are listed apart: they cannot be revoked one by
 * one and go away when the delegation is detached, which is done from the
 * delegation page.
 */
export default function ConnectedApps() {
  const { connection } = useSession();
  // Carried on every in-app link so the platform choice (pryvServiceInfoUrl) survives.
  const { search } = useLocation();
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

  const apps = accesses?.filter((a) => delegationManagedKind(a) == null) ?? null;
  const managed =
    accesses
      ?.map((access) => ({ access, kind: delegationManagedKind(access) }))
      .filter((m): m is { access: Access; kind: string } => m.kind != null) ?? null;

  return (
    <section>
      <p className="mb-4 text-sm text-muted">
        Apps and services with access to your account. Revoke any you no longer use.
      </p>
      {error && <Alert>{error}</Alert>}
      {accesses === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {apps?.length === 0 && <p className="text-sm text-muted">No connected apps.</p>}
      <div className="space-y-3">
        {apps?.map((a) => (
          <AccessRow key={a.id} access={a} isSelf={a.id === selfAccessId} search={search} />
        ))}
      </div>
      {managed != null && managed.length > 0 && (
        <section className="mt-6" aria-labelledby="managed-by-delegation">
          <h2 id="managed-by-delegation" className="mb-1 text-xs uppercase tracking-wide text-muted">
            Managed by account delegation
          </h2>
          <p className="mb-3 text-sm text-muted">
            These accesses keep an account delegation working and cannot be revoked here. They are
            removed when the delegation ends:{" "}
            <Link to={"/account/delegation" + search} className="text-primary hover:underline">
              manage account delegation
            </Link>
            .
          </p>
          <div className="space-y-3">
            {managed.map(({ access, kind }) => (
              <AccessRow
                key={access.id}
                access={access}
                isSelf={access.id === selfAccessId}
                kindLabel={managedKindLabel(kind)}
                search={search}
              />
            ))}
          </div>
        </section>
      )}
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

/** One access: name, type, and the link to its details and audit trail. */
function AccessRow({ access: a, isSelf, kindLabel, search }: { access: Access; isSelf: boolean; kindLabel?: string; search: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium">
            {a.name}
            {isSelf && (
              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                this session
              </span>
            )}
          </div>
          <div className="text-xs text-muted">
            {kindLabel ?? a.type ?? "app"} · {a.permissions?.length ?? 0} permission(s)
          </div>
        </div>
        <Link
          to={`/account/audit-access/${encodeURIComponent(a.id)}${search}`}
          className="inline-flex items-center gap-1 rounded border border-divider px-3 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ScrollText size={14} aria-hidden />
          Details
        </Link>
      </div>
    </Card>
  );
}
