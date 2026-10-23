'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,C,item,response,ledgerKey,workKey}=require('./helpers/runtime.cjs');
const paid=e=>e.requests.filter(x=>x.url.endsWith('/store/seller-info'));

test('product number and known store must agree with a direct or tracked URL',()=>{
  assert.equal(C.cleanProductUrl('https://smartstore.naver.com/other/products/999','https://smartstore.naver.com/expected','111'),'');
  assert.equal(C.cleanProductUrl('https://smartstore.naver.com/expected/products/999','https://smartstore.naver.com/expected','111'),'');
  assert.equal(C.cleanProductUrl('https://cr.shopping.naver.com/click?url='+encodeURIComponent('https://brand.naver.com/other/products/111'),'https://smartstore.naver.com/expected','111'),'');
  assert.equal(C.cleanProductUrl('', 'https://smartstore.naver.com/expected','111'),'https://smartstore.naver.com/expected/products/111');
});
test('main placeholder stays only in observed data until an actual store is known',()=>{
  const raw='https://smartstore.naver.com/main/products/111';
  const x=C.enrichStoreUrls([item({storeUrl:'',productUrl:raw})]).products[0];
  assert.equal(x.productUrl,'');assert.equal(x.observedProductUrl,raw);
  assert.equal(C.cleanProductUrl(raw,'https://brand.naver.com/expected','111'),'https://brand.naver.com/expected/products/111');
  assert.equal(C.cleanProductUrl(raw,'https://brand.naver.com/expected','222'),'');
});
test('seller URL and channel conflicts hold every related row and send no requests',async()=>{
  for(const extra of [{storeUrl:'https://smartstore.naver.com/other'},{chnlNo:'999'}]){
    const e=await runtime(),identity=C.enrichStoreUrls([item(),item({chnlProdNo:'222',...extra})]);
    assert.equal(identity.conflicts.length,1);assert(identity.products.every(x=>x.identityConflict));
    const state=e.api.setState({pending:identity.products,total:2});
    await e.api.processPending(e.api.setJob());
    assert.equal(e.requests.length,0);assert.equal(state.matched.length,0);assert.equal(state.review.length,2);
    assert.equal(state.seen.length,0);assert.equal(Object.keys(e.api.ledger).length,0);
  }
});
test('company cache cannot silently override contradictory observed store evidence',async()=>{
  const e=await runtime({cache:{exists:true,phoneNumber:'010-1234-5678',storeUrl:'https://brand.naver.com/different'}});
  const prepared=await e.api.prepareBusinessLookup('100','https://smartstore.naver.com/expected','','','');
  assert.equal(prepared.kind,'conflict');
  assert.equal((await e.api.executePreparedBusinessLookup(prepared,'100')).attempted,false);assert.equal(paid(e).length,0);
});
test('010 in the alternative field is selected and both source contacts are preserved',async()=>{
  const e=await runtime({payload:{success:true,sellerInfo:{identity:'1234567890',representTelephoneNumber:'02-123-4567',contactInfo:{telNo:{formattedNumber:'010-9876-5432'}}}}});
  const state=e.api.setState({pending:[item()],total:1});await e.api.processPending(e.api.setJob());
  assert.equal(state.matched[0].phoneNumber,'010-9876-5432');assert.equal(state.matched[0].phoneCandidates.length,2);
  assert.equal(JSON.parse(e.requests.find(x=>x.method==='POST'&&x.url.endsWith('/api/extension/mall')).body).phoneNumber,'010-9876-5432');
});
test('international-format Korean mobile numbers are normalized without accepting landlines',()=>{
  assert.equal(C.mobile010('+82 10-1234-5678'),'010-1234-5678');assert.equal(C.mobile010('+82 (0)10-1234-5678'),'010-1234-5678');
  assert.equal(C.mobile010('02-1234-5678'),'');assert.equal(C.mobile010('1010123456789'),'');
});
test('no-010 hold preserves the business name, contact, address and product evidence',async()=>{
  const e=await runtime({cache:{exists:true,ceoName:'Synthetic owner',phoneNumber:'02-123-4567',address:'Synthetic address'},payload:{success:true,sellerInfo:{representativeName:'Synthetic owner',representTelephoneNumber:'02-123-4567',businessAddressInfo:{fullAddressInfo:'Synthetic address'}}}});
  const state=e.api.setState({pending:[item()],total:1});await e.api.processPending(e.api.setJob());
  assert.equal(state.matched.length,0);assert.equal(state.review.length,1);
  assert.equal(state.review[0].phoneNumber,'02-123-4567');assert.equal(state.review[0].ceoName,'Synthetic owner');
  assert.equal(state.review[0].address,'Synthetic address');assert.equal(paid(e).length,1);
});
test('missing Naver authentication never records a paid attempt and works after login',async()=>{
  const e=await runtime({noAuth:true}),state=e.api.setState({pending:[item()],total:1}),j=e.api.setJob();
  await e.api.processPending(j);
  assert.equal(paid(e).length,0);assert.equal(state.lookupAttempted.length,0);assert.equal(state.seen.length,0);
  assert.equal(Object.keys(e.api.ledger).length,0);
  e.options.noAuth=false;state.pending=[item()];await e.api.processPending(j);
  assert.equal(paid(e).length,1);assert.equal(state.matched.length,1);assert.equal(e.api.ledger['100'].status,'succeeded');
});
test('durable request history survives reset; a new run permits required refresh',async()=>{
  let e;
  e=await runtime({saveStatus:500,fetch:async(url,init,fallback)=>{
    if(url.endsWith('/store/seller-info'))assert.equal(e.disk[ledgerKey]['100'].status,'requested');
    return fallback(url,init);
  }});
  e.api.setState({pending:[item()],total:1});await e.api.processPending(e.api.setJob());
  assert.equal(paid(e).length,1);
  e.api.setJob(null);assert.equal((await e.send('sb:reset')).ok,true);
  assert(e.disk[ledgerKey]['100']);assert.equal(e.api.state.lookupAttempted[0],'100');
  e.api.setState({...e.api.state,pending:[item()],total:1});await e.api.processPending(e.api.setJob());
  assert.equal(paid(e).length,2);assert.equal(e.api.state.statistics.lookupPrevented,0);
  const restored=await runtime({disk:e.disk});assert(restored.api.lookupAlreadyRequested('100','https://smartstore.naver.com/expected'));
});
test('legacy request history migrates without dropping the independent ledger',async()=>{
  const e=await runtime({disk:{[workKey]:{lookupAttempted:['100'],running:false},[ledgerKey]:{'200':{status:'requested',storeUrl:'https://brand.naver.com/second'}}}});
  assert.equal(e.api.ledger['100'].status,'legacy-unknown');assert.equal(e.api.ledger['200'].status,'requested');
  await e.send('sb:reset');assert.equal(Object.keys(e.disk[ledgerKey]).length,2);
});
test('background restart preserves pending work and resume completes that work',async()=>{
  const e=await runtime({disk:{[workKey]:{running:true,pending:[item()],total:1,settings:{},processed:0,matched:[],review:[],seen:[]}}});
  assert.equal(e.api.state.running,false);assert.equal(e.api.state.paused,true);assert.equal(e.api.state.pending.length,1);
  await e.send('sb:resume');
  for(let n=0;n<100&&e.api.state.running;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(e.api.state.running,false);assert.equal(e.api.state.phase,'완료');assert.equal(e.api.state.matched.length,1);assert.equal(paid(e).length,1);
});
test('a storage write failure prevents the paid API call',async()=>{
  const e=await runtime(),state=e.api.setState({pending:[item()],total:1});e.failLedger=true;
  await e.api.processPending(e.api.setJob());
  assert.equal(paid(e).length,0);assert.equal(Object.keys(e.api.ledger).length,0);assert.equal(state.seen.length,0);
  assert.match(state.review[0].reason,/storage write failure/);
});
test('failure to finalize the ledger does not discard a successful phone result',async()=>{
  let e;e=await runtime({fetch:async(url,init,fallback)=>{
    if(url.endsWith('/store/seller-info'))e.failLedger=true;
    return fallback(url,init);
  }});
  const state=e.api.setState({pending:[item()],total:1});await e.api.processPending(e.api.setJob());
  assert.equal(paid(e).length,1);assert.equal(state.matched.length,1);assert.equal(e.disk[ledgerKey]['100'].status,'requested');
  assert(state.logs.some(x=>x.includes('이력 상태 갱신 실패')));
});
test('a dispatched failed request remains protected while company-cache recovery remains possible',async()=>{
  const e=await runtime({apiStatus:503}),j=e.api.setJob();e.api.setState({pending:[item()],total:1});
  await e.api.processPending(j);assert.equal(paid(e).length,1);assert.equal(e.api.ledger['100'].status,'outcome-unknown');
  e.api.setJob(null);await e.send('sb:reset');e.options.cache={exists:true,phoneNumber:'010-3333-4444'};
  e.api.setState({...e.api.state,pending:[item()],total:1});await e.api.processPending(e.api.setJob());
  assert.equal(paid(e).length,1);assert.equal(e.api.state.matched[0].phoneNumber,'010-3333-4444');
});
test('cancellation before dispatch cannot trigger a paid request',async()=>{
  const e=await runtime(),controller=new AbortController();controller.abort();
  const result=await e.api.executePreparedBusinessLookup({kind:'latest',storeUrl:'https://smartstore.naver.com/expected'},'100',{signal:controller.signal});
  assert.equal(result.attempted,false);assert.equal(paid(e).length,0);
});
test('stopping during cookie preflight cannot send a late request',async()=>{
  const e=await runtime(),callbacks=[];e.chrome.cookies.get=(_,cb)=>callbacks.push(cb);
  e.api.setState({running:true,pending:[item()],total:1});const j=e.api.setJob(),work=e.api.processPending(j);
  for(let n=0;n<100&&callbacks.length<2;n++)await Promise.resolve();
  assert.equal(callbacks.length,2);await e.send('sb:stop');assert.equal(j.cancelled,true);
  for(const callback of callbacks)callback({value:'synthetic-cookie'});
  await assert.rejects(()=>work,/중단/);assert.equal(paid(e).length,0);assert.equal(Object.keys(e.api.ledger).length,0);
});
test('pause and resume retain the pending item and send it only after resume',async()=>{
  const e=await runtime(),state=e.api.setState({running:true,pending:[item()],total:1}),j=e.api.setJob();
  await e.send('sb:pause');assert.equal(j.paused,true);
  const work=e.api.processPending(j);await Promise.resolve();assert.equal(paid(e).length,0);assert.equal(state.pending.length,1);
  await e.send('sb:resume');await work;assert.equal(paid(e).length,1);assert.equal(state.matched.length,1);
});
test('stopping during durable reservation clears a confirmed-unsent request',async()=>{
  const e=await runtime(),original=e.chrome.storage.local.set;let release;
  e.chrome.storage.local.set=value=>{
    if(value[ledgerKey]?.['100']?.status==='requested')return new Promise((resolve,reject)=>{release=()=>original(value).then(resolve,reject);});
    return original(value);
  };
  e.api.setState({running:true,pending:[item()],total:1});const j=e.api.setJob(),work=e.api.processPending(j);
  for(let n=0;n<100&&!release;n++)await Promise.resolve();assert(release);
  await e.send('sb:stop');release();await assert.rejects(()=>work,/중단/);
  assert.equal(paid(e).length,0);assert.equal(Object.keys(e.api.ledger).length,0);assert.equal(Object.keys(e.disk[ledgerKey]).length,0);
});
test('empty nested seller objects are a lookup failure rather than a no-010 company',async()=>{
  const e=await runtime({payload:{success:true,sellerInfo:{contactInfo:{},businessAddressInfo:{}}}});
  const result=await e.api.executePreparedBusinessLookup({kind:'latest',storeUrl:'https://smartstore.naver.com/expected'},'100');
  assert.equal(result.code,'NO_SELLER_DETAILS');assert.equal(result.attempted,true);
});
test('advertisement, review and group filters retain their behavior while consolidating sellers',()=>{
  const items=[item({isAd:true,reviews:5}),item({mallSeq:'101',chnlProdNo:'222',reviews:20}),item({mallSeq:'102',chnlProdNo:'333',reviews:null}),item({mallSeq:'103',chnlProdNo:'444',sellerCount:null})];
  const filtered=C.filterProducts(items,{ads:'exclude',grouped:'exclude',reviewsEnabled:true,minReviews:0,maxReviews:10},new Set());
  assert.equal(filtered.products.length,0);assert.equal(filtered.stats.adsExcluded,1);assert.equal(filtered.stats.filtered,1);assert.equal(filtered.stats.unknownReviews,1);assert.equal(filtered.stats.unknownGroup,1);
  const chosen=C.filterProducts([item(),item({chnlProdNo:'222',reviews:9})],{ads:'all',grouped:'include'},new Set());
  assert.equal(chosen.products.length,1);assert.equal(chosen.products[0].chnlProdNo,'222');assert.equal(chosen.stats.sameSeller,1);
});
test('a scan budget reached before the bottom is partial, never a complete-page claim',async()=>{
  const e=await runtime(),j=e.api.setJob();let n=0;
  e.api.override({scrollTop:async()=>{},scroll:async()=>{},inspect:async()=>({records:[item({nvMid:String(++n),chnlProdNo:String(n),observedPage:2})],scrollY:n*700,viewHeight:700,scrollHeight:1000000})});
  const result=await e.api.loadScrollPage(j,1,2,4);
  assert.equal(result.products.length,4);assert.equal(result.incomplete,true);assert.equal(result.scan.terminationReason,'step-limit');
});
test('bottom settling includes products arriving during the settling interval',async()=>{
  const e=await runtime(),j=e.api.setJob();let n=0;
  e.api.override({scrollTop:async()=>{},scroll:async()=>{},inspect:async()=>({records:(++n>=4?[item(),item({chnlProdNo:'222',nvMid:'2222'})]:[item()]).map(x=>({...x,observedPage:2})),scrollY:300,viewHeight:700,scrollHeight:1000})});
  const result=await e.api.loadScrollPage(j,1,2,20);
  assert.equal(result.products.length,2);assert.equal(result.incomplete,false);assert.equal(result.scan.terminationReason,'bottom-stable');assert(n>=8);
});
test('coverage gaps stay numeric, get per-product reasons, and force partial completion',async()=>{
  const e=await runtime(),j=e.api.setJob();
  const collection={source:'price',mode:'auto',keywords:['test'],keywordIndex:0,nextPage:1,from:1,to:1,searchUrl:'https://search.shopping.naver.com/search/all?query=test',products:[]};
  const state=e.api.setState({collection,settings:{grouped:'exclude',ads:'all'}});
  e.api.override({navigatePrice:async()=>{},loadScrollPage:async()=>({products:[item()],ads:0,scan:{representativeCandidates:2,rawUnique:1,unresolvedCandidates:[{key:'product:222:',nvMid:'222',title:'Missing seller',reason:'판매자번호 없음'}],terminationReason:'bottom-stable'}})});
  await e.api.runJob(j);
  assert.equal(state.auditPages[0].scanCoverageUnverified,1);assert.equal(JSON.parse(JSON.stringify(state.auditPages))[0].scanCoverageUnverified,1);
  assert(state.auditRows.some(x=>x.nvMid==='222'&&x.decision.includes('판매자번호 없음')));assert.equal(state.phase,'부분 완료');
});
for(const count of [20,25])test(`catalog total 25 vs ${count} unique offers: correct completion result`,async()=>{
  const e=await runtime(),j=e.api.setJob(),collection={products:[]};
  e.api.override({inspectCatalogOffers:async(_,id,page)=>({ok:true,totalKnown:true,totalCount:25,products:Array.from({length:page<3?10:count-20},(_,i)=>({mallSeq:String(page*100+i),nvMid:String(page*1000+i)}))})});
  const result=await e.api.expandCatalogsOnPage(j,collection,'test',1,[{catalogNvMid:'5000',catalogUrlId:'5000',nvMid:'5000',sellerCount:25}]);
  assert.equal(result.counts.apiOffers,count);assert.equal(result.counts.catalogsSucceeded,count===25?1:0);
  assert.equal(collection.catalogProcessed['5000'],count===25?'ok':'partial');
});
test('repeat catalog offers cannot count as additional collected products',async()=>{
  const e=await runtime(),j=e.api.setJob(),collection={products:[]};
  e.api.override({inspectCatalogOffers:async()=>({ok:true,totalKnown:true,totalCount:20,products:Array.from({length:10},(_,i)=>({mallSeq:String(i+1),nvMid:String(i+10)}))})});
  const result=await e.api.expandCatalogsOnPage(j,collection,'test',1,[{catalogUrlId:'5000',nvMid:'5000'}]);
  assert.equal(result.counts.apiOffers,10);assert.equal(result.counts.catalogsSucceeded,0);
});
test('the same business and mobile number are marked across different stores',async()=>{
  const e=await runtime(),state=e.api.setState({pending:[item(),item({mallSeq:'101',chnlNo:'201',storeUrl:'https://smartstore.naver.com/another'})],total:2}),j=e.api.setJob();
  await e.api.processPending(j);await e.api.flagSharedPhones(j);
  assert.equal(state.matched.length,2);assert.equal(state.phoneDuplicates,1);
  assert(state.matched.every(x=>x.memo.includes('사업자중복')&&x.memo.includes('동일전화번호')));
});
