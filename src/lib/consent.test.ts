import { describe, it, expect } from "vitest";
import {
  consentEntries,
  consentGroupCounts,
  consentLayout,
  groupTickState,
  levellessKey,
  setGroupTicks,
  grantedPermissions,
  initialFlags,
  levelLabel,
  permissionLabel,
  permissionKey,
  offerEntryLabel,
  pickText,
  withRequestedNames,
  type OfferEntryGroup,
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

  it("with user choice, locks only mandatory entries and restrictions, and hints the mandatory ones as required", () => {
    const entries = consentEntries(PERMISSIONS, { allowUserChoice: true });
    expect(entries.map((e) => e.locked)).toEqual([true, false, true]);
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

  it("always grants locked (mandatory, restriction) entries; unlocked ones follow the flags", () => {
    const granted = grantedPermissions(entries, [false, false, false]);
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
    // The restriction is locked and ticked even though it says optIn.
    expect(withChoice.map((e) => e.initiallyTicked)).toEqual([true, true, false, true]);
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
      { feature: "selfRevoke", setting: "forbidden" },
    ]);
  });

  it("[CSO3] initialFlags reflects the opening state of a mixed list", () => {
    const entries = consentEntries(MIXED, { allowUserChoice: true });
    expect(initialFlags(entries)).toEqual([true, true, false, true]);
    // Ticking an opt-in entry brings it into the grant.
    const flags = initialFlags(entries);
    flags[2] = true;
    expect(grantedPermissions(entries, flags)).toContainEqual({
      streamId: "location",
      level: "read",
    });
  });

  it("[CSO4] an optIn stream entry is never locked out of being granted", () => {
    // It starts unticked; it is still the user's to tick. A restriction is
    // locked whatever it says: unticking it would hand the app more.
    const entries = consentEntries(MIXED, { allowUserChoice: true });
    expect(entries[2].locked).toBe(false);
    expect(entries[3].locked).toBe(true);
    expect(grantedPermissions(entries, [true, true, true, true])).toHaveLength(4);
  });
});

