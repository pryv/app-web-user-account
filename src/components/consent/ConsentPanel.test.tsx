// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

/** [CPNL] The shared consent panel: rows, choice, locks, notices and actions. */

import { ConsentPanel } from "./ConsentPanel";
import type { ConsentEntry } from "../../lib/consent";

const entries = [
  { streamId: "diary", level: "read", label: "Journal", mandatory: true },
  { streamId: "weight", level: "read", label: "Weight" },
] as unknown as ConsentEntry[];

afterEach(() => cleanup());

function boxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[type="checkbox"]'));
}

describe("[CPNL] ConsentPanel", () => {
  it("[CPN1] names the app, lists the rows and renders all-or-nothing without tick boxes", () => {
    render(
      <ConsentPanel app={{ name: "My App" }} entries={entries} busy={null} onAccept={() => {}} onRefuse={() => {}} />,
    );
    expect(screen.getByRole("heading").textContent).toContain("My App");
    expect(screen.getByText(/is requesting permission/)).toBeTruthy();
    expect(boxes()).toHaveLength(0);
  });

  it("[CPN2] with a choice, toggles report the row and its new state", () => {
    const onToggle = vi.fn();
    render(
      <ConsentPanel
        app={{ name: "My App" }}
        entries={entries}
        flags={[true, false]}
        onToggle={onToggle}
        busy={null}
        onAccept={() => {}}
        onRefuse={() => {}}
      />,
    );
    expect(boxes()).toHaveLength(2);
    fireEvent.click(boxes()[1]);
    expect(onToggle).toHaveBeenCalledWith(1, true);
  });

  it("[CPN3] shows expiry and the mismatch notice, and disables both actions while busy", () => {
    const onAccept = vi.fn();
    render(
      <ConsentPanel
        app={{ name: "My App", description: "Curated description" }}
        entries={entries}
        expireAfterSeconds={60}
        mismatchWarning="Already has an access."
        busy="accept"
        onAccept={onAccept}
        onRefuse={() => {}}
      >
        <p>error slot</p>
      </ConsentPanel>,
    );
    expect(screen.getByText("Curated description")).toBeTruthy();
    expect(screen.getByText(/60s/)).toBeTruthy();
    expect(screen.getByText("Already has an access.")).toBeTruthy();
    expect(screen.getByText("error slot")).toBeTruthy();
    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });
});
