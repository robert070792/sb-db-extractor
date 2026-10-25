'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,item,workKey}=require('./helpers/runtime.cjs');
const url='https://search.shopping.naver.com/search/all?query=test&pagingIndex=1';
async function setup({grow=3,alwaysLoading=false,onPause}={}){
 let e,j;const b={y:0,height:1000,view:700,count:5,grow,scrolls:0,clickCalls:0,actualClicks:0,selected:1};
 e=await runtime({onPause:ms=>{if(b.y+b.view>=b.height&&b.grow>0){b.height+=2600;b.count+=10;b.grow--;}onPause?.(b,j,ms);}});
 const plan={id:'fixture:0:2',keyword:'test',targetPage:2,fromPage:1,beforeDocument:99,loadedDocument:100,loadedPage:1,phase:'reload-reserved',reloadCount:1,reclickIssued:false};
 const collection={source:'price',mode:'auto',nextPage:2,from:1,to:3,keywords:['test'],keywordIndex:0,products:[item()],reloadPlan:plan};
 e.api.setState({collection,settings:{reloadAfterPageChange:true,catalogLookup:false}});j=e.api.setJob();
 e.chrome.tabs.get=async()=>({status:'complete',url});e.chrome.tabs.reload=async()=>{throw Error('No additional reload allowed');};
 const records=()=>Array.from({length:b.count},(_,n)=>item({mallSeq:String(100+n),nvMid:String(1000+n),chnlProdNo:String(100+n),observedPage:1}));
 const inspect=async()=>({url,records:records(),loading:alwaysLoading,scrollY:b.y,scrollHeight:b.height,viewHeight:b.view});
 const click=async()=>{b.clickCalls++;assert.equal(plan.positioning.bottomConfirmed,true);assert.equal(b.grow,0);b.actualClicks++;b.selected=2;return {ok:true,clicked:true,clickedPage:2};};
 e.api.override({inspectPriceDocument:async()=>({timeOrigin:100,origin:'https://search.shopping.naver.com',path:'/search/all',keyword:'test',page:1}),inspect,inspectPager:async()=>({domCurrent:b.selected,urlPage:b.selected}),scroll:async()=>{b.scrolls++;b.y=Math.min(b.height-b.view,b.y+600);},clickPage:click,waitForPricePageChange:async()=>({actual:2,pager:{domCurrent:2},proof:'fixture target products confirmed'})});
 return {e,j,b,plan,collection,click,inspect};
}
test('reload recovery scrolls through successive lazy-load growth before preparing the target click',async()=>{
 const {e,j,b,plan,collection}=await setup();await e.api.reloadPricePage(j,1,'test',2,'fixture');
 assert.equal(b.grow,0);assert(b.scrolls>3);assert.equal(b.actualClicks,1);assert.equal(plan.positioning.last.products,35);assert(plan.positioning.stableMs>=1800);assert.equal(plan.phase,'verified');
 assert.equal(collection.products.length,1,'restored old page is not appended as target products');assert.equal(e.requests.length,0);
});
test('confirmed pre-click rejection releases reservation so resume can prepare again without another reload',async()=>{
 const {e,j,b,plan,click}=await setup({grow:0});e.api.override({clickPage:async()=>{b.clickCalls++;return {ok:false,clicked:false,code:'BUTTON_OUTSIDE',reason:'Synthetic button moved'};}});
 await assert.rejects(()=>e.api.reloadPricePage(j,1,'test',2,'fixture'),/button moved/);assert.equal(plan.reclickIssued,false);assert.equal(plan.phase,'reclick-not-sent');assert.equal(b.actualClicks,0);
 e.api.override({clickPage:click});await e.api.reloadPricePage(j,1,'test',2,'resume');assert.equal(plan.phase,'verified');assert.equal(plan.reloadCount,1);assert.equal(b.actualClicks,1);
});
test('missing click result retains reservation and resume verifies without another click',async()=>{
 const {e,j,b,plan}=await setup({grow:0});e.api.override({clickPage:async()=>{b.clickCalls++;return undefined;},waitForPricePageChange:async()=>{throw Error('Unconfirmed existing request');}});
 await assert.rejects(()=>e.api.reloadPricePage(j,1,'test',2,'fixture'),/버튼을 확인/);assert.equal(plan.reclickIssued,true);
 await assert.rejects(()=>e.api.reloadPricePage(j,1,'test',2,'resume'),/Unconfirmed/);assert.equal(b.clickCalls,1);assert.equal(plan.reloadCount,1);
});
test('continuous loading cannot pass footer stabilization or consume a click reservation',async()=>{
 const {e,j,b,plan}=await setup({grow:0,alwaysLoading:true});
 await assert.rejects(()=>e.api.settleReloadPagination(j,1,'test',1,plan),/하단 로딩이 안정되지/);assert.equal(plan.reclickIssued,false);assert.equal(b.actualClicks,0);assert.equal(b.scrolls,0);
});
test('page change during footer loading prevents further scrolling and clicking',async()=>{
 const {e,j,b,plan}=await setup({grow:0,onPause:b=>{if(b.scrolls)b.selected=3;}});
 await assert.rejects(()=>e.api.settleReloadPagination(j,1,'test',1,plan),/페이지 또는 검색어/);assert.equal(b.scrolls,1);assert.equal(b.actualClicks,0);assert.equal(plan.reclickIssued,false);
});
test('stop during footer stabilization prevents re-click and preserves existing products',async()=>{
 const {e,j,b,plan,collection}=await setup({onPause:(b,j)=>{if(b.scrolls)j.cancelled=true;}});
 await assert.rejects(()=>e.api.reloadPricePage(j,1,'test',2,'fixture'),/중단/);assert.equal(b.actualClicks,0);assert.equal(plan.reclickIssued,false);assert.equal(collection.products.length,1);
});
test('v3.30 known no-click failure can resume but ambiguous or sent reservations remain protected',async()=>{
 for(const known of [true,false]){
  const plan={id:'old',phase:'reclick-reserved',reclickIssued:true,reloadCount:1},failure=known?{ok:false,code:'BUTTON_OUTSIDE',positionAttempts:[{ok:false,code:'BUTTON_OUTSIDE'}]}:null;
  const e=await runtime({disk:{[workKey]:{settings:{reloadAfterPageChange:true,catalogLookup:false},collection:{reloadPlan:plan,pageWait:{clickFailure:failure},products:[item()]},pageReloads:[plan]}}});
  assert.equal(e.api.state.collection.reloadPlan.reclickIssued,!known);assert.equal(e.api.state.pageReloads[0].reclickIssued,!known);assert.equal(e.api.state.collection.products.length,1);
 }
});
