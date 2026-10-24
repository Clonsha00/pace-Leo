import {setProgress,mountTabs,mountDialog,createNotifier} from './components.js';

// 範本僅操作記憶體中的展示狀態，不讀寫正式紀錄與位置權限。
const $=id=>document.getElementById(id);
const notify=createNotifier($('toast'));
const state={mode:'walk',meters:1280,seconds:1024,weight:60,running:false};
let timer=null,interactions=0;
const formatTime=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;

function render(){
  const km=state.meters/1000;
  const speed=state.seconds>0?state.meters/state.seconds*3.6:0;
  const rest=3.5*state.weight/200*state.seconds/60;
  const net=(state.mode==='walk'?.1:.2)*state.meters*state.weight/200;
  $('distance').textContent=km.toFixed(2);
  $('elapsed').textContent=formatTime(state.seconds);
  $('speed').textContent=speed.toFixed(1);
  $('energyValue').textContent=Math.round(rest+net);
  $('totalKcal').textContent=(rest+net).toFixed(1);
  $('restKcal').textContent=rest.toFixed(1);
  $('netKcal').textContent=net.toFixed(1);
  $('reportDistance').replaceChildren(document.createTextNode(km.toFixed(2)+' '),Object.assign(document.createElement('small'),{textContent:'km'}));
  $('reportMode').textContent=state.mode==='walk'?'輕鬆步行':'自在跑步';
  $('distanceProgressLabel').textContent=`${km.toFixed(2)} / 2.00 km`;
  setProgress($('distanceProgress').parentElement,km/2*100);
  $('startLabel').textContent=state.running?'暫停模擬運動':'開始模擬運動';
  $('sessionStatus').textContent=state.running?'模擬記錄中':'準備出發';
  $('sessionHint').textContent=state.running?'模擬時間加速中，每秒展示 20 秒的變化。':'按下開始，看看像素介面如何回應。';
  document.body.classList.toggle('is-running',state.running);
  document.querySelectorAll('[data-mode]').forEach(button=>{
    const selected=button.dataset.mode===state.mode;
    button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
  });
}

function stop(){clearInterval(timer);timer=null;state.running=false;}
function reset(){stop();state.meters=1280;state.seconds=state.mode==='walk'?1024:512;render();}
$('startDemo').addEventListener('click',()=>{
  if(state.running){stop();render();$('sessionStatus').textContent='已暫停';$('sessionHint').textContent='休息一下。再次開始，就接著這段路繼續。';return;}
  state.running=true;
  timer=setInterval(()=>{state.seconds+=20;state.meters+=state.mode==='walk'?25:50;render();},1000);
  render();
});
$('resetDemo').addEventListener('click',()=>{reset();notify('示範數據已重設。');});
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
  if(state.mode===button.dataset.mode)return;
  state.mode=button.dataset.mode;reset();notify(`已切換${state.mode==='walk'?'步行':'跑步'}，示範數據已重設。`);
}));
$('settingsForm').addEventListener('submit',event=>{
  event.preventDefault();const name=$('nickname').value.trim();
  if(!name){$('nickname').setCustomValidity('請輸入暱稱');$('nickname').reportValidity();return;}
  state.weight=Number($('weight').value);$('headerName').textContent=name;
  $('settings').close();render();notify('設定已套用，只保留在這個範本頁面。');
});
$('nickname').addEventListener('input',()=>$('nickname').setCustomValidity(''));
$('sampleAction').addEventListener('click',()=>{
  interactions=Math.min(5,interactions+1);
  $('sampleCount').textContent=`${interactions} / 5`;
  setProgress($('sampleProgress').parentElement,interactions,5);
  notify(interactions===5?'元件展示完成！可以繼續試試其他按鈕。':`收到！這是第 ${interactions} 次元件互動。`);
});
document.querySelectorAll('.main-menu a').forEach(link=>link.addEventListener('click',()=>{
  document.querySelectorAll('.main-menu a').forEach(item=>item.classList.toggle('current',item===link));
}));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.running){stop();render();$('sessionStatus').textContent='已暫停';}});
document.querySelectorAll('[role="tablist"]').forEach(mountTabs);
document.querySelectorAll('dialog').forEach(mountDialog);
render();
