import { Fragment, type ReactNode } from "react";
import i18n from "../../i18n";

const MARK = "\u0000";

/**
 * Translate `key` and put React nodes where its `{{name}}` placeholders are,
 * e.g. `tNodes("consent.grantHeading", { app: <strong>{name}</strong> })`.
 *
 * The nodes never pass through the translated string: only a marker does,
 * and the string is split on it. Text a requester supplied (an app name, an
 * account) therefore stays plain React text; it is never parsed as markup,
 * which `Trans` would do with interpolated values.
 */
export function tNodes(
  key: string,
  nodes: Record<string, ReactNode>,
  vars: Record<string, unknown> = {},
): ReactNode[] {
  const marks: Record<string, string> = {};
  for (const name of Object.keys(nodes)) marks[name] = MARK + name + MARK;
  const text = i18n.t(key, { ...vars, ...marks });
  return text
    .split(MARK)
    .map((part, i) =>
      i % 2 === 1 && Object.hasOwn(nodes, part) ? <Fragment key={i}>{nodes[part]}</Fragment> : part,
    );
}
