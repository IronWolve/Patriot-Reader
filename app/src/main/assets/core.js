(function (root) {
  'use strict';
  const defaults = Object.freeze({theme:'dark', showAds:false, layout:'compact', textSize:17,
    cacheMb:64, wifiDownloads:false, preload:false, autoplay:false, plainFlair:true});
  // Keep failed writes recoverable in memory; durable transactions check write's result.
  function createStore(storage) {
    const memory=new Map(),dirty=new Map(),revisions=new Map();
    function raw(key){if(memory.has(key))return memory.get(key);try{return storage.getItem(key);}catch{return null;}}
    function flushKey(key,value){try{if(value===null)storage.removeItem(key);else storage.setItem(key,value);dirty.delete(key);return true;}catch{dirty.set(key,value);return false;}}
    return {
      read(key,fallback){try{const value=raw(key);return value===null?fallback:JSON.parse(value);}catch{return fallback;}},
      write(key,value){const encoded=value===null?null:JSON.stringify(value);memory.set(key,encoded);revisions.set(key,(revisions.get(key)||0)+1);return flushKey(key,encoded);},
      revision(key){return revisions.get(key)||0;},
      retry(){for(const[key,value]of [...dirty])flushKey(key,value);return dirty.size===0;},
      pending(){return [...dirty.keys()];},
      recovery(){return Object.fromEntries([...dirty].filter(([,v])=>v!==null).map(([k,v])=>[k,JSON.parse(v)]));}
    };
  }
  function cleanFlair(value) { return String(value || '').replace(/\s+/gu, ' ').trim(); }
  function safeURL(value) {
    try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password ? u.href : ''; }
    catch { return ''; }
  }
  function owned(post, username) { return !!username && String(post.author).toLowerCase()===username.toLowerCase(); }
  function youtubeID(value) {
    try {
      const u=new URL(safeURL(value));let id='';
      if(u.hostname==='youtu.be')id=u.pathname.split('/')[1];
      else if(['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(u.hostname)) {
        if(u.pathname==='/watch')id=u.searchParams.get('v');
        else if(/^\/(embed|shorts|live)\//.test(u.pathname))id=u.pathname.split('/')[2];
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:'';
    }catch{return '';}
  }
  function truthID(value){
    try{const u=new URL(safeURL(value));if(!['truthsocial.com','www.truthsocial.com'].includes(u.hostname))return '';return u.pathname.match(/^\/(?:@[^/]+(?:\/posts)?|users\/[^/]+\/statuses|embed)\/(\d{1,24})\/?$/)?.[1]||'';}catch{return '';}
  }
  function rumbleURL(value) {
    try {const u=new URL(safeURL(value));return ['rumble.com','www.rumble.com'].includes(u.hostname)&&/^\/(?:v[a-z0-9]+-[^/]+\.html|embed\/[a-z0-9]+\/?)$/i.test(u.pathname)?u.href:'';}catch{return '';}
  }
  function preview(post) {
    const url=safeURL(post.link),meta=post.link_metadata||{},youtube=youtubeID(url)||youtubeID(post.video_link);
    if(meta.twitter && typeof meta.twitter==='object')return {kind:'twitter',url,tweet:meta.twitter};
    const truth=truthID(url);if(truth)return {kind:'truth',url,id:truth,title:meta.title||post.title,description:meta.description||''};
    if(rumbleURL(url))return {kind:'rumble',url,title:meta.title||post.title,image:safeURL(post.preview)||safeURL(meta.image)||''};
    if(youtube)return {kind:'youtube',url,id:youtube,title:meta.title||post.title,description:meta.description||'',image:`https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`};
    const direct=media(post);if(direct.kind!=='link')return direct;
    if(!url || post.type==='text')return {kind:'none'};
    return {kind:'article',url,title:meta.title||post.title,description:meta.description||'',domain:new URL(url).hostname.replace(/^www\./,''),image:safeURL(post.preview)||safeURL(meta.image)||''};
  }
  function media(post) {
    const url=safeURL(post.link),video=safeURL(post.video_link);
    for(const candidate of [video,url])if(candidate&&/\.(mp4|m4v|webm|ogv)$/i.test(new URL(candidate).pathname))return {kind:'video',url:candidate};
    if(url&&/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i.test(new URL(url).pathname))return {kind:'audio',url};
    if(url&&(post.is_image||/\.(png|jpe?g|gif|webp)$/i.test(new URL(url).pathname)))return {kind:'image',url};
    return {kind:'link',url};
  }
  const PATRIOTS='https://patriots.win',SCORED='https://scored.co';
  function siteOrigin(value){try{const u=new URL(safeURL(value));if(u.port&&u.port!=='443')return '';return ['patriots.win','www.patriots.win'].includes(u.hostname)?PATRIOTS:['scored.co','www.scored.co'].includes(u.hostname)?SCORED:'';}catch{return '';}}
  function postURL(post) { return `${siteOrigin(post.site)||PATRIOTS}/p/${encodeURIComponent(post.uuid || post.id)}/`; }
  function siteID(value) {
    const raw=String(value||'');if(!/^[A-Za-z0-9]{1,24}$/.test(raw))return '';
    if(/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))&&Number(raw)>0)return String(Number(raw));
    try{let n=0n;const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      for(const ch of raw)n=n*62n+BigInt(alphabet.indexOf(ch));
      const bytes=[];while(n){bytes.unshift(Number(n%256n));n/=256n;}
      const id=String.fromCharCode(...bytes).replace(/\0/g,'');
      return /^\d+$/.test(id)&&Number.isSafeInteger(Number(id))&&Number(id)>0?String(Number(id)):'';
    }catch{return '';}
  }
  function readerLink(value) {
    try{const u=new URL(safeURL(value)),site=siteOrigin(value);if(!site)return null;
      const profile=u.pathname.match(/^\/u\/([A-Za-z0-9_-]{1,64})\/?$/);if(profile)return {kind:'profile',user:profile[1],site};
      const community=u.pathname.match(/^\/c\/([A-Za-z0-9_-]{1,64})\/?$/);if(community)return {kind:'community',community:community[1],site};
      const parts=u.pathname.split('/').filter(Boolean),index=parts[0]==='p'?0:parts[0]==='c'&&parts[2]==='p'?2:-1;
      if(index<0)return null;const uuid=parts[index+1],id=siteID(uuid);if(!id)return null;
      const rest=parts.slice(index+2),c=rest.indexOf('c'),commentId=c>=0?siteID(rest[c+1]):'';if(c>=0&&!commentId)return null;
      const sort=u.searchParams.get('commentSort');return {kind:'post',id,uuid,commentId,site,community:index===2?parts[1]:'',sort:['top','new','old','controversial'].includes(sort)?sort:''};
    }catch{return null;}
  }
  function commentURL(post,comment){return postURL(post)+'x/c/'+encodeURIComponent(comment.uuid||comment.id);}
  function mergeComments(existing,incoming){const map=new Map(existing.map(c=>[String(c.id),c]));for(const c of incoming)if(c&&c.id)map.set(String(c.id),{...map.get(String(c.id)),...c});return [...map.values()];}
  function mergePosts(existing,incoming) {
    const posts=existing.slice(),added=[],seen=new Set(existing.map(p=>String(p.id??p.uuid)));
    for(const post of incoming){const key=String(post.id??post.uuid);if(seen.has(key))continue;seen.add(key);posts.push(post);added.push(post);}
    return {posts,added};
  }
  function normalizeSettings(value) {
    const s={...defaults,...value};
    if(!['dark','light','system'].includes(s.theme))s.theme='dark';
    s.textSize=Math.min(24,Math.max(14,Number(s.textSize)||17));
    s.cacheMb=Math.min(256,Math.max(16,Number(s.cacheMb)||64));
    return s;
  }
  function validateDraft(draft) {
    if(!draft.title || !draft.title.trim())throw new Error('Add a title.');
    if(draft.title.length>300)throw new Error('Titles can contain up to 300 characters.');
    if(draft.type!=='text' && !safeURL(draft.link))throw new Error('Add an HTTPS link or upload media.');
    const community=draft.community===undefined?'thedonald':String(draft.community);
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(community)||['all','win','trending','home'].includes(community.toLowerCase()))throw new Error('Choose a community for this post.');
    return {community, type:draft.type==='text'?'text':'link', title:draft.title.trim(),
      ...(draft.type==='text'?{content:draft.content||''}:{link:safeURL(draft.link)})};
  }
  // Journal creation before the request. A timeout is ambiguous: never silently resubmit.
  async function publish(draft, services, existing) {
    if(existing)throw new Error('Resolve the previous publishing attempt before posting again.');
    const params=validateDraft(draft);
    const journal={stage:'submitting',site:draft.site||PATRIOTS,community:params.community,title:params.title,flair:draft.flair||null,at:Date.now()};
    services.remember(journal);
    let created;
    try {created=await services.create(params);}
    catch(error) {journal.stage='uncertain';services.remember(journal);throw error;}
    // Persist the response before looking up its ID, so lookup failure cannot lose the post.
    journal.created=created;journal.stage='created';services.remember(journal);
    const post=await services.locate(created);journal.post=post;journal.stage='flair';services.remember(journal);
    if(journal.flair) {
      try {await services.apply(post.id,journal.flair);}
      catch(error) {return {post,pendingFlair:true,error:error.message};}
    }
    services.remember(null);return {post,pendingFlair:false};
  }
  const api={PATRIOTS,SCORED,siteOrigin,defaults,createStore,cleanFlair,safeURL,owned,media,preview,youtubeID,truthID,rumbleURL,postURL,siteID,readerLink,commentURL,mergeComments,mergePosts,normalizeSettings,validateDraft,publish};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  root.ReaderCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
