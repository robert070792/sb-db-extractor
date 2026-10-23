/* 인증 화면에서도 사용할 수 있는 v3.2 작업 제어 */
document.addEventListener('DOMContentLoaded',()=>{
  const $=id=>document.getElementById(id);
  const call=action=>new Promise((resolve,reject)=>chrome.runtime.sendMessage({action},r=>{
    if(chrome.runtime.lastError)return reject(Error(chrome.runtime.lastError.message));
    if(!r?.ok)return reject(Error(r?.error||'요청 실패'));
    resolve(r);
  }));
  let snapshot=null;
  async function refresh(){
    try{
      const {state}=await call('sb:state');snapshot=state;
      $('state').textContent=`상태: ${state.phase||'대기'} · 처리 ${state.processed||0}/${state.total||0}`;
      $('stage').textContent=state.error||state.stage||'';
      $('resume').disabled=!(state.paused||(!state.running&&(state.collection||state.pending?.length)));
      $('pause').disabled=!state.running||!!state.paused;
      $('stop').disabled=!state.running;
      $('stop').textContent=state.collection?.source==='plus'?'■ 수집 종료 후 업체 조회':'■ 전체 중단';
    }catch(e){$('state').textContent='오류: '+e.message;}
  }
  $('resume').onclick=async()=>{try{await call('sb:resume');await refresh();}catch(e){$('stage').textContent=e.message;}};
  $('pause').onclick=async()=>{try{await call('sb:pause');await refresh();}catch(e){$('stage').textContent=e.message;}};
  $('stop').onclick=async()=>{try{await call('sb:stop');await refresh();}catch(e){$('stage').textContent=e.message;}};
  $('worktab').onclick=async()=>{
    const id=snapshot?.collection?.tabId;
    if(id){try{const tab=await chrome.tabs.get(id);await chrome.tabs.update(id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});return;}catch{}}
    $('stage').textContent='기존 네이버 쇼핑 검색 탭을 선택하세요.';
  };
  void refresh();setInterval(refresh,1800);
});
