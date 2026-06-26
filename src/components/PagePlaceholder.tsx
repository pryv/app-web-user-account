/**
 * Temporary placeholder for a route whose UI is not built yet.
 * Each scaffolded route renders one so the navigation map is testable.
 */
export default function PagePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section>
      <h1 className="mb-2 text-2xl">{title}</h1>
      <p className="text-muted">{description}</p>
      <p className="mt-6 rounded bg-card p-3 text-sm text-muted">
        Not implemented yet.
      </p>
    </section>
  );
}
