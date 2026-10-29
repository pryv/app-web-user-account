import { describe, it, expect, afterEach } from "vitest";
import {
  AUTO_DELETION_ERRORS,
  AutoDeletionError,
  autoDeletionErrorKey,
  earliestDay,
  endOfLocalDayIso,
  getAutoDeletion,
  inactivityPresets,
  paramsFor,
  readAutoDeletionFeature,
  remindersFor,
  requiresPassword,
  setAutoDeletion,
  type AutoDeletionState,
} from "./autoDeletion";
import type { PryvConnection } from "./sessionStore";

/**
 * [ADLB] Automatic deletion: the rules the account page applies before
 * calling the platform (password, date as an instant, presets, reminders,
 * error mapping) and the calls themselves.
 */

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

type Setting = AutoDeletionState["setting"];
const inactivity = (days: number): Setting => ({ mode: "inactivity", inactivityDays: days, action: "delete" });
const date = (iso: string): Setting => ({ mode: "date", date: iso, action: "delete" });

describe("[ADLB] automatic deletion rules", () => {
  it("[ADL1] a picked day is sent as the end of that day in the local zone, with its offset", () => {
    process.env.TZ = "Europe/Zurich";
    expect(endOfLocalDayIso("2027-06-01")).toBe("2027-06-01T23:59:59+02:00");
    expect(endOfLocalDayIso("2027-01-15")).toBe("2027-01-15T23:59:59+01:00");
    process.env.TZ = "America/New_York";
    expect(endOfLocalDayIso("2027-06-01")).toBe("2027-06-01T23:59:59-04:00");
    process.env.TZ = "UTC";
    expect(endOfLocalDayIso("2027-06-01")).toBe("2027-06-01T23:59:59+00:00");
    expect(() => endOfLocalDayIso("2027-06")).toThrow();
  });

  it("[ADL2] params: a date is never date-only, a period is an integer, both say delete", () => {
    process.env.TZ = "Asia/Kolkata";
    expect(paramsFor({ mode: "date", day: "2027-06-01" })).toEqual({
      mode: "date",
      date: "2027-06-01T23:59:59+05:30",
      action: "delete",
    });
    expect(paramsFor({ mode: "inactivity", inactivityDays: 730 })).toEqual({
      mode: "inactivity",
      inactivityDays: 730,
      action: "delete",
    });
    expect(paramsFor({ mode: "never" })).toEqual({ mode: "never" });
    expect(paramsFor({ mode: "default" })).toEqual({ mode: "default" });
  });

  it("[ADL3] the password is asked when arming or shortening, not when clearing or lengthening", () => {
    // Arming: from no own setting, or from never.
    expect(requiresPassword(null, { mode: "inactivity", inactivityDays: 3650 })).toBe(true);
    expect(requiresPassword({ mode: "never" }, { mode: "date", day: "2040-01-01" })).toBe(true);
    // Another trigger.
    expect(requiresPassword(inactivity(365), { mode: "date", day: "2040-01-01" })).toBe(true);
    // Shorter period / longer period / same.
    expect(requiresPassword(inactivity(730), { mode: "inactivity", inactivityDays: 365 })).toBe(true);
    expect(requiresPassword(inactivity(365), { mode: "inactivity", inactivityDays: 730 })).toBe(false);
    expect(requiresPassword(inactivity(365), { mode: "inactivity", inactivityDays: 365 })).toBe(false);
    // Earlier / later date (the stored date may be an ISO instant or epoch seconds).
    process.env.TZ = "UTC";
    expect(requiresPassword(date("2030-06-01T23:59:59+00:00"), { mode: "date", day: "2030-05-01" })).toBe(true);
    expect(requiresPassword(date("2030-06-01T23:59:59+00:00"), { mode: "date", day: "2030-07-01" })).toBe(false);
    const secs = Date.parse("2030-06-01T23:59:59Z") / 1000;
    expect(requiresPassword({ mode: "date", date: secs }, { mode: "date", day: "2030-05-01" })).toBe(true);
    // A transfer turned into a deletion.
    expect(
      requiresPassword({ mode: "inactivity", inactivityDays: 365, action: "transfer" }, { mode: "inactivity", inactivityDays: 365 }),
    ).toBe(true);
    // Clearing.
    expect(requiresPassword(inactivity(365), { mode: "never" })).toBe(false);
    expect(requiresPassword(inactivity(365), { mode: "default" })).toBe(false);
    expect(requiresPassword(null, { mode: "never" })).toBe(false);
  });

  it("[ADL4] the earliest date is today plus the minimum lead, local", () => {
    expect(earliestDay(new Date(2027, 0, 25, 15, 0), 14)).toBe("2027-02-08");
    expect(earliestDay(new Date(2027, 0, 25, 0, 1), 0)).toBe("2027-01-25");
  });

  it("[ADL5] period presets are 1, 2, 5 and 10 years, within the bounds", () => {
    expect(inactivityPresets(null).map((p) => p.days)).toEqual([365, 730, 1825, 3650]);
    expect(inactivityPresets({ minDays: 90, maxDays: 2000, minLeadDays: 14 }).map((p) => p.years)).toEqual([1, 2, 5]);
    expect(inactivityPresets({ minDays: 400, maxDays: 3650, minLeadDays: 14 }).map((p) => p.years)).toEqual([2, 5, 10]);
  });

  it("[ADL6] reminders are those shorter than the period or the time left", () => {
    const now = new Date(2027, 0, 1, 12, 0);
    expect(remindersFor([60, 30, 7, 1], { mode: "inactivity", inactivityDays: 365 }, now)).toEqual([60, 30, 7, 1]);
    expect(remindersFor([60, 30, 7, 1], { mode: "inactivity", inactivityDays: 45 }, now)).toEqual([30, 7, 1]);
    expect(remindersFor([1, 7, 30, 60], { mode: "date", day: "2027-01-20" }, now)).toEqual([7, 1]);
  });

  it("[ADL7] the feature is read from service info, absent means not offered", () => {
    expect(readAutoDeletionFeature({ features: {} })).toBeNull();
    expect(readAutoDeletionFeature(null)).toBeNull();
    expect(
      readAutoDeletionFeature({
        features: {
          autoDeletion: {
            triggers: ["date", "inactivity"],
            actions: ["delete"],
            reminderLeadDays: [60, 30, 7, 1],
            bounds: { minDays: 90, maxDays: 3650, minLeadDays: 14 },
            userOverride: true,
            allowUserOptOut: false,
            mailAvailable: true,
          },
        },
      }),
    ).toEqual({
      triggers: ["date", "inactivity"],
      actions: ["delete"],
      reminderLeadDays: [60, 30, 7, 1],
      bounds: { minDays: 90, maxDays: 3650, minLeadDays: 14 },
      userOverride: true,
      allowUserOptOut: false,
      mailAvailable: true,
    });
  });

  it("[ADL8] refusals map to the page's own messages by id, or by the password wording", () => {
    expect(autoDeletionErrorKey(new AutoDeletionError("x", [AUTO_DELETION_ERRORS.outOfBounds, "invalid-parameters-format"]))).toBe("outOfBounds");
    expect(autoDeletionErrorKey(new AutoDeletionError("x", ["invalid-operation", AUTO_DELETION_ERRORS.noEmail]))).toBe("noEmail");
    expect(autoDeletionErrorKey(new AutoDeletionError("The given password does not match.", ["invalid-operation"]))).toBe("wrongPassword");
    expect(autoDeletionErrorKey(new AutoDeletionError("something else", ["invalid-operation"]))).toBeNull();
    expect(autoDeletionErrorKey(new Error("x"))).toBeNull();
  });

  it("[ADL9] calls: the state is unwrapped, a refusal carries its ids", async () => {
    const calls: unknown[] = [];
    const conn = {
      api: async (batch: Array<{ method: string; params: unknown }>) => {
        calls.push(batch);
        if (batch[0].method === "account.getAutoDeletion") {
          return [{ autoDeletion: { effective: { source: "none", mode: "never" }, setting: null } }];
        }
        return [{ error: { id: "invalid-operation", message: "no", data: { id: AUTO_DELETION_ERRORS.optOutNotAllowed } } }];
      },
    } as unknown as PryvConnection;
    const state = await getAutoDeletion(conn);
    expect(state.effective.source).toBe("none");
    const err = await setAutoDeletion(conn, { mode: "never" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AutoDeletionError);
    expect((err as AutoDeletionError).ids).toEqual([AUTO_DELETION_ERRORS.optOutNotAllowed, "invalid-operation"]);
    expect(calls[1]).toEqual([{ method: "account.setAutoDeletion", params: { mode: "never" } }]);
  });
});
