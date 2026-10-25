'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,item}=require('./helpers/runtime.cjs');
const url='https://search.shopping.naver.com/search/all?query=test';
const rows=p=>[1,2,3].map(n=>item({mallSeq:String(100+n),nvMid:String(1000+n),chnlProdNo:String(111+n),observedPage:p,searchRequestId:'same'}));
const req=(status=418,extra={})=>({page:2,path:'/api/search/all',query:'test',transport:'xhr',state:status>=400?'http-error':'complete',status,...extra});
const listing=(p,requests=[])=>({url,records:rows(p),lifecycle:{fromPage:1,targetPage:2,ageMs:3000,quietMs:3000,organicAdded:0,organicRemoved:0,productNodesAdded:0,productNodesRemoved:0,requests,responses:[]},scrollY:300,viewHeight:700,scrollHeight:1000});
const collection=()=>({source:'price',mode:'auto',from:1,to:3,nextPage:2,keywords:['test'],keywordIndex:0,products:rows(1),catalogProcessed:{},tabId:1});
for(const status of [418,403,429,500])test(`HTTP ${status} stops at the first observed failure without recovery clicks or collection scroll`,async()=>{
 let ms=0,page=1;const e=await runtime({onPause:n=>ms+=n}),c=collection(),clicks=[],scrolls=[];
 e.api.setState({running:true,collection:c});
 e.api.override({inspect:async()=>listing(page,page===2?[req(status)]:[]),inspectPager:async()=>({domCurrent:page,urlPage:1}),scrollFooter:async()=>scrolls.push('before-click-footer'),scrollTop:async()=>scrolls.push('top'),scroll:async()=>scrolls.push('down'),clickPage:async(_,p)=>{page=p;clicks.push(p);return {ok:true,clickedPage:p};}});
 await e.api.runJob(e.api.setJob());
 assert.deepEqual(clicks,[2]);assert.deepEqual(scrolls,[]);assert(ms<2500);
 assert.equal(e.api.state.phase,'페이지 확인 대기');assert.match(e.api.state.stage,new RegExp('HTTP '+status));assert.equal(c.nextPage,2);assert.equal(c.keywordIndex,0);assert.equal(c.products.length,3);
 assert.equal(c.pageWait.requestFailure.status,status);assert.equal(e.requests.length,0);assert.equal(e.api.state.pageTransitions[0].result,'request-error');
});
test('HTTP error is diagnosed even if the target product list is empty',async()=>{
 const e=await runtime(),data={...listing(2,[req()]),records:[]};
 e.api.override({inspect:async()=>data,inspectPager:async()=>({domCurrent:2})});
 await assert.rejects(()=>e.api.waitForPricePageChange(e.api.setJob(),1,2,e.api.pageEvidence(listing(1)),1),/HTTP 418/);
});
test('stale 418 followed by a fresh successful response can resume with target-page proof',async()=>{
 const e=await runtime(),data=listing(2,[req(),req(200)]);data.lifecycle.responses=[{page:2,query:'test',status:200}];
 e.api.override({inspect:async()=>data,inspectPager:async()=>({domCurrent:2,urlPage:1})});
 assert.equal((await e.api.waitForPricePageChange(e.api.setJob(),1,2,e.api.pageEvidence(listing(1)),1)).actual,2);
});
test('unrelated query/page/endpoint errors do not stop a proven target response',async()=>{
 const e=await runtime(),data=listing(2,[req(418,{query:'other'}),req(418,{page:1}),req(418,{path:'/api/search/aside'})]);data.lifecycle.responses=[{page:2,query:'test',status:200}];
 e.api.override({inspect:async()=>data,inspectPager:async()=>({domCurrent:2,urlPage:1})});
 assert.equal((await e.api.waitForPricePageChange(e.api.setJob(),1,2,e.api.pageEvidence(listing(1)),1)).actual,2);
});
for(const [name,page,data] of [['wrong selected page',1,listing(2)],['old product metadata',2,listing(1)],['loading',2,{...listing(2),loading:true}],['empty products',2,{...listing(2),records:[]}]])test('collection does not scroll before validation: '+name,async()=>{
 const e=await runtime(),scrolls=[];
 e.api.override({inspect:async()=>data,inspectPager:async()=>({domCurrent:page}),scrollTop:async()=>scrolls.push('top'),scroll:async()=>scrolls.push('down')});
 await assert.rejects(()=>e.api.loadScrollPage(e.api.setJob(),1,2),/스크롤/);assert.deepEqual(scrolls,[]);
});
test('verified page is checked before top reset and every downward collection step',async()=>{
 const e=await runtime(),events=[];e.api.override({inspect:async()=>{events.push('products');return listing(2);},inspectPager:async()=>{events.push('page');return {domCurrent:2};},scrollTop:async()=>events.push('top'),scroll:async()=>events.push('down')});
 const result=await e.api.loadScrollPage(e.api.setJob(),1,2);assert.equal(result.products.length,3);assert.deepEqual(events.slice(0,3),['products','page','top']);
 for(let n=0;n<events.length;n++)if(events[n]==='down')assert.deepEqual(events.slice(n-2,n),['products','page']);
});
test('a page change during collection stops before another downward scroll',async()=>{
 const e=await runtime(),events=[];let reads=0;e.api.override({inspect:async()=>listing(2),inspectPager:async()=>({domCurrent:++reads<3?2:3}),scrollTop:async()=>events.push('top'),scroll:async()=>events.push('down')});
 await assert.rejects(()=>e.api.loadScrollPage(e.api.setJob(),1,2),/현재 번호 3/);assert.deepEqual(events,['top','down']);
});
test('repeated unverified products enter wait without automatic rescrolling',async()=>{
 const e=await runtime(),c=collection(),items=rows(2);c.previousSignature=items.map(x=>x.mallSeq+':'+x.nvMid).sort().join('|');e.api.setState({collection:c});let scans=0;
 e.api.override({navigatePrice:async()=>{},loadScrollPage:async()=>{scans++;return {products:items};},scrollTop:async()=>{throw Error('Unexpected retry scroll');}});
 await assert.rejects(()=>e.api.collectPrice(e.api.setJob(),c,'test'),error=>error.code==='PAGE_WAIT'&&/이전 페이지와 같습니다/.test(error.message));assert.equal(scans,1);
});
