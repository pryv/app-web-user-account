import type { CatalogIcon } from "../lib/appCatalog";

/**
 * A requesting app's icon on a consent screen.
 *
 * The descriptor comes from the operator-curated catalog, never from the
 * requesting app, and `lib/appCatalog.ts` has already restricted it to an
 * emoji, an http(s) URL or a raster image data URL.
 *
 * `alt=""` throughout: the app's name sits next to the icon in every caller,
 * so announcing the image would just repeat it.
 */
export function AppIcon({ icon, size = "md" }: { icon: CatalogIcon | null; size?: "md" | "sm" }) {
  if (icon == null) return null;
  if (icon.type === "emoji") {
    return (
      <span className={size === "sm" ? "text-base leading-5" : "text-2xl"} aria-hidden>
        {icon.value}
      </span>
    );
  }
  return (
    <img
      src={icon.value}
      alt=""
      referrerPolicy="no-referrer"
      className={`${size === "sm" ? "h-5 w-5 rounded" : "h-8 w-8 rounded-md"} object-cover`}
    />
  );
}
