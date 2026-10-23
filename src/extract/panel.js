/* 유승빈 DB추출기 v3.25 - 기존 탭 재사용 / 사업자중복 / 로컬 이력 검색 결과 상단 UI */
(()=>{
  if(document.getElementById('sb-leads-panel'))return;
  const root=document.createElement('section');root.id='sb-leads-panel';
  root.innerHTML=`
    <div class="sb-header" id="sb-drag-handle" title="여기를 잡고 원하는 위치로 이동"><span class="sb-mark">SB</span><strong>유승빈 DB추출기</strong><small>v3.25</small><button id="sb-toggle" aria-label="패널 접기" title="접기">−</button></div>
    <button id="sb-mini" type="button" title="유승빈 DB추출기 펼치기"><span class="sb-mini-mark">SB</span><span class="sb-mini-led"></span><span class="sb-mini-title">유승빈 DB추출기</span><span class="sb-mini-action">펼치기</span></button>
    <div id="sb-effect" class="sb-effect" aria-live="polite" aria-hidden="true"><span id="sb-effect-icon">✨</span><strong id="sb-effect-title">시작!</strong><span id="sb-effect-sub">추출 준비 중</span><div class="sb-confetti"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
    <div id="sb-body" class="sb-body">
      <div id="sb-site" class="sb-source">검색 결과를 확인하고 있어요.</div>
      <div id="sb-price-pages" class="sb-fields"><label>시작 페이지<input id="sb-from" type="number" min="1" max="10" value="1"></label><label>종료 페이지<input id="sb-to" type="number" min="1" max="10" value="10"></label></div>
      <div id="sb-page-note" class="sb-help"></div>

      <label>담당자 이름 (직원별로 입력)<input id="sb-owner" type="text" maxlength="40" placeholder="담당자 이름"></label>
      <label>추출 키워드 (줄바꿈 또는 쉼표 구분, 최대 20개)<textarea id="sb-keywords" rows="3" placeholder="암막커튼&#10;쉬폰커튼"></textarea></label>
      <div class="sb-fields"><label>최소 리뷰수<input id="sb-minreviews" type="number" min="0" value="0"></label><label>최대 리뷰수 (빈칸=무제한)<input id="sb-maxreviews" type="number" min="0" placeholder="무제한"></label></div>
      <label class="sb-check"><input id="sb-reviewfilter" type="checkbox"> 리뷰수 필터 사용</label>
      <div class="sb-fields"><label>묶음상품<select id="sb-grouped"><option value="include">포함</option><option value="exclude">제외 (확인 불가도 보류)</option></select></label><label>광고상품<select id="sb-ads"><option value="all">모두 포함</option><option value="exclude">광고 제외</option><option value="only">광고만</option></select></label></div>
      <div class="sb-buttons"><button id="sb-current" class="sb-btn sb-primary">현재 화면 추출</button><button id="sb-auto" class="sb-btn sb-primary">전체 자동 추출</button></div>
      <div class="sb-buttons"><button id="sb-pause" class="sb-btn sb-secondary" disabled>Ⅱ 일시정지</button><button id="sb-resume" class="sb-btn sb-secondary" disabled>▶ 이어하기</button></div>
      <div class="sb-buttons"><button id="sb-stop" class="sb-btn sb-stop" disabled>■ 수집 종료</button><button id="sb-reset" class="sb-btn sb-secondary">↻ 작업 초기화</button></div>
      <div class="sb-buttons sb-small"><button id="sb-inspect" class="sb-btn sb-outline">화면 진단</button><button id="sb-health" class="sb-btn sb-outline">연결 진단</button></div>
      <div id="sb-inspect-result" class="sb-hint"></div>
      <div id="sb-health-result" class="sb-hint"></div>
      <div id="sb-stale" class="sb-warning" style="display:none">다른 키워드의 이전 추출 결과가 남아 있어요. 작업 초기화를 누르거나 새 추출을 시작하세요.</div>
      <div class="sb-live" aria-live="polite"><span id="sb-dot" class="sb-dot"></span><b id="sb-phase">대기 중</b><span id="sb-time">00:00</span></div>
      <div id="sb-stage" class="sb-stage" role="status">추출 방식을 선택하면 진행 상황이 표시됩니다.</div>
      <div id="sb-current-store" class="sb-current-store">현재 조회 업체: -</div>
      <div id="sb-pages" class="sb-help">페이지별 수집 기록: 없음</div>
      <div class="sb-progress"><div id="sb-bar"></div></div>
      <div id="sb-statistics" class="sb-hint">상세 통계: 추출 전</div><div class="sb-summary"><span>업체 <b id="sb-count">0</b></span><span>010 후보 <b id="sb-matched">0</b></span><span>보류 <b id="sb-review">0</b></span></div>
      <div id="sb-audit-summary" class="sb-hint">수집 검증: 수집 전</div><div class="sb-buttons"><button id="sb-audit-download" class="sb-btn sb-outline" disabled>수집 검증 CSV (제외 사유)</button></div><div class="sb-buttons"><button id="sb-basic-download" class="sb-btn sb-outline" disabled>상품정보 CSV (16열)</button></div>
      <div class="sb-buttons"><button id="sb-download" class="sb-btn sb-primary" disabled>CSV 다운로드</button><button id="sb-copyrows" class="sb-btn sb-secondary" disabled>시트 행 복사</button></div>
      <div class="sb-buttons"><button id="sb-all-copy" class="sb-btn sb-primary" disabled>전체 진단 한 번에 복사</button><button id="sb-all-save" class="sb-btn sb-secondary" disabled>전체 진단 파일 저장</button></div>
      <div id="sb-all-status" class="sb-help">실행 로그·페이지 통계·카탈로그 오류·영업 CSV·보류 CSV·수집검증 데이터를 한 번에 묶습니다. 업체 연락처가 포함될 수 있습니다.</div>
      <div class="sb-buttons sb-small"><button id="sb-review-download" class="sb-btn sb-outline" disabled>보류 CSV</button><button id="sb-copylog" class="sb-btn sb-outline">진단 기록 복사</button></div>
      <details><summary>진행 · 오류 기록</summary><div class="sb-log" id="sb-log"></div></details>
    </div><span class="sb-resize-hint" title="우측 아래 모서리를 끌어 크기 조절"></span>`;
  document.documentElement.appendChild(root);
  const $=id=>root.querySelector('#'+id);
  const uiLayoutKey='sb_panel_layout_v26',minKey='sb_panel_minimized_v28';
  let restored=false,moving=false,resizeTimer=null,effectTimer=null,previousCompletedAt=0,firstState=true,wasMiniDrag=false;
  const viewportClamp=(x,y,w,h)=>({x:Math.max(4,Math.min(x,Math.max(4,window.innerWidth-w-4))),y:Math.max(4,Math.min(y,Math.max(4,window.innerHeight-58)))});
  function persistLayout(){
    if(!restored||root.classList.contains('sb-collapsed'))return;
    const r=root.getBoundingClientRect();
    try{chrome.storage.local.set({[uiLayoutKey]:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}});}catch{}
  }
  try{chrome.storage.local.get([uiLayoutKey,minKey],data=>{
    const saved=data?.[uiLayoutKey];if(saved){
      const w=Math.min(Math.max(290,Number(saved.w)||332),Math.max(290,window.innerWidth-10));
      const h=Math.min(Math.max(230,Number(saved.h)||690),Math.max(230,window.innerHeight-10));
      root.style.width=w+'px';root.style.height=h+'px';
      const pos=viewportClamp(Number(saved.x)||0,Number(saved.y)||0,w,h);
      root.style.left=pos.x+'px';root.style.top=pos.y+'px';root.style.right='auto';
    }
    restored=true;
    if(data?.[minKey])root.classList.add('sb-collapsed');
  });}catch{restored=true;}
  const handle=$('sb-drag-handle');let startX=0,startY=0,baseX=0,baseY=0;
  handle.addEventListener('pointerdown',ev=>{
    if(ev.button!==0||ev.target.closest('button'))return;
    const r=root.getBoundingClientRect();moving=true;startX=ev.clientX;startY=ev.clientY;baseX=r.left;baseY=r.top;
    root.style.left=r.left+'px';root.style.top=r.top+'px';root.style.right='auto';
    handle.setPointerCapture(ev.pointerId);root.classList.add('sb-moving');ev.preventDefault();
  });
  handle.addEventListener('pointermove',ev=>{
    if(!moving)return;
    const r=root.getBoundingClientRect(),pos=viewportClamp(baseX+ev.clientX-startX,baseY+ev.clientY-startY,r.width,r.height);
    root.style.left=pos.x+'px';root.style.top=pos.y+'px';
  });
  function endMove(){if(moving){moving=false;root.classList.remove('sb-moving');persistLayout();}}
  handle.addEventListener('pointerup',endMove);handle.addEventListener('pointercancel',endMove);
  const mini=$('sb-mini');let miniDown=null;
  mini.addEventListener('pointerdown',ev=>{
    if(ev.button!==0)return;
    const rect=root.getBoundingClientRect();miniDown={x:ev.clientX,y:ev.clientY,l:rect.left,t:rect.top,moved:false};
    mini.setPointerCapture(ev.pointerId);
  });
  mini.addEventListener('pointermove',ev=>{
    if(!miniDown)return;
    const dx=ev.clientX-miniDown.x,dy=ev.clientY-miniDown.y;
    if(Math.abs(dx)+Math.abs(dy)<6&&!miniDown.moved)return;
    miniDown.moved=true;const r=root.getBoundingClientRect();const pos=viewportClamp(miniDown.l+dx,miniDown.t+dy,r.width,r.height);
    root.style.left=pos.x+'px';root.style.top=pos.y+'px';root.style.right='auto';
  });
  mini.addEventListener('pointerup',()=>{if(miniDown){wasMiniDrag=miniDown.moved;miniDown=null;}});
  mini.addEventListener('pointercancel',()=>{miniDown=null;});
  function setCollapsed(collapsed){
    if(collapsed){persistLayout();root.classList.add('sb-collapsed');}
    else{root.classList.remove('sb-collapsed');const r=root.getBoundingClientRect();const pos=viewportClamp(r.left,r.top,r.width,r.height);root.style.left=pos.x+'px';root.style.top=pos.y+'px';root.style.right='auto';}
    try{chrome.storage.local.set({[minKey]:collapsed});}catch{}
  }
  mini.onclick=()=>{if(wasMiniDrag){wasMiniDrag=false;return;}setCollapsed(false);};
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>{
    if(!restored||root.classList.contains('sb-collapsed'))return;clearTimeout(resizeTimer);resizeTimer=setTimeout(persistLayout,350);
  }).observe(root);
  window.addEventListener('resize',()=>{
    const r=root.getBoundingClientRect();const pos=viewportClamp(r.left,r.top,r.width,r.height);
    root.style.left=pos.x+'px';root.style.top=pos.y+'px';root.style.right='auto';
  });
  function showEffect(kind){
    const el=$('sb-effect');clearTimeout(effectTimer);el.className='sb-effect sb-effect-'+kind;
    $('sb-effect-icon').textContent=kind==='finish'?'🎉':'✨';
    $('sb-effect-title').textContent=kind==='finish'?'추출 완료!':'추출 시작!';
    $('sb-effect-sub').textContent=kind==='finish'?'CSV를 확인해 보세요':'상품을 확인하고 있어요';
    el.setAttribute('aria-hidden','false');
    effectTimer=setTimeout(()=>{el.className='sb-effect';el.setAttribute('aria-hidden','true');},kind==='finish'?1900:1250);
  }

  let snapshot=null,waiting=false,clientError='',recentLogs=[],lastSignature='',polling=false,hydrated=false,contextDead=false;
  const currKeyword=()=>new URL(location.href).searchParams.get('query')||'';
  const isPlus=()=>location.pathname.startsWith('/ns/');
  const sessionKey='sb_v28_ui_log';
  try{recentLogs=JSON.parse(sessionStorage.getItem(sessionKey)||'[]');if(!Array.isArray(recentLogs))recentLogs=[];}catch{}
  function log(msg){recentLogs.push(`[${new Date().toLocaleTimeString('ko-KR')}] [화면] ${String(msg).slice(0,400)}`);recentLogs=recentLogs.slice(-60);try{sessionStorage.setItem(sessionKey,JSON.stringify(recentLogs));}catch{}renderLog();}
  function renderLog(){const lines=[...recentLogs,...(snapshot?.logs||[])];const sig=lines.join('\n');if(sig===lastSignature)return;lastSignature=sig;const box=$('sb-log');box.replaceChildren(...lines.map(x=>{const el=document.createElement('div');el.textContent=x;return el;}));box.scrollTop=box.scrollHeight;}
  function request(message,ms=11000){return new Promise((resolve,reject)=>{let done=false;const timer=setTimeout(()=>{if(!done){done=true;reject(Error('백그라운드 응답 제한시간 초과'));}},ms);try{chrome.runtime.sendMessage(message,result=>{if(done)return;done=true;clearTimeout(timer);const err=chrome.runtime.lastError;if(err)return reject(Error(err.message));if(!result?.ok)return reject(Error(result?.error||'알 수 없는 오류'));resolve(result);});}catch(e){clearTimeout(timer);reject(e);}});}
  function error(e){clientError=String(e?.message||e);$('sb-phase').textContent='오류';$('sb-stage').textContent=clientError;log('오류: '+clientError);}
  const time=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  function render(s){
    if(!firstState&&['완료','부분 완료'].includes(s.phase)&&s.finishedAt&&s.finishedAt!==previousCompletedAt)showEffect('finish');
    previousCompletedAt=s.finishedAt||0;firstState=false;
    snapshot=s;const busy=!!s.running;
    if(!hydrated){
      const set=(id,value)=>{if(document.activeElement!==$(id))$(id).value=value;};
      set('sb-keywords',s.settings?.keywords?.join('\n')||currKeyword());
      set('sb-owner',s.settings?.owner||'');
      if(s.settings?.ads)set('sb-ads',s.settings.ads);
      if(s.settings?.grouped)set('sb-grouped',s.settings.grouped);
      if(s.settings?.minReviews!=null)set('sb-minreviews',s.settings.minReviews);
      if(s.settings?.maxReviews!=null)set('sb-maxreviews',s.settings.maxReviews);
      $('sb-reviewfilter').checked=!!s.settings?.reviewsEnabled;
      hydrated=true;
    }
    const mismatch=false; // Multi-keyword jobs legitimately differ from current search URL.
    $('sb-stale').style.display=mismatch?'':'none';
    $('sb-phase').textContent=clientError?'오류':(s.phase||'대기 중');
    $('sb-stage').textContent=clientError||s.error||s.stage||'준비됨';
    $('sb-count').textContent=String(s.scanned||0);$('sb-matched').textContent=String(s.matched?.length||0);$('sb-review').textContent=String(s.review?.length||0);
    let perc=0;
    if(s.collection){const c=s.collection;if(c.source==='plus'&&c.mode==='auto')perc=10+Math.min(45,Math.round((s.discovered||0)/60)*3);else{const steps=Math.max(1,c.to-c.from+1);const all=Math.max(1,c.keywords.length*steps);const done=c.keywordIndex*steps+Math.max(0,(c.nextPage||c.from)-c.from);perc=Math.round(60*Math.min(1,done/all));}}
    else if(s.total)perc=60+Math.round(40*(s.processed||0)/s.total);
    else if(['완료','부분 완료'].includes(s.phase))perc=100;
    $('sb-bar').style.width=`${Math.min(100,perc)}%`;
    $('sb-pause').disabled=!busy||!!s.paused;$('sb-resume').disabled=!(s.paused||(!busy&&(s.pending?.length||s.collection)));
    const plusCollect=!!(s.collection?.source==='plus'&&s.collection?.mode==='auto');
    $('sb-stop').disabled=!busy;$('sb-stop').textContent=plusCollect?'■ 수집 종료 후 업체 조회':'■ 전체 중단';
    $('sb-current').disabled=busy||waiting;$('sb-auto').disabled=busy||waiting;
    $('sb-reset').disabled=waiting;
    $('sb-basic-download').disabled=!s.basic?.length||mismatch;
    $('sb-audit-download').disabled=!s.auditRows?.length||mismatch;
    $('sb-download').disabled=!s.matched?.length||mismatch;
    $('sb-copyrows').disabled=!s.matched?.length||mismatch;
    $('sb-review-download').disabled=!s.review?.length||mismatch;
    $('sb-all-copy').disabled=!s.auditPages?.length&&!s.matched?.length&&!s.review?.length&&!s.collection&&!s.logs?.length;
    $('sb-all-save').disabled=$('sb-all-copy').disabled;
    $('sb-dot').classList.toggle('sb-active',busy);
    $('sb-dot').classList.toggle('sb-error',!!s.error);
    const elapsed=s.startedAt?Math.max(0,Math.floor(((busy?Date.now():s.finishedAt||Date.now())-s.startedAt)/1000)):0;
    $('sb-time').textContent=time(elapsed);
    const t=s.statistics||{};
    const pages=s.auditPages||[];const sum=(key)=>pages.reduce((n,p)=>n+(Number(p[key])||0),0);
    $('sb-audit-summary').textContent=pages.length?`관측 대표후보 ${sum('scanRepresentativeCandidates')}개 · 식별 미완료 ${sum('scanCoverageUnverified')}개(페이지별 관측 합계) · 미식별 고유 후보 ${s.unidentifiedUniqueCandidates??'-'}개 · 스크롤 미완료 ${pages.filter(p=>p.scanIncomplete).length}페이지 / 수집검증 ${sum('searchProducts')}건(페이지별 식별 관측) / 원시링크 고유식별 ${sum('scanRawUnique')}개·미식별 ${sum('scanUnidentifiedUnique')}개 / 2.x 광범위 식별 ${sum('scanLegacyWideUnique')}개·대표링크 ${sum('scanStrictUnique')}개·검증된 확장후보 ${sum('scanLegacySafeUnique')}개·실제 확장추가 ${sum('scanLegacyAddedUnique')}개 / 카탈로그 내부·보조 링크 제외 이벤트 ${sum('scanNestedExcluded')}개(스크롤 중 중복 포함) / 원시 이벤트 ${sum('scanLinkEvents')}개 = 네이버 ${sum('rawNaver')} + 외부 ${sum('rawExternal')} + 식별부족 ${sum('rawUnknown')} + 원부 대표카드 ${sum('rawCatalogRepresentatives')} / 카탈로그 판매상품 ${sum('apiOffers')}개 중 네이버 ${sum('apiNaver')}개 / 신규상품 ${sum('added')}개 → 후보 ${s.discovered||0}개 → 업체 중복 ${t.sameSeller||0}건 → 최종 조회대상 ${s.total||0}곳 · 기록 누락 ${s.auditTruncated||0}건`:'수집 검증: 검색 결과를 수집하면 제외 사유별로 표시됩니다.';
    $('sb-statistics').textContent=`상품 ${s.discovered||0} · 조회 ${t.checked||0} · 신규 ${t.new||0} · 부재 ${t.absent||0} · 거절 ${t.rejected||0} · 계약완료 ${t.paid||0} · 결제예정 ${t.paymentScheduled||0} · 타지사 ${t.otherBranch||0} · 동일지사 ${t.sameBranch||0} · 기타/미확인 ${t.unknown||0} · 유효한 010 미확보 ${t.no010||0} · 사업자중복 스토어 ${t.businessDuplicates||0} · 재조회 차단 ${t.lookupPrevented||0} · 업체별 중복상품 ${t.sameSeller||0} · 이전 추출 중복 ${t.duplicate||0} · 필터 제외 ${t.filtered||0} · 광고 제외 ${t.adsExcluded||0} · 리뷰 미확인 ${t.unknownReviews||0} · 묶음 여부 미확인 ${t.unknownGroup||0} · 카탈로그 조회 실패 ${s.catalogWarnings||0} · 스토어 URL 미확인 ${t.bizUrlMissing||0} · 최신 사업자조회 성공 ${t.bizLatest||0} · 번호 기반 조회 성공 ${t.bizLegacy||0} · 회사 캐시 사용 ${t.bizCached||0} · 사업자조회 오류 ${t.bizErrors||0} · 링크식별 미확인 ${s.unidentifiedWarnings||0} · 조회 제한 ${s.catalogBlockedReason||'없음'} · 누적 처리 업체 ${s.seen?.length||0}`;
    $('sb-current-store').textContent=`현재 조회 업체: ${s.currentStore||'-'}`;
    $('sb-pages').textContent=s.pageStats?.length?(s.source==='plus'?'60개 묶음 기록: ':'페이지별 수집: ')+s.pageStats.slice(-12).map(p=>`${p.keyword} ${p.page}${s.source==='plus'?'':'페이지'} ${p.products}개`).join(' / '):'수집 기록: 없음';
    $('sb-site').textContent=`${isPlus()?'네이버 플러스스토어':'네이버 가격비교'} · 진행 키워드: ${s.keyword||currKeyword()||'확인 필요'}${s.running?` · 업체 조회 ${s.processed||0}/${s.total||'상품 수집 중'}`:''}`;
    renderLog();
  }
  async function refresh(){if(polling||contextDead)return;polling=true;try{const r=await request({action:'sb:state'},6500);if(!waiting){clientError='';render(r.state);}}catch(e){if(/Extension context invalidated/i.test(String(e?.message||e))){contextDead=true;$('sb-phase').textContent='새로고침 필요';$('sb-stage').textContent='확장 프로그램 교체 후 기존 스크립트입니다. 네이버 쇼핑 탭을 F5 새로고침하세요.';return;}error(e);}finally{polling=false;}}
  async function begin(mode){
    if(waiting)return;clientError='';waiting=true;
    // 새 작업의 UI 진단은 이전 시도와 구분합니다. 기존 결과는 버튼 실행 전 별도 저장 가능합니다.
    recentLogs=[];try{sessionStorage.setItem(sessionKey,'[]');}catch{}
    lastSignature='';showEffect('start');
    const from=Number($('sb-from').value),to=Number($('sb-to').value);
    const btn=mode==='auto'?$('sb-auto'):$('sb-current');
    log(`${mode==='auto'?'전체 자동':'현재 화면'} 추출 클릭 · ${from}~${to}`);
    btn.textContent='시작 요청 중…';$('sb-phase').textContent='시작 요청 중';$('sb-stage').textContent='백그라운드 작업 등록 확인 중';
    $('sb-current').disabled=$('sb-auto').disabled=true;
    try{const settings={owner:$('sb-owner').value,keywords:$('sb-keywords').value,minReviews:$('sb-minreviews').value,maxReviews:$('sb-maxreviews').value,reviewsEnabled:$('sb-reviewfilter').checked,grouped:$('sb-grouped').value,ads:$('sb-ads').value};await request({action:'sb:start',from,to,mode,settings},6500);log('시작 요청 접수 확인');await new Promise(r=>setTimeout(r,250));}
    catch(e){error(e);}
    finally{waiting=false;btn.textContent=mode==='auto'?'전체 자동 추출':'현재 화면 추출';void refresh();}
  }
  $('sb-current').onclick=()=>begin('current');$('sb-auto').onclick=()=>begin('auto');
  $('sb-pause').onclick=async()=>{try{const r=await request({action:'sb:pause'});render(r.state);}catch(e){error(e);}};
  $('sb-stop').onclick=async()=>{try{const plus=snapshot?.collection?.source==='plus';if(!plus&&!confirm('현재 전체 작업을 중단할까요? 저장된 기록은 남고 이어하기가 필요할 수 있습니다.'))return;const r=await request({action:'sb:stop'});render(r.state);}catch(e){error(e);}};
  $('sb-resume').onclick=async()=>{try{const r=await request({action:'sb:resume'});render(r.state);}catch(e){error(e);}};
  $('sb-reset').onclick=async()=>{
    if(!confirm('현재 추출 결과, 보류 목록, 진행 기록을 초기화할까요?\n조회 이력은 보존되며, 새 작업에서는 필요한 사업자조회를 다시 실행합니다. 이미 내려받은 CSV나 사내 DB 정보는 삭제되지 않습니다.'))return;
    log('작업 초기화 요청');try{const r=await request({action:'sb:reset'},9000);snapshot=r.state;recentLogs=[];clientError='';hydrated=false;try{sessionStorage.removeItem(sessionKey);}catch{}lastSignature='';render(r.state);$('sb-inspect-result').textContent='';$('sb-health-result').textContent='';}catch(e){error(e);}
  };
  $('sb-inspect').onclick=async()=>{log('화면 진단 요청');$('sb-inspect-result').textContent='검사 중…';try{const r=await request({action:'sb:inspect'});const a=r.inspection;$('sb-inspect-result').textContent=`상품 ${a.products}개 · 업체 ${a.count}곳 · 광고 ${a.ads}건 · 예시 ${a.examples.join(', ')||'없음'}`;log($('sb-inspect-result').textContent);}catch(e){error(e);}};
  $('sb-health').onclick=async()=>{log('연결 진단 요청');$('sb-health-result').textContent='진단 중…';try{const r=await request({action:'sb:health'});const h=r.health;$('sb-health-result').textContent=`최신 사업자조회 연동 ${h.hasAccess?'접근 허용':'접근 차단'} · 신규 전화번호 조회 포함 · 로그인 여부는 실제 조회 시 확인`;log($('sb-health-result').textContent);}catch(e){error(e);}};
  $('sb-toggle').onclick=()=>setCollapsed(!root.classList.contains('sb-collapsed'));
  const cols=[['키워드','keyword'],['페이지','page'],['상품명','productName'],['상품링크','productUrl'],['업체명','companyName'],['리뷰수','reviews'],['대표자명','ceoName'],['연락처','phoneNumber'],['업체주소','address'],['담당자','owner'],['날짜','date'],['mid','mid'],['성별/나이','demographic'],['상태','status'],['특이사항','memo'],['상세내용(통화기록)','history']];
  function cell(raw){let s=String(raw??'');if(/^\s*[=+@-]/.test(s))s="'"+s;return s;}
  function csvValue(x){return '"'+cell(x).replace(/"/g,'""')+'"';}
  function saveCsv(rows,filename,columns){const header=columns.map(c=>csvValue(c[0])).join(',');const data=rows.map(r=>columns.map(c=>csvValue(r[c[1]])).join(','));const blob=new Blob(['\ufeff'+[header,...data].join('\r\n')],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=filename;document.documentElement.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4500);}
  const date=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const cleanName=()=>String(snapshot?.keyword||'검색').replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,35);
  $('sb-audit-download').onclick=()=>{const columns=[['키워드','keyword'],['페이지','page'],['출처','source'],['처리 결과','decision'],['판매처번호','mallSeq'],['네이버상품번호','nvMid'],['스토어상품번호','channelProductNo'],['업체명','storeName'],['상품명','productName'],['카탈로그연결번호','catalogNvMid'],['판매처수','sellerCount'],['광고 여부','isAd'],['리뷰수','reviews'],['광고주유형','advertiserType'],['확인된 상품링크','productUrl'],['확인된 스토어주소','storeUrl'],['특이사항','specialNotes'],['원부 확인','catalogVerified'],['원부 판별 근거','catalogEvidence']];saveCsv(snapshot?.auditRows||[],`유승빈 수집검증_${cleanName()}_${date()}.csv`,columns);log('검색 결과 상품별 제외·중복 사유 진단 CSV 다운로드');};
  $('sb-basic-download').onclick=()=>{saveCsv(snapshot?.basic||[],`유승빈 상품정보_${cleanName()}_${date()}.csv`,cols);log('상품정보 16열 CSV 다운로드 (연락처는 확인되지 않은 경우 공란)');};
  $('sb-download').onclick=()=>{saveCsv(snapshot?.matched||[],`유승빈 DB추출_${cleanName()}_${date()}.csv`,cols);log('영업관리표 16열 CSV 다운로드');};
  $('sb-review-download').onclick=()=>{saveCsv(snapshot?.review||[],`유승빈 DB추출_보류_${cleanName()}_${date()}.csv`,[['검색어','keyword'],['페이지','page'],['업체식별번호','mallSeq'],['네이버상품번호','nvMid'],['스토어명','storeName'],['상품명','productName'],['상품링크','productUrl'],['보류사유','reason'],['특이사항','memo'],['스토어주소','storeUrl'],['대표자','ceoName'],['확인된 연락처','phoneNumber'],['전체 연락처 후보','phoneCandidates'],['주소','address'],['원본 관측 상품주소','observedProductUrl'],['조회 경로','lookupOrigin'],['HTTP 상태','lookupHttpStatus'],['조회 API','lookupEndpoint'],['서버 오류','lookupServerMessage']]);log('확인 보류 CSV 다운로드');};
  $('sb-copyrows').onclick=async()=>{const rows=snapshot?.matched||[];const tsv=rows.map(r=>cols.map(c=>cell(r[c[1]]).replace(/[\t\r\n]+/g,' ')).join('\t')).join('\r\n');try{await navigator.clipboard.writeText(tsv);log(`영업관리표 행 ${rows.length}건 복사 완료(헤더 제외)`);alert(`${rows.length}개 행을 복사했어요. 스프레드시트의 첫 빈 행 첫 칸에 붙여넣으세요.`);}catch(e){error('클립보드 복사 실패: '+(e.message||e));}};
  $('sb-copylog').onclick=async()=>{const data=[`유승빈 DB추출기 v3.25 (${new Date().toLocaleString('ko-KR')})`,`상태: ${$('sb-phase').textContent}`,...recentLogs,...(snapshot?.logs||[])].join('\n');try{await navigator.clipboard.writeText(data);log('진단 기록 복사 완료');}catch(e){error(e);}};
  // 통합 진단 패키지는 사용자가 직접 버튼을 누를 때만 생성됩니다.
  // 인증 쿠키, 토큰, 원시 HTTP 헤더, 사업자번호 인덱스는 포함하지 않습니다.
  function fullDiagnostic(){
    const s=snapshot||{};const pages=s.auditPages||[];
    const totals={};for(const key of ['searchProducts','rawNaver','rawExternal','rawUnknown','rawCatalogRepresentatives','apiOffers','apiNaver','apiExternal','rawAdded','offerAdded','added','scanRepresentativeCandidates','scanCoverageUnverified','scanRawUnique','scanUnidentifiedUnique','scanNestedExcluded','scanAmbiguousCards']){
      totals[key]=pages.reduce((v,p)=>v+(Number(p[key])||0),0);
    }
    return {
      report:'유승빈 DB추출기 통합 진단',schema:'sb-diagnostic-v1',version:'3.25',
      exportedAt:new Date().toISOString(),searchPage:location.origin+location.pathname,keyword:s.keyword||currKeyword(),
      status:s.phase||'',stage:s.stage||'',startedAt:s.startedAt?new Date(s.startedAt).toISOString():null,
      finishedAt:s.finishedAt?new Date(s.finishedAt).toISOString():null,
      settings:s.settings||{},stats:s.statistics||{},totals,
      collection:s.collection?{source:s.collection.source,mode:s.collection.mode,from:s.collection.from,to:s.collection.to,
        keywordIndex:s.collection.keywordIndex,nextPage:s.collection.nextPage,savedProducts:s.collection.products?.length||0,
        waiting:s.collection.pageWait?{keyword:s.collection.pageWait.keyword,page:s.collection.pageWait.page,fromPage:s.collection.pageWait.fromPage,
          reason:s.collection.pageWait.reason,failedAt:s.collection.pageWait.failedAt}:null}:null,
      summary:{discovered:s.discovered||0,checked:s.scanned||0,matched:s.matched?.length||0,review:s.review?.length||0,
        pending:s.pending?.length||0,catalogWarnings:s.catalogWarnings||0,unidentifiedWarnings:s.unidentifiedWarnings||0,unidentifiedUniqueCandidates:s.unidentifiedUniqueCandidates??null,unidentifiedObservationCount:s.unidentifiedObservationCount??null,
        catalogBlockedReason:s.catalogBlockedReason||'',auditTruncated:s.auditTruncated||0,incompletePages:s.incompletePages||[],phoneDuplicates:s.phoneDuplicates||0},
      pageTransitions:s.pageTransitions||[],pages:s.pageStats||[],auditPages:pages,catalogDiagnostics:s.catalogDiagnostics||[],auditRows:s.auditRows||[],
      matchedCsvRows:s.matched||[],reviewCsvRows:s.review||[],basicCsvRows:s.basic||[],
      logs:s.logs||[],uiEvents:recentLogs.slice(-40)
    };
  }
  function saveDiagnosticFile(contents){
    const blob=new Blob(['\ufeff',contents],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`유승빈_전체진단_${cleanName()}_${date()}_v3.25.json`;
    document.documentElement.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  $('sb-all-copy').onclick=async()=>{
    const payload=JSON.stringify(fullDiagnostic(),null,2);
    try{
      await navigator.clipboard.writeText(payload);
      $('sb-all-status').textContent=`복사 완료 · ${payload.length.toLocaleString()}자 · 지금 ChatGPT에 붙여넣으면 돼 (연락처 포함 가능)`;
      log('전체 진단 패키지 복사 완료 · '+payload.length+'자');
    }catch(e){
      saveDiagnosticFile(payload);
      $('sb-all-status').textContent='클립보드 복사에 실패해 통합 JSON 파일로 저장했어. 파일을 첨부해 줘.';
      log('통합 진단 클립보드 실패 · JSON 파일 자동 저장: '+String(e?.message||e).slice(0,120));
    }
  };
  $('sb-all-save').onclick=()=>{const payload=JSON.stringify(fullDiagnostic(),null,2);saveDiagnosticFile(payload);$('sb-all-status').textContent='통합 진단 JSON 파일 저장 완료 · ChatGPT에 이 파일 하나만 첨부하면 돼.';log('전체 진단 JSON 파일 저장 완료');};
  $('sb-page-note').textContent=isPlus()?'플러스스토어: 60개씩 즉시 저장하면서 계속 스크롤 · ■ 수집 종료 시 업체 조회 시작 (페이지 범위 사용 안 함)':'가격비교: 현재 페이지와 입력 키워드 확인 후 검색·페이지 버튼 클릭으로 이동';
  $('sb-price-pages').style.display=isPlus()?'none':'';
  $('sb-site').textContent=`${isPlus()?'플러스스토어':'가격비교'} · 검색어: ${currKeyword()}`;
  $('sb-keywords').value=currKeyword();renderLog();void refresh();setInterval(()=>void refresh(),1800);
})();
