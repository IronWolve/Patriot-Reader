package app.patriotreader;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.*;
import android.os.*;
import android.provider.OpenableColumns;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.lang.ref.WeakReference;
import java.util.*;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private WebView reader, website;
    private FrameLayout root;
    private LinearLayout websitePanel;
    private WebMessagePort port;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final ExecutorService workers=Executors.newFixedThreadPool(3);
    private static final ExecutorService settingsWrites=Executors.newSingleThreadExecutor();
    private static final ExecutorService fileTransfers=new ThreadPoolExecutor(2,2,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<Runnable>(8));
    private static final FileOperationGate fileOperations=new FileOperationGate();
    private static final ExecutorService fileCancellation=new ThreadPoolExecutor(2,2,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<Runnable>(16));
    private static final ScheduledExecutorService fileDeadlines=Executors.newSingleThreadScheduledExecutor();
    private static volatile WeakReference<MainActivity> fileObserver=new WeakReference<>(null);
    private static volatile UploadResults uploadResults;
    static {fileDeadlines.scheduleWithFixedDelay(()->{FileOperationGate.State before=fileOperations.state();List<Runnable> hooks=fileOperations.expire(System.currentTimeMillis());runCancellation(hooks);FileOperationGate.State after=fileOperations.state();if(before!=null&&after!=null&&!before.cancelRequested&&after.cancelRequested)signalFileOperation();},1,1,TimeUnit.SECONDS);fileDeadlines.scheduleWithFixedDelay(()->{UploadResults store=uploadResults;if(store!=null&&store.retry())signalFileOperation();},30,30,TimeUnit.SECONDS);}
    private String fileToken;private boolean fileWriting;
    private AlertDialog uploadConfirmation;
    private DownloadStore downloadStore;
    private final DownloadStore.Listener downloadListener=()->event("downloadsChanged",true);
    private static final android.util.LruCache<String,byte[]> thumbnails=new android.util.LruCache<String,byte[]>(4*1024*1024){@Override protected int sizeOf(String key,byte[] value){return value.length;}};
    private final RequestGate requestGate=new RequestGate();
    private final Handler main=new Handler(Looper.getMainLooper());
    private Vault vault; private ApiClient api; private CacheStore cache;
    private String pendingPickerId, pendingExportId,pendingUploadUser,pendingUploadSite; private JSONObject pendingExport;
    private View fullScreen; private WebChromeClient.CustomViewCallback fullScreenCallback;
    private String websiteRequestId;
    private boolean loginMode, loginProbeBusy, activityPaused;
    private long websiteGeneration, nextLoginAttempt;
    private String signInScript;
    private TextView websiteStatus;
    private final Runnable signInPoll=new Runnable(){@Override public void run(){
        if(!loginMode||website==null||activityPaused)return;
        probeSignIn();main.postDelayed(this,1200);
    }};
    private String loginSite=Policy.SITE;
    private String selectedSite(){String site=getSharedPreferences("reader",0).getString("activeSite",Policy.SITE);return Policy.apiSite(site)?site:Policy.SITE;}
    private String pendingReaderLink;
    private static final int PICK_UPLOAD=40, EXPORT=41;

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        uploadResults=UploadResults.get(this);fileObserver=new WeakReference<>(this);
        if(Policy.readerLink(getIntent().getDataString()))pendingReaderLink=getIntent().getDataString();
        recoverFileOperation();
        WebView.setWebContentsDebuggingEnabled(false);
        getWindow().setStatusBarColor(Color.rgb(21,23,25));getWindow().setNavigationBarColor(Color.rgb(21,23,25));
        root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(21,23,25));
        root.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        setContentView(root);vault=new Vault(this);cache=new CacheStore(new File(getCacheDir(),"reader"));api=new ApiClient(vault,cache);
        workers.execute(()->cache.setLimit(Math.max(16,Math.min(256,settings().optLong("cacheMb",64)))*1024L*1024L));
        reader=new WebView(this);configure(reader);root.addView(reader,new FrameLayout.LayoutParams(-1,-1));
        reader.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri u=request.getUrl();String url=u.toString();
                if(Policy.ORIGIN.equals(u.getScheme()+"://"+u.getHost())){
                    if(u.getEncodedPath()!=null&&u.getEncodedPath().startsWith("/downloads/"))return downloadResponse(request);
                    String file=u.getPath()==null?"":u.getPath().replaceFirst("^/","");
                    if(!Arrays.asList("index.html","app.css","app.js","core.js").contains(file))return empty();
                    try{return new WebResourceResponse(file.endsWith("html")?"text/html":file.endsWith("css")?"text/css":"application/javascript","UTF-8",getAssets().open(file));}catch(Exception e){return empty();}
                }
                if(Policy.media(url)&&(request.getMethod().equals("GET")||request.getMethod().equals("HEAD"))){
                    // Stream media normally; cache only images, never an entire video in RAM.
                    if(request.getMethod().equals("GET")&&url.matches("(?i).*\\.(jpe?g|png|gif|webp)(\\?.*)?$"))return cachedImage(url);
                    return null;
                }
                if(!request.isForMainFrame()&&Policy.embedResource(url))return null;
                return empty();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest req){
                if(!req.isForMainFrame()&&Policy.embedDocument(req.getUrl().toString()))return false;
                if(Policy.ORIGIN.equals(req.getUrl().getScheme()+"://"+req.getUrl().getHost()))return false;
                if(req.isForMainFrame())external(req.getUrl().toString());return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){requestGate.reset();if(port!=null){port.close();port=null;}}
            @Override public void onPageFinished(WebView view,String url){
                if(!url.equals(Policy.ORIGIN+"/index.html"))return;
                WebMessagePort[] ports=reader.createWebMessageChannel();port=ports[0];
                port.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort p,WebMessage message){dispatch(message.getData());}});
                reader.postWebMessage(new WebMessage("reader-connect",new WebMessagePort[]{ports[1]}),Uri.parse(Policy.ORIGIN));
            }
        });
        reader.setWebChromeClient(mediaChrome());
        reader.loadUrl(Policy.ORIGIN+"/index.html");
        ConnectivityManager cm=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        networkCallback=new ConnectivityManager.NetworkCallback(){@Override public void onCapabilitiesChanged(Network network,NetworkCapabilities caps){event("metered",!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));}};
        cm.registerDefaultNetworkCallback(networkCallback);
    }
    private void configure(WebView v){
        WebSettings s=v.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);
        s.setUserAgentString(Policy.USER_AGENT);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setMediaPlaybackRequiresUserGesture(v!=reader||!settings().optBoolean("autoplay",false));
        s.setSupportZoom(true);s.setBuiltInZoomControls(true);s.setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(v,false);v.setBackgroundColor(Color.rgb(21,23,25));
    }
    private WebChromeClient mediaChrome(){return new WebChromeClient(){
        @Override public void onShowCustomView(View v,CustomViewCallback cb){if(fullScreen!=null){cb.onCustomViewHidden();return;}fullScreen=v;fullScreenCallback=cb;root.addView(v,new FrameLayout.LayoutParams(-1,-1));getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}
        @Override public void onHideCustomView(){hideFullScreen();}
    };}
    private WebResourceResponse empty(){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
    private WebResourceResponse cachedImage(String url){
        HttpURLConnection c=null;
        try{
            JSONObject saved=cache.get("image:"+url);
            if(saved!=null)try{JSONObject data=saved.getJSONObject("data");return new WebResourceResponse(data.getString("mime"),null,new ByteArrayInputStream(android.util.Base64.decode(data.getString("bytes"),0)));}catch(Exception invalidCache){}
            String target=url;
            for(int i=0;i<4;i++){
                if(!Policy.media(target))return empty();c=ApiClient.connection(target);int status=c.getResponseCode();
                if(status>=300&&status<400){String next=c.getHeaderField("Location");c.disconnect();c=null;target=new java.net.URL(new java.net.URL(target),next).toString();continue;}
                if(status!=200)return empty();
                String mime=c.getContentType();if(mime==null||!mime.startsWith("image/"))return empty();
                if(c.getContentLengthLong()<0||c.getContentLengthLong()>3L*1024*1024){
                    final HttpURLConnection streamConnection=c;
                    WebResourceResponse response=new WebResourceResponse(mime.split(";")[0],null,new FilterInputStream(c.getInputStream()){@Override public void close()throws IOException{try{super.close();}finally{streamConnection.disconnect();}}});
                    c=null;return response;
                }
                byte[] bytes=ApiClient.read(c.getInputStream(),3*1024*1024);
                cache.put("image:"+url,new JSONObject().put("mime",mime.split(";")[0]).put("bytes",android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP)));
                return new WebResourceResponse(mime.split(";")[0],null,new ByteArrayInputStream(bytes));
            }
        }catch(Exception ignored){}finally{if(c!=null)c.disconnect();}return empty();
    }
    private synchronized DownloadStore downloadsStore()throws Exception{
        if(downloadStore==null){downloadStore=DownloadStore.get(this);downloadStore.listen(downloadListener);}return downloadStore;
    }
    private WebResourceResponse mediaReply(String mime,int status,Map<String,String> headers,InputStream stream){
        headers.put("X-Content-Type-Options","nosniff");headers.put("Content-Security-Policy","sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
        headers.put("Cross-Origin-Resource-Policy","same-origin");headers.put("Cache-Control","no-store");
        return new WebResourceResponse(mime,null,status,status==200?"OK":status==206?"Partial Content":status==416?"Range Not Satisfiable":status==405?"Method Not Allowed":"Not Found",headers,stream);
    }
    private WebResourceResponse downloadResponse(WebResourceRequest request){
        DownloadStore.Source source=null;boolean transferred=false;Map<String,String> headers=new HashMap<>();
        try{
            Uri uri=request.getUrl();DownloadMedia.Route route=DownloadMedia.route(uri.getEncodedPath());
            if(route==null||!DownloadMedia.validVersionQuery(uri.getEncodedQuery())||uri.getFragment()!=null||uri.getUserInfo()!=null||(uri.getPort()!=-1&&uri.getPort()!=443))return mediaReply("text/plain",404,headers,new ByteArrayInputStream(new byte[0]));
            String method=request.getMethod();if(!method.equals("GET")&&!method.equals("HEAD"))return mediaReply("text/plain",405,headers,new ByteArrayInputStream(new byte[0]));
            source=downloadsStore().open(route.id);if(!source.contentVersion.equals(uri.getQueryParameter("v"))||!DownloadMedia.supported(source.mime))throw new IOException("Unsupported or changed local media.");
            String rangeHeader=null;for(Map.Entry<String,String> h:request.getRequestHeaders().entrySet())if(h.getKey().equalsIgnoreCase("Range"))rangeHeader=h.getValue();
            byte[] thumbnail=null;long length=source.size;String mime=source.mime;
            if(route.thumbnail){
                if(!source.mime.startsWith("video/"))throw new IOException("No video thumbnail.");
                String key=route.id+":"+source.contentVersion;thumbnail=thumbnails.get(key);
                if(thumbnail==null){
                    android.media.MediaMetadataRetriever retriever=new android.media.MediaMetadataRetriever();android.graphics.Bitmap bitmap=null;
                    try{retriever.setDataSource(source.descriptor.getFileDescriptor());bitmap=retriever.getScaledFrameAtTime(-1,android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC,480,270);if(bitmap==null)throw new IOException("No video thumbnail.");
                        ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(!bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,75,bytes))throw new IOException("Could not create thumbnail.");thumbnail=bytes.toByteArray();if(thumbnail.length>1024*1024)throw new IOException("Thumbnail too large.");thumbnails.put(key,thumbnail);
                    }finally{if(bitmap!=null)bitmap.recycle();retriever.release();}
                }
                length=thumbnail.length;mime="image/jpeg";
            }
            DownloadMedia.Range range=DownloadMedia.range(rangeHeader,length);headers.put("Accept-Ranges","bytes");
            if(!range.valid){headers.put("Content-Range","bytes */"+length);headers.put("Content-Length","0");return mediaReply("text/plain",416,headers,new ByteArrayInputStream(new byte[0]));}
            headers.put("Content-Length",String.valueOf(range.length));headers.put("Content-Disposition","inline");
            if(range.partial)headers.put("Content-Range","bytes "+range.start+"-"+(range.start+range.length-1)+"/"+length);
            InputStream body;boolean transferBody=false;
            if(method.equals("HEAD"))body=new ByteArrayInputStream(new byte[0]);
            else if(thumbnail!=null)body=new ByteArrayInputStream(thumbnail,(int)range.start,(int)range.length);
            else{
                ParcelFileDescriptor.AutoCloseInputStream input=new ParcelFileDescriptor.AutoCloseInputStream(source.descriptor);input.getChannel().position(range.start);
                body=DownloadMedia.limited(input,range.length);transferBody=true;
            }
            WebResourceResponse response=mediaReply(mime,range.partial?206:200,headers,body);transferred=transferBody;return response;
        }catch(Exception unavailable){return mediaReply("text/plain",404,new HashMap<>(),new ByteArrayInputStream(new byte[0]));}
        finally{if(source!=null&&!transferred)try{source.close();}catch(Exception ignored){}}
    }
    private JSONObject settings(){
        try{return new JSONObject(getSharedPreferences("reader",0).getString("settings","{}"));}catch(Exception e){return new JSONObject();}
    }
    private JSONObject bootstrap(String site)throws Exception{
        JSONObject account=vault.read(site);ConnectivityManager cm=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        return new JSONObject().put("site",site).put("settings",settings()).put("appVersion",getPackageManager().getPackageInfo(getPackageName(),0).versionName).put("username",account.optString("username",""))
            .put("sessionNeedsReset",vault.needsReset(site)).put("notice",getSharedPreferences("operations",0).getString("notice",""))
            .put("metered",cm.isActiveNetworkMetered()).put("cacheBytes",cache.size())
            .put("systemDark",(getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES);
    }
    private void dispatch(String text){
        if(text==null||text.length()>1024*1024)return;
        String requestId=null;
        try{
            JSONObject req=new JSONObject(text);String id=requestGate.bind(req.getString("id")),op=req.getString("op");JSONObject args=req.optJSONObject("args");final JSONObject a=args==null?new JSONObject():args;
            requestId=id;final String site=a.optString("site",selectedSite());if(!Policy.apiSite(site))throw new IOException("Unsupported site");
            if(op.equals("selectSite")){settingsWrites.execute(()->{try{if(!getSharedPreferences("reader",0).edit().putString("activeSite",site).commit())throw new IOException("Could not save site selection");reply(id,bootstrap(site),null);}catch(Exception e){reply(id,null,safeError(e));}});return;}
            if(op.equals("copyText")){String value=a.getString("text");if(value.length()>500000)throw new IOException("Too much text to copy at once. Keep the app open, free storage and use Retry save.");((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Patriot Reader",value));reply(id,new JSONObject(),null);return;}
            if(op.equals("takeLink")){String url=pendingReaderLink;pendingReaderLink=null;reply(id,new JSONObject().put("url",url==null?"":url),null);return;}
            if(op.equals("dismissNotice")){getSharedPreferences("operations",0).edit().remove("notice").commit();reply(id,new JSONObject(),null);return;}
            if(op.equals("settings")){settingsWrites.execute(()->{try{if(!getSharedPreferences("reader",0).edit().putString("settings",a.toString()).commit())throw new IOException("Could not save settings. Please retry.");cache.setLimit(Math.max(16,Math.min(256,a.optInt("cacheMb",64)))*1024L*1024L);main.post(()->{if(!isDestroyed())reader.getSettings().setMediaPlaybackRequiresUserGesture(!a.optBoolean("autoplay",false));});reply(id,a,null);}catch(Exception e){reply(id,null,safeError(e));}});return;}
            if(op.equals("exit")){moveTaskToBack(true);reply(id,new JSONObject(),null);return;}
            if(op.equals("manageDownloads")){startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS));reply(id,new JSONObject(),null);return;}
            if(op.equals("clearCache")){workers.execute(()->{long bytes=cache.clear();thumbnails.evictAll();main.post(()->{try{if(!isDestroyed())reader.clearCache(true);reply(id,new JSONObject().put("bytes",Math.max(0,bytes)).put("sizeKnown",bytes>=0).put("complete",bytes==0).put("webViewCleared",!isDestroyed()),null);}catch(Exception e){reply(id,null,safeError(e));}});});return;}
            if(op.equals("openDownload")||op.equals("copyDownload")||op.equals("share")){
                if(op.equals("share")&&!a.has("downloadId")){share(a);reply(id,new JSONObject(),null);return;}
                workers.execute(()->{try(DownloadStore.Source source=downloadsStore().open(a.getLong("downloadId"))){
                    if(!DownloadMedia.matchesExpectedVersion(a.optString("contentVersion"),source.contentVersion))throw new IOException("This file changed. Refresh its preview before sharing or saving.");
                    if(op.equals("copyDownload")&&!source.copyable)throw new IOException("Copy supports downloaded JPG, PNG, GIF, WebP, AVIF or BMP images.");
                    final Uri uri=source.uri;final String mime=source.mime;
                    main.post(()->{if(requestGate.currentId(id)==null||isDestroyed())return;try{
                        if(op.equals("copyDownload"))((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(new ClipData("Patriot Reader image",new String[]{mime},new ClipData.Item(uri)));
                        else if(op.equals("share"))shareDownload(uri,mime);
                        else openDownload(uri,mime);
                        reply(id,new JSONObject(),null);
                    }catch(Exception e){reply(id,null,safeError(e));}});
                }catch(Exception e){reply(id,null,safeError(e));}});return;
            }
            if(op.equals("login")||op.equals("website")){openWebsite(op.equals("login")?site+"/login":a.optString("url",site),id,op.equals("login"));return;}
            if(op.equals("fileOperationStatus")){reply(id,fileOperationStatus(),null);return;}
            if(op.equals("cancelFileOperation")){cancelFileOperation(a.getString("operationId"));reply(id,fileOperationStatus(),null);return;}
            if(op.equals("upload")){chooseUpload(id,a.optString("expectedUser",""),site,a.optString("operationId",""));return;}
            if(op.equals("export")||op.equals("extract")){export(id,a.put("extract",op.equals("extract")));return;}
            if(op.equals("openX")){openX(a.optString("url"));reply(id,new JSONObject(),null);return;}
            if(op.equals("external")){external(a.optString("url"));reply(id,new JSONObject(),null);return;}

            workers.execute(()->{try{
                Object result;
                switch(op){
                    case "bootstrap":result=bootstrap(selectedSite());break;
                    case "api":result=api.call(site,a.optString("method","GET"),a.getString("path"),a.optJSONObject("params")==null?new JSONObject():a.getJSONObject("params"),a.has("expectedUser")?a.getString("expectedUser"):null);break;
                    case "rumbleEmbed":result=api.rumbleEmbed(a.getString("url"));break;
                    case "truthPost":result=api.truthPost(a.getString("id"));break;
                    case "cacheInfo":result=new JSONObject().put("bytes",cache.size());break;

                    case "logout":vault.clear(site);main.post(()->{clearSiteBrowser(Policy.SITE);clearSiteBrowser("https://www.patriots.win");clearSiteBrowser(Policy.SCORED);clearSiteBrowser("https://www.scored.co");});result=new JSONObject();break;
                    case "download":result=download(a);break;
                    case "downloads":result=downloadsStore().list(a.optBoolean("validateCompleted",true));break;
                    case "cancelDownload":cancelDownload(a.getLong("downloadId"));result=downloads();break;
                    case "retryDownloadPublication":downloadsStore().retryPublication(a.getLong("downloadId"));result=downloads();break;
                    case "uploadResults":result=uploadResults.list();break;
                    case "ackUploadResults":uploadResults.acknowledge(a.getJSONArray("operationIds"),a.getString("username"));result=new JSONObject();signalFileOperation();break;
                    default:throw new IOException("Unknown app operation");
                }
                reply(id,result,null);
            }catch(Exception e){reply(id,null,safeError(e));}});
        }catch(Exception error){if(requestId!=null)reply(requestId,null,safeError(error));}
    }
    private String safeError(Exception e){String m=e.getMessage();if(m==null||m.length()>300)return "The operation failed. Please retry.";return m.replaceAll("am_[A-Za-z0-9_-]+","[redacted]");}
    private void reply(String id,Object value,String error){main.post(()->{try{String current=requestGate.currentId(id);if(port!=null&&current!=null)port.postMessage(new WebMessage(new JSONObject().put("id",current).put("result",value==null?JSONObject.NULL:value).put("error",error==null?JSONObject.NULL:error).toString()));}catch(Exception ignored){}});}
    private void event(String name,Object value){main.post(()->{try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("event",name).put("data",value).toString()));}catch(Exception ignored){}});}
    private void openWebsite(String url,String requestId,boolean forLogin){
        if(!(forLogin?Policy.site(url):Policy.https(url))){if(requestId!=null)reply(requestId,null,"Unsupported website address.");return;}
        if(websitePanel!=null){reply(requestId,null,"Close the current website view first.");return;}
        reader.evaluateJavascript("window.ReaderPause && window.ReaderPause()",null);websiteRequestId=requestId;websiteGeneration++;loginMode=forLogin;if(forLogin)loginSite=Policy.siteOrigin(url);loginProbeBusy=false;nextLoginAttempt=0;
        try{signInScript=new String(ApiClient.read(getAssets().open("signin.js"),16384),"UTF-8");}
        catch(Exception error){loginMode=false;websiteRequestId=null;reply(requestId,null,"Could not open sign-in. Please reopen the app.");return;}
        websitePanel=new LinearLayout(this);websitePanel.setOrientation(LinearLayout.VERTICAL);websitePanel.setBackgroundColor(Color.rgb(21,23,25));
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);
        websiteStatus=new TextView(this);websiteStatus.setText(forLogin?"Sign in to "+Uri.parse(loginSite).getHost():Uri.parse(url).getHost());websiteStatus.setTextColor(Color.rgb(242,241,237));websiteStatus.setTextSize(14);websiteStatus.setPadding(12,6,6,6);
        ImageButton close=new ImageButton(this);close.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);close.setColorFilter(Color.rgb(183,189,196));close.setBackgroundColor(Color.TRANSPARENT);close.setContentDescription("Close website and return to reader");
        int barSize=(int)(44*getResources().getDisplayMetrics().density);
        bar.addView(websiteStatus,new LinearLayout.LayoutParams(0,-2,1));bar.addView(close,new LinearLayout.LayoutParams(barSize,barSize));websitePanel.addView(bar,new LinearLayout.LayoutParams(-1,barSize));
        website=new WebView(this);configure(website);website.setWebChromeClient(mediaChrome());websitePanel.addView(website,new LinearLayout.LayoutParams(-1,0,1));root.addView(websitePanel,new FrameLayout.LayoutParams(-1,-1));
        website.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String loadedUrl){if(view==website){if(websiteStatus!=null)websiteStatus.setText(loginMode&&loginSite.equals(Policy.siteOrigin(loadedUrl))?"Sign in to "+Uri.parse(loginSite).getHost():Uri.parse(loadedUrl).getHost());if(loginMode){main.removeCallbacks(signInPoll);main.post(signInPoll);}}}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){String url=r.getUrl().toString();if(!loginMode&&r.isForMainFrame()&&Policy.readerLink(url)){external(url);return true;}return !Policy.https(url);}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest r){
                String h=r.getUrl().getHost();if(!settings().optBoolean("showAds",false)&&h!=null&&(h.equals("ads.scored.co")||h.endsWith(".adskeeper.com")||h.endsWith(".whizzco.com")||h.equals("www.googletagmanager.com")||h.endsWith(".google-analytics.com")))return empty();return null;
            }
        });
        CookieManager.getInstance().setCookie(forLogin?loginSite:Policy.siteOrigin(url).isEmpty()?selectedSite():Policy.siteOrigin(url),"forcePlatform=mobile; Path=/; Secure; SameSite=Lax");website.loadUrl(url);
        close.setOnClickListener(v->closeWebsite());
    }
    private boolean currentLogin(WebView view,long generation){return loginMode&&website==view&&websiteGeneration==generation&&!activityPaused&&loginSite.equals(Policy.siteOrigin(view.getUrl()));}
    private void probeSignIn(){
        if(loginProbeBusy||SystemClock.uptimeMillis()<nextLoginAttempt||website==null||!Policy.site(website.getUrl()))return;
        final WebView view=website;final long generation=websiteGeneration;final String origin=loginSite;loginProbeBusy=true;
        view.evaluateJavascript(signInScript,raw->{
            if(!currentLogin(view,generation)){if(websiteGeneration==generation)loginProbeBusy=false;return;}
            final JSONObject auth;
            try{Object decoded=new JSONTokener(raw).nextValue();if(!(decoded instanceof String)){loginProbeBusy=false;return;}auth=new JSONObject((String)decoded);}
            catch(Exception e){loginProbeBusy=false;return;}
            websiteStatus.setText("Finishing sign-in…");
            workers.execute(()->{try{
                JSONObject profile=api.validateSession(origin,auth);
                main.post(()->{
                    if(!currentLogin(view,generation)){if(websiteGeneration==generation)loginProbeBusy=false;return;}
                    // Recheck the exact session before committing: closing, navigating or
                    // changing accounts must not let a stale validation replace the login.
                    view.evaluateJavascript(signInScript,latest->{
                        if(!currentLogin(view,generation)){if(websiteGeneration==generation)loginProbeBusy=false;return;}
                        if(!raw.equals(latest)){loginProbeBusy=false;websiteStatus.setText("Sign in to patriots.win");return;}
                        try{vault.save(origin,auth.put("username",profile.getString("username")));String id=websiteRequestId;websiteRequestId=null;closeWebsite();reply(id,profile,null);event("account",profile);}
                        catch(Exception e){loginFailed(view,generation);}
                    });
                });
            }catch(Exception e){main.post(()->loginFailed(view,generation));}});
        });
    }
    private void loginFailed(WebView view,long generation){if(websiteGeneration!=generation)return;loginProbeBusy=false;nextLoginAttempt=SystemClock.uptimeMillis()+10000;if(currentLogin(view,generation))websiteStatus.setText("Couldn’t confirm sign-in. Retrying…");}
    private void clearSiteBrowser(String site){
        CookieManager cookies=CookieManager.getInstance();String values=cookies.getCookie(site);
        if(values!=null)for(String pair:values.split(";")){String name=pair.split("=",2)[0].trim();if(!name.isEmpty()){cookies.setCookie(site,name+"=; Max-Age=0; Path=/; Secure");cookies.setCookie(site,name+"=; Max-Age=0; Domain="+Uri.parse(site).getHost()+"; Path=/; Secure");}}
        WebStorage.getInstance().deleteOrigin(site);cookies.flush();
    }
    private void closeWebsite(){websiteGeneration++;loginMode=false;loginProbeBusy=false;main.removeCallbacks(signInPoll);if(website!=null){website.stopLoading();website.destroy();website=null;}if(websitePanel!=null){root.removeView(websitePanel);websitePanel=null;}websiteStatus=null;CookieManager.getInstance().flush();if(websiteRequestId!=null){reply(websiteRequestId,new JSONObject(),null);websiteRequestId=null;}}
    private void notice(String message){getSharedPreferences("operations",0).edit().putString("notice",message).commit();event("notice",message);}
    private static void closeQuietly(AutoCloseable resource){try{resource.close();}catch(Exception ignored){}}
    private static void runCancellation(List<Runnable> hooks){for(int i=hooks.size()-1;i>=0;i--){Runnable hook=hooks.get(i);try{fileCancellation.execute(()->{try{hook.run();}catch(Exception ignored){}});}catch(RejectedExecutionException busy){/* Keep ownership; a provider may itself be blocking cancellation. */}}}
    private static void signalFileOperation(){MainActivity observer=fileObserver.get();if(observer!=null)observer.event("fileOperationChanged",true);}
    private JSONObject fileOperationStatus()throws Exception{
        FileOperationGate.State value=fileOperations.state();JSONObject result=new JSONObject();
        if(value==null)return result.put("operation",JSONObject.NULL);
        return result.put("operation",new JSONObject().put("id",value.id).put("kind",value.kind).put("username",value.username).put("site",value.site).put("state",value.phase).put("cancelRequested",value.cancelRequested).put("startedAt",value.startedAt).put("deadlineAt",value.deadlineAt).put("message",value.message));
    }
    private void cancelFileOperation(String operationId)throws Exception{
        runCancellation(fileOperations.cancel(operationId,"Cancellation requested. Waiting for the file provider to stop; the original is preserved."));signalFileOperation();
        FileOperationGate.State value=fileOperations.state();
        if(value!=null&&value.id.equals(operationId)&&value.token.equals(fileToken)&&uploadConfirmation!=null)uploadConfirmation.cancel();
    }
    private void filePhase(String token,String phase)throws IOException{fileOperations.phase(token,phase,phase.equals("working")?System.currentTimeMillis()+600000:0);signalFileOperation();}
    private void submitFileTask(String token,String id,Runnable work){
        try{fileTransfers.execute(work);}catch(RejectedExecutionException busy){clearPendingOperation(token);finishFileOperation(token);String message="The file work queue is busy. No new work started. Retry; any selected output is preserved in Files.";if(id!=null)reply(id,null,message);else notice(message);}
    }
    private void finishFileOperation(String token){
        // Keep the global owner until its Activity fields have been cleaned on the main queue.
        main.post(()->{
            if(token!=null&&token.equals(fileToken)){
                pendingPickerId=null;pendingUploadUser=null;pendingUploadSite=null;pendingExportId=null;pendingExport=null;fileWriting=false;fileToken=null;
                uploadConfirmation=null;
            }
            fileOperations.release(token);
            signalFileOperation();
        });
    }
    private void pendingOperation(String kind)throws IOException{
        if(!getSharedPreferences("operations",0).edit().putString("pending",kind).putString("owner",fileToken==null?"":fileToken).commit())throw new IOException("Could not save the pending file operation. Please retry.");
    }
    private boolean clearPendingOperation(String token){
        android.content.SharedPreferences prefs=getSharedPreferences("operations",0);
        if(token!=null&&!token.equals(prefs.getString("owner","")))return true;
        return prefs.edit().remove("pending").remove("owner").remove("source").remove("destination").commit();
    }
    private void releaseOutputGrant(Uri uri){if(uri!=null)try{getContentResolver().releasePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(Exception ignored){}}
    private void recoverFileOperation(){
        // A second Activity in this process must never recover/delete its still-running writer.
        if(!fileOperations.beginRecovery())return;
        android.content.SharedPreferences prefs=getSharedPreferences("operations",0);String pending=prefs.getString("pending","");if(pending.isEmpty())return;
        final String token;try{token=fileOperations.claim();fileOperations.cleanup(token,System.currentTimeMillis()+600000);signalFileOperation();}catch(IOException busy){return;}
        final String destination=prefs.getString("destination",""),source=prefs.getString("source","");
        submitFileTask(token,null,()->{try{
            if(pending.equals("export-writing")){
                Uri output=destination.isEmpty()?null:Uri.parse(destination);boolean clean=output==null||destination.equals(source)||removeCreatedDocument(output);
                releaseOutputGrant(output);clearPendingOperation(null);
                notice(clean?"An interrupted save was cleaned up. The original download is preserved; choose Save copy again.":"A save was interrupted. The original download is preserved, but an incomplete output may remain in Files.");
            }else{notice("File selection was interrupted. Choose the file or destination again; saved drafts are preserved.");clearPendingOperation(null);}
        }finally{finishFileOperation(token);}});
    }
    private void chooseUpload(String id,String expectedUser,String site,String operationId)throws Exception{
        if(operationId.isEmpty())operationId=UUID.randomUUID().toString();
        if(!operationId.matches("[A-Za-z0-9:_-]{1,100}"))throw new IOException("Invalid upload operation ID.");
        JSONObject existing=uploadResults.find(operationId,expectedUser,site);if(existing!=null){reply(id,existing,null);return;}
        fileToken=fileOperations.claim(operationId,"upload",expectedUser,site,System.currentTimeMillis());final String token=fileToken;signalFileOperation();
        try{pendingOperation("upload");pendingPickerId=id;pendingUploadUser=expectedUser;pendingUploadSite=site;
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png","image/gif","image/webp","video/mp4"});
            startActivityForResult(intent,PICK_UPLOAD);
        }catch(Exception e){pendingPickerId=null;pendingUploadUser=null;pendingUploadSite=null;clearPendingOperation(token);finishFileOperation(token);throw e;}
    }
    private JSONObject download(JSONObject a)throws Exception{return downloadsStore().enqueue(a,settings().optBoolean("wifiDownloads",false));}
    private JSONArray downloads()throws Exception{return downloadsStore().list();}
    private void cancelDownload(long id)throws Exception{downloadsStore().cancel(id);}
    private void share(JSONObject a)throws Exception{
        String url=a.getString("url");if(!Policy.https(url))throw new IOException("Invalid link");
        startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,url),"Share"));
    }
    private void shareDownload(Uri uri,String mime){
        Intent intent=new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(new ClipData("Patriot Reader download",new String[]{mime},new ClipData.Item(uri)));
        startActivity(Intent.createChooser(intent,"Share"));
    }
    private void openDownload(Uri uri,String mime)throws IOException{
        try{Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(new ClipData("Patriot Reader download",new String[]{mime},new ClipData.Item(uri)));startActivity(intent);}
        catch(ActivityNotFoundException error){throw new IOException("No app is available to open this file. Try Share or Save copy.");}
    }
    private void export(String id,JSONObject a)throws Exception {
        final long downloadId=a.getLong("downloadId");fileToken=fileOperations.claim(UUID.randomUUID().toString(),a.optBoolean("extract")?"extract":"export", "",selectedSite(),System.currentTimeMillis());final String token=fileToken;
        pendingExportId=id;pendingExport=a;fileWriting=true;filePhase(token,"working");
        submitFileTask(token,id,()->{try{filePhase(token,"working");final String kind;final Uri uri;
            try(DownloadStore.Source source=downloadsStore().open(downloadId)){
                if(!DownloadMedia.matchesExpectedVersion(a.optString("contentVersion"),source.contentVersion))throw new IOException("This file changed. Refresh its preview before sharing or saving.");
                if(a.optBoolean("extract"))verifyAudio(source.uri,fileOperations.handle(token));kind=source.mime;uri=source.uri;
            }
            main.post(()->{try{
                if(requestGate.currentId(id)==null||isDestroyed()||!token.equals(fileToken)||!fileOperations.owns(token)){finishFileOperation(token);return;}
                filePhase(token,"selecting");fileWriting=false;pendingOperation("export:"+uri);String mime=a.optBoolean("extract")?"audio/mp4":kind;
                startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,a.optBoolean("extract")?"audio.m4a":Policy.filename(a.optString("name","media"))),EXPORT);
            }catch(Exception e){pendingExportId=null;pendingExport=null;clearPendingOperation(token);finishFileOperation(token);reply(id,null,safeError(e));}});
        }catch(Exception e){finishFileOperation(token);reply(id,null,safeError(e));}});
    }
    private boolean removeCreatedDocument(Uri uri){
        if(uri==null)return true;try{return android.provider.DocumentsContract.deleteDocument(getContentResolver(),uri);}catch(Exception ignored){return false;}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);if(request!=PICK_UPLOAD&&request!=EXPORT)return;
        android.content.SharedPreferences prefs=getSharedPreferences("operations",0);
        final String token=fileToken==null?"":fileToken,priorOperation=token.equals(prefs.getString("owner",""))?prefs.getString("pending",""):"";
        if(!fileOperations.owns(token)){notice("File selection was interrupted. Choose again; any selected output is preserved in Files.");return;}
        if(request==PICK_UPLOAD){
            final String id=pendingPickerId,user=pendingUploadUser,site=pendingUploadSite;pendingPickerId=null;pendingUploadUser=null;pendingUploadSite=null;clearPendingOperation(token);
            if(id==null||requestGate.currentId(id)==null){finishFileOperation(token);notice("File selection was interrupted. Choose the file again; your draft is preserved.");return;}
            if(result!=RESULT_OK||data==null||data.getData()==null){finishFileOperation(token);reply(id,null,"File selection cancelled");return;}
            fileWriting=true;final Uri uri=data.getData();
            submitFileTask(token,id,()->{try{
                filePhase(token,"working");FileOperationGate.Handle control=fileOperations.handle(token);
                CancellationSignal cancellation=new CancellationSignal();
                String mime=getContentResolver().getType(uri),name="upload";long size=-1;
                control.check();
                try(FileOperationGate.Registration cancel=control.register(cancellation::cancel);Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null,cancellation)){
                    if(c!=null&&c.moveToFirst()){int label=c.getColumnIndex(OpenableColumns.DISPLAY_NAME);if(label>=0&&!c.isNull(label))name=c.getString(label);int col=c.getColumnIndex(OpenableColumns.SIZE);if(col>=0&&!c.isNull(col))size=c.getLong(col);}
                }
                final String filename=name,kind=mime==null?"application/octet-stream":mime;
                long max=kind.equals("video/mp4")||kind.equals("image/gif")?100L*1024*1024:12L*1024*1024;
                if(!kind.matches("image/(jpeg|png|gif|webp)")&&!kind.equals("video/mp4"))throw new IOException("Choose JPG, PNG, GIF, WebP or MP4.");
                if(size<0||size>max)throw new IOException("Choose a local file within the site's size limit (12 MB images; 100 MB GIF/MP4).");
                main.post(()->{
                    if(isDestroyed()||requestGate.currentId(id)==null||!token.equals(fileToken)||!fileOperations.owns(token)){finishFileOperation(token);return;}
                    try{filePhase(token,"confirmation");}catch(IOException cancelled){finishFileOperation(token);reply(id,null,safeError(cancelled));return;}fileWriting=false;
                    Runnable cancel=()->{finishFileOperation(token);reply(id,null,"Upload cancelled");};
                    try{uploadConfirmation=new AlertDialog.Builder(this).setTitle("Upload media?").setMessage("Upload "+filename+" to "+(kind.equals("video/mp4")?"Videy":"Scored")+" for your post?")
                        .setNegativeButton("Cancel",(d,w)->cancel.run())
                        .setPositiveButton("Upload",(d,w)->{if(!token.equals(fileToken)||!fileOperations.owns(token)){finishFileOperation(token);return;}uploadConfirmation=null;fileWriting=true;submitFileTask(token,id,()->{try{
                            filePhase(token,"working");FileOperationGate.State operation=fileOperations.state();JSONObject uploadResult=api.upload(this,uri,filename,kind,user,site,fileOperations.handle(token)).put("operationId",operation.id);
                            boolean saved=uploadResults.remember(operation,uploadResult);signalFileOperation();
                            if(!saved)throw new IOException("Upload completed, but its link could not be saved on this device. Keep the app open; its result is available for recovery.");
                            reply(id,uploadResult,null);
                        }catch(Exception e){reply(id,null,safeError(e));}finally{finishFileOperation(token);}});})
                        .setOnCancelListener(d->cancel.run()).show();
                    }catch(Exception error){finishFileOperation(token);reply(id,null,safeError(error));}
                });
            }catch(Exception e){finishFileOperation(token);reply(id,null,safeError(e));}});
        }else{
            final String id=pendingExportId;final JSONObject a=pendingExport;final Uri destination=data==null?null:data.getData();
            if(id==null||a==null||requestGate.currentId(id)==null){
                pendingExportId=null;pendingExport=null;clearPendingOperation(token);fileWriting=true;try{fileOperations.cleanup(token,System.currentTimeMillis()+600000);signalFileOperation();}catch(IOException stale){finishFileOperation(token);return;}
                submitFileTask(token,null,()->{try{boolean protectedSource=destination!=null&&priorOperation.equals("export:"+destination);boolean clean=result!=RESULT_OK||protectedSource||removeCreatedDocument(destination);releaseOutputGrant(destination);notice("Save was interrupted. Choose the destination again."+(clean?"":" An incomplete file remains; remove it in Files."));}finally{finishFileOperation(token);}});return;
            }
            if(result!=RESULT_OK||destination==null){pendingExportId=null;pendingExport=null;clearPendingOperation(token);finishFileOperation(token);reply(id,null,"Save cancelled");return;}
            fileWriting=true;
            submitFileTask(token,id,()->{boolean protectedSource=priorOperation.equals("export:"+destination);try{filePhase(token,"working");try(DownloadStore.Source local=downloadsStore().open(a.getLong("downloadId"))){
                FileOperationGate.Handle control=fileOperations.handle(token);
                if(!DownloadMedia.matchesExpectedVersion(a.optString("contentVersion"),local.contentVersion))throw new IOException("This file changed. Refresh its preview before sharing or saving.");
                Uri source=local.uri;protectedSource=protectedSource||source.equals(destination);
                if(protectedSource)throw new IOException("Choose a different destination from the original download.");
                try{getContentResolver().takePersistableUriPermission(destination,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(SecurityException ignored){}
                if(!getSharedPreferences("operations",0).edit().putString("pending","export-writing").putString("owner",token).putString("source",source.toString()).putString("destination",destination.toString()).commit())throw new IOException("Could not save recovery information. The original download is preserved.");
                if(a.optBoolean("extract"))extractAudio(source,destination,control);
                else {CancellationSignal cancellation=new CancellationSignal();try(FileOperationGate.Registration cancelSignal=control.register(cancellation::cancel);InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(local.descriptor);FileOperationGate.Registration cancelInput=control.register(()->closeQuietly(in));android.content.res.AssetFileDescriptor output=getContentResolver().openAssetFileDescriptor(destination,"wt",cancellation)){
                    if(output==null)throw new IOException("Could not open the selected file.");try(OutputStream out=output.createOutputStream();FileOperationGate.Registration cancelOutput=control.register(()->closeQuietly(out))){byte[] buffer=new byte[65536];int n;while(true){control.check();n=in.read(buffer);if(n==-1)break;control.check();out.write(buffer,0,n);}control.check();}
                }}
                if(!clearPendingOperation(token))throw new IOException("Could not finish saving the recovery record. The original download is preserved.");
                reply(id,new JSONObject().put("saved",true),null);
            }}catch(Exception e){boolean clean=protectedSource||removeCreatedDocument(destination);reply(id,null,safeError(e)+(clean?"":" An incomplete file remains at the selected destination; remove it in Files."));}
            finally{clearPendingOperation(token);releaseOutputGrant(destination);finishFileOperation(token);}});
        }
    }
    private int audioTrack(android.media.MediaExtractor extractor){
        for(int i=0;i<extractor.getTrackCount();i++)if("audio/mp4a-latm".equals(extractor.getTrackFormat(i).getString(android.media.MediaFormat.KEY_MIME)))return i;return -1;
    }
    private void verifyAudio(Uri source,FileOperationGate.Handle control)throws Exception{
        android.media.MediaExtractor extractor=new android.media.MediaExtractor();
        CancellationSignal cancellation=new CancellationSignal();
        try(FileOperationGate.Registration cancelSignal=control.register(cancellation::cancel);android.content.res.AssetFileDescriptor input=getContentResolver().openAssetFileDescriptor(source,"r",cancellation)){
            control.check();
            if(input==null)throw new IOException("Could not open the downloaded video.");extractor.setDataSource(input.getFileDescriptor(),input.getStartOffset(),input.getLength());
            control.check();
            if(audioTrack(extractor)<0)throw new IOException("This video has no supported AAC audio track. No output file was created.");
        }finally{extractor.release();}
    }
    private void extractAudio(Uri source,Uri destination,FileOperationGate.Handle control)throws Exception {
        android.media.MediaExtractor extractor=new android.media.MediaExtractor();android.media.MediaMuxer muxer=null;boolean started=false;
        CancellationSignal cancellation=new CancellationSignal();
        try(FileOperationGate.Registration cancelSignal=control.register(cancellation::cancel);android.content.res.AssetFileDescriptor input=getContentResolver().openAssetFileDescriptor(source,"r",cancellation)){
            control.check();
            if(input==null)throw new IOException("Could not open the downloaded video.");extractor.setDataSource(input.getFileDescriptor(),input.getStartOffset(),input.getLength());int track=audioTrack(extractor);
            if(track<0)throw new IOException("This video has no supported AAC audio track. The original video is preserved.");
            extractor.selectTrack(track);
            try(ParcelFileDescriptor output=getContentResolver().openFileDescriptor(destination,"rwt",cancellation)){
                control.check();
                if(output==null)throw new IOException("Could not open the output file.");muxer=new android.media.MediaMuxer(output.getFileDescriptor(),android.media.MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
                int target=muxer.addTrack(extractor.getTrackFormat(track));muxer.start();started=true;
                java.nio.ByteBuffer buffer=java.nio.ByteBuffer.allocate(1024*1024);android.media.MediaCodec.BufferInfo info=new android.media.MediaCodec.BufferInfo();
                while(true){control.check();int n=extractor.readSampleData(buffer,0);if(n<0)break;control.check();info.set(0,n,extractor.getSampleTime(),extractor.getSampleFlags());muxer.writeSampleData(target,buffer,info);extractor.advance();}
                muxer.stop();started=false;
            }
        }finally{extractor.release();if(muxer!=null){if(started)try{muxer.stop();}catch(Exception ignored){}muxer.release();}}
    }
    private void openX(String url){
        if(!Policy.xPost(url))return;
        reader.evaluateJavascript("window.ReaderPause && window.ReaderPause()",null);
        Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse(url)).setPackage("com.twitter.android");
        try{startActivity(intent);}catch(ActivityNotFoundException|SecurityException error){external(url);}
    }
    private void external(String url){if(!Policy.https(url))return;if(Policy.readerLink(url)){if(website!=null)closeWebsite();pendingReaderLink=url;event("link",url);return;}if(websitePanel==null){reader.evaluateJavascript("window.ReaderPause && window.ReaderPause()",null);openWebsite(url,null,false);}else website.loadUrl(url);}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);String url=intent.getDataString();if(Policy.readerLink(url)){if(website!=null)closeWebsite();pendingReaderLink=url;event("link",url);}}
    private void hideFullScreen(){if(fullScreen!=null){root.removeView(fullScreen);fullScreen=null;fullScreenCallback.onCustomViewHidden();fullScreenCallback=null;getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}}
    @Override public void onBackPressed(){if(fullScreen!=null){hideFullScreen();return;}if(website!=null){closeWebsite();return;}reader.evaluateJavascript("window.ReaderBack && window.ReaderBack()",null);}
    @Override protected void onResume(){super.onResume();activityPaused=false;if(reader!=null)reader.onResume();if(website!=null)website.onResume();if(loginMode){main.removeCallbacks(signInPoll);main.post(signInPoll);}event("downloadsChanged",true);}
    @Override protected void onPause(){activityPaused=true;main.removeCallbacks(signInPoll);super.onPause();if(reader!=null){reader.evaluateJavascript("window.ReaderPause && window.ReaderPause()",null);reader.onPause();}if(website!=null){website.evaluateJavascript("document.querySelectorAll(\"video,audio\").forEach(m=>m.pause())",null);website.onPause();}CookieManager.getInstance().flush();}
    @Override public void onConfigurationChanged(Configuration c){super.onConfigurationChanged(c);event("systemTheme",(c.uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES);}
    @Override protected void onDestroy(){websiteGeneration++;loginMode=false;main.removeCallbacks(signInPoll);if(networkCallback!=null)((ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(networkCallback);if(port!=null)port.close();if(website!=null)website.destroy();if(reader!=null)reader.destroy();if(downloadStore!=null)downloadStore.detach(downloadListener);if(!fileWriting&&fileOperations.abandonable(fileToken)){clearPendingOperation(fileToken);finishFileOperation(fileToken);}workers.shutdown();requestGate.reset();super.onDestroy();}
}
