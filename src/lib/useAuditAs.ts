import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSession } from "./useSession";
import { storedParentConnection, type PryvConnection } from "./sessionStore";
import { Pryv, Delegation } from "./pryvClient";
import { runFlow } from "./delegation";
import { asParam, withoutAs, resolveAs } from "./auditAs";

/**
 * `?as=<username>` on the access page and the Audit trail (see `auditAs.ts`):
 * `checking` while the managed accounts are listed, `offer` / `opening` around
 * the "Open as" card, a notice for `not-managed` / `list-failed` / `ignored`,
 * `none` when there is nothing (left) to do.
 */
export type AsState =
  | { kind: "none" }
  | { kind: "checking" }
  | { kind: "offer"; username: string; hostSlug?: string; error?: string | null }
  | { kind: "opening"; username: string; hostSlug?: string }
  | { kind: "not-managed"; username: string }
  | { kind: "list-failed"; username: string }
  | { kind: "ignored" };

export interface AsResolution {
  state: AsState;
  /**
   * Whether the page may load its data: it is decided which account it shows
   * (a late answer for the person's own account must never land after the switch).
   */
  ready: boolean;
  /** "Open as": what Open on the Delegation page does; the page then reloads as that account. */
  openAs: (username: string, hostSlug?: string) => Promise<void>;
  /** "Stay on my account". */
  stay: () => void;
}

/**
 * Read `as` once from `search`, drop it from the address at once (it would
 * ride on every in-app link and offer the switch again on the way back), and
 * resolve it against the accounts the signed-in person manages, listed with
 * their OWN session (the parent's while the pages act for another account).
 */
export function useAsResolution(search: string): AsResolution {
  const { t } = useTranslation();
  const { connection, actingAs, actAs } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [asRequested] = useState(() => asParam(search));
  const [state, setState] = useState<AsState>(() => (asRequested == null ? { kind: "none" } : { kind: "checking" }));
  const ready = state.kind !== "checking" && state.kind !== "offer" && state.kind !== "opening";
  const actingUsername = actingAs?.username ?? null;
  // Built only when a link asked for an account: a page without `as` needs neither.
  const ownerConnection = useMemo<PryvConnection | null>(
    () => (asRequested == null ? null : actingUsername != null ? storedParentConnection() : connection),
    [asRequested, actingUsername, connection],
  );
  const ownerClient = useMemo(
    () => (ownerConnection ? Delegation.fromConnection(ownerConnection, { pryv: Pryv }) : null),
    [ownerConnection],
  );
  const checkPending = state.kind === "checking";
  useEffect(() => {
    if (!checkPending || asRequested == null || !connection) return;
    navigate({ pathname, search: withoutAs(search) }, { replace: true });
    let cancelled = false;
    void (async () => {
      // Shape, and the account the pages already act for: no listing needed.
      const first = resolveAs({ as: asRequested, selfUsername: null, actingUsername, controlled: [] });
      // Without a list, `not-managed` here only means: a valid username, not the
      // account acted for. Anything else is decided already.
      if (first.kind !== "not-managed") {
        if (!cancelled) setState(first.kind === "ignored" ? { kind: "ignored" } : { kind: "none" });
        return;
      }
      if (!ownerConnection || !ownerClient) {
        if (!cancelled) setState({ kind: "list-failed", username: first.username });
        return;
      }
      let selfUsername: string | null = null;
      try {
        selfUsername = await ownerConnection.username();
      } catch {
        selfUsername = null;
      }
      if (cancelled) return;
      if (selfUsername === first.username) {
        setState({ kind: "none" });
        return;
      }
      const listed = await runFlow(() => ownerClient.listControlled());
      if (cancelled) return;
      if (!listed.ok) {
        setState({ kind: "list-failed", username: first.username });
        return;
      }
      const resolution = resolveAs({ as: asRequested, selfUsername, actingUsername, controlled: listed.value });
      setState(resolution.kind === "offer" ? { ...resolution, error: null } : resolution);
    })();
    return () => {
      cancelled = true;
    };
    // Once per page: `search` and `pathname` change only through the strip above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkPending, connection]);

  async function openAs(username: string, hostSlug?: string) {
    if (!ownerConnection || !ownerClient || !actAs) return;
    setState({ kind: "opening", username, hostSlug });
    const res = await runFlow(() => ownerClient.openControlled(username));
    if (!res.ok) {
      setState({ kind: "offer", username, hostSlug, error: res.message });
      return;
    }
    let parentUsername = actingAs?.parentUsername ?? null;
    if (parentUsername == null) {
      try {
        parentUsername = await ownerConnection.username();
      } catch {
        setState({ kind: "offer", username, hostSlug, error: t("delegation.errGeneric") });
        return;
      }
    }
    actAs(res.value as unknown as PryvConnection, { username, parentUsername });
    setState({ kind: "none" });
  }

  return { state, ready, openAs, stay: () => setState({ kind: "none" }) };
}
