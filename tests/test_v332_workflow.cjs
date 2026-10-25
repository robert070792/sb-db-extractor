'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,item}=require('./helpers/runtime.cjs');
async function scan({growUntil=10,maxSteps=30}={}){
 const e=await runtime();let samples=0;
 e.api.override({inspectPager:async()=>({domCurrent:2}),scrollTop:async()=>{},scroll:async()=>{},inspect:async()=>{
  samples++;const height=1000+Math.min(samples,growUntil)*100;
  return {records:[item({observedPage:2})],scrollY:height-700,viewHeight:700,scrollHeight:height};
 }});
 return {e,result:await e.api.loadScrollPage(e.api.setJob(),1,2,maxSteps),get samples(){return samples;}};
}
test('growing footer cannot end collection just because product count is unchanged',async()=>{
 const {e,result,samples}=await scan();assert(samples>=14);assert.equal(result.incomplete,false);
 assert.equal(result.scan.terminationReason,'bottom-stable');assert(result.scan.scrollTrace.at(-1).stableMs>=3200);
 assert(result.scan.scrollTrace.length<=12);assert.equal(e.requests.length,0);
 const audit={};e.api.recordScanAudit(audit,result.scan,'test',2);assert.equal(audit.scanScrollTrace.length,result.scan.scrollTrace.length);
});
test('continuously growing footer reaches budget as incomplete and preserves collected products',async()=>{
 const {result}=await scan({growUntil:100,maxSteps:12});assert.equal(result.incomplete,true);
 assert.equal(result.scan.terminationReason,'step-limit');assert.equal(result.products.length,1);
 assert.equal(result.scan.scrollTrace.at(-1).stableMs,0);
});
