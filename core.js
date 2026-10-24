(function(root){
const rad=n=>n*Math.PI/180;
function distance(a,b){const dlat=rad(b.lat-a.lat),dlon=rad(b.lng-a.lng);const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
function calories(met,kg,seconds){return met*3.5*kg/200*seconds/60;}
function accept(previous,p){if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||!Number.isFinite(p.t)||!Number.isFinite(p.accuracy)||Math.abs(p.lat)>90||Math.abs(p.lng)>180||p.accuracy<0||p.accuracy>35)return {ok:false,reason:'定位精度較差，等待較穩定的訊號（≤ 35 公尺）。'};if(!previous)return {ok:true,meters:0,break:true};const dt=(p.t-previous.t)/1000;if(dt<=0)return {ok:false,reason:'略過重複的定位時間。'};if(dt>30)return {ok:true,meters:0,break:true};const d=distance(previous,p);if(d/dt>8)return {ok:false,reason:'偵測到定位跳動，已略過這個點。'};if(d<Math.max(4,Math.min(12,(p.accuracy+previous.accuracy)*0.25)))return {ok:false,reason:'位置變化很小，已過濾可能的 GPS 飄移。'};return {ok:true,meters:d,break:false};}
// ACSM level-ground equations. Speed: m/min; VO2: mL/kg/min.
// No height/age correction, grade is explicitly assumed to be zero.
function energyInterval(activity,kg,meters,seconds){
  if(!['walk','run'].includes(activity)||!Number.isFinite(kg)||kg<=0||!Number.isFinite(meters)||meters<0||!Number.isFinite(seconds)||seconds<=0||seconds>30)return null;
  const speed=meters/seconds*60,vo2=(activity==='walk'?0.1:0.2)*speed+3.5;
  return {kcal:vo2*kg/200*seconds/60,seconds,met:vo2/3.5,
    outsideRange:activity==='walk'?(speed<50||speed>100):speed<134};
}
function trackEnergy(points,activity,kg){
  const total={kcal:0,seconds:0,outsideRangeSeconds:0};
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if((a.segment||0)!==(b.segment||0))continue;
    const e=energyInterval(activity,kg,distance(a,b),(b.t-a.t)/1000);
    if(e){total.kcal+=e.kcal;total.seconds+=e.seconds;if(e.outsideRange)total.outsideRangeSeconds+=e.seconds;}
  }
  return total;
}
// 僅替仍在運動計時、但未被有效速度涵蓋的時間補上 1 MET。
// 每次重新推算差額；定位恢復後不會重複累加已補過的休息消耗。
function energyWithRest(energy,kg,activeSeconds){
  const gapSeconds=Math.max(0,activeSeconds-energy.seconds);
  const gapKcal=calories(1,kg,gapSeconds);
  return {kcal:energy.kcal+gapKcal,knownKcal:energy.kcal,gapKcal,gapSeconds};
}
const api={distance,calories,accept,energyInterval,trackEnergy,energyWithRest};if(typeof module!=='undefined')module.exports=api;else root.MoveCore=api;
})(typeof window!=='undefined'?window:globalThis);
