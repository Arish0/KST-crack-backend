import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {diwaliGifts}=require('./Admin/Backend/catalog.js');
const offer={id:'diwali-special-prizes-2026',enabled:true,title:'Diwali Special Prizes',terms:'Confirmed customers may enter.',gifts:[{name:'Gift box'}]};

test('selection time may be any valid minute of the day',()=>{
 for(const drawAt of ['2026-11-08T00:00','2026-11-08T12:30','2026-11-08T23:59']){
  assert.equal(diwaliGifts({...offer,drawAt}).drawAt,drawAt);
 }
});

test('selection time and calendar date must be valid',()=>{
 assert.throws(()=>diwaliGifts({...offer,drawAt:'2026-11-08T24:00'}),/valid date and time/);
 assert.throws(()=>diwaliGifts({...offer,drawAt:'2026-11-08T11:60'}),/valid date and time/);
 assert.throws(()=>diwaliGifts({...offer,drawAt:'2026-02-30T09:30'}),/valid date and time/);
});
