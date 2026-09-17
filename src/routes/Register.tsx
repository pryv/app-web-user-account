import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService } from "../lib/service";
import { parseAuthParams, buildCompletionUrl } from "../lib/authParams";
import { handoffReturnPath } from "../lib/handoffReturn";
import { useSession, type PryvConnection } from "../lib/session";
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
          if (!cancelled) setGateOn(registrationRequiresVerifiedEmail(info as never));
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
        setHostingsError(err instanceof Error ? err.message : "Could not load hostings.");
        setHostings([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidUsername(username)) {
      setError("Invalid username — " + USERNAME_RULES);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (gateOn === true && emailProof == null) {
      setError("Please verify your email address first.");
      return;
    }
    setBusy(true);
    try {
      const { appId, returnURL, serviceInfoUrl, state } = parseAuthParams(search);
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
          hosting: selectedHosting || (await firstAvailableHosting(service)),
          language: "en",
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
        if (returnURL) {
          window.location.href = buildCompletionUrl(
            returnURL,
            connection.endpoint,
            state,
          );
        } else {
          const target = serviceInfoUrl
            ? "/account/profile?pryvServiceInfoUrl=" + encodeURIComponent(serviceInfoUrl)
            : "/account/profile";
          // Back to the hand-off page the user came from, if any.
          navigate(handoffReturnPath(search) ?? target);
        }
        return;
      } catch {
        // Account exists but auto-sign-in failed (e.g. platform-side MFA
        // policy) — fall back to the confirmation card with the sign-in link.
        setDone(true);
      }
    } catch (err: unknown) {
      // Route through the shared mapper so a verification-related refusal reads
      // as guidance rather than as the server's raw sentence.
      setError(err instanceof Error ? emailVerificationErrorMessage(err) : "Registration failed.");
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
      await requestEmailChallenge(info.register, email, "en");
      setChallengeSent(true);
      setChallengeNotice(`We sent a code to ${email}. Paste it below.`);
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
      setChallengeNotice("Email verified. You can now create your account.");
    } catch (err: unknown) {
      // Keep the typed code so the holder can correct a single character.
      setError(emailVerificationErrorMessage(err));
    } finally {
      setChallengeBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Account created</h1>
        <Alert tone="success">Your account is ready.</Alert>
        <Link to={`/signin${search}`} className="text-primary hover:underline">
          Continue to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">Create account</h1>
      <p className="mb-6 text-sm text-muted">Register a new Pryv account.</p>
      {error && <Alert>{error}</Alert>}
      {hostingsError && <Alert tone="info">{hostingsError} Falling back to default hosting.</Alert>}
      <form onSubmit={onSubmit}>
        <Field
          id="username"
          label="Username"
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
              label="Email"
              type="email"
              autoComplete="email"
              hint="Required. We will send you a verification code."
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
                    {challengeSent ? "Send a new code" : "Send verification code"}
                  </Button>
                  {challengeSent && (
                    <>
                      <Field
                        id="emailCode"
                        label="Verification code"
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
                        Verify code
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
                    Change email
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            hint="Optional, but required to reset your password."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Field
          id="passwordConfirm"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {hostings && hostings.length > 0 && (
          <div className="mb-4">
            <label htmlFor="hosting" className="mb-1 block text-sm font-medium text-muted">
              Hosting
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
        <Button type="submit" disabled={busy || gateOn === null || (gateOn && emailProof == null)}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
      <div className="mt-4 text-sm">
        <Link to={`/signin${search}`} className="text-primary hover:underline">
          Already have an account? Sign in
        </Link>
      </div>
    </Card>
  );
}

/**
 * First hosting the platform reports as available, mirroring what the client's
 * `createUser({ hosting: 'auto' })` resolves internally. The gate path posts the
 * registration itself, so it has to pick the hosting the same way.
 */
async function firstAvailableHosting(service: unknown): Promise<string> {
  const svc = service as { flatHostings?: () => Promise<FlatHosting[]> };
  if (typeof svc.flatHostings === "function") {
    const list = await svc.flatHostings();
    const available = list.find((h) => h.available !== false);
    if (available) return available.key;
  }
  throw new Error("No hosting is available.");
}

function randomLocalPart(): string {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
