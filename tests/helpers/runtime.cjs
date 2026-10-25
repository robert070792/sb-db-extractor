'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const C=require(path.join(root,'src/extract/core.js'));
const worker=fs.readFileSync(path.join(root,'src/extract/worker-addon.js'),'utf8');
const background=fs.readFileSync(path.join(root,'src/background.js'),'utf8');
const workKey='sb_leads_v20_state',ledgerKey='sb_paid_lookup_ledger_v321';
function response(body,status=200){return {ok:status>=200&&status<300,status,type:'basic',headers:{get:()=> 'application/json'},json:async()=>body,text:async()=>JSON.stringify(body)};}
async function runtime(options={}){
  let disk=structuredClone(options.disk||{}),handler,now=Date.UTC(2026,9,24),failLedger=false;
  const requests=[],writes=[];
  const chrome={
    permissions:{contains:async()=>true},runtime:{lastError:null,onMessage:{addListener:fn=>{handler=fn;}}},
    cookies:{get:({name},cb)=>cb(options.noAuth?null:{value:`synthetic-${name}`})},
    storage:{local:{get:async()=>structuredClone(disk),set:async value=>{
      if(failLedger&&ledgerKey in value)throw Error('Synthetic storage write failure');
      writes.push(structuredClone(value));disk={...disk,...structuredClone(value)};
    }}},
    tabs:{get:async()=>({id:1,status:'complete',url:options.url||'https://search.shopping.naver.com/search/all?query=test'}),
      update:async()=>{throw Error('Direct tab updates are forbidden');},query:async()=>[]},
    scripting:{executeScript:async()=>{throw Error('No browser script fixture supplied');}}
  };
  const defaultFetch=async(url,init)=>{
    if(url.includes('/api/extension/store-status'))return response({data:options.status||{exists:false}});
    if(url.includes('/api/extension/mall?'))return response({data:options.cache||{exists:false}});
    if(url.endsWith('/store/seller-info'))return response(options.payload||{success:true,sellerInfo:{identity:'1234567890',representativeName:'Synthetic owner',representTelephoneNumber:'010-1234-5678',businessAddressInfo:{fullAddressInfo:'Synthetic address'}}},options.apiStatus||200);
    if(url.endsWith('/api/extension/mall')&&init.method==='POST')return response({ok:true},options.saveStatus||200);
    throw Error(`Unexpected mock URL: ${url}`);
  };
  const fetch=async(raw,init={})=>{
    const url=String(raw);requests.push({url,method:init.method||'GET',body:init.body});
    return options.fetch?options.fetch(url,init,defaultFetch):defaultFetch(url,init);
  };
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const ctx=vm.createContext({chrome,SBCore:C,SBShoppingParser:require(path.join(root,'src/extract/catalog-parser.js')),URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Date:TestDate,fetch,
    __advance:ms=>{now+=ms;options.onPause?.(ms);}});
  vm.runInContext(background,ctx);
  // Test-only exports and a deterministic clock; shipped source is evaluated otherwise unchanged.
  const exports=`
  globalThis.testApi={
    inspectOpenedStore,rememberOpenedStore,storeHints,inspectProducts,inspectPricePagination,clickPricePagination,clickPage,performPriceKeywordSearch,
    prepareBusinessLookup,executePreparedBusinessLookup,normalizeCachedData,
    enrichStoreUrls:C.enrichStoreUrls,processPending,collect,collectPrice,collectPlus,loadScrollPage,
    expandCatalogsOnPage,inspectCatalogOffers,toNaverCatalogOffer,fetchCatalogOfferPage,recordScanAudit,reconcilePage,
    pageEvidence,navigatePrice,ensureKeyword,waitForPricePageChange,runJob,flagSharedPhones,
    getState,lookupAlreadyRequested,recordLookupRequest,finishLookupRequest,
    get state(){return state;},get ledger(){return lookupLedger;},get job(){return job;},
    setState(value){state={...blank(),...value,statistics:{...blankStats(),...(value.statistics||{})}};return state;},
    setJob(value={tabId:1,cancelled:false,paused:false}){job=value;return value;},
    override(deps){
      if(deps.inspect)inspect=deps.inspect;
      if(deps.inspectPager)inspectPager=deps.inspectPager;
      if(deps.scrollTop)scrollTop=deps.scrollTop;
      if(deps.scroll)scroll=deps.scroll;
      if(deps.scrollFooter)scrollFooter=deps.scrollFooter;
      if(deps.clickPage)clickPage=deps.clickPage;
      if(deps.searchKeyword)searchKeyword=deps.searchKeyword;
      if(deps.waitForKeyword)waitForKeyword=deps.waitForKeyword;
      if(deps.waitForProducts)waitForProducts=deps.waitForProducts;
      if(deps.waitForPricePageChange)waitForPricePageChange=deps.waitForPricePageChange;
      if(deps.inspectCatalogOffers)inspectCatalogOffers=deps.inspectCatalogOffers;
      if(deps.navigatePrice)navigatePrice=deps.navigatePrice;
      if(deps.loadScrollPage)loadScrollPage=deps.loadScrollPage;
      if(deps.expandCatalogsOnPage)expandCatalogsOnPage=deps.expandCatalogsOnPage;
    }
  };
`;
  const source=worker.replace('const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));','const pause=async ms=>{globalThis.__advance(ms);};');
  const end=source.lastIndexOf('})();');
  vm.runInContext(source.slice(0,end)+exports+source.slice(end),ctx);
  await ctx.testApi.getState();
  const send=(action,fields={},sender={})=>new Promise(resolve=>handler({action,...fields},sender,resolve));
  return {api:ctx.testApi,ctx,chrome,options,requests,writes,send,get disk(){return structuredClone(disk);},set failLedger(value){failLedger=value;}};
}
const item=(extra={})=>({mallSeq:'100',nvMid:'1000',chnlProdNo:'111',chnlNo:'200',isNaverStore:true,sellerCount:1,title:'Synthetic product',storeName:'Synthetic store',storeUrl:'https://smartstore.naver.com/expected',productUrl:'',keyword:'test',page:1,isAd:false,reviews:3,...extra});
module.exports={runtime,C,item,response,worker,root,workKey,ledgerKey};
