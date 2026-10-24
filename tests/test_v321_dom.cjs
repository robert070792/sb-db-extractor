'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {runtime,item,root}=require('./helpers/runtime.cjs');
function page(html='',url='https://search.shopping.naver.com/search/all?query=test'){
  const dom=new JSDOM(`<!doctype html><html><body>${html}</body></html>`,{url,runScripts:'outside-only'}),w=dom.window;
  w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30,left:0,top:0,right:100,bottom:30});
  w.HTMLElement.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};
  return dom;
}
const pairs=value=>JSON.stringify(Object.entries(value).map(([key,value])=>({key,value})));
function productCard(w,{mall='100',product='111',mid='1000',store='expected',channel='200',host='smartstore.naver.com',isAd=false,area='lst*N.title'}={}){
  const card=w.document.createElement('li');card.className='product_item_fixture';
  const a=w.document.createElement('a');a.href=`https://${host}/${store}/products/${product}`;a.textContent='Synthetic product description';
  for(const [key,value] of Object.entries({'data-shp-area':area,'data-shp-contents-provider-id':mall,'data-shp-contents-provider-type':'mall_seq','data-shp-contents-id':mid,
    'data-shp-contents-dtl':pairs({chnl_prod_no:product,prod_nm:'Synthetic product description',seller_count:1}),
    'data-shp-contents-provider-dtl':pairs({adsr_type:'SHOPN',chnl_no:channel,mall_nm:`Store ${store}`}),
    'data-nlog-params':JSON.stringify({is_ad:isAd,filter_con:{items:[{key:'pgn',value:'1'}]}})}))a.setAttribute(key,value);
  card.append(a);w.document.body.append(card);return a;
}
const call=(w,fn,...args)=>w.eval(`(${fn.toString()})`)(...args);

