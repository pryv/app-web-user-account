import type { ReactNode } from "react";
import type { PryvConnection } from "../lib/session";

/**
 * Profile extension slot, rendered on the Profile page between the account
 * card and the email card. Renders nothing here; a fork replaces this file to
 * add its own profile sections.
 */
export default function ProfileExtensions(_props: {
  connection: PryvConnection;
  username: string;
}): ReactNode {
  return null;
}
