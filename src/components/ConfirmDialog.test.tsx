// @vitest-environment jsdom
import { useState } from "react";
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

  it("[CFD3] no app code calls the browser's confirm / alert / prompt", async () => {
    const sources = import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes(".test.") && !path.endsWith("/ConfirmDialog.tsx")) // its doc names window.confirm
      // `confirm` alone is this hook's function; the browser's is window.confirm
      .filter(([, src]) => /\bwindow\.(confirm|alert|prompt)\(|(^|[^\w.])(alert|prompt)\(/m.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("[CFD4] a re-render of the host keeps focus where the user put it", async () => {
    let rerender: () => void = () => {};
    function Host() {
      const [, setTick] = useState(0);
      rerender = () => setTick((t) => t + 1);
      return <Probe />;
    }
    render(<Host />);
    act(() => screen.getByText("ask").click());
    await screen.findByRole("alertdialog");
    act(() => screen.getByText("Cancel").focus());
    act(() => rerender());
    expect(document.activeElement?.textContent).toBe("Cancel");
  });

  it("[CFD5] a new question answers an unanswered one with false", async () => {
    await ask();
    const first = answer!;
    act(() => screen.getByText("ask").click());
    expect(await first).toBe(false);
    act(() => screen.getByText("Revoke").click());
    expect(await answer).toBe(true);
  });
});
