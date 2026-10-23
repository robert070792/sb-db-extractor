const assert=require('node:assert/strict');
const C=require('../src/extract/core.js');
assert.equal(C.mobile010('대표전화 010-1234-5678 / 사무실 02-0000-0000'),'010-1234-5678');
assert.equal(C.mobile010('02-1234-5678'),'');
assert.equal(C.cleanProductUrl('https://smartstore.naver.com/main/products/123','https://smartstore.naver.com/verifiedstore','123'),'https://smartstore.naver.com/verifiedstore/products/123');
assert.equal(C.cleanProductUrl('https://smartstore.naver.com/inflow/products/123','','123'),'');
const idx={};assert.equal(C.registerBusiness(idx,'123-45-67890','100').duplicate,false);assert.equal(C.registerBusiness(idx,'1234567890','200').duplicate,true);
const list=[{mallSeq:'100',title:'첫상품',isNaverStore:true,reviews:3},{mallSeq:'100',title:'두번째',isNaverStore:true,reviews:5},{mallSeq:'200',title:'상품',isNaverStore:true,reviews:1}];
console.log('PASS core smoke: mobile010, link validation, duplicate business index');
