'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {runtime,item,response}=require('./helpers/runtime.cjs');
const storeKey='sb_verified_store_links_v323';
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
const pairs=x=>JSON.stringify(Object.entries(x).map(([key,value])=>({key,value})));
function page(url='https://search.shopping.naver.com/search/all?query=test&pagingIndex=3'){
 const d=new JSDOM('<div id="list"></div><div class="pagination_pagination_fixture"><div class="pagination_num_fixture"></div></div>',{url,runScripts:'outside-only'});
 const w=d.window;w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30,top:2000,bottom:2030});w.HTMLElement.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};return d;
}
function card(w,n,p=1){
 const li=w.document.createElement('li'),a=w.document.createElement('a');li.className='product_item_fixture';a.textContent='Synthetic product';a.href=`https://smartstore.naver.com/store${n}/products/${111+n}`;
 for(const [k,v] of Object.entries({'data-shp-area':'lst*N.title','data-shp-contents-id':String(1000+n),'data-shp-contents-provider-id':String(100+n),'data-shp-contents-provider-type':'mall_seq',
 'data-shp-contents-dtl':pairs({chnl_prod_no:String(111+n),prod_nm:'Synthetic product',seller_count:1,search_nginx_pageid:'same-request'}),
 'data-shp-contents-provider-dtl':pairs({adsr_type:'SHOPN',chnl_no:String(200+n)}),
 'data-nlog-params':JSON.stringify({is_ad:false,filter_con:{items:[{key:'pgn',value:String(p)}]}})}))a.setAttribute(k,v);
 li.append(a);return li;
}
function listing(p=2,life={}){return {url:'https://search.shopping.naver.com/search/all?query=test',records:[1,2,3].map(n=>item({mallSeq:String(100+n),nvMid:String(1000+n),chnlProdNo:String(111+n),observedPage:p,searchRequestId:'same'})),lifecycle:{fromPage:1,targetPage:2,ageMs:3000,quietMs:1000,organicAdded:3,organicRemoved:3,productNodesAdded:3,productNodesRemoved:3,responses:[],...life}};}
test('hidden old products are excluded but below-fold visible products remain',async()=>{
 const e=await runtime(),d=page(),w=d.window;
 try{for(let n=1;n<=4;n++){const li=card(w,n);if(n===1)li.hidden=true;if(n===2)li.style.display='none';if(n===3)li.setAttribute('aria-hidden','true');w.document.querySelector('#list').append(li);}
 const scan=call(w,e.api.inspectProducts);assert.equal(scan.records.length,1);assert.equal(scan.records[0].mallSeq,'104');assert.equal(scan.hiddenAnchors,3);
 }finally{d.window.close();}
});
test('actual clicks move 3→2→3→4→5 with identical products and stale URL; every page is audited',async()=>{
 let clock=0;const e=await runtime({onPause:ms=>clock+=ms}),d=page(),w=d.window,clicks=[];
 try{
 Object.defineProperty(w.performance,'now',{value:()=>clock});Object.defineProperty(w.document.documentElement,'scrollHeight',{value:1000});
 function render(p){
  w.document.querySelector('#list').replaceChildren(...[1,2,3].map(n=>card(w,n,p)));
  const group=w.document.querySelector('.pagination_num_fixture');group.replaceChildren();
  for(let n=1;n<=5;n++){const el=w.document.createElement(n===p?'strong':'a');el.textContent=String(n);
   if(n===p)el.setAttribute('aria-current','page');else{el.className='pagination_btn_page_fixture';el.setAttribute('data-shp-contents-type','pageNo');el.href='#';el.onclick=ev=>{ev.preventDefault();clicks.push(n);render(n);};}group.append(el);}
 }
 render(3);e.chrome.scripting.executeScript=async({func,args=[]})=>[{result:call(w,func,...args)}];
 const collection={source:'price',mode:'auto',searchUrl:w.location.href,from:2,to:5,nextPage:2,keywords:['test'],keywordIndex:0,products:[],catalogProcessed:{},tabId:1};
 const state=e.api.setState({running:true,collection,settings:{grouped:'include',ads:'all'}});
 await e.api.runJob(e.api.setJob());
 assert.equal(state.phase,'완료',state.error);assert.deepEqual(clicks,[2,3,4,5]);assert.equal(new URL(w.location.href).searchParams.get('pagingIndex'),'3');
 assert.equal(state.auditPages.length,4);assert.equal(state.auditPages.reduce((n,p)=>n+p.searchProducts,0),12);assert.equal(state.discovered,3);assert.equal(state.matched.length,3);
 assert.equal(state.pageTransitions.length,4);assert(state.pageTransitions.every(x=>x.renderProof&&!x.listChanged&&!x.requestChanged));
 assert.equal(e.requests.filter(x=>x.url.endsWith('/store/seller-info')).length,3);
 }finally{d.window.close();}
});
for(const [name,life,loading] of [
 ['tracking metadata only',{organicAdded:0,organicRemoved:0},false],
 ['only advertisements replaced',{organicAdded:0,organicRemoved:0,productNodesAdded:20,productNodesRemoved:20},false],
 ['wrong prior page',{fromPage:3},false],
 ['still loading',{},true]
])test(`${name} cannot confirm a repeated product page`,async()=>{
 const e=await runtime(),j=e.api.setJob(),after={...listing(2,life),loading};
 e.api.override({inspect:async()=>after,inspectPager:async()=>({domCurrent:2,urlPage:1})});
 await assert.rejects(()=>e.api.waitForPricePageChange(j,1,2,e.api.pageEvidence(listing(1)),1,4000),/페이지 이동 확인 실패/);
});
for(const [name,resp,pass] of [['success',{page:2,status:200,query:'test'},true],['wrong keyword',{page:2,status:200,query:'other'},false],['error',{page:2,status:404,query:'test'},false]])test(`observed search response: ${name}`,async()=>{
 const e=await runtime(),j=e.api.setJob(),after=listing(2,{organicAdded:0,organicRemoved:0,responses:[resp]});
 e.api.override({inspect:async()=>after,inspectPager:async()=>({domCurrent:2,urlPage:1})});
 const promise=e.api.waitForPricePageChange(j,1,2,e.api.pageEvidence(listing(1)),1,4000);
 if(pass){assert.equal((await promise).actual,2);assert.equal(e.api.state.pageTransitions[0].responseProof,true);}else await assert.rejects(()=>promise,/페이지 이동 확인 실패/);
});
test('missing target uses actual previous button; tracking IDs and carousel are ignored',async()=>{
 const e=await runtime(),d=page(),w=d.window;try{
 w.document.body.innerHTML='<button class="navi_btn_dot active">9</button><div class="pagination_pagination_fixture"><button class="pagination_prev_fixture" data-shp-contents-id="999">이전</button><div class="pagination_num_fixture"><strong aria-current="page">4</strong><a class="pagination_btn_page_fixture" data-shp-contents-type="pageNo">5</a></div></div>';
 let clicks=0;w.document.querySelector('.pagination_prev_fixture').onclick=()=>clicks++;
 assert.equal(call(w,e.api.inspectPricePagination).domCurrent,4);const r=call(w,e.api.clickPricePagination,2,4);assert.equal(r.navigation,'prev');assert.equal(r.clickedPage,null);assert.equal(clicks,1);
 }finally{d.window.close();}
});
test('partial number links identify a unique interior selected page without nine links',async()=>{
 const e=await runtime(),d=page(),w=d.window;try{
 w.document.querySelector('.pagination_num_fixture').innerHTML=[1,2,4,5].map(n=>`<a class="pagination_btn_page_fixture" data-shp-contents-type="pageNo">${n}</a>`).join('');assert.equal(call(w,e.api.inspectPricePagination).domCurrent,3);
 }finally{d.window.close();}
});
test('verified ttasomihome address refreshes incomplete cache; fresh landline is correctly held',async()=>{
 const e=await runtime({cache:{exists:true,phoneNumber:'031-000-0000'},payload:{success:true,sellerInfo:{representTelephoneNumber:'031-111-2222',representativeName:'Synthetic owner'}}});
 const s=e.api.setState({pending:[item({mallSeq:'12407903',chnlProdNo:'13502306516',nvMid:'91046816868',storeUrl:'',isAd:true})],total:1});await e.api.processPending(e.api.setJob());
 assert.equal(e.requests.filter(x=>x.url.includes('/extension/business-info?')).length,0);const req=e.requests.find(x=>x.url.endsWith('/store/seller-info'));assert.equal(JSON.parse(req.body).url,'https://smartstore.naver.com/ttasomihome');
 assert.equal(s.matched.length,0);assert.equal(s.statistics.bizLatest,1);assert.equal(s.statistics.bizErrors,0);assert.equal(s.review[0].phoneNumber,'031-111-2222');assert.match(s.review[0].reason,/010/);assert.equal(s.review[0].lookupOrigin,'latest-api');
});
for(const detail of ['Route not found','NID_AUT=synthetic-secret'])test(`server failure retains sanitized diagnostics: ${detail.startsWith('NID')?'auth redaction':'404 detail'}`,async()=>{
 const e=await runtime({fetch:async(u,i,n)=>u.includes('/extension/business-info?')?response({detail},404):n(u,i)});
 const s=e.api.setState({pending:[item({storeUrl:''})],total:1});await e.api.processPending(e.api.setJob());const r=s.review[0];
 assert.equal(r.lookupHttpStatus,404);assert.match(r.lookupEndpoint,/extension\/business-info/);assert.equal(r.lookupOrigin,'number-api');
 if(detail.startsWith('NID'))assert(!JSON.stringify(s).includes('synthetic-secret'));else assert.equal(r.lookupServerMessage,detail);
});
async function captureFixture(){
 const e=await runtime(),d=page('https://smartstore.naver.com/expected/products/111'),w=d.window;
 w.__PRELOADED_STATE__={smartStoreV2:{channel:{mallSeq:'100',channelNo:'200'}},simpleProductForDetailPage:{A:{id:111,epInfo:{syncNvMid:'1000'}}},private:'not exported'};
 e.chrome.scripting.executeScript=async({func,args=[]})=>[{result:call(w,func,...args)}];return {e,d,w,sender:{tab:{id:1,url:w.location.href},frameId:0}};
}
test('opened product is matched, saved without requests, and reused after reset and service worker restart',async()=>{
 const {e,d,w,sender}=await captureFixture();try{
 const found=call(w,e.api.inspectOpenedStore);assert.equal(found.mallSeq,'100');assert.equal(found.private,undefined);
 assert.equal((await e.send('sb:remember-store',{},sender)).saved,true);assert.equal(e.requests.length,0);assert(e.disk[storeKey]['100']);
 await e.send('sb:reset');const restored=await runtime({disk:e.disk});const s=restored.api.setState({pending:[item({storeUrl:''})],total:1});await restored.api.processPending(restored.api.setJob());
 assert.equal(s.matched.length,1);assert.equal(restored.requests.filter(x=>x.url.endsWith('/store/seller-info')).length,1);assert.equal(restored.requests.filter(x=>x.url.includes('/extension/business-info?')).length,0);
 }finally{d.window.close();}
});
for(const kind of ['wrong product','conflicting seller','subframe','unrelated host','channel mismatch'])test(`store capture rejects ${kind}`,async()=>{
 const {e,d,w,sender}=await captureFixture();try{
 if(kind==='wrong product')w.__PRELOADED_STATE__.simpleProductForDetailPage.A.id=999;
 if(kind==='conflicting seller')e.api.setState({pending:[item({mallSeq:'999'})]});
 if(kind==='subframe')sender.frameId=1;
 if(kind==='unrelated host')sender.tab.url='https://example.com/expected/products/111';
 if(kind==='channel mismatch'){
  assert.equal((await e.send('sb:remember-store',{},sender)).saved,true);assert.equal(e.api.storeHints([item({chnlNo:'999'})])['100'],undefined);
 }else assert.equal((await e.send('sb:remember-store',{},sender)).saved,false);
 assert.equal(e.requests.length,0);
 }finally{d.window.close();}
});
test('latest API success=false preserves error details separately from fresh no-010',async()=>{
 const e=await runtime({payload:{success:false,message:'Seller lookup unavailable'}}),s=e.api.setState({pending:[item()],total:1});await e.api.processPending(e.api.setJob());
 assert.equal(s.statistics.bizLatest,0);assert.equal(s.statistics.bizErrors,1);assert.equal(s.review[0].lookupHttpStatus,200);assert.equal(s.review[0].lookupEndpoint,'/store/seller-info');assert.equal(s.review[0].lookupServerMessage,'Seller lookup unavailable');
});
test('store capture rejects a known product with a different channel',async()=>{
 const {e,d,sender}=await captureFixture();try{e.api.setState({pending:[item({chnlNo:'999'})]});assert.equal((await e.send('sb:remember-store',{},sender)).saved,false);assert.equal(e.disk[storeKey],undefined);}finally{d.window.close();}
});
test('concurrent store observations preserve both mappings',async()=>{
 const e=await runtime();e.chrome.scripting.executeScript=async({target})=>[{result:{storeUrl:`https://smartstore.naver.com/store${target.tabId}`,productNo:String(100+target.tabId),mallSeq:String(target.tabId),channelNo:String(target.tabId)}}];
 const result=await Promise.all([1,2].map(id=>e.send('sb:remember-store',{}, {tab:{id,url:`https://smartstore.naver.com/store${id}/products/${100+id}`},frameId:0})));
 assert(result.every(x=>x.saved));assert.deepEqual(Object.keys(e.disk[storeKey]),['1','2']);
});
test('page observer does not count hidden list replacement as a visible product refresh',async()=>{
 const e=await runtime(),d=page(),w=d.window;try{
 const hidden=w.document.createElement('div');hidden.hidden=true;hidden.append(card(w,1));w.document.body.append(hidden);
 w.document.querySelector('.pagination_num_fixture').innerHTML='<strong aria-current="page">1</strong><a class="pagination_btn_page_fixture" data-shp-contents-type="pageNo" href="#">2</a>';
 w.document.querySelector('a.pagination_btn_page_fixture').onclick=ev=>{ev.preventDefault();hidden.replaceChildren(card(w,1,2));};
 assert.equal(call(w,e.api.clickPricePagination,2,1).ok,true);await Promise.resolve();assert.equal(w.__sbPageWatch323.added,0);assert.equal(w.__sbPageWatch323.removed,0);
 }finally{d.window.close();}
});
