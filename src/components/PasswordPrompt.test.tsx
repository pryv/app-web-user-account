// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { usePasswordPrompt } from "./PasswordPrompt";

/** The in-app password prompt (the step-up before a sensitive change). */

let answer: Promise<string | null> | null = null;
function Probe() {
  const [askPassword, dialog] = usePasswordPrompt();
  return (
    <>
      {dialog}
      <button type="button" onClick={() => { answer = askPassword("Turn this off?", { confirmLabel: "Turn off", danger: true }); }}>
        ask
      </button>
    </>
  );
}

async function ask() {
  render(<Probe />);
  act(() => screen.getByText("ask").click());
  return screen.findByRole("dialog");
}

describe("[PWP] password prompt", () => {
  afterEach(() => {
    cleanup();
    answer = null;
  });

  it("[PWP1] a modal dialog with a masked field focused; submitting answers the typed password", async () => {
    const dialog = await ask();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Turn this off?");
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(document.activeElement).toBe(input);
    const submit = screen.getByText("Turn off") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "s3cret" } });
    act(() => submit.click());
    expect(await answer).toBe("s3cret");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("[PWP2] Cancel, Escape and a click outside answer null", async () => {
    for (const dismiss of [
      () => screen.getByText("Cancel").click(),
      () => fireEvent.keyDown(document, { key: "Escape" }),
      () => {
        const overlay = screen.getByRole("dialog").parentElement!;
        fireEvent.mouseDown(overlay);
        fireEvent.click(overlay);
      },
    ]) {
      await ask();
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "typed" } });
      act(dismiss);
      expect(await answer).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      cleanup();
    }
  });

  it("[PWP3] a new question answers an unanswered one with null, and starts empty", async () => {
    await ask();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "first" } });
    const first = answer!;
    act(() => screen.getByText("ask").click());
    expect(await first).toBeNull();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });
});
