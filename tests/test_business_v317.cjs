'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../src/background.js','utf8');
const cacheUrl='/api/extension/mall?mallSeq=';
function env(o={}){
 const calls=[],cookies=[];
 const fastPayload={success:true,sellerInfo:{identity:'1234567890',representName:'테스트상점',representativeName:'대표',representTelephoneNumber:'010-1234-5678',businessAddressInfo:{fullAddressInfo:'서울시'},isBusiness:true},channelName:'테스트상점',channelUid:'1234'};
 const chrome={permissions:{contains:async()=>true},runtime:{lastError:null},cookies:{get:({name},cb)=>{cookies.push(name);cb(o.noAuth?null:{value:'fake-secret'});}}};
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,type:'basic',headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(body)});
 const fetch=async(u,init={})=>{
  const url=String(u);calls.push({url,method:init.method||'GET',body:init.body,credentials:init.credentials});
  if(url.includes(cacheUrl))return response({data:o.cached??{exists:false}});
  if(url.includes('/store/seller-info'))return response(o.apiError?{success:false}:fastPayload,o.apiHttp||200);
  if(url.includes('/extension/business-info'))throw Error('LEGACY_CALLED');
  if(url.endsWith('/api/extension/mall'))return response({ok:true},o.saveError?500:200);
  throw Error('unknown '+url);
 };
 const context=vm.createContext({SBCore:require('../src/extract/core.js'),chrome,fetch,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Error,Promise,console});
 vm.runInContext(src,context);return {context,calls,cookies};
}
(async()=>{
 // 1 cache path no auth/paid
 {const e=env({cached:{exists:true,companyName:'캐시',phoneNumber:'010-9999-0000'}});
  const pre=await e.context.prepareBusinessLookup('100','','','','');assert.equal(pre.kind,'cached');
  const result=await e.context.executePreparedBusinessLookup(pre,'100');assert.equal(result.origin,'company-cache');assert.equal(e.calls.length,1);assert.equal(e.cookies.length,0);}
 // 2 no known store -> no legacy or latest, not attempted
 {const e=env();const pre=await e.context.prepareBusinessLookup('100','','https://smartstore.naver.com/main/products/55','','');assert.equal(pre.kind,'missing');
  const r=await e.context.executePreparedBusinessLookup(pre,'100');assert.equal(r.code,'STORE_URL_MISSING');assert.equal(r.attempted,false);assert.equal(e.calls.length,1);}
 // 3 company status store URL for smartstore
 {const e=env();const pre=await e.context.prepareBusinessLookup('100','','','https://smartstore.naver.com/bodajoeun','');assert.equal(pre.kind,'latest');
  const r=await e.context.executePreparedBusinessLookup(pre,'100');assert.equal(r.success,true);assert.equal(r.origin,'latest-api');
  assert.equal(e.calls.filter(x=>x.url.includes('/store/seller-info')).length,1);
  assert.equal(JSON.parse(e.calls.find(x=>x.url.includes('/store/seller-info')).body).url,'https://smartstore.naver.com/bodajoeun');
  assert.deepEqual(e.cookies,['NID_AUT','NID_SES']);assert(!e.calls.some(x=>x.url.includes('extension/business-info')));}
 // 4 brand saved product URL
 {const e=env();const pre=await e.context.prepareBusinessLookup('100','','','','https://brand.naver.com/decozio/products/3989938896');assert.equal(pre.kind,'latest');
  assert.equal(pre.storeUrl,'https://brand.naver.com/decozio');const r=await e.context.executePreparedBusinessLookup(pre,'100');assert.equal(r.success,true);}
 // 5 cache URL exists but no cached business
 {const e=env({cached:{exists:false,storeUrl:'https://smartstore.naver.com/bodajoeun'}});
  const pre=await e.context.prepareBusinessLookup('100','','','','');assert.equal(pre.kind,'latest');}
 // 6 no auth not silently legacy
 {const e=env({noAuth:true});const pre=await e.context.prepareBusinessLookup('100','https://brand.naver.com/decozio','','','');
  const r=await e.context.executePreparedBusinessLookup(pre,'100');assert.equal(r.success,false);assert.equal(r.code,'AUTH_REQUIRED');
  assert(!e.calls.some(x=>x.url.includes('/extension/business-info')));}
 // 7 failed api without duplicate fallback
 {const e=env({apiHttp:503});const r=await e.context.getBusinessInfo('100','123','https://smartstore.naver.com/bodajoeun','');
  assert.equal(r.success,false);assert.equal(e.calls.filter(x=>x.url.includes('/store/seller-info')).length,1);assert(!e.calls.some(x=>x.url.includes('/extension/business-info')));}
 // 8 save fail doesn't discard 010
 {const e=env({saveError:true});const r=await e.context.getBusinessInfo('100','123','https://smartstore.naver.com/bodajoeun','');
  assert.equal(r.success,true);assert.match(r.warning,/저장 실패/);}
 // 9 URL validation
 {const e=env();for(const u of ['https://smartstore.naver.com/main/products/123','https://smartstore.naver.com/inflow/products/1','https://evil.com/a','http://brand.naver.com/decozio','https://smartstore.naver.com.evil.com/a'])assert.equal(e.context.storeBaseUrl(u),'');}
 console.log('PASS 9 business tests: cache, no URL no legacy, status URL, brand, cache URL, no auth, no double calls, save warning, URL safety');
})().catch(e=>{console.error(e);process.exitCode=1});
