import validators from './Admin/Backend/catalog.js';
import security from './Admin/Backend/security.js';
import orders from './User/Backend/orders.js';
import seedModule from './Admin/Backend/seed.js';
const {seed}=seedModule,{fail}=security,{createOrder,publicOrder}=orders;
const encode=new TextEncoder();
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function body(request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail('Use a JSON request',415);
 if(Number(request.headers.get('Content-Length'))>65536)fail('Request is too large',413);
 const reader=request.body?.getReader();if(!reader)fail('Invalid JSON request');let size=0,chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();fail('Request is too large',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Invalid JSON request');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Request must be a JSON object');return value;
}
async function catalogue(DB){
 const {orders:ignored,...initial}=seed;
 await DB.prepare('INSERT OR IGNORE INTO catalogue(id,payload) VALUES(1,?)').bind(JSON.stringify(initial)).run();
 const row=await DB.prepare('SELECT payload,revision FROM catalogue WHERE id=1').first();return {db:JSON.parse(row.payload),revision:row.revision};
}
async function updateCatalogue(DB,mutate){
 for(let attempt=0;attempt<5;attempt++){
  const {db,revision}=await catalogue(DB);mutate(db);
  const result=await DB.prepare('UPDATE catalogue SET payload=?,revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(db),revision).run();
  if(result.meta.changes)return;
 }
 fail('Another update is in progress. Please retry.',409);
}
async function limit(request,DB,kind,max){
 const now=Date.now(),expires=now+600000,bucket=kind+':'+await hash(request.headers.get('x-kst-client-ip')||'unknown');
 const result=await DB.prepare('INSERT INTO request_limits(bucket,count,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count').bind(bucket,expires,now,now).first();
 if(result.count>max)fail('Too many requests. Try again in 10 minutes.',429);
}
function token(request){return (request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('kst_session='))?.slice(12)||'';}
const cookie=(value,age)=>`kst_session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
const imagePath=/^\/images\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp))$/;
const imageTypes={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
async function uploadImage(request,bucket){
 if(!bucket)fail('Image storage is not configured',503);
 const contentType=(request.headers.get('Content-Type')||'').toLowerCase().split(';')[0].trim(),extension=imageTypes[contentType];
 if(!extension)fail('Choose a JPG, PNG, or WebP image',415);
 const length=Number(request.headers.get('Content-Length'));
 if(Number.isFinite(length)&&length>5*1024*1024)fail('Image must be 5 MB or smaller',413);
 if(!request.body)fail('Choose an image');
 const reader=request.body.getReader(),chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5*1024*1024){await reader.cancel();fail('Image must be 5 MB or smaller',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 const webp=bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
 if(!(extension==='png'&&png||extension==='jpg'&&jpeg||extension==='webp'&&webp))fail('Image contents do not match its file type');
 const key=`products/${crypto.randomUUID()}.${extension}`;
 await bucket.put(key,bytes,{httpMetadata:{contentType}});
 return json({url:`/images/${key}`},201);
}
async function verifyPassword(password,secret){
 if(typeof password!=='string'||password.length>256)return false;
 if(!secret)fail('Admin authentication is not configured',503);
 const [salt,expected]=secret.split(':');if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{64}$/.test(expected))fail('Admin authentication is not configured',503);
 const key=await crypto.subtle.importKey('raw',encode.encode(password),'PBKDF2',false,['deriveBits']);
 const derived=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt.match(/../g),x=>parseInt(x,16)),iterations:100000},key,256));
 const expectedBytes=Uint8Array.from(expected.match(/../g),x=>parseInt(x,16));let difference=0;for(let i=0;i<derived.length;i++)difference|=derived[i]^expectedBytes[i];return difference===0;
}
export default {
 async fetch(request,env){
  try{
   const path=new URL(request.url).pathname,role=request.headers.get('x-kst-site-role'),DB=env.DB;
   if(!['customer','admin'].includes(role))fail('Not found',404);
   const expected=role==='admin'?env.ADMIN_PROXY_SECRET:env.CUSTOMER_PROXY_SECRET,provided=request.headers.get('x-kst-proxy-token');
   // Distinct secrets prevent a customer proxy from impersonating the admin proxy.
   if(!expected||!provided||expected.length<32)fail('Not found',404);
   const actualHash=await hash(provided),expectedHash=await hash(expected);let mismatch=0;
   for(let i=0;i<actualHash.length;i++)mismatch|=actualHash.charCodeAt(i)^expectedHash.charCodeAt(i);
   if(mismatch)fail('Not found',404);
   if(path.startsWith('/images/')){
    if(request.method!=='GET')fail('Not found',404);
    const match=imagePath.exec(path);if(!match)fail('Not found',404);
    if(!env.PRODUCT_IMAGES)fail('Image storage is not configured',503);
    const object=await env.PRODUCT_IMAGES.get(`products/${match[1]}`);if(!object)fail('Image not found',404);
    return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
   }
   if(path==='/api/catalog'&&request.method==='GET'&&role==='customer'){
    const {db}=await catalogue(DB),rows=await DB.prepare("SELECT payload FROM orders WHERE json_extract(payload,'$.status')='Delivered'").all(),sold={};
    for(const row of rows.results)for(const item of JSON.parse(row.payload).items)sold[item.id]=(sold[item.id]||0)+item.qty;
    return json({...db,products:db.products.map(p=>({...p,sold:sold[p.id]||0}))});
   }
   if(path==='/api/orders'&&request.method==='POST'&&role==='customer'){
    await limit(request,DB,'orders',30);if(request.headers.get('x-kst-request')!=='storefront')fail('Invalid request',403);
    const b=await body(request),key=request.headers.get('Idempotency-Key'),{db}=await catalogue(DB);
    const previous=key?await DB.prepare('SELECT payload FROM orders WHERE request_key=?').bind(key).first():null;
    db.orders=previous?[JSON.parse(previous.payload)]:[];
    const result=createOrder(db,b,key);if(result.repeated)return json(publicOrder(result.order));
    const insertion=await DB.prepare('INSERT INTO orders(id,request_key,created,payload) VALUES(?,?,?,?) ON CONFLICT(request_key) DO NOTHING').bind(result.order.id,key||null,result.order.created,JSON.stringify(result.order)).run();
    if(!insertion.meta.changes){const row=await DB.prepare('SELECT payload FROM orders WHERE request_key=?').bind(key).first();const existing=JSON.parse(row.payload);if(existing.requestHash!==result.order.requestHash)fail('This request reference was already used. Refresh and retry.',409);return json(publicOrder(existing));}
    return json(publicOrder(result.order),201);
   }
   if(role!=='admin')fail('Not found',404);
   if(path==='/api/login'&&request.method==='POST'){
    await limit(request,DB,'login',10);const b=await body(request);
    if(!await verifyPassword(b.password,env.ADMIN_PASSWORD_HASH))fail('Incorrect password',401);
    const value=crypto.randomUUID()+crypto.randomUUID();
    await DB.prepare('INSERT INTO sessions(token_hash,expires) VALUES(?,?)').bind(await hash(value),Date.now()+28800000).run();
    return json({ok:true},200,{'Set-Cookie':cookie(value,28800)});
   }
   const session=token(request);if(!session||!await DB.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?').bind(await hash(session),Date.now()).first())fail('Please sign in',401);
   if(path==='/api/admin/image'&&request.method==='POST'){
    if(request.headers.get('x-kst-request')!=='admin')fail('Invalid request',403);
    await limit(request,DB,'image-upload',30);
    return await uploadImage(request,env.PRODUCT_IMAGES);
   }
   if(path==='/api/admin'&&request.method==='GET'){
    const {db}=await catalogue(DB),rows=await DB.prepare('SELECT payload FROM orders ORDER BY created DESC').all();return json({...db,orders:rows.results.map(row=>publicOrder(JSON.parse(row.payload)))});
   }
   const action=path.startsWith('/api/admin/')?path.slice('/api/admin/'.length):'';
   if(!['settings','product','bundle','status','delete','logout'].includes(action))fail('Not found',404);
   if(request.method!=='POST')fail('Use POST for this action',405);
   if(request.headers.get('x-kst-request')!=='admin')fail('Invalid request',403);
   const b=await body(request);
   if(action==='logout'){await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(session)).run();return json({ok:true},200,{'Set-Cookie':cookie('',0)});}
   if(action==='status'){
    if(!['New request','Confirmed','Packed','Out for delivery','Delivered','Cancelled'].includes(b.status))fail('Invalid order status');
    const result=await DB.prepare("UPDATE orders SET payload=json_set(payload,'$.status',?) WHERE id=?").bind(b.status,security.id(b.id)).run();if(!result.meta.changes)fail('Invalid order status');return json({ok:true});
   }
   await updateCatalogue(DB,db=>{
    if(action==='settings')db.settings=validators.settings(b);
    if(action==='product'||action==='bundle'){
     const value=action==='product'?validators.product(b):validators.bundle(b,db.products),list=action==='product'?db.products:db.bundles;
     if(value.id&&!list.some(item=>item.id===value.id))fail('Item no longer exists',404);
     value.id=value.id||crypto.randomUUID();const index=list.findIndex(item=>item.id===value.id);if(index<0)list.push(value);else list[index]=value;
    }
    if(action==='delete'){const id=security.id(b.id);if(b.kind==='product'){if(db.bundles.some(bundle=>bundle.items.some(item=>item.id===id)))fail('Remove this product from bundles first');db.products=db.products.filter(p=>p.id!==id);}else if(b.kind==='bundle')db.bundles=db.bundles.filter(p=>p.id!==id);else fail('Invalid item type');}
   });return json({ok:true});
  }catch(error){const status=error.status||500;return json({error:status===500?'The shop could not complete your request. Please retry.':error.message},status,status===429?{'Retry-After':'600'}:{});}
 },
 async scheduled(event,env){await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires<=?').bind(Date.now()),env.DB.prepare('DELETE FROM request_limits WHERE expires<=?').bind(Date.now())]);}
};
