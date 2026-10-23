'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../src/extract/worker-addon.js','utf8');
const start=source.indexOf('  function inspectProducts(){');
const end=source.indexOf('  function resetScrollToTop(){',start);
assert(start>0&&end>start);
function pairs(x){return JSON.stringify(Object.entries(x).map(([key,value])=>({key,value})));}
function makePage({host='brand.naver.com',slug='decozio',external=false,otherMall=false,ownUrl=false,merchantDifferent=false}={}){
 const card={nodeType:1,matches:()=>true,parentElement:null,innerText:'',querySelector:()=>null,querySelectorAll:(selector)=>{
  if(selector==='a[data-shp-contents-provider-id]')return merchantDifferent?[anchor,alien]:[anchor];
  if(selector==='a[href],a[data-url],a[data-href]')return external?[]:[anchor];return [];
 }};
 const url=`https://${host}/${slug}/products/3989938896`;
 const attributes={
  'data-shp-area':'lst*N.title','data-shp-contents-provider-id':'52301','data-shp-contents-provider-type':'mall_seq',
  'data-shp-contents-id':'83693975302',
  'data-shp-contents-dtl':pairs({chnl_prod_no:'3989938896',prod_nm:'데코지오 거실 커튼'}),
  'data-shp-contents-provider-dtl':pairs({adsr_type:'SHOPN',chnl_no:'102938'}),
  'data-nlog-params':JSON.stringify({filter_con:{items:[{key:'pgn',value:'1'}]}}),
  'data-url':external?'':ownUrl?url:`https://cr.shopping.naver.com/v1/click?target=${encodeURIComponent(url)}`,
 };
 const anchor={nodeType:1,tagName:'A',parentElement:card,textContent:'데코지오 거실 커튼',href:'https://search.shopping.naver.com/search/all?query=%EC%BB%A4%ED%8A%BC',matches:()=>false,getAttribute:k=>attributes[k]??null};
 const alien={...anchor,getAttribute:k=>k==='data-shp-contents-provider-id'?'999999':anchor.getAttribute(k)};
 const document={querySelectorAll:()=>[anchor],body:{innerText:'정상 화면'},scrollingElement:{scrollHeight:1200}};
 const context=vm.createContext({document,window:{scrollY:0,innerHeight:800},location:{href:'https://search.shopping.naver.com/search/all?query=%EC%BB%A4%ED%8A%BC'},URL,Number,String,Map,Set,JSON,Math,Object,RegExp});
 vm.runInContext(source.slice(start,end),context);
 return context.inspectProducts();
}
const brand=makePage();assert.equal(brand.records.length,1);assert.equal(brand.records[0].storeUrl,'https://brand.naver.com/decozio');assert.equal(brand.records[0].productUrl,'https://brand.naver.com/decozio/products/3989938896');
const smart=makePage({host:'smartstore.naver.com',slug:'bodajoeun',ownUrl:true});assert.equal(smart.records[0].storeUrl,'https://smartstore.naver.com/bodajoeun');
const none=makePage({external:true});assert.equal(none.records[0].storeUrl,'');assert.equal(none.records[0].productUrl,'');
const mixed=makePage({merchantDifferent:true});assert.equal(mixed.records.length,1);assert.equal(mixed.records[0].storeUrl,'https://brand.naver.com/decozio');
console.log('PASS 4 DOM scenarios: encoded brand redirect, smartstore direct, no guessed URL, own anchor in multi-seller card');
