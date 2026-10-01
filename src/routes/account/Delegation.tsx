import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RefreshCw, UserPlus, LogIn, X, Trash2, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { tNodes } from "../../components/consent/tNodes";
import { Pryv } from "../../lib/pryvClient";
import { Delegation } from "../../lib/pryvClient";
import type { DelegateRecord, ControlledRecord } from "../../lib/pryvClient";
import { Card, Button, Field, Alert, SectionLabel } from "../../components/ui";
import { useSession, type PryvConnection } from "../../lib/session";
import { NO_BACK_TO, inPopupOrFrame, parseBackTo } from "../../lib/backTo";
import { usernameRules, isValidUsername, normalizeUsernameInput } from "../../lib/username";
import {
  runFlow,
  toDelegateRow,
  toControlledRow,
  consentGrantsOf,
  toConsentGrantReview,
  approvedByUsername,
  acceptDelivered,
  detachDelegate,
  type AccessLike,
  type ConsentGrantReview,
  type DelegateRow,
} from "../../lib/delegation";
import { CreateManagedAccount, DelegateWarning } from "../../components/delegation/CreateManagedAccount";
import { DetachReviewDialog } from "../../components/delegation/DetachReviewDialog";

/**
 * Account-delegation management.
 *
 * Three surfaces, driven by `@pryv/delegation` over the current personal
 * session, in this order:
 *   - "Create a managed account" (A): make a brand-new account this account
 *     fully controls. First, because it is what a first-time visitor (a carer
 *     sent here by an app) comes for, and the only section with content before
 *     any delegation exists. `?create=1` (or `#create`) focuses its form; after
 *     a creation, a "Continue to {backLabel}" link leads back to `backUrl`.
 *   - "Accounts I manage" (A): accept/refuse invites, open an account I
 *     control, dismiss a stale row.
 *   - "My delegates" (this account, B): who can act on my behalf; request a
 *     delegate, detach an active delegate or cancel a pending invite (removal
 *     needs a genuine login on this account, surfaced gracefully if the
 *     session came from a delegated hand-off).
 *
 * Removing a delegate is intentionally B-side only (no detach on the A-side
 * "Accounts I manage" list): a delegate cannot detach itself.
 */
