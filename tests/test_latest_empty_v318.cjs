'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../src/background.js','utf8');
const requests=[];
const chrome={permissions:{contains:async()=>true},runtime:{lastError:null},cookies:{get:(_,cb)=>cb({value:'secret-never-log'})}};
const response=(body)=>({ok:true,status:200,type:'basic',headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(body)});
const fetch=async(url,opts)=>{
 requests.push(String(url));
 if(String(url).includes('/api/extension/mall?'))return response({data:{exists:false}});
 if(String(url).includes('/store/seller-info'))return response({success:true,sellerInfo:{}});
 throw Error('Unexpected fetch: '+url);
};
const ctx=vm.createContext({chrome,fetch,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Error,Promise,console});vm.runInContext(src,ctx);
(async()=>{
 const pre=await ctx.prepareBusinessLookup('362714','https://brand.naver.com/basictone','','','');
 const r=await ctx.executePreparedBusinessLookup(pre,'362714');
 assert.equal(r.code,'NO_SELLER_DETAILS');assert.equal(r.success,false);
 assert.equal(requests.filter(s=>s.includes('/store/seller-info')).length,1);
 assert(!requests.some(s=>s.includes('smartwin.iptime.org')));
 console.log('PASS latest server empty details properly classified, no paid fallback');
})().catch(e=>{console.error(e);process.exitCode=1});
