#!/usr/bin/env node
// Refuse to build a published bundle against a node_modules that does not
// match the lockfile (a missing, extra or wrong-version runtime dependency).
// Such a build can succeed and still ship a page that fails at load time.
import { execFileSync } from "node:child_process";

let report;
try {
  report = execFileSync("npm", ["ls", "--omit=dev", "--depth=0", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch (err) {
  // npm ls exits non-zero when it finds problems; the JSON is still on stdout.
  report = err.stdout;
}

let problems = [];
try {
  problems = JSON.parse(report || "{}").problems ?? [];
} catch {
  problems = ["could not read the output of npm ls"];
}

if (problems.length > 0) {
  console.error("node_modules does not match package-lock.json:");
  for (const p of problems) console.error("  " + p);
  console.error("Run `npm ci` and build again.");
  process.exit(1);
}
