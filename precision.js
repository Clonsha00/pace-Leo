(function(root){
'use strict';
const Core = typeof module !== 'undefined' ? require('./core.js') : root.MoveCore;
const finite = Number.isFinite;
function usable(p) {
  return p && finite(p.lat) && Math.abs(p.lat)<=90 && finite(p.lng) && Math.abs(p.lng)<=180
    && finite(p.t) && finite(p.accuracy) && p.accuracy>=0;
}
// Preserve delivery order and recording boundaries; do not reuse saved accepted flags.
function replay(input, limit, raw) {
  let last=null, previousGroup, segment=-1, meters=0, accuracyRejected=0, otherRejected=0;
  const points=[];
  for(const p of input) {
    const group=raw ? p.run : (p.segment ?? 0);
    if(group!==previousGroup) { last=null; previousGroup=group; }
    if(p.accuracy>limit) { accuracyRejected++; continue; }
    const result=Core.accept(last,p);
    if(!result.ok) { otherRejected++; continue; }
    if(result.break) segment++;
    meters+=result.meters;
    points.push({...p,segment});
    last=p;
  }
  return {points,count:points.length,meters,segments:segment+1,accuracyRejected,otherRejected};
}
function compare(record) {
  if(!Array.isArray(record.points)||!record.points.length||!record.points.every(usable))
    return {mode:'unavailable',note:'缺少有效座標、時間或定位精度，無法進行精度門檻比較。'};
  const raw=record.rawPoints;
  const hasRaw=record.rawFormatVersion===1 && Array.isArray(raw) && raw.length>0 && raw.length<=200000
    && raw.every(p=>usable(p)&&Number.isInteger(p.run)&&p.run>=0);
  // Native batches have additional timestamp rules; do not claim a full replay here.
  const full=hasRaw && record.source!=='expo-native';
  const input=full ? raw : record.points;
  const before=replay(input,35,full),after=replay(input,20,full);
  const matches=before.count===record.points.length && before.points.every((p,i)=>{
    const saved=record.points[i];
    return p.t===saved.t && p.lat===saved.lat && p.lng===saved.lng
      && (i===0 || (p.segment===before.points[i-1].segment)===(
        (saved.segment??0)===(record.points[i-1].segment??0)));
  }) && finite(record.meters) && Math.abs(before.meters-record.meters)<0.000001;
  const mode=full ? (matches?'complete':'unverified') : 'limited';
  const note=mode==='complete'
    ? '原始點依接收順序重播，保留開始／繼續的區間；35 公尺組的點位、分段與距離已吻合保存紀錄。'
    : mode==='unverified'
      ? '已重播原始點，但 35 公尺組未吻合保存紀錄，可能有版本或資料差異。僅供探索，不能當成已驗證的完整對照。'
      : '僅用已保存的有效點重新篩選，保留原分段；缺少可完整重播的原始資料或不支援此來源。原本被排除的點無法補回，不能當成完整記錄對照。';
  return {mode,note,before,after,inputCount:input.length,baselineMatches:full&&matches,
    countChange:after.count-before.count,distanceChange:after.meters-before.meters,
    distancePercent:before.meters>0?(after.meters-before.meters)/before.meters*100:null};
}
const api={compare};
if(typeof module!=='undefined')module.exports=api;else root.PrecisionExperiment=api;
})(typeof window!=='undefined'?window:globalThis);