describe("[CCMP] a consent shown again: entries the app already holds, restrictions", () => {
  const COMPOSED: OfferPermission[] = [
    { streamId: "health", level: "read", mandatory: true, currentlyGranted: true },
    { streamId: "diary", level: "contribute", currentlyGranted: true },
    // The core never sends optIn on a held entry; if it did, held wins.
    { streamId: "steps", level: "read", currentlyGranted: true, optIn: true },
    { streamId: "location", level: "read", optIn: true },
    { feature: "webhooks", setting: "forbidden", mandatory: true, currentlyGranted: true },
    { feature: "exports", setting: "forbidden" },
  ];

  it("[CCM1] held entries open ticked (locked when mandatory), new optIn entries unticked", () => {
    const entries = consentEntries(COMPOSED, { allowUserChoice: true });
    expect(entries.map((e) => e.initiallyTicked)).toEqual([true, true, true, false, true, true]);
    expect(entries.map((e) => e.locked)).toEqual([true, false, false, false, true, true]);
    // A held restriction is not flagged "already allowed".
    expect(entries.map((e) => e.currentlyGranted)).toEqual([true, true, true, false, false, false]);
    // A restriction is not something the app "requires".
    expect(entries.map((e) => e.showRequiredHint)).toEqual([true, false, false, false, false, false]);
  });

  it("[CCM2] unticking a held entry leaves it out of the grant; annotations never travel", () => {
    const entries = consentEntries(COMPOSED, { allowUserChoice: true });
    const flags = initialFlags(entries);
    flags[1] = false;
    flags[4] = false;
    flags[5] = false;
    expect(grantedPermissions(entries, flags)).toEqual([
      { streamId: "health", level: "read" },
      { streamId: "steps", level: "read" },
      { feature: "webhooks", setting: "forbidden" },
      { feature: "exports", setting: "forbidden" },
    ]);
  });

  it("[CCM5] a held stream shown at another level keeps the level the app holds today", () => {
    const entries = consentEntries([
      { streamId: "diary", level: "contribute", currentlyGranted: true, currentLevel: "read" },
      { streamId: "health", level: "read", currentlyGranted: true, currentLevel: "read" },
      { streamId: "steps", level: "read", currentlyGranted: true },
      { streamId: "location", level: "read", currentLevel: "manage" },
    ], { allowUserChoice: true });
    expect(entries.map((e) => e.heldLevel)).toEqual(["read", null, null, null]);
    expect(grantedPermissions(entries, initialFlags(entries))[0]).toEqual({ streamId: "diary", level: "contribute" });
    expect(levelLabel("contribute")).toBe("Add and modify");
    expect(levelLabel("odd")).toBe("odd");
  });

  it("[CCM3] a restriction is locked and granted whatever mandatory and optIn say", () => {
    for (const p of [
      { feature: "webhooks", setting: "forbidden" },
      { feature: "webhooks", setting: "forbidden", mandatory: false },
      { feature: "webhooks", setting: "forbidden", optIn: true },
    ] as OfferPermission[]) {
      const entries = consentEntries([p], { allowUserChoice: true });
      expect(entries[0].locked).toBe(true);
      expect(entries[0].initiallyTicked).toBe(true);
      expect(entries[0].showRequiredHint).toBe(false);
      expect(grantedPermissions(entries, [false])).toEqual([{ feature: "webhooks", setting: "forbidden" }]);
    }
    // An allowed feature stays the user's choice.
    expect(consentEntries([{ feature: "webhooks", setting: "allowed" }], { allowUserChoice: true })[0].locked).toBe(false);
  });

  it("[CCM4] an unknown restriction reads as something the app cannot use", () => {
    expect(permissionLabel({ feature: "exports", setting: "forbidden" })).toBe("The app cannot use “exports”");
    expect(permissionLabel({ feature: "exports", setting: "allowed" })).toBe("exports: allowed");
    const label = offerEntryLabel({ "f|exports|forbidden": { en: "The app cannot export your data" } }, "en");
    expect(permissionLabel({ feature: "exports", setting: "forbidden" }, { entryLabel: label })).toBe(
      "The app cannot export your data",
    );
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
    expect(permissionLabel({ feature: "webhooks", setting: "forbidden" })).toMatch(
      /cannot register webhooks/,
    );
    expect(permissionLabel({ feature: "secretSharing", setting: "forbidden" })).toMatch(
      /^The app cannot create shared secrets/,
    );
    expect(permissionLabel({ feature: "webhooks", setting: "allowed" })).toBe("webhooks: allowed");
    // An unknown restriction still reads as one.
    expect(permissionLabel({ feature: "other", setting: "forbidden" })).toBe("The app cannot use “other”");
    expect(permissionLabel({ feature: "other", setting: "on" })).toBe("other: on");
  });

  it("pickText prefers the requested language, then its base, then en, then first", () => {
    expect(pickText({ en: "Hello", fr: "Bonjour" }, "fr")).toBe("Bonjour");
    expect(pickText({ en: "Hello", fr: "Bonjour" })).toBe("Hello");
    expect(pickText({ de: "Hallo" })).toBe("Hallo");
    expect(pickText(null)).toBe("");
    expect(pickText(undefined, "fr")).toBe("");
  });

  it("[PKTB] pickText falls back from a regional language to its base, whatever the key order", () => {
    expect(pickText({ en: "Hello", fr: "Bonjour" }, "fr-CH")).toBe("Bonjour");
    expect(pickText({ "fr-CH": "Grüezi-Bonjour", fr: "Bonjour" }, "fr-CH")).toBe("Grüezi-Bonjour");
    expect(pickText({ de: "Hallo", en: "Hello" }, "fr-CH")).toBe("Hello");
    expect(pickText({ fr: "Bonjour", en: "Hello" }, "en-GB")).toBe("Hello");
  });
});

