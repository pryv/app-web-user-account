import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

/** Brand-themed surface card. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-divider bg-card p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/** Primary/secondary button. */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
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

/** Section label row, for the "USERNAME" / "EMAIL" headings. */
export function SectionLabel({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  const color = tone === "danger" ? "text-danger" : "text-muted";
  return (
    <div className={`mb-1 text-xs uppercase tracking-wide ${color}`}>{children}</div>
  );
}
