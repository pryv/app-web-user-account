// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [ACRD] One access card for sessions and apps: the name from the
 * accessNaming extension (default naming when it returns null), badges, the
 * dates row, the Details link carrying the query, and the client data behind a
 * closed disclosure.
 */

const naming = vi.hoisted(() => ({
  value: null as null | { label: string; host?: string; icon?: { type: "emoji" | "url" | "base64"; value: string } },
  calls: [] as Array<{ connection: unknown; accessId: string; sessions: number }>,
}));
vi.mock("../extensions/accessNaming", () => ({
  useAccessNaming: (connection: unknown, entry: { access: { id: string }; sessions: unknown[] }) => {
    naming.calls.push({ connection, accessId: entry.access.id, sessions: entry.sessions.length });
    return naming.value;
  },
}));

import { AccessCard } from "./AccessCard";

const oct5 = Date.UTC(2026, 9, 5, 12) / 1000;
const CONNECTION = { api: vi.fn() } as never;

afterEach(() => {
  cleanup();
  naming.value = null;
  naming.calls = [];
});

function renderCard(props: Partial<Parameters<typeof AccessCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <AccessCard
        access={{
          id: "g1:2",
          name: "oauth-grant:clinic",
          type: "app",
          permissions: [{ streamId: "diary", level: "read" }],
          created: oct5,
          clientData: { oauth: { client: { name: "Clinic app", origin: "operator", host: "clinic.example" } } },
        }}
        isSelf={false}
        search="?pryvServiceInfoUrl=x"
        connection={CONNECTION}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("[ACRD] access card", () => {
  it("[ACR1] default naming when the extension returns null", () => {
    renderCard();
    expect(screen.getByText("Clinic app", { selector: ".accessName" })).toBeTruthy();
    expect(screen.getByText("clinic.example", { selector: ".accessHost" })).toBeTruthy();
    expect(naming.calls[0]).toEqual({ connection: CONNECTION, accessId: "g1:2", sessions: 0 });
  });

  it("[ACR2] label, host and icon from the extension", () => {
    naming.value = { label: "Diary by Acme", host: "acme.example", icon: { type: "emoji", value: "📔" } };
    renderCard({ sessions: [{ id: "s1", name: "oauth:clinic" }] });
    expect(screen.getByText("Diary by Acme", { selector: ".accessName" })).toBeTruthy();
    expect(screen.getByText("acme.example", { selector: ".accessHost" })).toBeTruthy();
    expect(screen.getByText("📔")).toBeTruthy();
    expect(screen.queryByText("Clinic app", { selector: ".accessName" })).toBeNull();
    expect(naming.calls[0].sessions).toBe(1);
  });

  it("[ACR3] badges, meta line and dates row", () => {
    renderCard({
      isSelf: true,
      access: { id: "a1", name: "old", type: "app", permissions: [], created: oct5, expires: oct5 + 86400, expired: true, deleted: oct5 + 100 },
      sessions: [{ id: "s1" }, { id: "s2" }],
    });
    const card = screen.getByTestId("access-card");
    expect(within(card).getByText("this session")).toBeTruthy();
    expect(within(card).getByText("expired")).toBeTruthy();
    expect(within(card).getByText("removed")).toBeTruthy();
    expect(within(card).getByText("app · 0 permissions · 2 active sessions")).toBeTruthy();
    const dates = screen.getByTestId("access-card-dates").textContent!;
    expect(dates).toContain("Created Oct 5, 2026");
    expect(dates).toContain("Never used");
    expect(dates).toContain("Expires Oct 6, 2026");
  });

  it("[ACR4] a personal session: kind, last used, never expires, no permission count", () => {
    renderCard({ access: { id: "p1", name: "my-app-id", type: "personal", lastUsed: oct5 } });
    expect(screen.getByText("personal")).toBeTruthy();
    const dates = screen.getByTestId("access-card-dates").textContent!;
    expect(dates).toContain("Last used Oct 5, 2026");
    expect(dates).toContain("Never expires");
  });

  it("[ACR5] the Details link carries the current query", () => {
    renderCard();
    expect(screen.getByRole("link", { name: /details/i }).getAttribute("href")).toBe(
      "/account/audit-access/g1%3A2?pryvServiceInfoUrl=x",
    );
  });

  it("[ACR6] client data sits in a closed disclosure, as labelled rows", () => {
    renderCard();
    const details = screen.getByText("Client data").closest("details")!;
    expect(details.open).toBe(false);
    const list = within(details);
    expect(list.getByText("App host")).toBeTruthy();
    expect(list.getByText("clinic.example")).toBeTruthy();
    expect(list.getByText("Registered by")).toBeTruthy();
  });

  it("[ACR7] no client data, no disclosure", () => {
    renderCard({ access: { id: "a1", name: "plain", type: "app" } });
    expect(screen.queryByText("Client data")).toBeNull();
  });
});
