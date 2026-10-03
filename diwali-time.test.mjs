import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {diwaliGifts}=require('./Admin/Backend/catalog.js');
const offer={id:'diwali-special-prizes-2026',enabled:true,title:'Diwali Special Prizes',terms:'Confirmed customers may enter.',gifts:[{name:'Gift box'}]};

test('selection time can start within the 09:00–10:00 IST window',()=>{
 assert.equal(diwaliGifts({...offer,drawAt:'2026-11-08T09:00'}).drawAt,'2026-11-08T09:00');
 assert.equal(diwaliGifts({...offer,drawAt:'2026-11-08T09:59'}).drawAt,'2026-11-08T09:59');
});

test('selection time and calendar date must be valid',()=>{
 assert.throws(()=>diwaliGifts({...offer,drawAt:'2026-11-08T10:00'}),/09:00 to 09:59/);
 assert.throws(()=>diwaliGifts({...offer,drawAt:'2026-02-30T09:30'}),/09:00 to 09:59/);
});
