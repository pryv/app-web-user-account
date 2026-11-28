// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

/**
 * [VENT] The verified-email notice of a consent block: a warning while a
 * required proof blocks Approve, the cooldown pointing at the welcome mail, and
 * a way back from "Use another address".
 */

import "../../i18n";
import { VerifiedEmailNotice, type VerifiedEmailNoticeProps } from "./VerifiedEmailNotice";
import type { VerifiedEmailState } from "../../lib/useVerifiedEmail";

function show(state: VerifiedEmailState, props: Partial<VerifiedEmailNoticeProps> = {}) {
  const handlers = { onAdd: vi.fn(), onSend: vi.fn(), onChange: vi.fn(), onCancel: vi.fn(), onRetry: vi.fn() };
  render(<VerifiedEmailNotice username={null} appName="Diary" state={state} required {...handlers} {...props} />);
  return handlers;
}

const tones = () => [...document.querySelectorAll("[role=alert]")].map((a) => a.getAttribute("data-tone"));

describe("[VENT] VerifiedEmailNotice", () => {
  afterEach(cleanup);

  it("[VEN1] a required proof not made yet is a warning; a proof made is a success", () => {
    for (const state of [
      { kind: "unproved", email: "a@example.com" },
      { kind: "missing", suggested: null },
      { kind: "waiting", email: "a@example.com", viaAdd: false, canSendAgain: false },
      { kind: "cooldown", email: "a@example.com", viaAdd: false, until: 2_000_000_000, sent: true },
      { kind: "unavailable" },
    ] as VerifiedEmailState[]) {
      show(state);
      expect(tones()).toEqual(["warning"]);
      cleanup();
    }
    show({ kind: "proved", email: "a@example.com", here: false });
    expect(tones()).toEqual(["success"]);
  });

  it("[VEN2] an address added for a consent that only reads it stays an information", () => {
    show({ kind: "waiting", email: "a@example.com", viaAdd: true, canSendAgain: false }, { required: false });
    expect(tones()).toEqual(["info"]);
  });

  it("[VEN3] the cooldown says the link is in the welcome mail", () => {
    show({ kind: "cooldown", email: "a@example.com", viaAdd: false, until: 2_000_000_000, sent: true });
    expect(screen.getByTestId("verified-email").textContent).toMatch(/welcome email/);
  });

  it("[VEN4] Cancel only on the form opened by Use another address", () => {
    show({ kind: "missing", suggested: null });
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    cleanup();
    const changing = show({ kind: "missing", suggested: null, changing: true });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(changing.onCancel).toHaveBeenCalledTimes(1);
    cleanup();
    // Still there after a refused address.
    show({ kind: "taken", viaAdd: true, changing: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    cleanup();
    show({ kind: "error", at: "add", viaAdd: true, message: "no", changing: true }, { required: false });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});
