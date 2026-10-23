'use strict';
const assert=require('node:assert/strict');
const C=require('../src/extract/core.js');
const p=(mallSeq,chnlProdNo,storeUrl='',productUrl='',extra={})=>({mallSeq,chnlProdNo,storeUrl,productUrl,isNaverStore:true,...extra});
// 1. Direct user-verified basictone mapping; canonical brand product
{
  const items=[p('362714','6149475814')];
  const x=C.enrichStoreUrls(items,{'362714':'https://brand.naver.com/basictone'});
  assert.equal(x.recovered,1);
  assert.equal(x.products[0].storeUrl,'https://brand.naver.com/basictone');
  assert.equal(x.products[0].productUrl,'https://brand.naver.com/basictone/products/6149475814');
}
// 2. Observed verified store on a different product can recover an ad product with same mallSeq
{
  const items=[p('500','111','','', {isAd:true}),p('500','222','https://smartstore.naver.com/example','')];
  const x=C.enrichStoreUrls(items);
  assert.equal(x.products[0].productUrl,'https://smartstore.naver.com/example/products/111');
  assert.equal(x.products[1].productUrl,'https://smartstore.naver.com/example/products/222');
  assert.equal(x.recovered,1);
}
// 3. Same merchant catalog /main becomes actual store URL when evidence exists
{
  const items=[p('888','99','','https://smartstore.naver.com/main/products/99'),p('888','88','https://brand.naver.com/verifiedbrand','')];
  const x=C.enrichStoreUrls(items);
  assert.equal(x.products[0].productUrl,'https://brand.naver.com/verifiedbrand/products/99');
}
// 4. Different mallSeq never borrows mapping
{
  const x=C.enrichStoreUrls([p('1','44','https://smartstore.naver.com/first'),p('2','33')]);
  assert.equal(x.products[1].storeUrl,'');
  assert.equal(x.products[1].productUrl,'');
}
// 5. Conflicting observed slugs do not overwrite any row
{
  const x=C.enrichStoreUrls([p('555','1','https://brand.naver.com/real'),p('555','2','https://smartstore.naver.com/other'),p('555','3')]);
  assert.equal(x.conflicts.length,1);assert.equal(x.products[2].storeUrl,'');
}
// 6. /main/ cannot create evidence; wrong own product number cannot assert other seller identity
{
  const x=C.enrichStoreUrls([p('700','100','','https://smartstore.naver.com/main/products/100'),p('701','20','','https://smartstore.naver.com/strange/products/999')]);
  assert.equal(x.products[0].storeUrl,'');assert.equal(x.products[1].storeUrl,'');
}
// 7. No malformed or untrusted URL injection
{
  const ids=['https://evil.example/brand.naver.com/a','http://brand.naver.com/a','https://brand.naver.com/main/products/15','https://brand.naver.com.evil.example/slug'];
  const x=C.enrichStoreUrls(ids.map((url,i)=>p(String(i+1), '456', url)));
  assert(x.products.every(x=>x.storeUrl===''));
}
// 8. Caller source products unchanged
{
  const input=[p('362714','6149475814')];C.enrichStoreUrls(input,{'362714':'https://brand.naver.com/basictone'});assert.equal(input[0].storeUrl,'');
}
console.log('PASS 8 v3.18 store mapping cases');
