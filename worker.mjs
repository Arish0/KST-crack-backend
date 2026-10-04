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
 const row=await DB.prepare('SELECT payload,revision FROM catalogue WHERE id=1').first(),db=JSON.parse(row.payload);db.diwaliGifts||=JSON.parse(JSON.stringify(seed.diwaliGifts));return {db,revision:row.revision};
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
function normalizedMobile(value){if(typeof value!=='string')return '';const digits=value.replace(/\D/g,'');return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits.length===10?digits:'';}
function diwaliGiftsPublic(value){return {id:value.id,enabled:value.enabled===true&&Number.isFinite(drawTime(value.drawAt)),title:value.title,titleTa:value.titleTa,drawAt:value.drawAt,terms:value.terms,termsTa:value.termsTa,gifts:value.gifts.map(g=>({name:g.name,nameTa:g.nameTa,description:g.description,descriptionTa:g.descriptionTa})),drawn:Boolean(value.draw)};}
function drawTime(value){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||''))return NaN;return Date.parse(`${value}:00+05:30`);}
function randomBelow(max){const limit=Math.floor(0x100000000/max)*max;const word=new Uint32Array(1);do{crypto.getRandomValues(word);}while(word[0]>=limit);return word[0]%max;}
function token(request){return (request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('kst_session='))?.slice(12)||'';}
const cookie=(value,age)=>`kst_session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
const imagePath=/^\/images\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp))$/;
const imageTypes={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
async function uploadImage(request,env){
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
 if(env.PINATA_JWT){
  const form=new FormData(),filename=`kst-product-${crypto.randomUUID()}.${extension}`;
  form.append('network','public');form.append('file',new Blob([bytes],{type:contentType}),filename);form.append('name',filename);form.append('cid_version','v1');
  let response;try{response=await fetch('https://uploads.pinata.cloud/v3/files',{method:'POST',headers:{Authorization:`Bearer ${env.PINATA_JWT}`},body:form});}catch{fail('Could not connect to IPFS image storage. Please retry.',502);}
  let result;try{result=await response.json();}catch{fail('IPFS image storage returned an invalid response.',502);}
  const cid=result?.data?.cid;if(!response.ok||typeof cid!=='string'||! /^[a-zA-Z0-9]{20,120}$/.test(cid))fail(`IPFS image upload failed (HTTP ${response.status}). Check the Pinata token has file upload permission.`,502);
  let gateway;try{gateway=new URL(env.PINATA_GATEWAY||'https://gateway.pinata.cloud');}catch{fail('IPFS image gateway configuration is invalid.',503);}
  if(gateway.protocol!=='https:'||gateway.username||gateway.password||gateway.search||gateway.hash)fail('IPFS image gateway configuration is invalid.',503);
  const base=gateway.href.replace(/\/$/,'');return json({url:`${base}/ipfs/${cid}`,cid},201);
 }
 const bucket=env.PRODUCT_IMAGES;if(!bucket)fail('Image storage is not configured. Add the PINATA_JWT secret to the kst-backend Worker.',503);
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
    return json({...db,diwaliGifts:diwaliGiftsPublic(db.diwaliGifts),products:db.products.map(p=>({...p,sold:sold[p.id]||0}))});
   }
   if((path==='/api/diwali-prizes/entries'||path==='/api/diwali-prizes/wallet')&&request.method==='POST'&&role==='customer'){
    await limit(request,DB,'diwali-prize-entry',5);if(request.headers.get('x-kst-request')!=='storefront')fail('Invalid request',403);
    const b=await body(request),orderId=security.id(b.orderId),name=security.text(b.name,'customer name',100),mobile=normalizedMobile(b.mobile),{db}=await catalogue(DB),offer=db.diwaliGifts;
    if(path==='/api/diwali-prizes/wallet'){
     const row=await DB.prepare('SELECT payload FROM lucky_draw_entries WHERE campaign_id=? AND order_id=?').bind(offer.id,orderId).first();if(!row)fail('No prize entry was found for that order.',404);
     const entry=JSON.parse(row.payload);if(normalizedMobile(entry.mobile)!==mobile||entry.name.trim().toLocaleLowerCase()!==name.trim().toLocaleLowerCase())fail('Order name and mobile number do not match this entry.',403);
     return json({code:entry.code,created:entry.created,drawAt:offer.drawAt},200);
    }
    const address=security.text(b.address,'gift delivery address',1000);
    const announcedAt=drawTime(offer.drawAt);if(!offer.enabled||!Number.isFinite(announcedAt)||offer.draw||Date.now()>=announcedAt)fail('Entries for this promotion are closed.',410);
    if(!mobile)fail('Enter a valid 10-digit mobile number.');
    const orderRow=await DB.prepare('SELECT payload FROM orders WHERE id=?').bind(orderId).first();if(!orderRow)fail('Order reference not found.',404);
    const order=JSON.parse(orderRow.payload),eligible=['Confirmed','Packed','Out for delivery','Delivered'];
    if(!eligible.includes(order.status))fail('The shop must confirm your purchase before you can enter.');
    if(normalizedMobile(order.mobile)!==mobile||order.name.trim().toLocaleLowerCase()!==name.trim().toLocaleLowerCase())fail('Order name and mobile number must match the confirmed order.',403);
    const existing=await DB.prepare('SELECT payload FROM lucky_draw_entries WHERE order_id=?').bind(orderId).first();if(existing){const entry=JSON.parse(existing.payload);if(normalizedMobile(entry.mobile)!==mobile||entry.name.trim().toLocaleLowerCase()!==name.trim().toLocaleLowerCase())fail('This order already has an entry.',409);return json({code:entry.code,created:entry.created,drawAt:offer.drawAt},200);}
    const code=`KST-${crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase()}`,entry={code,orderId,campaignId:offer.id,created:new Date().toISOString(),name,mobile:order.mobile,address};
    const inserted=await DB.prepare('INSERT INTO lucky_draw_entries(id,campaign_id,order_id,created,payload) VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO NOTHING').bind(code,offer.id,orderId,entry.created,JSON.stringify(entry)).run();
    if(!inserted.meta.changes)fail('This order already has an entry.',409);
    return json({code,created:entry.created,drawAt:offer.drawAt},201);
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
    return await uploadImage(request,env);
   }
   if(path==='/api/admin'&&request.method==='GET'){
    const {db}=await catalogue(DB),rows=await DB.prepare('SELECT payload FROM orders ORDER BY created DESC').all(),entries=await DB.prepare('SELECT payload FROM lucky_draw_entries ORDER BY created DESC').all();return json({...db,orders:rows.results.map(row=>publicOrder(JSON.parse(row.payload))),diwaliPrizeEntries:entries.results.map(row=>JSON.parse(row.payload))});
   }
   const action=path.startsWith('/api/admin/')?path.slice('/api/admin/'.length):'';
   if(!['settings','product','bundle','status','delete','logout','diwali-gifts','diwali-gifts/run'].includes(action))fail('Not found',404);
   if(request.method!=='POST')fail('Use POST for this action',405);
   if(request.headers.get('x-kst-request')!=='admin')fail('Invalid request',403);
   const b=await body(request);
   if(action==='logout'){await DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(session)).run();return json({ok:true},200,{'Set-Cookie':cookie('',0)});}
   if(action==='status'){
    if(!['New request','Confirmed','Packed','Out for delivery','Delivered','Cancelled'].includes(b.status))fail('Invalid order status');
    const result=await DB.prepare("UPDATE orders SET payload=json_set(payload,'$.status',?) WHERE id=?").bind(b.status,security.id(b.id)).run();if(!result.meta.changes)fail('Invalid order status');return json({ok:true});
   }
   if(action==='diwali-gifts/run'){
    const {db}=await catalogue(DB),offer=db.diwaliGifts,announcedAt=drawTime(offer.drawAt),now=Date.now();if(!offer.enabled||!Number.isFinite(announcedAt)||offer.draw)fail('This prize promotion is not open for a new selection.',409);if(now<announcedAt)fail('The announced selection time has not arrived.',409);if(now>=announcedAt+60*60*1000)fail('The one-hour selection window has ended.',409);
    const entries=await DB.prepare('SELECT payload FROM lucky_draw_entries WHERE campaign_id=? ORDER BY created').bind(offer.id).all(),rows=await DB.prepare("SELECT id,payload FROM orders WHERE json_extract(payload,'$.status') IN ('Confirmed','Packed','Out for delivery','Delivered')").all(),ordersById=new Map(rows.results.map(row=>[row.id,JSON.parse(row.payload)])),seen=new Set(),eligible=[];
    for(const row of entries.results){const entry=JSON.parse(row.payload),order=ordersById.get(entry.orderId),phone=normalizedMobile(entry.mobile);if(order&&normalizedMobile(order.mobile)===phone&&!seen.has(phone)){seen.add(phone);eligible.push(entry);}}
    if(!offer.gifts.length)fail('Add prizes before selecting customers.',409);
    if(eligible.length<offer.gifts.length)fail(`At least ${offer.gifts.length} eligible customers are required for the configured prizes.`,409);
    for(let i=eligible.length-1;i>0;i--){const j=randomBelow(i+1);[eligible[i],eligible[j]]=[eligible[j],eligible[i]];}
    const winners=eligible.slice(0,offer.gifts.length).map((entry,index)=>({rank:index+1,prize:offer.gifts[index],code:entry.code,orderId:entry.orderId,name:entry.name,mobile:entry.mobile,address:entry.address})),drawnAt=new Date().toISOString();
    await updateCatalogue(DB,current=>{if(current.diwaliGifts.draw)fail('The selection has already been completed.',409);if(current.diwaliGifts.id!==offer.id)fail('The offer changed. Reload and retry.',409);current.diwaliGifts.draw={drawnAt,winners};});return json({drawnAt,winners});
   }
   await updateCatalogue(DB,db=>{
    if(action==='settings')db.settings=validators.settings(b);
    if(action==='diwali-gifts'){const next=validators.diwaliGifts(b);next.draw=db.diwaliGifts.draw||null;db.diwaliGifts=next;}
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