describe("[CSLB] consentEntries with a stream-label resolver", () => {
  const perms: OfferPermission[] = [
    { streamId: "weight", level: "read", name: "Weight (app)", defaultName: "Weight" },
    { streamId: "diary", level: "read", defaultName: "Diary" },
    { streamId: "*", level: "read" },
  ];

  it("[CSL1] a resolver's label wins over the request's own names", () => {
    const entries = consentEntries(perms, {
      labelFor: (id) => (id === "weight" ? "Body weight" : null),
    });
    expect(entries[0].label).toBe("Read “Body weight”");
  });

  it("[CSL2] a null (or empty) answer falls through to name, defaultName, then streamId", () => {
    const entries = consentEntries(
      [...perms, { streamId: "raw", level: "read" }],
      { labelFor: (id) => (id === "diary" ? "" : null) },
    );
    expect(entries.map((e) => e.label)).toEqual([
      "Read “Weight (app)”",
      "Read “Diary”",
      "Read all your data",
      "Read “raw”",
    ]);
  });

  it("[CSL3] a throwing resolver never breaks the list", () => {
    const entries = consentEntries(perms, {
      labelFor: () => {
        throw new Error("boom");
      },
    });
    expect(entries[1].label).toBe("Read “Diary”");
  });

  it("[CSL4] keeps the locking rules when a resolver is passed", () => {
    const entries = consentEntries(perms, { allowUserChoice: true, labelFor: () => null });
    expect(entries.map((e) => e.locked)).toEqual([false, false, false]);
  });
});

describe("[CSRN] withRequestedNames: an access read back gets the request's stream names", () => {
  const requested = [
    { streamId: "diary", level: "read", defaultName: "Journal" },
    { streamId: "notes", level: "manage", name: "Notes" },
    { feature: "selfRevoke", setting: "forbidden" },
  ];

  it("[CSRN1] folds the request's defaultName into the entries by streamId", () => {
    const stored: OfferPermission[] = [
      { streamId: "diary", level: "read" },
      { streamId: "notes", level: "manage" },
      { streamId: "other", level: "read" },
      { feature: "selfRevoke", setting: "forbidden" },
    ];
    expect(consentEntries(withRequestedNames(stored, requested)).map((e) => e.label)).toEqual([
      "Read “Journal”",
      "Fully manage “Notes”",
      "Read “other”",
      "The app cannot revoke its own access (only you can)",
    ]);
  });

  it("[CSRN2] display only: what each entry grants is unchanged, an existing name is kept", () => {
    const stored: OfferPermission[] = [{ streamId: "diary", level: "contribute", name: "My diary" }];
    expect(withRequestedNames(stored, requested)).toEqual(stored);
    const [p] = withRequestedNames([{ streamId: "diary", level: "contribute" }], requested);
    expect(permissionKey(p)).toBe("s|diary|contribute");
    expect(withRequestedNames([{ streamId: "diary", level: "read" }], null)).toEqual([{ streamId: "diary", level: "read" }]);
  });

  it("[CSRN3] a stream-label resolver still wins", () => {
    const [e] = consentEntries(withRequestedNames([{ streamId: "diary", level: "read" }], requested), {
      labelFor: (id) => (id === "diary" ? "Daily diary" : null),
    });
    expect(e.label).toBe("Read “Daily diary”");
  });
});

