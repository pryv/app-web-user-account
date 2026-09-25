import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService } from "../lib/service";
import { getLegalSettings } from "../lib/deployedSettings";
import { resolveLocalizedUrl, safeLegalUrl } from "../lib/legal";
import { parseAuthParams, accessRequestSearch, hasPendingAccessRequest } from "../lib/authParams";
import { signedInTarget } from "../lib/signInCompletion";
import { useSession, type PryvConnection } from "../lib/session";
import { brand } from "../brand";
import { USERNAME_RULES, isValidUsername, normalizeUsernameInput } from "../lib/username";
import {
  registrationRequiresVerifiedEmail,
  requestEmailChallenge,
  verifyEmailChallenge,
  registerWithProof,
  emailVerificationErrorMessage,
  normalizeCodeInput,
  formatCodeInput,
} from "../lib/emailVerification";

interface FlatHosting {
  key: string;
  name?: string;
  description?: string;
  availableCore?: string;
  available?: boolean;
}

/** Account registration via `Service.createUser`. */
export default function Register() {
  const { t, i18n } = useTranslation();
  // The UI language, reduced to its base code, is what the account is created with.
  const language = i18n.language.split("-")[0];
  const { search } = useLocation();
  const navigate = useNavigate();
  const { setConnection } = useSession();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [hostings, setHostings] = useState<FlatHosting[] | null>(null);
  const [selectedHosting, setSelectedHosting] = useState<string>("");
  const [hostingsError, setHostingsError] = useState<string | null>(null);

  // Registration email gate. `null` until the service-info answers; the form
  // stays in its optional-email shape until we know the platform requires one.
  const [gateOn, setGateOn] = useState<boolean | null>(null);
  const [challengeSent, setChallengeSent] = useState(false);
  const [code, setCode] = useState("");
  const [emailProof, setEmailProof] = useState<string | null>(null);
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [challengeNotice, setChallengeNotice] = useState<string | null>(null);

  // Terms acceptance. Shown, unticked and required only when the deployment
  // names a Terms or Privacy document: without one the tick would mean nothing.
  // Terms come from settings.json `legal.terms`, else the service-info `terms`.
  const [serviceTerms, setServiceTerms] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const lang = i18n.language;
  const legal = getLegalSettings();
  const termsUrl = resolveLocalizedUrl(legal?.terms, lang) ?? serviceTerms;
  const privacyUrl = resolveLocalizedUrl(legal?.privacy, lang);
  const termsRequired = termsUrl != null || privacyUrl != null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const svc = getService(search) as unknown as {
          flatHostings?: () => Promise<FlatHosting[]>;
          info: () => Promise<unknown>;
        };
        try {
          const info = await svc.info();
          if (!cancelled) {
            setGateOn(registrationRequiresVerifiedEmail(info as never));
            setServiceTerms(safeLegalUrl((info as { terms?: unknown } | null)?.terms));
          }
        } catch {
          // Older core, or the service-info is unreachable: treat the gate as
          // off rather than blocking sign-up on a flag we could not read.
          if (!cancelled) setGateOn(false);
        }
        if (typeof svc.flatHostings !== "function") {
          // Older Service shape — keep the `hosting: 'auto'` default fallback.
          if (!cancelled) setHostings([]);
          return;
        }
        const list = await svc.flatHostings();
        if (cancelled) return;
        const available = list.filter((h) => h.available !== false);
        setHostings(available);
        // Pre-select the first available hosting (matches legacy behaviour).
        if (available.length > 0) setSelectedHosting(available[0].key);
      } catch (err: unknown) {
        if (cancelled) return;
        setHostingsError(err instanceof Error ? err.message : t("register.hostingsLoadError"));
        setHostings([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search, t]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidUsername(username)) {
      setError(t("register.invalidUsername") + USERNAME_RULES);
      return;
    }
    if (password !== confirm) {
      setError(t("register.passwordMismatch"));
      return;
    }
    if (termsRequired && !accepted) {
      setError(t("register.acceptTermsRequired"));
      return;
    }
    if (gateOn === true && emailProof == null) {
      setError(t("emailVerification.errorVerifyFirst"));
      return;
    }
    setBusy(true);
    try {
      const { appId, serviceInfoUrl } = parseAuthParams(search);
      const service = getService(search);
      if (gateOn === true && emailProof != null) {
        // The gate needs the proof carried on the create-account call, which
        // the client's createUser does not send, so post it directly.
        const info = (await service.info()) as unknown as { register: string };
        await registerWithProof(info.register, {
          appId,
          username,
          password,
          email,
          hosting: selectedHosting || (await firstAvailableHosting(service, t("register.noHostingAvailable"))),
          language,
          invitationToken: "enjoy",
          emailProof,
        });
      } else {
        // Email is optional; generate a placeholder when empty so the server's
        // required-field check passes (mirrors legacy `generateRandomEmailIfNeeded`).
        const finalEmail = email && email.length > 0 ? email : randomLocalPart() + "@pryv.io";
        await service.createUser({
          username,
          email: finalEmail,
          password,
          appId,
          // When the user picked a hosting from the dropdown, send the key;
          // when no hostings list was available (Service lacks flatHostings or
          // call failed) fall back to the legacy `auto` sentinel.
          hosting: selectedHosting || "auto",
          language,
        });
      }
      // Sign the fresh account in directly (same path as /signin) so the
      // user doesn't have to re-enter the credentials they just chose.
      try {
        const connection = (await service.login(
          username,
          password,
          appId,
        )) as unknown as PryvConnection;
        setConnection(connection, serviceInfoUrl);
        // Same decision as every other sign-in: a pending access request goes
        // back to /auth, then returnURL, then the hand-off page, then profile.
        const target = signedInTarget(search, connection.endpoint);
        if (target.kind === "external") window.location.href = target.href;
        // Replace, so /auth can still close this tab (popup mode) afterwards.
        else navigate(target.path, { replace: hasPendingAccessRequest(search) });
        return;
      } catch {
        // Account exists but auto-sign-in failed (e.g. platform-side MFA
        // policy) — fall back to the confirmation card with the sign-in link.
        setDone(true);
      }
    } catch (err: unknown) {
      // Route through the shared mapper so a verification-related refusal reads
      // as guidance rather than as the server's raw sentence.
      setError(err instanceof Error ? emailVerificationErrorMessage(err) : t("register.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onSendCode() {
    setError(null);
    setChallengeNotice(null);
    setChallengeBusy(true);
    try {
      const service = getService(search);
      const info = (await service.info()) as unknown as { register: string };
      await requestEmailChallenge(info.register, email, language);
      setChallengeSent(true);
      setChallengeNotice(t("emailVerification.codeSent", { email }));
    } catch (err: unknown) {
      setError(emailVerificationErrorMessage(err));
    } finally {
      setChallengeBusy(false);
    }
  }

  async function onVerifyCode() {
    setError(null);
    setChallengeNotice(null);
    setChallengeBusy(true);
    try {
      const service = getService(search);
      const info = (await service.info()) as unknown as { register: string };
      const proof = await verifyEmailChallenge(info.register, email, normalizeCodeInput(code));
      setEmailProof(proof);
      setChallengeNotice(t("emailVerification.codeAccepted"));
    } catch (err: unknown) {
      // Keep the typed code so the holder can correct a single character.
      setError(emailVerificationErrorMessage(err));
    } finally {
      setChallengeBusy(false);
    }
  }

  // With a pending access request, signing in happens on /auth itself, so the
  // grant is issued in the same step.
  const signInPath = hasPendingAccessRequest(search)
    ? `/auth${accessRequestSearch(search)}`
    : `/signin${search}`;

  if (done) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("register.createdTitle")}</h1>
        <Alert tone="success">{t("register.accountReady")}</Alert>
        <Link to={signInPath} className="text-primary hover:underline">
          {t("register.continueToSignIn")}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">{t("register.title")}</h1>
      <p className="mb-6 text-sm text-muted">{t("register.subtitle", { account: brand.accountNoun })}</p>
      {error && <Alert>{error}</Alert>}
      {hostingsError && <Alert tone="info">{hostingsError}{t("register.fallbackHosting")}</Alert>}
      <form onSubmit={onSubmit}>
        <Field
          id="username"
          label={t("register.usernameLabel")}
          autoComplete="username"
          hint={USERNAME_RULES}
          value={username}
          onChange={(e) => setUsername(normalizeUsernameInput(e.target.value))}
          required
        />
        {gateOn === true ? (
          <>
            <Field
              id="email"
              label={t("register.emailLabel")}
              type="email"
              autoComplete="email"
              hint={t("register.emailHintRequired")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={emailProof != null}
              required
            />
            <div className="mb-4">
              {challengeNotice && <Alert tone="success">{challengeNotice}</Alert>}
              {emailProof == null ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void onSendCode()}
                    disabled={challengeBusy || !email}
                  >
                    {challengeSent ? t("emailVerification.sendNewCode") : t("emailVerification.sendCode")}
                  </Button>
                  {challengeSent && (
                    <>
                      <Field
                        id="emailCode"
                        label={t("emailVerification.codeLabel")}
                        autoComplete="one-time-code"
                        inputMode="text"
                        placeholder="XXXX-XXXX"
                        value={formatCodeInput(code)}
                        onChange={(e) => setCode(normalizeCodeInput(e.target.value))}
                      />
                      <Button
                        type="button"
                        onClick={() => void onVerifyCode()}
                        disabled={challengeBusy || code.length === 0}
                      >
                        {t("emailVerification.verifyCode")}
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEmailProof(null);
                      setChallengeSent(false);
                      setCode("");
                      setChallengeNotice(null);
                    }}
                  >
                    {t("emailVerification.changeEmail")}
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <Field
            id="email"
            label={t("register.emailLabel")}
            type="email"
            autoComplete="email"
            hint={t("register.emailHint")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        <Field
          id="password"
          label={t("password.label")}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Field
          id="passwordConfirm"
          label={t("password.confirmationLabel")}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {hostings && hostings.length > 0 && (
          <div className="mb-4">
            <label htmlFor="hosting" className="mb-1 block text-sm font-medium text-muted">
              {t("register.hostingLabel")}
            </label>
            <select
              id="hosting"
              value={selectedHosting}
              onChange={(e) => setSelectedHosting(e.target.value)}
              className="w-full rounded border border-divider bg-card text-ink px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
              required
            >
              {hostings.map((h) => (
                <option key={h.key} value={h.key}>
                  {h.name || h.key}
                  {h.description ? " — " + h.description : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* gateOn === null means the service-info has not answered yet: submitting
            then would take the no-gate path and be refused by the core. */}
        {termsRequired && (
          <div className="mb-4 flex items-start gap-2">
            <input
              id="acceptTerms"
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              required
              className="mt-1 h-4 w-4 shrink-0 accent-primary"
            />
            <label htmlFor="acceptTerms" className="text-sm text-ink">
              <TermsLabel termsUrl={termsUrl} privacyUrl={privacyUrl} />
            </label>
          </div>
        )}
        <Button
          type="submit"
          disabled={
            busy || gateOn === null || (gateOn && emailProof == null) || (termsRequired && !accepted)
          }
        >
          {busy ? t("register.submitting") : t("register.submit")}
        </Button>
      </form>
      <div className="mt-4 text-sm">
        <Link to={signInPath} className="text-primary hover:underline">
          {t("register.alreadyHaveAccountSignIn")}
        </Link>
      </div>
    </Card>
  );
}

/** "I accept ..." naming only the documents the deployment links to. */
function TermsLabel({ termsUrl, privacyUrl }: { termsUrl: string | null; privacyUrl: string | null }) {
  const i18nKey =
    termsUrl && privacyUrl
      ? "register.acceptTermsAndPrivacy"
      : termsUrl
        ? "register.acceptTermsOnly"
        : "register.acceptPrivacyOnly";
  return (
    <Trans
      i18nKey={i18nKey}
      components={{
        terms: <LegalLink href={termsUrl ?? ""} />,
        privacy: <LegalLink href={privacyUrl ?? ""} />,
      }}
    />
  );
}

function LegalLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      {children}
    </a>
  );
}

/**
 * First hosting the platform reports as available, mirroring what the client's
 * `createUser({ hosting: 'auto' })` resolves internally. The gate path posts the
 * registration itself, so it has to pick the hosting the same way.
 */
async function firstAvailableHosting(service: unknown, noneMessage: string): Promise<string> {
  const svc = service as { flatHostings?: () => Promise<FlatHosting[]> };
  if (typeof svc.flatHostings === "function") {
    const list = await svc.flatHostings();
    const available = list.find((h) => h.available !== false);
    if (available) return available.key;
  }
  throw new Error(noneMessage);
}

function randomLocalPart(): string {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
