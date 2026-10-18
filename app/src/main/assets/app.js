'use strict';
(() => {
  const C=ReaderCore, $=s=>document.querySelector(s), main=$('#main');
  const state={settings:C.normalizeSettings({}),username:'',metered:true,systemDark:true,appVersion:'',page:'feed',sort:'hot',feed:[],more:false,stack:[],sequence:0,accountEpoch:0,sessionNeedsReset:false};
  const pending=new Map();let port=null,requestCounter=0,readyResolve,toastTimer,downloadTimer,lastFocus,refreshDownloads,pauseObserver,feedLoad=0,feedBusy=false,dropdownAnchor,imageViewer,sheetGeneration=0,searchGeneration=0,restoreCleanup,activeListCleanup;
  const ready=new Promise(resolve=>readyResolve=resolve);
  function el(tag,attrs={},...children){const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){
    if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='text')n.textContent=v;else if(v!==undefined&&v!==null&&v!==false)n.setAttribute(k,v===true?'':v);
  }for(const child of children.flat())if(child!==null&&child!==undefined)n.append(child instanceof Node?child:document.createTextNode(String(child)));return n;}
  function releaseMedia(target){target.querySelectorAll('.truth').forEach(card=>truthObserver.unobserve(card));target.querySelectorAll('video,audio').forEach(media=>{pauseObserver?.unobserve(media);media.pause();});target.querySelectorAll('iframe').forEach(frame=>{embedObserver.unobserve(frame);const entry=embeddedPlayers.get(frame);if(entry)clearInterval(entry.timer);embeddedPlayers.delete(frame);});}
  function replace(target,...children){releaseMedia(target);target.replaceChildren(...children.filter(c=>c!==null&&c!==undefined));}
  const button=(text,handler,cls='')=>el('button',{type:'button',class:cls,onclick:handler},text);
  const text=(tag,value,cls='')=>el(tag,{class:cls},value);
  const iconPaths={
    up:'M12 3 3 12h5v9h8v-9h5Z',down:'M12 21 3 12h5V3h8v9h5Z',
    home:'m3 10 9-7 9 7v11h-6v-7H9v7H3Z',search:'M20 20 15.5 15.5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
    plus:'M12 4v16M4 12h16',inbox:'M4 4h16v16H4ZM4 13h5l2 3h2l2-3h5',
    user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
    settings:'M4 7h16M4 17h16M8 4v6M16 14v6',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    back:'m14 5-7 7 7 7',close:'m6 6 12 12M6 18 18 6',comment:'M4 4h16v12H9l-5 4Z',
    bookmark:'M6 3h12v18l-6-4-6 4Z',share:'M12 15V3m-4 4 4-4 4 4M5 12v9h14v-9',
    edit:'m4 16-1 5 5-1L20 8l-4-4ZM14 6l4 4M3 21h18',
    more:'M5 12h.01M12 12h.01M19 12h.01',refresh:'M20 11a8 8 0 1 0-2 6M20 4v7h-7',
    grid:'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',list:'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
    play:'m9 5 11 7-11 7Z',chevron:'m6 9 6 6 6-6',check:'m4 12 5 5L20 6',sort:'M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4',eye:'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'
  };
  function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const[k,v]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'glyph'}))svg.setAttribute(k,v);const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',iconPaths[name]||iconPaths.more);svg.append(path);return svg;}
  function iconButton(name,label,handler,cls='icon'){const b=button('',handler,cls);b.setAttribute('aria-label',label);b.title=label;b.append(icon(name));return b;}
  for(const [id,name]of Object.entries({back:'back',downloads:'download',settings:'settings','sheet-close':'close'}))$('#'+id).replaceChildren(icon(name));
  for(const n of document.querySelectorAll('#nav button'))n.prepend(icon({feed:'home',search:'search',compose:'plus',inbox:'inbox',profile:'user'}[n.dataset.page]));
  function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
  function syncModalScroll(){document.documentElement.classList.toggle('modal-open',!!document.querySelector('dialog[open]'));}
  function sheet(title,content,layout='dialog'){++sheetGeneration;imageViewer?.destroy();imageViewer=null;lastFocus=document.activeElement;$('#sheet').classList.toggle('image-dialog',layout==='image');$('#sheet').classList.toggle('compact-dialog',layout==='dialog');$('#sheet-title').textContent=title;$('#sheet-title').title=title;replace($('#sheet-body'),content);if(!$('#sheet').open)$('#sheet').showModal();syncModalScroll();return sheetGeneration;}
  function closeSheet(){++sheetGeneration;imageViewer?.destroy();imageViewer=null;releaseMedia($('#sheet-body'));$('#sheet-body').replaceChildren();$('#sheet').close();syncModalScroll();lastFocus?.focus?.();}
  function closeDropdown(){if($('#dropdown').open)$('#dropdown').close();$('#dropdown').replaceChildren();dropdownAnchor?.focus?.();dropdownAnchor=null;syncModalScroll();}
  function openDropdown(title,content,anchor,rows){
    closeDropdown();dropdownAnchor=anchor;
    const menu=$('#dropdown'),rect=anchor.getBoundingClientRect(),width=Math.min(240,innerWidth-16);
    const below=innerHeight-rect.bottom-8,above=rect.top-8,down=below>=Math.min(rows*45+8,260)||below>=above;
    menu.setAttribute('aria-label',title);menu.style.width=width+'px';menu.style.maxHeight=Math.max(44,down?below:above)+'px';menu.style.left=Math.max(8,Math.min(innerWidth-width-8,rect.left))+'px';menu.style.top='0px';menu.append(content);menu.showModal();syncModalScroll();
    menu.style.top=(down?rect.bottom+4:Math.max(8,rect.top-menu.getBoundingClientRect().height-4))+'px';
  }
  function choices(title,items,current,onSelect,anchor=document.activeElement){
    const list=el('div',{class:'choice-list',role:'group','aria-label':title});
    for(const[value,label]of items){const b=button('',()=>{closeDropdown();onSelect(value);},'choice-row');b.setAttribute('aria-pressed',String(String(value)===String(current)));b.append(text('span',label),String(value)===String(current)?icon('check'):el('span',{class:'choice-placeholder'}));list.append(b);}
    list.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const rows=[...list.querySelectorAll('button')],index=rows.indexOf(document.activeElement);e.preventDefault();rows[e.key==='Home'?0:e.key==='End'?rows.length-1:(index+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();});
    openDropdown(title,list,anchor,items.length);
  }
  $('#dropdown').addEventListener('cancel',e=>{e.preventDefault();closeDropdown();});
  $('#dropdown').addEventListener('click',e=>{if(e.target===$('#dropdown'))closeDropdown();});
  window.addEventListener('resize',closeDropdown);
  $('#sheet-close').onclick=closeSheet;
  $('#sheet').addEventListener('cancel',e=>{e.preventDefault();closeSheet();});
  $('#sheet').addEventListener('click',e=>{if(e.target===$('#sheet'))closeSheet();});
  function receive(message){if(message.event){if(message.event==='notice')showNotice(message.data);if(message.event==='account')accountChanged(message.data.username);if(message.event==='systemTheme'){state.systemDark=message.data;theme();}if(message.event==='metered'){state.metered=message.data;if(message.data)document.querySelectorAll('video[autoplay],audio[autoplay]').forEach(m=>{m.pause();m.autoplay=false;});}return;}
    const job=pending.get(message.id);if(!job)return;pending.delete(message.id);clearTimeout(job.timer);message.error?job.reject(new Error(message.error)):job.resolve(message.result);}
  // Provider iframes must never replace the native channel. It is established
  // before bootstrap; no remote embed exists until after that handshake.
  window.addEventListener('message',e=>{if(port||(e.source&&e.source!==window))return;if(e.data==='reader-connect'&&e.ports.length){port=e.ports[0];port.onmessage=e=>receive(JSON.parse(e.data));port.start();readyResolve();}});
  if(window.ReaderPreview)readyResolve();
  async function rpc(op,args={}){await ready;if(window.ReaderPreview)return window.ReaderPreview(op,args);return new Promise((resolve,reject)=>{
      const id=String(++requestCounter),timer=setTimeout(()=>{pending.delete(id);reject(new Error('The request timed out. For posting, check your profile before retrying.'));},['login','website','export','extract','upload'].includes(op)?600000:65000);
    const payload=JSON.stringify({id,op,args});if(payload.length>1024*1024){clearTimeout(timer);reject(new Error('This request is too large. Keep unsaved text open and reduce its size before retrying.'));return;}pending.set(id,{resolve,reject,timer});try{port.postMessage(payload);}catch(error){pending.delete(id);clearTimeout(timer);reject(error);}});}
  const api=(path,params={},method='GET',expectedUser=state.username)=>rpc('api',{path,params,method,expectedUser});
  async function action(fn,node){if(node?.disabled)return;try{if(node)node.disabled=true;return await fn();}catch(e){toast(e.message);}finally{if(node?.isConnected)node.disabled=false;}}
  const ownKey=(name,user=state.username)=>`reader:${user.toLowerCase()||'guest'}:${name}`;
  const store=C.createStore(localStorage),publishing=new Set();
  const readLocal=(key,fallback)=>store.read(key,fallback);
  function storageStatus(){
    const warning=$('#storage-warning');warning.hidden=store.pending().length===0;
    document.querySelectorAll('[data-draft-key]').forEach(n=>{n.textContent=store.pending().includes(n.dataset.draftKey)?'Not saved on this device — keep the app open.':(n.dataset.savedLabel||'Draft saved · Review before publishing');});
  }
  function remember(key,value){const saved=store.write(key,value);storageStatus();return saved;}
  function durable(key,value){const previous=readLocal(key,null);if(!remember(key,value)){if(value===null&&previous!==null)remember(key,previous);throw new Error('Couldn’t save the publishing record. Keep the app open and retry saving before continuing.');}}
  function clearRevision(key,revision){if(store.revision(key)===revision)remember(key,null);}
  function retryStorage(){store.retry();storageStatus();}
  $('#storage-retry').onclick=retryStorage;
  async function copyRecovery(){const value=JSON.stringify(store.recovery(),null,2);if(value.length>500000)throw new Error('Too much unsaved data to copy at once. Keep the app open and use Retry save after making storage available.');await rpc('copyText',{text:value});toast('Unsaved data copied.');}
  $('#storage-copy').onclick=()=>action(copyRecovery);
  window.addEventListener('beforeunload',e=>{if(store.pending().length){e.preventDefault();e.returnValue='';}});
  const ownsSheet=token=>$('#sheet').open&&sheetGeneration===token;
  function accountContext(){const user=state.username,epoch=state.accountEpoch;return {user,current:()=>user===state.username&&epoch===state.accountEpoch};}
  function showNotice(message){$('#recovery-notice').hidden=!message;$('#recovery-message').textContent=message||'';}
  $('#recovery-dismiss').onclick=()=>action(async()=>{await rpc('dismissNotice');showNotice('');});
  // One device preference, independent of account, for direct media and YouTube.
  const storedSound=readLocal('reader:sound',{}),sound={volume:typeof storedSound.volume==='number'?Math.max(0,Math.min(1,storedSound.volume)):1,muted:storedSound.muted===true};
  const directSound=new WeakMap(),embeddedPlayers=new Map();
  const embedObserver=new IntersectionObserver(entries=>{for(const item of entries){const entry=embeddedPlayers.get(item.target);if(!entry)continue;entry.visible=item.isIntersecting&&item.intersectionRatio>=.1;if(!entry.visible&&!document.fullscreenElement){if(entry.kind==='youtube')youtubeCommand(item.target,'pauseVideo');else entry.stop();}}},{threshold:.1});
  function applySound(player){directSound.set(player,{...sound});player.volume=sound.volume;player.muted=sound.muted;}
  function youtubeCommand(frame,func,args=[]){frame.contentWindow?.postMessage(JSON.stringify({event:'command',func,args}),'https://www.youtube-nocookie.com');}
  function applyYouTubeSound(frame,entry){entry.expected={...sound};youtubeCommand(frame,'setVolume',[sound.volume*100]);youtubeCommand(frame,sound.muted?'mute':'unMute');}
  function saveSound(volume,muted,source){
    if(!Number.isFinite(volume)||typeof muted!=='boolean')return;
    sound.volume=Math.max(0,Math.min(1,volume));sound.muted=muted;remember('reader:sound',sound);
    document.querySelectorAll('video,audio').forEach(player=>{if(player!==source)applySound(player);});
    for(const[frame,entry]of embeddedPlayers)if(frame!==source&&entry.kind==='youtube'&&entry.ready)applyYouTubeSound(frame,entry);
  }
  function bindSound(player){
    applySound(player);
    player.addEventListener('volumechange',()=>{const before=directSound.get(player);if(before?.volume===player.volume&&before?.muted===player.muted)return;directSound.set(player,{volume:player.volume,muted:player.muted});saveSound(player.volume,player.muted,player);});
  }
  function bindYouTube(frame){
    const entry={kind:'youtube',ready:false,expected:null,timer:null};embeddedPlayers.set(frame,entry);
    frame.addEventListener('load',()=>{let attempts=0;clearInterval(entry.timer);const listen=()=>{if(!frame.isConnected||++attempts>30){clearInterval(entry.timer);return;}frame.contentWindow?.postMessage(JSON.stringify({event:'listening',id:'reader-youtube'}),'https://www.youtube-nocookie.com');};listen();entry.timer=setInterval(listen,500);});
  }
  window.addEventListener('message',e=>{
    if(e.origin!=='https://www.youtube-nocookie.com')return;
    const pair=[...embeddedPlayers].find(([frame,entry])=>entry.kind==='youtube'&&frame.contentWindow===e.source);if(!pair)return;
    let message;try{message=typeof e.data==='string'?JSON.parse(e.data):e.data;}catch{return;}if(!message||typeof message!=='object')return;
    const[frame,entry]=pair,info=message.info;
    if(!entry.ready&&(message.event==='onReady'||message.event==='initialDelivery'||message.event==='infoDelivery')){entry.ready=true;clearInterval(entry.timer);applyYouTubeSound(frame,entry);if(entry.visible===false)youtubeCommand(frame,'pauseVideo');return;}
    if(info?.playerState===1){if(entry.visible===false&&!document.fullscreenElement)youtubeCommand(frame,'pauseVideo');else{document.querySelectorAll('video,audio').forEach(media=>media.pause());pauseEmbeds(frame);}}
    if(!entry.ready||!info||typeof info.volume!=='number'||typeof info.muted!=='boolean')return;
    const volume=info.volume/100,muted=info.muted;
    if(entry.expected){if(Math.abs(volume-entry.expected.volume)<.005&&muted===entry.expected.muted)entry.expected=null;return;}
    if(Math.abs(sound.volume-volume)>.005||sound.muted!==muted)saveSound(volume,muted,frame);
  });
  function theme(){const dark=state.settings.theme==='dark'||state.settings.theme==='system'&&state.systemDark;document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.setProperty('--font',state.settings.textSize+'px');}
  async function saveSettings(){state.settings=C.normalizeSettings(state.settings);theme();await rpc('settings',state.settings);}
  function accountChanged(username){state.accountEpoch++;state.sessionNeedsReset=false;state.username=username||'';state.feed=[];state.searchModel=null;state.profileModel=null;state.stack=[];state.sequence++;navigate('feed',false);}
  function navigation(page,push=true){activeListCleanup?.();activeListCleanup=null;restoreCleanup?.();restoreCleanup=null;closeDropdown();feedObserver.disconnect();feedBusy=false;feedLoad++;if(push)state.stack.push({page:state.page,scroll:window.scrollY,post:state.post,query:state.query,threadFocus:state.threadFocus,anchor:scrollAnchor()});state.sequence++;state.page=page;clearTimeout(downloadTimer);downloadTimer=null;refreshDownloads=null;
    $('#back').hidden=!state.stack.length;$('#subtitle').textContent=page==='feed'?'TheDonald':({compose:'New post',thread:'Discussion',profile:state.username||'Your account',downloads:'Downloads',saved:'Saved posts',settings:'Your preferences',inbox:'Inbox',search:'Search'}[page]||'TheDonald');
    document.querySelectorAll('#nav button').forEach(n=>{if(n.dataset.page===page)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});window.scrollTo(0,0);}
  function navigate(page,push=true){navigation(page,push);return ({feed:feedPage,search:searchPage,compose:composePage,profile:profilePage,settings:settingsPage,downloads:downloadsPage,saved:savedPage,inbox:inboxPage,thread:()=>threadPage(state.post)}[page]||feedPage)();}
  function back(){if($('#dropdown').open){closeDropdown();return;}if($('#sheet').open){closeSheet();return;}const previous=state.stack.pop();if(previous){state.post=previous.post;state.query=previous.query;state.threadFocus=previous.threadFocus;state.returning=previous.page==='thread';const task=navigate(previous.page,false),seq=state.sequence;Promise.resolve(task).then(()=>{if(seq===state.sequence)restoreScroll(previous,seq);});}
    else if(state.page!=='feed')navigate('feed',false);else if(store.pending().length)sheet('Changes are not saved',el('div',{},text('p','Keep the app open until saving succeeds, or copy the unsaved data before leaving.'),button('Retry saving',retryStorage),button('Copy unsaved data',()=>action(copyRecovery))));else rpc('exit').catch(()=>{});}
  function scrollAnchor(){const nodes=[...main.querySelectorAll('[data-comment-id],[data-post-id]')],node=nodes.find(n=>n.getBoundingClientRect().bottom>54);return node?{kind:node.hasAttribute('data-comment-id')?'data-comment-id':'data-post-id',id:node.getAttribute(node.hasAttribute('data-comment-id')?'data-comment-id':'data-post-id'),top:node.getBoundingClientRect().top}:null;}
  function restoreScroll(previous,seq){
    let applying=false,frame=0;
    const apply=()=>{frame=0;if(applying||seq!==state.sequence)return;applying=true;const anchor=previous.anchor,node=anchor&&[...main.querySelectorAll('['+anchor.kind+']')].find(n=>n.getAttribute(anchor.kind)===anchor.id);window.scrollTo(0,node?scrollY+node.getBoundingClientRect().top-anchor.top:previous.scroll);applying=false;};
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(apply);},observer=new ResizeObserver(schedule);observer.observe(main);main.addEventListener('load',schedule,true);
    const stop=()=>{observer.disconnect();main.removeEventListener('load',schedule,true);for(const name of ['pointerdown','wheel','keydown'])window.removeEventListener(name,stop,true);cancelAnimationFrame(frame);};
    for(const name of ['pointerdown','wheel','keydown'])window.addEventListener(name,stop,{capture:true,once:true});restoreCleanup=stop;requestAnimationFrame(apply);
  }
  window.ReaderBack=back;$('#back').onclick=back;$('#downloads').onclick=()=>navigate('downloads');$('#settings').onclick=()=>navigate('settings');
  document.querySelectorAll('#nav button').forEach(n=>n.onclick=()=>{if(n.dataset.page!==state.page){state.stack=[];navigate(n.dataset.page,false);}});
  function loading(message='Loading…'){replace(main,text('div',message,'spinner'));}
  function empty(title,detail,extra){replace(main,el('div',{class:'empty'},text('h1',title),text('p',detail),extra));}
  function failure(error,retry){empty('Couldn’t load this page',error.message,button('Retry',retry,'secondary'));}
  function cachedNotice(result){return result.cached?text('div',`Saved copy · last updated ${new Date(result.savedAt).toLocaleString()}. Reconnect and refresh for current information.`,'notice'):null;}
  function ago(time){const minutes=Math.max(0,Math.floor((Date.now()-Number(time))/60000));return minutes<60?minutes+'m':minutes<1440?Math.floor(minutes/60)+'h':Math.floor(minutes/1440)+'d';}
  function plain(value){const doc=new DOMParser().parseFromString(String(value||''),'text/html');return doc.body.textContent||'';}
  function postText(p){return p.raw_content||plain(p.content);}
  function richContent(html,fallback,cls='content'){
    const box=el('div',{class:cls+' rich'}),attachments=new Map();
    const allowed=new Set(['P','BR','STRONG','B','EM','I','U','S','UL','OL','LI','BLOCKQUOTE','CODE','PRE','A','H1','H2','H3','HR']);
    const skipped=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','TEMPLATE','FORM','INPUT','BUTTON']);
    function link(url,label){
      const safe=C.safeURL(url);if(!safe)return document.createTextNode(label);
      const media=C.media({link:safe});
      if(['video','audio'].includes(media.kind)&&(attachments.has(safe)||attachments.size<4)){
        attachments.set(safe,media);if(label.trim()===url)return document.createTextNode('');
      }
      const a=el('a',{href:safe,rel:'noopener noreferrer'},label);a.onclick=e=>{e.preventDefault();action(()=>rpc('external',{url:safe}));};return a;
    }
    function copyText(value,parent,linkify=true){
      if(!linkify){parent.append(document.createTextNode(value));return;}
      const pattern=/https:\/\/[^\s<>"']+/gi;let start=0;
      for(const match of value.matchAll(pattern)){
        let url=match[0].replace(/[.,!?;:]+$/,'');
        while(url.endsWith(')')&&(url.match(/\)/g)||[]).length>(url.match(/\(/g)||[]).length)url=url.slice(0,-1);
        parent.append(document.createTextNode(value.slice(start,match.index)),link(url,url));start=match.index+url.length;
      }
      parent.append(document.createTextNode(value.slice(start)));
    }
    function copy(node,parent,depth,linkify=true){
      if(depth>30)return;if(node.nodeType===Node.TEXT_NODE){copyText(node.textContent,parent,linkify);return;}
      if(node.nodeType!==Node.ELEMENT_NODE||skipped.has(node.tagName))return;
      if(node.tagName==='A'){parent.append(linkify?link(node.getAttribute('href')||'',node.textContent):document.createTextNode(node.textContent));return;}
      let target=parent;if(allowed.has(node.tagName)){target=el(node.tagName.toLowerCase());parent.append(target);}
      for(const child of node.childNodes)copy(child,target,depth+1,linkify&&!['CODE','PRE'].includes(node.tagName));
      if(target!==parent&&node.tagName==='P'&&!target.textContent.trim()&&!target.children.length)target.remove();
    }
    if(html){const parsed=new DOMParser().parseFromString(String(html),'text/html');for(const child of parsed.body.childNodes)copy(child,box,0);}
    else{box.classList.add('plain-text');copyText(String(fallback||''),box);}
    if(!html&&attachments.size){box.normalize();for(const node of box.childNodes)if(node.nodeType===Node.TEXT_NODE)node.textContent=node.textContent.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n');}
    for(const media of attachments.values())box.append(mediaView(media,'Media '+media.kind));
    return box;
  }
  function flair(p){const label=C.cleanFlair(p.post_flair_text);return label?text('span',label,'flair'+(state.settings.plainFlair?'':' art')):null;}
  function openPost(p,focus='post'){state.post=p;state.threadFocus=focus;navigate('thread');}
  async function vote(p,direction,isPost=true,node){if(!state.username){toast('Sign in to vote.');return;}await action(async()=>{
    await api('/api/v2/action/vote',{id:p.id,type:isPost,direction},'POST');const current=p.vote_state??2;
    p.vote_state=current===direction?2:direction;
    p.score=Number(p.score||0)+(p.vote_state===0?1:p.vote_state===1?-1:0)-(current===0?1:current===1?-1:0);
    if(node){const group=node.closest('.vote-group');group.querySelector('.score').textContent=Number(p.score).toLocaleString();group.dataset.vote=String(p.vote_state);group.querySelectorAll('[data-direction]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.direction)===p.vote_state)));}
  },node);}
  function voteControls(p,isPost=true){const up=iconButton('up','Upvote',e=>vote(p,0,isPost,e.currentTarget),'vote'),down=iconButton('down','Downvote',e=>vote(p,1,isPost,e.currentTarget),'vote');up.dataset.direction='0';down.dataset.direction='1';
    up.setAttribute('aria-pressed',String(p.vote_state===0));down.setAttribute('aria-pressed',String(p.vote_state===1));return [el('div',{class:'vote-group',role:'group','aria-label':'Vote','data-vote':p.vote_state??2},up,text('span',Number(p.score||0).toLocaleString(),'score'),down)];}
  function postCard(p,detail=false,bookmarkOwner=state.username){
    const m=C.media(p),card=el('article',{class:'post '+(detail||state.settings.layout==='cards'?'card':'compact'),'data-post-id':p.id});
    const title=detail?text('h1',p.title):button(p.title,()=>openPost(p),'post-title');
    const meta=el('div',{class:'meta'},text('span','u/'+p.author),p.author_flair_text?el('span',{class:'flair',title:'User flair'},C.cleanFlair(p.author_flair_text)):null,text('span',ago(p.created)),p.is_stickied?text('span','Pinned','pin'):null,p.domain?text('span',p.domain):null);
    const copy=el('div',{class:'post-copy'},title,flair(p),meta);
    const top=el('div',{class:'post-top'},copy);if(!detail&&state.settings.layout==='compact'&&m.kind==='image'){
      const img=el('img',{class:'thumb',src:m.url,alt:'Post image',loading:'lazy',referrerpolicy:'no-referrer'});imageOpener(img,m.url,p.title);top.append(img);
    }card.append(top);
    if(detail&&postText(p))card.append(richContent(p.content,p.raw_content));
    const embedded=C.preview(p);
    if(['twitter','youtube','rumble','truth','article'].includes(embedded.kind))card.append(linkPreview(embedded,p,detail));
    else if((detail||state.settings.layout==='cards')&&m.kind!=='link')card.append(mediaView(m,p.title));
    const saved=readLocal(ownKey('bookmarks',bookmarkOwner),[]).some(x=>x.id===p.id);
    const save=iconButton('bookmark',saved?'Unsave post':'Save post',e=>{let list=readLocal(ownKey('bookmarks',bookmarkOwner),[]),wasSaved=list.some(x=>x.id===p.id);if(wasSaved)list=list.filter(x=>x.id!==p.id);else list.unshift(p);e.currentTarget.setAttribute('aria-pressed',String(!wasSaved));e.currentTarget.setAttribute('aria-label',wasSaved?'Save post':'Unsave post');remember(ownKey('bookmarks',bookmarkOwner),list);if(state.page==='saved')savedPage();},'action-icon save-post');save.setAttribute('aria-pressed',String(saved));
    const comments=button('',()=>{if(detail)scrollToComments();else openPost(p,'comments');},'comment-count');comments.setAttribute('aria-label',`${p.comments||0} comments`);comments.append(icon('comment'),text('span',Number(p.comments||0).toLocaleString()));
    const actions=el('div',{class:'actions post-actions'},...voteControls(p),comments,el('span',{class:'action-spacer'}),save,iconButton('more','Post actions',e=>postMenu(p,e.currentTarget),'action-icon'));
    card.append(actions);return card;
  }
  function previewImage(url,alt,cls){const image=el('img',{src:C.safeURL(url),alt,loading:'lazy',class:cls,referrerpolicy:'no-referrer'});image.addEventListener('error',()=>{image.hidden=true;image.parentElement?.classList.add('image-unavailable');},{once:true});return image;}
  function tweetPreview(tweet,url,depth=0){
    const box=el('div',{class:'tweet-preview'}),author=tweet.user||{};
    const avatar=C.safeURL(author.profilePicture)?previewImage(author.profilePicture,'','tweet-avatar'):text('span',(author.displayName||'X').slice(0,1),'tweet-avatar initials');
    const identity=el('div',{class:'tweet-identity'},text('strong',author.displayName||author.username||'Post on X'),text('span',author.username?'@'+author.username:'','muted'));
    const open=text('span','X','provider-mark');
    box.append(el('div',{class:'tweet-author'},avatar,identity,open),text('div',String(tweet.content||'Open the original post to view its text.').trim(),'tweet-text'));
    const video=tweet.video&&C.safeURL(tweet.video.url);
    if(video)box.append(mediaView({kind:'video',url:video,poster:C.safeURL(tweet.video.preview),aspectRatio:tweet.video.aspectRatio},'Video from '+(author.username||'X'),{label:'Open in X',open:()=>action(()=>rpc('openX',{url}))}));
    else if(Array.isArray(tweet.images)){
      const gallery=el('div',{class:'tweet-images'+(tweet.images.length>1?' multiple':'')});
      for(const image of tweet.images.slice(0,4)){const src=C.safeURL(image.url);if(src){const img=previewImage(src,'Image from '+(author.displayName||'X'),'tweet-image');imageOpener(img,src,'Post on X');gallery.append(img);}}
      if(gallery.childNodes.length)box.append(gallery);
    }
    if(depth===0&&tweet.quotedTweet&&typeof tweet.quotedTweet==='object'){
      const q=tweet.quotedTweet,quser=q.user?.username||'i';const qurl=/^[0-9]+$/.test(String(q.id))?`https://x.com/${encodeURIComponent(quser)}/status/${q.id}`:url;
      box.append(tweetPreview(q,qurl,1));
    }
    if(tweet.linkEmbed&&typeof tweet.linkEmbed==='object'){const link=tweet.linkEmbed;box.append(text('div',link.title||link.description||'','tweet-link-title'));}
    if(tweet.poll)box.append(text('p','Poll · view on X','muted'));
    if(!video)box.append(button('Open in X',()=>action(()=>rpc('openX',{url})),'original-link'));
    return box;
  }
  const truthLoads=new WeakMap();
  const truthObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){truthObserver.unobserve(entry.target);truthLoads.get(entry.target)?.();}},{rootMargin:'300px 0px'});
  function truthPreview(item){
    const card=el('div',{class:'link-preview truth'}),body=el('div',{class:'truth-body'});
    const open=()=>action(()=>rpc('external',{url:item.url}));
    const original=()=>button('Open in Truth Social',open,'original-link');
    const value=(v,fallback='')=>typeof v==='string'&&v.trim()?v:fallback;
    let busy=false;
    async function load(){
      if(busy||!card.isConnected)return;busy=true;
      replace(body,text('p','Loading Truth Social post…','muted truth-status'));replace(card,body,original());
      try{
        const result=await rpc('truthPost',{id:item.id});if(!card.isConnected)return;
        const post=result.data;
        if(!post||post.id!==item.id||!post.account||typeof post.content!=='string')throw new Error('Truth Social returned an unexpected post.');
        const author=post.account,name=value(author.display_name,value(author.username,'Truth Social'));
        const avatar=C.safeURL(author.avatar)?previewImage(author.avatar,'','tweet-avatar'):text('span',name.slice(0,1),'tweet-avatar initials');
        const identity=el('div',{class:'tweet-identity'},text('strong',name),text('span',value(author.username)?'@'+author.username:'','muted'));
        replace(body,el('div',{class:'tweet-author'},avatar,identity,text('span','Truth Social','provider-mark')),cachedNotice(result),richContent(post.content,'','truth-text'));
        let hasPlayer=false;
        for(const attachment of (Array.isArray(post.media_attachments)?post.media_attachments:[]).slice(0,8)){
          const url=C.safeURL(attachment?.url);if(!url)continue;
          const title=value(attachment.description,'Media from '+name),poster=C.safeURL(attachment.preview_url);
          const kind=attachment.type==='image'?'image':['video','gifv'].includes(attachment.type)?'video':attachment.type==='audio'?'audio':'';
          if(!kind)continue;
          const dimensions=attachment.meta?.original;
          body.append(mediaView({kind,url,poster,aspectRatio:dimensions?[dimensions.width,dimensions.height]:undefined},title,{label:'Open in Truth Social',open}));
          if(kind!=='image')hasPlayer=true;
        }
        if(hasPlayer)card.querySelector(':scope > .original-link')?.remove();
      }catch(error){
        if(card.isConnected){replace(body,text('p','Couldn’t load this Truth Social post.','truth-status'),text('p',error.message,'muted truth-status'),button('Retry',load,'truth-retry'));replace(card,body,original());}
      }finally{busy=false;}
    }
    body.append(text('p','Loading Truth Social post…','muted truth-status'));card.append(body,original());
    truthLoads.set(card,load);truthObserver.observe(card);return card;
  }
  function linkPreview(item,post,detail){
    if(item.kind==='twitter')return tweetPreview(item.tweet,item.url);
    const card=el('div',{class:'link-preview '+item.kind});
    if(item.kind==='truth')return truthPreview(item);
    if(item.kind==='youtube'||item.kind==='rumble'){
      const provider=item.kind==='youtube'?'YouTube':'Rumble';
      const launch=button('',e=>action(async()=>{
        window.ReaderPause?.();
        const src=item.kind==='youtube'?`https://www.youtube-nocookie.com/embed/${item.id}?playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`:(await rpc('rumbleEmbed',{url:item.url})).url;
        if(item.kind==='rumble'&&!/^https:\/\/rumble\.com\/embed\/[a-zA-Z0-9]+\/?$/.test(src))throw new Error('Rumble did not provide a supported embed. Open the original to watch.');
        if(!launch.isConnected)return;
        const frame=el('iframe',{src,title:item.title||provider+' video',allow:'autoplay; encrypted-media; picture-in-picture; fullscreen',allowfullscreen:true,referrerpolicy:'strict-origin-when-cross-origin',class:'youtube-player '+item.kind+'-embed'});
        if(item.kind==='youtube')bindYouTube(frame);
        else embeddedPlayers.set(frame,{kind:'rumble',stop:()=>{launch.disabled=false;embedObserver.unobserve(frame);if(frame.isConnected)frame.replaceWith(launch);embeddedPlayers.delete(frame);}});
        launch.replaceWith(frame);embedObserver.observe(frame);
      },e.currentTarget),'video-poster');launch.setAttribute('aria-label','Play '+provider+' video: '+item.title);
      if(item.image)launch.append(previewImage(item.image,item.title,'preview-cover'));
      launch.append(el('span',{class:'play-disc'},icon('play')),text('span',provider,'provider-badge'));
      card.append(launch);
      if(item.title!==post.title||item.description)card.append(el('div',{class:'link-description'},item.title!==post.title?text('strong',item.title):null,item.description?text('p',item.description):null));
      card.append(button('Open in '+provider,()=>action(()=>rpc('external',{url:item.url})),'original-link'));
      return card;
    }
    const open=button('',()=>action(()=>rpc('external',{url:item.url})),'article-open');
    if(item.image)open.append(previewImage(item.image,'','article-image'));
    open.append(el('div',{class:'link-description'},text('span',item.domain,'link-domain'),text('strong',item.title),item.description?text('p',item.description):null));card.append(open);return card;
  }
  function postMenu(p,anchor){const m=C.media(p),box=el('div',{class:'choice-list'});
    const row=(name,label,handler)=>{const b=button('',()=>{closeDropdown();handler();},'menu-action');b.append(icon(name),text('span',label));return b;};
    box.append(row('share','Share post',()=>action(()=>rpc('share',{url:C.postURL(p)}))),row('link','Open on website',()=>action(()=>rpc('website',{url:C.postURL(p)}))));
    if(m.kind!=='link')box.append(row('download','Save '+m.kind,()=>saveMedia(m.url,p.title)));
    if(C.owned(p,state.username))box.append(row('bookmark','Edit flair',()=>{const owner=accountContext(),page=state.sequence;flairPicker(p.community,p,async(selected,token)=>{
      if(!owner.current())throw new Error('Your account changed. Reopen this post.');
      await api(selected?'/api/v2/post/set_flair':'/api/v2/post/delete_flair',selected?{id:p.id,flair_text:selected.text,flair_class:selected.class}:{id:p.id},'POST',owner.user);
      p.post_flair_text=selected?.text||'';p.post_flair_class=selected?.class||'';
      if(owner.current()&&ownsSheet(token)){closeSheet();if(page===state.sequence){const position={scroll:scrollY,anchor:scrollAnchor()};if(state.page==='thread'){state.returning=true;await threadPage(p);}else feedPage();if(page===state.sequence)restoreScroll(position,page);}}
    });}));
    openDropdown('Post actions',box,anchor,box.children.length);
  }
  function fileName(url,title){const suffix=new URL(url).pathname.split('/').pop()||'media';return (title||'media').replace(/[^a-z0-9 _-]/gi,'').slice(0,50)+'-'+suffix;}
  async function saveMedia(url,title){await action(async()=>{const r=await rpc('download',{url,name:fileName(url,title)});toast(r.duplicate?'Already in Downloads.':'Download started. Find it in Downloads.');});}
  function imageOpener(image,url,title){
    image.classList.add('image-open');image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label','View image: '+(title||'Post image'));
    image.onclick=()=>viewImage(url,title);image.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();image.click();}});
  }
  function fitImageDialog(){imageViewer?.fit();}
  window.addEventListener('resize',fitImageDialog);
  function viewImage(url,title){
    const image=el('img',{src:url,alt:title,referrerpolicy:'no-referrer',draggable:'false'});
    const feedback=el('div',{class:'image-feedback',role:'status'},'Loading image…');
    const view=el('div',{class:'image-view',tabindex:'0',role:'group','aria-label':'Image viewer. Pinch or double-tap to zoom; drag to pan.'},image,feedback);
    const controller=new AbortController(),listeners={signal:controller.signal},points=new Map();
    let scale=1,x=0,y=0,baseWidth=0,baseHeight=0,gesture=null,tap=null,lastTap=null,loaded=false;
    const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
    const zoom=button('Zoom',()=>zoomAt(scale>1?1:2.5,view.clientWidth/2,view.clientHeight/2));zoom.disabled=true;
    function render(){
      const maxX=Math.max(0,(baseWidth*scale-view.clientWidth)/2),maxY=Math.max(0,(baseHeight*scale-view.clientHeight)/2);
      x=clamp(x,-maxX,maxX);y=clamp(y,-maxY,maxY);
      image.style.transform=`translate(${(view.clientWidth-baseWidth*scale)/2+x}px,${(view.clientHeight-baseHeight*scale)/2+y}px) scale(${scale})`;
      view.dataset.zoom=String(scale);view.classList.toggle('zoom',scale>1);zoom.textContent=scale>1?'Fit image':'Zoom';
    }
    function zoomAt(next,px,py){
      if(!loaded)return;next=clamp(next,1,8);const ratio=next/scale;
      x=px-view.clientWidth/2-(px-view.clientWidth/2-x)*ratio;y=py-view.clientHeight/2-(py-view.clientHeight/2-y)*ratio;scale=next;render();
    }
    function fit(){
      if(!loaded||!view.isConnected)return;
      const dialog=$('#sheet'),chrome=dialog.querySelector('.sheet-head').offsetHeight+dialog.querySelector('.media-tools').offsetHeight;
      const height=Math.max(44,innerHeight-chrome-14),width=Math.max(1,innerWidth-14),ratio=Math.min(width/image.naturalWidth,height/image.naturalHeight,1);
      baseWidth=image.naturalWidth*ratio;baseHeight=image.naturalHeight*ratio;
      dialog.style.setProperty('--image-width',Math.min(width+2,Math.max(220,Math.ceil(baseWidth)+2))+'px');
      view.style.height=baseHeight+'px';image.style.width=baseWidth+'px';image.style.height=baseHeight+'px';
      scale=1;x=y=0;points.clear();gesture=tap=lastTap=null;render();
    }
    function local(e){const r=view.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
    function begin(){
      const p=[...points.values()];gesture=p.length?{points:p.map(v=>({...v})),scale,x,y}:null;
    }
    view.addEventListener('pointerdown',e=>{
      if(!loaded||e.button>0)return;e.preventDefault();view.focus({preventScroll:true});view.setPointerCapture(e.pointerId);
      const p=local(e);points.set(e.pointerId,p);tap=points.size===1?{...p,id:e.pointerId,time:performance.now()}:null;
      if(points.size>1)lastTap=null;begin();
    },listeners);
    view.addEventListener('pointermove',e=>{
      if(!points.has(e.pointerId)||!gesture)return;e.preventDefault();const p=local(e);points.set(e.pointerId,p);
      if(tap&&Math.hypot(p.x-tap.x,p.y-tap.y)>8)tap=null;
      const current=[...points.values()],start=gesture.points;
      if(current.length>=2&&start.length>=2){
        const distance=Math.hypot(start[1].x-start[0].x,start[1].y-start[0].y);
        const next=clamp(gesture.scale*Math.hypot(current[1].x-current[0].x,current[1].y-current[0].y)/Math.max(1,distance),1,8),ratio=next/gesture.scale;
        const sx=(start[0].x+start[1].x)/2-view.clientWidth/2,sy=(start[0].y+start[1].y)/2-view.clientHeight/2;
        x=(current[0].x+current[1].x)/2-view.clientWidth/2-(sx-gesture.x)*ratio;
        y=(current[0].y+current[1].y)/2-view.clientHeight/2-(sy-gesture.y)*ratio;scale=next;
      }else{x=gesture.x+current[0].x-start[0].x;y=gesture.y+current[0].y-start[0].y;}
      render();
    },listeners);
    function finish(e){
      if(!points.has(e.pointerId))return;
      if(e.type==='pointerup'&&tap?.id===e.pointerId&&performance.now()-tap.time<300){
        const p=local(e),now=performance.now();
        if(lastTap&&now-lastTap.time<330&&Math.hypot(p.x-lastTap.x,p.y-lastTap.y)<30){zoomAt(scale>1?1:2.5,p.x,p.y);lastTap=null;}
        else lastTap={...p,time:now};
      }
      tap=null;points.delete(e.pointerId);begin();
    }
    for(const event of ['pointerup','pointercancel','lostpointercapture'])view.addEventListener(event,finish,listeners);
    view.addEventListener('wheel',e=>{if(!loaded)return;e.preventDefault();const p=local(e);if(e.ctrlKey)zoomAt(scale*Math.exp(-e.deltaY*.01),p.x,p.y);else if(scale>1){x-=e.deltaX;y-=e.deltaY;render();}},{...listeners,passive:false});
    view.addEventListener('keydown',e=>{
      if(!loaded)return;if(['+','=','-','0','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();
      if(e.key==='+'||e.key==='=')zoomAt(scale*1.5,view.clientWidth/2,view.clientHeight/2);
      else if(e.key==='-')zoomAt(scale/1.5,view.clientWidth/2,view.clientHeight/2);
      else if(e.key==='0')zoomAt(1,view.clientWidth/2,view.clientHeight/2);
      else if(e.key.startsWith('Arrow')){x+=e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0;y+=e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0;render();}
    },listeners);
    function imageLoaded(){loaded=true;feedback.hidden=true;zoom.disabled=false;fit();}
    image.addEventListener('load',imageLoaded,listeners);
    image.addEventListener('error',()=>{loaded=false;zoom.disabled=true;feedback.hidden=false;feedback.replaceChildren(text('span','Couldn’t load this image.'),button('Retry',()=>{feedback.textContent='Loading image…';image.src=url;}));},listeners);
    sheet(title||'Image',el('div',{class:'image-content'},view,el('div',{class:'media-tools'},zoom,button('Save image',()=>saveMedia(url,title)),button('Share',()=>action(()=>rpc('share',{url}))))),'image');
    imageViewer={fit,destroy:()=>controller.abort()};if(image.complete&&image.naturalWidth)imageLoaded();
  }
  pauseObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(!e.isIntersecting)e.target.pause();}),{threshold:.1});
  function mediaView(m,title,original){const box=el('div',{class:'media'}),tools=el('div',{class:'media-tools media-toolbar'});if(m.kind==='image'){
      const image=el('img',{src:m.url,alt:title,loading:'lazy',referrerpolicy:'no-referrer'});imageOpener(image,m.url,title);box.append(image);
    }else{
      const player=el(m.kind,{src:m.url,poster:m.poster||undefined,controls:true,preload:'none',playsinline:true});bindSound(player);
      const ratio=m.aspectRatio;if(Array.isArray(ratio)&&ratio.length===2&&ratio.every(n=>Number.isFinite(n)&&n>0))player.style.aspectRatio=ratio[0]+'/'+ratio[1];
      const positions=readLocal(ownKey('playback'),{});player.addEventListener('loadedmetadata',()=>{const position=positions[m.url];if(position&&position<player.duration-2)player.currentTime=position;});
      let lastSaved=0;player.addEventListener('timeupdate',()=>{if(Date.now()-lastSaved<3000)return;lastSaved=Date.now();const p=readLocal(ownKey('playback'),{});p[m.url]=player.currentTime;const entries=Object.entries(p).slice(-100);remember(ownKey('playback'),Object.fromEntries(entries));});
      player.addEventListener('play',()=>{document.querySelectorAll('video,audio').forEach(other=>{if(other!==player)other.pause();});pauseEmbeds();});
      const status=text('p','','muted media-status');status.setAttribute('role','status');
      const retry=button('Retry',()=>{status.textContent='';status.className='muted media-status';retry.hidden=true;player.load();player.play().catch(()=>{status.textContent='This media could not play. Retry or open the original.';status.className='media-error media-status';retry.hidden=false;});});retry.hidden=true;
      player.addEventListener('waiting',()=>status.textContent='Buffering…');player.addEventListener('playing',()=>{status.textContent='';status.className='muted media-status';retry.hidden=true;});
      player.addEventListener('error',()=>{status.textContent='This media could not play. Retry or open the original.';status.className='media-error media-status';retry.hidden=false;});
      const rate=text('span','1×');const speed=button('',e=>choices('Playback speed',[.5,1,1.25,1.5,2].map(x=>[x,x+'×']),player.playbackRate,value=>{player.playbackRate=Number(value);rate.textContent=value+'×';speed.setAttribute('aria-label','Playback speed: '+value+'×');},e.currentTarget),'speed-control');speed.setAttribute('aria-label','Playback speed: 1×');speed.setAttribute('aria-haspopup','dialog');speed.append(rate,icon('chevron'));
      box.append(player,status,retry);tools.append(speed);
      pauseObserver.observe(player);if(m.kind==='video'&&state.settings.autoplay&&!state.metered){player.autoplay=true;player.preload='metadata';}
    }
    tools.append(iconButton('download','Save '+m.kind,()=>saveMedia(m.url,title)),iconButton('share','Share '+m.kind,()=>action(()=>rpc('share',{url:m.url}))));
    if(m.kind!=='image')tools.append(button(original?.label||'Open '+m.kind,original?.open||(()=>action(()=>rpc('external',{url:m.url}))),'original-link'));
    box.append(tools);return box;
  }
  function feedToolbar(){const sort=button('',e=>choices('Sort posts',['hot','new','active','rising','top'].map(v=>[v,v[0].toUpperCase()+v.slice(1)]),state.sort,value=>{state.sort=value;remember('reader:sort',value);state.feed=[];loadFeed(false);},e.currentTarget), 'sort-control');
    sort.setAttribute('aria-label','Sort posts: '+state.sort);sort.setAttribute('aria-haspopup','dialog');sort.append(icon('sort'),text('span',state.sort[0].toUpperCase()+state.sort.slice(1)),icon('chevron'));
    const layout=iconButton(state.settings.layout==='compact'?'grid':'list',state.settings.layout==='compact'?'Switch to image cards':'Switch to compact posts',()=>action(async()=>{state.settings.layout=state.settings.layout==='compact'?'cards':'compact';await saveSettings();feedPage();}));
    return el('div',{class:'toolbar feed-toolbar'},sort,el('span',{class:'action-spacer'}),layout,iconButton('refresh','Refresh feed',()=>loadFeed(false)));
  }
  function feedPage(){replace(main,feedToolbar(),...(state.feed.length?state.feed.map(p=>postCard(p)):[text('div','Loading posts…','spinner')]));if(state.feed.length){if(state.feedCached)main.insertBefore(cachedNotice(state.feedCached),main.children[1]);addMore();}else loadFeed(false);}
  const feedObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting&&state.page==='feed'&&state.more&&!feedBusy){feedObserver.unobserve(entry.target);loadFeed(true,entry.target);}},{rootMargin:'0px 0px 500px 0px'});
  function addMore(){feedObserver.disconnect();main.querySelector('.feed-tail')?.remove();if(state.more){const tail=text('div','Loading more posts…','feed-tail');tail.setAttribute('role','status');main.append(tail);feedObserver.observe(tail);}else if(state.feed.length)main.append(text('p','You’re caught up.','feed-tail'));}
  async function loadFeed(append,node){if(append&&feedBusy)return;const seq=state.sequence,load=++feedLoad;feedBusy=true;if(node)node.disabled=true;try{
      const params={community:'thedonald'};if(state.sort==='top')params.sort='day';if(append&&state.feed.length)params.from=state.feed.at(-1).uuid;
      const result=await api(`/api/v2/post/${state.sort}v2.json`,params);if(seq!==state.sequence||state.page!=='feed'||load!==feedLoad)return;
      const merged=C.mergePosts(append?state.feed:[],result.data.posts||[]);state.feed=merged.posts;
      state.more=!!result.data.has_more_entries&&merged.added.length>0;state.feedCached=result.cached?result:append?state.feedCached:null;
      if(append){main.querySelector('.feed-tail')?.remove();const fragment=document.createDocumentFragment();if(result.cached)fragment.append(cachedNotice(result));for(const p of merged.added)fragment.append(postCard(p));main.append(fragment);}
      else{replace(main,feedToolbar(),cachedNotice(result),...state.feed.map(p=>postCard(p)));if(!state.feed.length)main.append(text('p','No posts found.','empty'));window.scrollTo(0,0);}
      addMore();
      if(state.settings.preload&&!state.metered)state.feed.slice(0,6).forEach(p=>{const m=C.media(p);if(m.kind==='image'){const image=new Image();image.referrerPolicy='no-referrer';image.src=m.url;}});
    }catch(e){if(seq===state.sequence&&load===feedLoad){if(append&&state.feed.length){const tail=node?.isConnected?node:el('div',{class:'feed-tail'});replace(tail,text('p',e.message),button('Retry loading posts',()=>loadFeed(true,tail)));if(!tail.isConnected)main.append(tail);}else failure(e,()=>loadFeed(false));}}finally{if(load===feedLoad)feedBusy=false;if(node?.isConnected)node.disabled=false;}}
  function scrollToComments(){const area=$('#comments');if(!area)return;area.scrollIntoView({block:'start'});area.focus({preventScroll:true});}
  async function threadPage(post){const seq=state.sequence,returning=!!state.returning;state.returning=false;loading('Loading discussion…');try{
      const result=await api('/api/v2/post/post.json',{id:post.id||post.uuid,comments:true});if(seq!==state.sequence)return;
      const p=result.data.posts?.[0]||post;state.post=p;const comments=result.data.comments||[],groups=new Map();for(const c of comments){const parent=Number(c.comment_parent_id||0);if(!groups.has(parent))groups.set(parent,[]);groups.get(parent).push(c);}
      replace(main,cachedNotice(result),postCard(p,true));const entry=button('',()=>replyTo(p,0),'comment-entry');entry.append(icon('edit'),text('span',state.username?'Write a comment…':'Sign in to comment…'));const area=el('section',{id:'comments',class:'section',tabindex:'-1'},text('h2',`${comments.length} comments`),entry);
      function commentNode(c,depth,ancestors){if(ancestors.has(c.id))return null;const next=new Set(ancestors);next.add(c.id);const node=el('article',{class:'comment','aria-expanded':'true','data-comment-id':c.id});
        const head=button('',()=>{const expanded=node.getAttribute('aria-expanded')==='true';node.setAttribute('aria-expanded',String(!expanded));head.setAttribute('aria-expanded',String(!expanded));});head.className='comment-head';head.setAttribute('aria-expanded','true');head.append(text('strong','u/'+c.author),text('span',ago(c.created)+' · tap to collapse'));
        node.append(head);if(c.author_flair_text)node.append(el('span',{class:'flair',title:'User flair'},C.cleanFlair(c.author_flair_text)));
        node.append(richContent(c.content,c.raw_content,'comment-body'),el('div',{class:'actions'},...voteControls(c,false),button('Reply',()=>replyTo(p,c.id))));
        const kids=groups.get(Number(c.id))||[];if(kids.length&&depth<50)node.append(el('div',{class:'replies'+(depth>=3?' depth-limit':'')},...kids.map(k=>commentNode(k,depth+1,next))));return node;}
      for(const c of groups.get(0)||[])area.append(commentNode(c,0,new Set()));main.append(area);
      if(comments.some(c=>c.is_descendent_break||c.is_sibling_break))main.append(button('View remaining comments on website',()=>rpc('website',{url:C.postURL(p)}),'load-more'));
      if(!returning&&state.threadFocus==='comments')requestAnimationFrame(scrollToComments);
    }catch(e){if(seq===state.sequence)failure(e,()=>threadPage(post));}}
  function replyTo(post,parent){
    if(!state.username){toast('Sign in to reply.');return;}
    const owner=accountContext(),page=state.sequence,key=ownKey(`reply:${post.id}:${parent}`,owner.user),input=el('textarea',{'aria-label':'Comment',placeholder:'Write your reply…'});
    input.value=readLocal(key,'');input.oninput=()=>remember(key,input.value);
    let token;
    const send=button('Post reply',e=>action(async()=>{
      if(!input.value.trim())throw new Error('Write a reply first.');if(!owner.current())throw new Error('Your account changed. Reopen the reply.');
      const value=input.value,revision=store.revision(key);
      await api('/api/v2/action/create_comment',{community:post.community,parentId:post.id,commentParentId:parent,content:value},'POST',owner.user);
      clearRevision(key,revision);
      if(owner.current()){toast('Reply posted.');if(ownsSheet(token)&&page===state.sequence){closeSheet();const position={scroll:scrollY,anchor:scrollAnchor()};state.returning=true;await threadPage(post);if(page===state.sequence)restoreScroll(position,page);}}
    },e.currentTarget),'primary');
    const status=text('p','','muted');status.dataset.draftKey=key;status.dataset.savedLabel='Draft saved on this device.';
    token=sheet('Reply',el('div',{},input,status,el('div',{class:'dialog-actions'},send)));storageStatus();
  }
  async function flairPicker(community,current,onSelect){
    const token=sheet('Choose post flair',text('p','Loading flairs…','muted'),'flair');
    try{
      const result=await api('/api/v2/community/post_flairs.json',{community:community||'thedonald'});if(!ownsSheet(token))return;
      const options=result.data.flairs||[],list=el('div',{class:'flair-options',role:'radiogroup','aria-label':'Post flair'});
      function option(f){const selected=f?f.class===(current?.class||current?.post_flair_class):!current?.class&&!current?.post_flair_class;
        return el('button',{class:'flair-option',role:'radio','aria-checked':String(selected),onclick:e=>{if(ownsSheet(token))action(()=>onSelect(f,token),e.currentTarget);}},el('span',{class:'check'},selected?icon('check'):null),text('span',f?C.cleanFlair(f.text)||f.class:'No flair'));}
      list.append(option(null),...options.map(option));replace($('#sheet-body'),cachedNotice(result),text('p','Full labels are shown. Your selection is previewed before posting.','muted'),list);
    }catch(e){if(ownsSheet(token))replace($('#sheet-body'),text('p',e.message),button('Retry',()=>flairPicker(community,current,onSelect),'secondary'));}
  }
  function requireLogin(){empty('Sign in to continue','Use your normal patriots.win account. Your password stays in the website sign-in form.',button('Sign in',()=>action(()=>rpc('login')),'primary'));}
  function composePage(){if(!state.username){requireLogin();return;}
    const key=ownKey('draft'),draft=readLocal(key,{type:'text',title:'',content:'',link:'',flair:null}),journal=readLocal(ownKey('publish'),null);
    const box=el('section',{class:'section'},text('h1','Create a post'));
    if(journal){box.append(recovery(journal));replace(main,box);return;}
    function save(){remember(key,draft);}
    const tabs=el('div',{class:'tabs',role:'tablist','aria-label':'Post type'},...['text','media','link'].map(type=>el('button',{role:'tab','aria-selected':String(type===draft.type),onclick:()=>{draft.type=type;save();composePage();}},type[0].toUpperCase()+type.slice(1))));box.append(tabs);
    const title=el('textarea',{class:'composer-title',maxlength:300,id:'post-title',placeholder:'Give your post a title',rows:2});title.value=draft.title;
    const count=text('p',`${draft.title.length}/300 · Titles cannot be edited later.`,'muted');title.oninput=()=>{draft.title=title.value;count.textContent=`${title.value.length}/300 · Titles cannot be edited later.`;save();};box.append(el('div',{class:'field'},el('label',{for:'post-title'},'Title'),title,count));
    if(draft.type==='text'){const input=el('textarea',{id:'post-content',placeholder:'Write your post…'});input.value=draft.content;input.oninput=()=>{draft.content=input.value;save();};box.append(el('div',{class:'field'},el('label',{for:'post-content'},'Text'),input));}
    else {const link=el('input',{id:'post-link',type:'url',placeholder:'https://…'});link.value=draft.link;link.oninput=()=>{draft.link=link.value;save();};box.append(el('div',{class:'field'},el('label',{for:'post-link'},draft.type==='media'?'Media URL':'Link'),link));
      if(draft.type==='media')box.append(button('Choose image or video',e=>action(async()=>{const owner=accountContext(),page=state.sequence,revision=store.revision(key),result=await rpc('upload',{expectedUser:owner.user});if(!owner.current()||store.revision(key)!==revision){toast('Upload finished. Reopen the original draft to use its link.');return;}draft.link=result.url;save();if(page===state.sequence)composePage();},e.currentTarget),'secondary'),text('p','Images upload to Scored; MP4 videos upload to Videy. You will confirm before uploading.','muted'));
    }
    const flairButton=button('',()=>flairPicker('thedonald',draft.flair,selected=>{draft.flair=selected;save();closeSheet();composePage();}),'flair-select');flairButton.append(text('span',draft.flair?C.cleanFlair(draft.flair.text):'Choose flair'),icon('chevron'));box.append(el('div',{class:'field'},text('label','Post flair'),flairButton));
    const draftStatus=text('p','Draft saved · Review before publishing','muted');draftStatus.dataset.draftKey=key;
    box.append(draftStatus,button('Preview post',()=>{
      try{C.validateDraft(draft);}catch(e){toast(e.message);return;}
      const preview={...draft,id:'preview',author:state.username,created:Date.now(),post_flair_text:draft.flair?.text,post_flair_class:draft.flair?.class,raw_content:draft.type==='text'?draft.content:'',is_image:draft.type==='media'&&!/\.mp4/i.test(draft.link)};
      const content=el('div',{},text('h2',draft.title),flair(preview),text('div',draft.type==='text'?(draft.content||''):draft.link,'content'));
      const media=C.media(preview);if(draft.type==='media'&&media.kind!=='link')content.append(mediaView(media,draft.title));
      content.append(el('div',{class:'dialog-actions'},button('Publish post',e=>action(async()=>{e.currentTarget.disabled=true;await publishDraft(draft);},e.currentTarget),'primary')));sheet('Preview',content);
    },'primary'));replace(main,box);storageStatus();}
  async function locateCreated(created){if(created.posts?.length)return created.posts[0];
    const raw=created.link||'',url=C.safeURL(raw.startsWith('/')?'https://patriots.win'+raw:raw),match=url&&new URL(url).pathname.match(/\/p\/([^/]+)/);
    if(!match)throw new Error('Post was created, but its link could not be read. Check your profile; do not publish again.');
    const result=await api('/api/v2/post/post.json',{id:decodeURIComponent(match[1])});if(!result.data.posts?.[0])throw new Error('Post was created. Open your profile to find it.');return result.data.posts[0];}
  async function publishDraft(draft){
    const owner=accountContext(),key=ownKey('publish',owner.user),draftKey=ownKey('draft',owner.user),revision=store.revision(draftKey),page=state.sequence,token=sheetGeneration;
    if(publishing.has(key)){toast('This post is still being published.');return;}const existing=readLocal(key,null);let createSent=false;publishing.add(key);
    try{
      if(!owner.user)throw new Error('Sign in before posting.');
      const snapshot=JSON.parse(JSON.stringify(draft));
      const result=await C.publish(snapshot,{remember:value=>durable(key,value),create:async params=>{createSent=true;return (await api('/api/v2/action/create_post',params,'POST',owner.user)).data;},locate:locateCreated,
        apply:(id,f)=>{if(!owner.current())throw new Error('Sign back into the original account to finish applying flair.');return api('/api/v2/post/set_flair',{id,flair_text:f.text,flair_class:f.class},'POST',owner.user);}},existing);
      clearRevision(draftKey,revision);
      if(owner.current()){toast(result.pendingFlair?'Post published; flair is pending. Finish it from New post.':'Post published.');if(ownsSheet(token)&&page===state.sequence){closeSheet();if(result.pendingFlair)composePage();else openPost(result.post);}}
    }catch(e){if(!createSent&&!existing)remember(key,null);if(owner.current()){toast(e.message);if(ownsSheet(token)&&page===state.sequence){closeSheet();composePage();}}}
    finally{publishing.delete(key);if(owner.current()&&state.page==='compose'&&page===state.sequence&&!$('#sheet').open)composePage();}
  }
  function recovery(j){
    const owner=accountContext(),key=ownKey('publish',owner.user),draftKey=ownKey('draft',owner.user),revision=store.revision(draftKey),page=state.sequence;
    const box=el('div',{class:'notice'},text('h2',publishing.has(key)?'Publishing…':j.stage==='flair'?'Post published; flair pending':'Check the previous posting attempt'),text('p',j.title),text('p','Your draft is preserved. Check your profile before creating another copy.'));
    box.append(button('Check my posts',()=>navigate('profile'),'secondary'));if(publishing.has(key)){box.append(text('p','The original request is still running.'));return box;}
    if(j.post||j.created)box.append(button('Finish applying flair',e=>action(async()=>{
      if(!owner.current()||publishing.has(key))throw new Error('Reopen this pending post under its original account.');publishing.add(key);
      try{const post=j.post||await locateCreated(j.created);j.post=post;j.stage='flair';durable(key,j);if(!owner.current())throw new Error('Sign back into the original account to finish.');
        if(j.flair)await api('/api/v2/post/set_flair',{id:post.id,flair_text:j.flair.text,flair_class:j.flair.class},'POST',owner.user);
        durable(key,null);clearRevision(draftKey,revision);if(owner.current()){toast('Post is ready.');if(page===state.sequence)openPost(post);}
      }finally{publishing.delete(key);}
    },e.currentTarget),'primary'));
    box.append(button('Resolve this attempt',()=>sheet('Resolve publishing attempt',el('div',{},text('p','Check your profile first. If the post exists, use Edit flair on that post.'),
      button('Post exists — clear this draft',()=>{if(!owner.current()||publishing.has(key))return;durable(key,null);clearRevision(draftKey,revision);closeSheet();composePage();}),
      button('Confirmed no post — keep draft',()=>{if(!owner.current()||publishing.has(key))return;durable(key,null);closeSheet();composePage();})))));return box;
  }
  function pagedPosts(container,path,params,model,valid){
    let busy=false;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))load();},{rootMargin:'0px 0px 400px 0px'});
    activeListCleanup=()=>observer.disconnect();
    function tail(){observer.disconnect();container.querySelector('.result-tail')?.remove();if(model.more){const n=text('div','Loading more posts…','feed-tail result-tail');container.append(n);observer.observe(n);}else if(model.posts.length)container.append(text('p','You’re caught up.','feed-tail result-tail'));}
    async function load(){if(!valid()||busy||!model.more)return;busy=true;try{
      const r=await api(path,{...params,page:model.page+1});if(!valid())return;
      const merged=C.mergePosts(model.posts,r.data.posts||[]);model.posts=merged.posts;model.page++;model.more=r.data.has_more_entries!==false&&merged.added.length>0;
      container.querySelector('.result-tail')?.remove();container.querySelector('.spinner')?.remove();for(const post of merged.added)container.append(postCard(post));
      if(!model.posts.length)container.append(text('p','No posts found.','empty'));tail();
    }catch(e){if(valid()){observer.disconnect();container.querySelector('.result-tail')?.remove();container.querySelector('.spinner')?.remove();container.append(el('div',{class:'feed-tail result-tail'},text('p',e.message),button('Retry',()=>{container.querySelector('.result-tail')?.remove();load();})));}}
    finally{busy=false;}}
    replace(container,...model.posts.map(p=>postCard(p)));if(model.page)tail();else{container.append(text('div','Loading posts…','spinner'));return load();}
  }
  function savedPage(){
    const list=readLocal(ownKey('bookmarks'),[]);replace(main,el('section',{class:'section'},text('h1','Saved posts')),...list.map(p=>postCard(p)));
    if(!list.length)main.append(text('p','Use the bookmark icon on a post to save it here.','empty'));
    if(state.username){const guest=readLocal(ownKey('bookmarks',''),[]);if(guest.length)main.append(el('section',{class:'section'},text('h2','Saved while signed out')),...guest.map(p=>postCard(p,false,'')));}
  }
  function searchPage(){
    const input=el('input',{type:'search',placeholder:'Search TheDonald','aria-label':'Search posts'});input.value=state.query||'';
    const results=el('div'),form=el('form',{class:'toolbar'},input,el('button',{type:'submit',class:'secondary'},'Search'));replace(main,form,results);
    const seq=state.sequence;
    function run(fresh){activeListCleanup?.();const query=input.value.trim();state.query=query;const generation=++searchGeneration;if(!query){state.searchModel=null;replace(results);return;}
      if(fresh||!state.searchModel||state.searchModel.query!==query)state.searchModel={query,posts:[],page:0,more:true};
      return pagedPosts(results,'/api/v2/post/search.json',{community:'thedonald',query,sort:'new'},state.searchModel,()=>seq===state.sequence&&generation===searchGeneration);
    }
    form.onsubmit=e=>{e.preventDefault();run(true);};if(state.searchModel&&state.searchModel.query===state.query)return run(false);
  }
  function profilePage(){
    const header=el('section',{class:'section'},text('h1',state.username?'u/'+state.username:'Profile'),button('Saved posts',()=>navigate('saved')));
    if(!state.username){header.append(text('p','Browse and save posts without an account. Sign in to post or reply.','muted'),button('Sign in',()=>action(()=>rpc('login')),'primary'));replace(main,header);return;}
    const seq=state.sequence,user=state.username;header.append(button('Website account settings',()=>action(()=>rpc('website',{url:'https://patriots.win/settings'}))));
    const results=el('div');replace(main,header,results);if(!state.profileModel||state.profileModel.user!==user)state.profileModel={user,posts:[],page:0,more:true};
    return pagedPosts(results,'/api/v2/post/profile.json',{user},state.profileModel,()=>seq===state.sequence&&state.username===user);
  }
  async function inboxPage(){if(!state.username){requireLogin();return;}const seq=state.sequence;loading();try{
      const r=await api('/api/v2/message/messages.json',{type:'all',page:1});if(seq!==state.sequence)return;
      replace(main,el('section',{class:'section'},text('h1','Inbox'),button('Open full inbox on website',()=>rpc('website',{url:'https://patriots.win/messages'}),'secondary')));
      for(const m of r.data.messages||[])main.append(el('article',{class:'post'},text('h2',m.subject||'Message'),text('p',m.author||m.sender||'','muted'),richContent(m.content,m.raw_content)));
      if(!r.data.messages?.length)main.append(text('p','Your inbox is empty.','empty'));
    }catch(e){if(seq===state.sequence)failure(e,inboxPage);}}
  function settingsPage(){const box=el('section',{class:'section'},text('h1','Settings'));
    const github='https://github.com/IronWolve/Patriot-Reader';
    const about=button('',()=>{
      const link=el('a',{href:github,rel:'noopener noreferrer'},'GitHub · Patriot-Reader');link.onclick=e=>{e.preventDefault();action(()=>rpc('external',{url:github}));};
      sheet('About Patriot Reader',el('div',{},text('p','Version '+state.appVersion),text('p','An independent Android reader for patriots.win.'),el('p',{},link)));
    },'setting about-setting');
    about.append(text('span','About'),el('span',{class:'about-version'},state.appVersion?'v'+state.appVersion:'',icon('chevron')));box.append(about);
    function selectSetting(label,key,options,help){const value=options.find(([v])=>String(v)===String(state.settings[key]))?.[1]||state.settings[key];const choose=button('',e=>choices(label,options,state.settings[key],selection=>action(async()=>{const seq=state.sequence;state.settings[key]=key==='textSize'||key==='cacheMb'?Number(selection):selection;await saveSettings();if(seq===state.sequence&&state.page==='settings')settingsPage();}),e.currentTarget),'setting-choice');choose.setAttribute('aria-label',label+': '+value);choose.append(text('span',value),icon('chevron'));box.append(el('div',{class:'setting'},el('div',{class:'setting-line'},text('span',label),choose),help?text('small',help):null));}
    function toggle(label,key,help){const id='setting-'+key,input=el('input',{type:'checkbox',role:'switch',class:'setting-switch',id,checked:state.settings[key]});input.onchange=()=>action(async()=>{state.settings[key]=input.checked;await saveSettings();});box.append(el('div',{class:'setting toggle'},el('label',{for:id},label,help?text('small',help):null),input));}
    selectSetting('Appearance','theme',[['dark','Dark'],['light','Light'],['system','Follow system']]);selectSetting('Text size','textSize',[[15,'Small'],[17,'Standard'],[20,'Large'],[24,'Extra large']]);selectSetting('Feed layout','layout',[['compact','Compact'],['cards','Image cards']]);
    toggle('Plain, readable flair','plainFlair','Full labels always remain visible.');toggle('Show website ads','showAds','Off by default. Applies to the website view; the reader contains no ad placements.');
    toggle('Autoplay video on unmetered connections','autoplay','Off by default. Uses your last volume and mute setting.');toggle('Preload nearby images on unmetered connections','preload','Never preloads videos.');toggle('Download only on unmetered connections','wifiDownloads','Queued downloads wait until an unmetered connection is available.');
    selectSetting('Temporary cache limit','cacheMb',[[16,'16 MB'],[64,'64 MB'],[128,'128 MB'],[256,'256 MB']],'Cached posts and images expire after seven days. Downloads, saved posts and drafts are separate.');
    const usage=text('p','Checking storage…','muted');box.append(el('div',{class:'setting'},usage,button('Clear temporary cache',e=>action(async()=>{await rpc('clearCache');usage.textContent='Temporary cache cleared. Downloads and drafts are preserved.';},e.currentTarget),'secondary')));rpc('cacheInfo').then(r=>usage.textContent=`Temporary cache: ${(r.bytes/1048576).toFixed(1)} MB`).catch(()=>usage.textContent='Cache usage unavailable.');
    box.append(el('div',{class:'setting'},text('h2','Account'),text('p',state.username?'Signed in as '+state.username:'Browsing without an account','muted'),button(state.username?'Sign out':'Sign in',()=>state.username?sheet('Sign out?',el('div',{},text('p','This removes the saved login. Your downloads and account-specific drafts remain on this device.'),button('Sign out',()=>action(async()=>{await rpc('logout');closeSheet();accountChanged('');}),'primary'))):action(()=>rpc('login')))));
    if(state.sessionNeedsReset)box.append(el('div',{class:'notice'},text('p','Your saved login could not be read. Reset only the login to sign in again; drafts and downloads are kept.'),button('Reset saved login',()=>action(async()=>{await rpc('logout');state.sessionNeedsReset=false;accountChanged('');toast('Saved login reset. Your drafts and downloads are unchanged.');}),'primary')));
    replace(main,box);}
  async function downloadsPage(){
    const seq=state.sequence,rows=new Map();let busy=false;
    const listContainer=el('div'),emptyMessage=text('p','Save an image, video or sound to find it here.','empty');
    replace(main,el('section',{},el('div',{class:'section'},text('h1','Your downloads'),text('p','Saved in Downloads / Patriot Reader. Use Save copy to choose another location.','muted')),listContainer,emptyMessage));
    async function refresh(){
      if(busy||seq!==state.sequence||document.hidden)return;
      busy=true;clearTimeout(downloadTimer);downloadTimer=null;
      try{
        const list=await rpc('downloads');if(seq!==state.sequence)return;
        emptyMessage.hidden=list.length>0;
        const ids=new Set(list.map(item=>item.id));
        for(const[id,row]of rows)if(!ids.has(id)){row.node.remove();rows.delete(id);}
        for(const item of list){
          let row=rows.get(item.id);
          if(!row){row={node:el('article',{class:'download'}),title:text('h3',''),status:text('p','','muted'),progress:el('progress'),actions:el('div',{class:'actions'}),lastStatus:null};row.node.append(row.title,row.status,row.progress,row.actions);listContainer.append(row.node);rows.set(item.id,row);}
          row.title.textContent=item.name;
          const label={1:'Queued',2:'Downloading',4:'Waiting for network',8:'Saved',16:'Failed'}[item.status]||'Unknown';
          row.status.textContent=`${label} · ${(item.bytes/1048576).toFixed(1)} MB`;
          row.progress.hidden=item.status!==2;row.progress.max=item.total>0?item.total:1;
          if(item.total>0)row.progress.value=item.bytes;else row.progress.removeAttribute('value');
          if(row.lastStatus===item.status)continue;
          row.lastStatus=item.status;row.actions.replaceChildren();
          if(item.status===8){
            row.actions.append(button('Open',()=>action(()=>rpc('openDownload',{downloadId:item.id}))),button('Share',()=>action(()=>rpc('share',{downloadId:item.id}))),button('Save copy…',()=>action(()=>rpc('export',{downloadId:item.id,name:item.name}))));
            if((item.mime||'').startsWith('video/'))row.actions.append(button('Save audio…',()=>action(async()=>{await rpc('extract',{downloadId:item.id});toast('AAC audio saved.');})));
          }else if(item.status===16)row.actions.append(button('Retry',()=>action(async()=>{await rpc('download',{url:item.url,name:item.name});refresh();})));
          else row.actions.append(button('Cancel',()=>action(async()=>{await rpc('cancelDownload',{downloadId:item.id});refresh();})));
        }
        // Poll only unfinished transfers, and never overlap requests or poll in the background.
        if(list.some(item=>[1,2,4].includes(item.status))&&!document.hidden)downloadTimer=setTimeout(refresh,2000);
      }catch(error){if(seq===state.sequence)toast(error.message);}finally{busy=false;}
    }
    refreshDownloads=refresh;await refresh();
  }
  function pauseEmbeds(except){for(const[frame,entry]of embeddedPlayers){if(frame===except)continue;if(entry.kind==='youtube')youtubeCommand(frame,'pauseVideo');else entry.stop();}}
  window.ReaderPause=()=>{document.querySelectorAll('video,audio').forEach(m=>m.pause());pauseEmbeds();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden){window.ReaderPause();clearTimeout(downloadTimer);downloadTimer=null;}else refreshDownloads?.();});
  ready.then(async()=>{try{const data=await rpc('bootstrap');Object.assign(state,{username:data.username||'',appVersion:data.appVersion||'',metered:data.metered,systemDark:data.systemDark,sessionNeedsReset:!!data.sessionNeedsReset,settings:C.normalizeSettings(data.settings)});theme();state.sort=readLocal('reader:sort','hot');if(!['hot','new','active','rising','top'].includes(state.sort))state.sort='hot';navigate('feed',false);showNotice(data.notice||'');if(data.sessionNeedsReset)toast('Saved login could not be read. You can browse as a guest or reset it in Settings.');}catch(e){failure(e,()=>location.reload());}});
  setTimeout(()=>{if(!port&&!window.ReaderPreview)empty('Reader connection unavailable','Close and reopen the app to reconnect.');},12000);
})();
