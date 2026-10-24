'use strict';
(()=>{
  const el=id=>document.getElementById(id),game=new CaptureGame(),key='pace-companions-v1';
  const distanceTest=new CaptureGame();let testMeters=0;
  let collection=[],enabled=false,controller=null,connectionEpoch=null,sequence=null,cloudMode=false;
  try{el('relayToken').value=sessionStorage.getItem('pace-relay-token')||'';}catch{}
  try{const v=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(v))collection=v.filter(x=>x&&typeof x.demo==='boolean');}catch{}
  function renderCollection(){el('companionCount').textContent=String(collection.filter(x=>!x.demo).length);el('demoCompanionCount').textContent=String(collection.filter(x=>x.demo).length);}
  function show(){
    // Capturing always pauses, including demo; resuming is an explicit user action.
    window.PaceWorkout.pauseForCapture();
    const active=window.PaceWorkout.snapshot();
    el('captureResult').textContent=active&&active.state!=='finished'?'小夥伴出現！運動已暫停，捕捉後請自行按繼續。':'測試小夥伴出現！可用 M5 投球，捕捉結果列入測試收藏。';
    el('captureSprite').textContent='🐾';el('captureThrow').disabled=false;el('captureClose').disabled=false;
    el('captureDialog').showModal();
    el('captureSignal').textContent=el('m5Status').textContent;
  }
  window.PaceCapture={progress(s){if(game.progress(s))show();}};
  function close(){game.close();el('captureDialog').close();}
  el('captureClose').onclick=close;
  el('captureDialog').addEventListener('cancel',e=>{e.preventDefault();close();});
  el('testEncounter').onclick=()=>{
    const s=window.PaceWorkout.snapshot();
    if(game.id!==s?.id)game.reset(s?.id??null);
    // Manual testing never adds to the real GPS collection.
    if(game.appear(true))show();
  };
  el('testDistance').onclick=()=>{
    if(game.encounter||game.busy)return;
    const s=window.PaceWorkout.snapshot();
    if(game.id!==s?.id)game.reset(s?.id??null);
    testMeters+=20;
    el('testDistanceTotal').textContent=String(testMeters);
    // Exercise the distance threshold without mutating the real workout or its next encounter.
    if(distanceTest.progress({id:'distance-test',state:'running',meters:testMeters,demo:true})){
      distanceTest.close();
      if(game.appear(true))show();
    }
  };
  function onThrow(event,simulated=false,eventSequence=null){
    const result=game.throw(event);if(!result)return;
    const feedbackToken=cloudMode&&!simulated&&Number.isSafeInteger(eventSequence)?el('relayToken').value.trim():null;
    if(simulated)result.demo=true;
    el('captureThrow').disabled=true;el('captureClose').disabled=true;el('captureSprite').textContent='🔴';
    el('captureResult').textContent=`投球中… 峰值 ${result.peak.toFixed(2)}g，捕捉率 ${Math.round(result.chance*100)}%（遊戲示範規則）`;
    setTimeout(()=>{
      if(!game.complete(result))return;
      if(feedbackToken)reportResult(eventSequence,result.success,feedbackToken);
      el('captureClose').disabled=false;
      if(result.success){
        collection.push({species:'trail-buddy',name:'步道小夥伴',at:new Date().toISOString(),demo:result.demo});
        let saved=true;try{localStorage.setItem(key,JSON.stringify(collection));}catch{saved=false;}
        renderCollection();el('captureSprite').textContent='✨';
        el('captureResult').textContent=`捕捉成功！${result.demo?'已加入測試收藏。':'已加入小夥伴收藏。'}${saved?'':'儲存失敗，收藏暫留本頁。'}關閉後按繼續運動。`;
      }else{el('captureSprite').textContent='🐾';el('captureResult').textContent='小夥伴掙脫了，再用 M5 投一次，或關閉後繼續運動。';el('captureThrow').disabled=false;}
    },700);
  }
  async function reportResult(eventSequence,success,token){
    for(let attempt=0;attempt<3;attempt++){
      try{
        const r=await fetch('/api/result',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sequence:eventSequence,success}),signal:AbortSignal.timeout(4000)});
        if(r.ok)return;
        if(r.status<500)break;
      }catch{}
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500));
    }
    status('捕捉結果已在手機顯示，但 M5 燈號回報失敗；請以手機結果為準。');
  }
  el('captureThrow').onclick=()=>onThrow({peak_g:2,motion_score:.45},true);
  function status(s){el('m5Status').textContent=s;el('captureSignal').textContent=s;}
  el('m5Connect').onclick=async()=>{
    if(!enabled){
      el('m5Connect').disabled=true;
      try{
        const r=await fetch('/api/config',{cache:'no-store',signal:AbortSignal.timeout(5000)});
        cloudMode=r.ok&&(await r.json()).mode==='cloud';
      }catch{cloudMode=false;}
      finally{el('m5Connect').disabled=false;}
      if(cloudMode&&el('relayToken').value.trim().length<32){status('請先填入 Cloudflare 設定的連線金鑰（至少 32 字元）。');return;}
      try{sessionStorage.setItem('pace-relay-token',el('relayToken').value.trim());}catch{}
    }
    enabled=!enabled;sequence=null;connectionEpoch=null;controller?.abort();
    el('m5Connect').textContent=enabled?'中斷 M5 接收':'連接 M5 接收服務';
    status(enabled?(cloudMode?'正在連接雲端接收服務…':'正在連接電腦接收服務…'):'尚未連接；可先用模擬投球測試。');
  };
  document.addEventListener('visibilitychange',()=>{sequence=null;connectionEpoch=null;controller?.abort();});
  async function poll(){
    if(enabled&&!document.hidden){
      controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),2500);
      try{
        const headers=cloudMode?{Authorization:'Bearer '+el('relayToken').value.trim()}:{};
        const r=await fetch('/api/last',{cache:'no-store',headers,signal:controller.signal});
        if(!r.ok){if(r.status===401){enabled=false;el('m5Connect').textContent='連接 M5 接收服務';status('連線金鑰不正確，請確認與 Cloudflare RELAY_TOKEN 相同。');return;}throw Error('接收服務 HTTP '+r.status);}
        const d=await r.json();if(!Number.isInteger(d.sequence)||typeof d.boot!=='string')throw Error('請使用整合版接收服務');
        if(!enabled)return;
        if(connectionEpoch!==d.boot||sequence===null||d.sequence<sequence){connectionEpoch=d.boot;sequence=d.sequence;status(`已連接，事件序號 ${sequence}；現在可用 M5 投球。`);return;}
        if(d.sequence>sequence){
          sequence=d.sequence;
          // Compare server timestamps with each other, not a cached phone/server clock offset.
          const age=(d.now-d.event?.at)*1000;
          const encounterAge=game.encounter?Date.now()-game.encounter.born:0;
          if(!game.encounter)status(`收到第 ${sequence} 球，目前沒有待捕捉角色。`);
          else if(game.busy)status(`收到第 ${sequence} 球，前一球仍在判定中。`);
          else if(!Number.isFinite(age)||age<0||age>5000||age>encounterAge+150)status(`收到第 ${sequence} 球，但事件已過期或早於角色出現，請重新投球。`);
          else {status(`收到第 ${sequence} 球，正在捕捉。`);onThrow(d.event,false,sequence);}
        }
      }catch(e){if(enabled){sequence=null;connectionEpoch=null;status('接收中斷：'+e.message+'；重連後請再投一次。');}}
      finally{clearTimeout(timeout);controller=null;setTimeout(poll,750);}
      return;
    }
    setTimeout(poll,750);
  }
  renderCollection();poll();
})();
