// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { AcceptDialog } from "./Delegation";

/** The dialog that confirms accepting a delegation invite: keyboard behaviour. */

describe("[DAD] delegation accept dialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("[DAD1] focus moves into the dialog and Escape cancels", () => {
    const onCancel = vi.fn();
    render(<AcceptDialog username="bob" busy={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("[DAD2] while accepting, neither Escape nor the buttons cancel", () => {
    const onCancel = vi.fn();
    render(<AcceptDialog username="bob" busy={true} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("[DAD3] Tab and Shift+Tab stay inside the dialog, from the title too", () => {
    render(<AcceptDialog username="bob" busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    // Focus is on the title when the dialog opens.
    expect(document.activeElement).toBe(screen.getByRole("heading"));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("[DAD4] closing gives the focus back to what had it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    try {
      opener.focus();
      const { unmount } = render(<AcceptDialog username="bob" busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
      expect(document.activeElement).not.toBe(opener);
      unmount();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });
});
