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

  it("[CPN4] Accept hands back the tick state it was rendered with", () => {
    const onAccept = vi.fn();
    render(
      <ConsentPanel
        app={{ name: "My App" }}
        entries={entries}
        flags={[true, false]}
        onToggle={() => {}}
        busy={null}
        onAccept={onAccept}
        onRefuse={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledWith([true, false]);
  });

  it("[CPN5] no validation block (an older core): no badge, no caution", () => {
    render(
      <ConsentPanel app={{ name: "My App" }} entries={entries} busy={null} onAccept={() => {}} onRefuse={() => {}} />,
    );
    expect(document.getElementById("oauthValidation")).toBeNull();
    render(
      <ConsentPanel app={{ name: "My App" }} validation={null} entries={entries} busy={null} onAccept={() => {}} onRefuse={() => {}} />,
    );
    expect(document.getElementById("oauthValidation")).toBeNull();
  });

  it("[CPN6] the badge of each level, its explanation, and a caution for a Non-Validated app only", () => {
    const cases = [
      { level: "appValidated" as const, badge: "App Validated", explain: /operator reviewed this application/, caution: false },
      { level: "publisherValidated" as const, badge: "Publisher Validated", explain: /verified who publishes this application/, caution: false },
      { level: "nonValidated" as const, badge: "Non-Validated", explain: /reviewed neither this application nor its publisher/, caution: true },
    ];
    for (const c of cases) {
      render(
        <ConsentPanel
          app={{ name: "My App" }}
          validation={{ level: c.level, publisher: null, validatedAt: null }}
          entries={entries}
          busy={null}
          onAccept={() => {}}
          onRefuse={() => {}}
        />,
      );
      expect(document.getElementById("oauthValidation")?.getAttribute("data-level")).toBe(c.level);
      expect(document.getElementById("oauthValidationBadge")?.textContent).toBe(c.badge);
      expect(document.getElementById("oauthValidationExplain")?.textContent).toMatch(c.explain);
      expect(document.getElementById("oauthValidationCaution") != null).toBe(c.caution);
      cleanup();
    }
  });

  it("[CPN7] a Publisher Validated app names its publisher", () => {
    render(
      <ConsentPanel
        app={{ name: "My App" }}
        validation={{ level: "publisherValidated", publisher: { name: "Acme Health", validated: true }, validatedAt: null }}
        entries={entries}
        busy={null}
        onAccept={() => {}}
        onRefuse={() => {}}
      />,
    );
    expect(document.getElementById("oauthValidationExplain")?.textContent).toBe(
      "Published by Acme Health, verified by the platform operator; the application itself was not reviewed.",
    );
  });

  it("[CPN8] the app's host, when given, sits next to its name in its own element, never a link", () => {
    render(
      <ConsentPanel app={{ name: "Agent" }} appHost={{ host: "client.example" }} entries={entries} busy={null} onAccept={() => {}} onRefuse={() => {}} />,
    );
    const host = document.getElementById("consentAppHost") as HTMLElement;
    expect(host.textContent).toBe("client.example");
    expect(host.parentElement?.tagName).toBe("H1");
    expect(host.getAttribute("title")).toBeNull();
    expect(document.querySelector("h1 a")).toBeNull();
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
