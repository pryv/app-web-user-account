// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AUTO_DELETION_ERRORS, endOfLocalDayIso, earliestDay } from "../../lib/autoDeletion";

/**
 * [ADCD] "Automatic deletion" card: each state in plain words, hidden when
 * the platform does not offer it, the password asked only when a change arms
 * or shortens the schedule, a date sent as an instant at the end of the local
 * day, the no-reminder acknowledgement, no controls for a delegate, refusals
 * explained.
 */

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);

const FEATURE = {
  triggers: ["date", "inactivity"],
  actions: ["delete"],
  reminderLeadDays: [60, 30, 7, 1],
  bounds: { minDays: 90, maxDays: 3650, minLeadDays: 14 },
  userOverride: true,
  allowUserOptOut: true,
  mailAvailable: true,
};

type Json = Record<string, unknown>;
const NONE: Json = {
  effective: { source: "none", mode: "never", action: "delete" },
  setting: null,
  lastActivity: { personal: NOW - DAY, app: null, delegate: null, max: NOW - DAY, by: "owner" },
  deadline: null,
  deleteAt: null,
  deadlineReason: null,
  nextReminderAt: null,
  remindersSent: [],
  blocked: null,
  mail: "available",
  bounds: FEATURE.bounds,
  userOverride: true,
  allowUserOptOut: true,
  actions: ["delete"],
};

const state = vi.hoisted(() => ({
  serviceInfo: {} as Record<string, unknown>,
  accessInfo: {} as Record<string, unknown>,
  actingAs: null as null | { username: string; parentUsername: string },
  autoDeletion: {} as Record<string, unknown>,
  setReplies: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ method: string; params: Record<string, unknown> }>,
}));

const connection = {
  endpoint: "https://core.example.com/alice/",
  token: "personal-token",
  username: async () => "alice",
  accessInfo: async () => state.accessInfo,
  service: { info: async () => state.serviceInfo },
  api: async (batch: Array<{ method: string; params: Record<string, unknown> }>) =>
    batch.map((c) => {
      state.calls.push(c);
      if (c.method === "account.getAutoDeletion") return { autoDeletion: state.autoDeletion };
      if (c.method === "account.setAutoDeletion") return state.setReplies.shift() ?? { autoDeletion: state.autoDeletion };
      return {};
    }),
};
vi.mock("../../lib/useSession", () => ({
  useSession: () => ({ connection, setConnection: vi.fn(), actingAs: state.actingAs }),
}));

import AutoDeletionCard from "./AutoDeletionCard";
import DataRights from "./DataRights";

beforeEach(() => {
  state.serviceInfo = { features: { autoDeletion: FEATURE } };
  state.accessInfo = { id: "self", type: "personal" };
  state.actingAs = null;
  state.autoDeletion = NONE;
  state.setReplies = [];
  state.calls = [];
});
afterEach(() => cleanup());

function renderCard() {
  return render(
    <MemoryRouter>
      <AutoDeletionCard exportAnchorId="data-export" />
    </MemoryRouter>,
  );
}
const sets = () => state.calls.filter((c) => c.method === "account.setAutoDeletion").map((c) => c.params);
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

async function typePassword(password: string) {
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
}
async function confirmDialog() {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
}

