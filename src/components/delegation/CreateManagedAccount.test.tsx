// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

/**
 * [CMA] "Create a managed account": embedded in `/auth`, the optional password
 * is folded (the email stays in sight); on the delegation page every field
 * shows as before.
 */

import { CreateManagedAccount } from "./CreateManagedAccount";
import type { Delegation } from "../../lib/pryvClient";
import type { PryvConnection } from "../../lib/session";

const connection = { service: { info: async () => ({}) } } as unknown as PryvConnection;

function renderForm(embedded: boolean, createAccount = vi.fn(async (_req: Record<string, unknown>) => ({}))) {
  render(
    <CreateManagedAccount
      connection={connection}
      client={{ createAccount } as unknown as Delegation}
      reload={async () => {}}
      onNotice={() => {}}
      onCreated={() => {}}
      embedded={embedded}
    />,
  );
  return createAccount;
}

describe("[CMA] CreateManagedAccount", () => {
  afterEach(() => cleanup());

  it("[CMA1] embedded: username and email in sight, the password folded and closed", () => {
    renderForm(true);
    const fold = screen.getByTestId("managed-password-disclosure") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")?.textContent).toBe(
      "Set a password for this account (optional): without one, it is used only through you",
    );
    expect(fold.contains(document.getElementById("managed-password"))).toBe(true);
    expect(fold.contains(document.getElementById("managed-username"))).toBe(false);
    expect(fold.contains(document.getElementById("managed-email"))).toBe(false);
  });

  it("[CMA2] on the delegation page: no fold, the three fields as before", () => {
    renderForm(false);
    expect(screen.queryByTestId("managed-password-disclosure")).toBeNull();
    for (const id of ["managed-username", "managed-email", "managed-password"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("[CMA3] embedded: a password typed in the fold is sent with the creation", async () => {
    const createAccount = renderForm(true);
    fireEvent.change(document.getElementById("managed-username")!, { target: { value: "kid-b" } });
    (screen.getByTestId("managed-password-disclosure") as HTMLDetailsElement).open = true;
    fireEvent.change(document.getElementById("managed-password")!, { target: { value: "s3cret-pass" } });
    fireEvent.submit(document.getElementById("managed-username")!.closest("form")!);
    await waitFor(() => expect(createAccount).toHaveBeenCalled());
    expect(createAccount.mock.calls[0][0]).toMatchObject({ username: "kid-b", password: "s3cret-pass" });
  });
});
