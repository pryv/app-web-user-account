// Materialize each SPA route so plain static servers (no history-API
// fallback) resolve deep links like /auth?poll=…
// Default: dist/<route>/index.html (`npm run webserver`, local backloop.dev).
// With --html-files: dist/<route>.html, for servers with GitHub Pages
// semantics (an open-pryv.io hosted site serving `build:root`): `/auth`
// then answers 200 from auth.html, with no redirect to `/auth/`. The
// /account shell keeps account/index.html, since the tabs need the folder.
// GitHub Pages itself relies on the 404.html copy in build:pages.
import { cpSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const index = join(dist, "index.html");
if (!existsSync(index)) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

// Route list shared with the app (src/routes.json): top-level paths, then
// the /account shell and each account tab under it.
const routeTable = JSON.parse(readFileSync(join(root, "src", "routes.json"), "utf8"));
const routes = [
  ...routeTable.static,
  "account",
  ...routeTable.account.map((tab) => `account/${tab}`),
];

const htmlFiles = process.argv.includes("--html-files");
for (const route of routes) {
  const target = htmlFiles && route !== "account"
    ? join(dist, `${route}.html`)
    : join(dist, route, "index.html");
  mkdirSync(dirname(target), { recursive: true });
  cpSync(index, target);
}
// Routes with a dynamic segment (/account/audit-access/:accessId) cannot be
// listed in routes.json: they are served by 404.html, the same fallback GitHub Pages
// uses (build:pages) and that backloop.dev serves for any unknown path. The
// body is the app, which routes on the URL; the HTTP status stays 404.
cpSync(index, join(dist, "404.html"));
console.log(`SPA fallback: ${routes.length} route copies of index.html + 404.html in dist/`);