describe("[CLBP] stream name precedence", () => {
  const p: OfferPermission = { streamId: "body-bp", level: "read", defaultName: "Requested name" };
  const entryLabel = offerEntryLabel({ "s|body-bp|read": { en: "Blood pressure", fr: "Tension" } }, "fr-CH");
  const labelFor = () => "Deployment label";
  const accountName = () => "Account name";

  it("[CLB1] the offer's own entry label comes first, in the UI language", () => {
    expect(permissionLabel(p, { entryLabel, labelFor, accountName })).toBe("Read “Tension”");
  });

  it("[CLB2] then the deployment label, the account's stream name, the request's name, the id", () => {
    expect(permissionLabel(p, { labelFor, accountName })).toBe("Read “Deployment label”");
    expect(permissionLabel(p, { accountName })).toBe("Read “Account name”");
    expect(permissionLabel(p)).toBe("Read “Requested name”");
    expect(permissionLabel({ streamId: "body-bp", level: "read" })).toBe("Read “body-bp”");
  });

  it("[CLB3] a label is matched on the whole entry: another level gets none", () => {
    expect(permissionLabel({ streamId: "body-bp", level: "manage" }, { entryLabel })).toBe("Fully manage “body-bp”");
  });

  it("[CLB4] the level verb is always this app's; a failing source falls through", () => {
    const throwing = () => { throw new Error("x"); };
    expect(permissionLabel(p, { entryLabel: throwing, labelFor: throwing, accountName })).toBe("Read “Account name”");
  });

  it("[CLB5] known feature restrictions keep their own wording; unknown ones use the offer's label", () => {
    const labels = offerEntryLabel({
      "f|webhooks|forbidden": { en: "Something else" },
      "f|custom|on": { en: "Custom feature" },
    }, "en");
    expect(permissionLabel({ feature: "webhooks", setting: "forbidden" }, { entryLabel: labels })).toMatch(/cannot register webhooks/);
    expect(permissionLabel({ feature: "custom", setting: "on" }, { entryLabel: labels })).toBe("Custom feature");
  });

  it("[CLB6] a level-less key names the entry at any level or setting; the exact key wins", () => {
    const labels = offerEntryLabel({
      "s|body-bp": { en: "Blood pressure" },
      "s|body-bp|manage": { en: "Blood pressure (all of it)" },
      "f|custom": { en: "Custom feature" },
    }, "en");
    expect(permissionLabel({ streamId: "body-bp", level: "read" }, { entryLabel: labels })).toBe("Read “Blood pressure”");
    expect(permissionLabel({ streamId: "body-bp", level: "contribute" }, { entryLabel: labels })).toBe("Add and modify “Blood pressure”");
    expect(permissionLabel({ streamId: "body-bp", level: "manage" }, { entryLabel: labels })).toBe("Fully manage “Blood pressure (all of it)”");
    expect(permissionLabel({ feature: "custom", setting: "on" }, { entryLabel: labels })).toBe("Custom feature");
    expect(permissionLabel({ feature: "custom", setting: "off" }, { entryLabel: labels })).toBe("Custom feature");
    // Literal match: another spelling of the stream id gets none.
    expect(permissionLabel({ streamId: ":local:body-bp", level: "read" }, { entryLabel: labels })).toBe("Read “:local:body-bp”");
  });
});

