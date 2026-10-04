const {text,number,id,fail}=require('./security');
function settings(s){
 const result={name:text(s.name,'shop name'),banner:text(s.banner,'headline',200,{optional:true}),radius:number(s.radius,'radius',1,100),deliveryFee:number(s.deliveryFee,'delivery charge',0,100000)};
 for(const k of ['phone','whatsapp']){result[k]=text(s[k],k,16,{optional:true});if(result[k]&&!/^\+?\d{10,15}$/.test(result[k]))fail('Use a full international phone number');}
 result.hubLat=s.hubLat===null?null:number(s.hubLat,'hub latitude',-90,90);result.hubLng=s.hubLng===null?null:number(s.hubLng,'hub longitude',-180,180);
 if((result.hubLat===null)!==(result.hubLng===null))fail('Enter both hub coordinates');return result;
}
function product(p){
 const result={name:text(p.name,'product name'),category:text(p.category,'category',60),unit:text(p.unit,'pack size',100,{optional:true})||'Pack',packQuantity:number(p.packQuantity??0,'pack quantity',0,100000,{integer:true}),description:text(p.description,'description',500,{optional:true}),price:number(p.price??0,'price',0,10000000),discount:number(p.discount??0,'discount',0,100),stock:number(p.stock,'stock',0,100000,{integer:true}),featured:p.featured===true,art:['spark','pot','wheel','sky','gift'].includes(p.art)?p.art:'gift',color:'#edaccc',image:text(p.image,'image URL',2000,{optional:true}),image2:text(p.image2,'secondary image URL',2000,{optional:true}),video:text(p.video,'product video URL',2000,{optional:true})};
 if(p.id)result.id=id(p.id);
 for(const media of [result.image,result.image2,result.video])if(media&&!/^\/images\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|mp4|webm)$/.test(media)){try{const url=new URL(media);if(url.protocol!=='https:'||url.username||url.password)fail('Media URLs must use HTTPS without credentials');}catch{fail('Invalid HTTPS media URL');}}return result;
}
function bundle(b,products){const result={name:text(b.name,'bundle name'),description:text(b.description,'description',500,{optional:true}),price:number(b.price??0,'bundle price',0,10000000),stock:number(b.stock,'bundle stock',0,100000,{integer:true})};if(b.id)result.id=id(b.id);if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)fail('Select products for this bundle');const seen=new Set();result.items=b.items.map(i=>{if(!i||typeof i!=='object')fail('Invalid bundle item');const item={id:id(i.id),qty:number(i.qty,'bundle quantity',1,100,{integer:true})};if(!products.some(p=>p.id===item.id)||seen.has(item.id))fail('Invalid or duplicate bundle product');seen.add(item.id);return item;});return result;}
function diwaliGifts(offer){
 const result={id:text(offer.id,'offer id',60),enabled:offer.enabled===true,title:text(offer.title,'offer title',100),titleTa:text(offer.titleTa,'Tamil offer title',100,{optional:true}),drawAt:text(offer.drawAt,'draw date and time',16,{optional:true}),terms:text(offer.terms,'promotion terms',1500),termsTa:text(offer.termsTa,'Tamil promotion terms',1500,{optional:true})};
 if(result.drawAt){
  const date=result.drawAt.slice(0,10),midnight=Date.parse(`${date}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(result.drawAt)||!Number.isFinite(midnight)||new Date(midnight).toISOString().slice(0,10)!==date)fail('Choose a valid date and time in IST');
 }
 if(!Array.isArray(offer.gifts)||offer.gifts.length>20)fail('Add up to 20 Diwali prizes');
 result.gifts=offer.gifts.map((gift,i)=>({name:text(gift.name,`gift ${i+1}`,100,{optional:true}),nameTa:text(gift.nameTa,`gift ${i+1} Tamil name`,100,{optional:true}),description:text(gift.description,`gift ${i+1} description`,300,{optional:true}),descriptionTa:text(gift.descriptionTa,`gift ${i+1} Tamil description`,300,{optional:true})})).filter(gift=>gift.name);
 result.draw=offer.draw&&typeof offer.draw==='object'?offer.draw:null;
 if(result.enabled&&!result.drawAt)fail('Set the draw date and time before enabling entries');
 if(result.enabled&&!result.gifts.length)fail('Add at least one prize before enabling entries');
 return result;
}
module.exports={settings,product,bundle,diwaliGifts};
