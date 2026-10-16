/** Sea Glass Design V4.2: dependency-free progressive enhancement. No duplicate mount listeners. */
(function(global){
  'use strict';
  const mounted = new WeakMap();
  const springs = new WeakMap();
  // A component can be mounted inside another mounted scope. Handle each DOM event once.
  const handled = {click:new WeakSet(), keydown:new WeakSet(), input:new WeakSet(), submit:new WeakSet()};
  let generatedId=0;
  const reduceMotion = () => global.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  const all = (root,selector) => Array.from(root.querySelectorAll(selector));
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  function hexHue(hex){
    if(!/^#[0-9a-f]{6}$/i.test(hex)) return null;
    const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const max=Math.max(...c),min=Math.min(...c),d=max-min;
    if(d<.01) return {hue:215,neutral:true};
    let h=c.indexOf(max)===0?((c[1]-c[2])/d)%6:c.indexOf(max)===1?(c[2]-c[0])/d+2:(c[0]-c[1])/d+4;
    return {hue:Math.round((h*60+360)%360),neutral:false};
  }
  function color(hex){
    const info=hexHue(hex); if(!info) return false;
    const root=document.documentElement;
    root.style.setProperty('--sf-hue',String(info.hue));
    root.dataset.sfNeutral=String(info.neutral);
    all(document,'[data-sf-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sfColor.toLowerCase()===hex.toLowerCase())));
    all(document,'[data-sf-color-input]').forEach(i=>{i.value=hex});
    document.dispatchEvent(new CustomEvent('stillform:color',{detail:{hex,...info}}));
    return true;
  }
  function saturation(n){
    const v=clamp(Number(n)||82,35,100);
    document.documentElement.style.setProperty('--sf-saturation',v+'%');
    all(document,'[data-sf-saturation]').forEach(el=>{if(el.tagName==='INPUT')el.value=v; else el.textContent=v+'%'});
    return v;
  }
  function theme(value){
    const next=value==='dark'?'dark':'light';
    document.documentElement.dataset.sfTheme=next;
    all(document,'[data-sf-theme-button]').forEach(b=>{b.setAttribute('aria-pressed',String(next==='dark'));b.setAttribute('aria-label',next==='dark'?'Switch to light mode':'Switch to dark mode')});
    document.dispatchEvent(new CustomEvent('stillform:theme',{detail:{theme:next}}));
    return next;
  }
  function renderRange(input){
    const min=Number(input.min||0),max=Number(input.max||100),v=Number(input.value);
    input.style.setProperty('--sf-fill',((v-min)/(max-min||1)*100)+'%');
    const key=input.dataset.sfOutput;
    if(key){const output=document.getElementById(key);if(output)output.textContent=v+(input.dataset.sfSuffix||'');}
  }
  function animateIndicator(group,target,initial=false){
    const indicator=group.querySelector('.sf-segment-indicator');if(!indicator||!target)return;
    const g=group.getBoundingClientRect(), t=target.getBoundingClientRect();
    const x=t.left-g.left-group.clientLeft, w=t.width;
    let s=springs.get(group);
    if(!s){s={x,w,vx:0,vw:0,targetX:x,targetW:w,frame:0,last:0};springs.set(group,s)}
    s.targetX=x;s.targetW=w;
    if(initial||reduceMotion()){
      if(s.frame)cancelAnimationFrame(s.frame);
      Object.assign(s,{x,w,vx:0,vw:0,frame:0,last:0});
      indicator.style.transform=`translate3d(${x}px,0,0)`;indicator.style.width=w+'px';return;
    }
    if(s.frame)return;
    const omega=parseFloat(getComputedStyle(group).getPropertyValue('--sf-motion-spring-omega'))||24;
    const tick=time=>{
      const dt=Math.min((time-(s.last||time))/1000,.032);s.last=time;
      // Closed-form critically damped spring: interruption-safe, no overshoot.
      const step=(value,velocity,target)=>{
        const delta=value-target, k=velocity+omega*delta, decay=Math.exp(-omega*dt);
        return [target+(delta+k*dt)*decay,(velocity-omega*k*dt)*decay];
      };
      [s.x,s.vx]=step(s.x,s.vx,s.targetX);[s.w,s.vw]=step(s.w,s.vw,s.targetW);
      indicator.style.transform=`translate3d(${s.x.toFixed(2)}px,0,0)`;
      indicator.style.width=Math.max(0,s.w).toFixed(2)+'px';
      if(Math.abs(s.x-s.targetX)<.08&&Math.abs(s.w-s.targetW)<.08&&Math.abs(s.vx)+Math.abs(s.vw)<.2){s.frame=0;s.last=0;indicator.style.transform=`translate3d(${s.targetX}px,0,0)`;indicator.style.width=s.targetW+'px';}
      else s.frame=requestAnimationFrame(tick);
    };
    s.frame=requestAnimationFrame(tick);
  }
  function selectTab(button,initial=false){
    const group=button.closest('[role="tablist"]');if(!group)return;
    const buttons=all(group,'[role="tab"]');
    const panels=new Map();
    buttons.forEach(el=>{const active=el===button;el.setAttribute('aria-selected',String(active));el.tabIndex=active?0:-1;
      const panelId=el.getAttribute('aria-controls');if(panelId)panels.set(panelId,Boolean(panels.get(panelId))||active);
    });
    panels.forEach((active,id)=>{const panel=document.getElementById(id);if(panel)panel.hidden=!active});
    animateIndicator(group,button,initial);
    if(!initial)group.dispatchEvent(new CustomEvent('stillform:tabchange',{bubbles:true,detail:{value:button.dataset.value||button.textContent.trim()}}));
  }
  let timeout=0, toastDeadline=0, remaining=0;
  function closeToast(){clearTimeout(timeout);const el=document.querySelector('.sf-toast');if(el)el.dataset.open='false';}
  function pauseToast(){if(!toastDeadline)return;remaining=Math.max(800,toastDeadline-Date.now());clearTimeout(timeout);toastDeadline=0;}
  function resumeToast(){if(!remaining)return;const el=document.querySelector('.sf-toast');if(!el||el.dataset.open!=='true')return;toastDeadline=Date.now()+remaining;timeout=setTimeout(closeToast,remaining);remaining=0;}
  function toast(message, options={}){
    const el=document.querySelector('.sf-toast');if(!el)return false;
    const text=el.querySelector('[data-sf-toast-text]')||el;
    text.textContent=String(message);
    clearTimeout(timeout);
    el.dataset.open='true';
    remaining=0;const duration=clamp(Number(options.duration)||4000,1200,10000);
    toastDeadline=Date.now()+duration;timeout=setTimeout(closeToast,duration);
    return true;
  }
  function fieldError(field, message){
    const form=field.closest('form');if(!form)return;
    const current=field.dataset.sfErrorId;
    let el=current&&document.getElementById(current);
    if(!el&&message){
      el=document.createElement('span');el.className='sf-error';el.id='sf-error-'+(++generatedId);el.setAttribute('role','alert');
      (field.closest('label')||field).insertAdjacentElement('afterend',el);
      field.dataset.sfErrorId=el.id;
      const described=field.getAttribute('aria-describedby')||'';
      field.setAttribute('aria-describedby',(described+' '+el.id).trim());
    }
    if(el){el.textContent=message||'';el.hidden=!message;}
    if(message)field.setAttribute('aria-invalid','true');else field.removeAttribute('aria-invalid');
  }
  function errorMessage(field){
    if(field.validity.valueMissing||!String(field.value).trim())return 'Enter '+(field.closest('label')?.querySelector('.sf-label')?.textContent?.trim().toLowerCase()||'a value')+' to continue.';
    if(field.validity.typeMismatch)return 'Enter a valid '+(field.type==='email'?'email address':field.type)+'.';
    if(field.validity.tooLong)return 'Shorten this value to '+field.maxLength+' characters or fewer.';
    if(field.validity.patternMismatch)return 'Check the required format and try again.';
    return 'Check this value and try again.';
  }
  function mount(root=document){
    if(mounted.has(root))return mounted.get(root);
    const controller=new AbortController();const signal=controller.signal;
    const groups=new Set();let ro=null;
    if('ResizeObserver' in global){
      ro=new ResizeObserver(entries=>{for(const entry of entries){const group=entry.target;const active=group.querySelector('[role="tab"][aria-selected="true"]');if(active)animateIndicator(group,active,true);}});
    }
    function refresh(){
      all(root,'[role="tablist"].sf-segmented').forEach(group=>{
        if(!groups.has(group)){
          groups.add(group);ro?.observe(group);
          const buttons=all(group,'[role="tab"]');
          for(const btn of buttons){const panelId=btn.getAttribute('aria-controls');const panel=panelId&&document.getElementById(panelId);
            if(panel){if(!btn.id)btn.id='sf-tab-'+(++generatedId);if(!panel.hasAttribute('aria-labelledby'))panel.setAttribute('aria-labelledby',btn.id);}}
        }
        const b=group.querySelector('[role="tab"][aria-selected="true"]')||group.querySelector('[role="tab"]');if(b)selectTab(b,true);
      });
      all(root,'.sf-range').forEach(renderRange);
      all(root,'form[data-sf-demo-form]').forEach(f=>{f.noValidate=true;});
    }
    refresh();
    root.addEventListener('click',e=>{
      const btn=e.target.closest('button,[data-sf-open],[data-sf-close]');if(!btn||!root.contains(btn)||handled.click.has(e))return;
      handled.click.add(e);
      if(btn.matches(':disabled,[aria-disabled="true"]'))return;
      if(btn.matches('[role="tab"]')){selectTab(btn);return;}
      if(btn.matches('[role="switch"].sf-switch')){btn.setAttribute('aria-checked',String(btn.getAttribute('aria-checked')!=='true'));btn.dispatchEvent(new CustomEvent('stillform:switchchange',{bubbles:true,detail:{checked:btn.getAttribute('aria-checked')==='true'}}));return;}
      if(btn.hasAttribute('data-sf-theme-button')){theme(document.documentElement.dataset.sfTheme==='dark'?'light':'dark');return;}
      if(btn.hasAttribute('data-sf-color')){color(btn.dataset.sfColor);return;}
      if(btn.hasAttribute('data-sf-open')){const dlg=document.getElementById(btn.dataset.sfOpen);if(dlg?.showModal&&!dlg.open)dlg.showModal();return;}
      if(btn.hasAttribute('data-sf-close')){document.getElementById(btn.dataset.sfClose)?.close();return;}
      if(btn.hasAttribute('data-sf-notify')){toast(btn.dataset.sfNotify);return;}
      if(btn.hasAttribute('data-sf-loading')){
        if(btn.disabled)return;
        btn.disabled=true;btn.setAttribute('aria-busy','true');
        const old=btn.textContent;btn.textContent='Working…';
        setTimeout(()=>{if(!btn.isConnected)return;btn.disabled=false;btn.removeAttribute('aria-busy');btn.textContent=old;toast('Operation completed.');},1050);
      }
    },{signal});
    root.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&document.querySelector('.sf-toast[data-open="true"]'))closeToast();
      const button=e.target.closest('[role="tab"]');if(!button||handled.keydown.has(e))return;
      const group=button.closest('[role="tablist"]');if(!group||!root.contains(group))return;
      const bs=all(group,'[role="tab"]');const i=bs.indexOf(button);let next=i;
      const rtl=getComputedStyle(group).direction==='rtl';
      if(e.key==='ArrowRight')next=(i+(rtl?-1:1)+bs.length)%bs.length;
      else if(e.key==='ArrowLeft')next=(i+(rtl?1:-1)+bs.length)%bs.length;
      else if(e.key==='Home')next=0;else if(e.key==='End')next=bs.length-1;else return;
      handled.keydown.add(e);e.preventDefault();bs[next].focus();selectTab(bs[next]);
    },{signal});
    root.addEventListener('input',e=>{
      const input=e.target;if(handled.input.has(e))return;
      if(!input.matches('.sf-range,[data-sf-color-input],[data-sf-saturation-input],.sf-input,.sf-textarea'))return;
      handled.input.add(e);
      if(input.matches('.sf-range'))renderRange(input);
      if(input.matches('[data-sf-color-input]'))color(input.value);
      if(input.matches('[data-sf-saturation-input]'))saturation(input.value);
      if(input.dataset.sfErrorId){if(input.checkValidity()&&String(input.value).trim())fieldError(input,'');}
    },{signal});
    root.addEventListener('submit',e=>{
      const form=e.target;
      if(!form.matches('[data-sf-demo-form]')||handled.submit.has(e))return;
      handled.submit.add(e);e.preventDefault();
      const fields=all(form,'[required]');let bad=null;
      fields.forEach(field=>{const invalid=!field.checkValidity()||!String(field.value).trim();fieldError(field,invalid?errorMessage(field):'');if(invalid&&!bad)bad=field});
      if(bad){bad.focus();return;}
      const title=form.dataset.sfDemoForm || 'Saved successfully';
      toast(title);const dlg=form.closest('dialog');if(dlg)dlg.close();form.reset();
    },{signal});
    all(root,'dialog.sf-dialog').forEach(dlg=>{dlg.addEventListener('click',e=>{if(e.target===dlg){const b=dlg.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dlg.close()}},{signal})});
    const toastEl=document.querySelector('.sf-toast');
    if(toastEl){toastEl.addEventListener('mouseenter',pauseToast,{signal});toastEl.addEventListener('mouseleave',resumeToast,{signal});toastEl.addEventListener('focusin',pauseToast,{signal});toastEl.addEventListener('focusout',resumeToast,{signal});}
    const floating=all(root,'[data-sf-scroll-glass]');
    if(floating.length){
      let queued=false;
      const onScroll=()=>{
        if(queued)return;queued=true;
        requestAnimationFrame(()=>{
          queued=false;
          const active=window.scrollY>20;
          floating.forEach(el=>{if(el.isConnected)el.dataset.sfScrolled=String(active)});
        });
      };
      onScroll();
      global.addEventListener('scroll',onScroll,{passive:true,signal});
    }
    const instance={destroy(){controller.abort();if(ro)ro.disconnect();groups.forEach(g=>{const s=springs.get(g);if(s?.frame)cancelAnimationFrame(s.frame);springs.delete(g)});mounted.delete(root)},refresh};
    mounted.set(root,instance);return instance;
  }
  global.SeaGlass=Object.freeze({mount,toast,color,theme,saturation,selectTab,renderRange,moveIndicator:animateIndicator,version:'4.2.0-rc.1'});
  global.Stillform=global.SeaGlass; // Historical alias for existing integrations.
})(window);
