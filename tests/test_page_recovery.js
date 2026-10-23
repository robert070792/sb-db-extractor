const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,item}=require('./helpers/runtime.cjs');
test('recovery clicks the previous and target number, with no tab URL update',async()=>{
  const e=await runtime(),j=e.api.setJob(),clicks=[];let page=2;
  e.api.override({scrollFooter:async()=>{},scrollTop:async()=>{},inspectPager:async()=>({domCurrent:page}),inspect:async()=>({records:[item({observedPage:page,searchRequestId:'returned-baseline'})]}),
    clickPage:async(_,next)=>{clicks.push(next);page=next;return {ok:true,clickedPage:next};},
    waitForPricePageChange:async(_,__,___,baseline)=>{assert.deepEqual(Array.from(baseline.requests),['returned-baseline']);return {actual:2,proof:'changed products'};}});
  const result=await e.api.recoverPricePage(j,1,'test',2,1,'original');
  assert.equal(result.actual,2);assert.deepEqual(clicks,[1,2]);
});
test('a failed actual button recovery cannot report success',async()=>{
  const e=await runtime(),j=e.api.setJob();
  e.api.override({scrollFooter:async()=>{},scrollTop:async()=>{},inspectPager:async()=>({domCurrent:2}),clickPage:async()=>({ok:false})});
  await assert.rejects(()=>e.api.recoverPricePage(j,1,'test',2,1,'original'),/버튼을 찾지/);
});
test('page failure preserves preceding products and records a partial result',async()=>{
  const e=await runtime(),j=e.api.setJob();
  const collection={searchUrl:'https://search.shopping.naver.com/search/all?query=test',from:1,to:2,nextPage:2,products:[item()]};
  const state=e.api.setState({collection});
  e.api.override({navigatePrice:async()=>{throw Error('Synthetic product change failed');}});
  await e.api.collectPrice(j,collection,'test');
  assert.equal(state.incompletePages.length,1);assert.match(state.incompletePages[0],/2페이지/);
  assert.equal(collection.products.length,1);assert(state.logs.some(x=>x.includes('부분 완료')));
});
