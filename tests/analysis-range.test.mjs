import test from 'node:test';
import assert from 'node:assert/strict';
import {filterAnalysisDates} from '../app/analysis-range.ts';
const records=['2021-10-01','2023-10-01','2025-10-01','2026-04-01','2026-09-01','2026-10-01'].map(date=>({date}));
test('analysis ranges select real snapshots without inserting synthetic history',()=>{
  for(const [range,count] of [['1月',2],['6月',3],['1年',4],['3年',5],['5年',6],['全部',6]]) assert.equal(filterAnalysisDates(records,range,'2026-10-01').length,count);
  assert.deepEqual(filterAnalysisDates(records,'自定义','2026-10-01','2026-04-01','2026-09-01').map(r=>r.date),['2026-04-01','2026-09-01']);
  assert.deepEqual(filterAnalysisDates(records,'自定义','2026-10-01','2026-09-01','2026-04-01'),[]);
  assert.deepEqual(filterAnalysisDates([], '全部','2026-10-01'),[]);
});
test('month ends and leap days are bounded in UTC',()=>{
  const days=['2024-02-28','2024-02-29','2024-03-31'].map(date=>({date}));
  assert.deepEqual(filterAnalysisDates(days,'1月','2024-03-31').map(r=>r.date),['2024-02-29','2024-03-31']);
});
