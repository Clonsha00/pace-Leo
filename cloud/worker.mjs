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
    if(path==='/api/config')return json({mode:'cloud',requiresToken:true});
    if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
    if(!['/api/last','/api/throw'].includes(path))return json({error:'not found'},404);
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
    if(path!=='/api/throw'||request.method!=='POST')return json({error:'method not allowed'},405);
    // Read a bounded stream, including requests without Content-Length.
    const reader=request.body?.getReader();if(!reader)return json({error:'missing body'},400);
    let parts=[],length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>1024){await reader.cancel();return json({error:'body too large'},413);}parts.push(value);}
    let data;try{const bytes=new Uint8Array(length);let pos=0;for(const p of parts){bytes.set(p,pos);pos+=p.length;}data=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'invalid JSON'},400);}
    if(!data||Array.isArray(data)||data.event!=='throw')return json({error:'event must be throw'},400);
    const metrics={};
    for(const key of ['peak_g','accel_g','motion_score','duration_ms'])if(key in data){if(!Number.isFinite(data[key])||data[key]<0||data[key]>100000)return json({error:'invalid '+key},400);metrics[key]=data[key];}
    metrics.peak_g??=metrics.accel_g;if(!Number.isFinite(metrics.peak_g))return json({error:'missing peak_g'},400);
    const result=await this.ctx.storage.transaction(async tx=>{
      const old=await tx.get('state')||{boot:'cloud-v1',sequence:0,event:null};
      const now=Date.now()/1000;
      if(old.event&&now-old.event.at<.5)return null;
      const state={boot:old.boot,sequence:old.sequence+1,event:{...metrics,type:'throw',at:now}};
      await tx.put('state',state);return state;
    });
    return result?json({ok:true,sequence:result.sequence}):json({error:'too many throws'},429);
  }
}
