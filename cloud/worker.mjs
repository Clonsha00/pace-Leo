const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function authorized(request,secret){
  const provided=request.headers.get('Authorization')||'';
  if(!secret||secret.length<32||!provided.startsWith('Bearer '))return false;
  const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b]=await Promise.all([digest(provided.slice(7)),digest(secret)]);
  let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];return different===0;
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path==='/api/config')return json({mode:'cloud',requiresToken:true,captureFeedback:true,encounterSync:true,deviceStatus:2,webSocket:1});
    if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
    if(!['/api/last','/api/throw','/api/result','/api/encounter','/api/device','/api/socket'].includes(path))return json({error:'not found'},404);
    if(!env.RELAY_TOKEN||env.RELAY_TOKEN.length<32)return json({error:'請先設定 Cloudflare RELAY_TOKEN secret'},503);
    if(path==='/api/socket')return env.THROWS.get(env.THROWS.idFromName('owner-relay-v1')).fetch(request);
    if(!await authorized(request,env.RELAY_TOKEN))return json({error:'連線金鑰不正確'},401);
    const clean=new Request(request);clean.headers.delete('X-Relay-No-Push');
    return env.THROWS.get(env.THROWS.idFromName('owner-relay-v1')).fetch(clean);
  }
};
export class ThrowRelay {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async keyDigest(){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(this.env.RELAY_TOKEN||'')))).join(',');}
  async snapshot(reason='sync'){
    const {state,e}=await this.ctx.storage.transaction(async tx=>({state:await tx.get('state'),e:await tx.get('encounter')}));
    const active=!!e?.active&&Date.now()-e.updated<45000;
    return {type:'snapshot',reason,boot:state?.boot||'cloud-v1',sequence:state?.sequence||0,event:state?.event||null,result:state?.result||null,active,encounterId:active?e.id:'',now:Date.now()/1000};
  }
  async broadcast(reason){
    const sockets=this.ctx.getWebSockets?.()||[];if(!sockets.length)return;
    const digest=await this.keyDigest(),text=JSON.stringify(await this.snapshot(reason));
    for(const ws of sockets){if(ws.readyState!==1)continue;const a=ws.deserializeAttachment();if(a?.authenticated){if(a.digest!==digest){ws.close(1008,'Key changed');continue;}try{ws.send(text);}catch{ws.close(1011,'Reconnect');}}}
  }
  async scheduleAlarm(at){const old=await this.ctx.storage.getAlarm();if(!old||old<=Date.now()||old>at)await this.ctx.storage.setAlarm(at);}
  async alarm(){
    let next=Infinity;
    for(const ws of this.ctx.getWebSockets()){
      if(ws.readyState!==1)continue;const a=ws.deserializeAttachment();if(!a?.authenticated){if(Date.now()-a.created>=10000){ws.send(JSON.stringify({type:'error',status:401}));ws.close(1008,'Authentication required');}else next=Math.min(next,a.created+10000);}
    }
    await this.broadcast('sync');
    const e=await this.ctx.storage.get('encounter');if(e?.active&&e.updated+45000>Date.now())next=Math.min(next,e.updated+45000);
    if(Number.isFinite(next))await this.ctx.storage.setAlarm(next);
  }
  async webSocketMessage(ws,message){
    if(typeof message!=='string'||message.length>2048){ws.close(1009,'Message too large');return;}
    let d;try{d=JSON.parse(message);}catch{ws.close(1008,'Invalid JSON');return;}
    let a=ws.deserializeAttachment();
    if(!a?.authenticated){
      if(!a||Date.now()-a.created>=10000){ws.close(1008,'Authentication expired');return;}
      if(d?.op!=='auth'||typeof d.token!=='string'||d.token.length>256||!await authorized(new Request('https://internal',{headers:{Authorization:'Bearer '+d.token}}),this.env.RELAY_TOKEN)){ws.send(JSON.stringify({type:'error',status:401}));ws.close(1008,'Unauthorized');return;}
      ws.serializeAttachment({authenticated:true,digest:await this.keyDigest(),lastSync:0});
      ws.send(JSON.stringify({type:'ready',protocol:1}));ws.send(JSON.stringify(await this.snapshot('hello')));return;
    }
    if(a.digest!==await this.keyDigest()){ws.close(1008,'Key changed');return;}
    if(d?.op==='sync'){
      if(Date.now()-a.lastSync<250)return;a.lastSync=Date.now();ws.serializeAttachment(a);
      ws.send(JSON.stringify(await this.snapshot('sync')));return;
    }
    if(!['throw','result','encounter'].includes(d?.op)||typeof d.id!=='string'||!/^[-a-zA-Z0-9]{1,48}$/.test(d.id)){ws.close(1008,'Invalid command');return;}
    const response=await this.fetch(new Request('https://internal/api/'+d.op,{method:'POST',headers:{'X-Relay-No-Push':'1'},body:JSON.stringify(d.data)}));
    const payload=await response.json();
    ws.send(JSON.stringify({type:'ack',id:d.id,status:response.status,...payload}));
    if(response.ok)await this.broadcast(d.op);
  }
  webSocketClose(ws){try{ws.close(1000,'Closed');}catch{}}
  webSocketError(ws){try{ws.close(1011,'Reconnect');}catch{}}
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/api/socket'){
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'WebSocket upgrade required'},426);
      if(this.ctx.getWebSockets().filter(ws=>ws.readyState===1).length>=16)return json({error:'too many connections'},429);
      const pair=new WebSocketPair(),[client,server]=Object.values(pair);
      this.ctx.acceptWebSocket(server);server.serializeAttachment({authenticated:false,created:Date.now()});
      await this.scheduleAlarm(Date.now()+10000);
      return new Response(null,{status:101,webSocket:client});
    }
    if(path==='/api/device'&&request.method==='GET'){
      const sequence=Number(new URL(request.url).searchParams.get('sequence')||0);
      if(!Number.isSafeInteger(sequence)||sequence<0)return json({error:'invalid sequence'},400);
      const snapshot=await this.ctx.storage.transaction(async tx=>({state:await tx.get('state'),e:await tx.get('encounter')}));
      const active=!!snapshot.e?.active&&Date.now()-snapshot.e.updated<45000;
      const state=snapshot.state;
      const value=!sequence?'idle':state?.sequence!==sequence?'stale':state.result?(state.result.success?'success':'failure'):'pending';
      return new Response(value,{headers:{'Content-Type':'text/plain','Cache-Control':'no-store','X-Encounter-State':active?'present':'none','X-Encounter-Id':active?snapshot.e.id:'','X-Device-Status':'2'}});
    }
    if(path==='/api/encounter'&&request.method==='GET'){
      const e=await this.ctx.storage.get('encounter');
      return new Response(e?.active&&Date.now()-e.updated<45000?'present':'none',{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
    }
    if(path==='/api/last'&&request.method==='GET'){
      const state=await this.ctx.storage.get('state')||{boot:'cloud-v1',sequence:0,event:null};
      return json({...state,now:Date.now()/1000});
    }
    if(path==='/api/result'&&request.method==='GET'){
      const sequence=Number(new URL(request.url).searchParams.get('sequence'));
      if(!Number.isSafeInteger(sequence)||sequence<1)return json({error:'invalid sequence'},400);
      const state=await this.ctx.storage.get('state');
      const result=state?.sequence!==sequence?'stale':state.result?(state.result.success?'success':'failure'):'pending';
      return new Response(result,{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
    }
    if(!['/api/throw','/api/result','/api/encounter'].includes(path)||request.method!=='POST')return json({error:'method not allowed'},405);
    // Read a bounded stream, including requests without Content-Length.
    const reader=request.body?.getReader();if(!reader)return json({error:'missing body'},400);
    let parts=[],length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>1024){await reader.cancel();return json({error:'body too large'},413);}parts.push(value);}
    let data;try{const bytes=new Uint8Array(length);let pos=0;for(const p of parts){bytes.set(p,pos);pos+=p.length;}data=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'invalid JSON'},400);}
    if(path==='/api/encounter'){
      if(!data||typeof data.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(data.id)||typeof data.active!=='boolean')return json({error:'invalid encounter'},400);
      const code=await this.ctx.storage.transaction(async tx=>{
        const old=await tx.get('encounter');
        if(data.active&&old?.id===data.id&&old.closed)return 409;
        if(!data.active&&old&&old.id!==data.id)return 200;
        await tx.put('encounter',{id:data.id,active:data.active,closed:!data.active,updated:Date.now()});return 200;
      });
      if(code===200){if(this.ctx.storage.getAlarm)await this.scheduleAlarm(Date.now()+45000);if(!request.headers.has('X-Relay-No-Push'))await this.broadcast('encounter');}
      return json({ok:code===200},code);
    }
    if(path==='/api/result'){
      if(!data||!Number.isSafeInteger(data.sequence)||data.sequence<1||typeof data.success!=='boolean')return json({error:'invalid capture result'},400);
      const outcome=await this.ctx.storage.transaction(async tx=>{
        const state=await tx.get('state');
        if(!state||state.sequence!==data.sequence)return 409;
        if(Date.now()/1000-state.event.at>30)return 410;
        if(state.result)return state.result.success===data.success?200:409;
        state.result={sequence:data.sequence,success:data.success,at:Date.now()/1000};
        await tx.put('state',state);
        if(data.success&&state.event.encounterId){
          const e=await tx.get('encounter');
          if(e?.id===state.event.encounterId)await tx.put('encounter',{...e,active:false,closed:true,updated:Date.now()});
        }
        return 200;
      });
      if(outcome===200&&!request.headers.has('X-Relay-No-Push'))await this.broadcast('result');
      return json({ok:outcome===200},outcome);
    }
    if(!data||Array.isArray(data)||data.event!=='throw')return json({error:'event must be throw'},400);
    const metrics={};
    if(data.throw_id!==undefined&&(typeof data.throw_id!=='string'||!/^[-a-zA-Z0-9]{1,48}$/.test(data.throw_id)))return json({error:'invalid throw_id'},400);
    if(data.encounter_id!==undefined&&(typeof data.encounter_id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(data.encounter_id)))return json({error:'invalid encounter_id'},400);
    for(const key of ['peak_g','accel_g','motion_score','duration_ms'])if(key in data){if(!Number.isFinite(data[key])||data[key]<0||data[key]>100000)return json({error:'invalid '+key},400);metrics[key]=data[key];}
    metrics.peak_g??=metrics.accel_g;if(!Number.isFinite(metrics.peak_g))return json({error:'missing peak_g'},400);
    const result=await this.ctx.storage.transaction(async tx=>{
      const old=await tx.get('state')||{boot:'cloud-v1',sequence:0,event:null};
      if(data.encounter_id!==undefined){
        const e=await tx.get('encounter');
        if(!e?.active||e.id!==data.encounter_id||Date.now()-e.updated>=45000)return {conflict:true};
      }
      if(data.throw_id&&old.event?.throwId===data.throw_id)return old;
      const now=Date.now()/1000;
      if(old.event&&now-old.event.at<.5)return null;
      const state={boot:old.boot,sequence:old.sequence+1,event:{...metrics,type:'throw',at:now,...(data.throw_id?{throwId:data.throw_id}:{}),...(data.encounter_id?{encounterId:data.encounter_id}:{})},result:null};
      await tx.put('state',state);return state;
    });
    if(!result)return json({error:'too many throws'},429);
    if(result.conflict)return json({error:'encounter closed or changed'},409);
    if(!request.headers.has('X-Relay-No-Push'))await this.broadcast('throw');
    const response=json({ok:true,sequence:result.sequence});response.headers.set('X-Throw-Sequence',String(result.sequence));return response;
  }
}
