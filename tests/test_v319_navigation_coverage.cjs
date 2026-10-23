'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../src/extract/worker-addon.js','utf8');
const cut=(prefix,next)=>{const a=src.indexOf('  async function '+prefix+'(');const b=src.indexOf('  '+next+'(',a+10);assert(a>=0&&b>a,`${prefix} markers`);return src.slice(a,b)};
(async()=>{
 const {runtime}=require('./helpers/runtime.cjs');
 const e=await runtime(),j=e.api.setJob();let clicks=0;
 e.api.override({ensureKeyword:async()=>{},inspectPager:async()=>({current:1,domCurrent:1,urlPage:1,confidence:'high'}),
   inspect:async()=>({records:[{mallSeq:'100',chnlProdNo:'111'}]}),scrollFooter:async()=>{},scrollTop:async()=>{},
   clickPage:async()=>{clicks++;return {ok:true,clickedPage:2};},
   waitForPricePageChange:async()=>({actual:2,pager:{domCurrent:2},proof:'synthetic list changed'})});
 await e.api.navigatePrice(j,1,'test',2);
 assert.equal(clicks,1);
 console.log('PASS v3.21 actual-number click route; direct tab updates forbidden by fixture');
 // New candidate diagnostic: an otherwise valid primary link + a different primary link missing merchant ID.
 const anchorAttrs={'data-shp-area':'lst*N.title','data-shp-contents-provider-id':'52301','data-shp-contents-provider-type':'mall_seq','data-shp-contents-id':'83693975302',
 'data-shp-contents-dtl':JSON.stringify([{key:'chnl_prod_no',value:'3989938896'},{key:'prod_nm',value:'단일상품 제목'}]),
 'data-shp-contents-provider-dtl':JSON.stringify([{key:'adsr_type',value:'SHOPN'},{key:'chnl_no',value:'102938'}]),
 'data-nlog-params':JSON.stringify({filter_con:{items:[{key:'pgn',value:'1'}]}})};
 const card={nodeType:1,matches:()=>true,parentElement:null,innerText:'',querySelector:()=>null,querySelectorAll:(sel)=>sel==='a[data-shp-contents-provider-id]'?[anchor]:[]};
 const anchor={nodeType:1,tagName:'A',parentElement:card,attributes:[],href:'https://search.shopping.naver.com/search/all?query=x',textContent:'단일상품 제목',matches:()=>false,getAttribute:k=>anchorAttrs[k]??null};
 const weak={nodeType:1,tagName:'A',parentElement:card,attributes:[],href:'https://search.shopping.naver.com/search/all?query=x',textContent:'다른 상품 제목',matches:()=>false,getAttribute:k=>k==='data-shp-area'?'lst*N.title':k==='data-shp-contents-id'?'775533':null};
 const document={querySelectorAll:sel=>sel==='a[data-shp-area]'?[anchor,weak]:sel==='a[data-shp-contents-provider-id]'?[anchor]:[],body:{innerText:'정상 화면'},scrollingElement:{scrollHeight:1200}};
 const vmContext=vm.createContext({document,window:{scrollY:0,innerHeight:700},location:{href:'https://search.shopping.naver.com/search/all?query=x'},URL});
 const start=src.indexOf('  function inspectProducts(){'),end=src.indexOf('  function resetScrollToTop(){',start);
 vm.runInContext(src.slice(start,end),vmContext);
 const scan=vmContext.inspectProducts();
 assert.equal(scan.records.length,1);
 assert.equal(scan.representativeKeys.length,2);
 assert.equal(scan.representativeNoProviderKeys.length,1);
 console.log('PASS primary candidate count distinguishes missing provider from captured product');
})().catch(e=>{console.error(e);process.exitCode=1});