test('real search DOM: input events and magnifier click, never clear/expand/Enter',async()=>{
  const e=await runtime(),dom=page('<form><input data-focus-target="gnb-search-input"><button type="button" class="searchInput_button_clear_x" data-shp-area="GNB.del">X</button><button type="button" class="searchInput_button_arrow_x">expand</button><button type="button" class="searchInput_button_search_x" data-shp-area="GNB.search">search</button></form>'),w=dom.window;
  const clicks=[],events=[];for(const button of w.document.querySelectorAll('button'))button.onclick=()=>clicks.push(button.textContent);
  w.document.querySelector('input').addEventListener('input',()=>events.push('input'));
  w.document.querySelector('input').addEventListener('keydown',()=>events.push('keydown'));
  w.setTimeout=fn=>{queueMicrotask(fn);return 0;};
  const result=await call(w,e.api.performPriceKeywordSearch,'새 키워드');
  assert.equal(result.ok,true);assert.equal(w.document.querySelector('input').value,'새 키워드');
  assert.deepEqual(clicks,['search']);assert(events.includes('input'));assert(!events.includes('keydown'));dom.window.close();
});
test('missing magnifier holds the search without clicking a different button',async()=>{
  const e=await runtime(),dom=page('<form><input data-focus-target="gnb-search-input"><button type="button" class="searchInput_button_clear_x">X</button></form>'),w=dom.window;
  let clicks=0;w.document.querySelector('button').onclick=()=>clicks++;w.setTimeout=fn=>{queueMicrotask(fn);return 0;};
  const result=await call(w,e.api.performPriceKeywordSearch,'second');assert.equal(result.ok,false);assert.equal(clicks,0);dom.window.close();
});
test('numeric text selects the correct pagination link despite misleading tracking IDs',async()=>{
  const e=await runtime(),dom=page('<div class="pagination_num_fixture"><strong class="pagination_btn_page_current" aria-current="page">1</strong></div>'),w=dom.window;
  const group=w.document.querySelector('div'),clicks=[];
  for(let n=2;n<=10;n++){
    const a=w.document.createElement('a');a.className='pagination_btn_page_fixture';a.setAttribute('data-shp-contents-type','pageNo');a.setAttribute('data-shp-contents-id',String(99-n));a.href='#';a.textContent=String(n);a.onclick=event=>{event.preventDefault();clicks.push(n);};group.append(a);
  }
  assert.equal(call(w,e.api.inspectPricePagination).domCurrent,1);
  const clicked=call(w,e.api.clickPricePagination,2,1);assert.equal(clicked.clickedPage,2);assert.deepEqual(clicks,[2]);
  assert.equal(call(w,e.api.clickPricePagination,11,1).ok,false);assert.deepEqual(clicks,[2]);dom.window.close();
});
test('two-page pagination with one inactive link is supported',async()=>{
  const e=await runtime(),dom=page('<div class="pagination_num_fixture"><strong aria-current="page">1</strong><a class="pagination_btn_page_fixture" data-shp-contents-type="pageNo" href="#">2</a></div>'),w=dom.window;
  w.document.querySelector('a').onclick=event=>event.preventDefault();
  assert.equal(call(w,e.api.inspectPricePagination).domCurrent,1);assert.equal(call(w,e.api.clickPricePagination,2,1).clickedPage,2);dom.window.close();
});
test('a catalog representative without a seller ID survives collection for offer expansion',async()=>{
  const e=await runtime(),dom=page(),w=dom.window;productCard(w);
  const a=w.document.createElement('a');a.setAttribute('data-shp-area','lst*C.title');a.setAttribute('data-shp-contents-id','5000');a.href='https://search.shopping.naver.com/catalog/5000';a.textContent='Catalog with no merchant ID';w.document.body.append(a);
  const scan=call(w,e.api.inspectProducts);
  assert.equal(scan.representativeKeys.length,2);assert.equal(scan.records.length,2);
  const catalog=scan.records.find(x=>x.isCatalogRepresentative);assert.equal(catalog.catalogUrlId,'5000');assert.equal(catalog.mallSeq,'');
  const j=e.api.setJob();let called='';e.api.override({inspectCatalogOffers:async(_,id)=>{called=id;return {ok:true,totalKnown:true,totalCount:0,products:[]};}});
  e.api.state.settings.catalogLookup=true; // Explicit ON for the existing expansion regression.
  await e.api.expandCatalogsOnPage(j,{products:[]},'test',1,scan.records);assert.equal(called,'5000');dom.window.close();
});
test('real DOM conflicting URL metadata is marked before business lookup',async()=>{
  const e=await runtime(),dom=page(),w=dom.window,a=productCard(w);
  a.setAttribute('data-shp-contents-provider-dtl',pairs({adsr_type:'SHOPN',chnl_no:'200',mall_url:'https://smartstore.naver.com/other'}));
  const scan=call(w,e.api.inspectProducts),identity=e.api.enrichStoreUrls(scan.records);
  assert.equal(identity.products[0].identityConflict,true);assert.equal(identity.products[0].productUrl,'');dom.window.close();
});
test('conflicting primary seller metadata is held instead of borrowing a seller identity',async()=>{
  const e=await runtime(),dom=page(),w=dom.window,a=productCard(w);
  a.setAttribute('data-nlog-params',JSON.stringify({content_source:'999',content_id:'1000',filter_con:{items:[{key:'pgn',value:'1'}]}}));
  const row=call(w,e.api.inspectProducts).records[0];assert.equal(row.identityConflict,true);assert(row.identityIssues.includes('판매자 메타데이터 불일치'));dom.window.close();
});
test('an encoded advertisement destination with a different product number is held',async()=>{
  const e=await runtime(),dom=page(),w=dom.window,a=productCard(w,{isAd:true});
  a.href='https://cr.shopping.naver.com/click?target='+encodeURIComponent('https://smartstore.naver.com/expected/products/999');
  const row=e.api.enrichStoreUrls(call(w,e.api.inspectProducts).records).products[0];
  assert.equal(row.identityConflict,true);assert(row.identityIssues.some(x=>x.includes('상품번호')));dom.window.close();
});
test('forty observed products from one seller remain forty audit rows and one lookup',async()=>{
  const e=await runtime(),dom=page(),w=dom.window;
  for(let n=0;n<40;n++)productCard(w,{product:String(111+n),mid:String(1000+n)});
  const scan=call(w,e.api.inspectProducts);assert.equal(scan.records.length,40);assert.equal(scan.representativeKeys.length,40);
  e.api.override({inspect:async()=>scan,inspectPager:async()=>({current:1,domCurrent:1})});
  const collection={source:'price',mode:'current',searchUrl:w.location.href,from:1,to:1,nextPage:1,keywords:['test'],keywordIndex:0,products:[]};
  const state=e.api.setState({running:true,collection,settings:{grouped:'include',ads:'all'}});await e.api.runJob(e.api.setJob());
  assert.equal(state.phase,'완료',state.error);assert.equal(state.auditPages[0].searchProducts,40);assert.equal(state.auditRows.length,40);
  assert.equal(state.statistics.sameSeller,39);assert.equal(state.matched.length,1);assert.equal(e.requests.filter(x=>x.url.endsWith('/store/seller-info')).length,1);dom.window.close();
});
test('panel renders, keeps stop enabled during lookups, and exports the original 16 columns',async()=>{
  const e=await runtime(),state=e.api.setState({running:true,phase:'업체 조회',matched:[{...item(),productName:'Synthetic, "quoted" product',phoneNumber:'010-1234-5678',history:'Existing call history'}],auditPages:[{scanRepresentativeCandidates:2,scanCoverageUnverified:1,scanIncomplete:true}],auditRows:[]});
  e.api.setJob();const dom=page(),w=dom.window,blobs=[],downloads=[];
  w.chrome={runtime:{lastError:null,sendMessage:(message,callback)=>{e.send(message.action).then(callback);}},storage:{local:{get:(_,cb)=>{cb?.({});return Promise.resolve({});},set:()=>Promise.resolve()}}};
  w.setInterval=()=>0;w.ResizeObserver=class{observe(){}};w.confirm=()=>true;
  w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:fixture';};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
  w.eval(fs.readFileSync(path.join(root,'src/extract/panel.js'),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.document.querySelector('#sb-phase').textContent,state.phase);assert.equal(w.document.querySelector('#sb-stop').disabled,false);
  assert.match(w.document.querySelector('#sb-audit-summary').textContent,/식별 미완료 1개/);
  w.document.querySelector('#sb-download').click();assert.equal(blobs.length,1);assert.match(downloads[0],/\.csv$/);
  const reader=new w.FileReader();const content=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blobs[0]);});
  const lines=content.replace(/^\uFEFF/,'').split('\r\n');assert.equal((lines[0].match(/","/g)||[]).length+1,16);
  assert.match(lines[1],/Existing call history/);assert.match(lines[1],/"Synthetic, ""quoted"" product"/);dom.window.close();
});

