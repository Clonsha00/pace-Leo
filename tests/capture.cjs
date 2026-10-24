const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Game=require('../capture-core.js');
const game=new Game(),s={id:1,state:'running',meters:99,demo:false};
assert.equal(game.progress(s),false);s.meters=100;assert.equal(game.progress(s),true);
assert.equal(game.progress(s),false);
let r=game.throw({peak_g:2,motion_score:.4},()=>0);
assert.equal(r.success,true);assert.equal(game.throw({peak_g:2}),null);
game.close();assert.equal(game.complete(r),false); // stale animation cannot save
s.meters=199;assert.equal(game.progress(s),false);s.meters=200;assert.equal(game.progress(s),true);
r=game.throw({peak_g:2,motion_score:.4},()=>1);game.complete(r);assert.ok(game.encounter);
r=game.throw({peak_g:2,motion_score:.4},()=>0);assert.equal(game.complete(r),true);assert.equal(game.encounter,null);
s.state='paused';s.meters=300;assert.equal(game.progress(s),false);
game.reset(2);assert.equal(game.appear(true),true);assert.equal(game.throw({peak_g:NaN}),null);

// Run actual workout + UI against a controllable clock and synthetic GPS fixes.
const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),nodes=new Map(),stored=new Map(),timeouts=[];
const element=()=>({textContent:'',innerHTML:'',value:'',children:[],hidden:false,disabled:false,open:false,classList:{toggle(){}},append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},setAttribute(){},addEventListener(){},reportValidity(){return true},showModal(){this.open=true},close(){this.open=false}});
for(const m of html.matchAll(/id="([^"]+)"/g))nodes.set(m[1],element());
for(const [id,v] of [['height','165'],['weight','60'],['age','20'],['mode','walk'],['alias','test']])nodes.get(id).value=v;
nodes.get('mode').selectedOptions=[{textContent:'步行'}];
let clock=100000,fix;
const ctx={console,Date:class extends Date{static now(){return clock}},Math:Object.create(Math),CaptureGame:class extends Game{throw(e){return super.throw(e,()=>0)}},MoveCore:require('../core.js'),Blob,URL,AbortController,localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},navigator:{geolocation:{watchPosition(fn){fix=fn;return 1},clearWatch(){}}},document:{hidden:false,getElementById:id=>nodes.get(id),body:{classList:{toggle(){}}},querySelectorAll:()=>[],addEventListener(){},createElement:element,createElementNS:element},setInterval(){return 1},clearInterval(){},setTimeout(fn){timeouts.push(fn);return timeouts.length},clearTimeout(){},confirm:()=>true,addEventListener(){},isSecureContext:true};
ctx.window=ctx;ctx.Math.random=()=>0;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(require.resolve('../capture.js'),'utf8'),ctx);
nodes.get('profile').onsubmit({preventDefault(){}});
for(let i=0;i<4;i++){clock+=20000;fix({coords:{latitude:0,longitude:i*.0004,accuracy:6},timestamp:clock});}
assert.equal(ctx.PaceWorkout.snapshot().state,'paused');assert.ok(nodes.get('captureDialog').open);
const elapsed=nodes.get('elapsed').textContent,kcal=nodes.get('calories').textContent;
clock+=60000;vm.runInContext('render()',ctx);
assert.equal(nodes.get('elapsed').textContent,elapsed);assert.equal(nodes.get('calories').textContent,kcal);
nodes.get('captureThrow').onclick();timeouts.at(-1)();
assert.equal(JSON.parse(stored.get('pace-companions-v1')).length,1);
assert.equal(JSON.parse(stored.get('pace-companions-v1'))[0].demo,true); // manual throw never counts as real
nodes.get('captureClose').onclick();assert.equal(ctx.PaceWorkout.snapshot().state,'paused');
nodes.get('testEncounter').onclick();nodes.get('captureThrow').onclick();timeouts.at(-1)();
assert.equal(JSON.parse(stored.get('pace-companions-v1'))[1].demo,true);
nodes.get('captureClose').onclick();
const before=ctx.PaceWorkout.snapshot().meters,oldHeat=nodes.get('calories').textContent;
nodes.get('testDistance').onclick();
assert.equal(nodes.get('testDistanceTotal').textContent,'20');
assert.equal(ctx.PaceWorkout.snapshot().meters,before);
assert.equal(nodes.get('calories').textContent,oldHeat);
assert.equal(nodes.get('captureDialog').open,false);
for(let i=0;i<3;i++)nodes.get('testDistance').onclick();
assert.equal(nodes.get('testDistanceTotal').textContent,'80');
assert.equal(nodes.get('captureDialog').open,false);
nodes.get('testDistance').onclick();
assert.equal(nodes.get('captureDialog').open,true);
nodes.get('testDistance').onclick(); // duplicate while a creature is present does not add distance
assert.equal(nodes.get('testDistanceTotal').textContent,'100');
nodes.get('captureThrow').onclick();timeouts.at(-1)();
assert.equal(JSON.parse(stored.get('pace-companions-v1'))[2].demo,true);
nodes.get('captureClose').onclick();nodes.get('testDistance').onclick();
assert.equal(nodes.get('testDistanceTotal').textContent,'120');
assert.equal(nodes.get('captureDialog').open,false);
assert.equal(ctx.PaceWorkout.snapshot().meters,before);
console.log('Capture thresholds, retry, stale animation, workout pause/energy freeze and separate collections passed.');
