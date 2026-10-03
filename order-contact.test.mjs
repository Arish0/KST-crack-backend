import {test} from 'node:test';
import assert from 'node:assert/strict';
import orders from './User/Backend/orders.js';
import seedModule from './Admin/Backend/seed.js';

const request={name:'Customer',mobile:'9876543210',alternateMobile:'9123456780',mode:'pickup',items:[{id:'p1',qty:1}]};
const database=()=>structuredClone(seedModule.seed);

test('order stores both normalized contact numbers for the admin',()=>{
 const result=orders.createOrder(database(),request);
 assert.equal(result.order.mobile,'+919876543210');
 assert.equal(result.order.alternateMobile,'+919123456780');
 assert.equal(orders.publicOrder(result.order).alternateMobile,'+919123456780');
});

test('contact numbers are required, valid, and different',()=>{
 for(const change of [{alternateMobile:''},{mobile:'123'},{alternateMobile:'9876543210'}]){
  assert.throws(()=>orders.createOrder(database(),{...request,...change}));
 }
});

test('country code is accepted and retained in idempotency check',()=>{
 const db=database(),key='contact-order-key-123';
 const first=orders.createOrder(db,{...request,mobile:'+91 98765 43210'},key);
 const repeated=orders.createOrder(db,{...request,mobile:'9876543210'},key);
 assert.equal(repeated.order.id,first.order.id);
 assert.equal(repeated.repeated,true);
 assert.throws(()=>orders.createOrder(db,{...request,alternateMobile:'9000000000'},key));
});
