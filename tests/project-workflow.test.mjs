import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const productionWorker = readFileSync(new URL("../worker-entry.mjs", import.meta.url), "utf8");

test("exposes one checked Workers release workflow", () => {
  assert.equal(packageJson.name, "minimalism-portfolio");
  assert.match(packageJson.scripts["build:workers"], /DIRECT_WORKERS_DEPLOY=1/);
  assert.match(packageJson.scripts.check, /npm test.*typecheck.*build:workers.*deploy --dry-run/);
  assert.match(packageJson.scripts.deploy, /npm run check.*wrangler deploy --keep-vars/);
});

test("keeps only the daily portfolio snapshot cron", () => {
  assert.match(wrangler, /"crons":\s*\["59 15 \* \* \*"\]/);
  assert.doesNotMatch(productionWorker, /calendar_sync_runs|syncCalendarEvents/);
});

test("does not ship retired market and event routes", () => {
  for (const path of ["../app/api/cn-market/route.ts", "../app/api/events/route.ts", "../app/api/event-candidates/route.ts"]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  }
});
