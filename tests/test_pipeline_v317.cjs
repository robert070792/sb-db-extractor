'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,item}=require('./helpers/runtime.cjs');
for(const kind of ['missing','latest','cache'])test(`pipeline regression: ${kind}`,async()=>{
  const e=await runtime(kind==='cache'?{cache:{exists:true,ceoName:'Synthetic owner',phoneNumber:'010-3333-4444'}}:{});
  const state=e.api.setState({pending:[item(kind==='missing'?{storeUrl:'',nvMid:''}:{})],total:1});
  await e.api.processPending(e.api.setJob());
  assert.equal(state.pending.length,0);assert.equal(state.processed,1);assert.equal(state.statistics.checked,1);
  const paid=e.requests.filter(x=>x.url.endsWith('/store/seller-info'));
  if(kind==='missing'){
    assert.equal(state.statistics.bizUrlMissing,1);assert.equal(state.review.length,1);
    assert.equal(state.seen.length,0);assert.equal(state.lookupAttempted.length,0);assert.equal(state.matched.length,0);assert.equal(paid.length,0);
  }else{
    assert.equal(state.matched.length,1);assert.equal(state.matched[0].productUrl,'https://smartstore.naver.com/expected/products/111');
    assert.equal(state.seen.length,1);assert.equal(state.lookupAttempted.length,kind==='latest'?1:0);
    assert.equal(state.statistics[kind==='latest'?'bizLatest':'bizCached'],1);assert.equal(paid.length,kind==='latest'?1:0);
  }
});
