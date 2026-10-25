'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,item,workKey}=require('./helpers/runtime.cjs');
const url=p=>'https://search.shopping.naver.com/search/all?query=test&pagingIndex='+p;
const rows=p=>[1,2,3].map(n=>item({mallSeq:String(p*100+n),nvMid:String(p*1000+n),chnlProdNo:String(p*100+n),storeUrl:'https://smartstore.naver.com/store'+(p*100+n),observedPage:p,searchRequestId:'request-'+p}));
function browser({start=1,failFirst=false,persistent=false,refreshChangesDocument=true}={}){
 return {selected:start,urlPage:start,productPage:start,epoch:100,life:null,clicks:[],reloads:[],collected:[],failFirst,persistent,refreshChangesDocument,counts:{},query:'test'};
}
function attach(e,b){
 e.chrome.tabs.get=async()=>({id:1,status:'complete',url:url(b.urlPage)});
 e.chrome.tabs.reload=async id=>{
  assert.equal(id,1);assert(e.disk[workKey].collection.reloadPlan,'checkpoint must precede reload');
  b.reloads.push(b.urlPage);if(b.refreshChangesDocument){b.epoch++;b.selected=b.urlPage;b.productPage=b.urlPage;b.life=null;}
 };
 e.api.override({
  inspectPriceDocument:async()=>({timeOrigin:b.epoch,origin:'https://search.shopping.naver.com',path:'/search/all',keyword:b.query,page:b.urlPage}),
  inspectPager:async()=>({domCurrent:b.selected,urlPage:b.urlPage,confidence:'high'}),
  inspect:async()=>({url:url(b.urlPage).replace('query=test','query='+b.query),records:rows(b.productPage),lifecycle:b.life,loading:false}),
  clickPage:async(_,p)=>{
   const from=b.selected;b.selected=p;b.clicks.push(p);b.counts[p]=(b.counts[p]||0)+1;
   const fail=b.persistent||(b.failFirst&&b.counts[p]===1),status=fail?418:200;
   if(!fail){b.urlPage=p;b.productPage=p;}
   b.life={fromPage:from,targetPage:p,ageMs:3000,quietMs:2000,organicAdded:fail?0:3,organicRemoved:fail?0:3,productNodesAdded:fail?0:3,productNodesRemoved:fail?0:3,
    requests:[{page:p,path:'/api/search/all',query:'test',state:fail?'http-error':'complete',status}],responses:fail?[]:[{page:p,query:'test',status:200}]};
   return {ok:true,clickedPage:p,navigation:'number'};
  },
  loadScrollPage:async(j,tab,p)=>{
   assert.equal(b.selected,p);assert.equal(b.productPage,p);assert.equal(b.urlPage,p);
   if(b.clicks.length)assert.equal(e.api.state.collection.reloadPlan?.phase,'verified','no collection before reload verification');
   b.collected.push(p);return {products:rows(p),ads:0,scan:{}};
  }
 });
}
async function setup(options={}){
 const e=await runtime(),b=browser(options);attach(e,b);
 const collection={source:'price',mode:'auto',searchUrl:url(options.start||1),from:1,to:3,nextPage:1,keywords:['test'],keywordIndex:0,products:[],catalogProcessed:{},tabId:1,previousSignature:''};
 e.api.setState({running:true,settings:{catalogLookup:false,reloadAfterPageChange:true,ads:'all',grouped:'include'},collection});
 return {e,b,c:collection};
}
test('1-3 pipeline reloads after each successful move before collection and keeps all products',async()=>{
 const {e,b}=await setup();await e.api.runJob(e.api.setJob());
 assert.equal(e.api.state.phase,'완료',e.api.state.stage);assert.deepEqual(b.clicks,[2,3]);assert.deepEqual(b.reloads,[2,3]);assert.deepEqual(b.collected,[1,2,3]);assert.equal(e.api.state.discovered,9);assert.equal(e.api.state.matched.length,9);
 assert.equal(e.api.state.pageReloads.length,2);assert(e.api.state.pageReloads.every(x=>x.reloadCount===1&&x.phase==='verified'));assert.equal(e.api.state.collection,null);
});
test('reported 418 flow reloads the old URL then re-clicks the actual target once for pages 2 and 3',async()=>{
 const {e,b}=await setup({failFirst:true});await e.api.runJob(e.api.setJob());
 assert.equal(e.api.state.phase,'완료',e.api.state.stage);assert.deepEqual(b.clicks,[2,2,3,3]);assert.deepEqual(b.reloads,[1,2]);assert.deepEqual(b.collected,[1,2,3]);assert.equal(e.api.state.discovered,9);
 assert(e.api.state.pageReloads.every(x=>x.reclickIssued&&x.reloadCount===1));assert.equal(e.api.state.pageTransitions.filter(x=>x.result==='request-error').length,2);
});
test('starting on page 3 returns to 1 and reloads it before collecting 1-3',async()=>{
 const {e,b}=await setup({start:3});await e.api.runJob(e.api.setJob());assert.equal(e.api.state.phase,'완료',e.api.state.stage);
 assert.deepEqual(b.clicks,[1,2,3]);assert.deepEqual(b.reloads,[1,2,3]);assert.deepEqual(b.collected,[1,2,3]);
});
test('persistent 418 stops after one reload and one re-click, preserves page 1 and does not repeat after worker restart',async()=>{
 const {e,b,c}=await setup({persistent:true});await e.api.runJob(e.api.setJob());
 assert.equal(e.api.state.phase,'페이지 확인 대기');assert.match(e.api.state.stage,/HTTP 418/);assert.deepEqual(b.clicks,[2,2]);assert.deepEqual(b.reloads,[1]);assert.deepEqual(b.collected,[1]);assert.equal(c.products.length,3);assert.equal(e.requests.length,0);
 const restored=await runtime({disk:e.disk});attach(restored,b);await restored.api.runJob(restored.api.setJob());
 assert.equal(restored.api.state.phase,'페이지 확인 대기');assert.deepEqual(b.clicks,[2,2]);assert.deepEqual(b.reloads,[1]);assert.equal(restored.api.state.collection.products.length,3);assert.equal(restored.requests.length,0);
});
test('manual reload after bounded recovery can resume on actual target without automatic reload/re-click',async()=>{
 const {e,b}=await setup({persistent:true});await e.api.runJob(e.api.setJob());
 b.epoch++;b.selected=2;b.urlPage=2;b.productPage=2;b.life=null;b.persistent=false;
 const restored=await runtime({disk:e.disk});attach(restored,b);await restored.api.runJob(restored.api.setJob());
 assert.equal(restored.api.state.phase,'완료',restored.api.state.stage);assert.deepEqual(b.collected,[1,2,3]);assert.deepEqual(b.clicks,[2,2,3]);assert.deepEqual(b.reloads,[1,3]);
});
test('reload with unchanged document cannot treat old page as refreshed or trigger another reload',async()=>{
 const {e,b}=await setup({refreshChangesDocument:false});await e.api.runJob(e.api.setJob());
 assert.equal(e.api.state.phase,'페이지 확인 대기');assert.match(e.api.state.stage,/새로고침 완료/);assert.deepEqual(b.reloads,[2]);assert.deepEqual(b.collected,[1]);assert.equal(e.requests.length,0);
 const restored=await runtime({disk:e.disk});attach(restored,b);await restored.api.runJob(restored.api.setJob());assert.deepEqual(b.reloads,[2]);assert.deepEqual(b.collected,[1]);
});
test('checkpoint reserved before reload survives interruption and accepts later manual refresh',async()=>{
 const {e,b,c}=await setup();let saved;
 e.chrome.tabs.reload=async()=>{saved=e.disk;throw Error('Synthetic interruption before reload');};await e.api.runJob(e.api.setJob());
 assert.equal(saved[workKey].collection.reloadPlan.phase,'reload-reserved');assert.equal(c.products.length,3);
 b.epoch++;b.life=null;
 const restored=await runtime({disk:saved});attach(restored,b);await restored.api.runJob(restored.api.setJob());
 assert.equal(restored.api.state.phase,'완료',restored.api.state.stage);assert.deepEqual(b.collected,[1,2,3]);assert.deepEqual(b.reloads,[3]);
});
test('wrong keyword after refresh does not navigate or collect',async()=>{
 const {e,b}=await setup(),reload=e.chrome.tabs.reload;e.chrome.tabs.reload=async id=>{await reload(id);b.query='other';};
 await e.api.runJob(e.api.setJob());assert.equal(e.api.state.phase,'페이지 확인 대기');assert.match(e.api.state.stage,/검색어가 달라/);assert.deepEqual(b.collected,[1]);assert.deepEqual(b.clicks,[2]);assert.equal(e.requests.length,0);
});
test('button preparation failure does not trigger reload',async()=>{
 const {e,b}=await setup();e.api.override({clickPage:async()=>({ok:false,reason:'Synthetic covered button'})});
 await e.api.runJob(e.api.setJob());assert.equal(e.api.state.phase,'페이지 확인 대기');assert.deepEqual(b.reloads,[]);assert.deepEqual(b.collected,[1]);
});
test('new automatic jobs enable reload and old saved jobs retain their original behavior',async()=>{
 const e=await runtime();e.api.override({navigatePrice:async()=>{throw Error('Synthetic wait');}});
 await e.send('sb:start',{mode:'auto',from:1,to:3,settings:{}},{tab:{id:1,url:url(1)}});
 for(let n=0;n<100&&e.api.job;n++)await new Promise(r=>setImmediate(r));
 assert.equal(e.api.state.settings.reloadAfterPageChange,true);
 const old=await runtime({disk:{[workKey]:{settings:{catalogLookup:false},collection:{source:'price',mode:'auto',nextPage:2,products:[]}}}});
 assert.equal(old.api.state.settings.reloadAfterPageChange,false);
});
test('stop while reload is in progress preserves collected products and prevents more clicks or lookups',async()=>{
 const {e,b,c}=await setup(),reload=e.chrome.tabs.reload;let j;
 e.chrome.tabs.reload=async id=>{await reload(id);j.cancelled=true;};j=e.api.setJob();await e.api.runJob(j);
 assert.equal(e.api.state.phase,'중단됨');assert.equal(c.products.length,3);assert.deepEqual(b.collected,[1]);assert.deepEqual(b.clicks,[2]);assert.equal(e.requests.length,0);
});
test('new document with old-page product metadata is never collected as target',async()=>{
 const {e,b}=await setup(),reload=e.chrome.tabs.reload;
 e.chrome.tabs.reload=async id=>{await reload(id);b.productPage=1;};await e.api.runJob(e.api.setJob());
 assert.equal(e.api.state.phase,'페이지 확인 대기');assert.match(e.api.state.stage,/실제 페이지 번호·상품 로딩/);assert.deepEqual(b.collected,[1]);assert.deepEqual(b.reloads,[2]);assert.equal(e.requests.length,0);
});
test('restart after re-click reservation does not send an unconfirmed click again',async()=>{
 const {e,b}=await setup({failFirst:true});let saved;
 // Use the shared browser fixture for the initial failed click, interrupt only the reserved recovery click.
 const click=async(_,p)=>{
  if(e.api.state.collection.reloadPlan?.reclickIssued){saved=e.disk;throw Error('Synthetic re-click interruption');}
  const from=b.selected;b.selected=p;b.clicks.push(p);b.counts[p]=1;b.life={fromPage:from,targetPage:p,ageMs:3000,requests:[{page:p,path:'/api/search/all',query:'test',state:'http-error',status:418}]};return {ok:true,clickedPage:p,navigation:'number'};
 };
 e.api.override({clickPage:click});await e.api.runJob(e.api.setJob());assert(saved);assert.equal(saved[workKey].collection.reloadPlan.phase,'reclick-reserved');
 const restored=await runtime({disk:saved});attach(restored,b);await restored.api.runJob(restored.api.setJob());
 assert.equal(restored.api.state.phase,'페이지 확인 대기');assert.deepEqual(b.reloads,[1]);assert.deepEqual(b.clicks,[2]);assert.deepEqual(b.collected,[1]);
});
