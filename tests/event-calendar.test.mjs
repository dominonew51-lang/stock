import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const worker = readFileSync(new URL("../worker-entry.mjs", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("keeps the retired event calendar out of the current product", () => {
  assert.doesNotMatch(page, /EventCalendarPage|ManualEventForm|ReturnCalendar/);
  assert.doesNotMatch(worker, /calendar_sync_runs|syncCalendarEvents/);
  assert.match(wrangler, /"crons":\s*\["59 15 \* \* \*"\]/);
});

test("keeps retired event endpoints out of the route tree", () => {
  for (const path of ["../app/api/events/route.ts", "../app/api/event-candidates/route.ts"]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  }
});
