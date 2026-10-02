class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(message,status=400)=>{throw new HttpError(status,message);};
function text(value,label,max=100,{optional=false}={}){if(optional&&(value===undefined||value===''))return '';if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))fail(`Invalid ${label}`);return value.trim();}
function number(value,label,min,max,{integer=false}={}){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))fail(`Invalid ${label}`);return value;}
function id(value){return text(value,'item reference',100);}
function guardRequest(req){
 if(req.method!=='POST')return;
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail('Use a JSON request',415);
 if(req.headers['sec-fetch-site']==='cross-site')fail('Cross-site requests are not allowed',403);
 const origin=req.headers.origin;
 if(origin){let expected;try{expected=new URL(process.env.SITE_ORIGIN||`${process.env.NODE_ENV==='production'?'https':'http'}://${req.headers.host}`).origin;}catch{fail('Invalid request origin',403);}if(origin!==expected)fail('Invalid request origin',403);}
}
const limits=new Map();
function rateLimit(req,res,bucket,max,window=600000){
 const key=`${bucket}:${req.socket.remoteAddress}`;let entry=limits.get(key);const now=Date.now();
 if(!entry||entry.expires<now){entry={count:0,expires:now+window};limits.set(key,entry);}
 if(++entry.count>max){res.setHeader('Retry-After',Math.ceil((entry.expires-now)/1000));fail('Too many requests. Please try again shortly.',429);}
 if(limits.size>10000)for(const [k,v] of limits)if(v.expires<now)limits.delete(k);
}
async function readBody(req){
 const max=65536;if(Number(req.headers['content-length'])>max){req.resume();fail('Request is too large',413);}
 let size=0,parts=[];for await(const part of req){size+=part.length;if(size>max)fail('Request is too large',413);parts.push(part);}
 let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('Invalid JSON request');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Request must be a JSON object');return value;
}
function headers(res,scriptHashes=[]){const scripts=["'self'",...scriptHashes.map(hash=>`'sha256-${hash}'`)].join(' ');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','geolocation=(self), camera=(), microphone=()');res.setHeader('Content-Security-Policy',`default-src 'self'; img-src 'self' https:; style-src 'self'; script-src ${scripts}; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);if(process.env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=31536000');}
module.exports={HttpError,fail,text,number,id,guardRequest,rateLimit,readBody,headers};
