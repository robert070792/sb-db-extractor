'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {runtime,item,workKey}=require('./helpers/runtime.cjs');
const url='https://search.shopping.naver.com/search/all?query=test';
const rows=(p,old=false)=>[1,2,3].map(n=>item({mallSeq:String(100+n+(old?0:p*10)),nvMid:String(1000+n+(old?0:p*10)),chnlProdNo:String(111+n+(old?0:p*10)),storeUrl:'https://smartstore.naver.com/store'+(100+n+(old?0:p*10)),observedPage:p,searchRequestId:'same',page:p}));
const listing=(p,old=false)=>({url,records:rows(p,old),lifecycle:null});
const collection=extra=>({source:'price',mode:'auto',searchUrl:url,from:1,to:3,nextPage:2,keywords:['test','later'],keywordIndex:0,previousSignature:'',products:rows(1,true),catalogProcessed:{},tabId:1,...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(e){for(let n=0;n<100&&e.api.job;n++)await tick();assert.equal(e.api.job,null,'job did not settle');}
function blocked(e){
 let page=1;
 e.api.override({inspect:async()=>listing(page,true),inspectPager:async()=>({domCurrent:page,urlPage:1,confidence:'high'}),scrollFooter:async()=>{},scrollTop:async()=>{throw Error('Unexpected forced top scroll');},clickPage:async(_,p)=>{page=p;return {ok:true,clickedPage:p,navigation:'number'};}});
}
test('failed page 2 leaves page 1, range and keyword checkpoint intact and makes no business calls',async()=>{
 const e=await runtime(),c=collection();e.api.setState({running:true,collection:c});blocked(e);
 await e.api.runJob(e.api.setJob());
 const s=e.api.state;assert.equal(s.phase,'페이지 확인 대기');assert.equal(s.paused,true);assert.equal(s.running,false);assert.equal(s.finishedAt,0);
 assert.equal(c.nextPage,2);assert.equal(c.keywordIndex,0);assert.equal(c.products.length,3);assert.equal(c.pageWait.fromPage,1);assert(c.pageWait.beforeEvidence.signature);
 assert.equal(s.pending.length,0);assert.equal(e.requests.length,0);assert.equal(s.pageStats.length,0);assert.equal(s.incompletePages.length,1);
 assert.equal(e.disk[workKey].collection.pageWait.page,2);
});
test('first-page navigation failure also enters resumable wait with diagnostic state',async()=>{
 const e=await runtime(),c=collection({from:2,nextPage:2,products:[]});e.api.setState({running:true,collection:c});blocked(e);
 await e.api.runJob(e.api.setJob());assert.equal(e.api.state.phase,'페이지 확인 대기');assert.equal(c.products.length,0);assert.equal(e.requests.length,0);
});
test('same page number and retagged old products cannot bypass wait after worker restart',async()=>{
 const e=await runtime(),c=collection();e.api.setState({running:true,collection:c});blocked(e);await e.api.runJob(e.api.setJob());
 const restored=await runtime({disk:e.disk});let clicks=0,scrolls=0;
 restored.api.override({inspect:async()=>listing(2,true),inspectPager:async()=>({domCurrent:2,urlPage:1}),clickPage:async()=>{clicks++;},scrollTop:async()=>{scrolls++;}});
 assert.equal((await restored.send('sb:resume',{}, {tab:{id:1}})).ok,true);await settled(restored);
 assert.equal(restored.api.state.phase,'페이지 확인 대기');assert.equal(restored.api.state.collection.nextPage,2);assert.equal(restored.api.state.collection.keywordIndex,0);
 assert.equal(restored.api.state.incompletePages.length,1);assert.equal(clicks,0);assert.equal(scrolls,0);assert.equal(restored.requests.length,0);
});
test('manual target-page refresh resumes page 2 then page 3 exactly once before lookup',async()=>{
 const e=await runtime(),c=collection({keywords:['test']});e.api.setState({running:true,collection:c,settings:{ads:'all',grouped:'include'}});blocked(e);await e.api.runJob(e.api.setJob());
 const restored=await runtime({disk:e.disk}),collected=[],clicks=[];let page=2,verifiedTopCalls=0;
 restored.api.override({inspect:async()=>listing(page),inspectPager:async()=>({domCurrent:page,urlPage:1,confidence:'high'}),scrollFooter:async()=>{},scrollTop:async()=>{verifiedTopCalls++;},
  clickPage:async(_,p)=>{clicks.push(p);page=p;return {ok:true,clickedPage:p,navigation:'number'};},
  loadScrollPage:async(j,tab,p)=>{assert.equal(j.pageProof.page,p);assert.equal(restored.requests.length,0);collected.push(p);return {products:rows(p),ads:0,scan:{}};},
  expandCatalogsOnPage:async()=>({expanded:[],counts:{}})});
 await restored.send('sb:resume',{}, {tab:{id:1}});await settled(restored);
 assert.deepEqual(collected,[2,3]);assert.deepEqual(clicks,[3]);assert.equal(verifiedTopCalls,0);
 assert.equal(restored.api.state.collection,null);assert.equal(restored.api.state.incompletePages.length,0);assert.equal(restored.api.state.phase,'완료',restored.api.state.error);
 assert.equal(restored.api.state.discovered,9);assert.equal(restored.api.state.scanned,9);assert.equal(restored.requests.filter(x=>x.url.endsWith('/store/seller-info')).length,9);
});
test('resuming from a different real page clicks target, verifies it and only then scrolls',async()=>{
 const e=await runtime(),c=collection({keywords:['test'],to:2});e.api.setState({running:true,collection:c});blocked(e);await e.api.runJob(e.api.setJob());
 let page=1,verified=false;const events=[];
 e.api.override({inspect:async()=>listing(page),inspectPager:async()=>({domCurrent:page,urlPage:1,confidence:'high'}),scrollFooter:async()=>{},
  clickPage:async(_,p)=>{events.push('click');page=p;return {ok:true,clickedPage:p,navigation:'number'};},
  waitForPricePageChange:async()=>{assert.deepEqual(events,['click']);verified=true;return {pager:{domCurrent:2},actual:2,proof:'fixture verified'};},
  loadScrollPage:async()=>{assert(verified);events.push('collect');return {products:rows(2),ads:0,scan:{}};},expandCatalogsOnPage:async()=>({expanded:[],counts:{}})});
 await e.send('sb:resume',{}, {tab:{id:1}});await settled(e);assert.deepEqual(events,['click','collect']);assert.equal(e.api.state.collection,null);
});
test('scroll collection failure also preserves checkpoint and does not query prior-page companies',async()=>{
 const e=await runtime(),c=collection();e.api.setState({running:true,collection:c});e.api.override({navigatePrice:async()=>{},loadScrollPage:async()=>{throw Error('Synthetic tab closed');}});
 await e.api.runJob(e.api.setJob());assert.equal(e.api.state.phase,'페이지 확인 대기');assert.equal(c.nextPage,2);assert.equal(c.products.length,3);assert.equal(e.requests.length,0);
});
test('reset clears waiting collection while preserving lookup ledger',async()=>{
 const e=await runtime(),c=collection();e.api.setState({running:true,collection:c});blocked(e);await e.api.runJob(e.api.setJob());
 assert.equal((await e.send('sb:reset')).ok,true);assert.equal(e.api.state.collection,null);assert.equal(e.api.state.paused,false);assert.equal(e.api.state.incompletePages.length,0);
});
test('new job resets preceding run counters and records requested range',async()=>{
 const e=await runtime();e.api.setState({scanned:46,discovered:134,ads:12,page:2});e.api.override({navigatePrice:async()=>{throw Error('Synthetic wait');}});
 assert.equal((await e.send('sb:start',{mode:'auto',from:1,to:3,settings:{}},{tab:{id:1,url}})).ok,true);await settled(e);
 assert.equal(e.api.state.scanned,0);assert.equal(e.api.state.discovered,0);assert.equal(e.api.state.ads,0);assert.equal(e.api.state.settings.to,3);assert.equal(e.api.state.phase,'페이지 확인 대기');
});
const call=(w,fn,...args)=>{
 const run=w.eval('('+fn.toString()+')');
 if(fn.name==='clickPricePagination'){
  // Model a visible, unobstructed button after the production preparation wait.
  Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'visible'});
  w.HTMLElement.prototype.scrollIntoView=function(){this.getBoundingClientRect=()=>({width:100,height:30,left:100,top:100,right:200,bottom:130});};
  const ready=run(...args,true);if(!ready.ok)return ready;
  const prepared=w.__sbPagerPrepared328;prepared.at-=650;
  w.document.elementFromPoint=()=>prepared.el;
 }
 return run(...args);
};
function page(){
 const d=new JSDOM('<div class="pagination_num_fixture"><strong aria-current="page">1</strong><a href="#" class="pagination_btn_page_fixture" data-shp-contents-type="pageNo">2</a></div>',{url,runScripts:'outside-only'}),w=d.window;
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.document.querySelector('a').onclick=event=>event.preventDefault();return d;
}
const requestUrl=url+'&pagingIndex=2&credential=SHOULD_NOT_BE_RECORDED';
test('passive fetch monitor preserves promise/receiver, records pending and response without headers/body',async()=>{
 const e=await runtime(),d=page(),w=d.window;try{
 let resolve;const promise=new Promise(r=>resolve=r),receiver={};let received;
 w.fetch=function(...args){assert.equal(this,receiver);received=args;return promise;};
 call(w,e.api.clickPricePagination,2,1);const init={headers:{secret:'SHOULD_NOT_BE_RECORDED'}};
 assert.equal(w.fetch.call(receiver,requestUrl,init),promise);assert.equal(received[1],init);
 assert.equal(w.__sbSearchNetwork325.entries[0].state,'pending');
 const payload={ok:true,status:200,get body(){throw Error('Must not read body');},get headers(){throw Error('Must not read headers');}};resolve(payload);await promise;await tick();
 assert.equal(w.__sbSearchNetwork325.entries[0].state,'response');assert.equal(w.__sbSearchNetwork325.entries[0].status,200);
 const scan=call(w,e.api.inspectProducts);assert.equal(scan.lifecycle.requests.length,1);assert(!JSON.stringify(scan.lifecycle).includes('SHOULD_NOT_BE_RECORDED'));
 const wrapped=w.fetch;call(w,e.api.clickPricePagination,2,1);assert.equal(w.fetch,wrapped);
 }finally{w.close();}
});
for(const [name,result,state,status] of [['http failure',()=>Promise.resolve({ok:false,status:500}),'http-error',500],['network failure',()=>Promise.reject(Error('secret network details')),'error',0],['synchronous failure',()=>{throw Error('synthetic sync failure');},'error',0]])test('fetch monitor observes '+name+' without changing outcome',async()=>{
 const e=await runtime(),d=page(),w=d.window;try{
 w.fetch=result;call(w,e.api.clickPricePagination,2,1);try{await w.fetch(requestUrl);}catch(error){assert.match(error.message,/failure|details/);}await tick();
 const entry=w.__sbSearchNetwork325.entries[0];assert.equal(entry.state,state);assert.equal(entry.status,status);assert(!JSON.stringify(entry).includes('secret'));
 }finally{w.close();}
});
test('monitor ignores unrelated hosts/endpoints and bounds recorded search requests',async()=>{
 const e=await runtime(),d=page(),w=d.window;try{
 w.fetch=()=>Promise.resolve({ok:true,status:200});call(w,e.api.clickPricePagination,2,1);
 for(const u of ['https://example.org/search/all?pagingIndex=2',url+'/extra','https://search.shopping.naver.com/api/private?pagingIndex=2',url+'&pagingIndex=22'])await w.fetch(u);
 assert.equal(w.__sbSearchNetwork325.entries.length,0);
 for(let n=0;n<110;n++)await w.fetch(requestUrl);assert.equal(w.__sbSearchNetwork325.entries.length,100);assert.equal(call(w,e.api.inspectProducts).lifecycle.requests.length,30);
 }finally{w.close();}
});
test('XHR request monitoring preserves return values and distinguishes success, abort, timeout and errors on reuse',async()=>{
 const e=await runtime(),d=page(),w=d.window;try{
 class FakeXHR extends w.EventTarget{open(){return 'open-result';}send(){return 'send-result';}}
 w.XMLHttpRequest=FakeXHR;call(w,e.api.clickPricePagination,2,1);const xhr=new w.XMLHttpRequest();
 for(const [event,status,expected] of [['load',200,'complete'],['abort',0,'aborted'],['timeout',0,'timeout'],['error',0,'error'],['load',404,'http-error']]){
  assert.equal(xhr.open('GET',requestUrl),'open-result');assert.equal(xhr.send(),'send-result');xhr.status=status;xhr.dispatchEvent(new w.Event(event));xhr.dispatchEvent(new w.Event('loadend'));
  const entry=w.__sbSearchNetwork325.entries.at(-1);assert.equal(entry.state,expected);assert.equal(entry.status,status);
 }
 assert.equal(w.__sbSearchNetwork325.entries.length,5);assert.equal(w.__sbSearchNetwork325.entries[0].state,'complete');
 }finally{w.close();}
});
test('fetch headers alone and pending request are not page-transition proof',async()=>{
 const e=await runtime(),j=e.api.setJob();const data=listing(2,true);data.lifecycle={fromPage:1,targetPage:2,ageMs:3000,quietMs:3000,organicAdded:0,organicRemoved:0,responses:[],requests:[{page:2,state:'response',status:200},{page:2,state:'pending',status:0}]};
 e.api.override({inspect:async()=>data,inspectPager:async()=>({domCurrent:2,urlPage:1})});
 await assert.rejects(()=>e.api.waitForPricePageChange(j,1,2,e.api.pageEvidence(listing(1,true)),1,4000),/페이지 이동 확인 실패/);
});
test('navigation baseline is persisted before click so worker interruption cannot accept retagged old products',async()=>{
 const e=await runtime(),c=collection();e.api.setState({running:true,collection:c});let savedAtClick;
 e.api.override({inspect:async()=>listing(1,true),inspectPager:async()=>({domCurrent:1,urlPage:1,confidence:'high'}),scrollFooter:async()=>{},
  clickPage:async()=>{savedAtClick=e.disk;return {ok:false};}});
 await assert.rejects(()=>e.api.navigatePrice(e.api.setJob(),1,'test',2),/버튼을 찾지/);
 assert.equal(savedAtClick[workKey].collection.pageWait.page,2);assert.equal(savedAtClick[workKey].collection.pageWait.fromPage,1);
 const restored=await runtime({disk:savedAtClick});restored.api.override({inspect:async()=>listing(2,true),inspectPager:async()=>({domCurrent:2,urlPage:1})});
 await restored.send('sb:resume',{}, {tab:{id:1}});await settled(restored);
 assert.equal(restored.api.state.phase,'페이지 확인 대기');assert.equal(restored.requests.length,0);assert.equal(restored.api.state.collection.products.length,3);
});
