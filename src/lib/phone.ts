/**
 * Phone numbers as the platform accepts them for SMS MFA: E.164, a `+`, the
 * country code and the number, digits only (e.g. +41791234567).
 *
 * What people type often carries spaces, dashes, dots, slashes or brackets,
 * or a `00` international prefix: those are removed or turned into `+`. Any
 * other character, or a number that is still not E.164, gives null.
 */
const E164 = /^\+[1-9][0-9]{6,14}$/;

export function normalisePhone(input: string): string | null {
  let value = input.trim().replace(/[\s\-./()]/g, "");
  if (value.startsWith("00")) value = "+" + value.slice(2);
  return E164.test(value) ? value : null;
}
