import { describe, it, expect } from "vitest";
import { hasUsableEmail, readsAccountEmail, missingEmailErrorKey } from "./accountEmail";
import type { OfferPermission } from "./consent";

const perms = (...p: unknown[]) => p as OfferPermission[];

describe("[AEML] account email helpers", () => {
  it("[AEM1] a usable address: present, not empty, not the one invented at registration", () => {
    expect(hasUsableEmail({ email: "alice@example.com" })).toBe(true);
    for (const email of [null, undefined, "", "   "]) expect(hasUsableEmail({ email })).toBe(false);
    expect(hasUsableEmail(null)).toBe(false);
    expect(hasUsableEmail({ email: "a1b2c3d4e5f6g7h8i9j0@pryv.io" })).toBe(false);
    expect(hasUsableEmail({ email: "A1B2C3D4E5F6G7H8I9J0@PRYV.IO" })).toBe(false);
    expect(hasUsableEmail({ email: " a1b2c3d4e5f6g7h8i9j0@pryv.io " })).toBe(false);
    // Another length, or another domain: a real address.
    expect(hasUsableEmail({ email: "a1b2c3d4e5f6g7h8i9j@pryv.io" })).toBe(true);
    expect(hasUsableEmail({ email: "a1b2c3d4e5f6g7h8i9j0k@pryv.io" })).toBe(true);
    expect(hasUsableEmail({ email: "a1b2c3d4e5f6g7h8i9j0@example.com" })).toBe(true);
  });

  it("[AEM2] the permissions that read the account's email", () => {
    for (const level of ["read", "contribute", "manage"]) {
      expect(readsAccountEmail(perms({ streamId: ":system:email", level }))).toBe(true);
    }
    expect(readsAccountEmail(perms({ streamId: ":system:email", level: "none" }))).toBe(false);
    expect(readsAccountEmail(perms({ streamId: ":_system:account", level: "read" }))).toBe(true);
    expect(readsAccountEmail(perms({ streamId: ":_system:account", level: "none" }))).toBe(false);
    expect(readsAccountEmail(perms({ streamId: "*", level: "manage" }))).toBe(false);
    expect(readsAccountEmail(perms({ streamId: "diary", level: "read" }))).toBe(false);
    expect(readsAccountEmail(perms({ streamId: "email", level: "read" }))).toBe(false);
    expect(readsAccountEmail(perms({ feature: "selfRevoke", setting: "forbidden" }))).toBe(false);
    expect(readsAccountEmail(perms())).toBe(false);
    expect(readsAccountEmail(null)).toBe(false);
    expect(readsAccountEmail(perms({ streamId: "diary", level: "read" }, { streamId: ":system:email", level: "read" }))).toBe(true);
  });

  it("[AEM3] a failed add: the address is taken, or anything else", () => {
    const apiError = (id: string) =>
      Object.assign(new Error("API error"), { innerObject: { id, message: "m" } });
    expect(missingEmailErrorKey(apiError("item-already-exists"))).toBe("consent.emailTaken");
    expect(missingEmailErrorKey(Object.assign(new Error("x"), { id: "item-already-exists" }))).toBe("consent.emailTaken");
    expect(missingEmailErrorKey(apiError("invalid-parameters-format"))).toBe("consent.emailAddFailed");
    expect(missingEmailErrorKey(new TypeError("Failed to fetch"))).toBe("consent.emailAddFailed");
  });
});
