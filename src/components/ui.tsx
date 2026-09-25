/**
 * Shared UI primitives: Card, Button, Alert, Field, SelectField, SectionLabel.
 *
 * Icon rule (applies to every screen; keep forks consistent with it):
 * - Icons come from `lucide-react`, carry `aria-hidden`, and sit beside a text
 *   label that names the action. Size them to the label: 14 px beside `text-sm`,
 *   12 px beside `text-xs`, 16 px for alert tones.
 * - Icons mark secondary and destructive actions (edit, add, send, copy,
 *   refresh, open, details, back, previous/next, revoke, remove, delete, sign out)
 *   and the tone of an `Alert`. When one action in a group carries an icon, its
 *   siblings of the same kind carry one too.
 * - Text-only: the primary CTAs of the sign-in, register, password and consent
 *   screens (including the consent Accept/Refuse pair), a form's own
 *   Save/Apply/Confirm/Cancel pair, confirm-dialog buttons, tab navigation,
 *   links inside sentences, and the header's "Back to" link.
 * - Icon-only controls are the exception, allowed only when the glyph is a
 *   well-known symbol (for example the header theme toggle: system, light,
 *   dark). Each button then needs an `aria-label` and a matching `title`
 *   tooltip, and a group of them a labelled `role="group"`.
 * - Choice cards (for example the MFA method picker) may carry a larger
 *   illustrative icon, still `aria-hidden`, next to their title.
 * - Never use text glyphs (arrows, crosses) as icons: they end up in the
 *   accessible name.
 */
import type { ComponentProps, InputHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

/** Brand-themed surface card. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-divider bg-card p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/**
 * Primary/secondary button. Primary CTAs stay text-only; secondary and
 * destructive actions may lead with an `aria-hidden` icon per the icon rule at
 * the top of this file.
 */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" }) {
  const base =
    "inline-flex w-full items-center justify-center rounded px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-primary text-white hover:brightness-95 active:brightness-90"
      : variant === "danger"
      ? "border border-danger text-danger hover:bg-danger/10 active:bg-danger/20"
      : "text-primary hover:underline";
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

/** Inline error/notice banner with a tone-matched icon. */
export function Alert({
  children,
  tone = "danger",
}: {
  children: ReactNode;
  tone?: "danger" | "success" | "info";
}) {
  const styles =
    tone === "danger"
      ? "border-danger/40 bg-danger/10 text-danger"
      : tone === "success"
      ? "border-success/40 bg-success/10 text-success"
      : "border-info/40 bg-info/10 text-info";
  const Icon = tone === "danger" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div
      className={`mb-4 flex gap-2 rounded border px-3 py-2 text-sm ${styles}`}
      role="alert"
    >
      <Icon size={16} aria-hidden className="mt-[2px] shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Labelled text input. */
export function Field({
  label,
  id,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        className="w-full rounded border border-divider bg-card text-ink px-3 py-2 text-sm transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/40 disabled:bg-body disabled:text-muted"
        {...props}
      />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Labelled select. */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-divider bg-card text-ink px-3 py-2 text-sm transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/40 disabled:bg-body disabled:text-muted"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Section label row, for the "USERNAME" / "EMAIL" headings. */
export function SectionLabel({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  const color = tone === "danger" ? "text-danger" : "text-muted";
  return (
    <div className={`mb-1 text-xs uppercase tracking-wide ${color}`}>{children}</div>
  );
}
