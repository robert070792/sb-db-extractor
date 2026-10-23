/* 유승빈 DB추출기 v3.24 — 최신 사업자조회, 주소 충돌 차단, 전송 여부 구분. */
'use strict';
const COMPANY_ORIGIN = 'https://xn--2e5b11e.xn--hz2b15nnvd67o.shop';
const BUSINESS_LOOKUP_ORIGIN = 'http://smartwin.iptime.org:8070';
const FASTAPI_ORIGIN = 'https://fast.storeart.kr';
const AUTH_REQUIRED = '네이버 로그인이 필요합니다. 네이버 사이트 로그인 후 다시 실행하세요.';
async function getApiBaseUrl(){return COMPANY_ORIGIN;}
async function hasCompanyAccess(){
  return chrome.permissions.contains({origins:[COMPANY_ORIGIN+'/*',FASTAPI_ORIGIN+'/*','https://www.naver.com/*']});
}
async function requireCompanyAccess(){
  if(!(await hasCompanyAccess())) throw Error('사업자조회 필수 접근 권한이 없습니다. 확장 사이트 권한을 확인하세요.');
}
async function readJson(response,name){
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(!type.includes('json'))throw Error(name+' 응답이 JSON이 아닙니다. (로그인 만료 또는 서버 오류 확인)');
  const txt=await response.text();
  if(txt.length>300000)throw Error(name+' 응답 크기 제한 초과');
  let value;try{value=JSON.parse(txt);}catch{throw Error(name+' JSON 파싱 실패');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(name+' 응답 형식 오류');
  return value;
}
function positiveIdentifier(raw,label){
  const id=String(raw??'').trim();
  if(!/^\d{1,20}$/.test(id))throw Error(label+' 형식 오류');
  return id;
}
function storeBaseUrl(raw){
  try{
    const u=new URL(String(raw||''));
    if(u.protocol!=='https:'||u.username||u.password||u.port||!['smartstore.naver.com','brand.naver.com'].includes(u.hostname.toLowerCase()))return '';
    const slug=(u.pathname.split('/').filter(Boolean)[0]||'');
    if(!/^[a-zA-Z0-9_-]{2,60}$/.test(slug)||['main','inflow','seller','products','profile','category','search','home'].includes(slug.toLowerCase()))return '';
    return u.origin+'/'+slug;
  }catch{return '';}
}
function phoneCandidates(raw){
  const candidates=[];
  const add=(value,source)=>{if(typeof value!=='string'&&typeof value!=='number')return;const number=String(value).trim();if(number&&!candidates.some(x=>x.number===number))candidates.push({number,source});};
  add(raw.phoneNumber,'company.phoneNumber');
  add(raw.representTelephoneNumber,'seller.representTelephoneNumber');
  add(raw.contactInfo?.telNo?.formattedNumber,'seller.contactInfo.telNo.formattedNumber');
  for(const x of Array.isArray(raw.phoneCandidates)?raw.phoneCandidates:[])add(typeof x==='object'?x.number:x,typeof x==='object'?x.source:'company.phoneCandidates');
  for(const x of Array.isArray(raw.phoneNumbers)?raw.phoneNumbers:[])add(x,'company.phoneNumbers');
  return candidates;
}
function preferredPhone(candidates){
  const normalized=value=>String(value).replace(/(?:\+82|0082)[\s.\-]?(?:\(0\)[\s.\-]?)?10(?=[\s.\-]?\d{4}[\s.\-]?\d{4}(?!\d))/g,'010');
  return candidates.find(x=>/(?:^|[^\d])010[\s.\-]?\d{4}[\s.\-]?\d{4}(?!\d)/.test(normalized(x.number)))?.number||candidates[0]?.number||'';
}
function productUrlMismatch(raw,expected){
  try{const u=new URL(String(raw||'')),m=u.pathname.match(/^\/[a-zA-Z0-9_-]+\/products\/(\d+)\/?$/i);return ['smartstore.naver.com','brand.naver.com'].includes(u.hostname)&&m&&/^\d+$/.test(String(expected||''))&&m[1]!==String(expected);}catch{return false;}
}
function normalizeCachedData(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.exists===false)return null;
  if((raw.exists===true || raw.exists===undefined) && ['businessNumber','ceoName','phoneNumber','companyName'].some(k=>raw[k])){
    if(raw.needsRefresh===true)return null;
    const phones=phoneCandidates(raw);
    return {
      businessNumber:String(raw.businessNumber||''),
      companyName:String(raw.companyName||''), ceoName:String(raw.ceoName||''),
      phoneNumber:preferredPhone(phones),phoneCandidates:phones,address:String(raw.address||''),
      email:String(raw.email||''),storeUrl:storeBaseUrl(raw.storeUrl||raw.mallUrl||raw.channelUrl),
      updatedAt:raw.updatedAt||null
    };
  }
  return null;
}
async function fetchCompanyCache(mallId,signal){
  const res=await fetch(COMPANY_ORIGIN+'/api/extension/mall?mallSeq='+encodeURIComponent(mallId),{
    method:'GET',credentials:'include',cache:'no-store',redirect:'manual',signal
  });
  if([401,403].includes(res.status)||res.type==='opaqueredirect'||res.status===0)
    throw Error('회사 어드민 로그인 만료 또는 접근 권한 없음');
  if(res.status===404)return null;
  if(!res.ok)throw Error('회사 어드민 캐시 조회 실패 HTTP '+res.status);
  const body=await readJson(res,'회사 어드민');
  return body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:null;
}
async function naverAuthCookies(){
  const get=name=>new Promise((resolve,reject)=>{
    chrome.cookies.get({url:'https://www.naver.com',name},cookie=>{
      const err=chrome.runtime.lastError;
      if(err)reject(Error('네이버 로그인 확인 권한이 없습니다.'));
      else resolve(cookie?.value||'');
    });
  });
  const [nid_aut,nid_ses]=await Promise.all([get('NID_AUT'),get('NID_SES')]);
  if(!nid_aut||!nid_ses)throw Error(AUTH_REQUIRED);
  // 절대 로그, local storage, 진단에 반환값을 남기지 않는다.
  return {nid_aut,nid_ses};
}
async function saveCompanyCache(mallId,business,signal){
  // 서버의 기존 캐시 계약을 유지. 진단용 연락처 출처 배열은 로컬 결과에만 보존한다.
  const {phoneCandidates:omitted,...cacheBusiness}=business;
  const res=await fetch(COMPANY_ORIGIN+'/api/extension/mall',{
    method:'POST',credentials:'include',cache:'no-store',redirect:'manual',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({mallSeq:mallId,...cacheBusiness}),signal
  });
  if(!res.ok||res.type==='opaqueredirect')throw Error('회사 캐시 저장 실패 HTTP '+res.status);
}
function safeServerMessage(payload){
  const raw=typeof payload==='string'?payload:payload?.detail||payload?.message||payload?.error||payload?.reason||'';
  const text=typeof raw==='string'?raw:Array.isArray(raw)?raw.map(x=>x?.msg||'').join(' / '):typeof raw?.message==='string'?raw.message:'';
  if(/NID_AUT|NID_SES|JSESSIONID|cookie|authorization|token|password/i.test(text))return '인증 관련 내용 포함: 원문 생략';
  return text.replace(/https?:\/\/[^\s"'<>]+/gi,'[주소]').replace(/[<>]/g,'').replace(/[\r\n\t]+/g,' ').slice(0,300);
}
async function serverFailure(res,endpoint,label){
  let detail='';
  try{const body=(await res.text()).slice(0,50000);try{detail=safeServerMessage(JSON.parse(body));}catch{detail=/^\s*</.test(body)?'HTML 오류 응답 (서버 경로/로그인 확인)':safeServerMessage(body);}}catch{}
  const error=new Error(label+' HTTP '+res.status+(detail?' · '+detail:''));
  Object.assign(error,{httpStatus:res.status,endpoint,serverMessage:detail});return error;
}
async function lookupLatest(storeUrl,mallId,signal,cookies,beforeRequest){
  const safeUrl=storeBaseUrl(storeUrl);
  if(!safeUrl)throw Error('실제 스토어 주소를 확인하지 못했습니다.');
  if(signal.aborted)throw Error('조회 요청 전 중단됨');
  await beforeRequest();
  const res=await fetch(FASTAPI_ORIGIN+'/store/seller-info',{
    method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',
    cache:'no-store',referrerPolicy:'no-referrer',redirect:'error',
    body:JSON.stringify({url:safeUrl,...cookies}),signal
  });
  if(!res.ok)throw await serverFailure(res,'/store/seller-info','최신 사업자조회 서버');
  const payload=await readJson(res,'최신 사업자조회');
  if(payload.success!==true){const detail=safeServerMessage(payload);throw Object.assign(new Error('최신 조회 서버 응답 실패'+(detail?' · '+detail:'')),{httpStatus:res.status,endpoint:'/store/seller-info',serverMessage:detail});}
  if(!payload.sellerInfo||typeof payload.sellerInfo!=='object'||Array.isArray(payload.sellerInfo)||
     ![payload.sellerInfo.identity,payload.sellerInfo.representName,payload.sellerInfo.representativeName,
       payload.sellerInfo.businessAddressInfo?.fullAddressInfo,payload.sellerInfo.businessAddressInfo?.address,
       ...phoneCandidates(payload.sellerInfo).map(x=>x.number)].some(x=>(typeof x==='string'||typeof x==='number')&&String(x).trim()))
    throw Error('최신 사업자 상세정보 없음 (NO_SELLER_DETAILS)');
  const s=payload.sellerInfo,addr=s.businessAddressInfo||{};
  const phones=phoneCandidates(s);
  return {
    businessNumber:String(s.identity||''),companyName:String(s.representName||''),
    ceoName:String(s.representativeName||''),
    phoneNumber:preferredPhone(phones),phoneCandidates:phones,
    email:String(s.chrgrEmail||''),mailOrderNumber:String(s.declaredToOnlineMarkettingNumber||''),
    address:String(addr.fullAddressInfo||addr.address||''),
    channelName:String(payload.channelName||''),channelUid:String(payload.channelUid||''),
    isBusiness:s.isBusiness,storeUrl:safeUrl
  };
}
// 최신 조회 엔진의 준비 단계. 이 단계는 외부 신규 사업자조회를 실행하지 않는다.
async function prepareBusinessLookup(mallSeq, observedStoreUrl, productUrl, statusStoreUrl, statusProductUrl,channelProductNo='',syncNvMid=''){
  await requireCompanyAccess();
  const mallId=positiveIdentifier(mallSeq,'업체번호');
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),11000);
  try{
    const cachedRaw=await fetchCompanyCache(mallId,ctrl.signal);
    // 사내 가망정보에는 조회기에서 저장한 storeUrl/storeProductUrl이 들어 있을 수 있음.
    // 출처가 동일 mallSeq로 조회된 자료인 경우에만 스토어 주소로 재사용한다.
    const candidates=[observedStoreUrl,productUrl,statusStoreUrl,statusProductUrl,
      cachedRaw?.storeUrl,cachedRaw?.mallUrl,cachedRaw?.channelUrl,
      cachedRaw?.storeProductUrl,cachedRaw?.productUrl]
      .map(storeBaseUrl).filter(Boolean);
    if(productUrlMismatch(productUrl,channelProductNo)||new Set(candidates).size>1)
      return {kind:'conflict',code:'IDENTITY_CONFLICT',error:'검색상품·회사 상태·캐시의 스토어 주소 또는 상품번호 충돌 (조회 보류)'};
    const cached=normalizeCachedData(cachedRaw);
    if(cached&&SBCore.mobile010(cached.phoneNumber))return {kind:'cached',data:{...cached,storeUrl:cached.storeUrl||candidates[0]||''},origin:'company-cache'};
    const candidate=candidates[0]||'';
    if(!candidate&&/^\d{1,20}$/.test(String(syncNvMid)))return {kind:'legacy',origin:'number-api',syncNvMid:String(syncNvMid),storeUrl:'',cacheIncomplete:Boolean(cached),cacheData:cached,channelProductNo};
    if(!candidate)return {kind:'missing',code:'STORE_URL_MISSING',
      error:'실제 스마트스토어/브랜드스토어 URL 미확인 (최신 API 미호출 · 과금 조회 없음)'};
    return {kind:'latest',origin:'latest-api',storeUrl:candidate,cacheIncomplete:Boolean(cached),cacheData:cached,channelProductNo};
  }finally{clearTimeout(timer);}
}
// v2.9/v3.5의 번호 기반 조회 경로. 네이버 쿠키/회사 인증은 보내지 않는다.
async function lookupByNumbers(mallId,mid,signal,beforeRequest,channelProductNo){
  if(!(await chrome.permissions.contains({origins:[BUSINESS_LOOKUP_ORIGIN+'/*']})))throw Error('번호 기반 조회 서버 접근 권한이 없습니다. 확장 프로그램 권한을 확인하세요.');
  const query=new URLSearchParams({mallSeq:positiveIdentifier(mallId,'업체번호'),syncNvMid:positiveIdentifier(mid,'쇼핑 상품번호')});
  await beforeRequest();
  const res=await fetch(BUSINESS_LOOKUP_ORIGIN+'/extension/business-info?'+query,{
    method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal
  });
  if(!res.ok)throw await serverFailure(res,'/extension/business-info','번호 기반 사업자조회');
  const payload=await readJson(res,'번호 기반 사업자조회');
  if(payload.success===false){const detail=safeServerMessage(payload);throw Object.assign(new Error('번호 기반 사업자조회 실패'+(detail?' · '+detail:'')),{httpStatus:res.status,endpoint:'/extension/business-info',serverMessage:detail});}
  const raw=payload.data&&typeof payload.data==='object'?payload.data:payload;
  if(raw.mallSeq&&String(raw.mallSeq)!==mallId)throw Error('번호 조회 응답 판매자 불일치');
  if(raw.syncNvMid&&String(raw.syncNvMid)!==String(mid))throw Error('번호 조회 응답 쇼핑 상품번호 불일치');
  const business=normalizeCachedData({...raw,needsRefresh:false});
  if(!business)throw Error('NO_SELLER_DETAILS: 번호 조회 사업자정보 없음');
  for(const link of [raw.productUrl,raw.storeProductUrl])if(productUrlMismatch(link,channelProductNo))throw Error('번호 조회 응답 상품번호 불일치');
  const bases=[raw.storeUrl,raw.mallUrl,raw.channelUrl,raw.productUrl,raw.storeProductUrl].map(storeBaseUrl).filter(Boolean);
  if(new Set(bases).size>1)throw Error('번호 조회 응답 스토어 주소 충돌');
  return {...business,storeUrl:bases[0]||''};
}
async function executePreparedBusinessLookup(prepared,mallSeq,hooks={}){
  if(prepared?.kind==='cached')return {success:true,data:prepared.data,origin:'company-cache',attempted:false};
  if(prepared?.kind==='missing')return {success:false,code:'STORE_URL_MISSING',error:prepared.error,attempted:false};
  if(prepared?.kind==='conflict')return {success:false,code:'IDENTITY_CONFLICT',error:prepared.error,attempted:false};
  const numberLookup=prepared?.kind==='legacy';
  if(!numberLookup&&(prepared?.kind!=='latest'||!storeBaseUrl(prepared.storeUrl)))return {success:false,code:'INVALID_PREPARED_LOOKUP',error:'조회 준비 정보 오류',attempted:false};
  let attempted=false;
  if(hooks.signal?.aborted)return {success:false,code:'CANCELLED',error:'조회 요청 전 중단됨',attempted:false};
  try{
    const mallId=positiveIdentifier(mallSeq,'업체번호');
    const cookies=numberLookup?null:await naverAuthCookies();
    if(hooks.signal?.aborted)throw Error('조회 요청 전 중단됨');
    hooks.assertActive?.();
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),18500);
    const cancel=()=>ctrl.abort();hooks.signal?.addEventListener('abort',cancel,{once:true});
    try{
      const beforeRequest=async()=>{
        hooks.assertActive?.();await hooks.beforeRequest?.(prepared.storeUrl||'');hooks.assertActive?.();
        if(ctrl.signal.aborted)throw Error('조회 요청 전 중단됨');
        attempted=true;
      };
      const business=numberLookup
        ?await lookupByNumbers(mallId,prepared.syncNvMid,ctrl.signal,beforeRequest,prepared.channelProductNo)
        :await lookupLatest(prepared.storeUrl,mallId,ctrl.signal,cookies,beforeRequest);
      let warning='';
      try{await saveCompanyCache(mallId,business,ctrl.signal);}
      catch(e){warning='조회 성공 · 회사 캐시 저장 실패: '+String(e?.message||e);}
      return {success:true,data:business,origin:numberLookup?'number-api':'latest-api',attempted:true,warning};
    }finally{clearTimeout(timer);hooks.signal?.removeEventListener('abort',cancel);}
  }catch(e){const msg=String(e?.message||e);return {success:false,error:msg,httpStatus:e.httpStatus||null,endpoint:e.endpoint||'',serverMessage:e.serverMessage||'',
    code:/로그인|인증|쿠키/i.test(msg)?'AUTH_REQUIRED':/NO_SELLER_DETAILS/.test(msg)?'NO_SELLER_DETAILS':numberLookup?'NUMBER_API_ERROR':'LATEST_API_ERROR',attempted};}
}
async function getBusinessInfo(mallSeq,syncNvMid,observedStoreUrl,productUrl,statusStoreUrl='',statusProductUrl=''){
  try{
    const prepared=await prepareBusinessLookup(mallSeq,observedStoreUrl,productUrl,statusStoreUrl,statusProductUrl,'',syncNvMid);
    return executePreparedBusinessLookup(prepared,mallSeq);
  }catch(e){return {success:false,error:String(e?.message||e),attempted:false};}
}
