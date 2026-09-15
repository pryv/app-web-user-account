import { describe, it, expect, vi, afterEach } from "vitest";
import {
  emailBadge,
  normalizeCodeInput,
  formatCodeInput,
  registrationRequiresVerifiedEmail,
  verificationOnAccount,
  requestEmailChallenge,
  verifyEmailChallenge,
  registerWithProof,
  verifyEmailToken,
  emailVerificationErrorMessage,
  ApiCallError,
  type EmailView,
} from "./emailVerification";

function view(over: Partial<EmailView>): EmailView {
  return {
    value: "a@b.test",
    primary: true,
    status: "verified",
    verifiedAt: 1,
    verificationMethod: "email-link",
    ...over,
  };
}

/** Stub fetch with one JSON reply; returns the mock for call inspection. */
function stubFetch(body: unknown, ok = true, status = 200) {
  const mock = vi.fn(async (_url: string, _init: { body: string }) => ({
    ok,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("emailBadge", () => {
  it("treats link, code and operator verification as proved", () => {
    expect(emailBadge(view({ verificationMethod: "email-link" }))).toBe("verified");
    expect(emailBadge(view({ verificationMethod: "email-code" }))).toBe("verified");
    expect(emailBadge(view({ verificationMethod: "operator" }))).toBe("verified");
  });

  it("marks a pending address pending whatever the method says", () => {
    expect(emailBadge(view({ status: "pending", verificationMethod: null }))).toBe("pending");
  });

  it("marks a merely asserted address unconfirmed", () => {
    expect(emailBadge(view({ verificationMethod: "registration" }))).toBe("unconfirmed");
    expect(emailBadge(view({ verificationMethod: "legacy" }))).toBe("unconfirmed");
    expect(emailBadge(view({ verificationMethod: null }))).toBe("unconfirmed");
  });
});

describe("code input", () => {
  it("uppercases, drops characters outside the server alphabet and caps at 8", () => {
    expect(normalizeCodeInput(" abcd-efgh1 ")).toBe("ABCDEFGH");
  });

  it("drops the ambiguous letters the server never mints", () => {
    // I and O are absent from the server alphabet (they read as 1 and 0).
    expect(normalizeCodeInput("aioAIO")).toBe("AA");
    expect(normalizeCodeInput("01")).toBe("");
  });

  it("formats in two groups only once there is a second group", () => {
    expect(formatCodeInput("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(formatCodeInput("ABC")).toBe("ABC");
  });
});

describe("service-info feature flags", () => {
  it("reports the registration gate only when explicitly true", () => {
    expect(registrationRequiresVerifiedEmail({})).toBe(false);
    expect(
      registrationRequiresVerifiedEmail({ features: { emailVerification: { atRegistration: true } } }),
    ).toBe(true);
  });

  it("reports on-account verification only when explicitly true", () => {
    expect(verificationOnAccount({})).toBe(false);
    expect(verificationOnAccount({ features: { emailVerification: { onAccount: true } } })).toBe(true);
  });
});

describe("challenge calls", () => {
  it("posts the challenge request to the register endpoint", async () => {
    const mock = stubFetch({ sent: true });
    await requestEmailChallenge("https://reg.test/", "a@b.test", "en");
    expect(mock.mock.calls[0][0]).toBe("https://reg.test/email-challenge");
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ email: "a@b.test", language: "en" });
  });

  it("returns the proof from the verify step", async () => {
    stubFetch({ emailProof: "PROOF" });
    expect(await verifyEmailChallenge("https://reg.test/", "a@b.test", "ABCDEFGH")).toBe("PROOF");
  });

  it("surfaces the error id, status and data on a throttled reply", async () => {
    stubFetch(
      { error: { id: "too-many-attempts", message: "m", data: { retryAfterSeconds: 60 } } },
      false,
      429,
    );
    await expect(requestEmailChallenge("https://reg.test/", "a@b.test")).rejects.toMatchObject({
      id: "too-many-attempts",
      status: 429,
      data: { retryAfterSeconds: 60 },
    });
  });

  it("sends every payload key including the proof when registering", async () => {
    const mock = stubFetch({ username: "u1", apiEndpoint: "https://tok@u1.test/" });
    const payload = {
      appId: "app",
      username: "u1",
      password: "pw",
      email: "a@b.test",
      hosting: "h",
      language: "en",
      invitationToken: "enjoy",
      emailProof: "PROOF",
    };
    const out = await registerWithProof("https://reg.test/", payload);
    expect(mock.mock.calls[0][0]).toBe("https://reg.test/users");
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual(payload);
    expect(out).toEqual({ username: "u1", apiEndpoint: "https://tok@u1.test/" });
  });

  it("posts the token and appId to the account verify endpoint", async () => {
    const mock = stubFetch({ email: "a@b.test" });
    const email = await verifyEmailToken("https://u1.test/", "app", "TOKEN");
    expect(mock.mock.calls[0][0]).toBe("https://u1.test/account/verify-email");
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ appId: "app", token: "TOKEN" });
    expect(email).toBe("a@b.test");
  });
});

describe("emailVerificationErrorMessage", () => {
  const err = (id: string, data: unknown, message = "server said so") =>
    new ApiCallError(message, { id, status: 400, data });

  it("names the wait in seconds when throttled", () => {
    expect(emailVerificationErrorMessage(err("too-many-attempts", { retryAfterSeconds: 60 }))).toContain(
      "60 seconds",
    );
  });

  it("tells the holder to request a new code once attempts are spent", () => {
    expect(emailVerificationErrorMessage(err("too-many-attempts", { reason: "exhausted" }))).toBe(
      "Too many wrong codes. Request a new code.",
    );
  });

  it("counts down remaining attempts, and singularises the last one", () => {
    expect(emailVerificationErrorMessage(err("invalid-access-token", { attemptsRemaining: 3 }))).toBe(
      "That code is not valid. 3 attempts left.",
    );
    expect(emailVerificationErrorMessage(err("invalid-access-token", { attemptsRemaining: 1 }))).toBe(
      "That code is not valid. 1 attempt left.",
    );
  });

  it("reports an exhausted code as expired rather than as zero attempts", () => {
    expect(emailVerificationErrorMessage(err("invalid-access-token", { attemptsRemaining: 0 }))).toBe(
      "That code has expired. Request a new one.",
    );
  });

  it("explains a taken address and an unproved one", () => {
    expect(emailVerificationErrorMessage(err("item-already-exists", { email: "a@b.test" }))).toBe(
      "An account already uses this email address.",
    );
    expect(
      emailVerificationErrorMessage(err("forbidden", { emailVerificationRequired: true })),
    ).toBe("Please verify your email address first.");
  });

  it("falls back to the server message, then to a generic one", () => {
    expect(emailVerificationErrorMessage(err("unexpected-error", null, "boom"))).toBe("boom");
    expect(emailVerificationErrorMessage(new Error("plain"))).toBe("plain");
    expect(emailVerificationErrorMessage("not an error")).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
