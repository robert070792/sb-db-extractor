const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,item}=require('./helpers/runtime.cjs');
test('unverified target page waits without automatic previous/target recovery clicks',async()=>{
  const e=await runtime(),j=e.api.setJob(),clicks=[];let page=1,footers=0;
  e.api.override({scrollFooter:async()=>{footers++;},scrollTop:async()=>{throw Error('unexpected scroll');},inspectPager:async()=>({domCurrent:page}),inspect:async()=>({records:[item({observedPage:page,searchRequestId:'same'})]}),
    clickPage:async(_,next)=>{clicks.push(next);page=next;return {ok:true,clickedPage:next};}});
  await assert.rejects(()=>e.api.navigatePrice(j,1,'test',2),/페이지 이동 확인 실패/);
  assert.deepEqual(clicks,[2]);assert.equal(footers,0);
});
test('missing target button fails without recovery or scrolling on a different page',async()=>{
  const e=await runtime(),j=e.api.setJob();let clicks=0;
  e.api.override({scrollFooter:async()=>{},inspect:async()=>({records:[item()]}),inspectPager:async()=>({domCurrent:1}),clickPage:async()=>{clicks++;return {ok:false};}});
  await assert.rejects(()=>e.api.navigatePrice(j,1,'test',2),/버튼을 찾지/);assert.equal(clicks,1);
});
test('page failure preserves preceding products and waits before business lookup',async()=>{
  const e=await runtime(),j=e.api.setJob();
  const collection={searchUrl:'https://search.shopping.naver.com/search/all?query=test',from:1,to:2,nextPage:2,products:[item()]};
  const state=e.api.setState({collection});
  e.api.override({navigatePrice:async()=>{throw Error('Synthetic product change failed');}});
  await assert.rejects(()=>e.api.collectPrice(j,collection,'test'),e=>e.code==='PAGE_WAIT');
  assert.equal(state.incompletePages.length,1);assert.match(state.incompletePages[0],/2페이지/);
  assert.equal(collection.products.length,1);assert.equal(collection.nextPage,2);assert.equal(collection.pageWait.page,2);assert(state.logs.some(x=>x.includes('확인 대기')));
});
