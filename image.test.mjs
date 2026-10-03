import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import worker from './worker.mjs';
import catalog from './Admin/Backend/catalog.js';

globalThis.crypto ||= webcrypto;
const proxy='a'.repeat(32);
const session='test-session';
const tokenHash=createHash('sha256').update(session).digest('hex');

function environment(){
 const objects=new Map();
 return {
  ADMIN_PROXY_SECRET:proxy,CUSTOMER_PROXY_SECRET:proxy,
  PRODUCT_IMAGES:{
   async put(key,body,options){objects.set(key,{body, httpMetadata:options.httpMetadata});},
   async get(key){return objects.get(key)||null;}
  },
  DB:{prepare(query){return {bind(...values){return {
   async first(){if(query.includes('FROM sessions'))return values[0]===tokenHash?{1:1}:null;if(query.includes('request_limits'))return {count:1};return null;}
  };}};}}
 };
}
function request(path,method='GET',role='admin',body,contentType){
 const headers={'x-kst-site-role':role,'x-kst-proxy-token':proxy};
 if(role==='admin')headers.Cookie=`kst_session=${session}`;
 if(body){headers['x-kst-request']='admin';headers['Content-Type']=contentType;}
 return new Request(`https://example.com${path}`,{method,headers,body});
}

test('authenticated image upload is served through the image route',async()=>{
 const env=environment();
 const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 const upload=await worker.fetch(request('/api/admin/image','POST','admin',png,'image/png'),env);
 assert.equal(upload.status,201);
 const {url}=await upload.json();
 assert.match(url,/^\/images\/products\/.*\.png$/);
 const image=await worker.fetch(request(url,'GET','customer'),env);
 assert.equal(image.status,200);
 assert.equal(image.headers.get('Content-Type'),'image/png');
 assert.deepEqual(new Uint8Array(await image.arrayBuffer()),png);
});

test('image upload rejects mismatched image contents',async()=>{
 const response=await worker.fetch(request('/api/admin/image','POST','admin',new TextEncoder().encode('<html>'), 'image/png'),environment());
 assert.equal(response.status,400);
});

test('customer role cannot upload images',async()=>{
 const response=await worker.fetch(request('/api/admin/image','POST','customer',Uint8Array.from([1]),'image/png'),environment());
 assert.equal(response.status,404);
});

test('catalog accepts stored image paths and rejects arbitrary local paths',()=>{
 const product={name:'Gift Box',category:'Gift Boxes',unit:'Pack',description:'A gift',price:500,discount:0,stock:3};
 const image='/images/products/12345678-1234-1234-1234-123456789abc.webp';
 assert.equal(catalog.product({...product,image}).image,image);
 assert.throws(()=>catalog.product({...product,image:'/admin/passwords'}));
});
