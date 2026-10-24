import assert from 'node:assert/strict';
const base=process.env.PACE_TEST_URL||'http://127.0.0.1:8890';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Local test service only');
const token='a'.repeat(64),clients=[];
async function client(secret=token){
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/socket'),messages=[];clients.push(ws);
  ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.send(JSON.stringify({op:'auth',token:secret}));
  return {ws,messages,send:d=>ws.send(JSON.stringify(d)),async take(predicate){const deadline=Date.now()+6000;while(Date.now()<deadline){const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+predicate.toString());}};
}
async function rpc(c,op,data,id=crypto.randomUUID()){
  const start=performance.now();c.send({op,id,data});const ack=await c.take(x=>x.type==='ack'&&x.id===id);return {...ack,rttMs:Math.round(performance.now()-start)};
}
try{
  const config=await(await fetch(base+'/api/config')).json();assert.equal(config.webSocket,1);
  const bad=await client('invalid');await new Promise(resolve=>bad.ws.addEventListener('close',e=>{assert.equal(e.code,1008);resolve();},{once:true}));assert.equal(bad.messages.some(x=>x.type==='snapshot'),false);
  const unauthenticated=new WebSocket(base.replace('http:','ws:')+'/api/socket');clients.push(unauthenticated);
  let leaked=false;unauthenticated.addEventListener('message',e=>{if(JSON.parse(e.data).type==='snapshot')leaked=true;});
  await new Promise((resolve,reject)=>{unauthenticated.addEventListener('open',resolve,{once:true});unauthenticated.addEventListener('error',reject,{once:true});});
  const deadline=Date.now()+15000;
  // The server must initiate closing. Workerd/Undici may leave the TCP close
  // handshake in CLOSING briefly; that is already a rejected game connection.
  while(unauthenticated.readyState===WebSocket.OPEN&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  assert.notEqual(unauthenticated.readyState,WebSocket.OPEN);assert.equal(leaked,false);
  const phone=await client(),m5=await client();
  for(const c of [phone,m5]){await c.take(x=>x.type==='ready');await c.take(x=>x.type==='snapshot'&&x.reason==='hello');}
  const id=crypto.randomUUID();assert.equal((await rpc(phone,'encounter',{id,active:true})).status,200);
  assert.equal((await m5.take(x=>x.type==='snapshot'&&x.encounterId===id)).active,true);
  await new Promise(r=>setTimeout(r,550));
  const throwId=crypto.randomUUID();const thrown=await rpc(m5,'throw',{event:'throw',encounter_id:id,throw_id:throwId,peak_g:3,motion_score:.4,duration_ms:300});assert.equal(thrown.status,200);
  const event=await phone.take(x=>x.type==='snapshot'&&x.sequence===thrown.sequence&&x.reason==='throw');assert.equal(event.event.throwId,throwId);
  const duplicate=await rpc(m5,'throw',{event:'throw',encounter_id:id,throw_id:throwId,peak_g:3});assert.equal(duplicate.sequence,thrown.sequence);
  const result=await rpc(phone,'result',{sequence:thrown.sequence,success:false});assert.equal(result.status,200);
  assert.equal((await m5.take(x=>x.type==='snapshot'&&x.result?.sequence===thrown.sequence)).result.success,false);
  m5.ws.close();const reconnected=await client();await reconnected.take(x=>x.type==='ready');const snapshot=await reconnected.take(x=>x.reason==='hello');assert.equal(snapshot.sequence,thrown.sequence);assert.equal(snapshot.result.success,false);
  const next=crypto.randomUUID();await rpc(phone,'encounter',{id:next,active:true});
  assert.equal((await rpc(reconnected,'throw',{event:'throw',encounter_id:id,peak_g:3})).status,409);
  // Authenticated legacy HTTP changes still push; external clients cannot suppress them.
  const response=await fetch(base+'/api/encounter',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Relay-No-Push':'1'},body:JSON.stringify({id:next,active:false})});assert.equal(response.status,200);
  await reconnected.take(x=>x.type==='snapshot'&&x.reason==='encounter'&&!x.active);
  console.log('WebSocket auth, immediate events/results, retry deduplication, reconnect snapshot, stale target and legacy push passed. Local RTT:',{throwMs:thrown.rttMs,resultMs:result.rttMs});
}finally{for(const ws of clients)ws.close();}
