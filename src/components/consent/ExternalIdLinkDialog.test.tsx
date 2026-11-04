// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useExternalIdLinkDialog, type ExternalIdLinkAnswer, type ExternalIdLinkQuestion } from "./ExternalIdLinkDialog";

/** The external-id link dialog, asked outside a user event as `/auth` does (after a network answer). */

let ask: ((q: ExternalIdLinkQuestion) => Promise<ExternalIdLinkAnswer>) | null = null;
function Probe() {
  const [askLink, dialog] = useExternalIdLinkDialog();
  ask = askLink;
  return <>{dialog}</>;
}

describe("[EXD] external-id link dialog", () => {
  afterEach(() => {
    cleanup();
    ask = null;
  });

  it("[EXD1] Escape pressed as soon as the dialog is on screen answers declined", async () => {
    render(<Probe />);
    // Press the moment the dialog is inserted, before any later task runs.
    const pressed = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector("[data-testid=external-id-dialog]")) return;
        observer.disconnect();
        fireEvent.keyDown(document, { key: "Escape" });
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    const answer = ask!({ label: "Clinic A", username: "alice", claim: async () => "linked" });
    await pressed;
    const result = await Promise.race([answer, new Promise((r) => setTimeout(() => r("no answer"), 500))]);
    expect(result).toBe("declined");
  });
});
