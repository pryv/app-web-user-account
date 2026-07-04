import Pryv from "pryv";
import { parseAuthParams } from "./authParams";

/**
 * Resolves the Pryv `Service` for the current auth request, from the
 * `pryvServiceInfoUrl` query parameter. Memoised per service-info URL.
 */
let cached: { url: string; service: InstanceType<typeof Pryv.Service> } | null = null;

export function getService(search: string = window.location.search) {
  const { serviceInfoUrl } = parseAuthParams(search);
  if (!serviceInfoUrl) {
    throw new Error(
      "Missing pryvServiceInfoUrl — the auth page must be opened with a service-info URL.",
    );
  }
  if (cached?.url !== serviceInfoUrl) {
    cached = { url: serviceInfoUrl, service: new Pryv.Service(serviceInfoUrl) };
  }
  return cached.service;
}

/**
 * Resolve a user-typed identifier (username or email) to the username that
 * per-user API URLs are built from. Passing an email straight to
 * `Service.login` / `requestPasswordReset` breaks URL construction (the `@`
 * reads as credentials on DNS-based platforms), so emails are first resolved
 * through the register's public `/:email/uid` lookup
 * (`Service.userIdForEmail`). Usernames are lowercase-only by contract —
 * normalise so a capitalised entry still resolves.
 */
export async function resolveUserId(
  service: { userIdForEmail?: (email: string) => Promise<string | null> },
  input: string,
): Promise<string> {
  const id = input.trim().toLowerCase();
  if (!id.includes("@")) return id;
  if (typeof service.userIdForEmail !== "function") {
    throw new Error(
      "This platform does not support email lookup — please use your username.",
    );
  }
  const username = await service.userIdForEmail(id);
  if (!username) {
    throw new Error("No account found for this email address.");
  }
  return username;
}

/** Narrow check for the MFA-required signal thrown by `Service.login`. */
export function isMfaRequired(
  err: unknown,
): err is { mfaToken: string } {
  return (
    err instanceof Pryv.MfaRequiredError ||
    (typeof err === "object" && err !== null && "mfaToken" in err)
  );
}
