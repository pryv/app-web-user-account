import { Card, Button } from "../../components/ui";

/**
 * Data rights (GDPR): export your data, or delete your account.
 *
 * Export is intended to use the browser-isomorphic account-backup library;
 * account deletion uses the account-removal API. Both are wired in a later step.
 */
export default function DataRights() {
  return (
    <section className="space-y-4">
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">
          Export your data
        </div>
        <p className="mb-3 text-sm text-muted">
          Download a copy of all the data in your account.
        </p>
        <Button type="button" disabled>
          Start export
        </Button>
        {/* TODO: integrate @pryv/account-backup (browser) to produce the archive. */}
      </Card>
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-danger">
          Delete account
        </div>
        <p className="mb-3 text-sm text-muted">
          Permanently delete your account and all of its data. This cannot be undone.
        </p>
        <button
          type="button"
          disabled
          className="rounded border border-danger px-4 py-2 text-sm text-danger disabled:opacity-50"
        >
          Delete my account
        </button>
        {/* TODO: confirm + call the account-deletion API (Art.17). */}
      </Card>
    </section>
  );
}
