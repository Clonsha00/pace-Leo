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
    if(path==='/api/config')return json({mode:'cloud',requiresToken:true,captureFeedback:true});
    if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
    if(!['/api/last','/api/throw','/api/result'].includes(path))return json({error:'not found'},404);
    if(!env.RELAY_TOKEN||env.RELAY_TOKEN.length<32)return json({error:'請先設定 Cloudflare RELAY_TOKEN secret'},503);
    if(!await authorized(request,env.RELAY_TOKEN))return json({error:'連線金鑰不正確'},401);
    return env.THROWS.get(env.THROWS.idFromName('owner-relay-v1')).fetch(request);
  }
};
export class ThrowRelay {
  constructor(ctx){this.ctx=ctx;}
  async fetch(request){
    const path=new URL(request.url).pathname;
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
    if(!['/api/throw','/api/result'].includes(path)||request.method!=='POST')return json({error:'method not allowed'},405);
    // Read a bounded stream, including requests without Content-Length.
    const reader=request.body?.getReader();if(!reader)return json({error:'missing body'},400);
    let parts=[],length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>1024){await reader.cancel();return json({error:'body too large'},413);}parts.push(value);}
    let data;try{const bytes=new Uint8Array(length);let pos=0;for(const p of parts){bytes.set(p,pos);pos+=p.length;}data=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'invalid JSON'},400);}
    if(path==='/api/result'){
      if(!data||!Number.isSafeInteger(data.sequence)||data.sequence<1||typeof data.success!=='boolean')return json({error:'invalid capture result'},400);
      const outcome=await this.ctx.storage.transaction(async tx=>{
        const state=await tx.get('state');
        if(!state||state.sequence!==data.sequence)return 409;
        if(Date.now()/1000-state.event.at>30)return 410;
        if(state.result)return state.result.success===data.success?200:409;
        state.result={sequence:data.sequence,success:data.success,at:Date.now()/1000};
        await tx.put('state',state);return 200;
      });
      return json({ok:outcome===200},outcome);
    }
    if(!data||Array.isArray(data)||data.event!=='throw')return json({error:'event must be throw'},400);
    const metrics={};
    for(const key of ['peak_g','accel_g','motion_score','duration_ms'])if(key in data){if(!Number.isFinite(data[key])||data[key]<0||data[key]>100000)return json({error:'invalid '+key},400);metrics[key]=data[key];}
    metrics.peak_g??=metrics.accel_g;if(!Number.isFinite(metrics.peak_g))return json({error:'missing peak_g'},400);
    const result=await this.ctx.storage.transaction(async tx=>{
      const old=await tx.get('state')||{boot:'cloud-v1',sequence:0,event:null};
      const now=Date.now()/1000;
      if(old.event&&now-old.event.at<.5)return null;
      const state={boot:old.boot,sequence:old.sequence+1,event:{...metrics,type:'throw',at:now},result:null};
      await tx.put('state',state);return state;
    });
    if(!result)return json({error:'too many throws'},429);
    const response=json({ok:true,sequence:result.sequence});response.headers.set('X-Throw-Sequence',String(result.sequence));return response;
  }
}
