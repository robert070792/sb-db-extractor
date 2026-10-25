/* 유승빈 DB추출기 v3.28: 실제 버튼 이동, 식별 충돌 보류, 과금 이력 보존, 수집 완전성 진단 */
(() => {
  'use strict';
  const KEY='sb_leads_v20_state'; // chrome.storage.local: 컴퓨터 + Chrome 프로필별, sync 사용 안 함
  const LEDGER_KEY='sb_paid_lookup_ledger_v321'; // 작업 초기화와 독립된 과금 가능 요청 이력
  const STORE_MAP_KEY='sb_verified_store_links_v323';
  const SHOP_ORIGIN='https://search.shopping.naver.com';
  const MAX_PAGES=10, MAX_STORES=1200, MAX_ITEMS=12000, SCROLL_DELAY=390, PLUS_BATCH=60;
  const C=SBCore;
  // 사용자가 직접 연 상품에서 확인: brand.naver.com/basictone/products/6149475814 (mallSeq 362714).
  // 사용자 제공 실제 상품 URL과 광고의 mallSeq로 확인된 매핑만 사용. 표시명으로 추측하지 않음.
  const VERIFIED_STORES={'362714':'https://brand.naver.com/basictone','460325':'https://brand.naver.com/mixandmatch','12407903':'https://smartstore.naver.com/ttasomihome'};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const clock=()=>new Date().toLocaleTimeString('ko-KR');
  const str=v=>String(v==null?'':v);
  const blankCatalogRequests=()=>({attempted:0,fetchInvoked:0,unconfirmed:0,legacyUncounted:false});
  const blankStats=()=>({filtered:0,duplicate:0,unknownReviews:0,unknownGroup:0,adsExcluded:0,sameSeller:0,invalidSeller:0,selected:0,checked:0,new:0,absent:0,rejected:0,paid:0,paymentScheduled:0,sameBranch:0,otherBranch:0,unknown:0,excluded:0,no010:0,businessDuplicates:0,lookupPrevented:0,bizCached:0,bizLatest:0,bizLegacy:0,bizErrors:0,bizUrlMissing:0,bizAuthErrors:0,bizUrlMissingAds:0,bizUrlMissingCatalogs:0,bizStoreRecovered:0,bizStoreConflicts:0,bizNoDetails:0});
  const blank=()=>({runId:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),pageTransitions:[],settings:{catalogLookup:false},catalogRequests:blankCatalogRequests(),basic:[],seen:[],lookupAttempted:[],businessIndex:{},statistics:blankStats(),pending:[],collection:null,running:false,paused:false,phase:'대기 중',stage:'',startedAt:0,finishedAt:0,processed:0,total:0,scanned:0,page:0,pageTotal:0,matched:[],review:[],logs:[],error:'',discovered:0,ads:0,keyword:'',source:'',mode:'',searchUrl:'',skipped:0,pageStats:[],auditPages:[],auditRows:[],auditTruncated:0,catalogDiagnostics:[],phoneDuplicates:0,currentStore:'',unidentifiedWarnings:0,unidentifiedUniqueCandidates:0,unidentifiedObservationCount:0,catalogWarnings:0,catalogExpanded:0,catalogBlockedReason:"",incompletePages:[],plusBatchSize:PLUS_BATCH});
  let state=null,job=null,lookupLedger={},rememberedStores={},storeSaveQueue=Promise.resolve();
  function sourceUrl(raw){
    try{const u=new URL(raw);if(u.origin!==SHOP_ORIGIN||!u.searchParams.get('query'))return null;
      if(/^\/search\//.test(u.pathname))return 'price';
      if(/^\/ns\//.test(u.pathname))return 'plus';
    }catch{}return null;
  }
  async function save(){if(state)await chrome.storage.local.set({[KEY]:state});}
  async function getState(){
    if(!state){const data=await chrome.storage.local.get([KEY,LEDGER_KEY,STORE_MAP_KEY]);if(state)return state;const saved=data[KEY]||{};
      rememberedStores=data[STORE_MAP_KEY]||{};
      state={...blank(),...saved,statistics:{...blankStats(),...(saved.statistics||{})}};
      // 이전 버전의 이어하기는 당시 조회 켜짐을 유지하고, 새 작업은 명시적으로 선택합니다.
      const legacyCatalog=typeof saved.settings?.catalogLookup!=='boolean'&&!!(saved.startedAt||saved.collection||saved.pending?.length);
      state.settings={...state.settings,catalogLookup:legacyCatalog?true:state.settings.catalogLookup===true};
      state.catalogRequests=saved.catalogRequests||{...blankCatalogRequests(),legacyUncounted:legacyCatalog};
      state.seen=[...new Set((state.seen||[]).map(str))];
      state.lookupAttempted=[...new Set((state.lookupAttempted||[]).map(str))];
      lookupLedger=data[LEDGER_KEY]&&typeof data[LEDGER_KEY]==='object'?data[LEDGER_KEY]:{};
      // 기존 이력은 보존하되 새 실행의 필요한 재조회를 차단하지 않는다.
      for(const id of state.lookupAttempted)if(/^\d+$/.test(id)&&!lookupLedger[id])lookupLedger[id]={status:'legacy-unknown',storeUrl:'',requestedAt:null};
      state.lookupAttempted=Object.keys(lookupLedger);
      await chrome.storage.local.set({[LEDGER_KEY]:lookupLedger});
      state.businessIndex=state.businessIndex||{};
      if(state.running&&!job){state.running=false;state.paused=true;state.phase='이전 작업 이어하기 대기';state.stage='백그라운드 작업이 중단됐습니다. 기존 기록을 보존했습니다. 이어하기를 누르세요.';await save();}
    }
    return state;
  }
  function storeHints(items){
    const hints={...VERIFIED_STORES};
    for(const [id,rec] of Object.entries(rememberedStores)){
      if(rec.conflict||!C.storeBase(rec.storeUrl))continue;
      if(items.some(x=>str(x.mallSeq)===id&&x.chnlNo&&rec.channelNo&&str(x.chnlNo)!==rec.channelNo))continue;
      hints[id]=rec.storeUrl;
    }
    return hints;
  }
  // 사용자가 직접 연 상품의 해당 상품·판매자 식별값만 반환. 전체 상태/쿠키는 읽어 보내지 않습니다.
  function inspectOpenedStore(){
    const u=new URL(location.href),m=u.pathname.match(/^\/([a-zA-Z0-9_-]+)\/products\/(\d+)\/?$/);
    if(!m||!['smartstore.naver.com','brand.naver.com'].includes(u.hostname))return null;
    const state=window.__PRELOADED_STATE__;if(!state)return null;
    const channels=[state.smartStoreV2?.channel,state.channel?.A,state.channel].filter(x=>x&&/^\d+$/.test(String(x.mallSeq||'')));
    const sellers=[...new Set(channels.map(x=>String(x.mallSeq)))];if(sellers.length!==1)return null;
    const products=[state.simpleProductForDetailPage?.A,state.product?.A,state.simpleProductForDetailPage,state.product].filter(Boolean);
    const product=products.find(x=>[x.id,x.channelProductNo,x.chnlProdNo].some(n=>String(n)===m[2]));
    if(!product)return null;
    const channel=channels[0];
    return {storeUrl:u.origin+'/'+m[1],mallSeq:sellers[0],channelNo:String(channel.channelNo||channel.id||''),productNo:m[2],nvMid:String(product.epInfo?.syncNvMid||'')};
  }
  async function rememberOpenedStore(sender){
    if(sender.frameId&&sender.frameId!==0)return {saved:false};
    const base=C.storeBase(sender.tab?.url),evidence=C.productEvidence(sender.tab?.url);
    if(!base||evidence.length!==1||!sender.tab?.id)return {saved:false};
    const result=await chrome.scripting.executeScript({target:{tabId:sender.tab.id},world:'MAIN',func:inspectOpenedStore});
    const found=result?.[0]?.result;
    if(!found||found.storeUrl!==base||found.productNo!==evidence[0].id||!/^\d+$/.test(found.mallSeq))return {saved:false};
    const observed=[...(state.auditRows||[]),...(state.pending||[]),...(state.collection?.products||[])];
    if(observed.some(x=>str(x.channelProductNo||x.chnlProdNo)===found.productNo&&x.mallSeq&&str(x.mallSeq)!==found.mallSeq))return {saved:false,reason:'상품 판매자 불일치'};
    if(found.channelNo&&observed.some(x=>str(x.channelProductNo||x.chnlProdNo)===found.productNo&&x.chnlNo&&str(x.chnlNo)!==found.channelNo))return {saved:false,reason:'상품 채널 불일치'};
    const saveMapping=storeSaveQueue.then(async()=>{
      const old=rememberedStores[found.mallSeq];
      if((old&&old.storeUrl!==base)||(VERIFIED_STORES[found.mallSeq]&&VERIFIED_STORES[found.mallSeq]!==base))return {saved:false,reason:'기존 확인 주소와 충돌'};
      if(old?.storeUrl===base)return {saved:true};
      const next={...rememberedStores,[found.mallSeq]:{...found,verifiedAt:new Date().toISOString(),source:'사용자가 연 상품 페이지의 상품번호·판매자 확인'}};
      await chrome.storage.local.set({[STORE_MAP_KEY]:next});rememberedStores=next;
      return {saved:true};
    });
    storeSaveQueue=saveMapping.catch(()=>{});return saveMapping;
  }
  function lookupAlreadyRequested(id,storeUrl){
    const base=C.storeBase(storeUrl);
    const sameRun=x=>x&&x.runId===state.runId;
    return Boolean(sameRun(lookupLedger[id])||base&&Object.values(lookupLedger).some(x=>sameRun(x)&&x.storeUrl===base));
  }
  async function recordLookupRequest(j,id,storeUrl){
    assertActive(j);
    if(lookupAlreadyRequested(id,storeUrl))throw Error('동일 스토어 사업자조회 요청 이력이 있습니다.');
    const previous=lookupLedger[id];
    const record={previous,runId:state.runId,status:'requested',storeUrl:C.storeBase(storeUrl),requestedAt:new Date().toISOString()};
    lookupLedger[id]=record;
    // 이 저장이 실패하면 네트워크 요청을 보내지 않는다.
    try{await chrome.storage.local.set({[LEDGER_KEY]:lookupLedger});}
    catch(e){if(previous)lookupLedger[id]=previous;else delete lookupLedger[id];throw e;}
    state.lookupAttempted=Object.keys(lookupLedger);return record;
  }
  async function finishLookupRequest(id,record,result){
    if(!record||lookupLedger[id]!==record)return;
    if(result.attempted===false){if(record.previous)lookupLedger[id]=record.previous;else delete lookupLedger[id];}
    else {const {previous,...current}=record;lookupLedger[id]={...current,status:result.success?'succeeded':'outcome-unknown',history:[...(previous?.history||[]),...(previous?[{runId:previous.runId,status:previous.status,requestedAt:previous.requestedAt}]:[])].slice(-20)};}
    await chrome.storage.local.set({[LEDGER_KEY]:lookupLedger});
    state.lookupAttempted=Object.keys(lookupLedger);
  }
  async function patch(j,fields){if(job!==j)return;Object.assign(state,fields);await save();}
  async function log(j,message){if(job!==j)return;state.logs.push(`[${clock()}] ${message}`);state.logs=state.logs.slice(-850);await save();}
  function assertActive(j){if(job!==j||j.cancelled)throw Error('작업이 중단되거나 초기화됐습니다.');}
  async function waitIfPaused(j){while(j.paused){assertActive(j);await pause(250);}assertActive(j);}
  function storeLabel(item){return str(item.storeName||'').trim()||`업체 ${item.mallSeq}`;}

  // chrome.scripting.executeScript로 직렬화되는 함수. 외부 변수 참조 금지.
  function inspectProducts(){
    // 이 함수는 네이버 검색 페이지의 MAIN/ISOLATED 실행 컨텍스트에 단독으로 주입됩니다.
    // 상품명/URL/리뷰는 같은 카드에서 실제 확인된 값만 사용합니다.
    const records=[],seen=new Set(),rawKeys=new Set(),unidentifiedKeys=new Set();
    // v2.x의 넓은 탐색 결과는 별도 계수. 내부 판매처를 검색상품으로 재해석하지 않습니다.
    const legacyWideKeys=new Set(),legacySellerWideKeys=new Set(),legacySafeKeys=new Set(),legacyAmbiguousKeys=new Set(),strictKeys=new Set();
    const legacyRejectedReasons=Object.create(null),legacyRejectedSamples=[];
    // 2.x의 보조/외부 링크는 실제 검색 상품 누락과 별도로 기록합니다.
    const rejected=(why,key,a)=>{
      if(!legacyRejectedReasons[why])legacyRejectedReasons[why]=new Set();
      legacyRejectedReasons[why].add(key);
      if(legacyRejectedSamples.length<12&&a){legacyRejectedSamples.push({reason:why,area:String(a.getAttribute('data-shp-area')||'').slice(0,60),seller:String(a.getAttribute('data-shp-contents-provider-id')||'').slice(0,20),product:String(a.getAttribute('data-shp-contents-id')||'').slice(0,22)});}
    };
    let ads=0,cards=0,rawEvents=0,nestedOffersExcluded=0,ambiguousCards=0;
    const parse=s=>{try{const v=JSON.parse(s||'[]');return Array.isArray(v)?Object.fromEntries(v.filter(x=>x&&typeof x.key==='string').map(x=>[x.key,x.value])):{};}catch{return {};}};
    const pick=(...values)=>values.map(x=>String(x??'').replace(/\s+/g,' ').trim()).find(Boolean)||'';
    const numeric=x=>/^\d+$/.test(String(x??'').trim())?String(x).trim():'';
    const slugFrom=url=>{try{const u=new URL(String(url||''));if(u.protocol!=='https:'||!['smartstore.naver.com','brand.naver.com'].includes(u.hostname.toLowerCase()))return '';const slug=u.pathname.split('/').filter(Boolean)[0]||'';return /^[a-zA-Z0-9_-]{2,60}$/.test(slug)&&!['main','products','profile','category','search','seller','home','inflow'].includes(slug.toLowerCase())?`${u.origin}/${slug}`:'';}catch{return '';}};
    // 실제 URL이 광고/쇼핑 링크의 매개변수에 포함된 경우 문자열만 분석한다.
    // 광고 추적 주소로 네트워크 요청을 보내 광고 클릭을 발생시키지 않는다.
    const verifiedNestedStoreUrl=raw=>{
      let x=String(raw||'').slice(0,4000);
      for(let i=0;i<3;i++){
        const direct=slugFrom(x);if(direct)return direct;
        try{const u=new URL(x);if(u.protocol==='https:'&&['ader.naver.com','cr.shopping.naver.com','search.shopping.naver.com','smartstore.naver.com','brand.naver.com'].includes(u.hostname.toLowerCase())){
          for(const k of ['url','target','targetUrl','redirectUrl','productUrl','landingUrl','destination','dest','redirect','link','mallUrl','storeUrl']){
            const nested=u.searchParams.get(k);if(nested){const store=slugFrom(nested);if(store)return store;}
          }
        }}catch{}
        try{const next=decodeURIComponent(x);if(next===x)break;x=next;}catch{break;}
      }
      return '';
    };
    const asProductUrl=url=>{try{const u=new URL(String(url||''));if(u.protocol!=='https:')return '';if(['smartstore.naver.com','brand.naver.com'].includes(u.hostname.toLowerCase())){const m=u.pathname.match(/^\/([a-zA-Z0-9_-]+)\/products\/(\d+)\/?$/i);return m&&slugFrom(url)?`${u.origin}/${m[1]}/products/${m[2]}`:'';}if(u.hostname==='search.shopping.naver.com'&&/^\/(?:catalog|product)\/\d+\/?$/.test(u.pathname))return u.origin+u.pathname;return '';}catch{return '';}};
    const nestedProductUrls=(raw,depth=0)=>{
      if(depth>2)return [];
      try{const u=new URL(String(raw||''));if(u.protocol!=='https:'||u.username||u.password||u.port)return [];
        if(['smartstore.naver.com','brand.naver.com'].includes(u.hostname)&&/^\/[a-zA-Z0-9_-]+\/products\/\d+\/?$/.test(u.pathname))return [u.origin+u.pathname.replace(/\/$/,'')];
        if(!['ader.naver.com','cr.shopping.naver.com'].includes(u.hostname))return [];
        return ['url','target','targetUrl','redirectUrl','productUrl','landingUrl','destination','dest','redirect','link'].flatMap(key=>{
          const value=u.searchParams.get(key);if(!value)return [];
          let decoded=value;try{decoded=decodeURIComponent(value);}catch{}
          return [...nestedProductUrls(value,depth+1),...(decoded!==value?nestedProductUrls(decoded,depth+1):[])];
        });
      }catch{return [];}
    };
    const clickUrl=url=>{try{const u=new URL(String(url||''));return u.protocol==='https:'&&(['ader.naver.com','cr.shopping.naver.com'].includes(u.hostname.toLowerCase()))?u.toString():'';}catch{return '';}};
    const reviewCount=raw=>{
      const s=String(raw??'').replace(/,/g,'').trim();if(/^\d+$/.test(s))return Number(s);
      const m=s.match(/^(\d+(?:\.\d+)?)\s*(만|천)$/);return m?Math.round(Number(m[1])*(m[2]==='만'?10000:1000)):null;
    };
    const rendered=el=>{
      if(el?.isConnected===false)return false;
      for(let node=el;node;node=node.parentElement){
        if(node.hidden||node.getAttribute?.('aria-hidden')==='true')return false;
        if(typeof getComputedStyle==='function'&&node.nodeType===1){const st=getComputedStyle(node);if(st.display==='none'||st.visibility==='hidden'||st.visibility==='collapse'||st.contentVisibility==='hidden')return false;}
      }
      return true;
    };
    const isVisibleText=el=>el&&rendered(el)&&el.textContent&&el.textContent.trim();
    // 대표상품 후보를 판매자번호 존재 여부와 별도로 계산해 수집 누락의 원인을 진단합니다.
    // "후보"는 화면에 생성된 제목/이미지 링크 기준으로, 독립 판매상품 수와 같다고 단정하지 않습니다.
    const representativeKeys=new Set(), representativeNoProvider=new Set(), representativeNoProductId=new Set(),representativeDetails=new Map();
    const representativeArea=/\.(?:title|tit|img|image|prodTitle)$/i;
    const allRepresentativeAnchors=[...document.querySelectorAll('a[data-shp-area]')];
    const representativeAnchors=allRepresentativeAnchors.filter(rendered);
    const hiddenAnchors=allRepresentativeAnchors.length-representativeAnchors.length;
    const representativeKey=node=>{
      const prod=String(node.getAttribute('data-shp-contents-id')||'').trim(),mall=String(node.getAttribute('data-shp-contents-provider-id')||'').trim();
      const title=String(node.getAttribute('title')||node.textContent||'').trim().slice(0,90);
      return prod?`product:${prod}:${mall}`:mall?`mall:${mall}:${title}`:title?`title:${title}`:'';
    };
    for(const node of representativeAnchors){
      const area=String(node.getAttribute('data-shp-area')||'');
      if(!/^(lst\*|lst\.)/.test(area)||!representativeArea.test(area))continue;
      const prod=String(node.getAttribute('data-shp-contents-id')||'').trim();
      const mall=String(node.getAttribute('data-shp-contents-provider-id')||'').trim();
      const ownTitle=String(node.getAttribute('title')||node.textContent||'').trim().slice(0,90);
      const key=representativeKey(node);
      if(!key)continue;
      representativeKeys.add(key);
      if(!/^\d+$/.test(mall))representativeNoProvider.add(key);
      if(!/^\d+$/.test(prod))representativeNoProductId.add(key);
      if(!representativeDetails.has(key))representativeDetails.set(key,{key,nvMid:numeric(prod),mallSeq:numeric(mall),title:ownTitle,
        reason:!numeric(mall)?'판매자번호 없음':!numeric(prod)?'상품번호 없음':'대표상품 수집 조건 미충족'});
    }
    const listingAnchors=[...document.querySelectorAll('a[data-shp-contents-provider-id]')].filter(a=>{const area=a.getAttribute('data-shp-area')||'';return rendered(a)&&/^(lst\*|lst\.)/.test(area)&&!/\.(?:mylist|wish|zzim|addCart|cart|favorite)$/i.test(area);});
    listingAnchors.sort((a,b)=>{
      const weight=x=>{const area=x.getAttribute('data-shp-area')||'';return /\.(?:title|tit|prodTitle)$/i.test(area)?0:/\.(?:img|image)$/i.test(area)?1:2;};
      return weight(a)-weight(b);
    });
    for(const a of listingAnchors){
      rawEvents++;
      const area=a.getAttribute('data-shp-area')||'';
      // 대표상품은 3.x의 안전한 제목/이미지 우선. 그 외 링크는 v2.x처럼 발견하되
      // 판매자/상품/제목이 자기 자신에 모두 포함된 경우에만 추가 후보로 수용합니다.
      const primaryArea=/\.(?:title|tit|img|image|prodTitle)$/i.test(area);
      const mallSeq=numeric(a.getAttribute('data-shp-contents-provider-id'));
      const det=parse(a.getAttribute('data-shp-contents-dtl')),prv=parse(a.getAttribute('data-shp-contents-provider-dtl'));
      const nvMid=numeric(a.getAttribute('data-shp-contents-id'))||numeric(det.nv_mid)||numeric(det.catalog_nv_mid);
      const rawKey=[mallSeq||'?',numeric(det.chnl_prod_no)||nvMid||'?'].join(':');
      // 2.x 넓은 발견 모드의 고유식별 계수. 링크 수가 곧 상품 수는 아닙니다.
      const providerType=a.getAttribute('data-shp-contents-provider-type')||'';
      if(mallSeq&&nvMid)legacyWideKeys.add(rawKey);
      if(providerType==='mall_seq'&&mallSeq&&nvMid)legacySellerWideKeys.add(rawKey);
      if(primaryArea&&providerType==='mall_seq'&&mallSeq&&nvMid){strictKeys.add(rawKey);rawKeys.add(rawKey);}
      if(providerType!=='mall_seq'||!mallSeq||!nvMid){
        // 이전 버전은 보조 링크/비-판매자 링크도 식별실패로 집계하여 부분완료를 과도하게 표시했습니다.
        // 실제 대표 상품처럼 보이면서 mall_seq 타입인데 ID가 빠진 경우만 경고로 남깁니다.
        if(primaryArea&&providerType==='mall_seq'&&(!mallSeq||!nvMid)){
          const title=pick(a.getAttribute('title'),a.textContent);
          if(title.length>=8)unidentifiedKeys.add([area,title.slice(0,80)].join(':'));
        }else if(!primaryArea)rejected('비상품 또는 판매자 미확인 보조링크',rawKey,a);
        continue;
      }
      const chnlProdNo=numeric(det.chnl_prod_no)||numeric(det.channel_product_no);
      const key=mallSeq+':'+(chnlProdNo||nvMid);if(seen.has(key))continue;
      const logParams=(()=>{try{return JSON.parse(a.getAttribute('data-nlog-params')||'{}');}catch{return {};}})();
      const ownProductTitle=pick(logParams.slot_dtl_prod_nm,det.prod_nm,det.product_nm,det.product_name,det.productName);
      // 검색 대표카드의 상품 이름은 자기 앵커의 데이터나 제목 텍스트여야 합니다.
      // 카드 안 여러 판매처가 같은 카드 이름을 물려받는 상황을 차단합니다.
      if(!ownProductTitle && !pick(a.getAttribute('title'),a.textContent)){
        if(!primaryArea)rejected('상품명 없는 보조링크',rawKey,a);
        nestedOffersExcluded++;continue;
      }
      const isLegacyCandidate=!primaryArea;
      if(isLegacyCandidate){
        // v2.x가 노출하던 하위 판매처에는 상위 카드의 상품명이 섞입니다.
        // 반드시 이 앵커의 nlog 상품명, 판매자/채널/상품 ID, 자기 메타 일치를 요구합니다.
        const ownId=numeric(logParams.content_id);
        const ownProvider=numeric(logParams.content_source);
        const ownChannelProduct=numeric(logParams.slot_dtl_chnl_prod_no);
        const selfConsistent=(!ownId||ownId===nvMid)&&(!ownProvider||ownProvider===mallSeq)&&
          (!ownChannelProduct||ownChannelProduct===chnlProdNo);
        const trustedSeller=pick(prv.adsr_type,logParams.provider_dtl_adsr_type)==='SHOPN'&&
          Boolean(numeric(prv.chnl_no)||numeric(logParams.provider_dtl_chnl_no));
        const explicitAnchorTitle=pick(a.getAttribute('title'));
        // 2.x에서만 찾던 독립 일반상품: 메타 상품명이 누락돼도
        // 링크 자체 텍스트가 충분한 제목이고 동일 카드에 상품 식별자가 하나뿐이면 수용 가능.
        // 신뢰할 수 없는 판매처 묶음의 버튼 텍스트는 제목으로 사용하지 않습니다.
        const anchorTitle=pick(a.textContent);
        const ownLinkTitle=anchorTitle.length>=12&&!/(?:구매하기|구매혜택|리뷰|판매처|최저가|더보기|옵션선택|바로가기|배송비|판매몰|찜하기)/i.test(anchorTitle)
          ?anchorTitle:'';
        const trustworthyOwnTitle=ownProductTitle||(explicitAnchorTitle.length>=8?explicitAnchorTitle:'')||ownLinkTitle;
        // 가격·구매·판매처/몰 목록은 카탈로그 내부 보조 링크이므로 API 전용.
        const subordinateArea=/\.(?:mall|seller|price|buy|purchase|wish|zzim|cart|mylist|review|delivery|benefit|option|compare|more|lowest|store)$/i.test(area);
        // '텍스트가 포함됨'만으로는 카탈로그 내부 링크를 독립 일반상품이라 볼 수 없습니다.
        if(!trustworthyOwnTitle||!chnlProdNo||!trustedSeller||!selfConsistent||subordinateArea){
          const reason=subordinateArea?'원부/판매처 보조영역':!trustedSeller?'네이버 채널 미확인':!chnlProdNo?'채널 상품번호 없음':!selfConsistent?'앵커 자체 식별자 불일치':'상품명 자기 증거 부족';
          rejected(reason,rawKey,a);nestedOffersExcluded++;continue;
        }
      }
      const pageItem=(logParams.filter_con?.items||[]).find(x=>x?.key==='pgn');
      const observedPage=pageItem&&/^\d+$/.test(String(pageItem.value))?Number(pageItem.value):null;
      const searchRequestId=pick(det.search_nginx_pageid,logParams.slot_dtl_search_nginx_pageid,(logParams.temp?.items||[]).find(x=>x?.key==='requestId')?.value,parse(a.getAttribute('data-shp-temp')).requestId);
      // 검색결과에 일반상품처럼 표시돼도 실제로 카탈로그와 연결된 경우가 있습니다.
      // 와이즈영 실측: catalog_nv_mid=60432655326, 13781588579 / mall_seq=2293330.
      const catalogNvMid=numeric(det.catalog_nv_mid)||numeric(logParams.slot_dtl_catalog_nv_mid)||numeric(det.match_nv_mid);
      const standardFlag=String(det.std_yn||logParams.slot_dtl_std_yn||'').toLowerCase()==='y';
      const advertiserType=pick(prv.adsr_type,logParams.provider_dtl_adsr_type);
      const brandstoreType=pick(prv.brandstore_type,logParams.provider_dtl_brandstore_type);
      const sellerChannel=numeric(prv.chnl_no)||numeric(logParams.provider_dtl_chnl_no);
      const isNaverStore=advertiserType==='SHOPN'&&!!sellerChannel;
      const isAd=logParams.is_ad===true||logParams.is_ad==='true'||logParams.is_ad===1||logParams.is_ad==='1'||a.getAttribute('data-shp-contents-grp')==='ad'||a.getAttribute('data-shp-contents-type')==='SA_prod';
      if(isAd)ads++;
      // li가 판매자 링크만 감싸는 경우가 있어, 상품명이 포함된 가장 가까운 상품 컨테이너를 고릅니다.
      const ancestors=[];let node=a;
      for(let depth=0;node&&depth<7;depth++,node=node.parentElement){if(node.nodeType===1)ancestors.push(node);}
      const titleSelector='[class*="product_title"] a,[class*="product_title"],[class*="productTitle"] a,[class*="productTitle"],[class*="product_name"] a,[class*="productName"] a,a[class*="product_link"],a[class*="productLink"],a[class*="product_title"],strong[class*="title"]';
      const card=ancestors.find(n=>n.matches?.('li[class*="product"],li[class*="item"],[class*="product_item"],[class*="productCard"]'))||ancestors.find(n=>n.querySelector?.(titleSelector)&&n.querySelectorAll?.('a[data-shp-contents-provider-id]').length<=12)||a.closest('li')||a.parentElement?.parentElement;
      // '카드'가 여러 판매자 링크를 포함하는 경우 카드 전체 텍스트·업체명·리뷰는
      // 다른 판매자에게 붙이면 안 됩니다. anchor 본인의 메타데이터만 신뢰합니다.
      const providerIds=new Set([...(card?.querySelectorAll('a[data-shp-contents-provider-id]')||[])].map(n=>numeric(n.getAttribute('data-shp-contents-provider-id'))).filter(Boolean));
      const unambiguousCard=providerIds.size<=1 && (!providerIds.size||providerIds.has(mallSeq));
      if(!unambiguousCard)ambiguousCards++;
      if(isLegacyCandidate){
        // 다른 몰이 함께 노출되는 원부상품 카드 안의 보조 링크는 수집하지 않습니다.
        // 또한 같은 카드의 대표 앵커가 다른 상품을 가리키면 목록 내부 링크입니다.
        const primarySiblings=[...(card?.querySelectorAll('a[data-shp-contents-provider-id]')||[])].filter(n=>
          /\.(?:title|tit|img|image|prodTitle)$/i.test(n.getAttribute('data-shp-area')||''));
        const conflictingPrimary=primarySiblings.some(n=>{
          const nId=numeric(n.getAttribute('data-shp-contents-id'));
          const nMall=numeric(n.getAttribute('data-shp-contents-provider-id'));
          return nId&&nMall&&(nId!==nvMid||nMall!==mallSeq);
        });
        // 동일 카드 안에 다른 판매자의 대표상품이 있으면 보조 판매처 링크로 취급합니다.
        const cardKeys=new Set([...(card?.querySelectorAll('a[data-shp-contents-provider-id]')||[])]
          .map(n=>[numeric(n.getAttribute('data-shp-contents-provider-id')),numeric(n.getAttribute('data-shp-contents-id'))].join(':'))
          .filter(x=>!x.startsWith(':')&&!x.endsWith(':')));
        const trustworthySingleCard=cardKeys.size<=1;
        if(!unambiguousCard||conflictingPrimary||(!ownProductTitle&&!trustworthySingleCard)){
          legacyAmbiguousKeys.add(rawKey);rejected('카드 내부 다른 상품/판매처와 혼합',rawKey,a);nestedOffersExcluded++;continue;
        }
      }else if(!unambiguousCard&&!ownProductTitle){nestedOffersExcluded++;continue;}
      seen.add(key);cards++;
      if(isLegacyCandidate)legacySafeKeys.add(rawKey);
      const titleNodes=unambiguousCard?[...(card?.querySelectorAll(titleSelector)||[])].filter(isVisibleText):[];
      const actualStoreName=pick(prv.mall_nm,prv.mall_name,prv.chnl_nm,prv.channel_name,
        det.mall_nm,det.mall_name,det.store_name,det.chnl_nm,logParams.provider_dtl_mall_nm,logParams.provider_dtl_chnl_nm);
      const plausibleTitle=value=>{const x=pick(value);return x&&x!==actualStoreName&&!/^(?:리뷰|상품평|후기|스토어|판매처|구매하기|더보기|광고)$/i.test(x)&&x.length>=5?x:'';};
      const title=pick(plausibleTitle(ownProductTitle),...titleNodes.map(n=>plausibleTitle(n.getAttribute('title')||n.textContent)),plausibleTitle(a.getAttribute('title')),plausibleTitle(a.textContent)).slice(0,220);
      // 실제 판매자 주소. 'inflow'는 네이버 내부 유입 링크이지 판매자 ID가 아닙니다.
      const merchantLink=unambiguousCard?card?.querySelector('a[href*="smartstore.naver.com/"],a[href*="brand.naver.com/"]'):null;
      // 직접 링크 외에 판매자 자기 메타데이터, 쇼핑 링크에 포함된 목적지 주소까지 확인.
      // 다른 판매자 링크가 섞인 카드에서는 하위 앵커의 URL을 사용하지 않음.
      const ownDataUrls=[prv.mall_url,prv.mallUrl,prv.chnl_url,prv.channel_url,prv.store_url,
        prv.storeUrl,prv.mall_home_url,prv.channelUrl,prv.chnlUrl,prv.mall_prod_url,
        det.mall_url,det.store_url,det.chnl_url,det.storeUrl,det.mallUrl,
        det.product_url,det.productUrl,det.click_url,logParams.slot_dtl_store_url,
        logParams.provider_dtl_mall_url,logParams.provider_dtl_store_url];
      const ownLinkUrls=[a.href,a.getAttribute('data-url'),a.getAttribute('data-link'),a.getAttribute('data-target-url'),a.getAttribute('data-href')];
      // 광고 링크의 목적지 URL이 개별 앵커의 추적 메타데이터/속성에 숨어 있는 경우를 확인.
      // 광고 URL을 fetch하거나 클릭하지 않으며, 다른 판매자의 카드 URL은 사용하지 않습니다.
      const ownAttributeUrls=[...(a.attributes||[])].filter(att=>/^(?:href|data-(?:url|href|link|target|redirect|destination|landing|nlog)[a-z0-9_-]*)$/i.test(att.name))
        .slice(0,28).map(att=>String(att.value||''));
      const ownLogUrls=Object.entries(logParams||{}).filter(([k,v])=>/url|link|href|landing|destination|redirect|target/i.test(k)&&typeof v==='string')
        .slice(0,25).map(([,v])=>v);
      const logParamsString=String(a.getAttribute('data-nlog-params')||'').replace(/\\\//g,'/').replace(/\\u002[fF]/g,'/');
      const urlInOwnLog=(logParamsString.match(/https?:\/\/(?:brand|smartstore)\.naver\.com\/[a-zA-Z0-9_-]{2,60}(?:\/products\/\d+)?/gi)||[]).slice(0,8);
      const sameCardLinks=unambiguousCard?[...(card?.querySelectorAll('a[href],a[data-url],a[data-href]')||[])]
        .slice(0,35).flatMap(el=>[el.href,el.getAttribute('data-url'),el.getAttribute('data-href')]):[];
      const storeLinks=[...ownDataUrls,...ownLinkUrls,...ownAttributeUrls,...ownLogUrls,...urlInOwnLog,...sameCardLinks,merchantLink?.href];
      const sellerStoreLinks=[...new Set(storeLinks.map(verifiedNestedStoreUrl).filter(Boolean))];
      const rawSellerCount=det.mall_cnt??det.mall_count??det.seller_count??null;
      let sellerCount=rawSellerCount!==null&&/^\d+$/.test(String(rawSellerCount))?Number(rawSellerCount):null;
      const cardText=unambiguousCard?String(card?.innerText||'').slice(0,2400):'';
      if(sellerCount===null){const m=cardText.match(/(?:판매처|판매몰)\s*([\d,]+)\s*(?:곳|개)?/);if(m)sellerCount=Number(m[1].replace(/,/g,''));}
      // 원부와 연결된 검색 상품도 '자기 앵커'에 확실한 브랜드/스마트스토어 URL이 있으면 보존.
      // 여러 판매처가 있는 카드의 *다른* 판매자 링크를 승계하는 것은 금지.
      const ownStoreEvidence=[...new Set([...ownDataUrls,...ownLinkUrls,...ownAttributeUrls,...ownLogUrls,...urlInOwnLog]
        .map(verifiedNestedStoreUrl).filter(Boolean))];
      const storeUrlCandidates=sellerCount!==null&&sellerCount>1?ownStoreEvidence:sellerStoreLinks;
      const identityIssues=[];
      if(storeUrlCandidates.length>1)identityIssues.push('동일 카드의 스토어 주소 충돌');
      if(numeric(logParams.content_source)&&numeric(logParams.content_source)!==mallSeq)identityIssues.push('판매자 메타데이터 불일치');
      if(numeric(logParams.content_id)&&numeric(logParams.content_id)!==nvMid)identityIssues.push('네이버 상품 메타데이터 불일치');
      if(numeric(logParams.slot_dtl_chnl_prod_no)&&chnlProdNo&&numeric(logParams.slot_dtl_chnl_prod_no)!==chnlProdNo)identityIssues.push('스토어 상품번호 메타데이터 불일치');
      if(numeric(prv.chnl_no)&&numeric(logParams.provider_dtl_chnl_no)&&numeric(prv.chnl_no)!==numeric(logParams.provider_dtl_chnl_no))identityIssues.push('채널번호 메타데이터 불일치');
      const identityConflict=identityIssues.length>0;
      const storeUrl=identityConflict?'':storeUrlCandidates[0]||'';
      const catalogHref=[a.href,...(unambiguousCard?[...(card?.querySelectorAll('a[href*="/catalog/"]')||[])].slice(0,5).map(el=>el.href):[])].find(url=>/search\.shopping\.naver\.com\/catalog\/\d+/.test(url||''))||'';
      const catalogUrlId=(catalogHref.match(/\/catalog\/(\d+)/)||[])[1]||'';
      const catalogType=pick(det.catalog_type,det.catalogType,logParams.slot_dtl_catalog_type,(()=>{try{return new URL(catalogHref).searchParams.get('catalogType')}catch{return ''}})());
      const cCatalogId=numeric(det.c_catalog_id)||numeric(det.cCatalogId)||numeric(logParams.slot_dtl_c_catalog_id)||numeric((()=>{try{return new URL(catalogHref).searchParams.get('cCatalogId')}catch{return ''}})());
      const productAnchor=titleNodes.find(n=>n.tagName==='A')||titleNodes.map(n=>n.closest('a')||n.querySelector('a')).find(Boolean);
      const candidates=[det.click_url,det.product_url,det.productUrl,det.mall_prod_url,det.chnl_prod_url,productAnchor?.href,a.href,
        ...(unambiguousCard?[...(card?.querySelectorAll('a[href*="/products/"],a[href*="/catalog/"]')||[])].slice(0,8).map(n=>n.href):[])];
      // 진짜 판매처 상품 링크를 우선한다. 카탈로그/광고 추적 주소를 개별 판매처 링크로 저장하지 않는다.
      let productUrl=candidates.map(asProductUrl).find(u=>/^https:\/\/(smartstore|brand)\.naver\.com\//.test(u))||'';
      if(!productUrl&&storeUrl&&chnlProdNo)productUrl=storeUrl+'/products/'+chnlProdNo;
      // URL이 없으면 공란으로 남기고, 16열 CSV의 특이사항에 미확인 표시.
      const rawReviews=[det.review_cnt,det.review_count,det.reviewCnt,det.review_count_total,det.total_review_count,prv.review_cnt];
      let reviews=rawReviews.map(reviewCount).find(v=>v!==null)??null;
      if(reviews===null){
        const reviewNodes=unambiguousCard?[...(card?.querySelectorAll('[class*="review"],[class*="Review"],[class*="evaluation"],a[href*="review"]')||[])].slice(0,12):[];
        const texts=[...reviewNodes.map(el=>pick(el.textContent)),cardText];
        for(const txt of texts){const m=txt.match(/(?:리뷰|상품평|후기)\s*[:(]?\s*([\d,]+(?:\.\d+)?\s*[만천]?)/);if(m){reviews=reviewCount(m[1].trim());if(reviews!==null)break;}}
      }
      const merchantNode=unambiguousCard?card?.querySelector('[class*=mall_name], [class*=mallName], [class*=store_name], [class*=storeName], [class*=seller_name]'):null;
      const merchantText=merchantLink&&merchantLink!==a&&!/\/products\//.test(merchantLink.href||'')?merchantLink.textContent:'';
      const storeName=pick(actualStoreName,merchantNode?.textContent,merchantText).slice(0,120);
      // 원장/진단에 광고 추적 쿼리 전체를 반복 저장하지 않고 명시된 상품 목적지만 보존한다.
      const observedProductUrls=[...new Set([...ownDataUrls,...ownLinkUrls,...candidates].flatMap(raw=>nestedProductUrls(raw)))];
      records.push({mallSeq,nvMid,chnlProdNo,chnlNo:sellerChannel,title,storeName,productUrl,observedProductUrl:productUrl,observedProductUrls,storeUrl,storeUrlCandidates,identityConflict,identityIssues,isAd,reviews,sellerCount,catalogNvMid,catalogUrlId,catalogType,cCatalogId,standardFlag,isNaverStore,advertiserType,brandstoreType,observedPage,searchRequestId,representativeKey:primaryArea?representativeKey(a):'',discoveryMethod:isLegacyCandidate?'legacy':'primary'});
    }
    // 판매자번호 없는 원부 대표카드: 직접 링크 또는 일치하는 원부 메타+추적 링크를 보존한다.
    for(const a of representativeAnchors){
      const area=String(a.getAttribute('data-shp-area')||'');
      if(!/^(lst\*|lst\.)/.test(area)||!representativeArea.test(area))continue;
      const key=representativeKey(a);if(records.some(x=>x.representativeKey===key))continue;
      let catalogUrlId='';try{const u=new URL(a.href);if(u.origin===location.origin)catalogUrlId=(u.pathname.match(/^\/catalog\/(\d+)\/?$/)||[])[1]||'';}catch{}
      const det=parse(a.getAttribute('data-shp-contents-dtl'));
      let catalogEvidenceSource=catalogUrlId?'direct-catalog-link':'';
      if(!catalogUrlId&&/^lst\*C\.(?:title|tit|img|image|prodTitle)$/.test(area)){
        const id=numeric(a.getAttribute('data-shp-contents-id'));
        try{const u=new URL(a.href);
          if(det.std_yn==='y'&&id&&numeric(det.catalog_nv_mid)===id&&u.protocol==='https:'&&u.hostname==='cr.shopping.naver.com'&&!u.username&&!u.password&&!u.port&&u.pathname==='/adcr'&&u.searchParams.get('nvMid')===id){catalogUrlId=id;catalogEvidenceSource='search-catalog-metadata';}
        }catch{}
      }
      if(!catalogUrlId||records.some(x=>x.catalogUrlId===catalogUrlId&&x.isCatalogRepresentative))continue;
      let log={};try{log=JSON.parse(a.getAttribute('data-nlog-params')||'{}');}catch{}
      const pageItem=(log.filter_con?.items||[]).find(x=>x?.key==='pgn');
      let catalogType='',cCatalogId='';try{const u=new URL(a.href);catalogType=u.searchParams.get('catalogType')||'';cCatalogId=numeric(u.searchParams.get('cCatalogId'));}catch{}
      records.push({mallSeq:'',nvMid:numeric(a.getAttribute('data-shp-contents-id'))||catalogUrlId,chnlProdNo:'',chnlNo:'',title:pick(a.getAttribute('title'),a.textContent,det.prod_nm),storeName:'',productUrl:'',storeUrl:'',isAd:log.is_ad===true||log.is_ad==='true'||a.getAttribute('data-shp-contents-grp')==='ad',reviews:null,sellerCount:null,catalogNvMid:numeric(det.catalog_nv_mid)||catalogUrlId,catalogUrlId,catalogType,cCatalogId,catalogEvidenceSource,isNaverStore:false,isCatalogRepresentative:true,observedPage:pageItem&&/^\d+$/.test(String(pageItem.value))?Number(pageItem.value):null,representativeKey:key,discoveryMethod:'catalog-representative'});
    }
    const bodyText=(document.body?.innerText||'').slice(0,8000);
    const challenge=/(자동입력|자동 입력|보안문자|보안 문자|비정상적인 접근|비정상적인 요청|로봇이 아닙니다|captcha|자동화된 접근|숫자를 입력|문자를 입력|자동등록방지)/i.test(bodyText)&&records.length===0;
    const watch=window.__sbPageWatch323;
    let lifecycle=null;
    if(watch&&typeof performance!=='undefined'){
      const age=performance.now()-watch.started;
      if(age>=0&&age<1800000){
        const responses=(performance.getEntriesByType?.('resource')||[]).filter(x=>x.startTime>=watch.started&&x.responseEnd>0).flatMap(x=>{
          try{const u=new URL(x.name);const page=Number(u.searchParams.get('pagingIndex'));
            if(u.origin!==location.origin||!/^\/(?:api\/)?search\//.test(u.pathname)||!Number.isInteger(page)||page<1||page>10)return [];
            return [{page,status:x.responseStatus||0,query:u.searchParams.get('query')||'',path:u.pathname}];
          }catch{return [];}
        }).slice(-10);
        const monitor=window.__sbSearchNetwork325;
        const requests=(monitor?.entries||[]).filter(x=>x.started>=watch.started).slice(-30).map(x=>({...x}));
        lifecycle={fromPage:watch.fromPage,targetPage:watch.targetPage,navigation:watch.navigation,clickViewport:watch.clickViewport||null,ageMs:age,
          requestMonitor:monitor?{fetch:monitor.fetch,xhr:monitor.xhr}:null,requests,
          productNodesAdded:watch.added,productNodesRemoved:watch.removed,organicAdded:watch.organicAdded,organicRemoved:watch.organicRemoved,quietMs:performance.now()-watch.lastMutation,responses};
      }
    }
    const loading=representativeAnchors.some(a=>a.closest?.('[aria-busy="true"]'));
    return {records,ads,cards,rawEvents,nestedOffersExcluded,ambiguousCards,hiddenAnchors,loading,lifecycle,
      representativeKeys:[...representativeKeys].slice(0,1200),representativeNoProviderKeys:[...representativeNoProvider].slice(0,500),
      representativeNoProductKeys:[...representativeNoProductId].slice(0,500),
      representativeDetails:[...representativeDetails.values()].slice(0,1200),
      legacyWideKeys:[...legacyWideKeys].slice(0,8000),legacySellerWideKeys:[...legacySellerWideKeys].slice(0,8000),
      legacySafeKeys:[...legacySafeKeys].slice(0,3000),legacyAmbiguousKeys:[...legacyAmbiguousKeys].slice(0,3000),strictKeys:[...strictKeys].slice(0,3000),
      legacyRejectedReasons:Object.fromEntries(Object.entries(legacyRejectedReasons).map(([k,v])=>[k,[...v].slice(0,2000)])),legacyRejectedSamples,
      rawKeys:[...rawKeys].slice(0,2000),unidentifiedKeys:[...unidentifiedKeys].slice(0,500),challenge,scrollY:Math.round(window.scrollY),scrollHeight:document.scrollingElement?.scrollHeight||document.body?.scrollHeight||0,viewHeight:window.innerHeight,url:location.href};
  }
  function resetScrollToTop(){window.scrollTo({top:0,behavior:"instant"});return {y:Math.round(window.scrollY)};}
  function doScroll(){const el=document.scrollingElement||document.documentElement;const y=Math.min(el.scrollHeight,window.scrollY+Math.max(420,Math.round(window.innerHeight*.94)));window.scrollTo({top:y,behavior:'instant'});return {scrollY:Math.round(window.scrollY),scrollHeight:el.scrollHeight,viewHeight:window.innerHeight};}
  // 가격비교 하단 페이지네이션의 선택 상태를 URL과 별도로 확인합니다.
  // executeScript로 전달하므로 모든 DOM 탐색은 이 함수 안에서 독립적으로 실행합니다.
  // 실제 페이지네이션 그룹만 식별합니다. 전역 nav(탭 메뉴/필터의 'on' 클래스)는 제외합니다.
  // executeScript 함수는 외부 변수 없이 직렬화되므로 필요한 헬퍼를 함수 내부에 둡니다.
  // 네이버 가격비교: 다른 숫자 버튼(슬라이드·필터)을 배제합니다.
  // 실제 페이지에서 현재 번호는 <a data-shp-contents-type="pageNo"> 목록에서 제외됩니다.
  // 사용자가 제공한 1/2/3페이지 HTML 기반. data-shp-contents-id는 실제 번호와 다를 수 있습니다!
  // pagination_num의 1~10 링크 중 숫자 하나가 빠진 경우 그 숫자가 현재 페이지입니다.
  function inspectPricePagination(){
    const visible=el=>{if(!el?.getBoundingClientRect)return false;const r=el.getBoundingClientRect(),st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden';};
    const isPageNumberLink=el=>el.matches('a[class*="pagination_btn_page"]')&&el.getAttribute('data-shp-contents-type')==='pageNo'&&/^(?:[1-9]|10)$/.test((el.textContent||'').trim());
    const groups=[...document.querySelectorAll('[class*="pagination_num"]')].filter(visible).map(root=>({root,links:[...root.querySelectorAll('a')].filter(el=>visible(el)&&isPageNumberLink(el))})).filter(g=>g.links.length>=1);
    groups.sort((a,b)=>b.links.length-a.links.length);
    const group=groups[0]||null;
    const links=group?.links||[...document.querySelectorAll('a[class*="pagination_btn_page"][data-shp-contents-type="pageNo"]')].filter(el=>visible(el)&&isPageNumberLink(el));
    const numbers=[...new Set(links.map(el=>Number(el.textContent.trim())))].sort((a,b)=>a-b);
    let urlPage=null;try{const v=new URL(location.href).searchParams.get('pagingIndex');urlPage=v===null?1:Number(v);if(!Number.isInteger(urlPage)||urlPage<1||urlPage>10)urlPage=null;}catch{}
    let domCurrent=null,method='페이지 번호 미확인';
    if(group){
      const active=[...group.root.querySelectorAll('[aria-current="page"],[aria-selected="true"],[class*="active"],[class*="current"],strong')].filter(visible);
      const vals=[...new Set(active.map(el=>{const copy=el.cloneNode(true);for(const hint of copy.querySelectorAll('.blind,.sr-only,[aria-hidden="true"]'))hint.remove();return Number((copy.textContent||'').trim());}).filter(n=>Number.isInteger(n)&&n>=1&&n<=10))];
      if(vals.length===1){domCurrent=vals[0];method='페이지네이션 내 활성 번호';}
    }
    if(domCurrent===null&&numbers.length===9){const missing=Array.from({length:10},(_,i)=>i+1).filter(n=>!numbers.includes(n));if(missing.length===1){domCurrent=missing[0];method='실제 숫자 링크에서 누락된 페이지';}}
    if(domCurrent===null&&numbers.length>=2&&!/…|\.\.\./.test(group?.root.textContent||'')){
      const gaps=[];for(let n=numbers[0]+1;n<numbers[numbers.length-1];n++)if(!numbers.includes(n))gaps.push(n);
      if(gaps.length===1){domCurrent=gaps[0];method='실제 숫자 링크 사이의 선택 번호';}
    }
    const disagree=domCurrent!==null&&urlPage!==null&&domCurrent!==urlPage;
    return {current:domCurrent??urlPage,domCurrent,selected:domCurrent,urlPage,disagree,method:domCurrent!==null?method:'URL만 확인',confidence:domCurrent!==null?'high':urlPage!==null?'low':'none',numbers,href:location.href,groupFound:links.length>=1};
  }
  // 페이지 번호는 화면에 표시된 텍스트로만 선택. '이전/다음' 링크의 data-shp-contents-id를 읽지 않습니다.
  function clickPricePagination(targetPage,fromPage,prepare=false){
    const visible=el=>{if(!el?.getBoundingClientRect)return false;const r=el.getBoundingClientRect(),st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden';};
    const groups=[...document.querySelectorAll('[class*="pagination_num"]')].filter(visible).map(root=>({root,links:[...root.querySelectorAll('a[class*="pagination_btn_page"][data-shp-contents-type="pageNo"]')].filter(el=>visible(el)&&/^(?:[1-9]|10)$/.test((el.textContent||'').trim()))})).filter(g=>g.links.length>=1);
    groups.sort((a,b)=>b.links.length-a.links.length);
    const links=groups[0]?.links||[...document.querySelectorAll('a[class*="pagination_btn_page"][data-shp-contents-type="pageNo"]')].filter(el=>visible(el)&&/^(?:[1-9]|10)$/.test((el.textContent||'').trim()));
    const numeric=links.map(el=>({el,page:Number(el.textContent.trim())}));
    const available=[...new Set(numeric.map(x=>x.page))].sort((a,b)=>a-b);
    if(available.length<1)return {ok:false,reason:'가격비교 페이지 번호 링크를 찾지 못했습니다.',available};
    let chosen=numeric.find(x=>x.page===targetPage),navigation='number';
    if(!chosen&&Number.isInteger(fromPage)&&fromPage!==targetPage&&targetPage>=1&&targetPage<=10){
      const scope=groups[0]?.root.closest('[class*="pagination_pagination"]')||groups[0]?.root.parentElement;
      navigation=targetPage<fromPage?'prev':'next';
      const el=[...(scope?.querySelectorAll('a,button')||[])].find(x=>visible(x)&&!x.disabled&&x.getAttribute('aria-disabled')!=='true'&&x.matches(`[class*="pagination_${navigation}"]`));
      if(el)chosen={el,page:null};
    }
    if(!chosen)return {ok:false,reason:`${targetPage}페이지 또는 해당 방향의 실제 이동 버튼이 없습니다.`,available};
    // 클릭 전에 실제 페이지 번호 링크 주소를 보존합니다. 클릭 후 SPA가 링크 DOM을 교체할 수 있습니다.
    const linkHref=String(chosen.el.href||chosen.el.getAttribute('href')||'');
    const selection=[...(groups[0]?.root.querySelectorAll('[aria-current="page"],[aria-selected="true"],[class*="active"],[class*="current"],strong')||[])].map(el=>(el.textContent||'').trim()).join('|');
    const rect=()=>{const r=chosen.el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    if(prepare){
      chosen.el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      const viewport=rect();
      window.__sbPagerPrepared328={el:chosen.el,targetPage,fromPage,href:location.href,selection,viewport,at:performance.now()};
      return {ok:true,prepared:true,available,viewport};
    }
    const prepared=window.__sbPagerPrepared328;delete window.__sbPagerPrepared328;
    const viewport=rect(),x=viewport.left+viewport.width/2,y=viewport.top+viewport.height/2;
    const fail=reason=>({ok:false,reason,available,viewport});
    if(!prepared||prepared.el!==chosen.el||prepared.targetPage!==targetPage||prepared.fromPage!==fromPage||prepared.href!==location.href||prepared.selection!==selection)
      return fail('페이지 버튼 준비 상태가 바뀌었습니다. 화면을 확인한 뒤 이어하기를 누르세요.');
    const waitedMs=Math.round(performance.now()-prepared.at);
    if(waitedMs<600||waitedMs>5000)return fail('페이지 버튼 표시 대기가 완료되지 않았거나 만료됐습니다. 이어하기를 누르세요.');
    if(document.visibilityState==='hidden')return fail('네이버 쇼핑 탭을 화면에 표시한 뒤 이어하기를 누르세요.');
    if(!chosen.el.isConnected||!visible(chosen.el)||chosen.el.disabled||chosen.el.getAttribute('aria-disabled')==='true')return fail('페이지 버튼이 사라졌거나 비활성화됐습니다.');
    if(![viewport.left,viewport.top,viewport.right,viewport.bottom].every(Number.isFinite)||viewport.left<0||viewport.top<0||viewport.right>innerWidth||viewport.bottom>innerHeight)
      return fail('페이지 버튼이 화면 밖에 있어 클릭하지 않았습니다. 버튼을 화면에 표시한 뒤 이어하기를 누르세요.');
    if(['left','top','right','bottom'].some(k=>Math.abs(viewport[k]-prepared.viewport[k])>2))return fail('페이지 버튼 위치가 바뀌어 클릭하지 않았습니다. 화면이 멈춘 뒤 이어하기를 누르세요.');
    const hit=document.elementFromPoint(x,y);
    if(!hit||!(hit===chosen.el||chosen.el.contains(hit)))return fail('페이지 버튼이 다른 창에 가려져 클릭하지 않았습니다. 추출기 창을 옮기거나 접은 뒤 이어하기를 누르세요.');
    const clickViewport={...viewport,x,y,waitedMs,unobstructed:true};
    // 검색 요청만 관측합니다. 추가 요청이나 응답 본문/쿠키/헤더 읽기는 하지 않습니다.
    // fetch의 반환 Promise, XHR의 반환값과 예외는 원본 그대로 유지합니다.
    if(!window.__sbSearchNetwork325){
      const monitor={entries:[],fetch:false,xhr:false};
      window.__sbSearchNetwork325=monitor;
      const begin=(raw,transport)=>{
        try{
          const u=new URL(typeof raw==='string'?raw:raw?.url||String(raw),location.href),page=Number(u.searchParams.get('pagingIndex'));
          if(u.origin!==location.origin||!/^\/(?:api\/)?search\//.test(u.pathname)||!Number.isInteger(page)||page<1||page>10)return null;
          const entry={page,query:(u.searchParams.get('query')||'').slice(0,200),path:u.pathname,transport,started:performance.now(),state:'pending',status:0};
          monitor.entries.push(entry);monitor.entries=monitor.entries.slice(-100);return entry;
        }catch{return null;}
      };
      const finish=(entry,state,status=0)=>{try{if(entry){entry.state=state;entry.status=Number(status)||0;entry.elapsedMs=Math.round(performance.now()-entry.started);}}catch{}};
      try{if(typeof window.fetch==='function'){
        const original=window.fetch;
        window.fetch=function(...args){
          const entry=begin(args[0],'fetch');let result;
          try{result=Reflect.apply(original,this,args);}catch(error){finish(entry,'error');throw error;}
          if(entry)try{result.then(response=>{finish(entry,response.ok?'response':'http-error',response.status);},()=>{finish(entry,'error');});}catch{}
          return result;
        };monitor.fetch=true;
      }}catch{}
      try{if(window.XMLHttpRequest){
        const proto=window.XMLHttpRequest.prototype,open=proto.open,send=proto.send,urls=new WeakMap();
        proto.open=function(...args){const result=Reflect.apply(open,this,args);urls.set(this,args[1]);return result;};
        proto.send=function(...args){
          const entry=begin(urls.get(this),'xhr');
          if(!entry)return Reflect.apply(send,this,args);
          const xhr=this,failed=()=>finish(entry,'error'),aborted=()=>finish(entry,'aborted'),timedout=()=>finish(entry,'timeout');
          const cleanup=()=>{for(const [name,fn] of events)xhr.removeEventListener(name,fn);};
          const ended=()=>{if(entry.state==='pending')finish(entry,xhr.status>=200&&xhr.status<300?'complete':xhr.status?'http-error':'error',xhr.status);cleanup();};
          const events=[['loadend',ended],['error',failed],['abort',aborted],['timeout',timedout]];
          for(const [name,fn] of events)xhr.addEventListener(name,fn);
          try{return Reflect.apply(send,this,args);}catch(error){finish(entry,'error');cleanup();throw error;}
        };monitor.xhr=true;
      }}catch{}
    }
    // 제품 노드 교체만 관찰합니다. pgn 같은 추적 속성만 변경된 것은 상품 갱신 증거로 세지 않습니다.
    window.__sbPageWatch323?.observer?.disconnect();
    const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();
    const watch={fromPage,targetPage:chosen.page,navigation,clickViewport,started:clock(),lastMutation:clock(),added:0,removed:0,organicAdded:0,organicRemoved:0};
    if(typeof MutationObserver!=='undefined'){
      const shown=node=>{for(let el=node;el?.nodeType===1;el=el.parentElement){const st=getComputedStyle(el);if(el.hidden||el.getAttribute('aria-hidden')==='true'||st.display==='none'||st.visibility==='hidden'||st.contentVisibility==='hidden')return false;}return true;};
      const count=(node,organic=false)=>{
        if(node.nodeType!==1)return 0;
        const anchors=[...(node.matches?.('a[data-shp-area]')?[node]:[]),...(node.querySelectorAll?.('a[data-shp-area]')||[])];
        return anchors.filter(a=>{if(!shown(a))return false;const area=a.getAttribute('data-shp-area')||'';let log={};try{log=JSON.parse(a.getAttribute('data-nlog-params')||'{}');}catch{};const ad=/^lst\*A\./.test(area)||a.getAttribute('data-shp-contents-grp')==='ad'||log.is_ad===true||log.is_ad==='true';return /^(lst\*|lst\.)/.test(area)&&/\.(?:title|tit|prodTitle)$/.test(area)&&(!organic||!ad);}).length;
      };
      watch.observer=new MutationObserver(mutations=>{
        for(const m of mutations){if(!shown(m.target))continue;const add=[...m.addedNodes].reduce((n,x)=>n+count(x),0),remove=[...m.removedNodes].reduce((n,x)=>n+count(x),0);
          if(add||remove){watch.organicAdded+=[...m.addedNodes].reduce((n,x)=>n+count(x,true),0);watch.organicRemoved+=[...m.removedNodes].reduce((n,x)=>n+count(x,true),0);watch.added+=add;watch.removed+=remove;watch.lastMutation=clock();}}
      });
      watch.observer.observe(document.body,{childList:true,subtree:true});
      setTimeout(()=>watch.observer.disconnect(),60000);
    }
    window.__sbPageWatch323=watch;
    chosen.el.click();
    return {ok:true,clickedPage:chosen.page,navigation,available,linkHref,clickViewport};
  }
  async function performPriceKeywordSearch(keyword,method='button'){
    // React 입력값과 DOM 입력값이 어긋난 상태에서 빈 문자열로 검색되지 않도록
    // 입력/검증/검색을 네이버 페이지 MAIN 컨텍스트에서 하나의 작업으로 수행합니다.
    const expected=String(keyword||'').trim();
    if(!expected)return {ok:false,reason:'검색할 키워드가 비어 있습니다.'};
    const findInput=()=>document.querySelector('input[data-focus-target="gnb-search-input"]')||document.querySelector('input[title="검색어 입력"][placeholder*="상품명"]');
    const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const setValue=el=>{
      el.focus();el.select?.();
      let usedBrowserInsert=false;
      try{if(document.queryCommandSupported?.('insertText'))usedBrowserInsert=!!document.execCommand('insertText',false,expected);}catch{}
      if(!usedBrowserInsert||el.value!==expected){
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        if(setter)setter.call(el,expected);else el.value=expected;
        try{el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:expected}));}
        catch{el.dispatchEvent(new Event('input',{bubbles:true}));}
      }
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return el.value===expected;
    };
    let input=findInput();if(!input)return {ok:false,reason:'네이버 상품 검색창을 찾지 못했습니다.'};
    setValue(input);
    // 검색 UI가 다시 렌더링되는 경우에도 최신 입력창의 값을 확인합니다.
    await tick(160);input=findInput();
    if(!input)return {ok:false,reason:'검색어 입력 중 검색창이 사라졌습니다.'};
    if(input.value!==expected){setValue(input);await tick(130);input=findInput();}
    if(!input||input.value!==expected)return {ok:false,reason:`검색어 입력이 유지되지 않았습니다. 입력창 값: ${input?.value||'(비어 있음)'}`};
    // React onChange 처리 후 사용자가 누르는 것과 같은 검색 버튼을 우선 클릭합니다.
    const visible=el=>{if(!el?.getBoundingClientRect)return false;const r=el.getBoundingClientRect(),style=getComputedStyle(el);return r.width>0&&r.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&!el.disabled;};
    // 실제 네이버 GNB 구조(2026-10-23 사용자 제공 HTML):
    // X: button[class*="searchInput_button_clear_"] (GNB.del)
    // 검색창 펼치기: button[class*="searchInput_button_arrow_"]
    // 돋보기: button[class*="searchInput_button_search_"] (GNB.search / sch.search)
    // svg[class*="searchInput_icon"]는 세 버튼에 공통으로 사용되므로 절대 첫 번째 SVG로 버튼을 고르지 않습니다.
    const form=input.closest('form');
    const scope=form||input.parentElement?.parentElement?.parentElement||document;
    const buttons=[...scope.querySelectorAll('button')].filter(visible);
    const searchButton=buttons.find(el=>el.matches('button[class*="searchInput_button_search_"]')&&/\.search$/.test(el.getAttribute('data-shp-area')||''))
      ||buttons.find(el=>el.matches('button[class*="searchInput_button_search_"]'))
      ||buttons.find(el=>/\.search$/.test(el.getAttribute('data-shp-area')||'')&&!el.matches('[class*="button_clear_"],[class*="button_arrow_"]'));
    if(!searchButton)return {ok:false,reason:'네이버 실제 검색 버튼(GNB.search / sch.search)을 찾지 못했습니다. X 버튼과 펼치기 버튼은 클릭하지 않았습니다.'};
    // 방금 입력한 값이 React 렌더링 중 지워졌다면 클릭해서 빈 키워드를 검색하지 않습니다.
    await tick(90);
    input=findInput();
    if(!input||input.value!==expected)return {ok:false,reason:'검색 버튼 클릭 직전 입력값이 사라졌거나 변경됐습니다.'};
    // React가 입력 과정에서 검색 버튼을 교체할 수도 있으므로 클릭 직전의 실제 DOM 버튼을 다시 사용합니다.
    const liveButtons=[...((input.closest('form')||scope).querySelectorAll('button'))].filter(visible);
    const liveSearch=liveButtons.find(el=>el.matches('button[class*="searchInput_button_search_"]')&&/\.search$/.test(el.getAttribute('data-shp-area')||''))
      ||liveButtons.find(el=>el.matches('button[class*="searchInput_button_search_"]'))
      ||liveButtons.find(el=>/\.search$/.test(el.getAttribute('data-shp-area')||'')&&!el.matches('[class*="button_clear_"],[class*="button_arrow_"]'));
    if(!liveSearch)return {ok:false,reason:'입력 후 검색 버튼이 다시 렌더링되어 찾을 수 없습니다.'};
    liveSearch.click();
    return {ok:true,method:method==='retry'?'실제 돋보기 버튼 재클릭':'실제 돋보기 검색 버튼 클릭',typed:expected};
  }
  function scrollToPriceFooter(){
    const root=document.scrollingElement||document.documentElement;
    window.scrollTo({top:root.scrollHeight,behavior:'instant'});
    return {y:window.scrollY,height:root.scrollHeight};
  }
  // chrome.scripting.executeScript의 브라우저 검색결과 탭에서 동작합니다.
  // 네이버 공개 쇼핑 JSON만 요청하고, 쿠키/토큰이나 원문 HTML을 저장하지 않습니다.
  // 요청은 같은 origin에서 수행하므로 카탈로그 탭을 새로 열지 않습니다.
  async function fetchCatalogOfferPage(catalogId,page,keyword,catalogType,cCatalogId){
    const numeric=id=>/^\d{1,20}$/.test(String(id||''));
    if(!numeric(catalogId)||!Number.isInteger(page)||page<1||page>50)return {ok:false,fetchInvoked:false,reason:'카탈로그 조회 인자 오류'};
    const url=new URL('/catalog/api/'+catalogId+'/products',location.origin);
    url.searchParams.set('nvMid',catalogId);
    url.searchParams.set('page',String(page));
    url.searchParams.set('pageSize','10');
    url.searchParams.set('isCCatalogPage','false');
    if(numeric(cCatalogId))url.searchParams.set('cCatalogId',cCatalogId);
    url.searchParams.set('isMembership','false');
    url.searchParams.set('includeDeliveryFee','true');
    url.searchParams.set('isExpectedPrice','true');
    if(catalogType)url.searchParams.set('catalogType',catalogType);
    url.searchParams.set('query',keyword||'');
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),10500);
    let fetchInvoked=false;
    const result=await (async()=>{
    try{
      fetchInvoked=true;
      const response=await fetch(url.toString(),{method:'GET',credentials:'same-origin',signal:ac.signal});
      if(!response.ok)return {ok:false,status:response.status,reason:'카탈로그 HTTP '+response.status};
      const type=(response.headers.get('content-type')||'').toLowerCase();
      if(!type.includes('json'))return {ok:false,reason:'카탈로그 응답이 JSON이 아닙니다.'};
      const body=await response.json();
      if(body?.success!==true||!Array.isArray(body?.data?.products))return {ok:false,reason:'판매처 JSON 구조 불일치'};
      const totalCount=Number(body.data.totalCount);
      const totalKnown=body.data.totalCount!==null&&body.data.totalCount!==''&&Number.isInteger(totalCount)&&totalCount>=0;
      if(totalKnown&&totalCount<body.data.products.length)return {ok:false,reason:'판매처 총수와 배열 길이 불일치 ('+totalCount+')'};
      // 일부 카탈로그의 totalCount=-1은 '총수 미제공'일 수 있습니다.
      // 빈 배열까지 성공으로 처리하면 실제 누락을 숨기므로 별도로 미확인 처리합니다.
      if(!totalKnown&&body.data.products.length===0)return {ok:false,reason:'판매처 총수 미제공 및 상품 배열 비어 있음 ('+String(body.data.totalCount)+')',status:response.status,totalCount:body.data.totalCount,productsLength:0,jsonSuccess:body.success};
      const filtered=body.data.products.map(p=>({
        nvMid:String(p.nvMid||''), matchNvMid:String(p.matchNvMid||''),
        mallSeq:String(p.mallSequence||''), chnlNo:String(p.channelSequence||''),
        chnlProdNo:String(p.mallProductId||''), title:String(p.productName||'').slice(0,220),
        storeName:String(p.mallName||'').slice(0,120), productUrl:String(p.pcProductUrl||''),
        reviews:typeof p.reviewCount==='number'?p.reviewCount:null,
        advertiserType:String(p.mallInfo?.advertiserType||''),
        smartStoreAccountNumber:String(p.mallInfo?.smartStoreAccountNumber||''),
        isSmartStoreProduct:p.isSmartStoreProduct===true,
        isBrandUrl:/^https:\/\/brand\.naver\.com\//i.test(String(p.pcProductUrl||'')),
        isNaverUrl:/^https:\/\/(smartstore|brand)\.naver\.com\//i.test(String(p.pcProductUrl||''))
      }));
      return {ok:true,totalCount:totalKnown?totalCount:null,totalKnown,received:filtered.length,products:filtered};
    }catch(e){return {ok:false,reason:String(e?.message||e).slice(0,180)};}
    finally{clearTimeout(timer);}
    })();
    return {...result,fetchInvoked};
  }
  async function inspectCatalogOffers(j,catalogId,page,keyword,catalogType,cCatalogId){
    assertActive(j);await waitIfPaused(j);
    if(state.settings.catalogLookup!==true)return {ok:false,fetchInvoked:false,disabled:true,reason:'사용자 설정: 원부 추가 조회 꺼짐'};
    const metrics=state.catalogRequests||(state.catalogRequests=blankCatalogRequests());
    metrics.attempted++;metrics.unconfirmed++;await save();assertActive(j);
    let result;
    try {
      const r=await chrome.scripting.executeScript({target:{tabId:j.tabId},world:'MAIN',func:fetchCatalogOfferPage,args:[catalogId,page,keyword,catalogType,cCatalogId]});
      result=r?.[0]?.result||{ok:false,reason:'브라우저에서 카탈로그 응답을 받지 못했습니다.'};
    } catch(e) {result={ok:false,reason:String(e?.message||e).slice(0,180)};}
    assertActive(j);
    if(typeof result.fetchInvoked==='boolean'){metrics.unconfirmed--;if(result.fetchInvoked)metrics.fetchInvoked++;}
    await save();return result;
  }
  function toNaverCatalogOffer(x,catalogId,related,keyword,page,knownStoreItems=[]){
    const id=String(x.mallSeq||''),mid=String(x.nvMid||''),chan=String(x.chnlNo||'');
    const proof=SBShoppingParser.verifyCatalog({products:[{mallProductId:x.chnlProdNo,pcProductUrl:x.productUrl,isSmartStoreProduct:x.isSmartStoreProduct,matchNvMid:x.matchNvMid,mallSequence:id}]},x.chnlProdNo,catalogId);
    if(!x.chnlProdNo||!proof.match||C.productIdentityIssue(x.productUrl,'',x.chnlProdNo))return null;
    if(!/^\d+$/.test(id)||!/^\d+$/.test(mid))return null;
    // 네이버페이 지원만으로 판단하면 오늘의집 등이 포함될 수 있습니다.
    if(x.advertiserType!=='SHOPN'||!chan||!(x.isSmartStoreProduct||x.isBrandUrl||x.isNaverUrl))return null;
    // /main/products/<id>의 main은 스토어 ID가 아니므로 매장 URL을 만들지 않습니다.
    // 다른 검색 상품에서 실제 확인한 동일 판매자·동일 채널의 스토어 주소도 재사용합니다.
    const matchedSeller=[...related,...knownStoreItems].find(r=>String(r.mallSeq)===id&&String(r.chnlNo)===chan&&r.storeUrl);
    const knownStore=matchedSeller?.storeUrl||'';
    const direct=C.cleanProductUrl(x.productUrl,knownStore,x.chnlProdNo);
    const catalogLink=related.find(r=>/^\d+$/.test(String(r.catalogUrlId||'')))?.catalogUrlId||catalogId;
    return {
      mallSeq:id,nvMid:mid,chnlProdNo:x.chnlProdNo,chnlNo:chan,
      title:x.title,storeName:x.storeName,
      productUrl:direct,observedProductUrl:x.productUrl,unverifiedStoreSlug:!knownStore&&!C.storeBase(direct),
      storeUrl:knownStore||C.storeBase(direct),isAd:related.some(r=>r.isAd===true&&String(r.mallSeq)===id&&String(r.chnlProdNo)===String(x.chnlProdNo)),reviews:x.reviews,
      sellerCount:1,catalogNvMid:x.matchNvMid||catalogId,catalogUrlId:catalogLink,
      fromCatalog:true,catalogVerified:true,catalogEvidence:'원부 판매처의 상품번호·판매자 일치',standardFlag:true,isNaverStore:true,
      advertiserType:'SHOPN',keyword,page
    };
  }
  async function expandCatalogsOnPage(j,c,keyword,page,observed){
    state.catalogDiagnostics=state.catalogDiagnostics||[];
    const recordCatalog=(key,id,step,reason,extra={})=>{
      if(state.catalogDiagnostics.length>=500)return;
      state.catalogDiagnostics.push({keyword,page,catalogKey:str(key),requestCatalogId:str(id),stage:step,reason:str(reason),...extra});
    };
    // 판매처 목록 조회는 공식 검색 페이지와 동일한 MAIN 실행 영역에서 1회 시도합니다.
    // 차단 응답(418/429/403 등)은 우회하거나 재시도하지 않습니다.
    c.catalogProcessed=c.catalogProcessed||{};
    c.catalogOffersSeen=c.catalogOffersSeen||{};
    c.catalogVerifiedProducts=c.catalogVerifiedProducts||{};
    const blocked=()=>Boolean(c.catalogBlocked);
    const byId=new Map();
    let skippedSelfReferenced=0;
    for(const item of observed){
      const match=String(item.catalogNvMid||'');
      const pageId=String(item.catalogUrlId||'');
      if(!/^\d+$/.test(match)&&!/^\d+$/.test(pageId))continue;
      // catalog_nv_mid가 자신의 nvMid와 같은 일반상품은 카탈로그 연결 증거가 아닙니다.
      // 이불 진단: 상품번호와 같은 연결번호 30개를 무조건 조회해 200/-1/[]가 발생했음.
      // 실제 /catalog/<id> 링크, 서로 다른 연결번호, 판매처 2개 이상 중 하나만 있어도 검사합니다.
      const distinctMatch=/^\d+$/.test(match)&&match!==String(item.nvMid||'');
      const explicitCatalog=/^\d+$/.test(pageId);
      const multiSeller=Number.isFinite(Number(item.sellerCount))&&Number(item.sellerCount)>1;
      if(!distinctMatch&&!explicitCatalog&&!multiSeller){skippedSelfReferenced++;continue;}
      const key=match||pageId;
      item.catalogEvidence='원부 연결 후보 · 판매처 일치 미확인';
      if(c.catalogVerifiedProducts[item.mallSeq+':'+item.chnlProdNo]===key){item.catalogVerified=true;item.catalogEvidence='이 작업에서 원부 판매처 일치 확인';}
      if(!byId.has(key))byId.set(key,[]);
      byId.get(key).push(item);
    }
    const expanded=[],successful=new Set(),failures=new Set();
    const counts={apiOffers:0,apiNaver:0,apiExternal:0,catalogsAttempted:0,catalogsSucceeded:0,catalogsFailed:0,catalogsSkippedSelf:skippedSelfReferenced};
    if(skippedSelfReferenced)await log(j,`${keyword} ${page}페이지 · 카탈로그 별도 조회 증거 없는 일반상품 ${skippedSelfReferenced}개 API 호출 생략 (상품번호=연결번호, 검색상품은 보존)`);
    const entries=[...byId.entries()];
    counts.catalogLookupEnabled=state.settings.catalogLookup===true;
    counts.catalogsDisabled=0;
    if(!counts.catalogLookupEnabled){
      counts.catalogsDisabled=entries.length;
      for(const [key] of entries)recordCatalog(key,'','설정으로 미조회','원부 추가 조회 꺼짐');
      await log(j,`${keyword} ${page}페이지 · 원부 추가 조회 꺼짐 · ${entries.length}개 연결 후보 미조회 · 화면 상품정보만 수집`);
      await save();return {expanded,successful,failures,counts};
    }
    const countSkipped=async()=>{
      let skipped=0;
      for(const [key] of entries){
        if(!c.catalogProcessed[key]){c.catalogProcessed[key]='blocked';skipped++;failures.add(key);}
      }
      if(skipped){state.catalogWarnings=(state.catalogWarnings||0)+skipped;
        for(const [key] of entries)if(c.catalogProcessed[key]==='blocked')recordCatalog(key,'','미조회',c.catalogBlockedReason||'카탈로그 요청 제한');
        await log(j,`카탈로그 API 제한으로 ${skipped}개 연결상품 판매처 조회 생략 (추출 누락 가능)`);await save();}
    };
    if(blocked()){await countSkipped();return {expanded,successful,failures,blocked:true,counts};}
    for(const [key,related] of entries){
      assertActive(j);await waitIfPaused(j);
      if(blocked())break;
      if(c.catalogProcessed[key]==='ok'){successful.add(key);continue;}
      if(c.catalogProcessed[key]){failures.add(key);continue;}
      const representative=related.find(x=>x.catalogUrlId)||related[0];
      const id=String(representative.catalogUrlId||representative.catalogNvMid||'');
      if(!/^\d+$/.test(id))continue;
      // 검색 결과에 표시된 catalogType / cCatalogId만 그대로 사용하며 418/429 우회 시도를 하지 않습니다.
      // 백그라운드 추측으로 URL 유형 3개 x 카탈로그 2개를 반복 호출하지 않습니다.
      // 실제 가격비교 화면에서 확인한 유형만 쓰며, 없는 경우 첫 요청은 BRAND로 검사합니다.
      const typ=String(representative.catalogType||'BRAND');
      counts.catalogsAttempted++;
      let first=await inspectCatalogOffers(j,id,1,keyword,typ,representative.cCatalogId||'');
      // 네이버 검색 결과에서 '카탈로그 URL 번호'와 '연결 번호'가 둘 다 확인되고
      // 서로 다르면, 빈 성공(HTTP 200 / totalCount -1 / products [])에 한해서만
      // 연결 번호를 단 한 번 확인합니다. 추측한 ID/유형 조합을 무차별 호출하지 않습니다.
      let requestId=id;
      if(!first?.ok&&first?.status===200&&Number(first?.totalCount)===-1&&first?.productsLength===0){
        const alternate=related.map(x=>String(x.catalogNvMid||'')).find(x=>/^\d+$/.test(x)&&x!==id&&related.some(r=>String(r.catalogUrlId||'')===id));
        if(alternate){
          await log(j,`원부상품 ${key} · 화면에 표시된 URL 번호 ${id}와 연결번호 ${alternate}가 달라 연결번호로 1회 확인`);
          recordCatalog(key,id,'카탈로그 ID 비교','첫 번호에서 빈 응답 (-1) · 화면 제공 연결번호 1회 확인',{catalogType:typ,cCatalogId:str(representative.cCatalogId||''),httpStatus:200,totalCount:-1,returnedProducts:0});
          requestId=alternate;
          first=await inspectCatalogOffers(j,alternate,1,keyword,typ,representative.cCatalogId||'');
        }
      }
      if(!first?.ok){
        const code=first?.status||0,reason=first?.reason||'원인 미확인';
        counts.catalogsFailed++;c.catalogProcessed[key]='failed';failures.add(key);
        recordCatalog(key,requestId,'첫 페이지',reason,{catalogType:typ,cCatalogId:str(representative.cCatalogId||''),httpStatus:code,totalCount:first?.totalCount??null,returnedProducts:first?.productsLength??null});
        state.catalogWarnings=(state.catalogWarnings||0)+1;
        if([401,403,418,429].includes(code)){
          c.catalogBlocked=true;
          c.catalogBlockedReason=`HTTP ${code}: ${code===429?'호출 제한':'서버에서 요청 거절'}`;
          state.catalogBlockedReason=c.catalogBlockedReason;
          await log(j,`카탈로그 API HTTP ${code} 감지 · 즉시 모든 카탈로그 조회 중단 (우회/반복 시도 없음) · 미조회 업체가 생길 수 있습니다.`);
        }else{
          await log(j,`원부상품 ${key} · 판매처 조회 실패 (${reason}), 해당 카탈로그 확인 불가`);
        }
        await save();continue;
      }
      const total=first.totalCount;
      const known=first.totalKnown!==false&&Number.isInteger(total)&&total>=0;
      const maxPages=known?Math.min(50,Math.ceil(total/10)):50;
      let all=[...first.products],complete=known?total<=10:first.products.length<10;
      let truncated=known&&total>500;
      if(!known)await log(j,`원부상품 ${key} · 판매처 총수 미제공 (-1), 실제 응답 배열로 페이지 종료 확인`);
      else if(truncated)await log(j,`원부상품 ${key} 판매처 ${total}개 · 최대 500개 검사`);
      const seenOffers=new Set(all.map(x=>x.mallSeq+':'+x.nvMid));
      for(let p=2;p<=maxPages&&!complete;p++){
        assertActive(j);await waitIfPaused(j);
        const next=await inspectCatalogOffers(j,requestId,p,keyword,typ,representative.cCatalogId||'');
        if(!next?.ok){
          complete=false;
          recordCatalog(key,id,`${p}페이지`,next?.reason||'응답 실패',{catalogType:typ,cCatalogId:str(representative.cCatalogId||''),httpStatus:next?.status||0,totalCount:next?.totalCount??null,returnedProducts:next?.productsLength??null});
          if([401,403,418,429].includes(next.status)){
            c.catalogBlocked=true;c.catalogBlockedReason=`HTTP ${next.status}`;
            state.catalogBlockedReason=c.catalogBlockedReason;
            await log(j,`원부상품 ${key} · 판매처 ${p}페이지 HTTP ${next.status}, 추가 카탈로그 조회 전체 중단`);
          }else await log(j,`원부상품 ${key} 판매처 ${p}페이지 조회 실패 (${next.reason||'알 수 없음'})`);
          break;
        }
        if(!known&&next.products.length===0){complete=true;break;}
        const newOffers=next.products.filter(x=>!seenOffers.has(x.mallSeq+':'+x.nvMid));
        if(next.products.length&&newOffers.length===0){
          complete=false;recordCatalog(key,id,`${p}페이지`,'동일한 판매상품 응답 반복',{returnedProducts:next.products.length});
          await log(j,`원부상품 ${key} · ${p}페이지에서 동일한 판매상품만 반환되어 누락 가능성 표시 후 종료`);break;
        }
        for(const x of next.products)seenOffers.add(x.mallSeq+':'+x.nvMid);
        all.push(...next.products);
        if(known&&p>=maxPages)complete=!truncated;
        if(!known&&next.products.length<10)complete=true;
        if(p<maxPages&&!complete)await pause(120);
      }
      const unique=new Map();for(const offer of all)unique.set(offer.mallSeq+':'+offer.nvMid,offer);
      const responseRows=all.length;all=[...unique.values()];
      if(known&&all.length!==total){
        complete=false;
        recordCatalog(key,requestId,'총수 대조','판매처 고유상품 수와 응답 총수 불일치',{collectedProducts:all.length,totalCount:total,responseRows});
      }
      if(all.length>500){all=all.slice(0,500);complete=false;}
      if(!known&&all.length>=500)complete=false;
      counts.apiOffers+=all.length;
      const naver=all.map(x=>toNaverCatalogOffer(x,requestId,related,keyword,page,[...observed,...(c.products||[])])).filter(Boolean);
      for(const verified of naver)c.catalogVerifiedProducts[verified.mallSeq+':'+verified.chnlProdNo]=key;
      for(const original of observed){
        if(naver.some(x=>String(x.mallSeq)===String(original.mallSeq)&&String(x.chnlProdNo)===String(original.chnlProdNo))){original.catalogVerified=true;original.catalogEvidence='원부 판매처의 상품번호·판매자 일치';}
      }
      counts.apiNaver+=naver.length;counts.apiExternal+=all.length-naver.length;
      const accepted=new Map();for(const x of naver)accepted.set(x.mallSeq+':'+(x.chnlProdNo||x.nvMid),x);
      for(const offer of accepted.values()){
        const oKey=offer.mallSeq+':'+(offer.chnlProdNo||offer.nvMid);
        if(!c.catalogOffersSeen[oKey]){c.catalogOffersSeen[oKey]=true;expanded.push(offer);}
      }
      c.catalogProcessed[key]=complete?'ok':'partial';
      if(complete){successful.add(key);counts.catalogsSucceeded++;}else{
        failures.add(key);counts.catalogsFailed++;state.catalogWarnings=(state.catalogWarnings||0)+1;
        if(!state.catalogDiagnostics.some(x=>x.catalogKey===str(key)&&x.page===page))recordCatalog(key,id,'부분 수집','판매처 전체 여부 검증 불가',{collectedProducts:all.length,totalCount:known?total:null});
      }
      state.catalogExpanded=(state.catalogExpanded||0)+1;
      await log(j,`원부상품 ${key} · 판매처 ${all.length}/${known?total:'총수 미제공'}개 검사 · 네이버 스토어 ${accepted.size}개${complete?'':' (일부 조회/누락 가능)'}`);
      await save();
      if(c.catalogBlocked)break;
      await pause(200);
    }
    if(blocked())await countSkipped();
    return {expanded,successful,failures,blocked:blocked(),counts};
  }
  function pageEvidence(data){
    const rows=data?.records||[];
    return {signature:productSignature(data),organicSignature:productSignature({records:rows.filter(x=>!x.isAd)}),
      requests:[...new Set(rows.map(x=>x.searchRequestId).filter(Boolean))].sort(),
      products:rows.slice(0,150).map(x=>({seller:x.mallSeq,product:x.chnlProdNo||x.nvMid,isAd:!!x.isAd,page:x.observedPage,request:x.searchRequestId||''}))};
  }
  function productSignature(data){return (data?.records||[]).map(x=>x.mallSeq+':'+(x.chnlProdNo||x.nvMid)).sort().join('|');}
  async function clickPage(tabId,page,currentPage,j){
    const prepared=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:clickPricePagination,args:[page,currentPage,true]});
    if(!prepared?.[0]?.result?.ok)return prepared?.[0]?.result;
    await pause(650);
    if(j){assertActive(j);await waitIfPaused(j);}
    const r=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:clickPricePagination,args:[page,currentPage]});
    return r?.[0]?.result;
  }
  async function inspectPager(tabId){
    const r=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:inspectPricePagination});
    return r?.[0]?.result;
  }
  async function scrollTop(tabId){
    const r=await chrome.scripting.executeScript({target:{tabId},world:"ISOLATED",func:resetScrollToTop});return r?.[0]?.result;
  }
  async function scrollFooter(tabId){
    const r=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:scrollToPriceFooter});
    return r?.[0]?.result;
  }
  async function inspect(tabId){const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:inspectProducts});return result?.[0]?.result;}
  async function scroll(tabId){const result=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:doScroll});return result?.[0]?.result;}
  async function waitForProducts(j,tabId,page){
    let deadline=Date.now()+30000,lastError='',wasChallenge=false;
    while(Date.now()<deadline){
      assertActive(j);await waitIfPaused(j);
      await pause(550);
      let tab;try{tab=await chrome.tabs.get(tabId);}catch{throw Error('기존 네이버 쇼핑 탭이 닫혔습니다.');}
      if(tab.status!=='complete')continue;
      try{
        const data=await inspect(tabId);
        if(data?.records?.length||data?.representativeKeys?.length){if(wasChallenge)await log(j,`${page}페이지 보안 인증 후 상품 탐지 재개`);return data;}
        if(data?.challenge){
          if(!j.paused){j.paused=true;wasChallenge=true;
            await patch(j,{paused:true,phase:'네이버 보안 인증 대기',stage:'현재 네이버 탭에서 직접 인증하세요. 인증 완료 후 확장 아이콘에서 이어하기를 누르세요.'});
            await log(j,`${page}페이지 보안 인증 감지 · 일시정지 (자동 인증 없음)`);
          }
          await waitIfPaused(j);deadline=Date.now()+30000;continue;
        }
        lastError='상품 식별번호가 발견되지 않았습니다.';
      }catch(e){lastError=e.message||str(e);}
    }
    throw Error(`${page}페이지 검색 결과를 30초 안에 확인하지 못했습니다. ${lastError} 현재 탭의 검색 결과/보안 인증을 확인하세요.`);
  }
  async function ensureKeyword(j,tabId,keyword){
    assertActive(j);await waitIfPaused(j);
    const tab=await chrome.tabs.get(tabId),u=new URL(tab.url||'');
    if(u.origin!==SHOP_ORIGIN||!sourceUrl(u.href))throw Error('현재 탭이 네이버 쇼핑 검색 결과가 아닙니다.');
    if(u.searchParams.get('query')!==keyword){
      await patch(j,{stage:`네이버 검색창에서 '${keyword}' 검색하는 중`});
      const submitted=await searchKeyword(tabId,keyword);
      if(!submitted?.ok||submitted.typed!==keyword)throw Error(submitted?.reason||'검색어 입력 또는 돋보기 클릭 실패');
      await log(j,`${keyword} · 검색창 입력 확인 후 실제 돋보기 버튼 클릭`);
      await waitForKeyword(j,tabId,keyword);
    }
  }
  async function searchKeyword(tabId,keyword,method='button'){
    const r=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:performPriceKeywordSearch,args:[keyword,method]});
    return r?.[0]?.result;
  }
  async function waitForKeyword(j,tabId,keyword){
    let deadline=Date.now()+32000,last='검색 결과를 기다리는 중',retried=false;
    const started=Date.now();
    while(Date.now()<deadline){
      await waitIfPaused(j);await pause(650);assertActive(j);
      let data;try{data=await inspect(tabId);}catch{continue;}
      if(data?.challenge){
        if(!j.paused){j.paused=true;state.paused=true;await patch(j,{paused:true,phase:'네이버 보안 인증 대기',stage:'현재 검색 탭에서 직접 인증한 뒤 이어하기를 누르세요.'});await log(j,'키워드 검색 중 보안 인증 감지 · 일시정지');}
        await waitIfPaused(j);deadline=Date.now()+32000;continue;
      }
      let found='';try{found=new URL(data?.url||'').searchParams.get('query')||'';}catch{}
      last=`화면 검색어 ${found||'미확인'} / 요청 ${keyword}`;
      if(found===keyword&&data?.records?.length){await pause(450);return;}
      if(!retried&&Date.now()-started>=5000){
        retried=true;
        await log(j,`${keyword} · 검색 전환 미확인, 검색어 검증 후 실제 돋보기 버튼 한 번 재시도`);
        const again=await searchKeyword(tabId,keyword,'retry');
        if(!again?.ok)throw Error(`${keyword} 검색창 재입력 실패: ${again?.reason||'알 수 없음'}`);
      }
    }
    throw Error(`${keyword} 검색 결과 전환을 확인하지 못했습니다 (${last}). 검색 입력창과 돋보기 버튼을 확인하세요.`);
  }
  function pageRequestFailure(data,page){
    let keyword='';try{keyword=new URL(data?.url||'').searchParams.get('query')||'';}catch{}
    const latest=(data?.lifecycle?.requests||[]).filter(x=>x.page===page&&(!keyword||x.query===keyword)&&/^\/(?:api\/)?search\/all(?:\.json)?$/.test(x.path||'')).at(-1);
    if(!latest||!['http-error','error','aborted','timeout'].includes(latest.state))return null;
    const detail=latest.status?`HTTP ${latest.status}`:({error:'통신 오류',aborted:'요청 취소',timeout:'응답 시간 초과'}[latest.state]||'요청 실패');
    const error=Error(`${page}페이지 검색 요청 실패: ${detail}. 상품 갱신 미확인 · 추가 클릭과 수집 스크롤 중지`);
    error.code='PAGE_REQUEST_FAILED';error.requestFailure={page,status:latest.status||0,state:latest.state,path:latest.path};return error;
  }
  async function waitForPricePageChange(j,tabId,expectedPage,beforeSignature,beforePage,limitMs=15000){
    j.lastPageTransition=null;
    const started=Date.now();let deadline=Date.now()+limitMs,lastState='',lastFingerprint='',stable=0;
    while(Date.now()<deadline){
      await waitIfPaused(j);await pause(660);assertActive(j);
      let data,pager;
      try{[data,pager]=await Promise.all([inspect(tabId),inspectPager(tabId)]);}catch{continue;}
      if(data?.challenge){
        if(!j.paused){j.paused=true;state.paused=true;await patch(j,{paused:true,phase:'네이버 보안 인증 대기',stage:'현재 탭에서 직접 인증 후 이어하기를 누르세요.'});await log(j,'페이지 이동 중 보안 인증 감지 · 일시정지');}
        await waitIfPaused(j);deadline=Date.now()+limitMs;continue;
      }
      const failure=pageRequestFailure(data,expectedPage??pager?.domCurrent);
      if(failure){
        j.lastPageTransition={expectedPage,beforePage,actualPage:pager?.domCurrent??null,domCurrent:pager?.domCurrent,urlPage:pager?.urlPage,
          lifecycle:data?.lifecycle||null,before:typeof beforeSignature==='object'?beforeSignature:{signature:beforeSignature,requests:[]},after:pageEvidence(data),requestFailure:failure.requestFailure,result:'request-error'};
        state.pageTransitions.push(j.lastPageTransition);state.pageTransitions=state.pageTransitions.slice(-100);await save();throw failure;
      }
      if(!data?.records?.length){
        j.lastPageTransition={expectedPage,beforePage,actualPage:pager?.domCurrent??null,lifecycle:data?.lifecycle||null,
          loading:!!data?.loading,before:typeof beforeSignature==='object'?beforeSignature:{signature:beforeSignature,requests:[]},after:pageEvidence(data),reason:'상품 로딩 미확인'};
        continue;
      }
      const target=expectedPage??pager.domCurrent;
      if(!Number.isInteger(target)||target===beforePage)continue;
      if(expectedPage===null&&((j.navigationDirection==='prev'&&target>=beforePage)||(j.navigationDirection==='next'&&target<=beforePage)))continue;
      const before=typeof beforeSignature==='object'?beforeSignature:{signature:beforeSignature,requests:[]};
      const evidence=pageEvidence(data),sig=evidence.signature;
      const organicChanged=Boolean(before.organicSignature&&evidence.organicSignature&&before.organicSignature!==evidence.organicSignature);
      const listChanged=Boolean(before.signature&&sig&&before.signature!==sig);
      const requestChanged=Boolean(before.requests?.length&&evidence.requests.length&&evidence.requests.every(x=>!before.requests.includes(x)));
      const domTarget=pager.domCurrent===target;
      // URL은 SPA에서 이전 값일 수 있습니다. 정확한 페이지 링크 9개에서 빠진 번호가 우선 증거입니다.
      const observed=(data.records||[]).map(x=>x.observedPage).filter(x=>Number.isInteger(x));
      const matching=observed.filter(x=>x===target).length;
      const conflicting=observed.filter(x=>x!==target).length;
      // 페이지 번호/URL만 바뀐 SPA 상태는 성공으로 보지 않습니다.
      // 상품 집합이 같아도 클릭 후 일반상품 노드 갱신/페이지 응답이 검증되면 관측을 보존합니다.
      const proofRows=evidence.products.filter(x=>!x.isAd);
      const requestRows=proofRows.length?proofRows:evidence.products;
      const requestProof=requestChanged&&observed.length>=3&&matching===observed.length&&requestRows.length>=3&&requestRows.every(x=>x.request&&!before.requests.includes(x.request));
      const listingProof=before.organicSignature&&evidence.organicSignature?organicChanged:listChanged;
      const life=data.lifecycle;
      const tied=life&&life.fromPage===beforePage&&(life.targetPage===target||life.targetPage===null)&&life.ageMs>=1750;
      const metadataProof=observed.length>=Math.min(3,data.records.length)&&matching===observed.length;
      const organicCount=data.records.filter(x=>!x.isAd).length;
      const added=organicCount?life?.organicAdded:life?.productNodesAdded,removed=organicCount?life?.organicRemoved:life?.productNodesRemoved;
      const renderProof=!!(tied&&metadataProof&&added>=Math.min(3,organicCount||data.records.length)&&removed>=Math.min(3,organicCount||data.records.length)&&life.quietMs>=800);
      const keyword=(()=>{try{return new URL(data.url||'').searchParams.get('query')||'';}catch{return '';}})();
      const responseProof=!!(tied&&metadataProof&&life.responses?.some(x=>x.page===target&&x.status>=200&&x.status<300&&(!keyword||x.query===keyword)));
      const lifecycleProof=renderProof||responseProof;
      // 검색응답 ID는 추적 메타입니다. 변경만으로 목표 페이지 응답이라고 확정하지 않습니다.
      const proven=domTarget&&conflicting===0&&!data.loading&&(listingProof||lifecycleProof);
      const transition={expectedPage,beforePage,actualPage:target,requestMetadataProof:requestProof,lifecycle:data.lifecycle||null,loading:!!data.loading,hiddenAnchors:data.hiddenAnchors||0,renderProof,responseProof,domCurrent:pager.domCurrent,urlPage:pager.urlPage,listChanged,organicChanged,requestChanged,matching,observed:observed.length,before,after:evidence};
      j.lastPageTransition=transition;
      lastState=`페이지 링크 현재 ${pager.domCurrent??'-'}, URL ${pager.urlPage??'-'}, 상품변경 ${listChanged?'예':'아니오'}, 상품 pgn ${matching}/${observed.length}, 검색응답 변경 ${requestChanged?'예':'아니오'}, 보이는 번호 ${(pager.numbers||[]).join(',')}`;
      if(!proven||Date.now()-started<1750){stable=0;lastFingerprint='';continue;}
      const fingerprint=[pager.domCurrent,pager.urlPage,sig,matching,!!data.loading,evidence.requests.join(',')].join('|');
      stable=fingerprint===lastFingerprint?stable+1:1;lastFingerprint=fingerprint;
      if(stable<2)continue;
      // 상품이 같아도 새 렌더링/페이지 응답과 목표 페이지 메타가 일치하면 페이지별 관측으로 보존합니다.
      j.pageProof={page:target,requestProof,lifecycleProof,signature:sig,requests:evidence.requests};
      state.pageTransitions.push({...transition,result:'confirmed'});state.pageTransitions=state.pageTransitions.slice(-100);
      return {data,pager,actual:target,proof:lifecycleProof?'실제 페이지 선택·상품 렌더링/페이지 응답 확인':'실제 숫자 버튼·상품 목록 갱신 확인'};
    }
    if(j.lastPageTransition){state.pageTransitions.push({...j.lastPageTransition,result:'unverified'});state.pageTransitions=state.pageTransitions.slice(-100);await save();}
    throw Error(`페이지 이동 확인 실패 (${lastState||'페이지 응답 없음'}). 실제 페이지 버튼 또는 상품 로딩을 확인하세요.`);
  }
  async function checkpointPriceNavigation(j){
    const c=state.collection,attempt=j.navigationAttempt;
    if(!c||!attempt)return;
    // 서비스 워커가 클릭 직후 종료돼도 선택 숫자만으로 성공 처리하지 않도록 먼저 저장합니다.
    c.pageWait={...attempt,page:attempt.targetPage,label:`${attempt.keyword} ${attempt.targetPage}페이지 (수집 확인 대기)`,reason:'페이지 전환 확인 중',failedAt:null};
    await save();assertActive(j);
  }
  async function navigatePrice(j,tabId,keyword,targetPage){
    assertActive(j);await waitIfPaused(j);
    await ensureKeyword(j,tabId,keyword);
    let pager=await inspectPager(tabId),actual=pager?.domCurrent??null;
    await log(j,`${keyword} · 현재 페이지 ${actual??'미확인'} (실제 링크 ${pager?.domCurrent??'-'}, URL ${pager?.urlPage??'-'}) · 목표 ${targetPage}페이지`);
    const waiting=state.collection?.pageWait;
    if(waiting?.keyword===keyword&&waiting.page===targetPage&&actual===targetPage){
      // 실패 때 바뀐 숫자/pgn만 보고 이어하기가 이전 상품을 확정하는 것을 방지합니다.
      if(!waiting.beforeEvidence?.signature||waiting.fromPage===targetPage)throw Error('상품 변경 비교 기준이 없습니다. 실제 다른 페이지 버튼을 누른 뒤 이어하기를 누르세요.');
      j.navigationAttempt={keyword,targetPage,fromPage:waiting.fromPage,beforeEvidence:waiting.beforeEvidence};
      await waitForPricePageChange(j,tabId,targetPage,waiting.beforeEvidence,waiting.fromPage,6000);
      return;
    }
    // URL만 있어도 현재 페이지라고 바로 확정하지 않습니다. DOM에서 명시적 확인된 경우에만 바로 수집.
    if(pager?.domCurrent===targetPage){
      const currentData=await waitForProducts(j,tabId,targetPage);
      const tagged=(currentData?.records||[]).map(x=>x.observedPage).filter(Number.isInteger);
      const other=tagged.filter(n=>n!==targetPage).length;
      if(tagged.length>=3&&other>tagged.length/2){
        throw Error(`${targetPage}페이지 번호는 선택됐지만 실제 상품 메타는 이전 페이지입니다 (${other}/${tagged.length}). 잘못된 상품 수집을 방지합니다.`);
      }
      await patch(j,{stage:`${targetPage}페이지 결과 확인 · 상품 수집`});return;
    }
    if(pager?.confidence!=='high'&&pager?.urlPage===targetPage){
      throw Error(`${targetPage}페이지를 URL로만 확인했습니다. 실제 페이지 번호 영역이 갱신되지 않아 잘못된 상품 수집을 방지하고 중단합니다.`);
    }
    for(let hop=0;hop<MAX_PAGES+3;hop++){
      assertActive(j);await waitIfPaused(j);
      const before=await inspect(tabId),signature=pageEvidence(before);
      j.pageProof=null;
      j.navigationAttempt={keyword,targetPage,fromPage:actual,beforeEvidence:signature};
      await checkpointPriceNavigation(j);
      await patch(j,{stage:`현재 ${actual??'미확인'}페이지 → ${targetPage}페이지 버튼 이동 중`});
      const clicked=await clickPage(tabId,targetPage,actual,j);
      if(!clicked?.ok)throw Error(clicked?.reason||`${targetPage}페이지 버튼을 찾지 못했습니다. 현재 ${actual??'미확인'}페이지, 보이는 번호 ${(clicked?.available||[]).join(', ')||'없음'}`);
      await log(j,`${keyword} · ${clicked.clickedPage??(clicked.navigation==='prev'?'이전':'다음')}페이지 버튼 클릭${clicked.clickViewport?` · 화면 내 가림 없음 · ${clicked.clickViewport.waitedMs}ms 대기`:''}`);
      j.navigationDirection=clicked.navigation;
      // 실패 후 왕복 클릭·스크롤 없이 저장한 위치에서 대기합니다.
      const after=await waitForPricePageChange(j,tabId,clicked.clickedPage,signature,actual,15000);
      pager=after.pager;let newly=after.actual;
      if(newly===null||newly===undefined)throw Error('이동 후 페이지 번호 확인 불가');
      if(actual!==null&&newly===actual)throw Error('페이지 버튼을 클릭했지만 페이지가 바뀌지 않았습니다.');
      actual=newly;
      await log(j,`${keyword} · ${actual}페이지 이동 확인 (${after.proof})`);
      if(actual===targetPage){await patch(j,{stage:`${targetPage}페이지 확인 · 상품 수집`});return;}
    }
    throw Error(`${targetPage}페이지로 이동하지 못했습니다.`);
  }
  function appendProducts(items,map,page){
    let added=0;
    for(const item of items){
      const key=item.mallSeq+':'+(item.chnlProdNo||item.nvMid),old=map.get(key);
      if(!old){map.set(key,{...item,page});added++;}
      else{
        const storeUrlCandidates=[...new Set([old.storeUrl,item.storeUrl,...(old.storeUrlCandidates||[]),...(item.storeUrlCandidates||[])].filter(Boolean))];
        const observedProductUrls=[...new Set([old.observedProductUrl,old.productUrl,item.observedProductUrl,item.productUrl,...(old.observedProductUrls||[]),...(item.observedProductUrls||[])].filter(Boolean))];
        map.set(key,{...old,title:old.title||item.title,storeName:old.storeName||item.storeName,storeUrl:old.storeUrl||item.storeUrl,productUrl:old.productUrl||item.productUrl,
          storeUrlCandidates,observedProductUrls,identityConflict:old.identityConflict||item.identityConflict||storeUrlCandidates.length>1,
          isAd:Boolean(old.isAd||item.isAd),catalogVerified:Boolean(old.catalogVerified||item.catalogVerified),fromCatalog:Boolean(old.fromCatalog||item.fromCatalog),
          identityIssues:[...new Set([...(old.identityIssues||[]),...(item.identityIssues||[])])],reviews:old.reviews??item.reviews});
      }
    }
    return added;
  }
  function requireScrollPage(data,pager,page){
    const failure=pageRequestFailure(data,page);if(failure)throw failure;
    if(data?.challenge||data?.loading||pager?.domCurrent!==page)throw Error(`${page}페이지 수집 전 확인 실패: 현재 번호 ${pager?.domCurrent??'미확인'} · 상품 로딩/선택 상태 확인 필요. 스크롤을 중지합니다.`);
    if((data?.records||[]).some(x=>Number.isInteger(x.observedPage)&&x.observedPage!==page))throw Error(`${page}페이지 수집 전 확인 실패: 다른 페이지 상품이 남아 있어 스크롤을 중지합니다.`);
    if(!data?.records?.length)throw Error(`${page}페이지 상품 로딩을 확인하지 못해 스크롤을 시작하지 않습니다.`);
  }
  async function loadScrollPage(j,tabId,page,maxSteps=80){
    await waitIfPaused(j);assertActive(j);
    const [ready,pager]=await Promise.all([inspect(tabId),inspectPager(tabId)]);
    requireScrollPage(ready,pager,page);
    await log(j,`${page}페이지 선택·상품 확인 완료 · 맨 위부터 수집 스크롤 시작`);
    await scrollTop(tabId);await pause(500);
    const products=new Map(),rawKeys=new Set(),unidentifiedKeys=new Set(),legacyWideKeys=new Set(),legacySellerWideKeys=new Set(),legacySafeKeys=new Set(),legacyAmbiguousKeys=new Set(),strictKeys=new Set();
    const legacyRejectedReasons={},legacyRejectedSamples=[];const representativeKeys=new Set(),representativeNoProviderKeys=new Set(),representativeNoProductKeys=new Set(),representativeDetails=new Map(),reconciledKeys=new Set();let flat=0,atBottom=0,lastY=-1,totalAds=0,totalLinkEvents=0,terminationReason='step-limit';
    let wrongPage=0,correctPage=0,scrollSamples=0,totalNestedExcluded=0,totalAmbiguousCards=0;
    for(let n=0;n<maxSteps;n++){
      await waitIfPaused(j);
      const [data,currentPager]=await Promise.all([inspect(tabId),inspectPager(tabId)]);
      if(data?.challenge){await waitForProducts(j,tabId,page);continue;}
      requireScrollPage(data,currentPager,page);
      totalAds=Math.max(totalAds,data?.ads||0);
      scrollSamples++;
      totalLinkEvents+=Number(data?.rawEvents||0);
      totalNestedExcluded+=Number(data?.nestedOffersExcluded||0);
      totalAmbiguousCards+=Number(data?.ambiguousCards||0);
      for(const k of data?.representativeKeys||[])representativeKeys.add(k);
      for(const k of data?.representativeNoProviderKeys||[])representativeNoProviderKeys.add(k);
      for(const k of data?.representativeNoProductKeys||[])representativeNoProductKeys.add(k);
      for(const row of data?.representativeDetails||[])if(!representativeDetails.has(row.key))representativeDetails.set(row.key,row);
      for(const k of data?.rawKeys||[])rawKeys.add(k);
      for(const k of data?.legacyWideKeys||[])legacyWideKeys.add(k);
      for(const k of data?.legacySellerWideKeys||[])legacySellerWideKeys.add(k);
      for(const [reason,keys] of Object.entries(data?.legacyRejectedReasons||{})){
        legacyRejectedReasons[reason]??=new Set();for(const k of keys||[])legacyRejectedReasons[reason].add(k);
      }
      for(const sample of data?.legacyRejectedSamples||[]){
        if(legacyRejectedSamples.length<25&&!legacyRejectedSamples.some(x=>x.reason===sample.reason&&x.seller===sample.seller&&x.product===sample.product))legacyRejectedSamples.push(sample);
      }
      for(const k of data?.legacySafeKeys||[])legacySafeKeys.add(k);
      for(const k of data?.legacyAmbiguousKeys||[])legacyAmbiguousKeys.add(k);
      for(const k of data?.strictKeys||[])strictKeys.add(k);
      for(const k of data?.unidentifiedKeys||[])unidentifiedKeys.add(k);
      const raw=data?.records||[];
      const proven=raw.filter(x=>x.observedPage===page).length;
      const wrong=raw.filter(x=>Number.isInteger(x.observedPage)&&x.observedPage!==page).length;
      correctPage+=proven;wrongPage+=wrong;
      // 로그의 pgn이 있으면 잘못된 페이지 소속 상품은 저장하지 않습니다.
      const valid=raw.filter(x=>!Number.isInteger(x.observedPage)||x.observedPage===page);
      for(const item of valid)if(item.representativeKey)reconciledKeys.add(item.representativeKey);
      const before=products.size;appendProducts(valid,products,page);
      flat=products.size===before?flat+1:0;
      const bottom=(data?.scrollY||0)+(data?.viewHeight||0)>=(data?.scrollHeight||0)-12;
      atBottom=bottom?atBottom+1:0;
      if(n%3===0)await patch(j,{stage:`${page}페이지 스크롤 ${n+1}/${maxSteps} · 확인한 상품 ${products.size}개`});
      if(atBottom>=5&&flat>=4){terminationReason='bottom-stable';break;}
      if(!bottom&&lastY===data?.scrollY&&flat>=8){terminationReason='scroll-stalled';break;}
      lastY=data?.scrollY;
      await scroll(tabId);await pause(bottom?800:SCROLL_DELAY);
    }
    if(!products.size&&!representativeKeys.size)throw Error(`${page}페이지 상품을 수집하지 못했습니다 (다른 페이지 소속 ${wrongPage}건 확인).`);
    if(page>1&&correctPage===0&&wrongPage>0)throw Error(`${page}페이지의 상품임을 검증하지 못했습니다. 이전 페이지 데이터 ${wrongPage}건만 확인되었습니다.`);
    const unresolvedCandidates=[...representativeDetails.values()].filter(x=>!reconciledKeys.has(x.key));
    return {products:[...products.values()],ads:totalAds,correctPage,wrongPage,incomplete:terminationReason!=='bottom-stable',
      scan:{linkEvents:totalLinkEvents,nestedExcludedEvents:totalNestedExcluded,ambiguousCardEvents:totalAmbiguousCards,rawUnique:rawKeys.size,identifiedUnique:products.size,
        legacyWideUnique:legacyWideKeys.size,legacySellerWideUnique:legacySellerWideKeys.size,
        legacyWideOnlyUnique:[...legacySellerWideKeys].filter(k=>!strictKeys.has(k)).length,
        legacySafeUnique:legacySafeKeys.size,legacyAmbiguousUnique:legacyAmbiguousKeys.size,
        legacyRejectedReasons:Object.fromEntries(Object.entries(legacyRejectedReasons).map(([k,v])=>[k,v.size])),
        legacyRejectedSamples,strictUnique:strictKeys.size,legacyAddedUnique:[...products.values()].filter(x=>x.discoveryMethod==='legacy').length,
        // 독립상품처럼 보였지만 필수 ID 누락된 대표링크만 실제 누락 경고로 집계.
        unidentifiedUnique:unidentifiedKeys.size,
        representativeCandidates:representativeKeys.size,representativeNoProvider:representativeNoProviderKeys.size,
        representativeNoProductId:representativeNoProductKeys.size,
        reconciledRepresentativeCount:reconciledKeys.size,unresolvedCandidates,
        terminationReason,reachedBottom:terminationReason==='bottom-stable',incomplete:terminationReason!=='bottom-stable',
        scrollSamples,wrongPage,correctPage}};
  }
  // 상품별 수집 과정 근거를 기록합니다. 같은 업체 상품을 하나로 묶더라도 사유는 보존합니다.
  function addAuditRow(item,keyword,page,source,decision){
    state.auditRows=state.auditRows||[];
    if(state.auditRows.length>=12000){state.auditTruncated=(state.auditTruncated||0)+1;return;}
    state.auditRows.push({keyword,page,source,decision,mallSeq:str(item.mallSeq),nvMid:str(item.nvMid),
      channelProductNo:str(item.chnlProdNo),storeName:str(item.storeName),storeUrl:str(item.storeUrl),productName:str(item.title),
      representativeKey:str(item.representativeKey||item.key),catalogEvidenceSource:str(item.catalogEvidenceSource),catalogNvMid:str(item.catalogNvMid),sellerCount:item.sellerCount??'',isAd:item.isAd===true?'Y':'N',reviews:item.reviews??'',
      advertiserType:str(item.advertiserType),discoveryMethod:str(item.discoveryMethod||'catalog'),productUrl:C.cleanProductUrl(item.productUrl,item.storeUrl,item.chnlProdNo),observedProductUrl:str(item.observedProductUrl||item.productUrl),identityIssues:(item.identityIssues||[]).join(' / '),catalogVerified:!!item.catalogVerified,catalogEvidence:item.catalogEvidence||'원부 확정 근거 미확보',specialNotes:C.flagList(item).join(', ')});
  }
  function recordScanAudit(audit,scan={},keyword,page){
    Object.assign(audit,{scanRepresentativeCandidates:scan.representativeCandidates||0,scanRepresentativeNoProvider:scan.representativeNoProvider||0,scanRepresentativeNoProductId:scan.representativeNoProductId||0,
      scanRawUnique:scan.rawUnique||0,scanUnidentifiedUnique:scan.unidentifiedUnique||0,scanTerminationReason:scan.terminationReason||'current-screen',scanIncomplete:!!scan.incomplete,
      scanLinkEvents:scan.linkEvents||0,scanNestedExcluded:scan.nestedExcludedEvents||0,scanAmbiguousCards:scan.ambiguousCardEvents||0,scanSamples:scan.scrollSamples||1,
      scanLegacyWideUnique:scan.legacyWideUnique||0,scanLegacySellerWideUnique:scan.legacySellerWideUnique||0,scanLegacyWideOnlyUnique:scan.legacyWideOnlyUnique||0,
      scanLegacyRejectedReasons:scan.legacyRejectedReasons||{},scanLegacyRejectedSamples:scan.legacyRejectedSamples||[],scanLegacySafeUnique:scan.legacySafeUnique||0,scanLegacyAmbiguousUnique:scan.legacyAmbiguousUnique||0,scanStrictUnique:scan.strictUnique||0,scanLegacyAddedUnique:scan.legacyAddedUnique||0});
    audit.scanCoverageUnverified=Array.isArray(scan.unresolvedCandidates)?scan.unresolvedCandidates.length:Math.max(0,audit.scanRepresentativeCandidates-(scan.reconciledRepresentativeCount??audit.scanRawUnique));
    for(const row of scan.unresolvedCandidates||[])addAuditRow({...row,discoveryMethod:'unresolved'},keyword,page,'미식별 대표상품',`수집 미완료: ${row.reason||'상품 식별 근거 부족'}`);
    const unidentified=(state.auditRows||[]).filter(x=>x.source==='미식별 대표상품');
    state.unidentifiedUniqueCandidates=new Set(unidentified.map(x=>x.representativeKey||[x.mallSeq,x.nvMid,x.nvMid?'':x.productName].join(':'))).size;
    state.unidentifiedObservationCount=unidentified.length;
    if(scan.incomplete){
      const label=`${keyword} ${page}페이지 (스크롤 미완료: ${scan.terminationReason})`;
      state.incompletePages=state.incompletePages||[];if(!state.incompletePages.includes(label))state.incompletePages.push(label);
    }
  }
  function reconcilePage(c,keyword,page,observed,offers,catalogMetrics){
    const metrics={keyword,page,searchProducts:observed.length,rawNaver:0,rawExternal:0,rawUnknown:0,
      rawCatalogRepresentatives:0,rawExistingProduct:0,rawAdded:0,
      apiOffers:catalogMetrics?.apiOffers||0,apiNaver:catalogMetrics?.apiNaver||0,apiExternal:catalogMetrics?.apiExternal||0,
      catalogNewOffers:offers.length,offerExistingProduct:0,offerAdded:0,
      catalogsAttempted:catalogMetrics?.catalogsAttempted||0,catalogsFailed:catalogMetrics?.catalogsFailed||0,catalogsSkippedSelf:catalogMetrics?.catalogsSkippedSelf||0,
      catalogsSucceeded:catalogMetrics?.catalogsSucceeded||0};
    metrics.catalogLookupEnabled=catalogMetrics?.catalogLookupEnabled??state.settings.catalogLookup===true;
    metrics.catalogsDisabled=catalogMetrics?.catalogsDisabled||0;
    const known=new Map(c.products.map(x=>[x.mallSeq+':'+(x.chnlProdNo||x.nvMid),x]));
    const mergeKnown=(key,item)=>{const one=new Map([[key,known.get(key)]]);appendProducts([item],one,page);Object.assign(known.get(key),one.get(key));};
    for(const item of observed){
      let status='';
      if(item.isCatalogRepresentative){status=metrics.catalogLookupEnabled?'원부상품 대표카드 (판매처 API 조회 대상)':'원부상품 대표카드 · 설정으로 판매처 미조회';metrics.rawCatalogRepresentatives++;}
      else if(!item.isNaverStore){status=item.advertiserType==='SHOPN'?'네이버스토어 식별정보 불충분':'외부쇼핑몰/네이버스토어 미확인';
        if(item.advertiserType==='SHOPN')metrics.rawUnknown++;else metrics.rawExternal++;
      }else{
        metrics.rawNaver++;
        // SHOPN + 채널번호 + 개별상품번호까지 확인된 단일 판매자 상품은
        // 카탈로그 판매처 수가 2 이상이어도 먼저 보존합니다. API는 추가 판매처만 더합니다.
        // 대표카드 자체(개별 판매자 상품 번호 없음)는 API로 분리합니다.
        if(item.sellerCount>1&&!item.chnlProdNo){status=metrics.catalogLookupEnabled?'원부상품 대표카드 제외 (판매처 API로 대체)':'원부상품 대표카드 · 설정으로 판매처 미조회';metrics.rawCatalogRepresentatives++;}
        else{
          const key=item.mallSeq+':'+(item.chnlProdNo||item.nvMid);
          if(known.has(key)){mergeKnown(key,item);status='기존 상품 중복';metrics.rawExistingProduct++;}
          else{const added={...item,keyword,page};known.set(key,added);c.products.push(added);metrics.rawAdded++;
            status=item.discoveryMethod==='legacy'?'2.x 확장탐색 네이버상품 추가':'상품 후보 추가';}
        }
      }
      addAuditRow(item,keyword,page,'검색결과',status);
    }
    for(const item of offers){
      const key=item.mallSeq+':'+(item.chnlProdNo||item.nvMid);
      const wasKnown=known.has(key);
      if(wasKnown){mergeKnown(key,item);metrics.offerExistingProduct++;addAuditRow(item,keyword,page,'카탈로그 판매처','기존 상품 중복');}
      else{const added={...item,keyword,page};known.set(key,added);c.products.push(added);metrics.offerAdded++;addAuditRow(item,keyword,page,'카탈로그 판매처','상품 후보 추가');}
    }
    metrics.added=metrics.rawAdded+metrics.offerAdded;
    state.auditPages=state.auditPages||[];state.auditPages.push(metrics);
    return metrics;
  }
  async function holdPricePage(j,c,keyword,page,error){
    assertActive(j);
    const reason=str(error.message||error).slice(0,1000),label=`${keyword} ${page}페이지 (수집 확인 대기)`;
    const attempt=j.navigationAttempt?.keyword===keyword&&j.navigationAttempt.targetPage===page?j.navigationAttempt:null;
    c.nextPage=page;
    c.pageWait={...(c.pageWait||{}),...(attempt||{}),keyword,page,reason,label,requestFailure:error.requestFailure||null,failedAt:Date.now()};
    state.incompletePages=state.incompletePages||[];
    if(!state.incompletePages.includes(label))state.incompletePages.push(label);
    await save();
    await log(j,`${keyword} ${page}페이지 확인 대기 · 기존 상품 ${c.products.length}개 보존 · 사업자조회는 전체 페이지 수집 후 시작. 원인: ${reason}`);
    const held=Error(reason);held.code='PAGE_WAIT';throw held;
  }
  async function collectPrice(j,c,keyword){
    let previousSignature=c.previousSignature||'';
    for(let p=c.nextPage;p<=c.to;p++){
      await waitIfPaused(j);
      await patch(j,{page:p,phase:`${keyword} · ${p}/${c.to}페이지`,stage:'페이지 준비 중'});
      j.navigationAttempt=null;
      try{await navigatePrice(j,j.tabId,keyword,p);}
      catch(e){
        if(j.cancelled)throw e;
        await holdPricePage(j,c,keyword,p,e);
      }
      const pageStartedAt=Date.now();
      let result;
      try{result=await loadScrollPage(j,j.tabId,p);}
      catch(e){
        if(j.cancelled)throw e;
        await holdPricePage(j,c,keyword,p,e);
      }
      const sig=result.products.map(x=>x.mallSeq+':'+x.nvMid).sort().join('|');
      const repeatedPage=Boolean(previousSignature&&sig===previousSignature);
      const repeatedWithProof=j.pageProof?.page===p&&result.products.every(x=>x.observedPage===p)&&j.pageProof.lifecycleProof===true;
      if(previousSignature&&sig===previousSignature&&!repeatedWithProof){
        await holdPricePage(j,c,keyword,p,Error(`${keyword} ${p}페이지 상품 목록이 이전 페이지와 같습니다. 실제 상품 갱신을 확인한 뒤 이어하기를 누르세요.`));
      }
      previousSignature=result.products.map(x=>x.mallSeq+':'+x.nvMid).sort().join('|');
      // 화면에서 일반상품처럼 보이는 카드도 catalog_nv_mid를 통해 카탈로그를 조회합니다.
      const catalogs=await expandCatalogsOnPage(j,c,keyword,p,result.products);
      const audit=reconcilePage(c,keyword,p,result.products,catalogs.expanded,catalogs.counts);
      audit.repeatedProductsWithNewResponse=Boolean(repeatedPage&&repeatedWithProof);
      audit.repeatedProductsVerified=Boolean(repeatedPage&&repeatedWithProof);
      audit.pageDurationMs=Date.now()-pageStartedAt;
      recordScanAudit(audit,result.scan,keyword,p);
      audit.scanReconciledProducts=result.products.length;
      const newly=audit.added;
      if(c.products.length>MAX_ITEMS)throw Error(`상품 수집 한도 ${MAX_ITEMS}건을 초과했습니다. 페이지·키워드 범위를 줄이세요.`);
      c.previousSignature=previousSignature;c.nextPage=p+1;
      if(c.pageWait?.keyword===keyword&&c.pageWait.page===p){
        state.incompletePages=state.incompletePages.filter(x=>x!==c.pageWait.label);delete c.pageWait;
      }
      state.discovered=c.products.length;state.ads+=result.ads;
      state.pageStats.push({keyword,page:p,products:result.products.length,newItems:newly,total:c.products.length});
      await save();
      await log(j,`${keyword} ${p}페이지 대표링크 후보 ${audit.scanRepresentativeCandidates}개 · 추출 식별자 ${audit.scanRawUnique}개 · 후보-식별 차이 ${audit.scanCoverageUnverified}개 (판매자번호 없음 ${audit.scanRepresentativeNoProvider}, 상품번호 없음 ${audit.scanRepresentativeNoProductId}; 후보 수는 실제 카드 수와 다를 수 있음) · 조회/원부 포함 소요 ${(audit.pageDurationMs/1000).toFixed(1)}초`);
      await log(j,`${keyword} ${p}페이지 상품식별 ${audit.searchProducts}개 (2.x 원시 식별 ${audit.scanLegacyWideUnique}, 2.x 판매자 식별 ${audit.scanLegacySellerWideUnique}, 대표상품 ${audit.scanStrictUnique}, 보조링크 단독 후보 ${audit.scanLegacyWideOnlyUnique}, 검증통과 ${audit.scanLegacySafeUnique}, 실제 추가 ${audit.scanLegacyAddedUnique}, 상품 자체 미식별 ${audit.scanUnidentifiedUnique}; 원시 이벤트 ${audit.scanLinkEvents}) = 네이버 ${audit.rawNaver} / 외부 ${audit.rawExternal} / 채널 미확인 ${audit.rawUnknown} · 카탈로그 판매처 응답 ${audit.apiOffers}개 (네이버 ${audit.apiNaver} / 그외 ${audit.apiExternal}, 자기참조 조회 생략 ${audit.catalogsSkippedSelf||0}) · 신규 상품 ${newly}개 (화면 ${audit.rawAdded}, 카탈로그 ${audit.offerAdded}) · 누적 ${c.products.length}개`);
      await pause(650);
    }
  }
  async function collectPlus(j,c,keyword){
    await patch(j,{phase:`${keyword} · 플러스스토어 연속 추출`,stage:`상품이 보일 때 즉시 수집 · ${PLUS_BATCH}개마다 저장 · ■ 수집 종료를 누르면 업체 조회 시작`});
    await ensureKeyword(j,j.tabId,keyword);
    await waitForProducts(j,j.tabId,'플러스스토어');
    await scrollTop(j.tabId);
    // 이전 체크포인트를 재사용합니다. 위쪽 상품이 가상 스크롤로 사라져도 저장된 결과는 남습니다.
    const all=new Map();
    for(const item of c.products.filter(x=>x.keyword===keyword)){
      all.set(item.mallSeq+':'+(item.chnlProdNo||item.nvMid),item);
    }
    let noNew=0,bottomStable=0,lastY=-1,steps=0,lastCheckpoint=Math.floor(all.size/PLUS_BATCH),terminationReason='user-stop';
    const representativeDetails=new Map(),representativeKeys=new Set(),reconciledKeys=new Set();
    while(!j.finishCollection){
      await waitIfPaused(j);assertActive(j);
      let data=await inspect(j.tabId);
      if(data?.challenge){await waitForProducts(j,j.tabId,'플러스스토어');continue;}
      for(const key of data?.representativeKeys||[])representativeKeys.add(key);
      for(const row of data?.representativeDetails||[])representativeDetails.set(row.key,row);
      const before=all.size;
      for(const item of data?.records||[]){
        if(item.representativeKey)reconciledKeys.add(item.representativeKey);
        const key=item.mallSeq+':'+(item.chnlProdNo||item.nvMid);
        if(!all.has(key)){
          const product={...item,keyword,page:Math.floor(all.size/PLUS_BATCH)+1};
          all.set(key,product);c.products.push(product);
        }
      }
      const gained=all.size-before;
      noNew=gained===0?noNew+1:0;
      const batch=Math.floor(all.size/PLUS_BATCH);
      state.discovered=c.products.length;
      state.page=Math.max(1,Math.ceil(all.size/PLUS_BATCH));
      state.stage=`플러스스토어 ${all.size}개 상품 · ${Math.floor(all.size/PLUS_BATCH)}개 묶음 저장 · 다음 ${PLUS_BATCH}개 수집 중`;
      // 매 스크롤 직후 체크포인트 저장: 가상 스크롤로 제거된 위쪽 상품도 보존합니다.
      await save();
      if(batch>lastCheckpoint){
        for(let b=lastCheckpoint+1;b<=batch;b++){
          state.pageStats.push({keyword,page:`묶음 ${b}`,products:PLUS_BATCH,newItems:PLUS_BATCH,total:b*PLUS_BATCH});
          await log(j,`${keyword} · ${b}차 ${PLUS_BATCH}개 확보 · 누적 ${b*PLUS_BATCH}개 · 계속 스크롤`);
        }
        lastCheckpoint=batch;await save();
      }
      if(all.size>=MAX_ITEMS){
        terminationReason='item-limit';await log(j,`안전 한도 ${MAX_ITEMS}개 도달 · 저장한 상품으로 업체 조회를 진행합니다.`);break;
      }
      const atBottom=(data?.scrollY||0)+(data?.viewHeight||0)>=(data?.scrollHeight||0)-12;
      bottomStable=atBottom&&gained===0?bottomStable+1:0;
      if(bottomStable>=7&&noNew>=9){
        terminationReason='bottom-stable';
        await log(j,`${keyword} · 페이지 하단에서 추가 상품이 9회 연속 확인되지 않아 자동 종료 (누락 가능성은 실환경 확인 필요)`);
        break;
      }
      if(lastY===data?.scrollY&&noNew>=12){
        terminationReason='scroll-stalled';
        await log(j,`${keyword} · 스크롤 위치가 더 이상 변하지 않아 수집 종료 (상품 ${all.size}개)`);
        break;
      }
      lastY=data?.scrollY;
      await scroll(j.tabId);steps++;
      await pause(SCROLL_DELAY);
      if(steps%5===0)await patch(j,{stage:`${keyword} · 스크롤 ${steps}회 · 고유 상품 ${all.size}개 · ${PLUS_BATCH}개마다 저장 중`});
    }
    if(!all.size)throw Error('플러스스토어 상품을 수집하지 못했습니다.');
    const remaining=all.size%PLUS_BATCH;
    if(remaining){
      state.pageStats.push({keyword,page:`묶음 ${Math.floor(all.size/PLUS_BATCH)+1}`,products:remaining,newItems:remaining,total:all.size});
    }
    const items=[...all.values()];
    const audit={keyword,page:'연속스크롤',searchProducts:items.length,rawNaver:items.filter(x=>x.isNaverStore).length,rawExternal:items.filter(x=>!x.isNaverStore).length,added:items.filter(x=>x.isNaverStore).length};
    state.auditPages.push(audit);
    for(const item of items)addAuditRow(item,keyword,item.page,'플러스스토어',item.isNaverStore?'상품 후보 추가':'외부쇼핑몰/네이버스토어 미확인');
    recordScanAudit(audit,{representativeCandidates:representativeKeys.size,reconciledRepresentativeCount:reconciledKeys.size,
      unresolvedCandidates:[...representativeDetails.values()].filter(x=>!reconciledKeys.has(x.key)),terminationReason,incomplete:terminationReason!=='bottom-stable'},keyword,'연속스크롤');
    await save();
    await log(j,`${keyword} · 플러스스토어 상품 ${all.size}개 확보 · ${j.finishCollection?'사용자가 수집 종료':'페이지 하단/안전 한도 확인'} · 이제 업체 상태 조회`);
  }
  async function collect(j){
    const c=state.collection;if(!c)return;
    for(let ki=c.keywordIndex;ki<c.keywords.length;ki++){
      await waitIfPaused(j);
      const keyword=c.keywords[ki];
      await patch(j,{keyword,phase:`키워드 ${ki+1}/${c.keywords.length}`,stage:`${keyword} 수집 중`});
      if(j.finishCollection)break;
      if(c.mode==='current'){
        const data=await inspect(j.tabId);
        if(!data?.records?.length&&!data?.representativeKeys?.length)throw Error('현재 화면에서 상품을 찾지 못했습니다.');
        const pInfo=await inspectPager(j.tabId);const page=pInfo?.current||Number(new URL((await chrome.tabs.get(j.tabId)).url||c.searchUrl).searchParams.get('pagingIndex')||1);
        const catalogs=c.source==='price'?await expandCatalogsOnPage(j,c,keyword,page,data.records):{expanded:[]};
        const audit=reconcilePage(c,keyword,page,data.records,catalogs.expanded,catalogs.counts);
        const reconciled=new Set(data.records.map(x=>x.representativeKey).filter(Boolean));
        recordScanAudit(audit,{representativeCandidates:data.representativeKeys?.length||0,rawUnique:data.rawKeys?.length||0,
          representativeNoProvider:data.representativeNoProviderKeys?.length||0,representativeNoProductId:data.representativeNoProductKeys?.length||0,
          unresolvedCandidates:(data.representativeDetails||[]).filter(x=>!reconciled.has(x.key)),terminationReason:'current-screen'},keyword,page);
        state.discovered=c.products.length;
        state.pageStats.push({keyword,page,products:data.records.length,newItems:audit.added,total:c.products.length});
        await log(j,`${keyword} 현재 화면 식별상품 ${audit.searchProducts}개 · 신규 네이버상품 ${audit.added}개 · 외부몰 ${audit.rawExternal}개 · 연결 원부 대표카드 ${audit.rawCatalogRepresentatives}개`);
      }else if(c.source==='plus')await collectPlus(j,c,keyword);
      else await collectPrice(j,c,keyword);
      c.keywordIndex=ki+1;c.nextPage=c.from;c.previousSignature='';await save();
      if(j.finishCollection)break;
    }
    // 모든 키워드/페이지 수집 후 동일 판매자 주소를 전파합니다. 해당 상품의 실제 스토어가
    // 다르게 관찰되면 덮어쓰지 않고 충돌 진단만 남깁니다.
    const identity=C.enrichStoreUrls(c.products,storeHints(c.products));
    c.products=identity.products;
    state.statistics.bizStoreRecovered+=identity.recovered;
    state.statistics.bizStoreConflicts+=identity.conflicts.length;
    if(identity.recovered||identity.conflicts.length){
      for(const row of state.auditRows||[]){
        const conflict=identity.conflicts.find(x=>x.seller===str(row.mallSeq));
        if(conflict){row.observedProductUrl=row.observedProductUrl||row.productUrl;row.productUrl='';row.storeUrl='';row.identityIssues=conflict.reasons.join(' / ');row.decision='식별정보 충돌 보류 (업체조회 제외)';continue;}
        const base=identity.resolved[str(row.mallSeq)];
        if(base&&!row.storeUrl){row.storeUrl=base;row.productUrl=C.cleanProductUrl(row.productUrl,base,row.channelProductNo);}
      }
      await log(j,`판매자 스토어 URL 연결 보강 · 주소 회복 상품 ${identity.recovered}개 · 직접링크 복구 ${identity.updatedLinks}개 · 충돌 업체 ${identity.conflicts.length}곳 (충돌은 자동 적용 안 함)`);
      await save();
    }
    const confirmed=c.products.filter(item=>item.isNaverStore===true);
    const filtered=C.filterProducts(confirmed,state.settings,new Set(state.seen));
    for(const [k,v] of Object.entries(filtered.stats))state.statistics[k]=(state.statistics[k]||0)+v;
    // 진단 CSV의 상품별 최종 상태를 확정. 관찰값 자체를 버리지 않고 업체 통합 이유를 기록합니다.
    const selectedByStore=new Map(filtered.products.map(x=>[str(x.mallSeq),str(x.chnlProdNo||x.nvMid)]));
    const usedSelected=new Set();
    for(const row of state.auditRows||[]){
      if(!['상품 후보 추가','2.x 확장탐색 네이버상품 추가'].includes(row.decision))continue;
      const id=str(row.mallSeq),key=str(row.channelProductNo||row.nvMid);
      if(selectedByStore.get(id)===key&&!usedSelected.has(id)){
        row.decision='최종 사업자조회 대상';usedSelected.add(id);
      }else if(selectedByStore.has(id))row.decision='동일 업체의 다른 상품 통합';
      else if(state.seen.includes(id))row.decision='이전 작업에서 처리한 업체';
      else row.decision='설정 필터·정보 부족 등으로 업체조회 제외';
    }
    const audited=(state.auditPages||[]).reduce((a,x)=>a+x.searchProducts,0);
    const unresolved=(state.auditPages||[]).reduce((a,x)=>a+Math.max(x.scanUnidentifiedUnique||0,x.scanCoverageUnverified||0),0);
    if(unresolved){state.unidentifiedWarnings=unresolved;await save();}
    await log(j,`수집 검증 · 검색결과 식별 관측 ${audited}건 · 미식별 후보 관측 ${unresolved}건 / 고유 후보 ${state.unidentifiedUniqueCandidates||0}개(보조 링크는 별도 진단) · 네이버 상품 후보 ${confirmed.length}개 · 업체 중복 ${filtered.stats.sameSeller}건 · 작업 중복 ${filtered.stats.duplicate}건 · 필터/식별 제외 ${filtered.stats.filtered+filtered.stats.adsExcluded+filtered.stats.unknownReviews+filtered.stats.unknownGroup+filtered.stats.invalidSeller}건 · 사업자 조회 대상 ${filtered.products.length}곳`);
    if(filtered.products.length>MAX_STORES)throw Error(`업체 ${filtered.products.length}곳으로 1회 조회 한도 ${MAX_STORES}곳 초과. 범위를 줄이세요.`);
    // 네이버에서 관찰한 정보만으로 생성하는 독립형 16열 CSV. 연락처·대표자·주소는 추정하지 않습니다.
    const now=new Date();const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    state.basic=filtered.products.map(item=>({keyword:item.keyword,page:item.page,productName:item.title||'',productUrl:C.cleanProductUrl(item.productUrl,item.storeUrl,item.chnlProdNo),companyName:item.storeName||'',reviews:item.reviews??'',ceoName:'',phoneNumber:'',address:'',owner:state.settings.owner||'',date,mid:item.chnlProdNo||'',demographic:'',status:'연락처 미확인',memo:C.flagList(item).join(', '),history:'',mallSeq:str(item.mallSeq)}));
    const company=true;
    state.pending=company?filtered.products:[];state.total=company?filtered.products.length:0;state.processed=0;
    state.collection=null;await save();
    await log(j,company?`상품 수집 완료${state.catalogWarnings?' (카탈로그 누락 '+state.catalogWarnings+'건 가능)':''} · ${state.pending.length}곳 사내 상태·사업자 전화번호 조회 시작`:`상품 수집 완료 · 기본 상품정보 ${state.basic.length}곳 저장`);
  }
  async function strictStatus(j,id){
    assertActive(j);const base=await getApiBaseUrl();
    const url=`${base}/api/extension/store-status?mallSeq=${encodeURIComponent(id)}`;
    const ac=new AbortController();j.abort=ac;
    const timer=setTimeout(()=>ac.abort(),11000);
    try{
      const r=await fetch(url,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',signal:ac.signal});
      if([401,403].includes(r.status))throw Error(`사내 조회 인증/권한 오류 HTTP ${r.status}`);
      if(!r.ok)throw Error(`사내 가망 조회 HTTP ${r.status}`);
      const data=await r.json();
      if(typeof data?.data?.exists!=='boolean')throw Error('가망 서버 응답에 exists 값이 없습니다.');
      return data.data;
    }finally{clearTimeout(timer);if(j.abort===ac)j.abort=null;}
  }
  async function timeout(p,ms,name,onTimeout){let t;try{return await Promise.race([p,new Promise((_,reject)=>t=setTimeout(()=>{onTimeout?.();reject(Error(`${name} ${ms/1000}초 초과`));},ms))]);}finally{clearTimeout(t);}}
  function addReview(item,reason,business={}){state.review.push({keyword:item.keyword,page:item.page,mallSeq:item.mallSeq,nvMid:item.nvMid,productName:item.title||'',productUrl:C.cleanProductUrl(item.productUrl,item.storeUrl,item.chnlProdNo),observedProductUrl:item.observedProductUrl||'',storeUrl:item.storeUrl||business.storeUrl||'',storeName:item.storeName||business.companyName||'',ceoName:business.ceoName||'',phoneNumber:business.phoneNumber||'',phoneCandidates:(business.phoneCandidates||[]).map(x=>x.number).join(' / '),address:business.address||'',reason,lookupOrigin:item.lookupOrigin||'',lookupHttpStatus:item.lookupDiagnostic?.httpStatus||'',lookupEndpoint:item.lookupDiagnostic?.endpoint||'',lookupServerMessage:item.lookupDiagnostic?.serverMessage||'',memo:C.flagList(item).join(', ')});}
  async function processPending(j){
    while(state.pending?.length){
      await waitIfPaused(j);
      const item=state.pending[0],id=str(item.mallSeq),name=storeLabel(item);
      await patch(j,{phase:`업체 조회 ${state.processed+1}/${state.total}`,stage:`${name} · 사내 가망 상태 확인`,currentStore:name});
      let complete=false,retryableMissing=false,holdBusiness={};
      try{
        if(item.identityConflict){
          addReview(item,'판매자·스토어 주소·상품번호 충돌 · 잘못된 업체 조회 방지를 위해 보류');
          retryableMissing=true;complete=true;
          state.statistics.bizIdentityConflicts=(state.statistics.bizIdentityConflicts||0)+1;
          await log(j,`${name} · 식별정보 충돌 · 회사 캐시/최신 조회 미실행`);
        }else if(state.seen.includes(id)){
          state.statistics.lookupPrevented++;complete=true;
          await log(j,`${name} · 이전에 처리한 스토어, 조회 생략`);
        }else{
          await log(j,`${name} · 상태 조회`);
          const rec=await strictStatus(j,id);assertActive(j);
          const category=C.statusCategory(rec);
          state.statistics.checked++;state.statistics[category]=(state.statistics[category]||0)+1;
          if(['paid','paymentScheduled','sameBranch','otherBranch','excluded'].includes(category)){
            state.skipped++;complete=true;
            await log(j,`${name} · ${C.statusLabel(category)} · CSV 제외`);
          }else if(category==='unknown'){
            addReview(item,`판별되지 않은 사내 가망 상태: ${str(rec.status)||'(없음)'}`);
            complete=true;await log(j,`${name} · 상태 미확인, 보류`);
          }else{
            await patch(j,{stage:`${name} · 사업자 연락처 조회`,currentStore:name});
            // 최신 조회기에서 회사 어드민에 저장한 URL도 활용. 매칭된 mallSeq의 상태 응답만 신뢰.
            // 회사 캐시 조회/URL 확인은 과금 대상이 아니므로 재조회 차단 이력에 기록하지 않음.
            const remembered=storeHints([item])[id];
            if(!item.storeUrl&&remembered){item.storeUrl=remembered;item.productUrl=C.cleanProductUrl(item.productUrl,remembered,item.chnlProdNo);}
            const prepared=await timeout(prepareBusinessLookup(id,item.storeUrl,item.productUrl,rec.storeUrl,rec.storeProductUrl,item.chnlProdNo,item.nvMid),16000,'조회 준비');
            assertActive(j);
            holdBusiness=prepared.cacheData||{};item.lookupOrigin=prepared.origin||'';
            if(prepared.cacheIncomplete)await log(j,`${name} · 회사 캐시의 온전한 010 미확보 → ${prepared.kind==='legacy'?'판매자번호+쇼핑상품번호':'스토어 주소'}로 신규 조회`);
            if(prepared.kind==='conflict'){
              state.statistics.bizIdentityConflicts=(state.statistics.bizIdentityConflicts||0)+1;
              addReview(item,prepared.error||'회사 정보와 스토어 주소 충돌');retryableMissing=true;complete=true;
              await log(j,`${name} · 회사 정보와 주소 충돌 · 최신 조회 보류`);
            }else if(prepared.kind==='missing'){
              state.statistics.bizUrlMissing++;
              if(item.isAd)state.statistics.bizUrlMissingAds++;
              if(item.fromCatalog)state.statistics.bizUrlMissingCatalogs++;
              retryableMissing=true;
              addReview(item,'실제 스마트스토어·브랜드스토어 주소 미확인 · 최신 API 조회하지 않음');
              complete=true;
              await log(j,`${name} · 스토어 ID/URL 확인 불가 · 과금 API 요청 없이 보류`);
            }else if(['latest','legacy'].includes(prepared.kind)&&lookupAlreadyRequested(id,prepared.storeUrl)){
              addReview(item,'이번 작업에서 이미 조회 요청함 · 자동 반복 조회 보류 (새 작업에서 재조회 가능)');
              state.statistics.lookupPrevented++;complete=true;retryableMissing=true;
              await log(j,`${name} · 이번 작업 내 동일 업체의 반복 요청 생략`);
            }else{
              let reservation;
              const ac=new AbortController();j.abort=ac;
              let biz;
              try{
                const operation=executePreparedBusinessLookup(prepared,id,{
                  signal:ac.signal,assertActive:()=>assertActive(j),
                  beforeRequest:async storeUrl=>{
                    await waitIfPaused(j);assertActive(j);
                    if(ac.signal.aborted)throw Error('조회 요청 전 중단됨');
                    reservation=await recordLookupRequest(j,id,storeUrl);
                  }
                }).then(async result=>{
                  // 호출자가 먼저 제한시간을 맞더라도 실제 미전송이 확정되면 예약 이력을 정리한다.
                  try{await finishLookupRequest(id,reservation,result);}
                  catch(e){result.warning=[result.warning,'조회 이력 상태 갱신 실패 · 먼저 저장한 요청 이력은 유지됨'].filter(Boolean).join(' / ');}
                  return result;
                });
                biz=await timeout(operation,22000,'사업자정보 요청',()=>ac.abort());
              }finally{if(j.abort===ac)j.abort=null;}
              assertActive(j);
              item.lookupDiagnostic={httpStatus:biz?.httpStatus||'',endpoint:biz?.endpoint||'',serverMessage:biz?.serverMessage||''};
              if(!biz?.success||!biz.data){
                if(biz?.code==='AUTH_REQUIRED')state.statistics.bizAuthErrors++;
                if(biz?.code==='NO_SELLER_DETAILS')state.statistics.bizNoDetails++;

                throw Error(`사업자정보 조회 실패: ${biz?.error||'응답 없음'}`);
              }
              if(biz.origin==='company-cache')state.statistics.bizCached++;
              else if(biz.origin==='latest-api')state.statistics.bizLatest++;
              else if(biz.origin==='number-api')state.statistics.bizLegacy++;
            await log(j,`${name} · 사업자정보 취득 경로: ${biz.origin==='latest-api'?'최신 API':biz.origin==='number-api'?'판매자번호+쇼핑상품번호 조회':'회사 캐시'}`);
            if(biz.warning)await log(j,`${name} · ${biz.warning}`);
            const b=biz.data;item.lookupOrigin=biz.origin;
            const recovered=C.storeBase(b.storeUrl);
            if(recovered){
              if(item.storeUrl&&C.storeBase(item.storeUrl)!==recovered)throw Error('사업자조회 응답 스토어 주소 불일치');
              if(!item.storeUrl)state.statistics.bizStoreRecovered++;
              item.storeUrl=recovered;item.productUrl=C.cleanProductUrl(item.productUrl,recovered,item.chnlProdNo);
              for(const row of state.auditRows.filter(x=>String(x.mallSeq)===id)){row.storeUrl=recovered;row.productUrl=C.cleanProductUrl(row.productUrl,recovered,row.channelProductNo);}
              for(const row of state.basic.filter(x=>String(x.mallSeq)===id))row.productUrl=C.cleanProductUrl(row.productUrl,recovered,row.mid);
            }
            const registration=C.registerBusiness(state.businessIndex,b.businessNumber,id);
            if(registration.duplicate){
              C.applyBusinessDuplicates(state.matched,registration.related);
              for(const row of state.review){if(registration.related.includes(str(row.mallSeq)))row.memo=C.appendFlag(row.memo,'사업자중복');}
              state.statistics.businessDuplicates=Object.values(state.businessIndex).filter(ids=>ids.length>1).reduce((sum,ids)=>sum+ids.length,0);
              await log(j,`${name} · 동일 사업자등록번호의 다른 스토어 확인 (${registration.related.length}곳)`);
            }
            const phone=C.mobile010(b.phoneNumber);
            if(!phone){
              addReview(item,(biz.origin==='company-cache'?'회사 캐시':'신규 사업자조회 완료')+' · '+(/010/.test(b.phoneNumber)&&/[*•●]/.test(b.phoneNumber)?'010 번호 일부 가려짐':'유효한 010 미확보'),b);state.statistics.no010++;complete=true;
              await log(j,`${name} · 010번호 미확인, 보류`);
            }else{
              const now=new Date();const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
              const storeName=str(item.storeName||b.companyName||b.storeName||b.channelName||b.mallName||'').trim();
              const resolvedStoreUrl=item.storeUrl||b.storeUrl||b.mallUrl||b.channelUrl||'';
              const productUrl=C.cleanProductUrl(item.productUrl,resolvedStoreUrl,item.chnlProdNo);
              const actualSlug=/^https:\/\/(?:smartstore|brand)\.naver\.com\/(?!main\/)[a-z0-9_-]+\/products\/\d+$/i.test(productUrl);
              let memo=C.flagList({...item,productUrl,storeUrl:resolvedStoreUrl,unverifiedStoreSlug:!actualSlug&&/^https:\/\/(?:smartstore|brand)\.naver\.com\/main\//i.test(productUrl)}).join(', ');
              // 업체명/링크 미확인은 진단에서 관리하고 특이사항에는 상품 구분을 표시합니다.
              const row={keyword:item.keyword,page:item.page,productName:item.title||'',productUrl,companyName:storeName,reviews:item.reviews??'',ceoName:str(b.ceoName||''),phoneNumber:phone,phoneCandidates:b.phoneCandidates||[],address:str(b.address||''),owner:str(state.settings.owner||''),date,mid:item.chnlProdNo||'',demographic:'',status:C.statusLabel(category),memo,history:'',mallSeq:id,nvMid:item.nvMid};
              if(registration.duplicate)row.memo=C.appendFlag(row.memo,'사업자중복');
              state.matched.push(row);complete=true;
              await log(j,`${name} · 010 후보 저장`);
            }
            } // end prepared lookup available / cached
          }
        }
      }catch(e){
        assertActive(j);const msg=e?.message||str(e);
        if(/인증\/권한 오류 HTTP (401|403)/.test(msg))throw Error(msg);
        if(!complete){
          retryableMissing=true; // 실패는 처리 완료 업체로 고정하지 않는다. 전송 이력은 별도 원장으로 보호한다.
          state.statistics.bizErrors++;
          addReview(item,msg,holdBusiness);complete=true;
          await log(j,`${name} · 조회 오류로 보류: ${msg}`);
        }
      }
      if(complete){
        // 스토어 URL 부족은 과금/API 조회를 시도하지 않았으므로 차후 재수집 가능하게 유지.
        if(!retryableMissing&&!state.seen.includes(id))state.seen.push(id);
        state.pending.shift();state.processed++;state.scanned++;
        await save();await pause(600);
      }
    }
  }
  async function flagSharedPhones(j){
    const groups=new Map();
    for(const row of state.matched){const num=C.mobile010(row.phoneNumber);if(!num)continue;if(!groups.has(num))groups.set(num,[]);groups.get(num).push(row);}
    let shared=0;
    for(const rows of groups.values()){
      if(new Set(rows.map(r=>str(r.mallSeq))).size<2)continue;
      shared++;
      for(const row of rows)row.memo=C.appendFlag(row.memo,'동일전화번호 다른스토어 확인필요');
    }
    state.phoneDuplicates=shared;
    if(shared)await log(j,`번호 교차검증: 서로 다른 스토어 간 중복된 010번호 ${shared}종 확인 · CSV 특이사항 표기 (실제 동일 사업자인지는 별도 확인)`);
    await save();
  }
  async function runJob(j){
    try{
      const company=true;
      state.settings={...(state.settings||{}),lookupMode:'company'};
      await patch(j,{phase:'회사 서버 연결 확인',stage:'회사 가망 확인 및 신규 사업자조회 준비 중'});
      await requireCompanyAccess();assertActive(j);
      await log(j,'회사 상태 확인 · 유효한 010 캐시 우선 · 불완전 캐시 신규 조회 · 주소 미확보 시 번호 기반 조회' );
      if(state.collection)await collect(j);
      if(state.pending?.length)await processPending(j);
      await flagSharedPhones(j);
      const partial=Boolean(state.catalogWarnings||state.unidentifiedWarnings||state.incompletePages?.length||state.statistics.bizErrors||state.statistics.bizUrlMissing||state.statistics.bizIdentityConflicts);
      await patch(j,{phase:partial?'부분 완료':'완료',stage:`처리 ${state.scanned}곳 · 010 후보 ${state.matched.length}곳 · 보류 ${state.review.length}곳${partial?' · 누락 페이지·상품 또는 사업자조회 미완료 확인 필요 (기록 확인)':''}`,error:'',currentStore:''});
      await log(j,partial?'부분 완료 · 상품/페이지 또는 사업자조회 미완료 업체가 있습니다. 확인된 결과만 CSV로 제공':'추출 완료 · CSV 다운로드 또는 행 복사 가능');
    }catch(e){
      if(job!==j)return;
      const stopped=j.cancelled;
      if(!stopped&&e.code==='PAGE_WAIT'){
        j.waitingForPage=true;
        const page=state.collection?.nextPage;
        const failed=state.collection?.pageWait?.requestFailure;
        await patch(j,{phase:'페이지 확인 대기',error:'',stage:failed?`${state.collection.pageWait.reason}. 네이버 화면을 직접 확인하고 정상 상품이 표시된 뒤 이어하기를 누르세요.`:`${page}페이지 상품 갱신 미확인 · 스크롤 중지. 현재 네이버 화면의 상품 로딩을 확인한 뒤 이어하기를 누르세요.`,currentStore:''});
        return;
      }
      await patch(j,{phase:stopped?'중단됨':'오류',error:stopped?'':(e.message||str(e)),stage:stopped?'사용자가 중단했습니다.':(e.message||str(e))});
      await log(j,stopped?'작업 중단됨':`오류: ${e.message||str(e)}`);
    }finally{if(job===j){await patch(j,{running:false,paused:!!j.waitingForPage,finishedAt:j.waitingForPage?0:Date.now()});job=null;}}
  }
  async function getWorkTab(preferred){
    if(preferred){try{await chrome.tabs.get(preferred);return preferred;}catch{}}
    if(state.collection?.tabId){try{await chrome.tabs.get(state.collection.tabId);return state.collection.tabId;}catch{}}
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    const tab=tabs.find(x=>sourceUrl(x.url||''));
    if(!tab)throw Error('네이버 쇼핑 검색 결과 탭을 열고 다시 이어하기를 누르세요.');
    return tab.id;
  }
  chrome.runtime.onMessage.addListener((req,sender,reply)=>{
    if(!str(req?.action).startsWith('sb:'))return false;
    if(req.action==='sb:start'){
      try{
        const src=sourceUrl(sender.tab?.url||'');if(!src)throw Error('네이버 가격비교 또는 플러스스토어 검색 결과에서 실행하세요.');
        if(job)throw Error('이미 추출 작업이 실행 중입니다.');
        const from=Number(req.from),to=Number(req.to),mode=req.mode;
        if(!['current','auto'].includes(mode))throw Error('추출 방식을 선택하세요.');
        if(mode==='auto'&&(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to>MAX_PAGES||from>to))throw Error('페이지 범위는 1~10 사이로 설정하세요.');
        const searchUrl=sender.tab.url,keyword=new URL(searchUrl).searchParams.get('query');
        const raw=req.settings||{};
        const keywords=mode==='current'?[keyword]:[...new Set(str(raw.keywords||keyword).split(/[\n,]+/).map(x=>x.trim()).filter(Boolean))].slice(0,20);
        if(!keywords.length)throw Error('키워드를 입력하세요.');
        const minReviews=Math.max(0,Number(raw.minReviews)||0);
        const maxReviews=raw.maxReviews===''||raw.maxReviews==null?null:Number(raw.maxReviews);
        if(maxReviews!==null&&(!Number.isFinite(maxReviews)||maxReviews<minReviews))throw Error('리뷰 최대값은 최소값 이상이어야 합니다.');
        const settings={from,to,mode,keywords,minReviews,maxReviews,catalogLookup:raw.catalogLookup===true,lookupMode:'company',reviewsEnabled:!!raw.reviewsEnabled,grouped:raw.grouped==='exclude'?'exclude':'include',ads:['all','exclude','only'].includes(raw.ads)?raw.ads:'all',owner:str(raw.owner||'').trim().slice(0,40)};
        const j={cancelled:false,paused:false,finishCollection:false,abort:null,tabId:sender.tab.id};job=j;
        reply({ok:true,accepted:true});
        void(async()=>{
          try{
            await getState();
            if(state.pending?.length||state.collection)throw Error('이전 작업이 남아 있습니다. 이어하기 또는 작업 초기화를 사용하세요.');
            await requireCompanyAccess();
            Object.assign(state,{runId:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),pageTransitions:[],seen:[],matched:[],review:[],businessIndex:{},statistics:blankStats(),skipped:0,basic:[],running:true,paused:false,startedAt:Date.now(),finishedAt:0,logs:[],phase:'요청 접수',stage:'현재 네이버 탭에서 수집 시작',keyword,source:src,mode,searchUrl,settings,pageTotal:mode==='auto'?(src==='plus'?0:to-from+1):1,error:'',pageStats:[],auditPages:[],auditRows:[],auditTruncated:0,catalogDiagnostics:[],phoneDuplicates:0,currentStore:'',unidentifiedWarnings:0,unidentifiedUniqueCandidates:0,unidentifiedObservationCount:0,catalogWarnings:0,catalogExpanded:0,catalogBlockedReason:"",catalogDiagnostics:[],incompletePages:[],total:0,processed:0});
            state.scanned=0;state.discovered=0;state.ads=0;state.page=0;state.catalogRequests=blankCatalogRequests();
            state.collection={source:src,mode,searchUrl,from,to,keywords,keywordIndex:0,nextPage:from,previousSignature:'',products:[],catalogProcessed:{},tabId:sender.tab.id};
            await save();await log(j,`원부 추가 조회 ${settings.catalogLookup?'켜짐':'꺼짐'} · 이 작업의 고정 설정`);await log(j,`${src==='plus'?'플러스스토어':'가격비교'} '${keywords.join(', ')}' ${mode==='auto'?(src==='plus'?`연속 스크롤 (${PLUS_BATCH}개마다 저장, 수집 종료 버튼까지)`:`${from}~${to}페이지 번호 클릭 추출`):'현재 화면 추출'} 시작 · 새 탭 생성 없음`);
            await runJob(j);
          }catch(e){if(job===j){state.running=false;state.phase='시작 실패';state.error=str(e.message||e);await save();job=null;}}
        })();
      }catch(e){reply({ok:false,error:str(e.message||e)});}
      return false;
    }
    (async()=>{
      await getState();
      if(req.action==='sb:state')return {state};
      if(req.action==='sb:remember-store')return rememberOpenedStore(sender);
      if(req.action==='sb:inspect'){
        if(!sourceUrl(sender.tab?.url||''))throw Error('네이버 쇼핑 검색 결과에서 실행하세요.');
        const data=await inspect(sender.tab.id);const map=new Map();for(const r of data?.records||[])if(!map.has(r.mallSeq))map.set(r.mallSeq,r);
        return {inspection:{count:map.size,products:data.records.length,ads:data.ads,source:sourceUrl(sender.tab.url),examples:[...map.values()].slice(0,3).map(x=>x.storeName||x.mallSeq)}};
      }
      if(req.action==='sb:health'){
        const origin=await getApiBaseUrl();
        const hasAccess=await hasCompanyAccess();
        return {health:{serverOrigin:origin,hasAccess,source:sourceUrl(sender.tab?.url||''),secureTransport:false,modernSecureTransport:true,lookupMode:'company',newLookup:true,businessApi:'유효한 010 캐시 / 주소 기반 최신 조회 / 주소 없으면 번호 조회 (서버 지원 여부 별도 진단)'}};
      }
      if(req.action==='sb:pause'){
        if(job){job.paused=true;state.paused=true;state.phase='일시정지';await save();}return {state};
      }
      if(req.action==='sb:resume'){
        if(job){job.paused=false;state.paused=false;state.phase='재개 중';await save();return {state};}
        if(!state.collection&&!state.pending?.length)throw Error('이어갈 작업이 없습니다.');
        const tabId=state.collection?await getWorkTab(sender.tab?.id):null;
        const j={cancelled:false,paused:false,finishCollection:false,abort:null,tabId};job=j;
        if(state.collection)state.collection.tabId=tabId;
        state.running=true;state.paused=false;state.error='';await save();
        void runJob(j);return {state};
      }
      if(req.action==='sb:stop'){
        if(job&&state.collection?.source==='plus'&&state.collection?.mode==='auto'){
          job.finishCollection=true;job.paused=false;
          await patch(job,{paused:false,phase:'플러스스토어 수집 종료 요청',stage:'현재까지 수집한 상품을 확정한 뒤 업체 조회를 시작합니다.'});
          await log(job,'■ 수집 종료 요청 · 지금까지 확보한 상품은 유지하고 업체 조회를 진행합니다.');
        }else if(job){
          job.cancelled=true;job.paused=false;try{job.abort?.abort();}catch{};
          await patch(job,{phase:'중단 처리 중',stage:'작업을 중단하는 중'});await log(job,'전체 작업 중단 요청');
        }
        return {state};
      }
      if(req.action==='sb:reset'){
        if(job){const old=job;old.cancelled=true;old.paused=false;try{old.abort?.abort();}catch{};job=null;}
        state=blank();state.lookupAttempted=Object.keys(lookupLedger);await save();return {state};
      }
      throw Error('지원하지 않는 동작입니다.');
    })().then(x=>reply({ok:true,...x})).catch(e=>reply({ok:false,error:e.message||str(e)}));
    return true;
  });
})();
