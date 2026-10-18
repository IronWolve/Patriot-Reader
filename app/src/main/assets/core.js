(function (root) {
  'use strict';
  const defaults = Object.freeze({theme:'dark', showAds:false, layout:'compact', textSize:17,
    cacheMb:64, wifiDownloads:false, preload:false, autoplay:false, plainFlair:true});
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
  function rumbleURL(value) {
    try {const u=new URL(safeURL(value));return ['rumble.com','www.rumble.com'].includes(u.hostname)&&/^\/(?:v[a-z0-9]+-[^/]+\.html|embed\/[a-z0-9]+\/?)$/i.test(u.pathname)?u.href:'';}catch{return '';}
  }
  function preview(post) {
    const url=safeURL(post.link),meta=post.link_metadata||{},youtube=youtubeID(url)||youtubeID(post.video_link);
    if(meta.twitter && typeof meta.twitter==='object')return {kind:'twitter',url,tweet:meta.twitter};
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
  function postURL(post) { return `https://patriots.win/p/${encodeURIComponent(post.uuid || post.id)}/`; }
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
    return {community:'thedonald', type:draft.type==='text'?'text':'link', title:draft.title.trim(),
      ...(draft.type==='text'?{content:draft.content||''}:{link:safeURL(draft.link)})};
  }
  // Journal creation before the request. A timeout is ambiguous: never silently resubmit.
  async function publish(draft, services, existing) {
    if(existing)throw new Error('Resolve the previous publishing attempt before posting again.');
    const params=validateDraft(draft);
    const journal={stage:'submitting',title:params.title,flair:draft.flair||null,at:Date.now()};
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
  const api={defaults,cleanFlair,safeURL,owned,media,preview,youtubeID,rumbleURL,postURL,mergePosts,normalizeSettings,validateDraft,publish};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  root.ReaderCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
