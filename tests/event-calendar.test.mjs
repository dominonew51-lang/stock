import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/page.tsx", "utf8");
const schema = fs.readFileSync("db/schema.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");

test("美股页面使用关键事件日历并提供两种视图", () => {
  assert.match(page, /EventCalendarPage/);
  assert.match(page, /月历/);
  assert.match(page, /时间线/);
  assert.match(page, /待确认/);
  assert.doesNotMatch(page.slice(page.indexOf("function USMarketPage"), page.indexOf("function BottomNavigation")), /USQuoteMatrix/);
});

test("事件日历覆盖三大产业与六类事件", () => {
  assert.match(page, /太空/);
  assert.match(page, /AI/);
  assert.match(page, /链/);
  for (const type of ["解禁", "重大发射", "重要建设", "会议", "发布会", "法案"]) assert.match(page, new RegExp(type));
});

test("事件接口、候选箱和持久化表已定义", () => {
  assert.ok(fs.existsSync("app/api/events/route.ts"));
  assert.ok(fs.existsSync("app/api/event-candidates/route.ts"));
  assert.match(schema, /calendarEvents/);
  assert.match(schema, /eventCandidates/);
});

test("事件同步拥有两次日常定时任务", () => {
  assert.match(wrangler, /"15 0 \* \* \*"/);
  assert.match(wrangler, /"15 12 \* \* \*"/);
  assert.match(fs.readFileSync("worker/index.ts", "utf8"), /syncCalendarEvents/);
});

test("比例模块使用海外国内双层结构并覆盖现金与QDII", () => {
  assert.match(page, /allocation-double-pie/);
  assert.match(page, /美股个股/);
  assert.match(page, /稳定币/);
  assert.match(page, /美元现金/);
  assert.match(page, /美股指数（QDII）/);
  assert.match(page, /人民币现金/);
  assert.match(page, /allocationClass/);
});