export default function DelegationPage() {
  const { t } = useTranslation();
  const { connection, actingAs, actAs } = useSession();
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  // Like the header link: not offered where following it would load the app
  // inside a script-opened window or a frame.
  const backTo = inPopupOrFrame() ? NO_BACK_TO : parseBackTo(search);
  const wantsCreate = new URLSearchParams(search).get("create") === "1" || hash === "#create";
  const createRef = useRef<HTMLDivElement>(null);
  const createFocused = useRef(false);

  const client = useMemo(
    () => (connection ? Delegation.fromConnection(connection, { pryv: Pryv }) : null),
    [connection],
  );

  const [delegates, setDelegates] = useState<DelegateRecord[] | null>(null);
  const [controlled, setControlled] = useState<ControlledRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // `created` marks the notice of a creation made in this page load, the only
  // one that offers the way on to the app that sent the user here.
  const [notice, setNotice] = useState<{ text: string; created: boolean } | null>(null);
  const showNotice = useCallback(
    (text: string | null) => setNotice(text ? { text, created: false } : null),
    [],
  );

  const load = useCallback(async () => {
    if (!client) return;
    setLoadError(null);
    const [d, c] = await Promise.all([
      runFlow(() => client.listDelegates()),
      runFlow(() => client.listControlled()),
    ]);
    if (d.ok) setDelegates(d.value);
    else setLoadError(d.message);
    if (c.ok) setControlled(c.value);
    else setLoadError((prev) => prev ?? c.message);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep link (`?create=1`, or `#create`): once the page has rendered with a
  // session, bring the creation form into view and put the cursor in it. Once
  // per mount, so a later re-render never steals the focus back.
  useEffect(() => {
    if (!wantsCreate || createFocused.current || !connection || !client) return;
    const section = createRef.current;
    if (!section) return;
    createFocused.current = true;
    section.scrollIntoView({ block: "start" });
    document.getElementById("managed-username")?.focus({ preventScroll: true });
  }, [wantsCreate, connection, client]);

  // After a creation the success notice sits above the form, out of sight on a
  // phone (the submit button is at the bottom of the form): bring it into view
  // and put the focus on the way on when there is one.
  const noticeRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!notice?.created) return;
    noticeRef.current?.scrollIntoView({ block: "nearest" });
    continueRef.current?.focus({ preventScroll: true });
  }, [notice]);

  if (!connection || !client) {
    return <p className="text-sm text-muted">{t("common.loading")}</p>;
  }

  return (
    <section className="space-y-8">
      {loadError && <Alert>{loadError}</Alert>}
      {notice && (
        <div ref={noticeRef} className="scroll-mt-4">
          <Alert tone="success">
            {notice.text}
            {/* The way on: the host is shown next to the label, as the header back link does. */}
            {notice.created && backTo.url && (
              <div className="mt-1">
                <a ref={continueRef} href={backTo.url} className="text-primary hover:underline">
                  {t("delegation.continueTo", { label: backTo.label ?? backTo.host })}
                </a>
                {backTo.label && backTo.host && <span className="text-muted"> ({backTo.host})</span>}
              </div>
            )}
          </Alert>
        </div>
      )}

      <div id="create" ref={createRef} className="scroll-mt-4">
        <CreateManagedAccount
          connection={connection}
          client={client}
          reload={load}
          onNotice={showNotice}
          onCreated={(text) => setNotice({ text, created: true })}
        />
      </div>

      <AccountsIManage
        client={client}
        controlled={controlled}
        reload={load}
        onNotice={showNotice}
        onOpen={async (username) => {
          // Hand-off: mint a delegate PAT for the controlled account and make it
          // this tab's active session ("act as that account"). The current
          // session is kept, and the banner offers to go back to it. The
          // delegated session cannot detach delegates (a genuine login is
          // required, surfaced under "My delegates").
          const res = await runFlow(() => client.openControlled(username));
          if (!res.ok) return res.message;
          const parentUsername = actingAs?.parentUsername ?? (await connection.username());
          actAs(res.value as unknown as PryvConnection, { username, parentUsername });
          navigate("/account/profile" + search);
          return null;
        }}
      />

      <MyDelegates
        client={client}
        delegates={delegates}
        reload={load}
        onNotice={showNotice}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 3: My delegates (B-side)                                     */
/* ------------------------------------------------------------------ */

function MyDelegates({
  client,
  delegates,
  reload,
  onNotice,
}: {
  client: Delegation;
  delegates: DelegateRecord[] | null;
  reload: () => Promise<void>;
  onNotice: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [inviteUsername, setInviteUsername] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requestDelegate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    onNotice(null);
    const username = normalizeUsernameInput(inviteUsername);
    if (!isValidUsername(username)) {
      setError(t("delegation.errInvalidUsernameRules", { rules: usernameRules() }));
      return;
    }
    setBusy("request");
    const res = await runFlow(() => client.requestAttach(username));
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setInviteUsername("");
    onNotice(t("delegation.noticeInviteSent", { username }));
    await reload();
  }

  // The consents a delegate gave for this account, under review before it is removed.
  const [review, setReview] = useState<{ username: string; grants: ConsentGrantReview[] } | null>(null);

  async function removeRow(row: DelegateRow) {
    setError(null);
    onNotice(null);
    if (row.action === "cancel") {
      setBusy(row.username);
      const res = await runFlow(() => client.cancelInvite(row.username));
      setBusy(null);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onNotice(t("delegation.noticeInviteCancelled"));
      await reload();
      return;
    }
    // Before a delegate goes, the consents it gave for this account are
    // reviewed one by one. If they cannot be listed, nothing is removed:
    // removing without the review would withdraw them all unasked.
    setBusy(row.username);
    let grants: ConsentGrantReview[];
    try {
      grants = await consentGrantReviews(client, row.relId);
    } catch {
      setBusy(null);
      setError(t("delegation.errLoadConsents"));
      return;
    }
    setBusy(null);
    if (grants.length > 0) {
      setReview({ username: row.username, grants });
      return;
    }
    await detach(row.username, [], 0);
  }

  async function detach(username: string, keepAccessIds: string[], total: number) {
    setBusy(username);
    const res = await runFlow(() => detachDelegate(client, username, keepAccessIds));
    // A core older than the review ignores the keep list and withdraws every
    // consent: report what is actually left, never what was asked.
    const kept = res.ok && keepAccessIds.length > 0 ? await stillThere(client, keepAccessIds) : keepAccessIds.length;
    setBusy(null);
    setReview(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    if (kept < keepAccessIds.length) setError(t("delegation.errKeepNotSupported"));
    onNotice(
      total > 0
        ? t("delegation.noticeDelegateRemovedReviewed", { kept, dropped: total - kept })
        : t("delegation.noticeDelegateRemoved"),
    );
    await reload();
  }

  const rows = (delegates ?? []).map(toDelegateRow);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-lg">{t("delegation.myDelegatesTitle")}</h2>
        <RefreshButton onClick={reload} />
      </div>
      <p className="mb-4 text-sm text-muted">
        {t("delegation.myDelegatesHint")}
      </p>
      {error && <Alert>{error}</Alert>}
      {delegates === null && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {delegates !== null && rows.length === 0 && (
        <p className="mb-4 text-sm text-muted">{t("delegation.noDelegates")}</p>
      )}
      <div className="mb-6 space-y-3">
        {rows.map((r) => (
          <Card key={r.key}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">{r.username}</div>
                <div className="text-xs text-muted">
                  {r.statusText}
                  {r.sinceText && t("delegation.sinceSuffix", { date: r.sinceText })}
                </div>
              </div>
              <button
                type="button"
                disabled={busy === r.username}
                onClick={() => void removeRow(r)}
                className="inline-flex items-center gap-1 rounded border border-danger px-3 py-1 text-sm text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
              >
                {r.action === "detach" ? <Trash2 size={14} aria-hidden /> : <X size={14} aria-hidden />}
                {r.action === "detach" ? t("delegation.remove") : t("common.cancel")}
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <SectionLabel>{t("delegation.requestTitle")}</SectionLabel>
        <p className="mb-3 text-sm text-muted">
          {t("delegation.requestHint")}
        </p>
        <form onSubmit={requestDelegate} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="flex-1">
            <Field
              id="delegate-username"
              label={t("delegation.delegateUsernameLabel")}
              value={inviteUsername}
              hint={usernameRules()}
              onChange={(e) => setInviteUsername(normalizeUsernameInput(e.target.value))}
            />
          </div>
          <Button type="submit" disabled={busy === "request"} className="sm:w-auto sm:self-start">
            <UserPlus size={14} aria-hidden className="mr-1" />
            {busy === "request" ? t("delegation.sending") : t("delegation.sendInvite")}
          </Button>
        </form>
      </Card>

      {review && (
        <DetachReviewDialog
          username={review.username}
          grants={review.grants}
          busy={busy === review.username}
          onConfirm={(keepAccessIds) => void detach(review.username, keepAccessIds, review.grants.length)}
          onCancel={() => setReview(null)}
        />
      )}
    </div>
  );
}

/**
 * How many of `accessIds` still exist on this account (all of them when they
 * cannot be listed). The compatibility probe for a core older than the review,
 * which ignores `keepAccessIds` and withdraws everything.
 */
async function stillThere(client: Delegation, accessIds: string[]): Promise<number> {
  try {
    const [res] = (await client.connection.api([{ method: "accesses.get", params: {} }])) as Array<{ accesses?: AccessLike[] }>;
    if (!Array.isArray(res?.accesses)) return accessIds.length;
    const ids = new Set(res.accesses.map((a) => a.id));
    return accessIds.filter((id) => ids.has(id)).length;
  } catch {
    return accessIds.length;
  }
}

/**
 * The consents the delegate of relationship `relId` gave for this account,
 * read with this account's own session. Who approved each is read from its
 * accept event, best-effort: a consent whose event cannot be read is still
 * listed.
 */
async function consentGrantReviews(client: Delegation, relId: string): Promise<ConsentGrantReview[]> {
  const [res] = (await client.connection.api([{ method: "accesses.get", params: {} }])) as Array<{
    accesses?: AccessLike[];
    error?: { message?: string };
  }>;
  if (res?.error || !Array.isArray(res?.accesses)) throw new Error(res?.error?.message ?? "accesses.get");
  const reviews = consentGrantsOf(res.accesses, relId).map(toConsentGrantReview);
  const withEvent = reviews.filter((r) => r.acceptEventId != null);
  if (withEvent.length === 0) return reviews;
  try {
    const events = (await client.connection.api(
      withEvent.map((r) => ({ method: "events.getOne", params: { id: r.acceptEventId } })),
    )) as Array<{ event?: unknown }>;
    withEvent.forEach((r, i) => {
      r.approvedBy = approvedByUsername(events[i]?.event);
      r.delivered = acceptDelivered(events[i]?.event);
    });
  } catch {
    /* best-effort: the review works without who approved */
  }
  return reviews;
}

/* ------------------------------------------------------------------ */
/* Section 2: Accounts I manage (A-side)                                */
/* ------------------------------------------------------------------ */

function AccountsIManage({
  client,
  controlled,
  reload,
  onNotice,
  onOpen,
}: {
  client: Delegation;
  controlled: ControlledRecord[] | null;
  reload: () => Promise<void>;
  onNotice: (msg: string | null) => void;
  /** Returns an error message, or null on success (after which it navigates). */
  onOpen: (username: string) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<string | null>(null);

  async function refuse(username: string) {
    setError(null);
    onNotice(null);
    setBusy(username);
    const res = await runFlow(() => client.refuseAttach(username));
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onNotice(t("delegation.noticeInviteRefused"));
    await reload();
  }

  async function confirmAccept(username: string) {
    setError(null);
    onNotice(null);
    setBusy(username);
    const res = await runFlow(() => client.acceptAttach(username));
    setBusy(null);
    setAcceptTarget(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onNotice(t("delegation.noticeNowManaging", { username }));
    await reload();
  }

  async function dismiss(username: string) {
    setError(null);
    onNotice(null);
    setBusy(username);
    const res = await runFlow(() => client.dismissControlled(username));
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await reload();
  }

  async function open(username: string) {
    setError(null);
    onNotice(null);
    setBusy(username);
    const msg = await onOpen(username);
    setBusy(null);
    if (msg) setError(msg);
  }

  const rows = (controlled ?? []).map(toControlledRow);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-lg">{t("delegation.managedTitle")}</h2>
        <RefreshButton onClick={reload} />
      </div>
      <p className="mb-4 text-sm text-muted">
        {t("delegation.managedHint")}
      </p>
      {error && <Alert>{error}</Alert>}
      {controlled === null && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {controlled !== null && rows.length === 0 && (
        <p className="text-sm text-muted">{t("delegation.noManaged")}</p>
      )}
      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.key}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium">
                  {r.username}
                  {r.hostSlug && <span className="text-muted"> · {r.hostSlug}</span>}
                </div>
                <div className="text-xs text-muted">
                  {r.statusText}
                  {r.sinceText && " · " + r.sinceText}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.kind === "invite" && (
                  <>
                    <button
                      type="button"
                      disabled={busy === r.username}
                      onClick={() => setAcceptTarget(r.username)}
                      className="inline-flex items-center gap-1 rounded border border-divider px-3 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                    >
                      <Check size={14} aria-hidden /> {t("delegation.accept")}
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.username}
                      onClick={() => void refuse(r.username)}
                      className="inline-flex items-center gap-1 rounded border border-divider px-3 py-1 text-sm text-muted hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                    >
                      <X size={14} aria-hidden /> {t("delegation.refuse")}
                    </button>
                  </>
                )}
                {r.kind === "active" && (
                  <button
                    type="button"
                    disabled={busy === r.username}
                    onClick={() => void open(r.username)}
                    className="inline-flex items-center gap-1 rounded border border-divider px-3 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                  >
                    <LogIn size={14} aria-hidden /> {t("delegation.open")}
                  </button>
                )}
                {r.kind === "stale" && (
                  <button
                    type="button"
                    disabled={busy === r.username}
                    onClick={() => void dismiss(r.username)}
                    className="inline-flex items-center gap-1 rounded border border-divider px-3 py-1 text-sm text-muted hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                  >
                    <Trash2 size={14} aria-hidden /> {t("delegation.dismiss")}
                  </button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {acceptTarget && (
        <AcceptDialog
          username={acceptTarget}
          busy={busy === acceptTarget}
          onConfirm={() => void confirmAccept(acceptTarget)}
          onCancel={() => setAcceptTarget(null)}
        />
      )}
    </div>
  );
}

function AcceptDialog({
  username,
  busy,
  onConfirm,
  onCancel,
}: {
  username: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg border border-divider bg-card p-6 shadow-lg">
        <h3 className="mb-2 text-lg">{t("delegation.acceptDialogTitle", { username })}</h3>
        <p className="mb-3 text-sm text-muted">
          {tNodes("delegation.acceptDialogBody", { username: <strong>{username}</strong> })}
        </p>
        <DelegateWarning />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onCancel} className="w-auto">
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={busy} className="w-auto">
            {busy ? t("delegation.accepting") : t("delegation.acceptConfirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RefreshButton({ onClick }: { onClick: () => Promise<void> | void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <RefreshCw size={14} aria-hidden /> {t("common.refresh")}
    </button>
  );
}
