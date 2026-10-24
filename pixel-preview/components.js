// 可重用的互動元件：進度條、分頁、原生視窗與短訊息。
export function setProgress(element,value,max=100){
  const current=Math.min(max,Math.max(0,value));
  element.setAttribute('aria-valuenow',String(Math.round(current)));
  element.setAttribute('aria-valuemax',String(max));
  element.querySelector('span').style.width=`${current/max*100}%`;
}

export function mountTabs(tablist){
  const tabs=[...tablist.querySelectorAll('[role="tab"]')];
  function select(tab){
    for(const item of tabs){
      const selected=item===tab;
      item.setAttribute('aria-selected',String(selected));
      item.tabIndex=selected?0:-1;
      document.getElementById(item.getAttribute('aria-controls')).hidden=!selected;
    }
  }
  for(const tab of tabs){
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{
      const index=tabs.indexOf(tab);
      let next;
      if(event.key==='ArrowRight')next=(index+1)%tabs.length;
      if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
      if(event.key==='Home')next=0;
      if(event.key==='End')next=tabs.length-1;
      if(next===undefined)return;
      event.preventDefault();select(tabs[next]);tabs[next].focus();
    });
  }
}

export function mountDialog(dialog){
  document.querySelectorAll(`[data-open="${dialog.id}"]`).forEach(button=>button.addEventListener('click',()=>dialog.showModal()));
  dialog.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const bounds=dialog.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
  });
}

export function createNotifier(element){
  let timer;
  return message=>{
    clearTimeout(timer);element.textContent=message;element.hidden=false;
    timer=setTimeout(()=>{element.hidden=true;},3000);
  };
}
