import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Card, Button, Field } from "../components/ui";

/**
 * Sign-in / authorize. Collects credentials and (once wired to lib-js) calls
 * `Service.login`; on `MfaRequiredError` it routes to `/mfa-challenge`, and on
 * success it hands control back to the auth-completion redirect (`returnURL`).
 */
export default function SignIn() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // TODO: call Service.login(); handle MfaRequiredError → /mfa-challenge.
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">Sign in</h1>
      <p className="mb-6 text-sm text-muted">
        Sign in to grant access to the requesting app.
      </p>
      <form onSubmit={onSubmit}>
        <Field
          id="username"
          label="Username or email"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit">Sign in</Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link to="/reset-password" className="text-primary hover:underline">
          Forgot password?
        </Link>
        <Link to="/register" className="text-primary hover:underline">
          Create account
        </Link>
      </div>
    </Card>
  );
}
