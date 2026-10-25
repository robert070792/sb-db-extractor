'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {runtime,item,workKey,root}=require('./helpers/runtime.cjs');
const url='https://search.shopping.naver.com/search/all?query=test&pagingIndex=3';
async function fixture({stuck=false,normal=false,onPause}={}){
 let clock=0,bounds={left:1300,top:2000,right:1340,bottom:2030,width:40,height:30},selected=3;
 const events=[],e=await runtime({onPause:ms=>{clock+=ms;onPause?.(f,ms);}});
 const d=new JSDOM('<div class="pagination_num_test"><a class="pagination_btn_page_test" data-shp-contents-type="pageNo" href="#">1</a><strong aria-current="page">3</strong></div>',{url,runScripts:'outside-only',pretendToBeVisual:true}),w=d.window;
 const button=w.document.querySelector('a');w.performance.now=()=>clock;
 w.HTMLElement.prototype.getBoundingClientRect=()=>({...bounds});
 button.scrollIntoView=()=>{events.push('position');if(normal)bounds={left:100,top:300,right:140,bottom:330,width:40,height:30};};
 w.scrollBy=({left,top})=>{events.push('adjust');if(!stuck)bounds={...bounds,left:bounds.left-left,right:bounds.right-left,top:bounds.top-top,bottom:bounds.bottom-top};};
 w.document.elementFromPoint=(x,y)=>x>=bounds.left&&x<=bounds.right&&y>=bounds.top&&y<=bounds.bottom?button:null;
 button.onclick=ev=>{ev.preventDefault();selected=1;events.push('click:1');};
 const run=(...args)=>w.eval('('+e.api.clickPricePagination.toString()+')')(...args);
 e.chrome.scripting.executeScript=async({args})=>[{result:run(...args)}];
 const f={e,w,button,events,run,advance:ms=>clock+=ms,setBounds:v=>bounds={...bounds,...v},get selected(){return selected;},close:()=>w.close()};return f;
}
test('3 to 1 navigation corrects offscreen position before one actual click',async()=>{
 const f=await fixture();try{
 const e=f.e,j=e.api.setJob(),href=f.w.location.href;
 e.api.override({inspect:async()=>({url,records:[item({observedPage:3})]}),inspectPager:async()=>({domCurrent:f.selected,urlPage:3,confidence:'high'}),waitForPricePageChange:async()=>{assert.equal(f.selected,1);return {pager:{domCurrent:1},actual:1,proof:'fixture page changed after actual click'};}});
 await e.api.navigatePrice(j,1,'test',1);assert.deepEqual(f.events,['position','position','adjust','click:1']);assert.equal(f.w.location.href,href);assert.equal(e.requests.length,0);
 const evidence=f.w.__sbPageWatch323.clickViewport;assert.equal(evidence.unobstructed,true);assert(evidence.x>0&&evidence.x<f.w.innerWidth);assert(evidence.y>0&&evidence.y<f.w.innerHeight);
 }finally{f.close();}
});
test('visible portion of partially clipped button can be clicked without insisting on entire rectangle',async()=>{
 const f=await fixture();try{
 f.setBounds({left:-2,right:38,top:300,bottom:330});assert(f.run(1,3,true).ok);f.advance(650);
 const result=f.run(1,3);assert(result.ok);assert.equal(result.clickViewport.x,19);assert.equal(result.clickViewport.clipped.left,0);assert.deepEqual(f.events,['position','click:1']);
 }finally{f.close();}
});
test('visual viewport offsets are respected when choosing the visible click point',async()=>{
 const f=await fixture();try{
 Object.defineProperty(f.w,'visualViewport',{value:{offsetLeft:100,offsetTop:200,width:400,height:300}});
 f.setBounds({left:90,right:130,top:205,bottom:235});assert(f.run(1,3,true).ok);f.advance(650);const result=f.run(1,3);
 assert(result.ok);assert.equal(result.clickViewport.x,115);assert.equal(result.clickViewport.screen.left,100);assert.equal(result.clickViewport.screen.bottom,500);
 }finally{f.close();}
});
test('layout movement during first wait is repositioned before clicking, not clicked mid-movement',async()=>{
 let waits=0;const f=await fixture({normal:true,onPause:g=>{if(++waits===1)g.setBounds({top:330,bottom:360});}});try{
 const result=await f.e.api.clickPage(1,1,3,f.e.api.setJob());assert(result.ok);assert.equal(result.positionAttempts.length,2);assert.equal(result.positionAttempts[0].code,'BUTTON_MOVED');assert.deepEqual(f.events,['position','position','click:1']);
 }finally{f.close();}
});
test('persistent positioning failure stops after three preparations with no click and keeps exact reason and coordinates after restart',async()=>{
 const f=await fixture({stuck:true});try{
 const e=f.e,c={source:'price',mode:'auto',from:1,to:3,nextPage:1,keywords:['test'],keywordIndex:0,products:[],catalogProcessed:{},tabId:1};
 e.api.setState({running:true,collection:c});e.api.override({inspect:async()=>({url,records:[item({observedPage:3})]}),inspectPager:async()=>({domCurrent:3,urlPage:3,confidence:'high'})});
 await e.api.runJob(e.api.setJob());assert.equal(e.api.state.phase,'페이지 확인 대기');assert.match(e.api.state.stage,/클릭 가능한 영역이 화면 밖/);assert.doesNotMatch(e.api.state.stage,/상품 갱신 미확인/);
 assert.equal(c.nextPage,1);assert.equal(c.pageWait.fromPage,3);assert.equal(c.pageWait.requestFailure,null);assert.equal(c.pageWait.clickFailure.positionAttempts.length,3);assert.equal(c.pageWait.clickFailure.screen.width,f.w.innerWidth);
 assert.equal(f.events.filter(x=>x==='position').length,3);assert.equal(f.events.filter(x=>x.startsWith('click')).length,0);assert.equal(e.requests.length,0);assert.equal(f.w.__sbSearchNetwork325,undefined);
 const restored=await runtime({disk:e.disk});assert.equal(restored.api.state.collection.pageWait.clickFailure.viewport.left,1300);
 }finally{f.close();}
});
test('less than eight visible pixels is not accepted as a usable button',async()=>{
 const f=await fixture();try{
 f.setBounds({left:-35,right:5,top:300,bottom:330});f.run(1,3,true);f.advance(650);const result=f.run(1,3);assert.equal(result.code,'BUTTON_OUTSIDE');assert.equal(f.events.includes('click:1'),false);
 }finally{f.close();}
});
test('cancellation on positioning retry prevents final click',async()=>{
 let waits=0,j;const f=await fixture({onPause:()=>{if(++waits===2)j.cancelled=true;}});try{
 j=f.e.api.setJob();await assert.rejects(()=>f.e.api.clickPage(1,1,3,j),/중단/);assert.equal(f.events.includes('click:1'),false);
 }finally{f.close();}
});
test('exported diagnostic includes click failure coordinates without classifying it as a network error',async()=>{
 const clickFailure={targetPage:1,fromPage:3,code:'BUTTON_OUTSIDE',viewport:{top:2000},screen:{height:768},positionAttempts:[{attempt:1}]};
 const e=await runtime({disk:{[workKey]:{settings:{catalogLookup:false},startedAt:123,phase:'페이지 확인 대기',stage:'버튼 위치 확인 필요',collection:{source:'price',mode:'auto',products:[],from:1,to:3,nextPage:1,keywords:['test'],keywordIndex:0,pageWait:{keyword:'test',page:1,fromPage:3,reason:'버튼 위치 확인 필요',clickFailure,requestFailure:null}},paused:true}}});
 const d=new JSDOM('',{url,runScripts:'outside-only'}),w=d.window,blobs=[];try{
 w.chrome={runtime:{lastError:null,sendMessage:(m,cb)=>e.send(m.action,m,{tab:{id:1,url}}).then(cb)},storage:{local:{get:(_,cb)=>{cb?.({});return Promise.resolve({});},set:()=>Promise.resolve()}}};
 w.setInterval=()=>0;w.ResizeObserver=class{observe(){}};w.URL.createObjectURL=b=>{blobs.push(b);return 'blob:fixture';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};
 w.eval(fs.readFileSync(path.join(root,'src/extract/panel.js'),'utf8'));await new Promise(r=>setImmediate(r));
 w.document.getElementById('sb-all-save').click();const reader=new w.FileReader();const raw=await new Promise(resolve=>{reader.onload=()=>resolve(reader.result);reader.readAsText(blobs[0]);});
 const report=JSON.parse(raw.replace(/^\uFEFF/,''));assert.deepEqual(report.collection.waiting.clickFailure,clickFailure);assert.equal(report.collection.waiting.requestFailure,null);
 }finally{w.close();}
});