describe("[CGRP] entry groups: layout, legend counts, the group's box", () => {
  const permissions: OfferPermission[] = [
    { streamId: "notes", level: "read" },                                  // 0 ungrouped
    { streamId: "bp", level: "read", mandatory: true, currentlyGranted: true }, // 1 vitals (exact key)
    { feature: "webhooks", setting: "forbidden" },                         // 2 ungrouped restriction
    { streamId: "hr", level: "contribute", optIn: true },                  // 3 vitals (level-less)
    { streamId: "steps", level: "read", currentlyGranted: true },          // 4 activity
    { streamId: "weight", level: "read", optIn: true },                    // 5 vitals (level-less)
    { feature: "selfRevoke", setting: "forbidden" },                       // 6 grouped restriction (activity)
  ];
  const groups: OfferEntryGroup[] = [
    { key: "empty", label: { en: "Nothing here" }, entries: [] },
    { key: "vitals", label: { en: "Vital signs", fr: "Signes vitaux" }, entries: ["s|bp|read", "s|hr", "s|weight", "s|elsewhere"] },
    { key: "outside", label: { en: "Not on this screen" }, entries: ["s|elsewhere|read"] },
    { key: "activity", label: null, entries: ["s|steps", "f|selfRevoke", "s|hr"] },
  ];
  const entries = consentEntries(permissions, { allowUserChoice: true });

  it("[CGR1] ungrouped entries first in offer order, then groups in array order, restrictions last", () => {
    const layout = consentLayout(entries, groups, "fr-CH");
    expect(layout).toEqual({
      ungrouped: [0],
      groups: [
        { key: "vitals", label: "Signes vitaux", indices: [1, 3, 5] },
        // No label: the key is the legend text. `s|hr` was already in vitals.
        { key: "activity", label: "activity", indices: [4, 6] },
      ],
      restrictions: [2],
    });
  });

  it("[CGR2] the exact key wins over a level-less one named by an earlier group", () => {
    const layout = consentLayout(entries, [
      { key: "a", label: { en: "A" }, entries: ["s|bp"] },
      { key: "b", label: { en: "B" }, entries: ["s|bp|read"] },
    ], "en");
    expect(layout?.groups).toEqual([{ key: "b", label: "B", indices: [1] }]);
    expect(layout?.ungrouped).toEqual([0, 3, 4, 5]);
  });

  it("[CGR3] no group with an entry on the screen (or no groups) leaves the flat list", () => {
    expect(consentLayout(entries, null, "en")).toBeNull();
    expect(consentLayout(entries, [], "en")).toBeNull();
    expect(consentLayout(entries, [{ key: "x", label: null, entries: ["s|elsewhere"] }], "en")).toBeNull();
  });

  it("[CGR4] legend counts: entries per level, restrictions, required, already allowed, new", () => {
    expect(consentGroupCounts(entries, [1, 3, 5], true)).toEqual({
      total: 3,
      levels: [{ level: "read", count: 2 }, { level: "contribute", count: 1 }],
      restrictions: 0,
      otherFeatures: 0,
      required: 1,
      alreadyAllowed: 1,
      widened: 0,
      fresh: 2,
    });
    expect(consentGroupCounts(entries, [4, 6], true)).toMatchObject({ restrictions: 1, required: 1, alreadyAllowed: 1, fresh: 0 });
    // Without a choice every entry is required: "required" is not stated, "new" still is.
    const locked = consentEntries(permissions, { allowUserChoice: false });
    expect(consentGroupCounts(locked, [1, 3, 5], false)).toMatchObject({ required: null, fresh: 2, alreadyAllowed: 1 });
  });

  it("[CGR8] a held entry asked at a higher level is counted apart; a new mandatory entry is new", () => {
    const more = consentEntries([
      { streamId: "temp", level: "contribute", currentlyGranted: true, currentLevel: "read" }, // widened
      { streamId: "bp", level: "read", currentlyGranted: true, currentLevel: "read" },         // held as shown
      { streamId: "spo2", level: "read", mandatory: true },                                    // new and required
      { feature: "webhooks", setting: "forbidden" },                                           // restriction
    ], { allowUserChoice: true });
    const c = consentGroupCounts(more, [0, 1, 2, 3], true);
    expect(c).toMatchObject({ total: 4, required: 2, alreadyAllowed: 1, widened: 1, fresh: 1, restrictions: 1 });
    expect(c.alreadyAllowed + c.widened + c.fresh + c.restrictions).toBe(c.total);
    const noChoice = consentEntries(more.map((e) => e.permission), { allowUserChoice: false });
    expect(consentGroupCounts(noChoice, [0, 1, 2, 3], false)).toMatchObject({ required: null, alreadyAllowed: 1, widened: 1, fresh: 1 });
  });

  it("[CGR5] the group's box is tri-state over unlocked entries; setting it never changes locked ones", () => {
    const vitals = [1, 3, 5];
    let flags = initialFlags(entries);
    // optIn entries open unticked: the mandatory one does not count.
    expect(groupTickState(entries, vitals, flags)).toBe("unchecked");
    flags = flags.map((f, i) => (i === 3 ? true : f));
    expect(groupTickState(entries, vitals, flags)).toBe("mixed");
    flags = setGroupTicks(entries, flags, vitals, true);
    expect(groupTickState(entries, vitals, flags)).toBe("checked");
    expect(flags).toEqual([true, true, true, true, true, true, true]);
    flags = setGroupTicks(entries, flags, vitals, false);
    expect(groupTickState(entries, vitals, flags)).toBe("unchecked");
    // The locked entry stays granted, entries outside the group are untouched.
    expect(flags).toEqual([true, true, true, false, true, false, true]);
    expect(grantedPermissions(entries, flags).map((p) => permissionKey(p))).toEqual([
      "s|notes|read", "s|bp|read", "f|webhooks|forbidden", "s|steps|read", "f|selfRevoke|forbidden",
    ]);
    // A group of locked entries only has no box.
    expect(groupTickState(entries, [1, 6], flags)).toBeNull();
  });

  it("[CGR6] unticking a group takes held entries away (a narrowing)", () => {
    const flags = setGroupTicks(entries, initialFlags(entries), [4, 6], false);
    expect(flags[4]).toBe(false);
    expect(grantedPermissions(entries, flags).some((p) => "streamId" in p && p.streamId === "steps")).toBe(false);
  });

  it("[CGR7] levellessKey names streams and features without their level or setting", () => {
    expect(levellessKey({ streamId: "a", level: "read" })).toBe("s|a");
    expect(levellessKey({ feature: "webhooks", setting: "forbidden" })).toBe("f|webhooks");
  });
});
