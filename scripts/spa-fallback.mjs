// Materialize each SPA route as dist/<route>/index.html so plain static
// servers (no history-API fallback) resolve deep links like /auth?poll=…
// GitHub Pages gets the same effect from the 404.html copy in build:pages;
// this covers `npm run webserver` (local backloop.dev serving).
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const index = join(dist, "index.html");
if (!existsSync(index)) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

const routes = [
  "signin",
  "sso-signin",
  "register",
  "reset-password",
  "verify-email",
  "change-password",
  "mfa-challenge",
  "cmc-accept",
  "cmc/approve",
  "cmc-scope-update",
  "auth",
  "oauth2-authorize",
  "account",
  "account/profile",
  "account/security",
  "account/apps",
  "account/data",
  "account/delegation",
];

for (const route of routes) {
  const dir = join(dist, route);
  mkdirSync(dir, { recursive: true });
  cpSync(index, join(dir, "index.html"));
}
// Routes with a dynamic segment (/account/audit-access/:accessId) cannot be
// listed above: they are served by 404.html, the same fallback GitHub Pages
// uses (build:pages) and that backloop.dev serves for any unknown path. The
// body is the app, which routes on the URL; the HTTP status stays 404.
cpSync(index, join(dist, "404.html"));
console.log(`SPA fallback: ${routes.length} route copies of index.html + 404.html in dist/`);
