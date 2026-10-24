const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../core.js'),Experiment=require('../precision.js');
const p=(x,t,accuracy=10,run=1)=>({lat:0,lng:x/111195,t:t*1000,accuracy,run});
const raw=[p(0,0),{...p(20,10,30),lat:.00015},p(40,20),p(60,30,50),p(80,40),p(80,40),p(1000,50,10,2),p(1020,60,10,2),p(1050,100,10,2)];
// Reproduce the recording path independently using the unmodified production filter.
let last=null,run,segment=-1,meters=0;
const points=[];
for(const point of raw){
  if(run!==point.run){last=null;run=point.run;}
  const accepted=Core.accept(last,point);
  if(!accepted.ok)continue;
  if(accepted.break)segment++;
  points.push({...point,segment});meters+=accepted.meters;last=point;
}
const record={points,meters,rawPoints:raw,rawFormatVersion:1};
const original=JSON.stringify(record);
let result=Experiment.compare(record);
assert.equal(result.mode,'complete');
assert.equal(result.baselineMatches,true);
assert.equal(result.before.count,7);
assert.equal(result.after.count,6);
assert.equal(result.before.segments,3);
assert.equal(result.after.segments,3);
assert.equal(result.before.accuracyRejected,1);
assert.equal(result.after.accuracyRejected,2);
assert.equal(result.before.otherRejected,1); // Duplicate timestamp.
assert.ok(result.distanceChange<0); // The less accurate detour is excluded.
assert.ok(result.before.meters<200); // No bridge over pause or 40-second gap.
assert.equal(JSON.stringify(record),original);
assert.equal(Experiment.compare({...record,meters:meters+1}).mode,'unverified');
assert.equal(Experiment.compare({...record,points:points.map((x,i)=>i===1?{...x,t:x.t+1}:x)}).mode,'unverified');
assert.equal(Experiment.compare({...record,source:'expo-native'}).mode,'limited');
assert.equal(Experiment.compare({...record,rawPoints:undefined}).mode,'limited');
assert.equal(Experiment.compare({...record,rawPoints:[]}).mode,'limited');
assert.equal(Experiment.compare({...record,rawFormatVersion:2}).mode,'limited');
assert.equal(Experiment.compare({points:[{lat:0,lng:0}],meters:0}).mode,'unavailable');
const allBad={points:[p(0,0,30)],meters:0};
result=Experiment.compare(allBad);
assert.equal(result.after.count,0);assert.equal(result.after.segments,0);assert.equal(result.distancePercent,null);
// UI state is cleared when a subsequent import cannot support the experiment.
const nodes=new Map(),element=()=>({children:[],textContent:'',append(...xs){this.children.push(...xs);},replaceChildren(){this.children=[];},addEventListener(){}});
const document={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,addEventListener(){}};
const ctx={document,MoveCore:Core,PrecisionExperiment:Experiment};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require.resolve('../review.js'),'utf8').replace("  $('file').addEventListener","  globalThis.showPrecision=showPrecision;\n  $('file').addEventListener"),ctx);
ctx.showPrecision(record);assert.equal(nodes.get('precisionRows').children.length,2);
assert.match(nodes.get('precisionDelta').textContent,/完整重播/);
ctx.showPrecision({...record,rawPoints:undefined});assert.match(nodes.get('precisionDelta').textContent,/有限比較/);
ctx.showPrecision({points:[{}]});assert.equal(nodes.get('precisionRows').children.length,0);assert.equal(nodes.get('precisionDelta').textContent,'');
console.log('Precision experiment: verified replay, thresholds, boundaries, legacy limits, no mutation and import reset passed.');
