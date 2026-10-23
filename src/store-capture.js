/* 사용자가 직접 연 상품 주소의 판매자·상품 식별 확인. 광고 클릭/새 탭/사업자조회 요청 없음. */
(async()=>{
  if(window.top!==window)return;
  for(const delay of [0,1000,3000]){
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    try{const result=await chrome.runtime.sendMessage({action:'sb:remember-store'});if(result?.saved)return;}catch{return;}
  }
})();
