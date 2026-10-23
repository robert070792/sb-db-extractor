'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {runtime,item,C,response,ledgerKey}=require('./helpers/runtime.cjs');
const numberCalls=e=>e.requests.filter(x=>x.url.includes('/extension/business-info?'));
const latestCalls=e=>e.requests.filter(x=>x.url.endsWith('/store/seller-info'));
function numberFetch(data={phoneNumber:'010-2345-6789',companyName:'Synthetic business'}){
 return async(url,init,next)=>url.includes('/extension/business-info?')?response(data):next(url,init);
}

test('advertisement without a store URL uses mallSeq + shopping nvMid, not the channel product number',async()=>{
 let e;let cookies=0;
 e=await runtime({noAuth:true,fetch:async(url,init,next)=>{
  if(url.includes('/extension/business-info?')){
   const u=new URL(url);assert.equal(u.searchParams.get('mallSeq'),'1367436');assert.equal(u.searchParams.get('syncNvMid'),'90082614314');
   assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.headers,undefined);assert.equal(init.body,undefined);
   assert.equal(e.disk[ledgerKey]['1367436'].status,'requested');
   return response({phoneNumber:'010-2345-6789',companyName:'Synthetic business',storeUrl:'https://brand.naver.com/synthetic-store'});
  }return next(url,init);
 }});
 e.chrome.cookies.get=()=>{cookies++;throw Error('Number lookup must not read Naver cookies');};
 const s=e.api.setState({pending:[item({mallSeq:'1367436',nvMid:'90082614314',chnlProdNo:'12538103461',storeUrl:'',storeName:'',isAd:true})],total:1});
 await e.api.processPending(e.api.setJob());
 assert.equal(cookies,0);assert.equal(numberCalls(e).length,1);assert.equal(latestCalls(e).length,0);
 assert.equal(s.matched.length,1);assert.equal(s.matched[0].memo,'검색광고');assert.equal(s.matched[0].productUrl,'https://brand.naver.com/synthetic-store/products/12538103461');
 assert.equal(s.statistics.bizLegacy,1);assert.equal(s.statistics.bizStoreRecovered,1);
});
for(const phone of ['02-123-4567','010-9529-****',''])for(const storeUrl of ['', 'https://brand.naver.com/expected']){
 test(`incomplete cache refreshes: ${phone||'empty'} / ${storeUrl?'store':'numbers'}`,async()=>{
  const e=await runtime({cache:{exists:true,companyName:'Synthetic cache',phoneNumber:phone},fetch:numberFetch()});
  const s=e.api.setState({pending:[item({storeUrl})],total:1});await e.api.processPending(e.api.setJob());
  assert.equal(s.matched.length,1);assert.equal(s.statistics.bizCached,0);
  assert.equal(numberCalls(e).length,storeUrl?0:1);assert.equal(latestCalls(e).length,storeUrl?1:0);
  assert(s.logs.some(x=>x.includes('캐시의 온전한 010 미확보')));
 });
}
test('full 010 cache needs no paid request even if store URL is absent',async()=>{
 const e=await runtime({noAuth:true,cache:{exists:true,phoneNumber:'010-1111-2222'}});
 const s=e.api.setState({pending:[item({storeUrl:''})],total:1});await e.api.processPending(e.api.setJob());
 assert.equal(s.matched.length,1);assert.equal(s.statistics.bizCached,1);assert.equal(numberCalls(e).length+latestCalls(e).length,0);
});
for(const payload of [{success:false},{data:{}},{mallSeq:'999',phoneNumber:'010-1111-2222'},{phoneNumber:'010-1111-2222',productUrl:'https://brand.naver.com/expected/products/999'}]){
 test(`number response cannot silently accept wrong or empty identity: ${JSON.stringify(payload)}`,async()=>{
  const e=await runtime({fetch:numberFetch(payload)}),s=e.api.setState({pending:[item({storeUrl:''})],total:1});
  await e.api.processPending(e.api.setJob());assert.equal(s.matched.length,0);assert.equal(s.review.length,1);assert.equal(s.statistics.bizErrors,1);
  assert.equal(e.requests.filter(x=>x.method==='POST').length,0);
 });
}
test('fresh masked 010 is held as masked rather than no mobile, with contact evidence retained',async()=>{
 const e=await runtime({fetch:numberFetch({phoneNumber:'010-9529-****',companyName:'Synthetic name'})});
 const s=e.api.setState({pending:[item({storeUrl:''})],total:1});await e.api.processPending(e.api.setJob());
 assert.equal(s.matched.length,0);assert.equal(s.review[0].phoneNumber,'010-9529-****');assert.match(s.review[0].reason,/신규 사업자조회 완료.*일부 가려짐/);
 assert.equal(s.review[0].lookupOrigin,'number-api');
});
test('number endpoint failure is a request error; incomplete cache evidence survives and no URL API retry occurs',async()=>{
 const e=await runtime({cache:{companyName:'Synthetic cache',phoneNumber:'010-1111-****'},fetch:async(u,i,n)=>u.includes('/extension/business-info?')?response({},503):n(u,i)});
 const s=e.api.setState({pending:[item({storeUrl:''})],total:1});await e.api.processPending(e.api.setJob());
 assert.match(s.review[0].reason,/HTTP 503/);assert.equal(s.review[0].phoneNumber,'010-1111-****');
 assert.equal(numberCalls(e).length,1);assert.equal(latestCalls(e).length,0);
});
test('old run history permits refresh; same run and resumed request cannot duplicate',async()=>{
 const e=await runtime({disk:{[ledgerKey]:{'100':{runId:'older-run',status:'outcome-unknown',storeUrl:''}}},fetch:numberFetch()});
 const s=e.api.setState({pending:[item({storeUrl:''})],total:1}),j=e.api.setJob();
 await e.api.processPending(j);assert.equal(numberCalls(e).length,1);
 s.seen=[];s.pending=[item({storeUrl:''})];await e.api.processPending(j);
 assert.equal(numberCalls(e).length,1);assert.equal(s.statistics.lookupPrevented,1);
 const restored=await runtime({disk:e.disk,fetch:numberFetch()});assert.equal(restored.api.lookupAlreadyRequested('100',''),true);
});
test('failed new reservation restores previous run audit record without sending',async()=>{
 const e=await runtime({disk:{[ledgerKey]:{'100':{runId:'old',status:'succeeded',storeUrl:''}}},fetch:numberFetch()});
 e.api.setState({pending:[item({storeUrl:''})],total:1});e.failLedger=true;
 await e.api.processPending(e.api.setJob());assert.equal(numberCalls(e).length,0);assert.equal(e.api.ledger['100'].runId,'old');
});
function listing(page,request,extra={}){return {records:[1,2,3].map(n=>item({mallSeq:String(100+n),chnlProdNo:String(111+n),nvMid:String(1000+n),observedPage:page,searchRequestId:request,...extra}))};}
test('same product IDs require a successful target-page response as well as refreshed metadata',async()=>{
 const e=await runtime(),j=e.api.setJob(),before=e.api.pageEvidence(listing(1,'old'));
 e.api.override({inspect:async()=>({...listing(2,'new'),url:'https://search.shopping.naver.com/search/all?query=test',lifecycle:{fromPage:1,targetPage:2,ageMs:3000,quietMs:1000,responses:[{page:2,status:200,query:'test'}]}}),inspectPager:async()=>({domCurrent:2,urlPage:1,numbers:[1,3]})});
 const result=await e.api.waitForPricePageChange(j,1,2,before,1,8000);
 assert.equal(result.actual,2);assert.equal(j.pageProof.requestProof,true);assert.equal(e.api.state.pageTransitions[0].listChanged,false);
 assert.equal(e.api.state.pageTransitions[0].requestChanged,true);
});
test('page number and pgn alone cannot pass when product IDs and response ID remain unchanged',async()=>{
 const e=await runtime(),j=e.api.setJob(),before=e.api.pageEvidence(listing(1,'old'));
 e.api.override({inspect:async()=>listing(2,'old'),inspectPager:async()=>({domCurrent:2,urlPage:1,numbers:[1,3]})});
 await assert.rejects(()=>e.api.waitForPricePageChange(j,1,2,before,1,3000),/페이지 이동 확인 실패/);
 assert.equal(e.api.state.pageTransitions[0].result,'unverified');
});
test('rotating only an advertisement does not prove the organic list changed',async()=>{
 const e=await runtime(),j=e.api.setJob();const beforeData=listing(1,'old');beforeData.records.push(item({isAd:true,chnlProdNo:'800',observedPage:1,searchRequestId:'old'}));
 const after=listing(2,'old');after.records.push(item({isAd:true,chnlProdNo:'900',observedPage:2,searchRequestId:'old'}));
 e.api.override({inspect:async()=>after,inspectPager:async()=>({domCurrent:2,urlPage:1})});
 await assert.rejects(()=>e.api.waitForPricePageChange(j,1,2,e.api.pageEvidence(beforeData),1,3000),/페이지 이동 확인 실패/);
});
test('page 2 repeat observations are audited, not dropped, when a new response is proven',async()=>{
 const e=await runtime(),j=e.api.setJob(),first=listing(1,'old').records,second=listing(2,'new').records;
 const c={from:1,to:2,nextPage:1,products:[],catalogProcessed:{},searchUrl:'https://search.shopping.naver.com/search/all?query=test'};
 e.api.setState({collection:c});e.api.override({navigatePrice:async(_,__,___,p)=>{j.pageProof={page:p,requestProof:p===2,lifecycleProof:p===2,requests:['new']};},
  loadScrollPage:async(_,__,p)=>({products:p===1?first:second,ads:0,scan:{rawUnique:3,representativeCandidates:3,reconciledRepresentativeCount:3,terminationReason:'bottom-stable'}}),
  expandCatalogsOnPage:async()=>({expanded:[],counts:{}})});
 await e.api.collectPrice(j,c,'test');
 assert.equal(e.api.state.pageStats.length,2);assert.equal(e.api.state.pageStats[1].products,3);assert.equal(e.api.state.pageStats[1].newItems,0);
 assert.equal(e.api.state.auditPages[0].repeatedProductsWithNewResponse,false);assert.equal(e.api.state.auditPages[1].repeatedProductsWithNewResponse,true);assert.equal(c.products.length,3);
});
test('ad HTML shape captures numeric nvMid and search request proof without resolving or clicking the ad',async()=>{
 const e=await runtime(),dom=new JSDOM('<li class="product_item_fixture"><a></a></li>',{url:'https://search.shopping.naver.com/search/all?query=test',runScripts:'outside-only'});
 const w=dom.window,a=w.document.querySelector('a'),pairs=x=>JSON.stringify(Object.entries(x).map(([key,value])=>({key,value})));
 a.href='https://ader.naver.com/v1/opaque-ad-token?c=nshop.npla&t=0';a.textContent='Synthetic advertised product';
 for(const [k,v] of Object.entries({'data-shp-area':'lst*A.title','data-shp-contents-id':'nad-a001-02-000000433097343','data-shp-contents-provider-type':'mall_seq','data-shp-contents-provider-id':'460325','data-shp-contents-type':'SA_prod',
 'data-shp-contents-dtl':pairs({nv_mid:'90082614314',chnl_prod_no:'12538103461',prod_nm:'Synthetic advertised product',search_nginx_pageid:'synthetic-new-request'}),
 'data-shp-contents-provider-dtl':pairs({adsr_type:'SHOPN',chnl_no:'500241555',brandstore_type:'y'}),
 'data-nlog-params':JSON.stringify({is_ad:true,filter_con:{items:[{key:'pgn',value:'2'}]}})}))a.setAttribute(k,v);
 const result=w.eval('('+e.api.inspectProducts.toString()+')')();
 assert.equal(result.records.length,1);const x=result.records[0];assert.equal(x.nvMid,'90082614314');assert.equal(x.chnlProdNo,'12538103461');assert.equal(x.storeUrl,'');assert.equal(x.searchRequestId,'synthetic-new-request');assert.equal(x.observedPage,2);assert.equal(x.isAd,true);dom.window.close();
});
test('catalog verification checks product identity and catalog ID and does not inherit another seller advertisement',async()=>{
 const e=await runtime();const offer={mallSeq:'100',nvMid:'9999999999',chnlNo:'200',chnlProdNo:'1111111111',productUrl:'https://smartstore.naver.com/expected/products/1111111111',isSmartStoreProduct:true,advertiserType:'SHOPN',matchNvMid:'8888888888'};
 const result=e.api.toNaverCatalogOffer(offer,'8888888888',[item({isAd:true,mallSeq:'555'})],'test',1);
 assert.equal(result.catalogVerified,true);assert.equal(result.isAd,false);assert.deepEqual(C.flagList(result),['원부상품']);
 assert.equal(e.api.toNaverCatalogOffer({...offer,matchNvMid:'7777777777'},'8888888888',[],'test',1),null);
 assert.equal(e.api.toNaverCatalogOffer({...offer,chnlProdNo:'2222222222'},'8888888888',[],'test',1),null);
});
test('sales special notes are empty for ordinary products, union verified flags when sellers consolidate',()=>{
 assert.deepEqual(C.flagList(item({productUrl:'',sellerCount:5})),[]);
 assert.deepEqual(C.flagList(item({isAd:true,catalogVerified:true})),['검색광고','원부상품']);
 const r=C.filterProducts([item({isAd:true}),item({chnlProdNo:'222',catalogVerified:true,reviews:99})],{ads:'all'},[]);
 assert.equal(r.products.length,1);assert.deepEqual(C.flagList(r.products[0]),['검색광고','원부상품']);
 const excluded=C.filterProducts([item({sellerCount:1,catalogVerified:true})],{grouped:'exclude'},[]);assert.equal(excluded.products.length,0);
});
test('duplicate product observed again retains new advertising/catalog evidence without inflating counts',async()=>{
 const e=await runtime(),c={products:[]};
 e.api.reconcilePage(c,'test',1,[item()],[],{});
 const metrics=e.api.reconcilePage(c,'test',2,[item({isAd:true})],[item({fromCatalog:true,catalogVerified:true})],{});
 assert.equal(c.products.length,1);assert.equal(metrics.added,0);assert.deepEqual(C.flagList(c.products[0]),['검색광고','원부상품']);
});
test('ad request refresh alone cannot confirm unchanged organic products with missing response evidence',async()=>{
 const e=await runtime(),j=e.api.setJob(),before=listing(1,'old');before.records.push(item({isAd:true,observedPage:1,searchRequestId:'old'}));
 const after=listing(2,'');after.records.push(item({isAd:true,observedPage:2,searchRequestId:'new'}));
 e.api.override({inspect:async()=>after,inspectPager:async()=>({domCurrent:2,urlPage:1})});
 await assert.rejects(()=>e.api.waitForPricePageChange(j,1,2,e.api.pageEvidence(before),1,3000),/페이지 이동 확인 실패/);
});
