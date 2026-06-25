import { Card } from "../../components/ui";

/**
 * Security: multi-factor authentication and active sessions.
 *
 * MFA enrollment/management uses the `mfa.*` API. Stronger factors
 * (TOTP / FIDO / passkey) are tracked separately and are not part of v1.
 */
export default function Security() {
  return (
    <section className="space-y-4">
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">
          Multi-factor authentication
        </div>
        <p className="text-sm text-muted">
          Add a second factor to protect your account.
        </p>
        {/* TODO: enroll/manage MFA via the mfa.* API (SMS for v1). */}
      </Card>
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">
          Active sessions
        </div>
        <p className="text-sm text-muted">
          Review where your account is currently signed in.
        </p>
        {/* TODO: derive personal/session accesses and allow termination. */}
      </Card>
    </section>
  );
}
