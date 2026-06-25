import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";

/** Account registration via `Service.createUser`. */
export default function Register() {
  const { search } = useLocation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { appId } = parseAuthParams(search);
      await getService(search).createUser({
        username,
        email,
        password,
        appId,
        hosting: "auto",
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
      <form onSubmit={onSubmit}>
        <Field id="username" label="Username" autoComplete="username"
          value={username} onChange={(e) => setUsername(e.target.value)} required />
        <Field id="email" label="Email" type="email" autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field id="password" label="Password" type="password" autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
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
