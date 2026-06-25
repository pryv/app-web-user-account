import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Alert } from "../../components/ui";
import { useSession } from "../../lib/session";

/** Profile overview: username, emails, language. */
export default function Profile() {
  const { connection } = useSession();
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;
    connection
      .username()
      .then(setUsername)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load profile."),
      );
  }, [connection]);

  return (
    <section className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="text-xs uppercase tracking-wide text-muted">Username</div>
        <div className="text-lg">{username ?? "…"}</div>
      </Card>
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">Emails</div>
        <p className="text-sm text-muted">
          Manage the email addresses linked to your account.
        </p>
        {/* TODO: list/add/verify/set-primary emails via the account API. */}
      </Card>
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">Password</div>
        <Link to="/change-password" className="text-sm text-primary hover:underline">
          Change your password
        </Link>
      </Card>
    </section>
  );
}
