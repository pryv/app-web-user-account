import { describe, it, expect } from "vitest";
import { normalisePhone } from "./phone";

describe("[PHNE] SMS phone numbers in E.164", () => {
  it("[PHNE1] removes separators and turns a 00 prefix into +", () => {
    expect(normalisePhone("+41791234567")).toBe("+41791234567");
    expect(normalisePhone(" +41 79 123 45 67 ")).toBe("+41791234567");
    expect(normalisePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalisePhone("0041.79/123.45.67")).toBe("+41791234567");
  });

  it("[PHNE2] refuses what is not an international number", () => {
    for (const input of ["", "079 123 45 67", "+0791234567", "+41 79 abc", "+12345", "+1234567890123456", "41791234567"]) {
      expect(normalisePhone(input)).toBeNull();
    }
  });
});
