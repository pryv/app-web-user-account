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

/** Narrow check for the MFA-required signal thrown by `Service.login`. */
export function isMfaRequired(
  err: unknown,
): err is { mfaToken: string } {
  return (
    err instanceof Pryv.MfaRequiredError ||
    (typeof err === "object" && err !== null && "mfaToken" in err)
  );
}
