/**
 * Username rules, mirroring the server's registration schema:
 * 5–60 characters, lowercase letters / digits / dashes, starting and
 * ending with a letter or digit.
 */
export const USERNAME_RULES =
  "5–60 characters: lowercase letters, digits and dashes (must start and end with a letter or digit).";

const USERNAME_REGEXP = /^[a-z0-9][a-z0-9-]{3,58}[a-z0-9]$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEXP.test(username);
}

/** Normalise as-you-type input: usernames are lowercase-only, no spaces. */
export function normalizeUsernameInput(input: string): string {
  return input.toLowerCase().replace(/\s+/g, "");
}
