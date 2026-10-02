import { chromium } from '/Users/domibook/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({serviceWorkers:'block'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const fixtures=[['SPCX','SpaceX',180,150,12,'美股','Hard Tech'],['TSLA','Tesla',250,190,6,'美股','Hard Tech'],['RKLB','Rocket Lab',30,20,40,'美股','Hard Tech'],['BKSY','BlackSky',22,24,10,'美股'],['BTC','Bitcoin',70000,62000,.01,'加密货币'],['CRCL','Circle',100,120,5,'美股'],['159696','易方达纳指ETF',2.04,1.8,6000,'美股指数','NDX'],['601985','中国核电',9,8.59,800,'A股','周期轮动'],['CNY','人民币',1,1,4000,'现金/类现金'],['USDT','USDT',1,1,600,'现金/类现金'],['OKLO','Oklo',20,18,4,'美股','Satellite']];
let state={holdings:fixtures.map(([symbol,name,price,avgCost,quantity,category,strategy])=>({symbol,name,price,avgCost,quantity,category,strategy,market:category==='现金/类现金'?'现金':category==='A股'||category==='美股指数'?'A股':category==='加密货币'?'加密货币':'美股',currency:['601985','159696','CNY'].includes(symbol)?'¥':'$',change:1.2,value:price*quantity,cost:avgCost*quantity,spark:[],holdingDays:20})),useDemoHoldings:false,profile:{name:'预览测试'},longTermStart:'2026-08-15'};
const snapshots=Array.from({length:120},(_,i)=>{const date=new Date();date.setDate(date.getDate()-120+i);const value=40000+i*40+Math.sin(i/9)*600;return {date:date.toISOString().slice(0,10),value,cost:39500,returnRate:(value-39500)/39500*100};});
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url()); let body={};
 if(url.pathname==='/api/device-session') body={authorized:true,source:'device',trusted:true};
 if(url.pathname==='/api/portfolio') {if(route.request().method()==='PUT')state=route.request().postDataJSON();body={state,snapshots};}
 if(url.pathname==='/api/assets') body={quotes:Object.fromEntries((url.searchParams.get('codes')||'').split(',').map(symbol=>{const h=state.holdings.find(h=>h.symbol===symbol);return [symbol,{...h,provider:'test',asOf:new Date().toISOString()}];}))};
 await route.fulfill({json:body});
});
await page.goto(process.env.TEST_URL||'http://localhost:8814');
await page.locator('.portfolio-summary').waitFor();
await page.waitForTimeout(1000);
assert.equal(await page.locator('.balance-kpis>div').count(),2);
assert.equal(await page.locator('.portfolio-summary .chart-y').count(),0);
assert.equal(await page.locator('.allocation-view-switch').count(),0);
assert.doesNotMatch(await page.locator('.strategy-allocation').innerText(),/目标|高于|低于|Satellite|Hard Tech/);
assert.equal(await page.locator('.strategy-row').count(),6);
for(const width of [375,390,430,768,1024,1440]){
 await page.setViewportSize({width,height:1000});
 await page.evaluate(()=>scrollTo(0,0));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);
 assert.equal(await page.getByRole('button',{name:'偏好设置',exact:true}).count(),0);
 if(width<=430){
   const header=await page.locator('.topbar').boundingBox();
   const summary=await page.locator('.portfolio-summary').boundingBox();
   assert.ok(header.height<65,`compact brand header ${width}: ${header.height}`);
   assert.ok(summary.height<440,`compact summary ${width}: ${summary.height}`);
   console.log('mobile heights',width,header.height,summary.height);
 }
 await page.locator('.portfolio-summary').screenshot({path:`/tmp/compact-summary-${width}.png`});
 await page.screenshot({path:`/tmp/portfolio-home-${width}.png`,fullPage:true});
 if(width>=1024){const a=await page.locator('.portfolio-balance').boundingBox(),b=await page.locator('.portfolio-preview').boundingBox();assert.ok(b.x>a.x+a.width);assert.ok(Math.abs(a.y-b.y)<2);}
 await page.getByRole('button',{name:'资产分析',exact:false}).click();
 const modal=page.getByRole('dialog',{name:'资产分析',exact:true});await modal.waitFor();
 assert.equal(await modal.locator('.analysis-modes button').count(),4);
 for(const name of ['收益率','收益','市值','投入本金']){await modal.getByRole('group',{name:'分析指标'}).getByRole('button',{name,exact:true}).click();assert.equal(await modal.locator('.performance-chart').count(),1);}
 await modal.getByRole('button',{name:'1月',exact:true}).click();
 const monthText=await modal.locator('footer').innerText();
 await modal.getByRole('button',{name:'6月',exact:true}).click();assert.notEqual(await modal.locator('footer').innerText(),monthText);
 await modal.getByRole('button',{name:'自定义',exact:true}).click();
 await modal.getByLabel('开始日期').fill('2020-01-01');await modal.getByLabel('结束日期').fill('2020-02-01');assert.equal(await modal.getByText('这段时间还没有资产记录，请选择其他日期。').count(),1);
 await modal.getByLabel('开始日期').fill('2026-01-01');assert.equal(await modal.getByRole('alert').count(),1);
 await modal.getByRole('button',{name:'1年',exact:true}).click();
 await modal.screenshot({path:`/tmp/portfolio-analysis-${width}.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`dialog overflow ${width}`);
 await page.keyboard.press('Escape');assert.equal(await modal.count(),0);
}
await page.setViewportSize({width:390,height:844});
const basis=page.getByRole('group',{name:'投资方向统计口径'});
const valueText=await page.locator('.strategy-rows').innerText();await basis.getByRole('button',{name:'成本',exact:true}).click();assert.notEqual(await page.locator('.strategy-rows').innerText(),valueText);await basis.getByRole('button',{name:'市值',exact:true}).click();
for(const name of ['AI Infrastructure','Space','Crypto','US Index','A','Cash']){
 await page.locator('.strategy-row').filter({has:page.locator('.strategy-name',{hasText:new RegExp(`^${name}$`)})}).click();
 const dialog=page.getByRole('dialog',{name:`${name} 持仓详情`});await dialog.waitFor();
 assert.doesNotMatch(await dialog.innerText(),/目标/);
 await page.getByRole('button',{name:`关闭 ${name} 详情`}).click();
}
const first=page.locator('.holding-card-toggle').first();await first.click();assert.equal(await first.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('.holding-card-details').count(),1);
await page.getByLabel('持仓排序',{exact:true}).selectOption('return');const desc=await page.locator('.holding-card-toggle').first().innerText();await page.getByRole('button',{name:'切换为升序'}).click();assert.notEqual(await page.locator('.holding-card-toggle').first().innerText(),desc);
await page.getByRole('button',{name:'管理持仓',exact:true}).click();await page.locator('.holding-picker button').filter({hasText:'Oklo'}).click();await page.getByLabel('策略仓位',{exact:true}).selectOption('AI Infrastructure');await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hengce-custom-holdings')).find(h=>h.symbol==='OKLO').strategy),'AI Infrastructure');
assert.deepEqual(errors,[]);
console.log('Six viewports, allocation, date filters, expansion, sorting, and strategy persistence passed');
await browser.close();
