/**
 * Email-verification helpers.
 *
 * Two independent flows share this module:
 *
 *  - **At registration**, when the platform requires a proved address before an
 *    account may exist. The register endpoint mails a one-time CODE, the code is
 *    exchanged for a short-lived proof, and the proof travels with the
 *    create-account call. Whether the platform demands this is advertised on the
 *    service-info as `features.emailVerification.atRegistration`.
 *  - **On an existing account**, where an address is confirmed by opening a
 *    mailed LINK (or by pasting the token it carries). That flow is advertised
 *    as `features.emailVerification.onAccount`.
 *
 * The calls below use `fetch` rather than the Pryv client: these endpoints are
 * public, pre-account, and not part of the client's surface.
 */

export interface EmailView {
  value: string;
  primary: boolean;
  status: string;
  verifiedAt: number | null;
  verificationMethod: string | null;
}

export type EmailBadge = "verified" | "pending" | "unconfirmed";

/**
 * Verification methods that prove the holder acted on the address, as opposed
 * to it merely having been asserted at sign-up. Keep in step with the core's
 * proved-methods list: an address verified by any other means is displayed as
 * unconfirmed, because it cannot pass the core's proved-ownership checks.
 */
export const PROVED_METHODS = ["email-link", "email-code", "operator"] as const;

/** Badge for one address: proved ownership, never verified, or verified without proof. */
export function emailBadge(view: EmailView): EmailBadge {
  if (view.status === "pending") return "pending";
  const method = view.verificationMethod;
  if (method != null && (PROVED_METHODS as readonly string[]).includes(method)) {
    return "verified";
  }
  return "unconfirmed";
}

/** Uppercase, keep only the server's alphabet (A-Z minus I/O, 2-9), max 8 chars. */
export function normalizeCodeInput(raw: string): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((c) => /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/.test(c))
    .join("")
    .slice(0, 8);
}

/** 'ABCDEFGH' -> 'ABCD-EFGH' for display. */
export function formatCodeInput(code: string): string {
  if (code.length <= 4) return code;
  return code.slice(0, 4) + "-" + code.slice(4);
}

interface ServiceInfoFeatures {
  features?: {
    emailVerification?: { atRegistration?: boolean; onAccount?: boolean };
  };
}

/** Whether this platform requires a proved email address to create an account. */
export function registrationRequiresVerifiedEmail(serviceInfo: ServiceInfoFeatures): boolean {
  return serviceInfo?.features?.emailVerification?.atRegistration === true;
}

/**
 * Whether this platform offers verification on an existing account. Absent on
 * an older core, which is treated as "not available" so the UI never offers an
 * action the core would refuse.
 */
export function verificationOnAccount(serviceInfo: ServiceInfoFeatures): boolean {
  return serviceInfo?.features?.emailVerification?.onAccount === true;
}

/** An API error carrying the core's error id and data, so callers can act on both. */
export class ApiCallError extends Error {
  id: string | null;
  status: number;
  data: unknown;

  constructor(message: string, opts: { id: string | null; status: number; data: unknown }) {
    super(message);
    this.name = "ApiCallError";
    this.id = opts.id;
    this.status = opts.status;
    this.data = opts.data;
  }
}

interface ApiErrorBody {
  error?: { id?: string; message?: string; data?: unknown };
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: (ApiErrorBody & Record<string, unknown>) | null = null;
  try {
    parsed = (await res.json()) as ApiErrorBody & Record<string, unknown>;
  } catch {
    // A body-less or non-JSON answer is tolerated; the status still decides.
    parsed = null;
  }
  if (!res.ok) {
    throw new ApiCallError(parsed?.error?.message ?? `Request failed (${res.status})`, {
      id: parsed?.error?.id ?? null,
      status: res.status,
      data: parsed?.error?.data ?? null,
    });
  }
  return parsed ?? {};
}

/** POST {register}email-challenge. Resolves on 200; throws ApiCallError otherwise. */
export async function requestEmailChallenge(
  registerUrl: string,
  email: string,
  language?: string,
): Promise<void> {
  await postJson(registerUrl + "email-challenge", { email, language });
}

/** POST {register}email-challenge/verify. Returns the emailProof. */
export async function verifyEmailChallenge(
  registerUrl: string,
  email: string,
  code: string,
): Promise<string> {
  const body = await postJson(registerUrl + "email-challenge/verify", { email, code });
  return body.emailProof as string;
}

export interface RegisterWithProofPayload {
  appId: string;
  username: string;
  password: string;
  email: string;
  hosting: string;
  language: string;
  invitationToken: string;
  emailProof: string;
}

/** POST {register}users with the proof alongside the usual create-account payload. */
export async function registerWithProof(
  registerUrl: string,
  payload: RegisterWithProofPayload,
): Promise<{ username: string; apiEndpoint: string }> {
  const body = await postJson(registerUrl + "users", payload);
  return { username: body.username as string, apiEndpoint: body.apiEndpoint as string };
}

/** POST {apiEndpoint}account/verify-email with { appId, token }. Returns the verified address. */
export async function verifyEmailToken(
  apiEndpoint: string,
  appId: string,
  token: string,
): Promise<string> {
  const body = await postJson(apiEndpoint + "account/verify-email", { appId, token });
  return body.email as string;
}

/** User-facing message for an ApiCallError from these calls. */
export function emailVerificationErrorMessage(err: unknown): string {
  if (!(err instanceof ApiCallError)) {
    return err instanceof Error ? err.message : "Something went wrong. Please try again.";
  }
  const data = (err.data ?? {}) as {
    retryAfterSeconds?: number;
    reason?: string;
    attemptsRemaining?: number;
    emailVerificationRequired?: boolean;
  };
  if (err.id === "too-many-attempts") {
    if (data.reason === "exhausted") return "Too many wrong codes. Request a new code.";
    if (typeof data.retryAfterSeconds === "number") {
      return `Please wait ${data.retryAfterSeconds} seconds before requesting another code.`;
    }
  }
  if (err.id === "invalid-access-token" && typeof data.attemptsRemaining === "number") {
    if (data.attemptsRemaining === 0) return "That code has expired. Request a new one.";
    const tries = data.attemptsRemaining === 1 ? "attempt" : "attempts";
    return `That code is not valid. ${data.attemptsRemaining} ${tries} left.`;
  }
  if (err.id === "item-already-exists") return "An account already uses this email address.";
  if (err.id === "forbidden" && data.emailVerificationRequired === true) {
    return "Please verify your email address first.";
  }
  return err.message;
}
