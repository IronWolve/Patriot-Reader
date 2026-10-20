'use strict';
(() => {
  const C=ReaderCore, $=s=>document.querySelector(s), main=$('#main');
  const state={site:C.PATRIOTS,community:'thedonald',settings:C.normalizeSettings({}),username:'',metered:true,systemDark:true,appVersion:'',page:'feed',sort:'hot',feed:[],more:false,stack:[],sequence:0,accountEpoch:0,sessionNeedsReset:false};
  const pending=new Map();let port=null,requestCounter=0,readyResolve,toastTimer,downloadTimer,lastFocus,refreshDownloads,pauseObserver,feedLoad=0,feedBusy=false,threadLoad=0,blockGeneration=0,booted=false,dropdownAnchor,imageViewer,sheetGeneration=0,searchGeneration=0,savedGeneration=0,restoreCleanup,activeListCleanup,replyCleanup;
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
    communities:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z',
    settings:'M4 7h16M4 17h16M8 4v6M16 14v6',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    close:'m6 6 12 12M6 18 18 6',comment:'M4 4h16v12H9l-5 4Z',
    bookmark:'M6 3h12v18l-6-4-6 4Z',share:'M12 15V3m-4 4 4-4 4 4M5 12v9h14v-9',copy:'M9 9h11v12H9ZM5 16H3V3h12v2',
    edit:'m4 16-1 5 5-1L20 8l-4-4ZM14 6l4 4M3 21h18',
    more:'M5 12h.01M12 12h.01M19 12h.01',refresh:'M20 11a8 8 0 1 0-2 6M20 4v7h-7',
    grid:'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',list:'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
    play:'m9 5 11 7-11 7Z',chevron:'m6 9 6 6 6-6',check:'m4 12 5 5L20 6',sort:'M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4',eye:'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'
  };
  function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const[k,v]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'glyph'}))svg.setAttribute(k,v);const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',iconPaths[name]||iconPaths.more);svg.append(path);return svg;}
  function iconButton(name,label,handler,cls='icon'){const b=button('',handler,cls);b.setAttribute('aria-label',label);b.title=label;b.append(icon(name));return b;}
  for(const [id,name]of Object.entries({communities:'communities',downloads:'download',settings:'settings','sheet-close':'close'}))$('#'+id).replaceChildren(icon(name));
  for(const n of document.querySelectorAll('#nav button'))n.prepend(icon({feed:'home',search:'search',compose:'plus',inbox:'inbox',profile:'user'}[n.dataset.page]));
  function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
  function syncModalScroll(){document.documentElement.classList.toggle('modal-open',!!document.querySelector('dialog[open]'));}
  function sheet(title,content,layout='dialog'){++sheetGeneration;imageViewer?.destroy();imageViewer=null;lastFocus=document.activeElement;$('#sheet').classList.toggle('image-dialog',layout==='image');$('#sheet').classList.toggle('compact-dialog',layout==='dialog');$('#sheet-title').textContent=title;$('#sheet-title').title=title;replace($('#sheet-body'),content);if(!$('#sheet').open)$('#sheet').showModal();syncModalScroll();return sheetGeneration;}
  function closeSheet(){++sheetGeneration;imageViewer?.destroy();imageViewer=null;releaseMedia($('#sheet-body'));$('#sheet-body').replaceChildren();$('#sheet').close();syncModalScroll();lastFocus?.focus?.();}
  function closeDropdown(){if($('#dropdown').open)$('#dropdown').close();$('#dropdown').replaceChildren();if(dropdownAnchor?.id==='site-choice')dropdownAnchor.setAttribute('aria-expanded','false');dropdownAnchor?.focus?.();dropdownAnchor=null;syncModalScroll();}
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
  function receive(message){if(message.event){if(message.event==='link'){if(booted)takeReaderLink();}if(message.event==='notice')showNotice(message.data);if(message.event==='downloadsChanged')refreshDownloads?.();if(message.event==='fileOperationChanged'){refreshDownloads?.();reconcileUploads();}if(message.event==='account')accountChanged(message.data.username);if(message.event==='systemTheme'){state.systemDark=message.data;theme();}if(message.event==='metered'){state.metered=message.data;if(message.data)document.querySelectorAll('video[autoplay],audio[autoplay]').forEach(m=>{m.pause();m.autoplay=false;});}return;}
    const job=pending.get(message.id);if(!job)return;pending.delete(message.id);clearTimeout(job.timer);message.error?job.reject(new Error(message.error)):job.resolve(message.result);}
  // Provider iframes must never replace the native channel. It is established
  // before bootstrap; no remote embed exists until after that handshake.
  window.addEventListener('message',e=>{if(port||(e.source&&e.source!==window))return;if(e.data==='reader-connect'&&e.ports.length){port=e.ports[0];port.onmessage=e=>receive(JSON.parse(e.data));port.start();readyResolve();}});
  if(window.ReaderPreview)readyResolve();
  async function rpc(op,args={}){if(['api','login','logout','upload','website'].includes(op))args={site:state.site,...args};await ready;if(window.ReaderPreview)return window.ReaderPreview(op,args);return new Promise((resolve,reject)=>{
      const id=String(++requestCounter),userPaced=['login','website','export','extract','upload'].includes(op),timer=userPaced?null:setTimeout(()=>{pending.delete(id);reject(new Error('The request timed out. For posting, check your profile before retrying.'));},65000);
    const payload=JSON.stringify({id,op,args});if(payload.length>1024*1024){clearTimeout(timer);reject(new Error('This request is too large. Keep unsaved text open and reduce its size before retrying.'));return;}pending.set(id,{resolve,reject,timer});try{port.postMessage(payload);}catch(error){pending.delete(id);clearTimeout(timer);reject(error);}});}
  const api=(path,params={},method='GET',expectedUser=state.username,site=state.site)=>rpc('api',{site,path,params,method,expectedUser});
  async function action(fn,node){if(node?.disabled)return;try{if(node)node.disabled=true;return await fn();}catch(e){toast(e.message);}finally{if(node?.isConnected)node.disabled=false;}}
  const ownKey=(name,user=state.username)=>`reader:${user.toLowerCase()||'guest'}:${name}`;
  const store=C.createStore(localStorage),publishing=new Set(),bookmarkMembership=new Map();
  const readLocal=(key,fallback)=>store.read(key,fallback);
  function bookmarkIDs(user){const key=ownKey('bookmarks',user),revision=store.revision(key),cached=bookmarkMembership.get(key);if(cached?.revision===revision)return cached.ids;const ids=new Set(readLocal(key,[]).map(p=>String(p.id)));bookmarkMembership.set(key,{revision,ids});return ids;}
  function storageStatus(){
    const warning=$('#storage-warning');warning.hidden=store.pending().length===0;
    document.querySelectorAll('[data-draft-key]').forEach(n=>{n.textContent=store.pending().includes(n.dataset.draftKey)?'Not saved on this device — keep the app open.':(n.dataset.savedLabel||'Draft saved · Review before publishing');});
  }
  function remember(key,value){const saved=store.write(key,value);storageStatus();return saved;}
  function durable(key,value){const previous=readLocal(key,null);if(!remember(key,value)){if(value===null&&previous!==null)remember(key,previous);throw new Error('Couldn’t save the publishing record. Keep the app open and retry saving before continuing.');}}
  function clearRevision(key,revision){if(store.revision(key)===revision)remember(key,null);}
  function retryStorage(){store.retry();storageStatus();reconcileUploads();}
  $('#storage-retry').onclick=retryStorage;
  async function copyRecovery(){const value=JSON.stringify(store.recovery(),null,2);if(value.length>500000)throw new Error('Too much unsaved data to copy at once. Keep the app open and use Retry save after making storage available.');await rpc('copyText',{text:value});toast('Unsaved data copied.');}
  $('#storage-copy').onclick=()=>action(copyRecovery);
  window.addEventListener('beforeunload',e=>{if(store.pending().length){e.preventDefault();e.returnValue='';}});
  const ownsSheet=token=>$('#sheet').open&&sheetGeneration===token;
  function accountContext(){const user=state.username,site=state.site,epoch=state.accountEpoch;return {user,site,current:()=>site===state.site&&user===state.username&&epoch===state.accountEpoch};}
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
  function coordinatePlayback(player){player.addEventListener('play',()=>{document.querySelectorAll('video,audio').forEach(other=>{if(other!==player)other.pause();});pauseEmbeds();});}
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
  function accountChanged(username,restored=null,needsReset=false){const previousUser=state.username;state.accountEpoch++;state.sessionNeedsReset=needsReset;state.username=username||'';if(state.site===C.SCORED&&previousUser!==state.username&&C.scoredFeedView(state.community))state.community=selectedCommunity();state.feed=restored?.feed||[];state.more=restored?.more||false;state.feedCached=restored?.feedCached||null;state.searchModel=null;state.profileModel=null;state.profileModels={};state.profileUser='';state.threadModel=null;state.inboxModel=null;state.inboxTab='all';state.savedModel=null;state.savedTab=state.username?'website':'device';state.message=null;state.blocked=readLocal(ownKey('blocked'),[]);state.stack=[];state.sequence++;navigate('feed',false);if(restored?.feed.length)restoreScroll(restored,state.sequence);loadAccountPreferences();syncWebsiteSaves(true);reconcileUploads();}
  function navigation(page,push=true){if(state.page==='feed'){state.feedScroll=scrollY;state.feedAnchor=scrollAnchor();}activeListCleanup?.();activeListCleanup=null;replyCleanup?.();replyCleanup=null;restoreCleanup?.();restoreCleanup=null;closeDropdown();feedObserver.disconnect();feedBusy=false;feedLoad++;if(push)state.stack.push({page:state.page,community:state.community,sort:state.sort,topRange:state.topRange,feed:state.feed,more:state.more,feedCached:state.feedCached,searchModel:state.searchModel,scroll:window.scrollY,post:state.post,query:state.query,threadFocus:state.threadFocus,threadTarget:state.threadTarget,threadModel:state.threadModel,profileUser:state.profileUser,profileTab:state.profileTab,profileModels:state.profileModels,inboxTab:state.inboxTab,inboxModel:state.inboxModel,message:state.message,anchor:scrollAnchor()});state.sequence++;state.page=page;clearTimeout(downloadTimer);downloadTimer=null;refreshDownloads=null;refreshUploadResults=null;refreshUploadStatus=null;
    updateHeader();
    document.querySelectorAll('#nav button').forEach(n=>{if(n.dataset.page===page)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});window.scrollTo(0,0);}
  function navigate(page,push=true){navigation(page,push);return ({feed:feedPage,communities:communitiesPage,search:searchPage,compose:composePage,profile:profilePage,settings:settingsPage,downloads:downloadsPage,saved:savedPage,inbox:inboxPage,message:messagePage,thread:()=>threadPage(state.post)}[page]||feedPage)();}
  function back(){if($('#dropdown').open){closeDropdown();return;}if($('#sheet').open){closeSheet();return;}const previous=state.stack.pop();if(previous){state.community=previous.community||state.community;remember(communityPref(),state.community);if(previous.sort){state.sort=previous.sort;state.topRange=previous.topRange||'day';remember(sitePref('sort'),state.sort);remember(sitePref('topRange'),state.topRange);}state.feed=previous.feed||[];state.more=previous.more||false;state.feedCached=previous.feedCached;state.searchModel=previous.searchModel;state.post=previous.post;state.query=previous.query;state.threadFocus=previous.threadFocus;for(const key of ['threadTarget','threadModel','profileUser','profileTab','profileModels','inboxTab','inboxModel','message'])state[key]=previous[key];state.returning=previous.page==='thread';const task=navigate(previous.page,false),seq=state.sequence;Promise.resolve(task).then(()=>{if(seq===state.sequence)restoreScroll(previous,seq);});}
    else if(state.page!=='feed')navigate('feed',false);else if(store.pending().length)sheet('Changes are not saved',el('div',{},text('p','Keep the app open until saving succeeds, or copy the unsaved data before leaving.'),button('Retry saving',retryStorage),button('Copy unsaved data',()=>action(copyRecovery))));else rpc('exit').catch(()=>{});}
  function scrollAnchor(){const nodes=[...main.querySelectorAll('[data-comment-id],[data-post-id]')],node=nodes.find(n=>n.getBoundingClientRect().bottom>54);return node?{kind:node.hasAttribute('data-comment-id')?'data-comment-id':'data-post-id',id:node.getAttribute(node.hasAttribute('data-comment-id')?'data-comment-id':'data-post-id'),top:node.getBoundingClientRect().top}:null;}
  function restoreScroll(previous,seq){
    let applying=false,frame=0;
    const apply=()=>{frame=0;if(applying||seq!==state.sequence)return;applying=true;const anchor=previous.anchor,node=anchor&&[...main.querySelectorAll('['+anchor.kind+']')].find(n=>n.getAttribute(anchor.kind)===anchor.id);window.scrollTo(0,node?scrollY+node.getBoundingClientRect().top-anchor.top:previous.scroll);applying=false;};
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(apply);},observer=new ResizeObserver(schedule);observer.observe(main);main.addEventListener('load',schedule,true);
    const stop=()=>{observer.disconnect();main.removeEventListener('load',schedule,true);for(const name of ['pointerdown','wheel','keydown'])window.removeEventListener(name,stop,true);cancelAnimationFrame(frame);};
    for(const name of ['pointerdown','wheel','keydown'])window.addEventListener(name,stop,{capture:true,once:true});restoreCleanup=stop;requestAnimationFrame(apply);
  }
  $('#site-choice').querySelector('strong').append(icon('chevron'));$('#site-choice').onclick=e=>{choices('Choose site',[[C.PATRIOTS,'The Donald'],[C.SCORED,'Scored.co']],state.site,value=>action(()=>switchSite(value)),e.currentTarget);$('#site-choice').setAttribute('aria-expanded','true');$('#dropdown').style.width='200px';$('#dropdown').style.left=Math.max(8,Math.min(innerWidth-208,$('#site-choice strong').getBoundingClientRect().left))+'px';};
  window.ReaderBack=back;$('#downloads').onclick=()=>navigate('downloads');$('#settings').onclick=()=>navigate('settings');
  $('#communities').onclick=()=>state.page==='communities'?back():navigate('communities');
  document.querySelectorAll('#nav button').forEach(n=>n.onclick=()=>{if(n.dataset.page!==state.page){state.stack=[];if(n.dataset.page==='profile'){state.profileUser=state.username;state.profileTab='overview';state.profileModels={};}navigate(n.dataset.page,false);}});
  function loading(message='Loading…'){replace(main,text('div',message,'spinner'));}
  function empty(title,detail,extra){replace(main,el('div',{class:'empty'},text('h1',title),text('p',detail),extra));}
  function failure(error,retry){empty('Couldn’t load this page',error.message,button('Retry',retry,'secondary'));}
  function cachedNotice(result){return result.cached?text('div',`Saved copy · last updated ${new Date(result.savedAt).toLocaleString()}. Reconnect and refresh for current information.`,'notice'):null;}
  function ago(time){const minutes=Math.max(0,Math.floor((Date.now()-Number(time))/60000));return minutes<60?minutes+'m':minutes<1440?Math.floor(minutes/60)+'h':Math.floor(minutes/1440)+'d';}
  function plain(value){const doc=new DOMParser().parseFromString(String(value||''),'text/html');return doc.body.textContent||'';}
  function postText(p){return p.raw_content||plain(p.content);}
  function richContent(html,fallback,cls='content',discussionURL=''){
    const box=el('div',{class:cls+' rich'}),attachments=new Map();
    const allowed=new Set(['P','BR','STRONG','B','EM','I','U','S','UL','OL','LI','BLOCKQUOTE','CODE','PRE','A','H1','H2','H3','HR']);
    const skipped=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','TEMPLATE','FORM','INPUT','BUTTON']);
    function link(url,label){
      const safe=C.safeURL(typeof url==='string'&&url.startsWith('/')&&!url.startsWith('//')?state.site+url:url);if(!safe)return document.createTextNode(label);
      const media=C.media({link:safe});
      if(['video','audio'].includes(media.kind)&&(attachments.has(safe)||attachments.size<4)){
        attachments.set(safe,media);if(label.trim()===url)return document.createTextNode('');
      }
      const a=el('a',{href:safe,rel:'noopener noreferrer'},label);a.onclick=e=>{e.preventDefault();action(()=>followLink(safe));};return a;
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
    for(const media of attachments.values())box.append(mediaView(media,'Media '+media.kind,{postURL:discussionURL}));
    return box;
  }
  function flair(p){const label=C.cleanFlair(p.post_flair_text);return label?text('span',label,'flair'+(state.settings.plainFlair?'':' art')):null;}
  function openPost(p,focus='post',target=''){state.post=p;state.threadFocus=focus;state.threadTarget=target;if(String(state.threadModel?.post.id)!==String(p.id))state.threadModel=null;return navigate('thread');}
  const voteWrites=new Set();
  const voteKey=(p,isPost,user=state.username,site=state.site)=>JSON.stringify([user.toLowerCase(),site,isPost,String(p.id)]);
  function updateVoteGroups(key,item,busy){for(const group of document.querySelectorAll('.vote-group'))if(group.dataset.voteKey===key){if(item){Object.assign(group.voteItem,{vote_state:item.vote_state,score:item.score});group.querySelector('.score').textContent=Number(item.score).toLocaleString();group.dataset.vote=String(item.vote_state);}group.querySelectorAll('[data-direction]').forEach(b=>{b.disabled=busy;if(item)b.setAttribute('aria-pressed',String(Number(b.dataset.direction)===item.vote_state));});}}
  async function vote(p,direction,isPost=true,node){if(!state.username){toast('Sign in to vote.');return;}const owner=accountContext(),key=voteKey(p,isPost,owner.user,owner.site);if(voteWrites.has(key))return;voteWrites.add(key);updateVoteGroups(key,null,true);await action(async()=>{
    try{const current=p.vote_state??2;await api('/api/v2/action/vote',{id:p.id,type:isPost,direction},'POST',owner.user,owner.site);
      p.vote_state=current===direction?2:direction;
      p.score=Number(p.score||0)+(p.vote_state===0?1:p.vote_state===1?-1:0)-(current===0?1:current===1?-1:0);
      if(owner.current())updateVoteGroups(key,p,true);
    }finally{voteWrites.delete(key);if(owner.current())updateVoteGroups(key,null,false);}
  });}
  function voteControls(p,isPost=true){const up=iconButton('up','Upvote',e=>vote(p,0,isPost,e.currentTarget),'vote'),down=iconButton('down','Downvote',e=>vote(p,1,isPost,e.currentTarget),'vote');up.dataset.direction='0';down.dataset.direction='1';
    const key=voteKey(p,isPost);up.disabled=down.disabled=voteWrites.has(key);up.setAttribute('aria-pressed',String(p.vote_state===0));down.setAttribute('aria-pressed',String(p.vote_state===1));const group=el('div',{class:'vote-group',role:'group','aria-label':'Vote','data-vote':p.vote_state??2,'data-vote-key':key},up,text('span',Number(p.score||0).toLocaleString(),'score'),down);group.voteItem=p;return [group];}
  function postCard(p,detail=false,bookmarkOwner=state.username){p.site=p.site||state.site;
    if(isBlocked(p.author))return el('article',{class:'blocked-post',hidden:true});
    const m=C.media(p),card=el('article',{class:'post '+(detail||state.settings.layout==='cards'?'card':'compact'),'data-post-id':p.id});
    const title=detail?text('h1',p.title):button(p.title,()=>openPost(p),'post-title');
    const community=state.site===C.SCORED&&p.community?button('c/'+p.community,()=>changeCommunity(p.community),'community-link'):null;
    const meta=el('div',{class:'meta'},community,authorLink(p.author),p.author_flair_text?el('span',{class:'flair',title:'User flair'},C.cleanFlair(p.author_flair_text)):null,text('span',ago(p.created)),p.is_stickied?text('span','Pinned','pin'):null,p.domain?text('span',p.domain):null);
    const copy=el('div',{class:'post-copy'},title,flair(p),meta);
    const top=el('div',{class:'post-top'},copy);if(!detail&&state.settings.layout==='compact'&&m.kind==='image'){
      const img=el('img',{class:'thumb',src:m.url,alt:'Post image',loading:'lazy',referrerpolicy:'no-referrer'});imageOpener(img,m.url,p.title);top.append(img);
    }card.append(top);
    const discussionURL=C.postURL(p);
    if(detail&&postText(p))card.append(richContent(p.content,p.raw_content,'content',discussionURL));
    const embedded=C.preview(p);
    if(['twitter','youtube','rumble','truth','article'].includes(embedded.kind))card.append(linkPreview(embedded,p,detail));
    else if((detail||state.settings.layout==='cards')&&m.kind!=='link')card.append(mediaView(m,p.title,{url:C.safeURL(p.link)||m.url,postURL:discussionURL}));
    else if(m.kind!=='link')card.append(sourceToolbar(C.safeURL(p.link)||m.url,discussionURL));
    const saved=bookmarkIDs(bookmarkOwner).has(String(p.id))||(state.page==='saved'&&state.savedTab==='website');
    const save=iconButton('bookmark',saved?'Unsave post':'Save post',e=>action(()=>toggleSaved(p,bookmarkOwner,e.currentTarget),e.currentTarget),'action-icon save-post');save.setAttribute('aria-pressed',String(saved));
    const comments=button('',()=>{if(detail)scrollToComments();else openPost(p,'comments');},'comment-count');comments.setAttribute('aria-label',`${p.comments||0} comments`);comments.append(icon('comment'),text('span',Number(p.comments||0).toLocaleString()));
    const actions=el('div',{class:'actions post-actions'},...voteControls(p),comments,el('span',{class:'action-spacer'}),save,iconButton('more','Post actions',e=>postMenu(p,e.currentTarget),'action-icon'));
    card.append(actions);return card;
  }
  function previewImage(url,alt,cls){const image=el('img',{src:C.safeURL(url),alt,loading:'lazy',class:cls,referrerpolicy:'no-referrer'});image.addEventListener('error',()=>{image.hidden=true;image.parentElement?.classList.add('image-unavailable');},{once:true});return image;}
  function linkCopies(tools,url,discussionURL){
    for(const [name,label,value,message]of [['link','Copy original link',url,'Original link copied.'],['copy','Copy post link',discussionURL,'Post link copied.']]){
      const target=C.safeURL(value);if(!target)continue;
      tools.append(iconButton(name,label,e=>action(async()=>{await rpc('copyText',{text:target});toast(message);},e.currentTarget),'icon copy-link'));
    }
  }
  function sourceToolbar(url,discussionURL,label='',open=null){
    const tools=el('div',{class:'media-tools media-toolbar source-toolbar'});linkCopies(tools,url,discussionURL);
    if(label&&open)tools.append(button(label,open,'original-link'));return tools;
  }
  function tweetPreview(tweet,url,discussionURL='',depth=0){
    const box=el('div',{class:'tweet-preview'}),author=tweet.user||{};
    const avatar=C.safeURL(author.profilePicture)?previewImage(author.profilePicture,'','tweet-avatar'):text('span',(author.displayName||'X').slice(0,1),'tweet-avatar initials');
    const identity=el('div',{class:'tweet-identity'},text('strong',author.displayName||author.username||'Post on X'),text('span',author.username?'@'+author.username:'','muted'));
    const open=text('span','X','provider-mark');
    box.append(el('div',{class:'tweet-author'},avatar,identity,open),text('div',String(tweet.content||'Open the original post to view its text.').trim(),'tweet-text'));
    const video=tweet.video&&C.safeURL(tweet.video.url);
    if(video)box.append(mediaView({kind:'video',url:video,poster:C.safeURL(tweet.video.preview),aspectRatio:tweet.video.aspectRatio},'Video from '+(author.username||'X'),{url,postURL:discussionURL,label:'Open in X',open:()=>action(()=>rpc('openX',{url}))}));
    else if(Array.isArray(tweet.images)){
      const gallery=el('div',{class:'tweet-images'+(tweet.images.length>1?' multiple':'')});
      for(const image of tweet.images.slice(0,4)){const src=C.safeURL(image.url);if(src){const img=previewImage(src,'Image from '+(author.displayName||'X'),'tweet-image');imageOpener(img,src,'Post on X');gallery.append(img);}}
      if(gallery.childNodes.length)box.append(gallery);
    }
    if(depth===0&&tweet.quotedTweet&&typeof tweet.quotedTweet==='object'){
      const q=tweet.quotedTweet,quser=q.user?.username||'i';const qurl=/^[0-9]+$/.test(String(q.id))?`https://x.com/${encodeURIComponent(quser)}/status/${q.id}`:url;
      box.append(tweetPreview(q,qurl,discussionURL,1));
    }
    if(tweet.linkEmbed&&typeof tweet.linkEmbed==='object'){const link=tweet.linkEmbed;box.append(text('div',link.title||link.description||'','tweet-link-title'));}
    if(tweet.poll)box.append(text('p','Poll · view on X','muted'));
    if(!video)box.append(sourceToolbar(url,discussionURL,'Open in X',()=>action(()=>rpc('openX',{url}))));
    return box;
  }
  const truthLoads=new WeakMap();
  const truthObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){truthObserver.unobserve(entry.target);truthLoads.get(entry.target)?.();}},{rootMargin:'300px 0px'});
  function truthPreview(item,discussionURL){
    const card=el('div',{class:'link-preview truth'}),body=el('div',{class:'truth-body'});
    const open=()=>action(()=>rpc('external',{url:item.url}));
    const original=()=>sourceToolbar(item.url,discussionURL,'Open in Truth Social',open);
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
        replace(body,el('div',{class:'tweet-author'},avatar,identity,text('span','Truth Social','provider-mark')),cachedNotice(result),richContent(post.content,'','truth-text',discussionURL));
        let hasMediaControls=false;
        for(const attachment of (Array.isArray(post.media_attachments)?post.media_attachments:[]).slice(0,8)){
          const url=C.safeURL(attachment?.url);if(!url)continue;
          const title=value(attachment.description,'Media from '+name),poster=C.safeURL(attachment.preview_url);
          const kind=attachment.type==='image'?'image':['video','gifv'].includes(attachment.type)?'video':attachment.type==='audio'?'audio':'';
          if(!kind)continue;
          const dimensions=attachment.meta?.original;
          body.append(mediaView({kind,url,poster,aspectRatio:dimensions?[dimensions.width,dimensions.height]:undefined},title,{url:item.url,postURL:discussionURL,label:'Open in Truth Social',open}));
          hasMediaControls=true;
        }
        if(hasMediaControls)card.querySelector(':scope > .source-toolbar')?.remove();
      }catch(error){
        if(card.isConnected){replace(body,text('p','Couldn’t load this Truth Social post.','truth-status'),text('p',error.message,'muted truth-status'),button('Retry',load,'truth-retry'));replace(card,body,original());}
      }finally{busy=false;}
    }
    body.append(text('p','Loading Truth Social post…','muted truth-status'));card.append(body,original());
    truthLoads.set(card,load);truthObserver.observe(card);return card;
  }
  function linkPreview(item,post,detail){
    const discussionURL=C.postURL(post);
    if(item.kind==='twitter')return tweetPreview(item.tweet,item.url,discussionURL);
    const card=el('div',{class:'link-preview '+item.kind});
    if(item.kind==='truth')return truthPreview(item,discussionURL);
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
      card.append(sourceToolbar(item.url,discussionURL,'Open in '+provider,()=>action(()=>rpc('external',{url:item.url}))));
      return card;
    }
    const open=button('',()=>action(()=>rpc('external',{url:item.url})),'article-open');
    if(item.image)open.append(previewImage(item.image,'','article-image'));
    open.append(el('div',{class:'link-description'},text('span',item.domain,'link-domain'),text('strong',item.title),item.description?text('p',item.description):null));card.append(open,sourceToolbar(item.url,discussionURL));return card;
  }
  function postMenu(p,anchor){const m=C.media(p),box=el('div',{class:'choice-list'});
    const row=(name,label,handler)=>{const b=button('',()=>{closeDropdown();handler();},'menu-action');b.append(icon(name),text('span',label));return b;};
    box.append(row('share','Share post',()=>action(()=>rpc('share',{url:C.postURL(p)}))),row('link','Open on website',()=>action(()=>rpc('website',{url:C.postURL(p)}))));
    if(m.kind!=='link')box.append(row('download','Save '+m.kind,()=>saveMedia(m.url,p.title)));
    if(C.owned(p,state.username))box.append(row('bookmark','Edit flair',()=>{const owner=accountContext(),page=state.sequence;flairPicker(p.community,p,async(selected,token)=>{
      if(!owner.current())throw new Error('Your account changed. Reopen this post.');
      await api(selected?'/api/v2/post/set_flair':'/api/v2/post/delete_flair',selected?{id:p.id,flair_text:selected.text,flair_class:selected.class}:{id:p.id},'POST',owner.user,owner.site);
      p.post_flair_text=selected?.text||'';p.post_flair_class=selected?.class||'';
      if(owner.current()&&ownsSheet(token)){closeSheet();if(page===state.sequence){const position={scroll:scrollY,anchor:scrollAnchor()};if(state.page==='thread'){state.returning=true;await threadPage(p);}else feedPage();if(page===state.sequence)restoreScroll(position,page);}}
    });}));
    addSafetyActions(box,p,true,p);openDropdown('Post actions',box,anchor,box.children.length);
  }
  function fileName(url,title){const suffix=new URL(url).pathname.split('/').pop()||'media';return (title||'media').replace(/[^a-z0-9 _-]/gi,'').slice(0,50)+'-'+suffix;}
  async function saveMedia(url,title){await action(async()=>{const r=await rpc('download',{url,name:fileName(url,title)});toast(r.duplicate?'Already in Downloads.':'Download started. Find it in Downloads.');});}
  function imageOpener(image,url,title,localDownload){
    image.classList.add('image-open');image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label','View image: '+(title||'Post image'));
    image.onclick=()=>viewImage(url,title,localDownload);image.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();image.click();}});
  }
  function fitImageDialog(){imageViewer?.fit();}
  window.addEventListener('resize',fitImageDialog);
  function viewImage(url,title,localDownload){
    const image=el('img',{src:url,alt:title,referrerpolicy:'no-referrer',draggable:'false'});
    const feedback=el('div',{class:'image-feedback',role:'status'},'Loading image…');
    const actionStatus=text('p','','image-action-status'),snapshotNotice=el('div',{class:'image-snapshot-notice',role:'status',hidden:true});actionStatus.setAttribute('role','status');actionStatus.setAttribute('aria-live','polite');
    let viewerToken,stale=false,staleKey='',latestLocal=localDownload;const actionButtons=[];
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
    function fit(preserveZoom=false){
      if(!loaded||!view.isConnected)return;
      const priorScale=scale,focusX=baseWidth>0 ? .5-x/(baseWidth*scale) : .5,focusY=baseHeight>0 ? .5-y/(baseHeight*scale) : .5;
      const dialog=$('#sheet'),width=Math.max(1,innerWidth-14);let ratio;
      // Local-image actions can wrap on narrow portraits; measure that chrome at its fitted width.
      for(let n=0;n<2;n++){const chrome=dialog.querySelector('.sheet-head').offsetHeight+dialog.querySelector('.image-footer').offsetHeight;ratio=Math.min(width/image.naturalWidth,Math.max(44,innerHeight-chrome-14)/image.naturalHeight,1);dialog.style.setProperty('--image-width',Math.min(width+2,Math.max(220,Math.ceil(image.naturalWidth*ratio)+2))+'px');}
      baseWidth=image.naturalWidth*ratio;baseHeight=image.naturalHeight*ratio;
      view.style.height=baseHeight+'px';image.style.width=baseWidth+'px';image.style.height=baseHeight+'px';
      scale=preserveZoom?priorScale:1;x=preserveZoom?(.5-focusX)*baseWidth*scale:0;y=preserveZoom?(.5-focusY)*baseHeight*scale:0;points.clear();gesture=tap=lastTap=null;render();
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
    function setActionStatus(message,error=false){if(!ownsSheet(viewerToken)||controller.signal.aborted)return;actionStatus.textContent=message;actionStatus.classList.toggle('media-error',error);fit(true);}
    function viewerAction(label,operation,success){
      const node=button(label,async()=>{
        if(node.disabled||stale||!ownsSheet(viewerToken))return;node.disabled=true;node.dataset.busy='true';setActionStatus(label==='Share'?'Opening sharing…':label==='Copy image'?'Copying image…':'Saving…');
        try{const result=await operation();setActionStatus(typeof success==='function'?success(result):success);}
        catch(error){setActionStatus(error.message,true);}
        finally{delete node.dataset.busy;if(node.isConnected&&ownsSheet(viewerToken))node.disabled=stale;}
      });actionButtons.push(node);return node;
    }
    const tools=localDownload?[
      viewerAction('Save copy',()=>rpc('export',{...downloadArgs(localDownload),name:localDownload.name}),'Copy saved.'),
      viewerAction('Share',()=>rpc('share',downloadArgs(localDownload)),'Sharing opened.'),
      ...(canCopyDownload(localDownload)?[viewerAction('Copy image',()=>rpc('copyDownload',downloadArgs(localDownload)),'Image copied. Paste it into an app that accepts images.')]:[])
    ]:[viewerAction('Save image',()=>rpc('download',{url,name:fileName(url,title)}),r=>r.duplicate?'Already in Downloads.':'Download started. Find it in Downloads.'),viewerAction('Share',()=>rpc('share',{url}),'Sharing opened.')];
    const footer=el('div',{class:'image-footer'},snapshotNotice,actionStatus,el('div',{class:'media-tools'},zoom,...tools));
    viewerToken=sheet(title||'Image',el('div',{class:'image-content'+(localDownload?' local-download':'')},view,footer),'image');
    function updateDownload(item){
      if(!localDownload||String(item.id)!==String(localDownload.id)||!ownsSheet(viewerToken)||controller.signal.aborted)return;
      latestLocal=item;const next=localDownloadURL(item),changed=item.available===false||item.status!==8||!next||downloadVersion(item)!==downloadVersion(localDownload);
      const key=JSON.stringify([item.available,item.status,downloadVersion(item),next]);if(changed===stale&&(!stale||key===staleKey))return;staleKey=key;stale=changed;snapshotNotice.hidden=!stale;replace(snapshotNotice);
      for(const node of actionButtons)node.disabled=stale||node.dataset.busy==='true';
      if(stale){
        snapshotNotice.append(text('p',item.available===false||!next?'The local file is unavailable. You are viewing the image opened earlier.':'This file changed. Reload the image before sharing, copying or saving it.'));
        if(item.available!==false&&next)snapshotNotice.append(button('Reload image',()=>{if(ownsSheet(viewerToken))viewImage(localDownloadURL(latestLocal),latestLocal.name,latestLocal);}));
      }
      fit(true);
    }
    imageViewer={fit,updateDownload,downloadId:localDownload?.id,destroy:()=>{controller.abort();image.removeAttribute('src');}};if(image.complete&&image.naturalWidth)imageLoaded();
  }

  pauseObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(!e.isIntersecting)e.target.pause();}),{threshold:.1});
  function mediaView(m,title,original={}){const box=el('div',{class:'media'}),tools=el('div',{class:'media-tools media-toolbar'});if(m.kind==='image'){
      const image=el('img',{src:m.url,alt:title,loading:'lazy',referrerpolicy:'no-referrer'});imageOpener(image,m.url,title);box.append(image);
    }else{
      const player=el(m.kind,{src:m.url,poster:m.poster||undefined,controls:true,preload:'none',playsinline:true});bindSound(player);
      const ratio=m.aspectRatio;if(Array.isArray(ratio)&&ratio.length===2&&ratio.every(n=>Number.isFinite(n)&&n>0))player.style.aspectRatio=ratio[0]+'/'+ratio[1];
      const positions=readLocal(ownKey('playback'),{});player.addEventListener('loadedmetadata',()=>{const position=positions[m.url];if(position&&position<player.duration-2)player.currentTime=position;});
      let lastSaved=0;player.addEventListener('timeupdate',()=>{if(Date.now()-lastSaved<3000)return;lastSaved=Date.now();const p=readLocal(ownKey('playback'),{});p[m.url]=player.currentTime;const entries=Object.entries(p).slice(-100);remember(ownKey('playback'),Object.fromEntries(entries));});
      coordinatePlayback(player);
      const status=text('p','','muted media-status');status.setAttribute('role','status');
      const retry=button('Retry',()=>{status.textContent='';status.className='muted media-status';retry.hidden=true;player.load();player.play().catch(()=>{status.textContent='This media could not play. Retry or open the original.';status.className='media-error media-status';retry.hidden=false;});});retry.hidden=true;
      player.addEventListener('waiting',()=>status.textContent='Buffering…');player.addEventListener('playing',()=>{status.textContent='';status.className='muted media-status';retry.hidden=true;});
      player.addEventListener('error',()=>{status.textContent='This media could not play. Retry or open the original.';status.className='media-error media-status';retry.hidden=false;});
      const rate=text('span','1×');const speed=button('',e=>choices('Playback speed',[.5,1,1.25,1.5,2].map(x=>[x,x+'×']),player.playbackRate,value=>{player.playbackRate=Number(value);rate.textContent=value+'×';speed.setAttribute('aria-label','Playback speed: '+value+'×');},e.currentTarget),'speed-control');speed.setAttribute('aria-label','Playback speed: 1×');speed.setAttribute('aria-haspopup','dialog');speed.append(rate);
      box.append(player,status,retry);tools.append(speed);
      pauseObserver.observe(player);if(m.kind==='video'&&state.settings.autoplay&&!state.metered){player.autoplay=true;player.preload='metadata';}
    }
    tools.append(iconButton('download','Save '+m.kind,()=>saveMedia(m.url,title)));
    linkCopies(tools,original.url||m.url,original.postURL);
    if(m.kind!=='image'||original.label)tools.append(button(original.label||'Open '+m.kind,original.open||(()=>action(()=>rpc('external',{url:m.url}))),'original-link'));
    box.append(tools);return box;
  }
  const commentSorts=[['top','Top'],['new','Newest'],['old','Oldest'],['controversial','Worst']];
  const topRanges=[['hour','Hourly'],['day','Daily'],['week','Weekly'],['month','Monthly'],['all','All-time']];
  function sortPicker(label,items,value,onSelect,cls='sort-control'){
    const current=()=>typeof value==='function'?value():value;
    const choose=button('',e=>choices(label,items,current(),v=>action(()=>onSelect(v)),e.currentTarget),cls);
    choose.setAttribute('aria-label',label+': '+(items.find(([v])=>v===current())?.[1]||current()));choose.setAttribute('aria-haspopup','dialog');
    choose.append(text('span',items.find(([v])=>v===current())?.[1]||current()),icon('chevron'));return choose;
  }
  function authorLink(user){const b=button('u/'+(user||'[deleted]'),()=>openProfile(user),'author-link');b.setAttribute('aria-label','View profile: '+user);return b;}
  function openProfile(user){if(!/^[A-Za-z0-9_-]{1,64}$/.test(user||''))return;if($('#sheet').open)closeSheet();state.profileUser=user;state.profileTab='overview';state.profileModels={};return navigate('profile');}
  function isBlocked(user){return (Array.isArray(state.blocked)?state.blocked:[]).some(name=>String(name).toLowerCase()===String(user).toLowerCase());}
  async function followLink(url){const target=C.readerLink(url);if(!target)return rpc('external',{url});
    if(target.site!==state.site)await switchSite(target.site,target.community||undefined);
    if(target.kind==='community'){if(state.community!==target.community)return changeCommunity(target.community);return navigate('feed');}
    if(target.kind==='profile')return openProfile(target.user);
    state.nextCommentSort=target.sort;state.threadModel=null;return openPost({id:target.id,uuid:target.uuid,title:'Discussion',site:target.site},target.commentId?'comments':'post',target.commentId);
  }
  async function takeReaderLink(){try{const r=await rpc('takeLink');if(C.readerLink(r.url))await followLink(r.url);else if(C.safeURL(r.url))await rpc('website',{url:r.url});}catch(error){toast(error.message);}}
  window.ReaderOpenLink=url=>action(()=>followLink(url));
  async function loadAccountPreferences(){
    if(!state.username)return;const owner=accountContext(),generation=blockGeneration;
    try{const r=await api('/api/v2/user/about.json',{user:'me'});if(!owner.current()||generation!==blockGeneration)return;
      const blocked=r.data.users?.[0]?.blocked;if(Array.isArray(blocked)){const before=JSON.stringify(state.blocked);state.blocked=blocked.filter(x=>typeof x==='string');remember(ownKey('blocked',owner.user),state.blocked);if(before!==JSON.stringify(state.blocked)){const position={scroll:scrollY,anchor:scrollAnchor()},seq=state.sequence;if(state.page==='feed'&&state.feed.length)feedPage();else if(state.page==='thread'&&state.threadModel)renderThread(state.threadModel);else if(state.page==='profile'&&state.profileModels?.[state.profileTab]?.items.length)profilePage();restoreScroll(position,seq);}}
    }catch{} // Cached account preferences remain available while offline.
  }
  function addSafetyActions(box,item,isPost,post){
    box.append(button('Report',()=>{closeDropdown();reportItem(item,isPost,post);},'menu-action'));
    if(item.author&&(!state.username||!C.owned(item,state.username)))box.append(button(isBlocked(item.author)?'Unblock user':'Block user',()=>{closeDropdown();confirmBlock(item.author,!isBlocked(item.author));},'menu-action'));
  }
  function requestSignIn(message){sheet('Sign in',el('div',{},text('p',message),button('Sign in',()=>{closeSheet();action(()=>rpc('login'));},'primary')));}
  function confirmBlock(user,blocked){if(!state.username){requestSignIn('Sign in to manage blocked users.');return;}
    sheet((blocked?'Block ':'Unblock ')+'u/'+user,el('div',{},text('p',blocked?'Hide this user’s posts and comments across the reader?':'Show this user’s posts and comments again?'),button(blocked?'Block user':'Unblock user',e=>action(async()=>{const token=sheetGeneration;await setBlocked(user,blocked);if(ownsSheet(token))closeSheet();},e.currentTarget),'primary')));
  }
  const blockWrites=new Map();
  async function setBlocked(user,desired){
    const owner=accountContext(),seq=state.sequence,key=owner.user.toLowerCase(),previous=blockWrites.get(key)||Promise.resolve();
    const work=previous.catch(()=>{}).then(async()=>{if(!owner.current())throw new Error('Your account changed.');if(!owner.user||C.owned({author:user},owner.user))throw new Error('Choose another user to block.');
    // The website endpoint toggles. Re-read its actual state before sending one toggle.
    const r=await api('/api/v2/user/about.json',{user:'me'},'GET',owner.user,owner.site);if(!owner.current())throw new Error('Your account changed.');
    const blocked=r.data.users?.[0]?.blocked;if(!Array.isArray(blocked))throw new Error('Could not confirm your block list. Please retry.');
    const exists=blocked.some(x=>String(x).toLowerCase()===user.toLowerCase());
    if(exists!==desired)await api('/api/v2/action/block',{target:user},'POST',owner.user,owner.site);
    if(!owner.current())return;++blockGeneration;state.blocked=blocked.filter(x=>String(x).toLowerCase()!==user.toLowerCase());if(desired)state.blocked.push(user);
    remember(ownKey('blocked',owner.user),state.blocked);toast(desired?'User blocked.':'User unblocked.');
    if(seq===state.sequence){if(state.page==='thread'&&state.threadModel)renderThread(state.threadModel);else if(state.page==='feed')feedPage();else if(state.page==='profile'){state.profileModels={};profilePage();}}
    });blockWrites.set(key,work);try{return await work;}finally{if(blockWrites.get(key)===work)blockWrites.delete(key);}
  }
  function blockedUsers(){const box=el('div');for(const user of state.blocked||[])box.append(el('div',{class:'setting'},authorLink(user),button('Unblock',()=>confirmBlock(user,false))));if(!box.children.length)box.append(text('p','No blocked users.','muted'));sheet('Blocked users',box);}
  async function reportItem(item,isPost,post){if(!state.username){requestSignIn('Sign in to report this '+(isPost?'post.':'comment.'));return;}
    const owner=accountContext(),token=sheet('Report '+(isPost?'post':'comment'),text('p','Loading reasons…','muted'));
    try{const r=await api('/api/v2/community/report_reasons',{community:post.community||item.community||'thedonald'});if(!ownsSheet(token)||!owner.current())return;
      const rules=(Array.isArray(r.data.rules)?r.data.rules:[]).map(v=>typeof v==='string'?v:String(v.text||v)),box=el('div');let selected='spam',ruleValue=rules[0]||'';
      const reasonLabels={communityRules:'Community rules',spam:'Spam or self promotion',platformMisuse:'Platform misuse',csam:'Sexualization of minors',illegalContent:'Other illegal content'};
      const reason=sortPicker('Report reason',Object.entries(reasonLabels),()=>selected,v=>{selected=v;reason.querySelector('span').textContent=reasonLabels[v];reason.setAttribute('aria-label','Report reason: '+reasonLabels[v]);rule.hidden=v!=='communityRules';});
      const rule=sortPicker('Community rule',rules.map(v=>[v,v]),()=>ruleValue,v=>{ruleValue=v;rule.querySelector('span').textContent=v;rule.setAttribute('aria-label','Community rule: '+v);});rule.hidden=true;
      box.append(reason,rule,button('Send report',e=>action(async()=>{if(!owner.current())throw new Error('Your account changed.');if(selected==='communityRules'&&!ruleValue)throw new Error('Choose a community rule.');await api('/api/v2/action/report',{target:item.id,post:isPost,reason:selected,customReason:selected==='communityRules'?ruleValue:''},'POST',owner.user,owner.site);if(owner.current()){toast('Report sent.');if(ownsSheet(token))closeSheet();}},e.currentTarget),'primary'));replace($('#sheet-body'),box);
    }catch(error){if(ownsSheet(token))replace($('#sheet-body'),text('p',error.message),button('Retry',()=>reportItem(item,isPost,post)));}
  }
  function commentMenu(comment,post,anchor){const box=el('div',{class:'choice-list'});
    box.append(button('Permalink',()=>{closeDropdown();const url=C.commentURL(post,comment),link=el('a',{href:url},url);link.onclick=e=>{e.preventDefault();closeSheet();action(()=>followLink(url));};sheet('Comment permalink',el('div',{},el('p',{},link),el('div',{class:'dialog-actions'},button('Copy link',()=>action(async()=>{await rpc('copyText',{text:url});toast('Link copied.');})),button('Share',()=>action(()=>rpc('share',{url}))))));},'menu-action'));
    addSafetyActions(box,comment,false,post);openDropdown('Comment actions',box,anchor,box.children.length);
  }
  function contentKey(item){return (item.post_title||item.parent_id?'comment:':'post:')+item.id;}
  function commentSummary(c){if(isBlocked(c.author))return el('div',{hidden:true});
    const post={id:c.parent_id,uuid:c.parent_uuid||c.post_uuid,title:c.post_title||'Discussion',community:c.community,site:state.site},box=el('article',{class:'post profile-comment','data-comment-id':c.id});
    box.append(button(c.post_title||'View discussion',()=>openPost(post,'comments',String(c.id)),'post-title'),el('div',{class:'meta'},authorLink(c.author),text('span',ago(c.created))),richContent(c.content,c.raw_content,'comment-body',C.postURL(post)),el('div',{class:'actions'},...voteControls(c,false),button('Open comment',()=>openPost(post,'comments',String(c.id))),iconButton('more','Comment actions',e=>commentMenu(c,post,e.currentTarget))));return box;
  }
  function pagedItems(container,path,params,model,valid,field,render,key=contentKey){
    let busy=false,active=true;const alive=()=>active&&valid(),observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))load();},{rootMargin:'0px 0px 350px 0px'});activeListCleanup=()=>{active=false;observer.disconnect();};
    function tail(){observer.disconnect();container.querySelector('.result-tail')?.remove();if(model.more){const node=text('div','Loading…','feed-tail result-tail');node.setAttribute('role','status');container.append(node);observer.observe(node);}else if(model.items.length)container.append(text('p','You’re caught up.','feed-tail result-tail'));}
    async function load(){if(busy||!alive()||!model.more)return;busy=true;try{
      const page=model.page+1,extra={};if(field==='content'&&model.page){extra.post=model.items.filter(x=>!x.parent_id).length;extra.comment=model.items.filter(x=>x.parent_id).length;}
      const r=await api(path,{...params,...extra,page:path.endsWith('/messages.json')&&params.type==='unread'?1:page});if(!alive())return;const incoming=r.data[field]||[],seen=new Set(model.items.map(key)),added=incoming.filter(x=>!seen.has(key(x))&&(seen.add(key(x)),true));
      model.items.push(...added);model.page=page;model.more=r.data.has_more_entries===true&&added.length>0;
      container.querySelector('.spinner')?.remove();container.querySelector('.result-tail')?.remove();for(const item of added)container.append(render(item));
      if(!model.items.length)container.append(text('p','Nothing here yet.','empty'));tail();
    }catch(error){if(alive()){observer.disconnect();container.querySelector('.result-tail')?.remove();container.querySelector('.spinner')?.remove();container.append(el('div',{class:'feed-tail result-tail'},text('p',error.message),button('Retry',()=>{container.querySelector('.result-tail')?.remove();load();})));}}finally{busy=false;}}
    replace(container,...model.items.map(render));if(model.page)tail();else{container.append(text('div','Loading…','spinner'));return load();}
  }
  let pull=null,pullBusy=false;const pullStatus=text('div','','pull-status');pullStatus.setAttribute('role','status');pullStatus.hidden=true;document.body.append(pullStatus);
  function resetPull(){pull=null;if(!pullBusy)pullStatus.hidden=true;}
  async function refreshCurrent(){if(state.page==='feed')return loadFeed(false);if(state.page==='thread')return threadPage(state.post);if(state.page==='profile'){state.profileModels={};return profilePage();}if(state.page==='inbox'){state.inboxModel=null;return inboxPage();}}
  main.addEventListener('touchstart',e=>{if(pullBusy||scrollY>0||e.touches.length!==1||document.querySelector('dialog[open]')||!['feed','thread','profile','inbox'].includes(state.page)||e.target.closest('input,textarea,select,video,audio,iframe,.image-open,.sort-control,.top-range'))return;pull={x:e.touches[0].clientX,y:e.touches[0].clientY,distance:0,seq:state.sequence};},{passive:true});
  main.addEventListener('touchmove',e=>{if(!pull)return;if(e.touches.length!==1||pull.seq!==state.sequence){resetPull();return;}const dx=e.touches[0].clientX-pull.x,dy=e.touches[0].clientY-pull.y;if(dy<0||Math.abs(dx)>Math.max(12,dy)){resetPull();return;}if(scrollY>0){resetPull();return;}if(dy>10){if(e.cancelable)e.preventDefault();pull.distance=dy;pullStatus.hidden=false;pullStatus.textContent=dy>=72?'Release to refresh':'Pull to refresh';}},{passive:false});
  main.addEventListener('touchend',()=>{const refresh=pull&&pull.distance>=72&&pull.seq===state.sequence;resetPull();if(refresh){pullBusy=true;pullStatus.hidden=false;pullStatus.textContent='Refreshing…';Promise.resolve(refreshCurrent()).catch(error=>toast(error.message)).finally(()=>{pullBusy=false;pullStatus.hidden=true;});}},{passive:true});main.addEventListener('touchcancel',resetPull,{passive:true});
  let siteSelection=0;
  const sitePref=(name,site=state.site)=>(site===C.SCORED?'reader:scored:':'reader:')+name;
  const communityPref=(site=state.site,user=state.username)=>site===C.SCORED?ownKey('scoredCommunity',user):sitePref('community',site);
  const defaultScoredFeed=(user=state.username)=>user?'home':'trending';
  function selectedCommunity(site=state.site,user=state.username){
    if(site===C.PATRIOTS)return 'thedonald';
    const fallback=defaultScoredFeed(user),name=readLocal(communityPref(site,user),fallback);
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(name))return fallback;
    const view=C.scoredFeedView(name);return view==='home'&&!user?'trending':view||name;
  }
  function updateHeader(){
    $('#communities').setAttribute('aria-pressed',String(state.page==='communities'));
    if(state.page==='communities'){$('#subtitle').textContent='Communities';return;}
    if(state.site===C.SCORED){const community=state.page==='thread'?state.post?.community||state.community:state.community;$('#subtitle').textContent=({home:'Home',trending:'Trending',all:'All communities'})[C.scoredFeedView(community)]||'c/'+community;}
    else $('#subtitle').textContent=state.page==='feed'?'TheDonald':({compose:'New post',thread:'Discussion',profile:state.profileUser||state.username||'Your account',downloads:'Downloads',saved:'Saved posts',settings:'Your preferences',inbox:'Inbox',search:'Search'}[state.page]||'TheDonald');
  }
  async function switchSite(site,community){
    if(![C.PATRIOTS,C.SCORED].includes(site))throw new Error('Unsupported site.');
    if(site===state.site){if(community&&community!==state.community)return changeCommunity(community);if(site===C.SCORED&&!C.scoredFeedView(state.community))return changeCommunity(defaultScoredFeed());if(state.page!=='feed'){state.feed=[];state.more=false;state.feedCached=null;return navigate('feed');}return loadFeed(false);}
    const selection=++siteSelection;$('#site-choice').disabled=true;
    try{const data=await rpc('selectSite',{site});if(selection!==siteSelection)return;
      if(data.site!==site)throw new Error('The site could not be selected.');
      if($('#sheet').open)closeSheet();state.site=site;state.community=community||selectedCommunity(site,data.username||'');remember(communityPref(site,data.username||''),state.community);
      state.sort=readLocal(sitePref('sort'),'hot');if(!['hot','new','active','rising','top'].includes(state.sort))state.sort='hot';
      state.topRange=readLocal(sitePref('topRange'),'day');if(!topRanges.some(([v])=>v===state.topRange))state.topRange='day';
      accountChanged(data.username,null,!!data.sessionNeedsReset);
    }finally{if(selection===siteSelection)$('#site-choice').disabled=false;}
  }
  function changeCommunity(community){
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(community))return;
    navigation('feed');state.community=community;remember(communityPref(),community);state.feed=[];state.more=false;state.feedCached=null;state.searchModel=null;updateHeader();return feedPage();
  }
  async function openCommunity(name){
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(name))return;
    if(state.site===C.SCORED)return changeCommunity(name);
    const user=state.username,position=scrollY;
    await switchSite(C.SCORED,name);
    if(state.site===C.SCORED&&state.username===user&&state.page==='feed'){
      state.stack.push({page:'communities',community:name,sort:state.sort,topRange:state.topRange,feed:[],more:false,scroll:position});updateHeader();
    }
  }
  function communitiesPage(){
    const owner=accountContext(),seq=state.sequence;let active=true,current,timer,subscriptions=null,subscriptionRead=null,writing=false;
    const ownsPage=()=>active&&seq===state.sequence&&state.page==='communities'&&owner.current();
    const valid=model=>ownsPage()&&current===model;
    const validName=name=>typeof name==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(name);
    const key=ownKey('communitiesTab',owner.user);let tab=readLocal(key,owner.user?'subscribed':'recommended');if(!['subscribed','recommended','all'].includes(tab))tab='recommended';
    const tabs=el('div',{class:'communities-tabs',role:'tablist','aria-label':'Browse communities'}),search=el('input',{type:'search',placeholder:'Find a community…','aria-label':'Search communities',class:'community-search-box'}),notice=el('div',{class:'subscription-status',role:'status'}),list=el('div',{class:'community-results'}),status=el('div',{class:'community-status',role:'status'});
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&current?.more&&!current.busy)load(current);},{rootMargin:'0px 0px 300px 0px'});
    activeListCleanup=()=>{active=false;clearTimeout(timer);observer.disconnect();};
    for(const[value,label]of [['subscribed','Subscribed'],['recommended','Recommended'],['all','All']]){
      const b=button(label,()=>{tab=value;remember(key,tab);search.value='';reset();});b.setAttribute('role','tab');b.dataset.tab=value;tabs.append(b);
    }
    function syncStars(){
      for(const b of list.querySelectorAll('.community-subscribe')){
        const selected=!!subscriptions?.has(b.dataset.community.toLowerCase()),label=(selected?'Unsubscribe from ':'Subscribe to ')+'c/'+b.dataset.community;
        b.disabled=!!owner.user&&(subscriptions===null||writing);b.classList.toggle('is-subscribed',selected);b.setAttribute('aria-pressed',String(selected));b.setAttribute('aria-label',label);b.title=label;
      }
    }
    function readSubscriptions(){
      if(subscriptions!==null)return Promise.resolve(subscriptions);
      if(subscriptionRead)return subscriptionRead;
      subscriptionRead=(async()=>{
        try{
          const result=await api('/api/v2/user/about.json',{user:'me'},'GET',owner.user,C.SCORED);if(!ownsPage())return null;
          const user=result.data.users?.[0];if(!user||String(user.username).toLowerCase()!==owner.user.toLowerCase()||!Array.isArray(user.subscribed))throw new Error('Could not read your subscribed communities.');
          subscriptions=new Map(user.subscribed.filter(validName).map(name=>[name.toLowerCase(),name]));replace(notice);syncStars();return subscriptions;
        }catch(error){if(ownsPage())replace(notice,text('p',error.message,'muted'),button('Retry subscriptions',()=>{readSubscriptions().then(()=>{if(ownsPage()&&tab==='subscribed')reset();}).catch(()=>{});},'secondary'));throw error;}
        finally{subscriptionRead=null;}
      })();return subscriptionRead;
    }
    async function toggleSubscription(name){
      if(!owner.user){requestSignIn('Sign in to subscribe to communities.');return;}
      if(!ownsPage()||subscriptions===null||writing)return;
      const selected=!subscriptions.has(name.toLowerCase());writing=true;syncStars();
      try{
        await api('/api/v2/community/'+(selected?'subscribe':'unsubscribe'),{community:name},'POST',owner.user,C.SCORED);
        if(!ownsPage())return;subscriptions=null;await readSubscriptions();if(!ownsPage())return;
        if(subscriptions.has(name.toLowerCase())!==selected)throw new Error('The website has not confirmed the subscription change. Your current subscriptions are shown.');
        if(tab==='subscribed')reset();toast((selected?'Subscribed to ':'Unsubscribed from ')+'c/'+name+'.');
      }catch(error){
        if(!ownsPage())return;toast(error.message);
        // A connection can fail after the site saves a change. Read back without
        // repeating the write, so Retry can never silently toggle it twice.
        subscriptions=null;try{await readSubscriptions();if(ownsPage()&&tab==='subscribed')reset();}catch{}
      }finally{writing=false;if(ownsPage())syncStars();}
    }
    function renderRow(c){
      const open=button('',()=>{},'community-open');open.append(text('strong','c/'+c.name));
      const star=iconButton('star','Subscribe to c/'+c.name,e=>{e.stopPropagation();toggleSubscription(c.name);},'community-subscribe');star.dataset.community=c.name;
      const details=el('div',{class:'community-details'},el('div',{class:'community-heading'},open,star));if(c.description||c.display_name)details.append(text('small',c.description||c.display_name));
      const row=el('div',{class:'community-result',onclick:()=>action(()=>openCommunity(c.name),open)},details);
      if(state.site===C.SCORED&&c.name.toLowerCase()===state.community.toLowerCase())open.setAttribute('aria-current','true');return row;
    }
    async function load(model){
      if(!valid(model)||model.busy||!model.more)return;model.busy=true;observer.unobserve(status);replace(status,text('p','Loading communities…','muted'));
      try{
        let rows,more;
        if(model.tab==='subscribed'){
          if(!owner.user){model.more=false;replace(status,text('p','Sign in to see your subscribed communities.','muted'),button('Sign in',()=>requestSignIn('Sign in to see your subscribed communities.'),'secondary'));return;}
          if(!model.names){
            const names=await readSubscriptions();if(!valid(model))return;
            model.names=[...names.values()].filter(name=>name.toLowerCase().includes(model.query.toLowerCase())).sort((a,b)=>a.localeCompare(b));
          }
          const names=model.names.slice(model.page*25,(model.page+1)*25);more=(model.page+1)*25<model.names.length;
          if(names.length){
            const result=await api('/api/v2/community/community.json',{communities:names.join(',')},'GET',owner.user,C.SCORED);if(!valid(model))return;
            if(!Array.isArray(result.data.communities))throw new Error('Could not load community details.');
            const details=new Map(result.data.communities.filter(c=>c&&validName(c.name)).map(c=>[c.name.toLowerCase(),c]));rows=names.map(name=>details.get(name.toLowerCase())||{name});
          }else rows=[];
        }else{
          const result=await api(model.query?'/api/v2/community/search.json':'/api/v2/community/communities.json',model.query?{query:model.query}:{sort:'activity',topic:model.tab,page:model.page+1,showPolitics:true},'GET',owner.user,C.SCORED);if(!valid(model))return;
          if(!Array.isArray(result.data.communities))throw new Error('Could not load communities.');rows=result.data.communities;more=!model.query&&!!result.data.has_more_entries;
        }
        if(!valid(model))return;let added=0;
        for(const c of rows)if(c&&validName(c.name)&&!model.seen.has(c.name.toLowerCase())){model.seen.add(c.name.toLowerCase());list.append(renderRow(c));added++;}
        syncStars();model.page++;model.more=more&&added>0;
        if(model.more){replace(status,text('p','Loading more communities…','muted'));observer.observe(status);}
        else if(!model.seen.size)replace(status,text('p',model.query?'No matching communities.':model.tab==='subscribed'?'No subscribed communities yet. Choose Recommended or All to browse.':'No communities found.','muted'));
        else replace(status);
      }catch(error){if(valid(model))replace(status,text('p',error.message,'muted'),button('Retry',()=>load(model),'secondary'));}
      finally{model.busy=false;}
    }
    function reset(){
      clearTimeout(timer);observer.disconnect();for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.tab===tab));replace(list);current={tab,query:search.value.trim(),page:0,seen:new Set(),more:true,busy:false};return load(current);
    }
    search.oninput=()=>{clearTimeout(timer);observer.disconnect();current=null;timer=setTimeout(reset,300);};
    replace(main,el('section',{class:'communities-panel'},tabs,search,notice,list,status));if(owner.user)readSubscriptions().catch(()=>{});return reset();
  }
  async function communityPicker(current,onSelect){
    const site=state.site,token=sheet('Choose community',el('div')),input=el('input',{type:'search',placeholder:'Search communities','aria-label':'Search communities',class:'community-search'}),results=el('div');let timer,generation=0;
    replace($('#sheet-body'),input,results);
    async function load(){const request=++generation;replace(results,text('p','Loading communities…','muted'));try{
        const query=input.value.trim(),r=await api(query?'/api/v2/community/search.json':'/api/v2/community/communities.json',query?{query}:{sort:'all',page:1},'GET',state.username,site);
        if(site!==state.site||!ownsSheet(token)||request!==generation)return;
        const rows=(r.data.communities||[]).filter(c=>c&&/^[A-Za-z0-9_-]{1,64}$/.test(c.name));replace(results);
        for(const c of rows){const b=button('',()=>onSelect(c.name),'community-choice');b.append(text('strong','c/'+c.name),text('span',c.display_name&&c.display_name!==c.name?c.display_name:c.description||'','muted'));if(c.name.toLowerCase()===String(current).toLowerCase())b.setAttribute('aria-current','true');results.append(b);}
        if(!rows.length)results.append(text('p','No matching communities.','muted'));
      }catch(error){if(ownsSheet(token)&&site===state.site&&request===generation)replace(results,text('p',error.message),button('Retry',load));}}
    input.oninput=()=>{clearTimeout(timer);timer=setTimeout(load,200);};await load();
  }
  function feedToolbar(){const sort=button('',e=>choices('Sort posts',['hot','new','active','rising','top'].map(v=>[v,v[0].toUpperCase()+v.slice(1)]),state.sort,value=>{state.sort=value;remember(sitePref('sort'),value);state.feed=[];state.more=false;state.feedCached=null;feedPage();},e.currentTarget), 'sort-control');
    const scored=state.site===C.SCORED,tabs=scored?el('div',{class:'feed-tabs',role:'tablist','aria-label':'Scored feed'}):null;
    if(scored)for(const[view,label]of [['home','Home'],['trending','Trending'],['all','All']]){
      tabs.append(el('button',{type:'button',role:'tab','aria-selected':String(C.scoredFeedView(state.community)===view),'data-feed':view,onclick:()=>{
        if(view==='home'&&!state.username){requestSignIn('Sign in to read your subscribed communities in Home.');return;}
        if(state.community===view)return;
        navigation('feed',false);state.community=view;remember(communityPref(),view);state.feed=[];state.more=false;state.feedCached=null;state.searchModel=null;updateHeader();feedPage();
      }},label));
    }
    sort.setAttribute('aria-label','Sort posts: '+state.sort);sort.setAttribute('aria-haspopup','dialog');sort.append(...(scored?[]:[icon('sort')]),text('span',state.sort[0].toUpperCase()+state.sort.slice(1)),icon('chevron'));
    const layout=iconButton(state.settings.layout==='compact'?'grid':'list',state.settings.layout==='compact'?'Switch to image cards':'Switch to compact posts',()=>action(async()=>{const seq=state.sequence,site=state.site;state.settings.layout=state.settings.layout==='compact'?'cards':'compact';await saveSettings();if(seq===state.sequence&&site===state.site&&state.page==='feed')feedPage();}));
    const range=sortPicker('Top posts period',topRanges,state.topRange||'day',value=>{state.topRange=value;remember(sitePref('topRange'),value);state.feed=[];state.more=false;state.feedCached=null;feedPage();},'top-range');range.hidden=state.sort!=='top';
    if(scored)return el('div',{class:'toolbar feed-toolbar scored-toolbar'},tabs,sort,range);
    return el('div',{class:'toolbar feed-toolbar'},sort,range,el('span',{class:'action-spacer'}),layout,iconButton('refresh','Refresh feed',()=>loadFeed(false)));
  }
  function feedPage(){replace(main,feedToolbar(),...(state.feed.length?state.feed.map(p=>postCard(p)):[text('div','Loading posts…','spinner')]));if(state.feed.length){if(state.feedCached)main.insertBefore(cachedNotice(state.feedCached),main.children[1]);addMore();}else loadFeed(false);}
  const feedObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting&&state.page==='feed'&&state.more&&!feedBusy){feedObserver.unobserve(entry.target);loadFeed(true,entry.target);}},{rootMargin:'0px 0px 500px 0px'});
  function addMore(){feedObserver.disconnect();main.querySelector('.feed-tail')?.remove();if(state.more){const tail=text('div','Loading more posts…','feed-tail');tail.setAttribute('role','status');main.append(tail);feedObserver.observe(tail);}else if(state.feed.length)main.append(text('p','You’re caught up.','feed-tail'));}
  async function loadFeed(append,node){if(append&&feedBusy)return;const seq=state.sequence,load=++feedLoad;feedBusy=true;if(node)node.disabled=true;try{
      const request=C.feedRequest(state.site,state.community,state.sort,state.topRange||'day',append&&state.feed.length?state.feed.at(-1).uuid:'');
      const result=await api(request.path,request.params);if(seq!==state.sequence||state.page!=='feed'||load!==feedLoad)return;
      const merged=C.mergePosts(append?state.feed:[],result.data.posts||[]);state.feed=merged.posts;
      state.more=!!result.data.has_more_entries&&merged.added.length>0;state.feedCached=result.cached?result:append?state.feedCached:null;
      if(append){main.querySelector('.feed-tail')?.remove();const fragment=document.createDocumentFragment();if(result.cached)fragment.append(cachedNotice(result));for(const p of merged.added)fragment.append(postCard(p));main.append(fragment);}
      else{replace(main,feedToolbar(),cachedNotice(result),...state.feed.map(p=>postCard(p)));if(!state.feed.length){main.append(text('p',state.site===C.SCORED&&C.scoredFeedView(state.community)==='home'?'No posts in your Home feed.':'No posts found.','empty'));if(state.site===C.SCORED&&C.scoredFeedView(state.community)==='home')main.append(button('Browse communities',()=>navigate('communities'),'browse-communities'));}window.scrollTo(0,0);}
      addMore();
      if(state.settings.preload&&!state.metered)state.feed.slice(0,6).forEach(p=>{const m=C.media(p);if(m.kind==='image'){const image=new Image();image.referrerPolicy='no-referrer';image.src=m.url;}});
    }catch(e){if(seq===state.sequence&&load===feedLoad){if(append&&state.feed.length){const tail=node?.isConnected?node:el('div',{class:'feed-tail'});replace(tail,text('p',e.message),button('Retry loading posts',()=>loadFeed(true,tail)));if(!tail.isConnected)main.append(tail);}else failure(e,()=>loadFeed(false));}}finally{if(load===feedLoad)feedBusy=false;if(node?.isConnected)node.disabled=false;}}
  function scrollToComments(){const area=$('#comments');if(!area)return;area.scrollIntoView({block:'start'});area.focus({preventScroll:true});}
  async function threadPage(post){
    replyCleanup?.();replyCleanup=null;
    const seq=state.sequence,load=++threadLoad,returning=!!state.returning,sort=state.nextCommentSort||state.commentSort||'top';state.nextCommentSort='';state.returning=false;loading('Loading discussion…');
    try{const result=await api('/api/v2/post/post.json',{id:post.id||post.uuid,comments:true,commentSort:sort});if(seq!==state.sequence||load!==threadLoad)return;
      const p=result.data.posts?.[0]||post,previous=state.threadModel;p.site=state.site;
      const model={post:p,sort,comments:result.data.comments||[],result,seq,load,collapsed:previous&&String(previous.post.id)===String(p.id)?previous.collapsed:new Set()};
      if(returning&&previous&&String(previous.post.id)===String(p.id)&&previous.sort===sort){const fresh=new Set(model.comments.map(c=>String(c.id)));model.comments=C.mergeComments(model.comments,previous.comments.filter(c=>!fresh.has(String(c.id))));}
      state.post=p;state.threadModel=model;updateHeader();
      if(state.threadTarget){const target=String(state.threadTarget);if(!model.comments.some(c=>String(c.id)===target)||model.comments.find(c=>String(c.id)===target)?.is_descendent_break){
          const extra=await api('/api/v2/comment/thread',{id:target,sort,d:0});if(seq!==state.sequence||load!==threadLoad)return;model.comments=C.mergeComments(model.comments,extra.data.comments||[]);
        }}
      if(returning&&previous&&String(previous.post.id)===String(p.id))model.focusRoot=previous.focusRoot;
      renderThread(model);
      if(state.threadTarget&&!main.querySelector('[data-comment-id="'+String(state.threadTarget)+'"]')&&model.comments.some(c=>String(c.id)===String(state.threadTarget))){model.focusRoot=Number(state.threadTarget);renderThread(model);}
      if(!returning)requestAnimationFrame(()=>{if(seq!==state.sequence||load!==threadLoad)return;const target=state.threadTarget&&[...main.querySelectorAll('[data-comment-id]')].find(n=>n.dataset.commentId===String(state.threadTarget));if(target){target.classList.add('linked-comment');target.scrollIntoView({block:'start'});target.focus({preventScroll:true});}else if(state.threadFocus==='comments')scrollToComments();});
    }catch(error){if(seq===state.sequence&&load===threadLoad)failure(error,()=>threadPage(post));}
  }
  function currentThread(model){return state.page==='thread'&&state.threadModel===model&&model.seq===state.sequence&&model.load===threadLoad;}
  function reconcile(parent,children){
    for(let i=0;i<children.length;i++)if(parent.children[i]!==children[i])parent.insertBefore(children[i],parent.children[i]||null);
    while(parent.children.length>children.length){const old=parent.lastElementChild;releaseMedia(old);old.remove();}
  }
  function renderThread(model,commentsOnly=false){if(!currentThread(model))return;
    model.replyStates??=new Map();model.commentNodes??=new Map();model.replyActive??=0;
    const p=model.post,groups=new Map(),ids=new Set(model.comments.map(c=>Number(c.id)));
    for(const c of model.comments){const parent=Number(c.comment_parent_id||0);if(!groups.has(parent))groups.set(parent,[]);groups.get(parent).push(c);}
    const count=Number(p.comments||model.comments.length),sort=sortPicker('Sort comments',commentSorts,model.sort,value=>{state.commentSort=value;remember('reader:commentSort',value);state.nextCommentSort=value;state.threadModel=null;state.threadTarget='';state.threadFocus='comments';return threadPage(p);},'sort-control comment-sort');
    const entry=button('',()=>replyTo(p,0),'comment-entry');entry.append(icon('edit'),text('span',state.username?'Write a comment…':'Sign in to comment…'));
    const area=commentsOnly&&model.area?.isConnected?model.area:el('section',{id:'comments',class:'section',tabindex:'-1'},el('div',{class:'comment-toolbar'},text('h2',`${count} comments`),sort),entry);
    if(model.focusRoot&&!area.querySelector('.thread-context'))area.append(el('div',{class:'actions thread-context'},text('span','Viewing a reply thread','muted'),button('Full discussion',()=>{model.focusRoot=null;renderThread(model);scrollToComments();})));
    function commentNode(c){
      const expanded=!model.collapsed.has(String(c.id)),node=el('article',{class:'comment','aria-expanded':String(expanded),'data-comment-id':c.id,tabindex:'-1'});
      const parts=[];
      if(c.is_shown===false&&!c.is_deleted&&!c.is_removed){node.classList.add('comment-placeholder');return {node,parts,replies:el('div'),loader:el('div',{class:'reply-loader',role:'status'})};}
      const head=el('div',{class:'comment-head'},authorLink(c.author));
      const collapse=button('',()=>{const open=node.getAttribute('aria-expanded')!=='true';node.setAttribute('aria-expanded',String(open));collapse.setAttribute('aria-expanded',String(open));collapse.setAttribute('aria-label',open?'Collapse thread':'Expand thread');if(open)model.collapsed.delete(String(c.id));else model.collapsed.add(String(c.id));},'comment-collapse');
      collapse.setAttribute('aria-expanded',String(expanded));collapse.setAttribute('aria-label',expanded?'Collapse thread':'Expand thread');collapse.append(text('span',ago(c.created)),icon('chevron'));head.append(collapse);parts.push(head);
      if(c.author_flair_text)parts.push(el('span',{class:'flair',title:'User flair'},C.cleanFlair(c.author_flair_text)));
      if(c.is_shown!==false&&!c.is_deleted&&!c.is_removed)parts.push(richContent(c.content,c.raw_content,'comment-body',C.postURL(p)));
      else parts.push(text('p',c.is_deleted?'[deleted]':'[removed]','muted'));
      parts.push(el('div',{class:'actions'},...voteControls(c,false),button('Reply',()=>replyTo(p,c.id)),el('span',{class:'action-spacer'}),iconButton('more','Comment actions',e=>commentMenu(c,p,e.currentTarget))));
      return {node,parts,replies:el('div'),loader:el('div',{class:'reply-loader',role:'status'})};
    }
    const roots=model.comments.filter(c=>model.focusRoot?Number(c.id)===model.focusRoot:!Number(c.comment_parent_id)||!ids.has(Number(c.comment_parent_id))),work=roots.slice().reverse().map(c=>({c,depth:0,parent:null})),seen=new Set(),rows=[],rootNodes=[];
    // Iterative traversal keeps deep replies inline without a continuation button.
    while(work.length){
      const {c,depth,parent}=work.pop(),id=String(c.id);if(seen.has(id)||isBlocked(c.author))continue;seen.add(id);
      const {child_ids,is_descendent_break,is_sibling_break,...visible}=c,signature=JSON.stringify(visible);
      let row=model.commentNodes.get(id);if(!row||row.signature!==signature){row={...commentNode(c),signature};model.commentNodes.set(id,row);}
      row.c=c;row.children=[];row.replies.className='replies'+(depth>=3?' depth-limit':'');rows.push(row);if(parent)parent.children.push(row.node);else rootNodes.push(row.node);
      const children=groups.get(Number(c.id))||[];for(let i=children.length-1;i>=0;i--)work.push({c:children[i],depth:depth+1,parent:row});
    }
    for(let i=rows.length-1;i>=0;i--){const row=rows[i],c=row.c;reconcile(row.replies,row.children);reconcile(row.node,[...row.parts,...(row.children.length?[row.replies]:[]),...(c.is_descendent_break||c.is_sibling_break?[row.loader]:[])]);}
    reconcile(area,[...area.children].filter(n=>!n.classList.contains('comment')).concat(rootNodes));
    if(!commentsOnly||!model.area?.isConnected)replace(main,cachedNotice(model.result),postCard(p,true),area);
    model.area=area;watchReplies(model,rows);
  }
  function watchReplies(model,rows){
    if(model.replyWatcher){model.replyWatcher.update(rows);return;}
    let stopped=false,frame=0;
    const queue=new Set(),observed=new Set(),observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!observed.has(entry.target))continue;if(entry.isIntersecting)queue.add(entry.target);else queue.delete(entry.target);}pump();},{rootMargin:'0px 0px 300px 0px'});
    const active=()=>!stopped&&currentThread(model)&&model.area?.isConnected;
    function status(row){const phase=model.replyStates.get(String(row.c.id))?.phase||'';if(row.loaderPhase===phase)return;row.loaderPhase=phase;row.loader.replaceChildren();if(phase==='loading')row.loader.textContent='Loading replies…';else if(phase==='done')row.loader.textContent='Replies may be incomplete. Pull to refresh.';else if(phase==='error')row.loader.append(text('span','Couldn’t load replies.'),button('Retry',()=>{model.replyStates.delete(String(row.c.id));queue.add(row.loader);pump();}));}
    function scheduleRender(){if(frame||!active())return;frame=requestAnimationFrame(()=>{frame=0;if(!active())return;const head=[...model.area.querySelectorAll('.comment-head')].find(n=>n.getBoundingClientRect().bottom>54),anchor=head?.closest('[data-comment-id]'),position={scroll:scrollY,anchor:anchor?{kind:'data-comment-id',id:anchor.dataset.commentId,top:anchor.getBoundingClientRect().top}:null};renderThread(model,true);restoreCleanup?.();restoreScroll(position,model.seq);});}
    function pump(){if(!active()||document.hidden)return;
      for(const node of queue){if(model.replyActive>=2)break;queue.delete(node);const row=node.replyRow,id=String(row.c.id);if(!node.isConnected||node.closest('.comment[aria-expanded=false]')||model.replyStates.has(id))continue;
        model.replyStates.set(id,{phase:'loading'});model.replyActive++;status(row);
        (async()=>{try{const result=await api('/api/v2/comment/thread',{id:row.c.id,sort:model.sort,d:0});if(!active())return;
            const incoming=result.data.comments||[],previous=new Map(model.comments.map(c=>[String(c.id),c]));
            model.comments=C.mergeComments(model.comments,incoming).map(c=>previous.has(String(c.id))?Object.assign(previous.get(String(c.id)),c):c);
            model.replyStates.set(id,{phase:'done'});
            scheduleRender();
          }catch(error){if(active()){model.replyStates.set(id,{phase:'error'});status(model.commentNodes.get(id)||row);}}
          finally{model.replyActive--;if(active())model.pumpReplies?.();}
        })();
      }
    }
    function update(nextRows){const next=new Set();for(const row of nextRows)if(row.c.is_descendent_break||row.c.is_sibling_break){next.add(row.loader);row.loader.replyRow=row;status(row);if(!observed.has(row.loader)){observed.add(row.loader);observer.observe(row.loader);}}for(const node of observed)if(!next.has(node)){observer.unobserve(node);observed.delete(node);queue.delete(node);}}
    model.replyWatcher={update};update(rows);
    model.pumpReplies=pump;document.addEventListener('visibilitychange',pump);
    replyCleanup=()=>{stopped=true;observer.disconnect();observed.clear();queue.clear();cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',pump);if(model.pumpReplies===pump){model.pumpReplies=null;model.replyWatcher=null;}};
  }
  function replyTo(post,parent){
    if(!state.username){toast('Sign in to reply.');return;}
    const owner=accountContext(),page=state.sequence,key=ownKey(`reply:${post.id}:${parent}`,owner.user),input=el('textarea',{'aria-label':'Comment',placeholder:'Write your reply…'});
    input.value=readLocal(key,'');input.oninput=()=>remember(key,input.value);
    let token;
    const send=button('Post reply',e=>action(async()=>{
      if(!input.value.trim())throw new Error('Write a reply first.');if(!owner.current())throw new Error('Your account changed. Reopen the reply.');
      const value=input.value,revision=store.revision(key);
      await api('/api/v2/action/create_comment',{community:post.community,parentId:post.id,commentParentId:parent,content:value},'POST',owner.user,owner.site);
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
  function requireLogin(){empty('Sign in to continue','Use your normal Scored account. Your password stays in the website sign-in form.',button('Sign in',()=>action(()=>rpc('login')),'primary'));}
  let uploadSyncBusy=false,uploadSyncAgain=false,refreshUploadResults=null,refreshUploadStatus=null,uploadSyncError='',uploadSyncRetryAfter=0;
  function uploadID(){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return 'upload-'+Date.now()+'-'+[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');}
  function retainUpload(owner,operation,result){
    const url=C.safeURL(result.url);if(!url)throw new Error('Upload finished without a usable link.');
    const key=ownKey('uploadResults',owner.user),ledgerKey=ownKey('uploadReceipts',owner.user),ledger=Object.assign(Object.create(null),readLocal(ledgerKey,{}));
    // A retained receipt may already have been explicitly inserted into a draft. Do not resurrect it.
    if(ledger[operation]===true)return {url,durable:!store.pending().includes(ledgerKey)};
    const saved=Object.assign(Object.create(null),readLocal(key,{}));saved[operation]={url,name:result.name||'Uploaded media',site:owner.site,at:result.completedAt||Date.now()};
    const stored=remember(key,saved);if(!stored)return {url,durable:false};
    ledger[operation]=true;return {url,durable:remember(ledgerKey,ledger)};
  }
  async function reconcileUploads(force=false){
    if(!force&&Date.now()<uploadSyncRetryAfter)return;
    if(uploadSyncBusy){uploadSyncAgain=true;return;}uploadSyncBusy=true;
    try{
      const result=await rpc('uploadResults'),ack=new Map();uploadSyncError='';uploadSyncRetryAfter=0;
      for(const item of (Array.isArray(result?.results)?result.results:[])){
        if(typeof item.operationId!=='string'||!item.operationId||typeof item.username!=='string'||!item.username||!C.siteOrigin(item.site))continue;
        const kept=retainUpload({user:item.username,site:item.site},item.operationId,item);if(kept.durable){const ids=ack.get(item.username)||[];ids.push(item.operationId);ack.set(item.username,ids);}
      }
      refreshUploadResults?.();refreshUploadStatus?.();for(const[username,operationIds]of ack)await rpc('ackUploadResults',{username,operationIds});
    }catch(error){uploadSyncError='Could not check recovered uploads. '+error.message;uploadSyncRetryAfter=Date.now()+5000;refreshUploadResults?.();refreshUploadStatus?.();} // Keep existing links and native receipts until durable retention succeeds.
    finally{uploadSyncBusy=false;if(uploadSyncAgain){uploadSyncAgain=false;reconcileUploads();}}
  }
  function consumeUpload(key,operation){const saved=readLocal(key,{});delete saved[operation];remember(key,Object.keys(saved).length?saved:null);}
  function composePage(){if(!state.username){requireLogin();return;}
    const key=ownKey('draft'),draft=readLocal(key,{type:'text',title:'',content:'',link:'',flair:null,community:state.community==='all'?'':state.community}),journal=readLocal(ownKey('publish'),null);
    if(draft.community===undefined)draft.community='thedonald';draft.site=state.site;
    const box=el('section',{class:'section'},text('h1','Create a post'));
    if(journal){box.append(recovery(journal));replace(main,box);return;}
    function save(){return remember(key,draft);}
    const composer=accountContext(),uploadsKey=ownKey('uploadResults',composer.user),uploads=el('div',{class:'notice upload-results'});
    function showUploads(){const records=Object.entries(readLocal(uploadsKey,{}));replace(uploads);uploads.hidden=!records.length&&!uploadSyncError;if(uploadSyncError)uploads.append(text('p',uploadSyncError,'muted'),button('Retry upload recovery',()=>reconcileUploads(true)));if(records.length)uploads.append(text('strong','Uploaded media ready to use'));for(const[operation,item]of records)uploads.append(el('div',{},text('p',item.name,'muted'),el('div',{class:'dialog-actions'},button('Use link',()=>{if(!composer.current())return;const latest=readLocal(key,draft);latest.type='media';latest.link=item.url;if(remember(key,latest))consumeUpload(uploadsKey,operation);composePage();}),button('Copy link',()=>action(async()=>{await rpc('copyText',{text:item.url});toast('Upload link copied.');})))));}
    if(state.site===C.SCORED||draft.community.toLowerCase()!=='thedonald')box.append(el('div',{class:'field'},text('label','Community'),button(draft.community?'c/'+draft.community:'Choose community',()=>communityPicker(draft.community,name=>{draft.community=name;draft.flair=null;save();closeSheet();composePage();}),'flair-select community-select')));
    const tabs=el('div',{class:'tabs',role:'tablist','aria-label':'Post type'},...['text','media','link'].map(type=>el('button',{role:'tab','aria-selected':String(type===draft.type),onclick:()=>{draft.type=type;save();composePage();}},type[0].toUpperCase()+type.slice(1))));box.append(tabs);
    const title=el('textarea',{class:'composer-title',maxlength:300,id:'post-title',placeholder:'Give your post a title',rows:2});title.value=draft.title;
    const count=text('p',`${draft.title.length}/300 · Titles cannot be edited later.`,'muted');title.oninput=()=>{draft.title=title.value;count.textContent=`${title.value.length}/300 · Titles cannot be edited later.`;save();};box.append(el('div',{class:'field'},el('label',{for:'post-title'},'Title'),title,count));
    if(draft.type==='text'){const input=el('textarea',{id:'post-content',placeholder:'Write your post…'});input.value=draft.content;input.oninput=()=>{draft.content=input.value;save();};box.append(el('div',{class:'field'},el('label',{for:'post-content'},'Text'),input));}
    else {const link=el('input',{id:'post-link',type:'url',placeholder:'https://…'});link.value=draft.link;link.oninput=()=>{draft.link=link.value;save();};box.append(el('div',{class:'field'},el('label',{for:'post-link'},draft.type==='media'?'Media URL':'Link'),link));
      if(draft.type==='media')box.append(button('Choose image or video',e=>action(async()=>{const owner=accountContext(),page=state.sequence,revision=store.revision(key),operation=uploadID(),result=await rpc('upload',{expectedUser:owner.user,site:owner.site,operationId:operation}),receipt=result.operationId||operation,kept=retainUpload(owner,receipt,result),url=kept.url;reconcileUploads();if(!owner.current()||store.revision(key)!==revision||page!==state.sequence){toast('Upload finished. Its link is available in the original account’s New post.');if(owner.current()&&state.page==='compose')refreshUploadResults?.();return;}draft.link=url;if(save())consumeUpload(uploadsKey,receipt);if(page===state.sequence&&state.page==='compose')composePage();},e.currentTarget),'secondary'),text('p','Images upload to Scored; MP4 videos upload to Videy. You will confirm before uploading.','muted'));
    }
    refreshUploadResults=()=>{if(composer.current()&&uploads.isConnected)showUploads();};showUploads();box.append(uploads);
    const flairButton=button('',()=>flairPicker(draft.community,draft.flair,selected=>{draft.flair=selected;save();closeSheet();composePage();}),'flair-select');flairButton.disabled=!draft.community;flairButton.append(text('span',draft.flair?C.cleanFlair(draft.flair.text):'Choose flair'),icon('chevron'));box.append(el('div',{class:'field'},text('label','Post flair'),flairButton));
    const draftStatus=text('p','Draft saved · Review before publishing','muted');draftStatus.dataset.draftKey=key;
    box.append(draftStatus,button('Preview post',()=>{
      try{C.validateDraft(draft);}catch(e){toast(e.message);return;}
      const preview={...draft,id:'preview',author:state.username,created:Date.now(),post_flair_text:draft.flair?.text,post_flair_class:draft.flair?.class,raw_content:draft.type==='text'?draft.content:'',is_image:draft.type==='media'&&!/\.mp4/i.test(draft.link)};
      const content=el('div',{},text('p','c/'+draft.community,'muted'),text('h2',draft.title),flair(preview),text('div',draft.type==='text'?(draft.content||''):draft.link,'content'));
      const media=C.media(preview);if(draft.type==='media'&&media.kind!=='link')content.append(mediaView(media,draft.title));
      content.append(el('div',{class:'dialog-actions'},button('Publish post',e=>action(async()=>{e.currentTarget.disabled=true;await publishDraft(draft);},e.currentTarget),'primary')));sheet('Preview',content);
    },'primary'));replace(main,box);storageStatus();}
  async function locateCreated(created,owner=accountContext()){if(created.posts?.length)return {...created.posts[0],site:owner.site};
    const raw=created.link||'',url=C.safeURL(raw.startsWith('/')?owner.site+raw:raw),match=url&&new URL(url).pathname.match(/\/p\/([^/]+)/);
    if(!match)throw new Error('Post was created, but its link could not be read. Check your profile; do not publish again.');
    const id=C.siteID(decodeURIComponent(match[1]));if(!id)throw new Error('Post was created, but its ID could not be read. Check your profile before retrying.');
    const result=await api('/api/v2/post/post.json',{id},'GET',owner.user,owner.site);if(!result.data.posts?.[0])throw new Error('Post was created. Open your profile to find it.');return {...result.data.posts[0],site:owner.site};}
  async function publishDraft(draft){
    const owner=accountContext(),key=ownKey('publish',owner.user),draftKey=ownKey('draft',owner.user),revision=store.revision(draftKey),page=state.sequence,token=sheetGeneration;
    if(publishing.has(key)){toast('This post is still being published.');return;}const existing=readLocal(key,null);let createSent=false;publishing.add(key);
    try{
      if(!owner.user)throw new Error('Sign in before posting.');
      const snapshot=JSON.parse(JSON.stringify(draft));
      const result=await C.publish(snapshot,{remember:value=>durable(key,value),create:async params=>{createSent=true;return (await api('/api/v2/action/create_post',params,'POST',owner.user,owner.site)).data;},locate:created=>locateCreated(created,owner),
        apply:(id,f)=>{if(!owner.current())throw new Error('Sign back into the original account to finish applying flair.');return api('/api/v2/post/set_flair',{id,flair_text:f.text,flair_class:f.class},'POST',owner.user,owner.site);}},existing);
      clearRevision(draftKey,revision);
      if(owner.current()){toast(result.pendingFlair?'Post published; flair is pending. Finish it from New post.':'Post published.');if(ownsSheet(token)&&page===state.sequence){closeSheet();if(result.pendingFlair)composePage();else openPost(result.post);}}
    }catch(e){if(!createSent&&!existing)remember(key,null);if(owner.current()){toast(e.message);if(ownsSheet(token)&&page===state.sequence){closeSheet();composePage();}}}
    finally{publishing.delete(key);if(owner.current()&&state.page==='compose'&&page===state.sequence&&!$('#sheet').open)composePage();}
  }
  function recovery(j){
    const owner=accountContext(),key=ownKey('publish',owner.user),draftKey=ownKey('draft',owner.user),revision=store.revision(draftKey),page=state.sequence,targetSite=C.siteOrigin(j.site)||state.site;
    const box=el('div',{class:'notice'},text('h2',publishing.has(key)?'Publishing…':j.stage==='flair'?'Post published; flair pending':'Check the previous posting attempt'),text('p',j.title),text('p','Your draft is preserved. Check your profile before creating another copy.'));
    box.append(button('Check my posts',()=>action(async()=>{if(!owner.current())throw new Error('Your account changed. Reopen this pending post.');if(targetSite!==state.site)await switchSite(targetSite);if(state.username.toLowerCase()!==owner.user.toLowerCase())throw new Error('Sign in to the original account to check this post.');state.profileUser=owner.user;state.profileTab='posts';state.profileModels={};return navigate('profile');}),'secondary'));if(publishing.has(key)){box.append(text('p','The original request is still running.'));return box;}
    if(j.post||j.created)box.append(button('Finish applying flair',e=>action(async()=>{
      if(!owner.current()||publishing.has(key))throw new Error('Reopen this pending post under its original account.');publishing.add(key);
      try{const post=j.post||await locateCreated(j.created,{...owner,site:targetSite});j.post=post;j.stage='flair';durable(key,j);if(!owner.current())throw new Error('Sign back into the original account to finish.');
        if(j.flair)await api('/api/v2/post/set_flair',{id:post.id,flair_text:j.flair.text,flair_class:j.flair.class},'POST',owner.user,targetSite);
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
  const syncingSaves=new Set();let saveOperation=0;
  async function toggleSaved(post,user,node){
    const key=ownKey('bookmarks',user),list=readLocal(key,[]),saved=node.getAttribute('aria-pressed')==='true',next=saved?list.filter(p=>String(p.id)!==String(post.id)):[post,...list];
    remember(key,next);node.setAttribute('aria-pressed',String(!saved));node.setAttribute('aria-label',saved?'Save post':'Unsave post');
    if(user&&user.toLowerCase()===state.username.toLowerCase())queueWebsiteSave(post,!saved,user);
    if(state.page==='saved')savedPage();
    if(user&&user.toLowerCase()===state.username.toLowerCase()){await syncWebsiteSaves();if(state.page==='saved'&&state.savedTab==='website'){state.savedModel=null;savedPage();}}
  }
  function queueWebsiteSave(post,saved,user=state.username){const key=ownKey('saveQueue',user),queue=readLocal(key,{});queue[String(post.id)]={id:post.id,saved,category:readLocal(ownKey('saveFolder',user),'Patriot Reader'),operation:Date.now()+':'+(++saveOperation)};remember(key,queue);}
  async function syncWebsiteSaves(quiet=false){
    const owner=accountContext(),key=ownKey('saveQueue',owner.user);if(!owner.user||syncingSaves.has(key)||!Object.keys(readLocal(key,{})).length)return;syncingSaves.add(key);
    try{while(owner.current()&&Object.keys(readLocal(key,{})).length){const item=Object.values(readLocal(key,{}))[0];
        await api(item.saved?'/api/v2/action/save':'/api/v2/action/unsave',{id:item.id,type:true,category:item.category},'POST',owner.user,owner.site);
        const queue=readLocal(key,{});if(queue[String(item.id)]?.operation===item.operation){delete queue[String(item.id)];remember(key,queue);}
      }if(owner.current()&&!quiet)toast('Saved posts synced with the website.');
    }catch(error){if(owner.current()&&!quiet)toast('Saved on this device. Website sync is pending: '+error.message);}
    finally{syncingSaves.delete(key);}
  }
  function openSaved(){state.savedTab=state.username?'website':'device';return navigate('saved');}
  async function savedPage(){activeListCleanup?.();activeListCleanup=null;
    const generation=++savedGeneration,user=state.username,seq=state.sequence,list=readLocal(ownKey('bookmarks'),[]),header=el('section',{class:'section'},text('h1','Saved posts'));
    state.savedTab=state.savedTab||(user?'website':'device');
    if(user){const tabs=el('div',{class:'tabs',role:'tablist','aria-label':'Saved posts location'});for(const [value,label]of [['website','Website'],['device','On device']])tabs.append(el('button',{role:'tab','aria-selected':String(state.savedTab===value),onclick:()=>{activeListCleanup?.();state.savedTab=value;state.savedModel=null;savedPage();}},label));header.append(tabs);
      const pending=Object.keys(readLocal(ownKey('saveQueue'),{})).length;if(pending)header.append(button('Retry website sync ('+pending+')',()=>action(async()=>{await syncWebsiteSaves();if(seq===state.sequence)savedPage();})));
      if(state.savedTab==='device'&&list.length)header.append(button('Sync device saves to website',()=>{const owner=accountContext();sheet('Sync saved posts',el('div',{},text('p','Copy '+list.length+' saved posts to your website folder? Your device copies stay available.'),button('Sync saved posts',e=>action(async()=>{if(!owner.current())throw new Error('Your account changed.');for(const post of list)queueWebsiteSave(post,true,owner.user);closeSheet();await syncWebsiteSaves();if(seq===state.sequence)savedPage();},e.currentTarget),'primary')));}));
    }
    if(state.savedTab==='website'&&user){
      const results=el('div');replace(main,header,results);try{const r=await api('/api/v2/folder/get_folders.json',{community:'Win'});if(seq!==state.sequence||generation!==savedGeneration||state.username!==user||state.savedTab!=='website')return;
        const folders=(r.data.folders||[]).map(f=>typeof f==='string'?f:f.name).filter(x=>typeof x==='string'&&x),preferred=readLocal(ownKey('saveFolder'),null),selected=folders.includes(preferred)?preferred:folders[0]||'Patriot Reader';
        if(!folders.includes(selected))folders.unshift(selected);remember(ownKey('saveFolder'),selected);
        header.append(sortPicker('Website saved folder',folders.map(f=>[f,f]),selected,value=>{remember(ownKey('saveFolder'),value);state.savedModel=null;return savedPage();}));
        if(!state.savedModel||state.savedModel.folder!==selected)state.savedModel={folder:selected,items:[],page:0,more:true};
        return pagedItems(results,'/api/v2/folder/get_folder.json',{community:'Win',folder:selected},state.savedModel,()=>seq===state.sequence&&generation===savedGeneration&&state.page==='saved'&&state.username===user&&state.savedTab==='website'&&readLocal(ownKey('saveFolder'),'Patriot Reader')===selected,'content',item=>item.parent_id?commentSummary(item):postCard(item));
      }catch(error){if(seq===state.sequence&&generation===savedGeneration)replace(results,text('p',error.message,'empty'),button('Retry',savedPage));}return;
    }
    replace(main,header,...list.map(p=>postCard(p)));if(!list.length)main.append(text('p','Use the bookmark icon on a post to save it here.','empty'));
    if(user){const guest=readLocal(ownKey('bookmarks',''),[]);if(guest.length)main.append(el('section',{class:'section'},text('h2','Saved while signed out')),...guest.map(p=>postCard(p,false,'')));}
  }
  function searchPage(){
    const input=el('input',{type:'search',placeholder:state.site===C.SCORED?(C.scoredFeedView(state.community)?'Search Scored':'Search c/'+state.community):'Search TheDonald','aria-label':'Search posts'});input.value=state.query||'';
    const results=el('div'),form=el('form',{class:'toolbar'},input,el('button',{type:'submit',class:'secondary'},'Search'));replace(main,form,results);
    const seq=state.sequence;
    function run(fresh){activeListCleanup?.();const query=input.value.trim();state.query=query;const generation=++searchGeneration;if(!query){state.searchModel=null;replace(results);return;}
      if(fresh||!state.searchModel||state.searchModel.query!==query)state.searchModel={query,posts:[],page:0,more:true};
      return pagedPosts(results,'/api/v2/post/search.json',{community:state.community,query,sort:'new'},state.searchModel,()=>seq===state.sequence&&generation===searchGeneration);
    }
    form.onsubmit=e=>{e.preventDefault();run(true);};if(state.searchModel&&state.searchModel.query===state.query)return run(false);
  }
  function profilePage(){activeListCleanup?.();activeListCleanup=null;
    const user=state.profileUser||state.username,header=el('section',{class:'section'},text('h1',user?'u/'+user:'Profile'));
    if(!user){header.append(button('Saved posts',openSaved,'primary'),text('p','Browse and save posts without an account. Sign in to post or reply.','muted'),button('Sign in',()=>action(()=>rpc('login')),'primary'));replace(main,header);return;}
    if(C.owned({author:user},state.username))header.append(el('div',{class:'profile-shortcuts'},button('Saved posts',openSaved,'primary'),button('Website account settings',()=>action(()=>rpc('website',{url:state.site+'/settings'})),'primary')));
    if(isBlocked(user))header.append(text('p','This user is blocked.','muted'),button('Unblock user',()=>confirmBlock(user,false)));
    state.profileTab=state.profileTab||'overview';state.profileModels=state.profileModels||{};
    const tabs=el('div',{class:'tabs profile-tabs',role:'tablist','aria-label':'Profile content'});
    for(const [value,label]of [['overview','Overview'],['posts','Posts'],['comments','Comments']])tabs.append(el('button',{role:'tab','aria-selected':String(state.profileTab===value),onclick:()=>{activeListCleanup?.();state.profileTab=value;profilePage();}},label));
    const results=el('div'),seq=state.sequence,tab=state.profileTab,model=state.profileModels[tab]||(state.profileModels[tab]={items:[],page:0,more:true});replace(main,header,tabs,results);
    const valid=()=>seq===state.sequence&&state.page==='profile'&&(state.profileUser||state.username)===user&&state.profileTab===tab;
    if(tab==='posts')return pagedItems(results,'/api/v2/post/profile.json',{user},model,valid,'posts',p=>postCard(p));
    if(tab==='comments')return pagedItems(results,'/api/v2/comment/profile.json',{user},model,valid,'comments',commentSummary);
    return pagedItems(results,'/api/v2/content/profile.json',{user},model,valid,'content',item=>item.parent_id||item.post_title?commentSummary(item):postCard(item));
  }
  function readMessages(){return readLocal(ownKey('readMessages'),{});}
  function messageKey(m){return String(m.id||m.conversation_id);}
  function messagePreview(m){
    const c=m.comment,box=el('article',{class:'post inbox-item','data-message-id':messageKey(m)}),flags=readMessages(),read=Object.hasOwn(flags,messageKey(m))?flags[messageKey(m)]:!(state.inboxTab==='unread'||m.unread===true||m.is_new===true);
    if(state.inboxTab==='unread'&&read){box.hidden=true;return box;}
    const label=c?(c.post_title||'Comment reply'):(m.subject||'Message'),open=()=>c?openPost({id:c.parent_id,uuid:c.parent_uuid||c.post_uuid,title:c.post_title||'Discussion',community:c.community},'comments',String(c.id)):openMessage(m);
    box.append(button(label,()=>{markMessageRead(m);return open();},'post-title'),el('div',{class:'meta'},authorLink(c?.author||m.author||m.sender||'[deleted]'),text('span',ago(c?.created||m.created)),read?text('span','Read'):text('span','Unread','unread-label')),richContent(c?.content||m.content,c?.raw_content||m.raw_content,'comment-body'));
    box.append(el('div',{class:'actions'},button(c?'Open comment':'Open conversation',()=>{markMessageRead(m);return open();}),button(read?'Mark unread':'Mark read',()=>{markMessageRead(m,!read);inboxPage();})));return box;
  }
  function markMessageRead(m,value=true){const saved=readMessages(),unread=readLocal(ownKey('unreadMessages'),{}),id=messageKey(m);saved[id]=value;if(value)delete unread[id];else unread[id]=m;remember(ownKey('readMessages'),saved);remember(ownKey('unreadMessages'),unread);}
  function inboxPage(){activeListCleanup?.();activeListCleanup=null;if(!state.username){requireLogin();return;}
    const seq=state.sequence,user=state.username,tab=state.inboxTab||'all';state.inboxTab=tab;
    const tabs=el('div',{class:'tabs inbox-tabs',role:'tablist','aria-label':'Inbox folders'});
    for(const [value,label]of [['unread','Unread'],['all','All'],['comments','Comments'],['sent','Sent']])tabs.append(el('button',{role:'tab','aria-selected':String(tab===value),onclick:()=>{activeListCleanup?.();state.inboxTab=value;state.inboxModel=null;inboxPage();}},label));
    const header=el('section',{class:'section compact-heading'},text('h1','Inbox'),text('p','Read markers are kept on this device.','muted'),button('New message',()=>composeMessage())),results=el('div');replace(main,header,tabs,results);
    if(!state.inboxModel||state.inboxModel.tab!==tab)state.inboxModel={tab,items:tab==='unread'?Object.values(readLocal(ownKey('unreadMessages'),{})):[],page:0,more:true};
    return pagedItems(results,'/api/v2/message/messages.json',{type:tab},state.inboxModel,()=>seq===state.sequence&&state.page==='inbox'&&state.username===user&&state.inboxTab===tab,'messages',messagePreview,messageKey);
  }
  function openMessage(message){state.message=message;return navigate('message');}
  async function messagePage(){const seq=state.sequence,owner=accountContext(),m=state.message;if(!owner.user){requireLogin();return;}loading('Loading conversation…');
    try{const r=await api('/api/v2/message/message.json',{id:m.conversation_id||m.id});if(seq!==state.sequence||!owner.current())return;
      const messages=r.data.messages||[];replace(main,el('section',{class:'section'},text('h1',m.subject||'Conversation')));
      for(const message of messages)main.append(el('article',{class:'post'},el('div',{class:'meta'},authorLink(message.author||message.sender),text('span',ago(message.created))),richContent(message.content,message.raw_content,'comment-body')));
      const latest=messages.at(-1)||m;main.append(el('section',{class:'section'},button('Reply',()=>composeMessage(latest),'comment-entry')));markMessageRead(m);
    }catch(error){if(seq===state.sequence&&owner.current())failure(error,messagePage);}
  }
  function composeMessage(parent){if(!state.username){requireLogin();return;}
    const owner=accountContext(),page=state.sequence,key=ownKey('messageDraft:'+String(parent?.conversation_id||parent?.id||'new')),draft=readLocal(key,{recipient:'',subject:'',content:''});
    const journalKey=key+':pending',pendingSend=readLocal(journalKey,null);
    if(pendingSend){sheet('Check the previous message',el('div',{},text('p',pendingSend.stage==='sent'?'The message was sent. Resolve this saved sending record before starting another.':'Sending was not confirmed. Check Sent before trying again.'),button('Open Sent',()=>{closeSheet();state.inboxTab='sent';state.inboxModel=null;navigate('inbox');}),button('Checked Sent — allow another send',()=>{if(!owner.current())return;durable(journalKey,null);closeSheet();composeMessage(parent);})));return;}
    const box=el('div'),recipient=el('input',{'aria-label':'Recipient',placeholder:'Username'}),subject=el('input',{'aria-label':'Subject',placeholder:'Subject',maxlength:300}),body=el('textarea',{'aria-label':'Message',placeholder:'Write your message…'});recipient.value=draft.recipient;subject.value=draft.subject;body.value=draft.content;
    function save(){draft.recipient=recipient.value;draft.subject=subject.value;draft.content=body.value;remember(key,draft);}recipient.oninput=subject.oninput=body.oninput=save;
    if(!parent)box.append(recipient,subject);box.append(body);const status=text('p','Draft saved on this device.','muted');status.dataset.draftKey=key;status.dataset.savedLabel='Draft saved on this device.';box.append(status);
    const token=sheet(parent?'Reply to message':'New message',box);
    box.append(button('Send message',e=>action(async()=>{
      if(!owner.current())throw new Error('Your account changed.');if(!body.value.trim())throw new Error('Write a message first.');if(!parent&&!/^[A-Za-z0-9_-]{1,64}$/.test(recipient.value.trim()))throw new Error('Enter a valid username.');if(!parent&&!subject.value.trim())throw new Error('Add a subject.');
      if(readLocal(journalKey,null))throw new Error('Check Sent before sending this message again.');
      const params=parent?{parentId:parent.id,content:body.value,liability:true}:{recipient:recipient.value.trim(),subject:subject.value.trim(),content:body.value,liability:true};
      if(!remember(key,draft))throw new Error('Could not save the draft. Keep the app open and retry saving first.');
      const revision=store.revision(key);durable(journalKey,{stage:'sending',at:Date.now()});
      try{await api('/api/v2/action/create_message',params,'POST',owner.user,owner.site);durable(journalKey,{stage:'sent',at:Date.now()});const unchanged=store.revision(key)===revision;clearRevision(key,revision);durable(journalKey,null);if(owner.current()){toast('Message sent.');if(unchanged&&ownsSheet(token)&&page===state.sequence){closeSheet();state.inboxModel=null;if(parent&&state.page==='message')messagePage();}}}
      catch(error){throw new Error(error.message+' Check Sent before sending again if the result is uncertain.');}
    },e.currentTarget),'primary'));storageStatus();
  }
  function settingsPage(){const box=el('section',{class:'section'},text('h1','Settings'));
    const github='https://github.com/IronWolve/Patriot-Reader';
    const about=button('',()=>{
      const link=el('a',{href:github,rel:'noopener noreferrer'},'GitHub · Patriot-Reader');link.onclick=e=>{e.preventDefault();action(()=>rpc('external',{url:github}));};
      sheet('About Patriot Reader',el('div',{},text('p','Version '+state.appVersion),text('p','An independent Android reader for patriots.win and scored.co.'),el('p',{},link)));
    },'setting about-setting');
    about.append(text('span','About'),el('span',{class:'about-version'},state.appVersion?'v'+state.appVersion:'',icon('chevron')));box.append(about);
    const help=button('',()=>action(()=>rpc('external',{url:'https://help.scored.co/'})),'setting about-setting help-setting');
    help.append(text('span','Help & support'),el('span',{class:'about-version'},icon('chevron')));box.append(help);
    function selectSetting(label,key,options,help){const value=options.find(([v])=>String(v)===String(state.settings[key]))?.[1]||state.settings[key];const choose=button('',e=>choices(label,options,state.settings[key],selection=>action(async()=>{const seq=state.sequence;state.settings[key]=key==='textSize'||key==='cacheMb'?Number(selection):selection;await saveSettings();if(seq===state.sequence&&state.page==='settings')settingsPage();}),e.currentTarget),'setting-choice');choose.setAttribute('aria-label',label+': '+value);choose.append(text('span',value),icon('chevron'));box.append(el('div',{class:'setting'},el('div',{class:'setting-line'},text('span',label),choose),help?text('small',help):null));}
    function toggle(label,key,help){const id='setting-'+key,input=el('input',{type:'checkbox',role:'switch',class:'setting-switch',id,checked:state.settings[key]});input.onchange=()=>action(async()=>{state.settings[key]=input.checked;await saveSettings();});box.append(el('div',{class:'setting toggle'},el('label',{for:id},label,help?text('small',help):null),input));}
    selectSetting('Appearance','theme',[['dark','Dark'],['light','Light'],['system','Follow system']]);selectSetting('Text size','textSize',[[15,'Small'],[17,'Standard'],[20,'Large'],[24,'Extra large']]);selectSetting('Feed layout','layout',[['compact','Compact'],['cards','Image cards']]);
    toggle('Plain, readable flair','plainFlair','Full labels always remain visible.');toggle('Show website ads','showAds','Off by default. Applies to the website view; the reader contains no ad placements.');
    toggle('Autoplay video on unmetered connections','autoplay','Off by default. Uses your last volume and mute setting.');toggle('Preload nearby images on unmetered connections','preload','Never preloads videos.');toggle('New downloads only on unmetered connections','wifiDownloads','Applies to new transfers. Existing downloads keep their original network policy.');
    selectSetting('Reader cache limit','cacheMb',[[16,'16 MB'],[64,'64 MB'],[128,'128 MB'],[256,'256 MB']],'Limits cached posts and image previews; these expire after seven days. Saved files and drafts are separate.');
    let usageGeneration=0;const usage=text('p','Checking storage…','muted');box.append(el('div',{class:'setting'},usage,button('Clear temporary cache',e=>action(async()=>{const generation=++usageGeneration,r=await rpc('clearCache');if(generation!==usageGeneration||!usage.isConnected)return;usage.textContent=r.complete===false||r.bytes>0||r.bytes<0?'Some cached data could not be removed'+(r.sizeKnown===false||r.bytes<0?'':` (${(r.bytes/1048576).toFixed(1)} MB left)`)+'. Retry when storage is available.':'Temporary cache cleared. Downloads, drafts and login are preserved.';},e.currentTarget),'secondary')));rpc('cacheInfo').then(r=>{if(!usageGeneration&&usage.isConnected)usage.textContent=r.sizeKnown===false||r.bytes<0?'Cache usage unavailable.':`Reader cache: ${(r.bytes/1048576).toFixed(1)} MB`;}).catch(()=>{if(!usageGeneration&&usage.isConnected)usage.textContent='Cache usage unavailable.';});
    box.append(el('div',{class:'setting'},text('h2','Account'),text('p',state.username?'Signed in as '+state.username:'Browsing without an account','muted'),button(state.username?'Sign out':'Sign in',()=>state.username?sheet('Sign out?',el('div',{},text('p','This removes the saved login. Your downloads and account-specific drafts remain on this device.'),button('Sign out',()=>action(async()=>{await rpc('logout');closeSheet();accountChanged('');}),'primary'))):action(()=>rpc('login')))));
    if(state.username)box.append(el('div',{class:'setting'},button('Blocked users',blockedUsers)));
    if(state.sessionNeedsReset)box.append(el('div',{class:'notice'},text('p','Your saved login could not be read. Reset only the login to sign in again; drafts and downloads are kept.'),button('Reset saved login',()=>action(async()=>{await rpc('logout');state.sessionNeedsReset=false;accountChanged('');toast('Saved login reset. Your drafts and downloads are unchanged.');}),'primary')));
    replace(main,box);}
  function downloadVersion(item){return item.contentVersion?String(item.contentVersion):item.status===8?'legacy:'+String(item.bytes??'')+':'+String(item.total??''):'';}
  function downloadArgs(item){return {downloadId:item.id,...(item.contentVersion?{contentVersion:item.contentVersion}:{})};}
  function canCopyDownload(item){
    if(typeof item.copyable==='boolean')return item.copyable;
    return !item.contentVersion&&['image/jpeg','image/png','image/gif','image/webp','image/avif','image/bmp'].includes(item.mime);
  }
  function localDownloadURL(item,asset='media'){
    try{
      if(!['media','thumbnail'].includes(asset))return '';const value=asset==='thumbnail'?item.posterUrl:item.previewUrl;if(!value)return '';
      const url=new URL(value,location.href),version=item.contentVersion;
      if(!/^[1-9][0-9]*$/.test(String(item.id))||url.origin!==location.origin||url.username||url.password||url.pathname!=='/downloads/'+item.id+'/'+asset||url.hash)return '';
      if(version!==undefined&&version!==null&&version!=='')return typeof version==='string'&&/^[0-9a-f]{64}$/.test(version)&&url.search==='?v='+version?url.href:'';
      return !url.search?url.href:''; // Older local preview fixtures have no version metadata.
    }catch{return '';}
  }
  async function downloadsPage(){
    const seq=state.sequence,rows=new Map();let busy=false,active=true,refreshQueued=false,retryFailedRequested=false,failures=0,operation=null,operationError='';
    const alive=()=>active&&seq===state.sequence&&state.page==='downloads';
    const feedback=text('p','','muted download-refresh-status');feedback.setAttribute('role','status');
    const operationPanel=el('section',{class:'file-operation notice',hidden:true,role:'status'});
    const refreshButton=button('Refresh',()=>requestRefresh(true),'secondary');refreshButton.setAttribute('aria-label','Refresh downloads');
    const previewObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){previewObserver.unobserve(entry.target);rows.get(entry.target.dataset.downloadId)?.mount?.();}},{rootMargin:'0px 0px 250px 0px'});
    function clearPreview(row){
      previewObserver.unobserve(row.node);row.mount=null;
      for(const player of row.preview.querySelectorAll('video,audio')){pauseObserver.unobserve(player);player.pause();player.removeAttribute('src');player.load();}
      for(const image of row.preview.querySelectorAll('img'))image.removeAttribute('src');row.preview.replaceChildren();
    }
    activeListCleanup=()=>{active=false;previewObserver.disconnect();for(const row of rows.values())clearPreview(row);};
    function failedPreview(row,message){
      if(!alive()||!row.node.isConnected)return;row.previewFailed=true;
      let status=row.preview.querySelector('.preview-failure');if(!status){status=el('div',{class:'preview-failure media-error',role:'status'});row.preview.append(status);}
      replace(status,text('p',message),button('Retry preview',()=>requestRefresh(true),'secondary'));
    }
    function preparePreview(row,item){
      clearPreview(row);row.previewFailed=false;const url=localDownloadURL(item),kind=String(item.mime||'').split('/')[0];row.preview.hidden=item.status!==8||item.available===false||!url||!['image','video','audio'].includes(kind);
      if(row.preview.hidden)return;row.preview.append(text('p','Loading preview…','muted'));
      row.mount=()=>{
        if(!alive()||!row.node.isConnected||!row.mount)return;row.mount=null;row.preview.replaceChildren();
        if(kind==='image'){
          const image=el('img',{src:url,alt:item.name||'Saved image',loading:'lazy',decoding:'async'});imageOpener(image,url,item.name,item);
          image.onerror=()=>{if(alive()&&image.isConnected){image.hidden=true;failedPreview(row,'Image preview unavailable. Retry, or use Open to view the local file.');}};row.preview.append(image);
        }else{
          const player=el(kind,{src:url,controls:true,preload:'metadata',playsinline:true,'aria-label':item.name||'Saved '+kind}),poster=localDownloadURL(item,'thumbnail');
          if(kind==='video'&&poster)player.poster=poster;bindSound(player);coordinatePlayback(player);pauseObserver.observe(player);row.preview.append(player);
          player.addEventListener('error',()=>{if(player.isConnected)failedPreview(row,'Preview unavailable. Retry, or use Open to play the local file.');});
        }
      };previewObserver.observe(row.node);
    }
    function renderOperation(){
      replace(operationPanel);operationPanel.hidden=!operation&&!operationError&&!uploadSyncError;if(operationPanel.hidden)return;
      if(operation){
        const label=operation.kind?.includes('upload')?'Upload in progress':operation.kind?.includes('extract')?'Saving audio':'Saving file';
        operationPanel.append(text('strong',label),text('p',operation.message||(operation.cancelRequested?'Canceling. Waiting for file access to stop.':'This file operation is still running.')));
        if(!operation.cancelRequested)operationPanel.append(button('Cancel operation',e=>action(async()=>{const result=await rpc('cancelFileOperation',{operationId:operation.id});if(!alive())return;operation=result.operation||null;renderOperation();requestRefresh();},e.currentTarget),'secondary'));
      }
      if(operationError)operationPanel.append(text('p',operationError,'muted'));
      if(uploadSyncError)operationPanel.append(text('p',uploadSyncError,'muted'),button('Retry upload recovery',()=>reconcileUploads(true),'secondary'));
    }
    const listContainer=el('div'),emptyMessage=text('p','Save an image, video or sound to find it here.','empty');
    replace(main,el('section',{},el('div',{class:'section'},el('div',{class:'download-heading'},text('h1','Your downloads'),refreshButton),text('p','Saved on this device. Tap a picture to zoom.','muted'),feedback),operationPanel,listContainer,emptyMessage));
    function scheduleRefresh(delay){if(!alive()||document.hidden)return;clearTimeout(downloadTimer);downloadTimer=setTimeout(()=>{downloadTimer=null;refresh();},delay);}
    function requestRefresh(retryPreview=false){retryFailedRequested=retryFailedRequested||retryPreview;return refresh();}
    async function refresh(){
      if(!alive())return;if(document.hidden||busy){refreshQueued=true;return;}
      busy=true;refreshQueued=false;clearTimeout(downloadTimer);downloadTimer=null;refreshButton.disabled=true;
      try{
        const [list,fileState]=await Promise.all([rpc('downloads'),rpc('fileOperationStatus').catch(error=>({error:error.message}))]);if(!alive())return;
        failures=0;feedback.textContent='';const retryFailed=retryFailedRequested;retryFailedRequested=false;
        if(fileState.error)operationError='Could not check file operations. '+fileState.error;else{operation=fileState.operation||null;operationError='';}renderOperation();
        emptyMessage.hidden=list.length>0;const ids=new Set(list.map(item=>String(item.id)));
        for(const[id,row]of rows)if(!ids.has(id)){clearPreview(row);row.node.remove();rows.delete(id);imageViewer?.updateDownload?.({id,status:8,available:false});}
        for(const item of list){
          const id=String(item.id);let row=rows.get(id);
          if(!row){row={node:el('article',{class:'download','data-download-id':item.id}),title:text('h3',''),status:text('p','','muted download-status'),preview:el('div',{class:'download-preview',hidden:true}),progress:el('progress'),actions:el('div',{class:'actions'}),renderKey:null,previewFailed:false};row.node.append(row.title,row.status,row.preview,row.progress,row.actions);listContainer.append(row.node);rows.set(id,row);}
          row.title.textContent=item.name;imageViewer?.updateDownload?.(item);
          const label=item.canceling?'Canceling…':item.publishingFailed?'Couldn’t finish saving':item.status===8&&item.available===false?'File unavailable':item.publishing?'Saving to Downloads':{1:'Queued',2:'Downloading',4:'Waiting for network',8:'Saved',16:'Failed'}[item.status]||'Unknown';
          const bytes=Number(item.bytes),size=!Number.isFinite(bytes)||bytes<0?'':bytes<1024?bytes+' B':bytes<1048576?Math.round(bytes/1024)+' KB':(bytes/1048576).toFixed(1)+' MB';row.status.textContent=item.publishingFailed?(item.publicationError||'Couldn’t finish saving. Your downloaded file is preserved.'):label+(size?' · '+size:'');
          row.progress.hidden=item.status!==2;row.progress.max=item.total>0?item.total:1;if(item.total>0)row.progress.value=item.bytes;else row.progress.removeAttribute('value');
          const renderKey=JSON.stringify([item.status,item.available,item.mime,item.previewUrl,item.posterUrl,item.cancelable,item.canceling,item.publishingFailed,item.publicationError,item.copyable,downloadVersion(item)]);
          if(row.renderKey===renderKey&&!(retryFailed&&row.previewFailed))continue;row.renderKey=renderKey;row.actions.replaceChildren();preparePreview(row,item);
          if(item.status===8&&item.available!==false){
            row.actions.append(button('Share',e=>action(()=>rpc('share',downloadArgs(item)),e.currentTarget)));
            if(canCopyDownload(item))row.actions.append(button('Copy image',e=>action(async()=>{await rpc('copyDownload',downloadArgs(item));toast('Image copied. Paste it into an app that accepts images.');},e.currentTarget)));
            row.actions.append(button('Open',e=>action(()=>rpc('openDownload',downloadArgs(item)),e.currentTarget)),button('Save copy…',e=>action(async()=>{await rpc('export',{...downloadArgs(item),name:item.name});toast('Copy saved.');},e.currentTarget)));
            if((item.mime||'').startsWith('video/'))row.actions.append(button('Save audio…',e=>action(async()=>{await rpc('extract',downloadArgs(item));toast('AAC audio saved.');},e.currentTarget)));
          }else if(item.publishingFailed)row.actions.append(button('Retry save',e=>action(async()=>{await rpc('retryDownloadPublication',{downloadId:item.id});requestRefresh();},e.currentTarget)));
          else if(item.status===16||item.status===8&&item.available===false)row.actions.append(button('Download again',e=>action(async()=>{await rpc('download',{url:item.url,name:item.name});requestRefresh();},e.currentTarget)));
          else if(item.cancelable===false)row.actions.append(button('Manage',e=>action(()=>rpc('manageDownloads'),e.currentTarget)));
          else row.actions.append(button('Cancel',e=>action(async()=>{await rpc('cancelDownload',{downloadId:item.id});requestRefresh();},e.currentTarget)));
        }
        if((list.some(item=>[1,2,4].includes(item.status))||operation||operationError)&&!document.hidden)scheduleRefresh(2000);
      }catch(error){
        if(alive()){failures++;feedback.textContent='Could not refresh downloads. Retrying automatically. '+error.message;scheduleRefresh(Math.min(30000,2000*2**Math.min(failures-1,4)));}
      }finally{
        busy=false;if(alive()){refreshButton.disabled=false;if(refreshQueued&&!document.hidden){refreshQueued=false;scheduleRefresh(0);}}
      }
    }
    refreshUploadStatus=()=>{if(alive())renderOperation();};refreshDownloads=()=>requestRefresh();await refresh();
  }
  function pauseEmbeds(except){for(const[frame,entry]of embeddedPlayers){if(frame===except)continue;if(entry.kind==='youtube')youtubeCommand(frame,'pauseVideo');else entry.stop();}}
  window.ReaderPause=()=>{document.querySelectorAll('video,audio').forEach(m=>m.pause());pauseEmbeds();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden){window.ReaderPause();clearTimeout(downloadTimer);downloadTimer=null;}else{refreshDownloads?.();if(booted){syncWebsiteSaves(true);reconcileUploads();}}});
  ready.then(async()=>{try{const data=await rpc('bootstrap');Object.assign(state,{site:data.site===C.SCORED?C.SCORED:C.PATRIOTS,username:data.username||'',appVersion:data.appVersion||'',metered:data.metered,systemDark:data.systemDark,sessionNeedsReset:!!data.sessionNeedsReset,settings:C.normalizeSettings(data.settings)});state.community=selectedCommunity();theme();state.blocked=readLocal(ownKey('blocked'),[]);state.commentSort=readLocal('reader:commentSort','top');if(!commentSorts.some(([v])=>v===state.commentSort))state.commentSort='top';state.topRange=readLocal(sitePref('topRange'),'day');if(!topRanges.some(([v])=>v===state.topRange))state.topRange='day';state.sort=readLocal(sitePref('sort'),'hot');if(!['hot','new','active','rising','top'].includes(state.sort))state.sort='hot';navigate('feed',false);booted=true;loadAccountPreferences();syncWebsiteSaves(true);reconcileUploads();takeReaderLink();showNotice(data.notice||'');if(data.sessionNeedsReset)toast('Saved login could not be read. You can browse as a guest or reset it in Settings.');}catch(e){failure(e,()=>location.reload());}});
  setTimeout(()=>{if(!port&&!window.ReaderPreview)empty('Reader connection unavailable','Close and reopen the app to reconnect.');},12000);
})();
