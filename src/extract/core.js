/* 유승빈 DB추출기 v3.22: 상품·판매자 식별 검증 및 연락처 정규화 */
(function (root) {
  'use strict';
  const str = v => String(v == null ? '' : v).trim();
  const numericId = v => /^\d+$/.test(str(v)) ? str(v) : '';
  const normalizeBusinessNumber = value => {
    const digits = str(value).replace(/[^0-9]/g, '');
    return /^\d{10}$/.test(digits) ? digits : '';
  };
  const mobile010 = value => {
    const normalized=str(value).replace(/(?:\+82|0082)[\s.\-]?(?:\(0\)[\s.\-]?)?10(?=[\s.\-]?\d{4}[\s.\-]?\d{4}(?!\d))/g,'010');
    const match = normalized.match(/(?:^|[^\d])(010)[\s.\-]?(\d{4})[\s.\-]?(\d{4})(?!\d)/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  };
  const statusCategory = rec => {
    if (!rec || rec.exists === false) return 'new';
    const status = str(rec.status).toUpperCase();
    if(status==='PROSPECT')return rec.canModify===true?'sameBranch':rec.canModify===false?'otherBranch':'unknown';
    if(rec.canModify===false&&str(rec.branchName))return 'otherBranch';
    const map = {
      NEW:'new', NEW_LEAD:'new', ABSENT:'absent', NO_ANSWER:'absent', REJECTED:'rejected', REFUSED:'rejected',
      PAID:'paid', CONTRACTED:'paid', CONTRACT_COMPLETE:'paid', CONTRACT_COMPLETED:'paid',
      PAYMENT_SCHEDULED:'paymentScheduled', PAYMENT_PENDING:'paymentScheduled', PAYMENT_EXPECTED:'paymentScheduled', PAYMENT_DUE:'paymentScheduled',
      SAME_BRANCH:'sameBranch', OTHER_BRANCH:'otherBranch',
      BLACK:'excluded', BLOCK:'excluded', DNC:'excluded', DO_NOT_CALL:'excluded'
    };
    return map[status] || 'unknown';
  };
  const statusLabel = category => ({new:'신규',absent:'부재',rejected:'거절',paid:'계약완료',paymentScheduled:'결제예정',sameBranch:'동일지사가망',otherBranch:'타지사가망',excluded:'제외',unknown:'미확인'})[category] || '미확인';
  const flagList = item => [item?.isAd ? '검색광고' : '', item?.catalogVerified||item?.fromCatalog ? '원부상품' : ''].filter(Boolean);
  const appendFlag = (memo, flag) => [...new Set([...str(memo).split(',').map(x=>x.trim()).filter(Boolean),flag])].join(', ');
  const filterProducts = (products, settings, seen) => {
    const stats={filtered:0,duplicate:0,unknownReviews:0,unknownGroup:0,adsExcluded:0,sameSeller:0,invalidSeller:0,selected:0};
    const chosen=new Map();
    const seenIds=new Set([...seen].map(str));
    for (const x of products) {
      const id=numericId(x.mallSeq);if(!id){stats.invalidSeller++;continue;}
      if(seenIds.has(id)){stats.duplicate++;continue;}
      if(settings.ads==='exclude'&&x.isAd||settings.ads==='only'&&!x.isAd){stats.adsExcluded++;continue;}
      if(settings.grouped==='exclude'){
        if(x.catalogVerified||x.fromCatalog){stats.filtered++;continue;}
        if(x.sellerCount===null||x.sellerCount===undefined){stats.unknownGroup++;continue;}
        if(x.sellerCount>1){stats.filtered++;continue;}
      }
      if(settings.reviewsEnabled){
        if(x.reviews===null||x.reviews===undefined){stats.unknownReviews++;continue;}
        if(x.reviews<settings.minReviews||(settings.maxReviews!==null&&x.reviews>settings.maxReviews)){stats.filtered++;continue;}
      }
      const old=chosen.get(id);
      // 검증된 스토어 슬러그 상품 URL을 가장 먼저 보존합니다.
      // /main/products/ 는 네이버가 제공한 상품 주소이지만 판매자 슬러그를 증명하지 않습니다.
      const linkRank=p=>{
        const url=str(p?.productUrl);
        if(/^https:\/\/(?:smartstore|brand)\.naver\.com\/(?!main\/|inflow\/)[a-z0-9_-]+\/products\/\d+\/?$/i.test(url))return 3;
        return 0;
      };
      const quality=p=>(p?.title?2:0)+(p?.storeName?1:0)+(p?.reviews!==null&&p?.reviews!==undefined?1:0);
      if(old)stats.sameSeller++;
      if(!old||linkRank(x)>linkRank(old)||
          (linkRank(x)===linkRank(old)&&((x.reviews??-1)>(old.reviews??-1)||
          ((x.reviews??-1)===(old.reviews??-1)&&quality(x)>quality(old)))))chosen.set(id,{...x});
      const selected=chosen.get(id);
      if(old){selected.isAd=Boolean(old.isAd||x.isAd);selected.catalogVerified=Boolean(old.catalogVerified||x.catalogVerified||old.fromCatalog||x.fromCatalog);}
    }
    stats.selected=chosen.size;return {products:[...chosen.values()],stats};
  };
  // 스토어 주소에 실제로 표기된 ID만 사용합니다. 표시명으로 스토어 ID를 추측하지 않습니다.
  const storeIdentity = raw => {
    try {
      const u=new URL(str(raw));
      if(u.protocol!=='https:'||u.username||u.password||u.port||!['smartstore.naver.com','brand.naver.com'].includes(u.hostname.toLowerCase()))return null;
      const slug=u.pathname.split('/').filter(Boolean)[0]||'';
      if(!/^[a-zA-Z0-9_-]{2,60}$/.test(slug)||['main','products','profile','category','search','seller','home','inflow'].includes(slug.toLowerCase()))return null;
      return {host:u.hostname.toLowerCase(),slug};
    }catch{return null;}
  };
  const storeBase = raw => {const x=storeIdentity(raw);return x?`https://${x.host}/${x.slug}`:'';};
  const productEvidence = raw => {
    const found=[];
    const visit=(value,depth=0)=>{
      if(depth>2)return;
      try{
        const u=new URL(str(value));
        if(u.protocol!=='https:'||u.username||u.password||u.port)return;
        if(['smartstore.naver.com','brand.naver.com'].includes(u.hostname.toLowerCase())){
          const m=u.pathname.match(/^\/([a-zA-Z0-9_-]+)\/products\/(\d+)\/?$/i);
          if(m)found.push({base:storeBase(u.href),id:m[2],placeholder:m[1].toLowerCase()==='main',url:u.origin+u.pathname.replace(/\/$/,'')});
        }else if(['cr.shopping.naver.com','ader.naver.com'].includes(u.hostname.toLowerCase())){
          for(const key of ['url','target','targetUrl','redirectUrl','productUrl','landingUrl','destination','dest','redirect','link']){
            const nested=u.searchParams.get(key);if(!nested)continue;
            visit(nested,depth+1);
            try{const decoded=decodeURIComponent(nested);if(decoded!==nested)visit(decoded,depth+1);}catch{}
          }
        }
      }catch{}
    };
    visit(raw);return found;
  };
  const productIdentityIssue = (raw,storeUrl='',channelProductNo='') => {
    const expected=numericId(channelProductNo),base=storeBase(storeUrl),evidence=productEvidence(raw);
    if(evidence.some(x=>expected&&x.id!==expected))return '상품번호 불일치';
    const bases=new Set(evidence.map(x=>x.base).filter(Boolean));
    if(bases.size>1||base&&[...bases].some(x=>x!==base))return '스토어 주소 불일치';
    return '';
  };
  const cleanProductUrl = (raw, storeUrl='', channelProductNo='') => {
    if(productIdentityIssue(raw,storeUrl,channelProductNo))return '';
    const expected=numericId(channelProductNo),base=storeBase(storeUrl),evidence=productEvidence(raw);
    const direct=evidence.find(x=>x.base);
    if(direct)return `${direct.base}/products/${direct.id}`;
    // /main/은 원본 관측값으로만 보존. 실제 스토어와 상품번호가 확인돼야 최종 링크를 만든다.
    const placeholder=evidence.find(x=>x.placeholder&&expected&&x.id===expected);
    if(base&&expected&&(!evidence.length||placeholder))return `${base}/products/${expected}`;
    return '';
  };
  // v3.22: 화면의 여러 상품, 원부 API 결과와 검증된 기존 연결 정보에서
  // 같은 mallSeq의 실제 스토어 URL만 공유합니다. 업체명/숫자로 슬러그를 추측하지 않습니다.
  const enrichStoreUrls = (products, verifiedStoreMap={}) => {
    const groups=new Map(),conflicts=[];
    const group=id=>{if(!groups.has(id))groups.set(id,{urls:new Set(),channels:new Set(),issues:new Set()});return groups.get(id);};
    for(const [seller,url] of Object.entries(verifiedStoreMap||{})){
      const id=numericId(seller),base=storeBase(url);if(id&&base)group(id).urls.add(base);
    }
    for(const item of products){
      const id=numericId(item.mallSeq);if(!id)continue;
      const g=group(id),channel=numericId(item.chnlNo);if(channel)g.channels.add(channel);
      if(item.identityConflict)g.issues.add((item.identityIssues||[]).join(' / ')||'수집 정보 충돌');
      for(const raw of [item.storeUrl,...(item.storeUrlCandidates||[])]){const base=storeBase(raw);if(base)g.urls.add(base);}
      for(const raw of [...new Set([item.observedProductUrl,item.productUrl,...(item.observedProductUrls||[])].filter(Boolean))]){
        const issue=productIdentityIssue(raw,item.storeUrl,item.chnlProdNo);if(issue)g.issues.add(issue);
        for(const x of productEvidence(raw)){
          if(x.base&&(!numericId(item.chnlProdNo)||x.id===numericId(item.chnlProdNo)))g.urls.add(x.base);
        }
      }
    }
    const resolved={},blocked=new Map();for(const [seller,g] of groups){
      if(g.urls.size>1)g.issues.add('동일 판매자의 스토어 주소 충돌');
      if(g.channels.size>1)g.issues.add('동일 판매자의 채널번호 충돌');
      if(g.issues.size){const reasons=[...g.issues];blocked.set(seller,reasons);conflicts.push({seller,storeUrls:[...g.urls],channels:[...g.channels],reasons});}
      else if(g.urls.size===1)resolved[seller]=[...g.urls][0];
    }
    let recovered=0,updatedLinks=0;
    const enriched=products.map(item=>{
      const id=numericId(item.mallSeq),base=resolved[id],observedProductUrl=item.observedProductUrl||item.productUrl||'';
      if(blocked.has(id))return {...item,observedProductUrl,observedStoreUrl:item.observedStoreUrl||item.storeUrl||'',storeUrl:'',productUrl:'',identityConflict:true,identityIssues:blocked.get(id)};
      const own=storeBase(item.storeUrl),storeUrl=own||base||'';
      const current=cleanProductUrl(observedProductUrl,storeUrl,item.chnlProdNo);
      const old=cleanProductUrl(item.productUrl,item.storeUrl,item.chnlProdNo);
      if(!own&&storeUrl)recovered++;
      if(current!==old)updatedLinks++;
      return {...item,observedProductUrl,storeUrl,productUrl:current,unverifiedStoreSlug:!storeUrl,identityConflict:false,identityIssues:[]};
    });
    return {products:enriched,recovered,updatedLinks,conflicts,resolved};
  };
  const registerBusiness = (index, businessNumber, mallSeq) => {
    const bn=normalizeBusinessNumber(businessNumber),id=numericId(mallSeq);
    if(!bn||!id)return {duplicate:false,related:[]};
    const related=[...new Set((index[bn]||[]).map(str).filter(numericId))];
    if(!related.includes(id))related.push(id);
    index[bn]=related;
    return {duplicate:related.length>1,related};
  };
  const applyBusinessDuplicates = (rows, related) => {
    if(related.length<2)return;
    const ids=new Set(related.map(str));
    for(const row of rows){if(ids.has(str(row.mallSeq)))row.memo=appendFlag(row.memo,'사업자중복');}
  };
  const api={normalizeBusinessNumber,mobile010,statusCategory,statusLabel,flagList,appendFlag,filterProducts,cleanProductUrl,productEvidence,productIdentityIssue,storeIdentity,storeBase,enrichStoreUrls,registerBusiness,applyBusinessDuplicates};
  root.SBCore=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
