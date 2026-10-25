'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {runtime}=require('./helpers/runtime.cjs');
async function fixture(options={}){
 const e=await runtime(options),d=new JSDOM('<div class="pagination_num_test"><strong aria-current="page">1</strong><a href="#" class="pagination_btn_page_test" data-shp-contents-type="pageNo">2</a></div>',{url:'https://search.shopping.naver.com/search/all?query=test',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window;
 const button=w.document.querySelector('a'),events=[];let bounds={left:100,top:2000,right:140,bottom:2030,width:40,height:30},clock=0;
 w.performance.now=()=>clock;
 w.HTMLElement.prototype.getBoundingClientRect=()=>bounds;
 button.scrollIntoView=opts=>{events.push(['scroll',opts.block]);bounds={...bounds,top:300,bottom:330};};
 w.document.elementFromPoint=()=>button;
 button.onclick=ev=>{ev.preventDefault();events.push(['click']);};
 const run=(...args)=>w.eval('('+e.api.clickPricePagination.toString()+')')(...args);
 return {e,d,w,button,events,run,advance:n=>clock+=n,setBounds:v=>bounds={...bounds,...v},close:()=>w.close()};
}
test('offscreen button is centered, waits, then clicks once with viewport evidence and no URL change',async()=>{
 const f=await fixture();try{
 const href=f.w.location.href,prepared=f.run(2,1,true);assert(prepared.ok);assert.deepEqual(f.events,[['scroll','center']]);
 f.advance(650);const result=f.run(2,1);assert(result.ok);assert.equal(result.clickViewport.waitedMs,650);assert.equal(result.clickViewport.unobstructed,true);assert.equal(result.clickViewport.y,315);
 assert.deepEqual(f.events,[['scroll','center'],['click']]);assert.equal(f.w.location.href,href);assert.equal(f.w.__sbPageWatch323.clickViewport.y,315);
 assert.equal(f.run(2,1).ok,false,'preparation must not be reused');
 }finally{f.close();}
});
for(const [name,change,reason] of [
 ['still offscreen',f=>f.setBounds({top:2000,bottom:2030}),'화면 밖'],
 ['overlay covers button',f=>{f.w.document.elementFromPoint=()=>f.w.document.body;},'가려져'],
 ['layout moves while waiting',f=>f.setBounds({top:330,bottom:360}),'위치가 바뀌어'],
 ['background tab',f=>Object.defineProperty(f.w.document,'visibilityState',{value:'hidden'}),'탭을 화면'],
 ['button replaced',f=>f.button.replaceWith(f.button.cloneNode(true)),'준비 상태'],
 ['button disabled',f=>{f.button.disabled=true;},'비활성화'],
 ['wait expired',f=>f.advance(5000),'만료'],
 ['wait too short',f=>f.advance(-600),'완료되지']
])test('no click or request monitoring when '+name,async()=>{
 const f=await fixture();try{
 assert(f.run(2,1,true).ok);f.advance(650);change(f);const result=f.run(2,1);
 assert.equal(result.ok,false);assert.match(result.reason,new RegExp(reason));assert.equal(f.events.filter(x=>x[0]==='click').length,0);assert.equal(f.w.__sbSearchNetwork325,undefined);
 }finally{f.close();}
});
test('worker waits 650ms between preparation and click and returns visibility failure intact',async()=>{
 let f;f=await fixture({onPause:ms=>{f.advance(ms);f.w.document.elementFromPoint=()=>f.w.document.body;}});try{
 const calls=[];f.e.chrome.scripting.executeScript=async({args})=>{calls.push(args);return [{result:f.run(...args)}];};
 const result=await f.e.api.clickPage(1,2,1,f.e.api.setJob());assert.equal(calls.length,2);assert.equal(calls[0][2],true);assert.equal(result.ok,false);assert.match(result.reason,/가려져/);
 assert.equal(f.events.filter(x=>x[0]==='click').length,0);
 }finally{f.close();}
});
test('stop during viewport wait cancels the click',async()=>{
 let f,j;f=await fixture({onPause:ms=>{f.advance(ms);j.cancelled=true;}});try{
 let calls=0;f.e.chrome.scripting.executeScript=async({args})=>{calls++;return [{result:f.run(...args)}];};j=f.e.api.setJob();
 await assert.rejects(()=>f.e.api.clickPage(1,2,1,j),/중단/);assert.equal(calls,1);assert.deepEqual(f.events,[['scroll','center']]);
 }finally{f.close();}
});
test('previous group button uses the same viewport preparation and validation',async()=>{
 const f=await fixture();try{
 f.w.document.body.innerHTML='<div class="pagination_pagination_test"><button class="pagination_prev_test">이전</button><div class="pagination_num_test"><strong>4</strong><a class="pagination_btn_page_test" data-shp-contents-type="pageNo">5</a></div></div>';
 const prev=f.w.document.querySelector('button');prev.scrollIntoView=f.button.scrollIntoView;prev.onclick=()=>f.events.push(['prev']);f.w.document.elementFromPoint=()=>prev;
 assert(f.run(2,4,true).ok);f.advance(650);const result=f.run(2,4);assert.equal(result.navigation,'prev');assert.equal(result.clickedPage,null);assert.deepEqual(f.events,[['scroll','center'],['prev']]);
 }finally{f.close();}
});

test('worker completes visible click after wait despite unrelated impression attributes changing',async()=>{
 let f;f=await fixture({onPause:ms=>{f.advance(ms);f.button.setAttribute('data-impression-observed','true');}});try{
 f.e.chrome.scripting.executeScript=async({args})=>[{result:f.run(...args)}];
 const result=await f.e.api.clickPage(1,2,1,f.e.api.setJob());assert(result.ok);assert.equal(result.clickViewport.waitedMs,650);assert.deepEqual(f.events,[['scroll','center'],['click']]);
 }finally{f.close();}
});
