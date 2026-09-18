// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { useConfirm } from "./ConfirmDialog";

/** The in-app replacement for window.confirm(). */

let answer: Promise<boolean> | null = null;
function Probe() {
  const [confirm, dialog] = useConfirm();
  return (
    <>
      {dialog}
      <button type="button" onClick={() => { answer = confirm("Revoke this access?", { confirmLabel: "Revoke", danger: true }); }}>
        ask
      </button>
    </>
  );
}

async function ask() {
  render(<Probe />);
  act(() => screen.getByText("ask").click());
  return screen.findByRole("alertdialog");
}

describe("[CFD] confirmation dialog", () => {
  afterEach(() => {
    cleanup();
    answer = null;
  });

  it("[CFD1] shows the question as a modal dialog with focus on the confirm button, and resolves true on confirm", async () => {
    const dialog = await ask();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Revoke this access?");
    expect(document.activeElement?.textContent).toBe("Revoke");
    act(() => screen.getByText("Revoke").click());
    expect(await answer).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("[CFD2] Cancel, Escape and a click outside all answer false", async () => {
    for (const dismiss of [
      () => screen.getByText("Cancel").click(),
      () => fireEvent.keyDown(document, { key: "Escape" }),
      () => fireEvent.click(screen.getByRole("alertdialog").parentElement!),
    ]) {
      await ask();
      act(dismiss);
      expect(await answer).toBe(false);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      cleanup();
    }
  });

  it("[CFD3] no route calls window.confirm any more", async () => {
    const sources = import.meta.glob("../routes/**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes(".test."))
      .filter(([, src]) => /window\.(confirm|alert|prompt)\(/.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
