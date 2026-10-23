/* SB 원부 판별기 v1.6: 네이버 쇼핑 검색/카탈로그 응답의 안전한 읽기 전용 파서. */
(function (root) {
  'use strict';
  const PRODUCT_ID = /^\d{5,20}$/;
  const CAT_ID = /^\d{8,20}$/;
  const STORE_URL = /https?:\/\/(?:m\.)?(?:smartstore|brand)\.naver\.com\/[^\s"'<>]*?\/products\/(\d{5,20})(?:[/?#"'<>]|$)/i;
  function s(value) {return value === undefined || value === null ? '' : String(value);}
  function id(value) {return CAT_ID.test(s(value)) ? s(value) : null;}
  function decode(raw) {
    return s(raw).replace(/\\u0026/gi,'&').replace(/\\u003d/gi,'=')
      .replace(/\\u0022/gi,'"').replace(/\\\//g,'/').replace(/\\"/g,'"')
      .replace(/&quot;|&#34;/gi,'"').replace(/&amp;|&#38;/gi,'&')
      .replace(/%3d/gi,'=').replace(/%26/gi,'&').replace(/%22/gi,'"');
  }
  function walkRecords(json, productId) {
    const matches=[]; const stack=[json]; const seen=new WeakSet(); let inspected=0;
    while (stack.length && inspected++ < 25000) {
      const v=stack.pop();
      if (!v || typeof v !== 'object' || seen.has(v)) continue;
      seen.add(v);
      if (Array.isArray(v)) { if (v.length <= 5000) for(const x of v) stack.push(x); continue; }
      const keys=['chnl_prod_no','chnlProdNo','channelProductNo','mallProductId','channelProductId'];
      const matchById=keys.some(k=>s(v[k])===productId);
      const urls=['pcProductUrl','mobileProductUrl','productUrl','link','url','mallProductUrl'];
      const matchByUrl=urls.some(k=>typeof v[k]==='string' && exactProductUrl(v[k],productId));
      if(matchById || matchByUrl) {
        for(const key of ['matchNvMid','catalog_nv_mid','catalogNvMid','matchedCatalogId']) {
          if(id(v[key])) matches.push({catalogId:id(v[key]),method:'상품번호가 일치하는 JSON 필드 '+key});
        }
        // `catalogId`는 네이버 쇼핑의 일반 카테고리 ID일 수 있어 단독으로 후보로 사용하지 않음.
      }
      for(const [key,child] of Object.entries(v)) {
        if (/(recommend|related|similar|recent|advert|suggest)/i.test(key)) continue;
        if(child && typeof child==='object') stack.push(child);
      }
    }
    return matches;
  }
  function exactProductUrl(raw, expected) {
    try {
      const u=new URL(raw.replace(/\\\//g,'/'));
      if (!['smartstore.naver.com','m.smartstore.naver.com','brand.naver.com','m.brand.naver.com'].includes(u.hostname)) return false;
      const m=u.pathname.match(/\/products\/(\d{5,20})(?:\/|$)/);
      return !!m && m[1]===s(expected);
    } catch (_) { return false; }
  }
  // Never interpret an arbitrary nearby catalog ID as a validated match.
  // Only a complete record containing this exact product ID AND a matching field qualifies.
  function parseObjectAt(raw, from) {
    if (from < 0 || raw[from] !== '{') return null;
    let depth = 0, quote = '', escaped = false;
    for (let i = from; i < raw.length && i - from <= 18000; i++) {
      const c = raw[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(raw.slice(from, i + 1)); } catch (_) { return null; }
      }
    }
    return null;
  }
  function getCatalogCandidates(html, productId) {
    const pid = s(productId), candidates = [], seen = new Set();
    const diagnostics = {jsonExamined:0, idOccurrences:0, fragmentsParsed:0, untrustedNearbyIds:0};
    if (!PRODUCT_ID.test(pid)) return {candidates,...diagnostics};
    const raw = s(html).slice(0,7000000);
    function pushRecord(value, origin) {
      for (const c of walkRecords(value,pid)) {
        if (!seen.has(c.catalogId)) {
          candidates.push({...c,method:origin+': '+c.method,confidence:'record'});
          seen.add(c.catalogId);
        }
      }
    }
    for (const part of raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      const data=part[1].trim();
      if(!data.includes(pid)||data.length>6500000)continue;
      if (/^[\[{]/.test(data)) {
        try {diagnostics.jsonExamined++;pushRecord(JSON.parse(data),'내장 JSON');continue;}catch(_){}
      }
      // SPA state serializations can contain embedded objects rather than a pure JSON script.
      // Inspect bounded, complete JSON objects only; never use a 3KB substring around an ID.
      const re=new RegExp('(?<!\\d)'+pid+'(?!\\d)','g');
      for(const match of data.matchAll(re)) {
        if(++diagnostics.idOccurrences>100)break;
        const start=Math.max(0,match.index-1300);
        const prefix=data.slice(start,match.index);
        const opens=[...prefix.matchAll(/\{/g)].slice(-6).reverse();
        for(const opening of opens){
          const obj=parseObjectAt(data,start+opening.index);
          if(!obj)continue;
          diagnostics.fragmentsParsed++;
          const before=candidates.length;pushRecord(obj,'동일 JSON 객체');
          if(candidates.length>before)break;
        }
      }
    }
    return {candidates:candidates.slice(0,12),...diagnostics};
  }
  function catalogProducts(payload) {
    if (!payload || typeof payload!=='object') return {products:[],totalCount:0};
    const data=payload.data && typeof payload.data==='object' ? payload.data : payload;
    const products=Array.isArray(data.products) ? data.products : Array.isArray(data.items) ? data.items : [];
    const count=Number(data.totalCount ?? data.totalElements ?? products.length);
    return {products,totalCount:Number.isFinite(count) ? count : products.length};
  }
  function verifyCatalog(payload, productId, catalogId) {
    const {products,totalCount}=catalogProducts(payload);
    const expected=s(productId), catalog=s(catalogId);
    let match=null;
    for(const item of products) {
      if(!item || typeof item!=='object') continue;
      const productMatch=(s(item.mallProductId)===expected || s(item.chnl_prod_no)===expected ||
        exactProductUrl(item.pcProductUrl||'',expected) || exactProductUrl(item.mobileProductUrl||'',expected));
      if(!productMatch) continue;
      const url=s(item.pcProductUrl || item.mobileProductUrl);
      const isNaver=/(?:^|\/\/)(?:m\.)?(?:smartstore|brand)\.naver\.com\//i.test(url) ||
        /^ncp_/i.test(s(item.mallId)) || item.isSmartStoreProduct===true;
      if(!isNaver) continue;
      // 원부 ID가 응답에 존재하면 일치해야 함. 없으면 판매처 목록 소속 자체가 증거.
      if(id(item.matchNvMid) && s(item.matchNvMid)!==catalog) continue;
      match={mallProductId:expected, mallName:s(item.mallName), mallSequence:s(item.mallSequence),
        matchNvMid:s(item.matchNvMid || catalog), nvMid:s(item.nvMid)};
      break;
    }
    return {match,inspected:products.length,totalCount};
  }

  // 명시적으로 현재 스마트스토어 상품에 연결된 matchNvMid만 수락한다.
  // JSON은 사용자가 직접 제공한 자료이며, 이 결과는 실시간 조회 성공으로 표현하지 않는다.
  function findImportedMatch(payload, productId) {
    const pid=s(productId);
    if(!PRODUCT_ID.test(pid) || !payload || typeof payload!=='object')return null;
    const stack=[payload],seen=new WeakSet();let examined=0;
    while(stack.length && examined++<30000){
      const obj=stack.pop();
      if(!obj || typeof obj!=='object' || seen.has(obj))continue;
      seen.add(obj);
      if(Array.isArray(obj)){if(obj.length<10000)for(const v of obj)stack.push(v);continue;}
      const exact=s(obj.mallProductId)===pid || s(obj.chnl_prod_no)===pid || s(obj.chnlProdNo)===pid ||
        exactProductUrl(obj.pcProductUrl||'',pid) || exactProductUrl(obj.mobileProductUrl||'',pid);
      if(exact){
        const url=s(obj.pcProductUrl||obj.mobileProductUrl||'');
        const smartUrl=exactProductUrl(url,pid);
        const isNaver=/^ncp_/i.test(s(obj.mallId)) || smartUrl || obj.isSmartStoreProduct===true;
        const mid=id(obj.matchNvMid)||id(obj.catalog_nv_mid)||id(obj.catalogNvMid);
        if(isNaver && mid)return {catalogId:mid,mallName:s(obj.mallName),nvMid:s(obj.nvMid)};
      }
      for(const [k,v] of Object.entries(obj)){
        if(/^(?:related|recommend|advert|similar|recent)/i.test(k))continue;
        if(v && typeof v==='object')stack.push(v);
      }
    }
    return null;
  }

  // v1.6: 일치 상품 레코드가 없더라도 검색 결과에서 후보를 발견하되 원부 확정하지 않는다.
  // 점수와 근거를 표시해 후보-확정 간 경계를 유지한다.
  function normalizeTitle(value) {
    return s(value).normalize('NFKC').toLowerCase().replace(/\s*:\s*[^:]{1,40}$/,'')
      .replace(/<[^>]+>/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
  }
  const STOP = new Set(['네이버','가격비교','쇼핑','공식','무료배송','오늘출발','특가','추천','상품','최저가','판매','구매','답례품','선물','간식']);
  function titleTokens(value) { return [...new Set(normalizeTitle(value).split(' ').filter(x=>x.length>=2 && !STOP.has(x)))].slice(0,32); }
  function tokensRelated(a,b){
    if(a===b)return true;
    if(a.length<3||b.length<3)return false;
    return (a.includes(b)||b.includes(a)) && Math.min(a.length,b.length)/Math.max(a.length,b.length)>=0.55;
  }
  function titleSimilarity(expected, actual) {
    const want=titleTokens(expected),have=titleTokens(actual);
    if(want.length<2||have.length<2)return 0;
    const used=new Set(); let matched=0;
    for(const t of have){const ix=want.findIndex((v,i)=>!used.has(i)&&tokensRelated(t,v));if(ix>=0){matched++;used.add(ix);}}
    if(matched<2)return 0;
    const coverage=matched/Math.min(have.length,8);
    const precision=matched/Math.min(want.length,8);
    return Math.round(100*(0.64*coverage+0.36*precision))/100;
  }
  function catalogIdFromValue(value){
    const str=s(value).replace(/\\\//g,'/');
    const m=str.match(/(?:https?:\/\/search\.shopping\.naver\.com)?\/catalog\/(\d{8,20})(?:[/?#]|$)/i);
    return m ? m[1] : null;
  }
  function discoverTitleCandidates(json,expectedTitle){
    const seen=new WeakSet(),stack=[json],out=new Map();let inspected=0;
    while(stack.length&&inspected++<30000){
      const o=stack.pop();if(!o||typeof o!=='object'||seen.has(o))continue;seen.add(o);
      if(Array.isArray(o)){for(let i=0;i<Math.min(o.length,2500);i++)stack.push(o[i]);continue;}
      const names=['productTitle','productName','title','name','itemName','product_title'].map(k=>o[k]).filter(x=>typeof x==='string'&&x.length>5&&x.length<280);
      if(names.length){
        const ranked=names.map(x=>({name:x,score:titleSimilarity(expectedTitle,x)})).sort((a,b)=>b.score-a.score);
        const {name,score}=ranked[0];
        if(score>=0.63){
          const ids=[];
          for(const k of ['pcProductUrl','mobileProductUrl','productUrl','link','url','catalogUrl','landingUrl','href']){
            const cat=catalogIdFromValue(o[k]);if(cat)ids.push(cat);
          }
          for(const k of ['matchNvMid','catalog_nv_mid','catalogNvMid','matchedCatalogId'])if(id(o[k]))ids.push(id(o[k]));
          // nvMid is also used for normal products; use only explicit catalog-shaped record.
          if((/catalog|가격비교/i.test(s(o.productType||o.type||o.productKind))|| ids.length) && id(o.nvMid)){
            if(ids.includes(id(o.nvMid)))ids.push(id(o.nvMid));
          }
          for(const cat of new Set(ids)){
            const prior=out.get(cat);
            if(!prior||prior.score<score)out.set(cat,{catalogId:cat,score,method:'검색 결과 상품명과 카탈로그 필드/링크 유사',matchedTitle:normalizeTitle(name).slice(0,110),confidence:'candidate'});
          }
        }
      }
      for(const [k,v] of Object.entries(o)){
        if(/^(related|recommend|advert|suggest|similar|recent)/i.test(k))continue;
        if(v&&typeof v==='object')stack.push(v);
      }
    }
    return {candidates:[...out.values()].sort((a,b)=>b.score-a.score).slice(0,15),inspected};
  }
  function nearbyCatalogHints(html,productId){
    // v1.4에서 작동했던 인접 필드 탐색을 후보 전용으로 복원. 확정 판별에는 절대 쓰지 않는다.
    const raw=decode(html).slice(0,6500000),pid=s(productId),out=new Map();let locations=0;
    if(!PRODUCT_ID.test(pid))return {candidates:[],locations};
    const re=new RegExp('(?<!\\d)'+pid+'(?!\\d)','g');
    for(const m of raw.matchAll(re)){
      if(++locations>90)break;
      const close=raw.slice(Math.max(0,m.index-140),Math.min(raw.length,m.index+140));
      if(!/(mallProductId|chnl_prod_no|chnlProdNo|pcProductUrl|\/products\/)/i.test(close))continue;
      const region=raw.slice(Math.max(0,m.index-1300),Math.min(raw.length,m.index+2100));
      const pattern=/(?:["']?(?:matchNvMid|catalog_nv_mid|catalogNvMid|matchedCatalogId)["']?\s*[:=]\s*["']?|(?:[?&]|\\u0026)catalog_nv_mid=)(\d{8,20})/gi;
      for(const x of region.matchAll(pattern))if(id(x[1]))out.set(x[1],{catalogId:x[1],score:0.35,method:'상품번호 주변 직렬화 필드(미검증)',confidence:'weak'});
    }
    return {candidates:[...out.values()].slice(0,12),locations};
  }

  root.SBShoppingParser={getCatalogCandidates,verifyCatalog,catalogProducts,exactProductUrl,findImportedMatch,walkRecords,normalizeTitle,titleSimilarity,discoverTitleCandidates,nearbyCatalogHints};
  if(typeof module!=='undefined' && module.exports) module.exports=root.SBShoppingParser;
})(globalThis);
