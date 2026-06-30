import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const svc = getService(search) as unknown as { flatHostings?: () => Promise<FlatHosting[]> };
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
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { appId } = parseAuthParams(search);
      // Email is optional; generate a placeholder when empty so the server's
      // required-field check passes (mirrors legacy `generateRandomEmailIfNeeded`).
      const finalEmail = email && email.length > 0 ? email : randomLocalPart() + "@pryv.io";
      await getService(search).createUser({
        username,
        email: finalEmail,
        password,
        appId,
        // When the user picked a hosting from the dropdown, send the key;
        // when no hostings list was available (Service lacks flatHostings or
        // call failed) fall back to the legacy `auto` sentinel.
        hosting: selectedHosting || "auto",
      });
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
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
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          hint="Optional, but required to reset your password."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
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
        <Button type="submit" disabled={busy}>
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

function randomLocalPart(): string {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