describe("[ADCD] automatic deletion card", () => {
  it("[ADC1] hidden when the platform does not offer it, and on the data page too", async () => {
    state.serviceInfo = { features: {} };
    render(
      <MemoryRouter>
        <DataRights />
      </MemoryRouter>,
    );
    await screen.findByText("Export your data");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Automatic deletion")).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("[ADC2] no schedule: says so, with last use and the export link", async () => {
    renderCard();
    expect(await screen.findByText("No automatic deletion is scheduled for your account.")).toBeTruthy();
    expect(screen.getByText(/^Last used on /)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download your data first" }).getAttribute("href")).toBe("#data-export");
    expect(screen.getByRole("radio", { name: /Follow the platform's policy/ })).toHaveProperty("checked", true);
    expect(screen.getByText("Currently: no automatic deletion.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("[ADC3] platform policy by inactivity: date, source, delegate use, next reminder, minimum notice", async () => {
    state.autoDeletion = {
      ...NONE,
      effective: { source: "operator", mode: "inactivity", inactivityDays: 365, action: "delete" },
      lastActivity: { personal: null, app: null, delegate: NOW - 2 * DAY, max: NOW - 2 * DAY, by: "delegate" },
      deadline: NOW + 300 * DAY,
      deleteAt: NOW + 310 * DAY,
      deadlineReason: "minimum-notice",
      nextReminderAt: NOW + 240 * DAY,
    };
    renderCard();
    const status = await screen.findByTestId("auto-deletion-status");
    expect(status.textContent).toMatch(/deleted after 365 days without use: currently on /);
    expect(status.textContent).toContain("This is the default policy of this platform.");
    expect(status.textContent).toMatch(/Last used by your delegate on /);
    expect(status.textContent).toMatch(/Next reminder email: /);
    expect(status.textContent).toContain("enough notice after the first reminder email");
    expect(screen.getByText("Currently: deletion after 365 days without use.")).toBeTruthy();
  });

  it("[ADC4] own fixed date, paused for lack of email, mail not configured", async () => {
    state.autoDeletion = {
      ...NONE,
      effective: { source: "user", mode: "date", date: "2031-03-01T23:59:59+00:00", action: "delete" },
      setting: { mode: "date", date: "2031-03-01T23:59:59+00:00", action: "delete", updatedAt: NOW },
      deadline: Date.parse("2031-03-01T23:59:59Z") / 1000,
      deleteAt: Date.parse("2031-03-01T23:59:59Z") / 1000,
      deadlineReason: "date",
      blocked: { reason: "no-email", at: NOW },
      mail: "no-email",
    };
    renderCard();
    const status = await screen.findByTestId("auto-deletion-status");
    expect(status.textContent).toMatch(/will be deleted on .*2031/);
    expect(status.textContent).toContain("This is your own choice.");
    expect(status.textContent).toContain("The schedule is paused: your account has no email address");
    expect(status.textContent).not.toContain("you would get no reminder before a deletion");
    cleanup();

    state.autoDeletion = { ...NONE, mail: "not-configured" };
    renderCard();
    expect(await screen.findByText(/This platform does not send emails/)).toBeTruthy();
  });

  it("[ADC5] arming a period asks the password and sends it", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: "After a period without use" }));
    fireEvent.change(screen.getByLabelText("Period without use"), { target: { value: "730" } });
    save();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("permanently deleted after 730 days without use");
    expect(dialog.textContent).toContain("Reminder emails will be sent 60, 30, 7, and 1 days before.");
    await typePassword("s3cret");
    expect(await screen.findByText("Your choice is saved.")).toBeTruthy();
    expect(sets()).toEqual([{ mode: "inactivity", inactivityDays: 730, action: "delete", password: "s3cret" }]);
  });

  it("[ADC6] lengthening the period or turning it off needs no password", async () => {
    state.autoDeletion = {
      ...NONE,
      effective: { source: "user", mode: "inactivity", inactivityDays: 365, action: "delete" },
      setting: { mode: "inactivity", inactivityDays: 365, action: "delete", updatedAt: NOW },
      deadline: NOW + 360 * DAY,
    };
    renderCard();
    expect(await screen.findByLabelText("Period without use")).toHaveProperty("value", "365");
    fireEvent.change(screen.getByLabelText("Period without use"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Number of days"), { target: { value: "500" } });
    save();
    await confirmDialog();
    await screen.findByText("Your choice is saved.");
    expect(sets()[0]).toEqual({ mode: "inactivity", inactivityDays: 500, action: "delete" });

    fireEvent.click(screen.getByRole("radio", { name: /Never delete my account automatically/ }));
    save();
    await confirmDialog();
    await waitFor(() => expect(sets()).toHaveLength(2));
    expect(sets()[1]).toEqual({ mode: "never" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("[ADC7] shortening asks the password; a wrong one is explained", async () => {
    state.autoDeletion = {
      ...NONE,
      effective: { source: "user", mode: "inactivity", inactivityDays: 730, action: "delete" },
      setting: { mode: "inactivity", inactivityDays: 730, action: "delete", updatedAt: NOW },
    };
    state.setReplies = [{ error: { id: "invalid-operation", message: "The given password does not match." } }];
    renderCard();
    expect(await screen.findByLabelText("Period without use")).toHaveProperty("value", "730");
    fireEvent.change(screen.getByLabelText("Period without use"), { target: { value: "365" } });
    save();
    await typePassword("wrong");
    expect(await screen.findByText("Wrong password. Nothing was changed.")).toBeTruthy();
    expect(sets()[0]).toMatchObject({ inactivityDays: 365, password: "wrong" });
  });

  it("[ADC8] a date is sent as the end of the picked local day, with its offset", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: "On a date" }));
    const input = screen.getByLabelText("Deletion date") as HTMLInputElement;
    const min = earliestDay(new Date(), 14);
    expect(input.min).toBe(min);
    fireEvent.change(input, { target: { value: "2031-06-01" } });
    save();
    await typePassword("s3cret");
    await screen.findByText("Your choice is saved.");
    const sent = sets()[0];
    expect(sent).toEqual({ mode: "date", date: endOfLocalDayIso("2031-06-01"), action: "delete", password: "s3cret" });
    expect(sent.date).toMatch(/^2031-06-01T23:59:59[+-]\d{2}:\d{2}$/);
  });

  it("[ADC9] a date before the minimum lead cannot be saved", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: "On a date" }));
    const tooEarly = earliestDay(new Date(), 2);
    fireEvent.change(screen.getByLabelText("Deletion date"), { target: { value: tooEarly } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("[ADC10] without email: the acknowledgement is required and sent", async () => {
    state.autoDeletion = { ...NONE, mail: "no-email" };
    renderCard();
    expect(await screen.findByText(/Your account has no email address: you would get no reminder/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "After a period without use" }));
    const ack = screen.getByLabelText("I understand I will get no reminder email before my account is deleted.");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ack);
    save();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("You will get no reminder email.");
    await typePassword("s3cret");
    await screen.findByText("Your choice is saved.");
    expect(sets()[0]).toEqual({
      mode: "inactivity",
      inactivityDays: 365,
      action: "delete",
      acknowledgeNoReminders: true,
      password: "s3cret",
    });
  });

  it("[ADC11] the platform's no-email refusal brings the acknowledgement up", async () => {
    state.setReplies = [{ error: { id: "invalid-operation", message: "x", data: { id: AUTO_DELETION_ERRORS.noEmail } } }];
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: "After a period without use" }));
    save();
    await typePassword("s3cret");
    expect(await screen.findByText(/Tick the box to confirm you understand/)).toBeTruthy();
    expect(screen.getByLabelText("I understand I will get no reminder email before my account is deleted.")).toBeTruthy();
  });

  it("[ADC12] acting for a controlled account: the schedule shows, the controls do not", async () => {
    state.actingAs = { username: "alice", parentUsername: "bob" };
    renderCard();
    expect(await screen.findByText("No automatic deletion is scheduled for your account.")).toBeTruthy();
    expect(screen.getByTestId("auto-deletion-delegate-note")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("[ADC13] a delegate session known only to the server also hides the controls", async () => {
    state.accessInfo = { id: "x", delegation: { isDelegatedAccess: true, controlledUsername: "alice" } };
    renderCard();
    expect(await screen.findByTestId("auto-deletion-delegate-note")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("[ADC14] deletion not allowed by the operator: no date or period offered", async () => {
    state.serviceInfo = { features: { autoDeletion: { ...FEATURE, actions: [] } } };
    state.autoDeletion = { ...NONE, actions: [] };
    renderCard();
    expect(
      await screen.findByText("The operator of this platform does not allow scheduling the deletion of your account."),
    ).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "On a date" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "After a period without use" })).toBeNull();
  });

  it("[ADC15] opt-out not allowed: no never option; refusals are explained", async () => {
    state.autoDeletion = {
      ...NONE,
      allowUserOptOut: false,
      effective: { source: "user", mode: "inactivity", inactivityDays: 365, action: "delete" },
      setting: { mode: "inactivity", inactivityDays: 365, action: "delete", updatedAt: NOW },
    };
    state.setReplies = [
      { error: { id: "invalid-operation", message: "x", data: { id: AUTO_DELETION_ERRORS.outOfBounds } } },
      { error: { id: "forbidden", message: "Something unexpected" } },
    ];
    renderCard();
    expect(await screen.findByLabelText("Period without use")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Never delete/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Period without use"), { target: { value: "1825" } });
    save();
    await confirmDialog();
    expect(await screen.findByText(/accepts a period between 90 and 3650 days, and a date at least 14 days/)).toBeTruthy();

    save();
    await confirmDialog();
    expect(await screen.findByText("Could not save: Something unexpected")).toBeTruthy();
  });

  it("[ADC16] the platform asking a password the page did not expect: asked, then sent again", async () => {
    state.autoDeletion = {
      ...NONE,
      effective: { source: "user", mode: "inactivity", inactivityDays: 365, action: "delete" },
      setting: { mode: "inactivity", inactivityDays: 365, action: "delete", updatedAt: NOW },
    };
    state.setReplies = [
      { error: { id: "invalid-operation", message: "x", data: { id: AUTO_DELETION_ERRORS.passwordRequired } } },
    ];
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: /Follow the platform's policy/ }));
    save();
    await confirmDialog();
    await typePassword("s3cret");
    await screen.findByText("Your choice is saved.");
    expect(sets()).toEqual([{ mode: "default" }, { mode: "default", password: "s3cret" }]);
  });

  it("[ADC17] cancelling the dialog sends nothing", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: "After a period without use" }));
    save();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sets()).toEqual([]);
  });
});
