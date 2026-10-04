import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import worker from './worker.mjs';
import catalog from './Admin/Backend/catalog.js';
import shop from './User/Backend/shop.js';

globalThis.crypto ||= webcrypto;
const proxy='a'.repeat(32);
const session='test-session';
const tokenHash=createHash('sha256').update(session).digest('hex');

function environment(){
 let rotationIndex=0;
 return {
  ADMIN_PROXY_SECRET:proxy,CUSTOMER_PROXY_SECRET:proxy,
  PINATA_JWT:'test-pinata-token',PINATA_JWT_ALT_1:'test-pinata-alt-1',PINATA_JWT_ALT_2:'test-pinata-alt-2',PINATA_GATEWAY:'https://pinata.test',
  DB:{prepare(query){const first=async(values=[])=>{if(query.includes('FROM sessions'))return values[0]===tokenHash?{1:1}:null;if(query.includes('request_limits'))return {count:1};if(query.includes('upload_account_rotation'))return {account_index:rotationIndex++};return null;};return {first:()=>first(),bind(...values){return {first:()=>first(values)};}};}}
 };
}
function request(path,method='GET',role='admin',body,contentType){
 const headers={'x-kst-site-role':role,'x-kst-proxy-token':proxy};
 if(role==='admin')headers.Cookie=`kst_session=${session}`;
 if(body){headers['x-kst-request']='admin';headers['Content-Type']=contentType;}
 return new Request(`https://example.com${path}`,{method,headers,body});
}

test('authenticated image uploads are pinned to Pinata',async()=>{
 const env=environment(),originalFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://uploads.pinata.cloud/v3/files');assert.equal(options.headers.Authorization,'Bearer test-pinata-token');return Response.json({data:{cid:'bafybeigdyrzt5sfp7udm7hu76uh3v2x2c6yd3x4a'}});};
 const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 try{const upload=await worker.fetch(request('/api/admin/image','POST','admin',png,'image/png'),env);assert.equal(upload.status,201);const {url,cid}=await upload.json();assert.equal(cid,'bafybeigdyrzt5sfp7udm7hu76uh3v2x2c6yd3x4a');assert.equal(url,'https://pinata.test/ipfs/'+cid);}finally{globalThis.fetch=originalFetch;}
});

test('authenticated product videos are pinned to Pinata',async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.Authorization,'Bearer test-pinata-token');return Response.json({data:{cid:'bafybeigdyrzt5sfp7udm7hu76uh3v2x2c6yd3x4a'}});};
 try{const mp4=new Uint8Array(16);mp4.set(new TextEncoder().encode('ftyp'),4);const upload=await worker.fetch(request('/api/admin/image','POST','admin',mp4,'video/mp4'),environment());assert.equal(upload.status,201);assert.match((await upload.json()).url,/^https:\/\/pinata\.test\/ipfs\//);}finally{globalThis.fetch=originalFetch;}
});

test('uploads rotate accounts and fail over when a selected account is unavailable',async()=>{
 const originalFetch=globalThis.fetch,used=[],env=environment();globalThis.fetch=async(_url,options)=>{used.push(options.headers.Authorization);if(used.length===2)return Response.json({error:'quota'}, {status:507});return Response.json({data:{cid:'bafybeigdyrzt5sfp7udm7hu76uh3v2x2c6yd3x4a'}});};
 try{const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);const first=await worker.fetch(request('/api/admin/image','POST','admin',png,'image/png'),env);assert.equal(first.status,201);const second=await worker.fetch(request('/api/admin/image','POST','admin',png,'image/png'),env);assert.equal(second.status,201);assert.deepEqual(used,['Bearer test-pinata-token','Bearer test-pinata-alt-1','Bearer test-pinata-alt-2']);}finally{globalThis.fetch=originalFetch;}
});

test('media upload rejects mismatched file contents',async()=>{
 const response=await worker.fetch(request('/api/admin/image','POST','admin',new TextEncoder().encode('<html>'), 'image/png'),environment());
 assert.equal(response.status,400);
});

test('customer role cannot upload media',async()=>{
 const response=await worker.fetch(request('/api/admin/image','POST','customer',Uint8Array.from([1]),'image/png'),environment());
 assert.equal(response.status,404);
});

test('catalog accepts stored image paths and rejects arbitrary local paths',()=>{
 const product={name:'Gift Box',category:'Gift Boxes',unit:'Pack',description:'A gift',price:500,discount:0,stock:3};
 const image='/images/products/12345678-1234-1234-1234-123456789abc.webp';
 assert.equal(catalog.product({...product,image}).image,image);
 assert.throws(()=>catalog.product({...product,image:'/admin/passwords'}));
 const media=catalog.product({...product,price:0,discount:0,packQuantity:24,image2:'https://pinata.test/ipfs/secondary',video:'https://pinata.test/ipfs/video'});
 assert.equal(media.packQuantity,24);assert.equal(media.image2,'https://pinata.test/ipfs/secondary');assert.equal(media.video,'https://pinata.test/ipfs/video');
 assert.equal(catalog.product({...product,price:0,discount:undefined}).price,0);
});

test('only gift boxes receive product discounts; missing prices require a shop quote',()=>{
 const db={products:[{id:'crackers',name:'Sparklers',category:'Sparklers',price:100,discount:30,stock:5},{id:'gift',name:'Gift box',category:'Gift Boxes',price:200,discount:25,stock:5},{id:'quote',name:'Aerial set',category:'Aerial',price:0,discount:0,stock:5}],bundles:[]};
 const result=shop.quote(db,[{id:'crackers',qty:1},{id:'gift',qty:1},{id:'quote',qty:1}]);
 assert.equal(result.items[0].price,100);assert.equal(result.items[1].price,150);assert.equal(result.items[2].price,null);assert.equal(result.quoteRequired,true);
});
