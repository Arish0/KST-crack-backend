const {text,number,id,fail}=require('./security');
function settings(s){
 const result={name:text(s.name,'shop name'),banner:text(s.banner,'headline',200,{optional:true}),radius:number(s.radius,'radius',1,100),deliveryFee:number(s.deliveryFee,'delivery charge',0,100000)};
 for(const k of ['phone','whatsapp']){result[k]=text(s[k],k,16,{optional:true});if(result[k]&&!/^\+?\d{10,15}$/.test(result[k]))fail('Use a full international phone number');}
 result.hubLat=s.hubLat===null?null:number(s.hubLat,'hub latitude',-90,90);result.hubLng=s.hubLng===null?null:number(s.hubLng,'hub longitude',-180,180);
 if((result.hubLat===null)!==(result.hubLng===null))fail('Enter both hub coordinates');return result;
}
function product(p){
 const result={name:text(p.name,'product name'),category:text(p.category,'category',60),unit:text(p.unit,'pack size',100,{optional:true})||'Pack',price:number(p.price,'price',.01,10000000),discount:number(p.discount,'discount',0,100),stock:number(p.stock,'stock',0,100000,{integer:true}),featured:p.featured===true,art:['spark','pot','wheel','sky','gift'].includes(p.art)?p.art:'gift',color:'#edaccc',image:text(p.image,'image URL',2000,{optional:true})};
 if(p.id)result.id=id(p.id);
 if(result.image){try{const url=new URL(result.image);if(url.protocol!=='https:'||url.username||url.password)fail('Image URL must use HTTPS without credentials');}catch{fail('Invalid HTTPS image URL');}}return result;
}
function bundle(b,products){const result={name:text(b.name,'bundle name'),description:text(b.description,'description',500,{optional:true}),price:number(b.price,'bundle price',.01,10000000),stock:number(b.stock,'bundle stock',0,100000,{integer:true})};if(b.id)result.id=id(b.id);if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)fail('Select products for this bundle');const seen=new Set();result.items=b.items.map(i=>{if(!i||typeof i!=='object')fail('Invalid bundle item');const item={id:id(i.id),qty:number(i.qty,'bundle quantity',1,100,{integer:true})};if(!products.some(p=>p.id===item.id)||seen.has(item.id))fail('Invalid or duplicate bundle product');seen.add(item.id);return item;});return result;}
module.exports={settings,product,bundle};
