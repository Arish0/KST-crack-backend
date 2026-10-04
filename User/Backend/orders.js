const crypto=require('node:crypto');
const {quote,distance}=require('./shop');
const {text,number,fail}=require('../../Admin/Backend/security');
function mobile(value,label){
 if(typeof value!=='string')fail(`Invalid ${label}`);
 const compact=value.replace(/[\s-]/g,'');
 const local=compact.startsWith('+91')?compact.slice(3):compact.length===12&&compact.startsWith('91')?compact.slice(2):compact;
 if(!/^[6-9]\d{9}$/.test(local))fail(`Enter a valid 10-digit ${label}`);
 return `+91${local}`;
}
function createOrder(db,b,key){
 const name=text(b.name,'customer name'),mobileNumber=mobile(b.mobile,'mobile number'),alternateMobile=mobile(b.alternateMobile,'alternative contact number');if(mobileNumber===alternateMobile)fail('Use a different alternative contact number');if(!['delivery','pickup'].includes(b.mode))fail('Choose delivery or pickup');
 const normalized={name,mobile:mobileNumber,alternateMobile,mode:b.mode,items:b.items,address:b.mode==='delivery'?text(b.address,'delivery address',1000):'',lat:b.mode==='delivery'?number(b.lat,'delivery latitude',-90,90):null,lng:b.mode==='delivery'?number(b.lng,'delivery longitude',-180,180):null};
 if(key&&!/^[a-zA-Z0-9-]{16,100}$/.test(key))fail('Invalid request reference');
 const requestHash=crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 if(key){const previous=db.orders.find(o=>o.requestKey===key);if(previous){if(previous.requestHash!==requestHash)fail('This request reference was already used. Refresh and retry.',409);return{order:previous,repeated:true};}}
 let pricing;try{pricing=quote(db,b.items);}catch(error){fail(error.message);}let km=null;
 if(b.mode==='delivery'){if(db.settings.hubLat===null||db.settings.hubLng===null)fail('The shop has not configured its delivery hub. Pickup is available.');km=distance(db.settings.hubLat,db.settings.hubLng,normalized.lat,normalized.lng);if(km>db.settings.radius)fail('Location is outside our delivery area');}
 const fee=b.mode==='delivery'?db.settings.deliveryFee:0;
 const order={id:'KST-'+crypto.randomBytes(8).toString('hex').toUpperCase(),created:new Date().toISOString(),...normalized,items:pricing.items,distance:km,...pricing,deliveryFee:fee,total:pricing.quoteRequired?null:Math.round((pricing.subtotal+fee)*100)/100,status:'New request',...(key?{requestKey:key,requestHash}:{})};
 db.orders.unshift(order);return{order,repeated:false};
}
function publicOrder(order){const {requestKey,requestHash,...safe}=order;return safe;}
module.exports={createOrder,publicOrder};
