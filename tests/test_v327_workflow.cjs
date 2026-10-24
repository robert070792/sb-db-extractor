'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {runtime,item,workKey,root}=require('./helpers/runtime.cjs');
const url='https://search.shopping.naver.com/search/all?query=test';
const catalog={mallSeq:'',nvMid:'5000',catalogNvMid:'5000',catalogUrlId:'5000',isCatalogRepresentative:true,isNaverStore:false,title:'Synthetic catalog',representativeKey:'catalog:5000'};
const records=()=>[item({observedPage:1}),{...catalog,observedPage:1}];
const payload={success:true,data:{totalCount:1,products:[{mallSequence:'201',nvMid:'901',channelSequence:'301',mallProductId:'401',pcProductUrl:'https://smartstore.naver.com/extra/products/401',isSmartStoreProduct:true,matchNvMid:'5000',mallInfo:{advertiserType:'SHOPN'},productName:'Synthetic offer'}]}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(e){for(let n=0;n<150&&e.api.job;n++)await tick();assert.equal(e.api.job,null);}
function browser(e,{status=200,failInjection=false}={}){
 const d=new JSDOM('',{url,runScripts:'outside-only'}),calls=[];const w=d.window;w.AbortController=AbortController;
 w.fetch=async request=>{calls.push(String(request));return {ok:status>=200&&status<300,status,headers:{get:()=> 'application/json'},json:async()=>payload};};
 e.chrome.scripting.executeScript=async({func,args=[]})=>{if(failInjection)throw Error('Synthetic tab closed');return [{result:await w.eval('('+func.toString()+')')(...args)}];};
 return {d,w,calls};
}
test('fresh state defaults to OFF and direct catalog path cannot issue a request',async()=>{
 const e=await runtime(),b=browser(e);try{
 assert.equal(e.api.state.settings.catalogLookup,false);
 const result=await e.api.inspectCatalogOffers(e.api.setJob(), '5000',1,'test');assert.equal(result.disabled,true);assert.equal(b.calls.length,0);assert.equal(e.api.state.catalogRequests.attempted,0);
 }finally{b.w.close();}
});
for(const mode of ['current','auto'])for(const enabled of [false,true])test(`${mode} extraction with catalog ${enabled?'ON':'OFF'} preserves screen products and applies the request switch`,async()=>{
 const e=await runtime(),b=browser(e);try{
 e.api.override({inspect:async()=>({records:records()}),inspectPager:async()=>({domCurrent:1,current:1}),navigatePrice:async()=>{},loadScrollPage:async()=>({products:records(),ads:0,scan:{}})});
 const accepted=await e.send('sb:start',{mode,from:1,to:1,settings:{catalogLookup:enabled,grouped:'include'}},{tab:{id:1,url}});assert.equal(accepted.ok,true);await settled(e);
 assert.equal(e.api.state.settings.catalogLookup,enabled);assert.equal(e.api.state.phase,'완료',e.api.state.error);
 assert.equal(b.calls.length,enabled?1:0);assert.equal(e.api.state.catalogRequests.fetchInvoked,enabled?1:0);assert.equal(e.api.state.catalogRequests.unconfirmed,0);
 assert.equal(e.api.state.discovered,enabled?2:1);assert.equal(e.requests.filter(x=>x.url.endsWith('/store/seller-info')).length,enabled?2:1);
 assert.equal(e.api.state.auditPages[0].catalogsDisabled,enabled?0:1);assert.equal(e.api.state.catalogWarnings,0);
 if(!enabled)assert(e.api.state.auditRows.some(x=>/설정으로 판매처 미조회/.test(x.decision)));
 }finally{b.w.close();}
});
test('grouped exclusion does not override an explicit ON selection',async()=>{
 const e=await runtime(),b=browser(e);try{e.api.setState({settings:{catalogLookup:true,grouped:'exclude'}});
 await e.api.expandCatalogsOnPage(e.api.setJob(),{products:[]},'test',1,records());assert.equal(b.calls.length,1);assert.equal(e.api.state.catalogRequests.fetchInvoked,1);
 }finally{b.w.close();}
});
test('catalog HTTP 418 is counted once and still blocks further catalog requests',async()=>{
 const e=await runtime(),b=browser(e,{status:418});try{e.api.setState({settings:{catalogLookup:true}});
 const c={products:[]};await e.api.expandCatalogsOnPage(e.api.setJob(),c,'test',1,[catalog,{...catalog,catalogNvMid:'5001',catalogUrlId:'5001',nvMid:'5001'}]);
 assert.equal(b.calls.length,1);assert.equal(e.api.state.catalogRequests.fetchInvoked,1);assert.equal(c.catalogBlocked,true);
 }finally{b.w.close();}
});
test('unknown injection outcome is recorded as unconfirmed, not as zero requests',async()=>{
 const e=await runtime(),b=browser(e,{failInjection:true});try{e.api.setState({settings:{catalogLookup:true}});
 const r=await e.api.inspectCatalogOffers(e.api.setJob(),'5000',1,'test');assert.equal(r.ok,false);assert.equal(e.api.state.catalogRequests.attempted,1);assert.equal(e.api.state.catalogRequests.fetchInvoked,0);assert.equal(e.api.state.catalogRequests.unconfirmed,1);
 }finally{b.w.close();}
});
test('OFF survives worker restart and cannot be changed through a resume message',async()=>{
 const c={source:'price',mode:'auto',from:1,to:1,nextPage:1,keywords:['test'],keywordIndex:0,products:[],tabId:1};
 const e=await runtime({disk:{[workKey]:{settings:{catalogLookup:false},collection:c,startedAt:123,running:true}}}),b=browser(e);
 try{e.api.override({navigatePrice:async()=>{},loadScrollPage:async()=>({products:records(),ads:0,scan:{}})});
 await e.send('sb:resume',{settings:{catalogLookup:true}},{tab:{id:1,url}});await settled(e);assert.equal(e.api.state.settings.catalogLookup,false);assert.equal(b.calls.length,0);
 }finally{b.w.close();}
});
test('legacy work stays ON with uncounted history; reset returns to OFF with zero counters',async()=>{
 const e=await runtime({disk:{[workKey]:{settings:{grouped:'exclude'},startedAt:123,collection:{products:[],nextPage:2},catalogExpanded:9}}});
 assert.equal(e.api.state.settings.catalogLookup,true);assert.equal(e.api.state.catalogRequests.legacyUncounted,true);
 await e.send('sb:reset');assert.equal(e.api.state.settings.catalogLookup,false);assert.equal(e.api.state.catalogRequests.legacyUncounted,false);assert.equal(e.api.state.catalogRequests.fetchInvoked,0);
});
test('new run resets catalog counts and omitted option means OFF',async()=>{
 const e=await runtime();e.api.setState({catalogRequests:{attempted:8,fetchInvoked:8,unconfirmed:0,legacyUncounted:true}});
 e.api.override({navigatePrice:async()=>{throw Error('Synthetic page wait');}});
 await e.send('sb:start',{mode:'auto',from:1,to:2,settings:{}},{tab:{id:1,url}});await settled(e);
 assert.equal(e.api.state.settings.catalogLookup,false);assert.equal(e.api.state.catalogRequests.fetchInvoked,0);assert.equal(e.api.state.catalogRequests.legacyUncounted,false);
});
async function panel(e){
 const d=new JSDOM('',{url,runScripts:'outside-only'}),w=d.window,blobs=[];
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30,left:0,top:0,right:100,bottom:30});w.HTMLElement.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};
 w.chrome={runtime:{lastError:null,sendMessage:(message,callback)=>{e.send(message.action,message,{tab:{id:1,url}}).then(callback);}},storage:{local:{get:(_,cb)=>{cb?.({});return Promise.resolve({});},set:()=>Promise.resolve()}}};
 w.setInterval=()=>0;w.ResizeObserver=class{observe(){}};w.confirm=()=>true;w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:fixture';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};
 w.eval(fs.readFileSync(path.join(root,'src/extract/panel.js'),'utf8'));await tick();
 return {d,w,blobs,$:id=>w.document.getElementById(id)};
}
test('panel toggle sends ON, stays locked during waiting work, exports mode and counters, and resets to OFF',async()=>{
 const e=await runtime();e.api.override({navigatePrice:async()=>{throw Error('Synthetic page wait');}});const p=await panel(e);try{
 const button=p.$('sb-catalog-toggle');assert.equal(button.getAttribute('aria-pressed'),'false');button.click();assert.equal(button.getAttribute('aria-pressed'),'true');
 p.$('sb-auto').click();await settled(e);await new Promise(r=>setTimeout(r,300));assert.equal(e.api.state.settings.catalogLookup,true);assert.equal(button.disabled,true);button.click();assert.equal(button.getAttribute('aria-pressed'),'true');
 p.$('sb-all-save').click();assert.equal(p.blobs.length,1);const reader=new p.w.FileReader();const raw=await new Promise(resolve=>{reader.onload=()=>resolve(reader.result);reader.readAsText(p.blobs[0]);});const report=JSON.parse(raw.replace(/^\uFEFF/,''));assert.equal(report.settings.catalogLookup,true);assert.equal(report.catalogRequests.fetchInvoked,0);
 await p.$('sb-reset').onclick();assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-pressed'),'false');
 }finally{p.w.close();}
});
test('panel restores OFF for a paused collection and ON for legacy work without implying zero historic requests',async()=>{
 for(const legacy of [false,true]){
 const e=await runtime({disk:{[workKey]:{settings:legacy?{}:{catalogLookup:false},startedAt:123,collection:{products:[],from:1,to:3,nextPage:2,keywords:['test'],keywordIndex:0},paused:true}}}),p=await panel(e);
 try{assert.equal(p.$('sb-catalog-toggle').getAttribute('aria-pressed'),String(legacy));assert.equal(p.$('sb-catalog-toggle').disabled,true);if(legacy)assert.match(p.$('sb-catalog-result').textContent,/미집계/);}finally{p.w.close();}
 }
});
