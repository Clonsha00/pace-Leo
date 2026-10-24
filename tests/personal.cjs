const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const nodes=new Map();
function element(){return {textContent:'',innerHTML:'',hidden:false,value:'',children:[],classList:{toggle(){}},append(...c){this.children.push(...c);},replaceChildren(){this.children=[];},setAttribute(){},reportValidity(){return true;},close(){},showModal(){}};}
for(const match of html.matchAll(/id="([^"]+)"/g))nodes.set(match[1],element());
for(const [id,value] of [['height','165'],['weight','60'],['age','20'],['mode','walk'],['alias','Leo']])nodes.get(id).value=value;
nodes.get('mode').selectedOptions=[{textContent:'步行 · 依速度估算'}];
const stored=new Map(),timers=[],events={};
const ctx={console,Date,Blob,URL,MoveCore:require('../core.js'),localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},navigator:{},window:{addEventListener(){}},document:{getElementById(id){assert.ok(nodes.has(id),'Missing element: '+id);return nodes.get(id);},body:{classList:{toggle(){}}},querySelectorAll(){return [];},addEventListener(name,fn){events[name]=fn;},createElement:element,createElementNS:element},setInterval(fn){timers.push(fn);return timers.length;},clearInterval(){},setTimeout(){},confirm:()=>true};
vm.createContext(ctx);vm.runInContext(source,ctx);
nodes.get('demo').onclick();
for(let i=0;i<4;i++)timers[1]();
nodes.get('pause').onclick();nodes.get('pause').onclick();nodes.get('finish').onclick();
const records=JSON.parse(stored.get('campus-move-history-v1'));
assert.equal(records.length,1);assert.ok(records[0].points.length>1);assert.ok(records[0].kcal>0);assert.ok(!('target' in records[0]));
assert.ok(!/classroom|cloud-upload|PaceSubmit|clearTarget|updateTarget/.test(source+html));
console.log('Personal app start, demo recording, pause/resume, finish and storage passed.');

// Exercise the live clock, recovery, pause/resume and final persisted supplement.
let clock=100000,callback;
ctx.Date=class extends Date{static now(){return clock;}};
ctx.window.isSecureContext=true;
ctx.navigator.geolocation={watchPosition(fn){callback=fn;return 1;},clearWatch(){}};
nodes.get('profile').onsubmit({preventDefault(){}});
const fix=(lng,accuracy=6)=>callback({coords:{latitude:0,longitude:lng,accuracy},timestamp:clock});
fix(0);
clock=110000;vm.runInContext('render()',ctx);
assert.match(nodes.get('energyNotice').textContent,/補估 0.2 kcal/);
fix(.0001); // The new valid interval replaces the provisional 1 MET fill.
assert.match(nodes.get('energyNotice').textContent,/補估 0.0 kcal/);
clock=120000;fix(.0002,50);vm.runInContext('render()',ctx);
nodes.get('pause').onclick();
const pausedValue=nodes.get('energyNotice').textContent;
clock=180000;vm.runInContext('render()',ctx);
assert.equal(nodes.get('energyNotice').textContent,pausedValue);
nodes.get('pause').onclick();
clock=190000;fix(1); // Waiting for this new segment's first fix is not timed.
clock=200000;fix(1.0001);
nodes.get('finish').onclick();
const saved=JSON.parse(stored.get('campus-move-history-v1'))[0];
assert.equal(saved.energyMethod,'acsm-level-rest-v2');
assert.equal(saved.seconds,30);
assert.equal(saved.energy.seconds,20);
assert.equal(saved.energyEstimate.gapSeconds,10);
assert.ok(Math.abs(saved.energyEstimate.gapKcal-.175)<1e-9);
assert.ok(Math.abs(saved.kcal-saved.energy.kcal-.175)<1e-9);
let csv;
ctx.download=(name,body)=>csv=body;
vm.runInContext('exportCSV(records)',ctx);
assert.match(csv,/保守補估熱量 kcal/);
assert.match(csv,/acsm-level-rest-v2/);
console.log('Live provisional fill, recovery, pause/resume, stored breakdown and CSV passed.');

// Confirm every break source through the actual app event handlers.
clock=300000;nodes.get('profile').onsubmit({preventDefault(){}});fix(0);
clock=310000;nodes.get('pause').onclick();
clock=320000;nodes.get('pause').onclick();fix(.0001);
clock=330000;ctx.document.hidden=true;events.visibilitychange();
clock=340000;ctx.document.hidden=false;nodes.get('pause').onclick();fix(.0002);
clock=350000;vm.runInContext('geoError({code:3})',ctx);
clock=360000;nodes.get('pause').onclick();fix(.0003);
clock=391001;timers[0]();
clock=400000;nodes.get('pause').onclick();fix(.0004);
clock=420000;fix(.0005,50);
clock=435000;fix(.0006);
clock=436000;nodes.get('pause').onclick();
vm.runInContext('pause()',ctx); // Repeated pause must not duplicate an event.
nodes.get('finish').onclick();
const broken=JSON.parse(stored.get('campus-move-history-v1'))[0];
assert.deepEqual(broken.breakEvents.map(e=>e.reason),['manual_pause','page_hidden','geolocation_error','signal_timeout','point_time_gap','manual_pause']);
assert.equal(broken.breakEvents[2].errorCode,3);
assert.equal(broken.breakEvents[4].intervalSeconds,35);
for(let i=0;i<5;i++){
 assert.equal(broken.breakEvents[i].fromPoint,i+1);
 assert.equal(broken.breakEvents[i].toPoint,i+2);
 assert.ok(broken.breakEvents[i].resumedAt>=broken.breakEvents[i].at);
}
assert.equal(broken.breakEvents[5].toPoint,null);
assert.equal(broken.breakEvents[5].resumedAt,null);
assert.equal(broken.points.length,6);
console.log('All break causes, error details, point indexes, resume links and unfinished breaks passed.');
