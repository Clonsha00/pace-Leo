(function(root){
'use strict';
class CaptureGame {
  constructor(interval=100){this.interval=interval;this.reset(null);}
  reset(id){this.id=id;this.next=this.interval;this.encounter=null;this.busy=false;this.generation=(this.generation||0)+1;}
  progress(s){
    if(this.id!==s?.id)this.reset(s?.id??null);
    if(!s||s.state!=='running'||this.encounter||s.meters<this.next)return false;
    this.next=(Math.floor(s.meters/this.interval)+1)*this.interval;
    return this.appear(!!s.demo);
  }
  appear(demo=true){if(this.encounter)return false;this.encounter={born:Date.now(),demo};return true;}
  throw(event,random=Math.random){
    if(!this.encounter||this.busy)return null;
    const peak=event?.peak_g??event?.accel_g,score=event?.motion_score??0.32;
    if(!Number.isFinite(peak)||!Number.isFinite(score)||peak<0||score<0)return null;
    const chance=Math.max(.12,Math.min(.9,.25+Math.min(score,1.2)*.4+Math.max(0,Math.min(peak-1.5,2))*.08));
    this.busy=true;
    return {success:random()<chance,chance,peak,score,generation:this.generation,demo:this.encounter.demo};
  }
  complete(r){if(!r||r.generation!==this.generation||!this.busy)return false;this.busy=false;if(r.success)this.encounter=null;return true;}
  close(){this.encounter=null;this.busy=false;this.generation++;}
}
if(typeof module!=='undefined')module.exports=CaptureGame;else root.CaptureGame=CaptureGame;
})(globalThis);
