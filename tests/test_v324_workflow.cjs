'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');const {runtime,item}=require('./helpers/runtime.cjs');
const pairs=x=>JSON.stringify(Object.entries(x).map(([key,value])=>({key,value})));
const call=(w,fn,...args)=>w.eval('('+fn.toString()+')')(...args);
function page(){const d=new JSDOM('<ul></ul><div class="pagination_num_fixture"><a class="pagination_btn_page_fixture" data-shp-contents-type="pageNo" href="#">1</a><span class="pagination_btn_page_fixture active"><span class="blind">현재 페이지</span>2</span><a class="pagination_btn_page_fixture" data-shp-contents-type="pageNo" href="#">3</a></div>',{url:'https://search.shopping.naver.com/search/all?query=test&pagingIndex=1',runScripts:'outside-only'});d.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});return d;}
function anchor(w,n,{kind='catalog',std='y',mid=String(5000+n),catalog=mid,href=`https://cr.shopping.naver.com/adcr?x=synthetic&nvMid=${mid}`,area=kind==='catalog'?'lst*C.title':kind==='ad'?'lst*A.title':'lst*N.title'}={}){
 const li=w.document.createElement('li');li.className='product_item_fixture';const a=w.document.createElement('a');a.textContent='Synthetic product '+n;a.href=href;
 const attrs={'data-shp-area':area,'data-shp-contents-id':mid,'data-shp-contents-dtl':pairs({prod_nm:'Synthetic product '+n,catalog_nv_mid:catalog,std_yn:std,...(kind==='catalog'?{}:{chnl_prod_no:String(7000+n)})}),'data-nlog-params':JSON.stringify({is_ad:kind==='ad',filter_con:{items:[{key:'pgn',value:'2'}]}})};
 if(kind!=='catalog')Object.assign(attrs,{'data-shp-contents-provider-id':String(100+n),'data-shp-contents-provider-type':'mall_seq','data-shp-contents-provider-dtl':pairs({adsr_type:'SHOPN',chnl_no:String(200+n)})});
 for(const [k,v] of Object.entries(attrs))a.setAttribute(k,v);li.append(a);w.document.querySelector('ul').append(li);return a;
}
test('52-card reported shape: 21 ordinary + 12 ads + 19 tracking-linked catalogs, no navigation',async()=>{
 const e=await runtime(),d=page(),w=d.window;try{
 let clicks=0;w.HTMLAnchorElement.prototype.click=()=>clicks++;
 for(let n=0;n<52;n++){const a=anchor(w,n,{kind:n<21?'ordinary':n<33?'ad':'catalog',std:n<33?'n':'y'});const image=a.cloneNode(true);image.setAttribute('data-shp-area',image.getAttribute('data-shp-area').replace('.title','.img'));a.parentElement.append(image);}
 const scan=call(w,e.api.inspectProducts);assert.equal(scan.representativeKeys.length,52);assert.equal(scan.records.length,52);assert.equal(scan.records.filter(x=>x.isCatalogRepresentative).length,19);assert.equal(scan.records.filter(x=>x.isAd).length,12);
 assert.equal(scan.representativeDetails.filter(x=>!scan.records.some(r=>r.representativeKey===x.key)).length,0);assert(scan.records.filter(x=>x.isCatalogRepresentative).every(x=>!x.mallSeq&&x.observedPage===2&&x.catalogEvidenceSource==='search-catalog-metadata'));
 assert.equal(clicks,0);assert.equal(e.requests.length,0);
 }finally{d.window.close();}
});
for(const [name,opts] of [['ordinary self reference',{kind:'ordinary',std:'n'}],['wrong area',{area:'lst*N.title'}],['not standard',{std:'n'}],['catalog mismatch',{catalog:'999'}],['URL mismatch',{href:'https://cr.shopping.naver.com/adcr?nvMid=999'}],['external host',{href:'https://example.com/adcr?nvMid=5001'}],['missing target ID',{href:'https://cr.shopping.naver.com/adcr?x=synthetic'}]])test(`catalog evidence rejects ${name}`,async()=>{
 const e=await runtime(),d=page();try{anchor(d.window,1,opts);const scan=call(d.window,e.api.inspectProducts);assert.equal(scan.records.filter(x=>x.isCatalogRepresentative).length,0);}finally{d.window.close();}
});
test('catalog representatives reach seller expansion and keep verified catalog notes',async()=>{
 const e=await runtime(),d=page();try{
 anchor(d.window,1);anchor(d.window,2);const scan=call(d.window,e.api.inspectProducts),calls=[];
 e.api.override({inspectCatalogOffers:async(_,id)=>{calls.push(id);return {ok:true,totalKnown:true,totalCount:1,products:[{mallSeq:'100',nvMid:'9000',chnlNo:'200',chnlProdNo:'111',productUrl:'https://smartstore.naver.com/expected/products/111',isSmartStoreProduct:true,advertiserType:'SHOPN',matchNvMid:id}]};}});
 const result=await e.api.expandCatalogsOnPage(e.api.setJob(),{products:[]},'test',2,scan.records);assert.deepEqual(calls,['5001','5002']);assert.equal(result.counts.catalogsSucceeded,2);assert(result.expanded.every(x=>x.catalogVerified&&x.fromCatalog&&!x.isAd));
 const c={products:[]};const audit=e.api.reconcilePage(c,'test',2,scan.records,result.expanded,result.counts);assert.equal(audit.searchProducts,2);assert.equal(audit.rawCatalogRepresentatives,2);assert.equal(c.products.length,1);assert.equal(e.requests.length,0);
 }finally{d.window.close();}
});
test('active page ignores nested accessibility text without requiring nine numeric links',async()=>{
 const e=await runtime(),d=page();try{const pager=call(d.window,e.api.inspectPricePagination);assert.equal(pager.domCurrent,2);assert.equal(pager.urlPage,1);assert.equal(pager.method,'페이지네이션 내 활성 번호');}finally{d.window.close();}
});
const listing=(page,request)=>({records:[1,2,3].map(n=>item({mallSeq:String(100+n),chnlProdNo:String(111+n),nvMid:String(1000+n),observedPage:page,searchRequestId:request}))});
test('reported false success: new request ID and page metadata without render/response must fail',async()=>{
 const e=await runtime(),j=e.api.setJob(),after={...listing(2,'changed'),lifecycle:{fromPage:1,targetPage:2,ageMs:3072,quietMs:3072,organicAdded:0,organicRemoved:0,productNodesAdded:0,productNodesRemoved:0,responses:[]}};
 e.api.override({inspect:async()=>after,inspectPager:async()=>({domCurrent:2,urlPage:1})});
 await assert.rejects(()=>e.api.waitForPricePageChange(j,1,2,e.api.pageEvidence(listing(1,'old')),1,4000),/페이지 이동 확인 실패/);
 assert.equal(e.api.state.pageTransitions[0].requestChanged,true);assert.equal(e.api.state.pageTransitions[0].result,'unverified');
});
test('delayed target loading is verified without returning to the previous page',async()=>{
 let ms=0,selected=1;const e=await runtime({onPause:n=>ms+=n}),j=e.api.setJob(),clicks=[];
 e.api.override({scrollFooter:async()=>{},scrollTop:async()=>{throw Error('unexpected top scroll');},inspectPager:async()=>({domCurrent:selected}),
 inspect:async()=>selected===1?listing(1,'old'):ms<3000?{...listing(2,'old'),loading:true}:{...listing(2,'new'),lifecycle:{fromPage:1,targetPage:2,ageMs:ms,quietMs:1000,organicAdded:3,organicRemoved:3,responses:[]}},
 clickPage:async(_,p)=>{clicks.push(p);selected=p;return {ok:true,clickedPage:p};}});
 await e.api.navigatePrice(j,1,'test',2);assert.deepEqual(clicks,[2]);assert(ms>=3000);assert.equal(j.pageProof.page,2);
});
test('loading that never settles does not trigger recovery clicks',async()=>{
 const e=await runtime(),j=e.api.setJob(),clicks=[];let page=1;e.api.override({scrollFooter:async()=>{},inspectPager:async()=>({domCurrent:page}),inspect:async()=>({...listing(page,'old'),loading:page===2}),clickPage:async(_,p)=>{clicks.push(p);page=p;return {ok:true,clickedPage:p};}});
 await assert.rejects(()=>e.api.navigatePrice(j,1,'test',2),/페이지 이동 확인 실패/);assert.deepEqual(clicks,[2]);
});
test('repeated unverified page cannot be counted as collected even with request metadata proof',async()=>{
 const e=await runtime(),j=e.api.setJob(),rows=listing(2,'new').records,c={from:1,to:2,nextPage:2,products:rows,previousSignature:rows.map(x=>x.mallSeq+':'+x.nvMid).sort().join('|')};e.api.setState({collection:c});
 e.api.override({navigatePrice:async()=>{j.pageProof={page:2,requestProof:true,requests:['new']};},loadScrollPage:async()=>({products:rows}),scrollTop:async()=>{}});
 await assert.rejects(()=>e.api.collectPrice(j,c,'test'),/이전 페이지와 같습니다/);assert.equal(e.api.state.auditPages.length,0);assert.equal(e.api.state.incompletePages.length,1);
});
test('first page proof is not labeled repeated; actual repeated page is labeled separately',async()=>{
 const e=await runtime(),j=e.api.setJob(),c={from:1,to:2,nextPage:1,products:[],catalogProcessed:{}};e.api.setState({collection:c});
 e.api.override({navigatePrice:async(_,__,___,p)=>{j.pageProof={page:p,lifecycleProof:true};},loadScrollPage:async(_,__,p)=>({products:listing(p,'same').records,scan:{rawUnique:3,representativeCandidates:3,reconciledRepresentativeCount:3}}),expandCatalogsOnPage:async()=>({expanded:[],counts:{}})});
 await e.api.collectPrice(j,c,'test');assert.equal(e.api.state.auditPages[0].repeatedProductsVerified,false);assert.equal(e.api.state.auditPages[1].repeatedProductsVerified,true);assert.equal(c.products.length,3);
});
test('unresolved candidate counts separate repeated observations from unique candidates',async()=>{
 const e=await runtime();const unresolved=[{key:'product:5001:',nvMid:'5001',reason:'판매자번호 없음'}];
 for(const p of [1,2])e.api.recordScanAudit({}, {representativeCandidates:1,unresolvedCandidates:unresolved},'test',p);
 assert.equal(e.api.state.unidentifiedObservationCount,2);assert.equal(e.api.state.unidentifiedUniqueCandidates,1);assert(e.api.state.auditRows.every(x=>x.discoveryMethod==='unresolved'));
});
