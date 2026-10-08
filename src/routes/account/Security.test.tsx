// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [SECP] Security page: turning MFA off, and enrolling over an active
 * enrolment, ask the account password in the in-app dialog and send it as the
 * step-up; a wrong one shows a translated message.
 */

const ENDPOINT = "https://core.example.com/alice/";
const state = vi.hoisted(() => ({
  connection: {
    endpoint: "https://core.example.com/alice/",
    token: "personal-token",
    api: async () => [{ accesses: [] }],
    accessInfo: async () => ({ id: "self" }),
    service: { info: async () => ({ features: { mfa: { methods: ["totp"] } } }) },
  },
}));
vi.mock("../../lib/useSession", () => ({
  useSession: () => ({ connection: state.connection, setConnection: vi.fn() }),
}));

import Security from "./Security";

type Reply = { status: number; body: unknown };
let replies: Reply[] = [];
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  const reply = replies.shift();
  if (reply == null) throw new Error("unexpected fetch");
  return { status: reply.status, ok: reply.status < 300, text: async () => JSON.stringify(reply.body) };
});

beforeEach(() => {
  replies = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSecurity() {
  return render(
    <MemoryRouter>
      <Security />
    </MemoryRouter>,
  );
}
function sent(call: number): { url: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[call];
  return { url, body: JSON.parse(String(init?.body)) };
}
async function typePasswordAndSubmit(password: string, submitLabel: string) {
  await screen.findByRole("dialog");
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: submitLabel }));
}

describe("[SECP] security page step-up", () => {
  it("[SEC1] Disable MFA sends the password typed in the dialog", async () => {
    replies = [{ status: 200, body: { message: "MFA deactivated." } }];
    renderSecurity();
    fireEvent.click(await screen.findByText("Disable MFA"));
    await typePasswordAndSubmit("s3cret", "Disable");
    expect(await screen.findByText("Multi-factor authentication is now off.")).toBeTruthy();
    expect(sent(0)).toEqual({ url: ENDPOINT + "mfa/deactivate", body: { password: "s3cret" } });
  });

  it("[SEC2] a wrong password shows the translated message", async () => {
    replies = [{ status: 403, body: { error: { id: "invalid-step-up", message: "x" } } }];
    renderSecurity();
    fireEvent.click(await screen.findByText("Disable MFA"));
    await typePasswordAndSubmit("wrong", "Disable");
    expect(await screen.findByText("Wrong password. Nothing was changed.")).toBeTruthy();
  });

  it("[SEC3] cancelling the dialog sends nothing", async () => {
    renderSecurity();
    fireEvent.click(await screen.findByText("Disable MFA"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[SEC4] enrolling over an active enrolment asks the password and retries with it", async () => {
    replies = [
      { status: 400, body: { error: { id: "invalid-parameters-format", data: { id: "step-up-required" } } } },
      { status: 302, body: { mfaToken: "mt", method: "totp", otpauthUri: "otpauth://totp/x?secret=ABC", secret: "ABC" } },
    ];
    renderSecurity();
    fireEvent.click(await screen.findByText("Authenticator app"));
    await typePasswordAndSubmit("s3cret", "Continue");
    expect(await screen.findByText("ABC")).toBeTruthy();
    expect(sent(0).body).toEqual({ method: "totp" });
    expect(sent(1).body).toEqual({ method: "totp", password: "s3cret" });
  });

  it("[SEC5] a first enrolment asks for nothing", async () => {
    replies = [{ status: 302, body: { mfaToken: "mt", method: "totp", otpauthUri: "otpauth://totp/x?secret=ABC", secret: "ABC" } }];
    renderSecurity();
    fireEvent.click(await screen.findByText("Authenticator app"));
    expect(await screen.findByText("ABC")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
