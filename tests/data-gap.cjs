const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const functions=['markDataGap','renderDataGap','receive','run'].map(name=>source.match(new RegExp('function '+name+'\\([^\\n]*?(?=\\r?\\n(?:function |\\$|async |const |let ))','s'))?.[0]);
// Extract single-line entry points and the multi-line warning renderer.
const code=['recordBreak','completeBreaks','markDataGap','receive','run'].map(name=>source.split('\n').find(line=>line.startsWith('function '+name+'('))).join('\n')+'\n'+source.slice(source.indexOf('function renderDataGap'),source.indexOf('function message'));
let now=1000;
const notice={hidden:true,textContent:''};
const ctx={Date:{now:()=>now},session:{demo:false,state:'running',points:[],meters:0,runStart:0},last:null,lastSignal:0,lastValidSignal:0,lines:[],map:null,MoveCore:require('../core.js'),$:()=>notice,displayPosition(){},message(){},setTrack(){},render(){},navigator:{geolocation:{watchPosition(){return 1;}}},holdScreen(){}};
vm.createContext(ctx);vm.runInContext(code,ctx);
const receive=p=>{ctx.p=p;vm.runInContext('receive(p)',ctx);};
const point={lat:24.18,lng:120.65,t:1000,accuracy:6};
receive(point);
assert.equal(ctx.session.hasDataGap,undefined);
now=32000;receive({...point,t:32000,lng:120.651});
assert.equal(ctx.session.hasDataGap,true);
vm.runInContext('renderDataGap()',ctx);
assert.equal(notice.hidden,false);
assert.match(notice.textContent,/可能低估/);
// Manual pause/resume resets the previous point: it must not be labeled a gap.
ctx.session.hasDataGap=false;ctx.last=null;now=100000;
receive({...point,t:100000});assert.equal(ctx.session.hasDataGap,false);
// Run the actual periodic callback with no recent valid point.
const timer=source.split('\n').find(line=>line.startsWith('setInterval(()=>'));
ctx.setInterval=fn=>ctx.tick=fn;ctx.pause=()=>{ctx.session.state='paused';};
vm.runInContext(timer,ctx);
now=131001;ctx.lastSignal=now;ctx.tick();
assert.equal(ctx.session.hasDataGap,true);
assert.equal(ctx.session.state,'running');
// Waiting for the first fix and demonstration mode do not trigger warnings.
ctx.session.hasDataGap=false;ctx.last=null;ctx.tick();assert.equal(ctx.session.hasDataGap,false);
ctx.session.demo=true;ctx.last=point;ctx.tick();assert.equal(ctx.session.hasDataGap,false);
console.log('Gap warning checks passed.');

// Every received fix survives filtering with its decision and comparison data.
ctx.session.demo=false;ctx.session.state='running';ctx.last=null;
receive({...point,t:200000});
const before=ctx.session.points.length;
receive({...point,t:201000,accuracy:50});
assert.equal(ctx.session.points.length,before);
const raw=ctx.session.rawPoints.at(-1);
assert.equal(raw.accepted,false);
assert.match(raw.reason,/精度/);
assert.equal(raw.referencePoint,before-1);
assert.equal(raw.intervalSeconds,1);
assert.equal(raw.speedMps,0);
receive({...point,t:202000,lng:121});
assert.match(ctx.session.rawPoints.at(-1).reason,/跳動/);
receive({...point,t:203000});
assert.match(ctx.session.rawPoints.at(-1).reason,/飄移/);
assert.ok(ctx.session.rawPoints.some(p=>p.accepted));
assert.equal(JSON.parse(JSON.stringify(ctx.session)).rawPoints.length,ctx.session.rawPoints.length);
console.log('Raw point retention and exclusion checks passed.');
