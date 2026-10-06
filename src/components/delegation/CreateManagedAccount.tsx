import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Delegation } from "../../lib/pryvClient";
import { Card, Button, Field, Alert } from "../ui";
import type { PryvConnection } from "../../lib/session";
import { usernameRules, isValidUsername, normalizeUsernameInput } from "../../lib/username";
import {
  runFlow,
  delegateWarningLead,
  delegateWarningLines,
  coresFromServiceInfo,
  type CoreOption,
} from "../../lib/delegation";

/** Full-control warning shown before accepting an invite / creating an account. */
export function DelegateWarning() {
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

/** The account a creation made, as the server reported it. */
export interface CreatedAccount {
  username: string;
  hostSlug?: string;
}

/**
 * "Create a managed account": a brand-new account the signed-in account fully
 * controls (`delegations.createAccount`), with the full-control warning.
 *
 * Shared by the delegation page and the "who is this for?" step of `/auth`.
 * `client` must be built on the signed-in account's OWN personal session: the
 * new account's delegate is whoever submits.
 */
export function CreateManagedAccount({
  connection,
  client,
  reload,
  onNotice,
  onCreated,
  initialUsername,
  embedded = false,
}: {
  connection: PryvConnection;
  client: Delegation;
  reload: () => Promise<void>;
  onNotice: (msg: string | null) => void;
  /** The success notice of a creation (the caller adds what comes next), and the account created. */
  onCreated: (msg: string, created: CreatedAccount) => void;
  /** Pre-fills the username (the caller knows which account is wanted). */
  initialUsername?: string;
  /** Rendered inside another card: no section heading, no card of its own. */
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(() => normalizeUsernameInput(initialUsername ?? ""));
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
      setError(t("delegation.errInvalidUsernameRules", { rules: usernameRules() }));
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
    const controlled = res.value?.delegation?.controlled;
    const created: CreatedAccount = { username: controlled?.username ?? u };
    if (controlled?.hostSlug) created.hostSlug = controlled.hostSlug;
    onCreated(t("delegation.noticeAccountCreatedManaged", { username: created.username }), created);
    await reload();
  }

  const passwordField = (
    <Field
      id="managed-password"
      label={t("profile.password")}
      type="password"
      autoComplete="new-password"
      hint={t("delegation.managedPasswordHint")}
      value={password}
      onChange={(e) => setPassword(e.target.value)}
    />
  );

  const form: ReactNode = (
    <>
      {error && <Alert>{error}</Alert>}
      <DelegateWarning />
      <form onSubmit={onSubmit}>
        <Field
          id="managed-username"
          label={t("profile.username")}
          hint={usernameRules()}
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
        {/* Embedded in a sign-in flow, the optional password stays folded so
            a person who only wants to continue is not slowed down by it; the
            email stays visible (a request may need it). */}
        {embedded ? (
          <details className="mb-4" data-testid="managed-password-disclosure">
            <summary className="cursor-pointer text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {t("delegation.managedPasswordToggle")}
            </summary>
            <div className="mt-3">{passwordField}</div>
          </details>
        ) : (
          passwordField
        )}
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
    </>
  );

  if (embedded) return <div>{form}</div>;

  return (
    <div>
      <h2 className="mb-2 text-lg">{t("delegation.createTitle")}</h2>
      <p className="mb-4 text-sm text-muted">
        {t("delegation.createIntro")}
      </p>
      <Card>{form}</Card>
    </div>
  );
}
