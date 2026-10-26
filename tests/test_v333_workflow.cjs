'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,item,workKey}=require('./helpers/runtime.cjs');
const rows=p=>[1,2,3].map(n=>item({nvMid:String(p*100+n),chnlProdNo:String(p*100+n),observedPage:p,searchRequestId:'r'+p}));
async function setup(change=true){
 let selected=1,productPage=1,ticks=0;
 const e=await runtime({onPause:()=>{if(++ticks===4){selected=2;if(change)productPage=2;}}});
 const c={source:'price',nextPage:2,products:[item()],keywordIndex:0};
 e.api.setState({settings:{manualPageNavigation:true,reloadAfterPageChange:false},collection:c});
 e.api.override({inspectPager:async()=>({domCurrent:selected,urlPage:productPage,confidence:'high'}),inspect:async()=>({url:'https://search.shopping.naver.com/search/all?query=test',records:rows(productPage)}),clickPage:async()=>{throw Error('Automatic click forbidden');}});
 e.chrome.tabs.reload=async()=>{throw Error('Reload forbidden');};
 return {e,c};
}
test('manual page change automatically verifies fresh products without click or reload',async()=>{
 const {e,c}=await setup();await e.api.navigatePrice(e.api.setJob(),1,'test',2);
 assert.equal(e.api.job.pageProof.page,2);assert.equal(c.products.length,1);assert.equal(e.requests.length,0);
 assert.equal(e.disk[workKey].collection.pageWait.fromPage,1);
});
test('manual selection alone cannot pass when old products remain',async()=>{
 const {e}=await setup(false);await assert.rejects(()=>e.api.navigatePrice(e.api.setJob(),1,'test',2),/페이지 이동 확인 실패/);assert.equal(e.api.job.pageProof,null);
});
test('manual wait honors stop and preserves collected products',async()=>{
 const {e,c}=await setup();e.api.override({inspectPager:async()=>{e.api.job.cancelled=true;return {domCurrent:1};}});
 await assert.rejects(()=>e.api.navigatePrice(e.api.setJob(),1,'test',2),/중단/);assert.equal(c.products.length,1);
});
test('saved manual wait verifies the target after restart using the persisted old-page baseline',async()=>{
 const {e}=await setup();await e.api.navigatePrice(e.api.setJob(),1,'test',2);
 const restored=await runtime({disk:e.disk});restored.api.override({inspectPager:async()=>({domCurrent:2,urlPage:2}),inspect:async()=>({url:'https://search.shopping.naver.com/search/all?query=test',records:rows(2)}),clickPage:async()=>{throw Error('Unexpected click');}});
 await restored.api.navigatePrice(restored.api.setJob(),1,'test',2);assert.equal(restored.api.job.pageProof.page,2);
});
