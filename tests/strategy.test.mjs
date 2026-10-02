import test from 'node:test';
import assert from 'node:assert/strict';
import * as strategy from '../app/strategy.ts';
const { resolveStrategy, strategyAllocation, strategies } = strategy;
test('strategy suggestions, overrides and unknown holdings',()=>{
  for(const [symbol,expected] of [['RKLB','Space'],['TSLA','AI Infrastructure'],['SPCX','AI Infrastructure'],['BTC','Crypto'],['ETH','Crypto'],['COIN','Crypto'],['CRCL','Crypto'],['BKSY','Space'],['OKLO',undefined],['CRSP',undefined],['159696','US Index'],['601985','A']]) assert.equal(resolveStrategy({symbol}),expected);
  assert.equal(resolveStrategy({symbol:'fund',category:'红利'}),'A');
  assert.equal(resolveStrategy({symbol:'fund',name:'南方科创50'}),'A');
  assert.equal(resolveStrategy({symbol:'UNKNOWN'}),undefined);
  assert.equal(resolveStrategy({symbol:'TSLA',strategy:'Space'}),'Space');
  for(const symbol of ['CNY','RMB','人民币','USD','美元','USDT','TETHER']) assert.equal(resolveStrategy({symbol,strategy:'Crypto'}),'Cash');
});
test('cash is the sixth strategy while unknown amounts stay outside the denominator',()=>{
  const holdings=JSON.parse(JSON.stringify([{symbol:'TSLA',value:250},{symbol:'BTC',value:150},{symbol:'QQQ',value:300},{symbol:'601985',value:150},{symbol:'CUSTOM',value:50,strategy:'Space'},{symbol:'USDT',value:40},{symbol:'USD',value:20},{symbol:'CNY',value:40},{symbol:'UNKNOWN',value:99}]));
  const result=strategyAllocation(holdings);
  assert.equal(result.invested,1000);
  assert.deepEqual(result.rows.map(r=>r.percent),[25,5,15,30,15,10]);
  assert.deepEqual(result.rows.map(r=>r.strategy),['AI Infrastructure','Space','Crypto','US Index','A','Cash']);
  assert.equal(result.unclassified,99);
  assert.equal(result.unclassifiedCount,1);
  assert.equal(result.rows.reduce((sum,row)=>sum+row.percent,0),100);
  assert.equal(strategyAllocation([]).invested,0);
  assert.equal(strategyAllocation([{symbol:'BTC',value:100}]).rows[2].percent,100);
  assert.equal(strategyAllocation([{symbol:'USDT',value:100}]).rows[5].percent,100);
});
test('cost allocation includes cash and excludes unknown assets without converting currency twice',()=>{
  const result=strategyAllocation([{symbol:'TSLA',value:300,cost:100},{symbol:'BTC',value:100,cost:200},{symbol:'USD',value:100,cost:100},{symbol:'UNKNOWN',value:999,cost:999}]);
  assert.equal(result.totalCost,400);
  assert.equal(result.rows[0].costPercent,25);
  assert.equal(result.rows[2].costPercent,50);
  assert.equal(result.rows[5].costPercent,25);
  assert.equal(result.rows.reduce((sum,row)=>sum+row.costPercent,0),100);
  assert.equal(result.rows[0].percent,60);
  for(const row of strategyAllocation([{symbol:'BTC',value:100,cost:0}]).rows) assert.equal(row.costPercent,0);
});
test('legacy strategies map safely and removed satellites remain unclassified',()=>{
  assert.equal(resolveStrategy({symbol:'TSLA',strategy:'Hard Tech'}),'AI Infrastructure');
  assert.equal(resolveStrategy({symbol:'RKLB',strategy:'Hard Tech'}),'Space');
  assert.equal(resolveStrategy({symbol:'fund',strategy:'NDX'}),'US Index');
  assert.equal(resolveStrategy({symbol:'gold',strategy:'周期轮动'}),'A');
  assert.equal(resolveStrategy({symbol:'OKLO',strategy:'Satellite'}),undefined);
});
test('allocation exposes no targets or deviation recommendations',()=>{
  assert.equal('strategyTargets' in strategy,false);
  assert.equal(strategyAllocation([{symbol:'BTC',value:100}]).rows.some(row=>'target' in row),false);
});
test('holding heatmap uses reference red, emerald, and neutral color ramps',()=>{
  assert.equal(typeof strategy.holdingHeatmapColor,'function');
  assert.equal(strategy.holdingHeatmapColor(0),'#64748B');
  assert.equal(strategy.holdingHeatmapColor(100),'#B91C1C');
  assert.equal(strategy.holdingHeatmapColor(-100),'#047857');
});
