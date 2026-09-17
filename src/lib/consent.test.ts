import { describe, it, expect } from "vitest";
import {
  consentEntries,
  grantedPermissions,
  initialFlags,
  permissionLabel,
  pickText,
  type OfferPermission,
} from "./consent";

// Full-lexicon permission set (stream + feature entries, one mandatory).
const PERMISSIONS: OfferPermission[] = [
  { streamId: "health", level: "read", defaultName: "Health", mandatory: true },
  { streamId: "diary", level: "contribute" },
  { feature: "selfRevoke", setting: "forbidden" },
];

describe("consentEntries (display-model mapper)", () => {
  it("locks EVERY entry by default (all-or-nothing consent), without required hints", () => {
    const entries = consentEntries(PERMISSIONS);
    expect(entries).toHaveLength(3);
    for (const e of entries) {
      expect(e.locked).toBe(true);
      expect(e.showRequiredHint).toBe(false);
    }
  });

  it("with user choice, locks only mandatory entries and hints them as required", () => {
    const entries = consentEntries(PERMISSIONS, { allowUserChoice: true });
    expect(entries.map((e) => e.locked)).toEqual([true, false, false]);
    expect(entries.map((e) => e.showRequiredHint)).toEqual([true, false, false]);
  });

  it("carries the original permission and its label on each entry", () => {
    const entries = consentEntries(PERMISSIONS, { allowUserChoice: true });
    expect(entries[0].permission).toBe(PERMISSIONS[0]);
    expect(entries[0].label).toBe("Read “Health”");
    expect(entries[2].label).toMatch(/cannot revoke its own access/);
  });
});

describe("grantedPermissions", () => {
  const entries = consentEntries(PERMISSIONS, { allowUserChoice: true });

  it("always grants locked (mandatory) entries; unlocked ones follow the flags", () => {
    const granted = grantedPermissions(entries, [false, false, true]);
    expect(granted).toEqual([
      { streamId: "health", level: "read", defaultName: "Health" },
      { feature: "selfRevoke", setting: "forbidden" },
    ]);
  });

  it("strips the consent-layer `mandatory` annotation from every granted entry", () => {
    const granted = grantedPermissions(entries, [true, true, true]);
    for (const p of granted) expect("mandatory" in p).toBe(false);
  });

  it("grants the full set when consent is all-or-nothing (every entry locked)", () => {
    const lockedEntries = consentEntries(PERMISSIONS);
    const granted = grantedPermissions(lockedEntries, [false, false, false]);
    expect(granted).toHaveLength(3);
  });
});

describe("the optIn display annotation", () => {
  // mandatory = required and locked; neither flag = optional, ticked to
  // begin with (opt out); optIn = optional, unticked to begin with (opt in).
  const MIXED: OfferPermission[] = [
    { streamId: "health", level: "read", mandatory: true },
    { streamId: "diary", level: "contribute" },
    { streamId: "location", level: "read", optIn: true },
    { feature: "selfRevoke", setting: "forbidden", optIn: true },
  ];

  it("[CSO1] opens optIn entries unticked, but only when the user has a choice", () => {
    const withChoice = consentEntries(MIXED, { allowUserChoice: true });
    expect(withChoice.map((e) => e.initiallyTicked)).toEqual([true, true, false, false]);
    // All-or-nothing: every entry is locked and granted, so opening one
    // unticked would show a state the user cannot act on.
    const allOrNothing = consentEntries(MIXED);
    expect(allOrNothing.map((e) => e.initiallyTicked)).toEqual([true, true, true, true]);
    expect(allOrNothing.every((e) => e.locked)).toBe(true);
  });

  it("[CSO2] strips BOTH annotations from granted entries", () => {
    // `accesses.create` rejects unknown per-entry fields, so an annotation
    // left on a granted entry fails the mint rather than being ignored.
    const entries = consentEntries(MIXED, { allowUserChoice: true });
    const granted = grantedPermissions(entries, initialFlags(entries));
    for (const p of granted) {
      expect("mandatory" in p).toBe(false);
      expect("optIn" in p).toBe(false);
    }
    expect(granted).toEqual([
      { streamId: "health", level: "read" },
      { streamId: "diary", level: "contribute" },
    ]);
  });

  it("[CSO3] initialFlags reflects the opening state of a mixed list", () => {
    const entries = consentEntries(MIXED, { allowUserChoice: true });
    expect(initialFlags(entries)).toEqual([true, true, false, false]);
    // Ticking an opt-in entry brings it into the grant.
    const flags = initialFlags(entries);
    flags[2] = true;
    expect(grantedPermissions(entries, flags)).toContainEqual({
      streamId: "location",
      level: "read",
    });
  });

  it("[CSO4] an optIn entry is never locked out of being granted", () => {
    // It starts unticked; it is still the user's to tick.
    const entries = consentEntries(MIXED, { allowUserChoice: true });
    expect(entries[2].locked).toBe(false);
    expect(entries[3].locked).toBe(false);
    expect(grantedPermissions(entries, [true, true, true, true])).toHaveLength(4);
  });
});

describe("permissionLabel + pickText", () => {
  it("labels stream permissions with level verb + display name", () => {
    expect(permissionLabel({ streamId: "health", level: "read", defaultName: "Health" })).toBe(
      "Read “Health”",
    );
    expect(permissionLabel({ streamId: "diary", level: "contribute" })).toBe(
      "Add and modify “diary”",
    );
    expect(permissionLabel({ streamId: "*", level: "manage" })).toBe("Fully manage all your data");
  });

  it("labels known feature permissions and falls back for unknown ones", () => {
    expect(permissionLabel({ feature: "selfRevoke", setting: "forbidden" })).toMatch(
      /cannot revoke its own access/,
    );
    expect(permissionLabel({ feature: "other", setting: "forbidden" })).toBe("other: forbidden");
  });

  it("pickText prefers the requested language, then en, then first", () => {
    expect(pickText({ en: "Hello", fr: "Bonjour" }, "fr")).toBe("Bonjour");
    expect(pickText({ en: "Hello", fr: "Bonjour" })).toBe("Hello");
    expect(pickText({ de: "Hallo" })).toBe("Hallo");
    expect(pickText(null)).toBe("");
  });
});
