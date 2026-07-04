import { describe, it, expect } from "vitest";
import { isValidUsername, normalizeUsernameInput } from "./username";
import { resolveUserId } from "./service";

describe("username rules", () => {
  it("accepts valid usernames", () => {
    expect(isValidUsername("bobby")).toBe(true);
    expect(isValidUsername("bob-42")).toBe(true);
    expect(isValidUsername("a".repeat(60))).toBe(true);
  });

  it("rejects uppercase, short, and dash-edged usernames", () => {
    expect(isValidUsername("Bobby")).toBe(false);
    expect(isValidUsername("bob")).toBe(false);
    expect(isValidUsername("-bobby")).toBe(false);
    expect(isValidUsername("bobby-")).toBe(false);
    expect(isValidUsername("a".repeat(61))).toBe(false);
    expect(isValidUsername("bob by")).toBe(false);
  });

  it("normalizes as-you-type input to lowercase without spaces", () => {
    expect(normalizeUsernameInput("Bobby")).toBe("bobby");
    expect(normalizeUsernameInput("Bob By ")).toBe("bobby");
  });
});

describe("resolveUserId", () => {
  it("passes plain usernames through, trimmed and lowercased", async () => {
    await expect(resolveUserId({}, "  Bobby ")).resolves.toBe("bobby");
  });

  it("resolves emails via Service.userIdForEmail", async () => {
    const service = {
      userIdForEmail: async (email: string) =>
        email === "pm@example.com" ? "bobby" : null,
    };
    await expect(resolveUserId(service, "PM@example.com")).resolves.toBe("bobby");
  });

  it("reports an unknown email legibly", async () => {
    const service = { userIdForEmail: async () => null };
    await expect(resolveUserId(service, "no@example.com")).rejects.toThrow(
      /no account found/i,
    );
  });

  it("reports missing platform email-lookup support legibly", async () => {
    await expect(resolveUserId({}, "pm@example.com")).rejects.toThrow(
      /use your username/i,
    );
  });
});