test('complete offline workflow: two keywords, two pages, real DOM clicks, seller consolidation and phones',async()=>{
  const e=await runtime(),dom=page(),w=dom.window,searchClicks=[],pageClicks=[];
  let scrollY=0;
  Object.defineProperty(w.document.documentElement,'scrollHeight',{get:()=>1000});
  Object.defineProperty(w,'scrollY',{get:()=>scrollY});w.innerHeight=800;
  w.scrollTo=({top})=>{scrollY=Math.max(0,Math.min(200,top));};
  w.setTimeout=fn=>{queueMicrotask(fn);return 0;};
  function render(keyword,pageNumber){
    dom.reconfigure({url:`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${pageNumber}`});scrollY=0;
    w.document.body.innerHTML='<form><input data-focus-target="gnb-search-input"><button type="button" class="searchInput_button_search_fixture" data-shp-area="GNB.search">search</button></form><div class="pagination_num_fixture"></div>';
    const input=w.document.querySelector('input');input.value=keyword;
    w.document.querySelector('button').onclick=()=>{const next=input.value;searchClicks.push(next);render(next,1);};
    const unique=(keyword==='first'?0:2)+pageNumber;
    const cards=[productCard(w),productCard(w,{mall:String(100+unique),product:String(200+unique),mid:String(3000+unique),channel:String(500+unique),store:`store${unique}`,host:unique===4?'brand.naver.com':'smartstore.naver.com',isAd:unique===2})];
    for(const a of cards){const log=JSON.parse(a.getAttribute('data-nlog-params'));log.filter_con.items[0].value=String(pageNumber);a.setAttribute('data-nlog-params',JSON.stringify(log));}
    const group=w.document.querySelector('.pagination_num_fixture'),strong=w.document.createElement('strong');strong.setAttribute('aria-current','page');strong.textContent=String(pageNumber);group.append(strong);
    const a=w.document.createElement('a');a.className='pagination_btn_page_fixture';a.setAttribute('data-shp-contents-type','pageNo');a.textContent=String(pageNumber===1?2:1);a.href='#';
    a.onclick=event=>{event.preventDefault();const next=Number(a.textContent);pageClicks.push(`${keyword}:${next}`);render(keyword,next);};group.append(a);
  }
  render('initial',1);
  e.chrome.tabs.get=async()=>({id:1,status:'complete',url:w.location.href});
  e.chrome.scripting.executeScript=async({func,args=[]})=>[{result:call(w,func,...args)}];
  const collection={source:'price',mode:'auto',searchUrl:w.location.href,from:1,to:2,nextPage:1,keywords:['first','second'],keywordIndex:0,products:[],catalogProcessed:{},tabId:1};
  const state=e.api.setState({running:true,collection,settings:{grouped:'include',ads:'all'}});
  await e.api.runJob(e.api.setJob());
  assert.equal(state.phase,'완료',state.error);assert.deepEqual(searchClicks,['first','second']);assert.deepEqual(pageClicks,['first:2','second:2']);
  assert.equal(state.auditPages.length,4);assert.equal(state.auditPages.reduce((n,p)=>n+p.searchProducts,0),8);
  assert.equal(state.discovered,5);assert.equal(state.matched.length,5);assert.equal(state.review.length,0);
  assert.equal(e.requests.filter(x=>x.url.endsWith('/store/seller-info')).length,5);
  assert(state.matched.every(x=>/^010-\d{4}-\d{4}$/.test(x.phoneNumber)&&/\/products\/\d+$/.test(x.productUrl)));
  assert(state.matched.some(x=>x.productUrl.startsWith('https://brand.naver.com/')));dom.window.close();
});
