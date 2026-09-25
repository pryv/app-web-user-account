import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RefreshCw, UserPlus, LogIn, X, Trash2, Check } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Pryv } from "../../lib/pryvClient";
import { Delegation } from "../../lib/pryvClient";
import type { DelegateRecord, ControlledRecord } from "../../lib/pryvClient";
import { Card, Button, Field, Alert, SectionLabel } from "../../components/ui";
import { useSession, type PryvConnection } from "../../lib/session";
import { USERNAME_RULES, isValidUsername, normalizeUsernameInput } from "../../lib/username";
import {
  runFlow,
  delegateWarningLead,
  delegateWarningLines,
  toDelegateRow,
  toControlledRow,
  coresFromServiceInfo,
  type CoreOption,
} from "../../lib/delegation";

/**
 * Account-delegation management.
 *
 * Three surfaces, driven by `@pryv/delegation` over the current personal
 * session:
 *   - "My delegates" (this account, B): who can act on my behalf; detach an
 *     active delegate or cancel a pending invite (both need a genuine login on
 *     this account — surfaced gracefully if the session came from a delegated
 *     hand-off).
 *   - "Accounts I manage" (A): accept/refuse invites, open an account I
 *     control, dismiss a stale row.
 *   - "Create a managed account" (A): make a brand-new account this account
 *     fully controls.
 *
 * Removing a delegate is intentionally B-side only (no detach on the A-side
 * "Accounts I manage" list): a delegate cannot detach itself.
 */
export default function DelegationPage() {
  const { t } = useTranslation();
  const { connection, actingAs, actAs } = useSession();
  const { search } = useLocation();
  const navigate = useNavigate();

  const client = useMemo(
    () => (connection ? Delegation.fromConnection(connection, { pryv: Pryv }) : null),
    [connection],
  );

  const [delegates, setDelegates] = useState<DelegateRecord[] | null>(null);
  const [controlled, setControlled] = useState<ControlledRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  if (!connection || !client) {
    return <p className="text-sm text-muted">{t("common.loading")}</p>;
  }

  return (
    <section className="space-y-8">
      {loadError && <Alert>{loadError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <MyDelegates
        client={client}
        delegates={delegates}
        reload={load}
        onNotice={setNotice}
      />

      <AccountsIManage
        client={client}
        controlled={controlled}
        reload={load}
        onNotice={setNotice}
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

      <CreateManagedAccount connection={connection} client={client} reload={load} onNotice={setNotice} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 1 — My delegates (B-side)                                    */
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
      setError(t("delegation.errInvalidUsernameRules", { rules: USERNAME_RULES }));
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

  async function removeRow(username: string, action: "detach" | "cancel") {
    setError(null);
    onNotice(null);
    setBusy(username);
    const res = await runFlow(() =>
      action === "detach" ? client.detachDelegate(username) : client.cancelInvite(username),
    );
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onNotice(action === "detach" ? t("delegation.noticeDelegateRemoved") : t("delegation.noticeInviteCancelled"));
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
                onClick={() => void removeRow(r.username, r.action)}
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
              hint={USERNAME_RULES}
              onChange={(e) => setInviteUsername(normalizeUsernameInput(e.target.value))}
            />
          </div>
          <Button type="submit" disabled={busy === "request"} className="sm:w-auto sm:self-start">
            <UserPlus size={14} aria-hidden className="mr-1" />
            {busy === "request" ? t("delegation.sending") : t("delegation.sendInvite")}
          </Button>
        </form>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section 2 — Accounts I manage (A-side)                               */
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

/** Full-control warning shown before accepting an invite / creating an account. */
function DelegateWarning() {
  // Subscribes to language changes; the copy itself comes from the lib.
  useTranslation();
  return (
    <div className="mb-4 rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      <p className="mb-2 font-medium">{delegateWarningLead()}</p>
      <ul className="list-disc space-y-1 pl-5">
        {delegateWarningLines().map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
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
          <Trans i18nKey="delegation.acceptDialogBody" values={{ username }} components={{ b: <strong /> }} />
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
/* Section 3 — Create a managed account (A-side)                        */
/* ------------------------------------------------------------------ */

function CreateManagedAccount({
  connection,
  client,
  reload,
  onNotice,
}: {
  connection: PryvConnection;
  client: Delegation;
  reload: () => Promise<void>;
  onNotice: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [core, setCore] = useState("");
  const [cores, setCores] = useState<CoreOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Best-effort: only show the core selector on a multi-core platform.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await connection.service.info();
        if (cancelled) return;
        setCores(coresFromServiceInfo(info));
      } catch {
        if (!cancelled) setCores([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    onNotice(null);
    const u = normalizeUsernameInput(username);
    if (!isValidUsername(u)) {
      setError(t("delegation.errInvalidUsernameRules", { rules: USERNAME_RULES }));
      return;
    }
    setBusy(true);
    const res = await runFlow(() =>
      client.createAccount({
        username: u,
        email: email.trim() || undefined,
        password: password || undefined,
        core: core || undefined,
      }),
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setUsername("");
    setEmail("");
    setPassword("");
    onNotice(t("delegation.noticeAccountCreatedManaged", { username: u }));
    await reload();
  }

  return (
    <div>
      <h2 className="mb-2 text-lg">{t("delegation.createTitle")}</h2>
      <p className="mb-4 text-sm text-muted">
        {t("delegation.createIntro")}
      </p>
      <Card>
        {error && <Alert>{error}</Alert>}
        <DelegateWarning />
        <form onSubmit={onSubmit}>
          <Field
            id="managed-username"
            label={t("profile.username")}
            hint={USERNAME_RULES}
            value={username}
            onChange={(e) => setUsername(normalizeUsernameInput(e.target.value))}
            required
          />
          <Field
            id="managed-email"
            label={t("profile.email")}
            type="email"
            hint={t("delegation.managedEmailHint")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            id="managed-password"
            label={t("profile.password")}
            type="password"
            autoComplete="new-password"
            hint={t("delegation.managedPasswordHint")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {cores.length > 1 && (
            <div className="mb-4">
              <label htmlFor="managed-core" className="mb-1 block text-sm font-medium text-muted">
                {t("delegation.coreLabel")}
              </label>
              <select
                id="managed-core"
                value={core}
                onChange={(e) => setCore(e.target.value)}
                className="w-full rounded border border-divider bg-card text-ink px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
              >
                <option value="">{t("delegation.coreDefault")}</option>
                {cores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button type="submit" disabled={busy}>
            <UserPlus size={14} aria-hidden className="mr-1" />
            {busy ? t("delegation.creating") : t("delegation.createSubmit")}
          </Button>
        </form>
      </Card>
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
