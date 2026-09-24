import type { ReactNode } from "react";
import PryvLogo from "./components/PryvLogo";

/**
 * Branding seam. An operator (or a fork) rebrands the app by replacing this
 * file and `brand.css` (fonts), instead of editing the layout and route copy.
 */
export const brand = {
  /** Product name, as shown in copy. */
  productName: "Pryv",
  /** What the user holds on this platform, as shown in copy ("your ... "). */
  accountNoun: "Pryv account",
} as const;

/** The logo shown in the app header. */
export function Logo(props: { className?: string }): ReactNode {
  return <PryvLogo className={props.className} />;
}
