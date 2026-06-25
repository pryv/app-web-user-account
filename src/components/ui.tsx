import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/** Brand-themed surface card. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-pryv-light-gray bg-white p-6 shadow-sm">
      {children}
    </div>
  );
}

/** Primary/secondary button. */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const base =
    "inline-flex w-full items-center justify-center rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-primary text-white hover:brightness-95"
      : "text-primary hover:underline";
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

/** Inline error/notice banner. */
export function Alert({
  children,
  tone = "danger",
}: {
  children: ReactNode;
  tone?: "danger" | "success";
}) {
  const styles =
    tone === "danger"
      ? "border-danger/40 bg-danger/10 text-danger"
      : "border-success/40 bg-success/10 text-success";
  return (
    <div className={`mb-4 rounded border px-3 py-2 text-sm ${styles}`} role="alert">
      {children}
    </div>
  );
}

/** Labelled text input. */
export function Field({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        className="w-full rounded border border-pryv-light-gray bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        {...props}
      />
    </div>
  );
}
