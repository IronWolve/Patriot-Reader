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
    private final RequestGate requestGate=new RequestGate();
    private final Handler main=new Handler(Looper.getMainLooper());
    private Vault vault; private ApiClient api; private CacheStore cache;
    private String pendingPickerId, pendingExportId,pendingUploadUser; private JSONObject pendingExport;
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
    private static final int PICK_UPLOAD=40, EXPORT=41;

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        recoverFileOperation();
        WebView.setWebContentsDebuggingEnabled(false);
        getWindow().setStatusBarColor(Color.rgb(21,23,25));getWindow().setNavigationBarColor(Color.rgb(21,23,25));
        root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(21,23,25));
        root.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        setContentView(root);vault=new Vault(this);cache=new CacheStore(new File(getCacheDir(),"reader"));api=new ApiClient(vault,cache);
        cache.setLimit(settings().optLong("cacheMb",64)*1024*1024);
        reader=new WebView(this);configure(reader);root.addView(reader,new FrameLayout.LayoutParams(-1,-1));
        reader.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri u=request.getUrl();String url=u.toString();
                if(Policy.ORIGIN.equals(u.getScheme()+"://"+u.getHost())){
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
        try{
            JSONObject saved=cache.get("image:"+url);if(saved!=null){JSONObject data=saved.getJSONObject("data");return new WebResourceResponse(data.getString("mime"),null,new ByteArrayInputStream(android.util.Base64.decode(data.getString("bytes"),0)));}
            String target=url;HttpURLConnection c=null;
            for(int i=0;i<4;i++){
                if(!Policy.media(target))return empty();c=ApiClient.connection(target);int status=c.getResponseCode();
                if(status>=300&&status<400){String next=c.getHeaderField("Location");c.disconnect();target=new java.net.URL(new java.net.URL(target),next).toString();continue;}
                if(status!=200){c.disconnect();return empty();}
                String mime=c.getContentType();if(mime==null||!mime.startsWith("image/")){c.disconnect();return empty();}
                if(c.getContentLengthLong()<0||c.getContentLengthLong()>3L*1024*1024){
                    final HttpURLConnection streamConnection=c;
                    return new WebResourceResponse(mime.split(";")[0],null,new FilterInputStream(c.getInputStream()){@Override public void close()throws IOException{try{super.close();}finally{streamConnection.disconnect();}}});
                }
                byte[] bytes=ApiClient.read(c.getInputStream(),3*1024*1024);c.disconnect();
                cache.put("image:"+url,new JSONObject().put("mime",mime.split(";")[0]).put("bytes",android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP)));
                return new WebResourceResponse(mime.split(";")[0],null,new ByteArrayInputStream(bytes));
            }
        }catch(Exception ignored){}return empty();
    }
    private JSONObject settings(){
        try{return new JSONObject(getSharedPreferences("reader",0).getString("settings","{}"));}catch(Exception e){return new JSONObject();}
    }
    private JSONObject bootstrap()throws Exception{
        JSONObject account=vault.read();ConnectivityManager cm=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        return new JSONObject().put("settings",settings()).put("appVersion",getPackageManager().getPackageInfo(getPackageName(),0).versionName).put("username",account.optString("username",""))
            .put("sessionNeedsReset",vault.needsReset()).put("notice",getSharedPreferences("operations",0).getString("notice",""))
            .put("metered",cm.isActiveNetworkMetered()).put("cacheBytes",cache.size()).put("downloads",downloads())
            .put("systemDark",(getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES);
    }
    private void dispatch(String text){
        if(text==null||text.length()>1024*1024)return;
        String requestId=null;
        try{
            JSONObject req=new JSONObject(text);String id=requestGate.bind(req.getString("id")),op=req.getString("op");JSONObject args=req.optJSONObject("args");final JSONObject a=args==null?new JSONObject():args;
            requestId=id;
            if(op.equals("copyText")){String value=a.getString("text");if(value.length()>500000)throw new IOException("Too much text to copy at once. Keep the app open, free storage and use Retry save.");((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Patriot Reader recovery",value));reply(id,new JSONObject(),null);return;}
            if(op.equals("dismissNotice")){getSharedPreferences("operations",0).edit().remove("notice").commit();reply(id,new JSONObject(),null);return;}
            if(op.equals("settings")){settingsWrites.execute(()->{try{if(!getSharedPreferences("reader",0).edit().putString("settings",a.toString()).commit())throw new IOException("Could not save settings. Please retry.");cache.setLimit(Math.max(16,Math.min(256,a.optInt("cacheMb",64)))*1024L*1024L);main.post(()->{if(!isDestroyed())reader.getSettings().setMediaPlaybackRequiresUserGesture(!a.optBoolean("autoplay",false));});reply(id,a,null);}catch(Exception e){reply(id,null,safeError(e));}});return;}
            if(op.equals("exit")){moveTaskToBack(true);reply(id,new JSONObject(),null);return;}
            if(op.equals("openDownload")){openDownload(a.getLong("downloadId"));reply(id,new JSONObject(),null);return;}
            if(op.equals("login")||op.equals("website")){openWebsite(op.equals("login")?Policy.SITE+"/login":a.optString("url",Policy.SITE),id,op.equals("login"));return;}
            if(op.equals("upload")){chooseUpload(id,a.optString("expectedUser",""));return;}
            if(op.equals("export")||op.equals("extract")){export(id,a.put("extract",op.equals("extract")));return;}
            if(op.equals("openX")){openX(a.optString("url"));reply(id,new JSONObject(),null);return;}
            if(op.equals("external")){external(a.optString("url"));reply(id,new JSONObject(),null);return;}
            if(op.equals("share")){share(a);reply(id,new JSONObject(),null);return;}
            workers.execute(()->{try{
                Object result;
                switch(op){
                    case "bootstrap":result=bootstrap();break;
                    case "api":result=api.call(a.optString("method","GET"),a.getString("path"),a.optJSONObject("params")==null?new JSONObject():a.getJSONObject("params"),a.has("expectedUser")?a.getString("expectedUser"):null);break;
                    case "rumbleEmbed":result=api.rumbleEmbed(a.getString("url"));break;
                    case "truthPost":result=api.truthPost(a.getString("id"));break;
                    case "cacheInfo":result=new JSONObject().put("bytes",cache.size());break;
                    case "clearCache":cache.clear();result=new JSONObject().put("bytes",0);break;
                    case "logout":vault.clear();main.post(()->{CookieManager.getInstance().removeAllCookies(null);WebStorage.getInstance().deleteOrigin(Policy.SITE);});result=new JSONObject();break;
                    case "download":result=download(a);break;
                    case "downloads":result=downloads();break;
                    case "cancelDownload":cancelDownload(a.getLong("downloadId"));result=downloads();break;
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
        websiteRequestId=requestId;websiteGeneration++;loginMode=forLogin;loginProbeBusy=false;nextLoginAttempt=0;
        try{signInScript=new String(ApiClient.read(getAssets().open("signin.js"),16384),"UTF-8");}
        catch(Exception error){loginMode=false;websiteRequestId=null;reply(requestId,null,"Could not open sign-in. Please reopen the app.");return;}
        websitePanel=new LinearLayout(this);websitePanel.setOrientation(LinearLayout.VERTICAL);websitePanel.setBackgroundColor(Color.rgb(21,23,25));
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);
        websiteStatus=new TextView(this);websiteStatus.setText(forLogin?"Sign in to patriots.win":Uri.parse(url).getHost());websiteStatus.setTextColor(Color.rgb(242,241,237));websiteStatus.setTextSize(14);websiteStatus.setPadding(12,6,6,6);
        ImageButton close=new ImageButton(this);close.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);close.setColorFilter(Color.rgb(183,189,196));close.setBackgroundColor(Color.TRANSPARENT);close.setContentDescription("Close website and return to reader");
        int barSize=(int)(44*getResources().getDisplayMetrics().density);
        bar.addView(websiteStatus,new LinearLayout.LayoutParams(0,-2,1));bar.addView(close,new LinearLayout.LayoutParams(barSize,barSize));websitePanel.addView(bar,new LinearLayout.LayoutParams(-1,barSize));
        website=new WebView(this);configure(website);website.setWebChromeClient(mediaChrome());websitePanel.addView(website,new LinearLayout.LayoutParams(-1,0,1));root.addView(websitePanel,new FrameLayout.LayoutParams(-1,-1));
        website.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String loadedUrl){if(view==website){if(websiteStatus!=null)websiteStatus.setText(loginMode&&Policy.site(loadedUrl)?"Sign in to patriots.win":Uri.parse(loadedUrl).getHost());if(loginMode){main.removeCallbacks(signInPoll);main.post(signInPoll);}}}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){return !Policy.https(r.getUrl().toString());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest r){
                String h=r.getUrl().getHost();if(!settings().optBoolean("showAds",false)&&h!=null&&(h.equals("ads.scored.co")||h.endsWith(".adskeeper.com")||h.endsWith(".whizzco.com")||h.equals("www.googletagmanager.com")||h.endsWith(".google-analytics.com")))return empty();return null;
            }
        });
        CookieManager.getInstance().setCookie(Policy.SITE,"forcePlatform=mobile; Path=/; Secure; SameSite=Lax");website.loadUrl(url);
        close.setOnClickListener(v->closeWebsite());
    }
    private boolean currentLogin(WebView view,long generation){return loginMode&&website==view&&websiteGeneration==generation&&!activityPaused&&Policy.site(view.getUrl());}
    private void probeSignIn(){
        if(loginProbeBusy||SystemClock.uptimeMillis()<nextLoginAttempt||website==null||!Policy.site(website.getUrl()))return;
        final WebView view=website;final long generation=websiteGeneration;loginProbeBusy=true;
        view.evaluateJavascript(signInScript,raw->{
            if(!currentLogin(view,generation)){if(websiteGeneration==generation)loginProbeBusy=false;return;}
            final JSONObject auth;
            try{Object decoded=new JSONTokener(raw).nextValue();if(!(decoded instanceof String)){loginProbeBusy=false;return;}auth=new JSONObject((String)decoded);}
            catch(Exception e){loginProbeBusy=false;return;}
            websiteStatus.setText("Finishing sign-in…");
            workers.execute(()->{try{
                JSONObject profile=api.validateSession(auth);
                main.post(()->{
                    if(!currentLogin(view,generation)){if(websiteGeneration==generation)loginProbeBusy=false;return;}
                    // Recheck the exact session before committing: closing, navigating or
                    // changing accounts must not let a stale validation replace the login.
                    view.evaluateJavascript(signInScript,latest->{
                        if(!currentLogin(view,generation)){if(websiteGeneration==generation)loginProbeBusy=false;return;}
                        if(!raw.equals(latest)){loginProbeBusy=false;websiteStatus.setText("Sign in to patriots.win");return;}
                        try{vault.save(auth.put("username",profile.getString("username")));String id=websiteRequestId;websiteRequestId=null;closeWebsite();reply(id,profile,null);event("account",profile);}
                        catch(Exception e){loginFailed(view,generation);}
                    });
                });
            }catch(Exception e){main.post(()->loginFailed(view,generation));}});
        });
    }
    private void loginFailed(WebView view,long generation){if(websiteGeneration!=generation)return;loginProbeBusy=false;nextLoginAttempt=SystemClock.uptimeMillis()+10000;if(currentLogin(view,generation))websiteStatus.setText("Couldn’t confirm sign-in. Retrying…");}
    private void closeWebsite(){websiteGeneration++;loginMode=false;loginProbeBusy=false;main.removeCallbacks(signInPoll);if(website!=null){website.stopLoading();website.destroy();website=null;}if(websitePanel!=null){root.removeView(websitePanel);websitePanel=null;}websiteStatus=null;CookieManager.getInstance().flush();if(websiteRequestId!=null){reply(websiteRequestId,new JSONObject(),null);websiteRequestId=null;}}
    private void notice(String message){getSharedPreferences("operations",0).edit().putString("notice",message).commit();event("notice",message);}
    private void pendingOperation(String kind)throws IOException{if(!getSharedPreferences("operations",0).edit().putString("pending",kind).commit())throw new IOException("Could not save the pending file operation. Please retry.");}
    private boolean clearPendingOperation(){return getSharedPreferences("operations",0).edit().remove("pending").remove("source").remove("destination").commit();}
    private void recoverFileOperation(){
        android.content.SharedPreferences prefs=getSharedPreferences("operations",0);String pending=prefs.getString("pending","");
        if(pending.equals("export-writing")){
            String destination=prefs.getString("destination",""),source=prefs.getString("source","");pendingExportId="recovering";
            workers.execute(()->{boolean clean=destination.isEmpty()||destination.equals(source)||removeCreatedDocument(Uri.parse(destination));clearPendingOperation();notice(clean?"An interrupted save was cleaned up. The original download is preserved; choose Save copy again.":"A save was interrupted. The original download is preserved, but an incomplete output may remain in Files.");main.post(()->pendingExportId=null);});
        }else if(!pending.isEmpty())notice("File selection was interrupted. Choose the file or destination again; saved drafts are preserved.");
    }
    private void chooseUpload(String id,String expectedUser)throws Exception{
        if(pendingPickerId!=null||pendingExportId!=null){reply(id,null,"A file picker is already open.");return;}
        pendingOperation("upload");pendingPickerId=id;pendingUploadUser=expectedUser;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png","image/gif","image/webp","video/mp4"});
        try{startActivityForResult(intent,PICK_UPLOAD);}catch(Exception e){pendingPickerId=null;pendingUploadUser=null;clearPendingOperation();throw e;}
    }
    private DownloadManager dm(){return (DownloadManager)getSystemService(DOWNLOAD_SERVICE);}
    private synchronized JSONObject download(JSONObject a)throws Exception {
        String url=a.getString("url");if(!Policy.media(url))throw new IOException("This embedded source does not offer a supported direct media download. Open the original instead.");
        JSONArray existing=downloads();for(int i=0;i<existing.length();i++){JSONObject item=existing.getJSONObject(i);if(item.optString("url").equals(url)&&item.optInt("status")!=DownloadManager.STATUS_FAILED)return new JSONObject().put("downloadId",item.getLong("id")).put("duplicate",true);}
        String name=Policy.filename(a.optString("name",Uri.parse(url).getLastPathSegment()));
        String unique=System.currentTimeMillis()+"-"+name;
        DownloadManager.Request request=new DownloadManager.Request(Uri.parse(url)).setTitle(name).setDescription("Patriot Reader media")
            .addRequestHeader("User-Agent",Policy.USER_AGENT).setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,"Patriot Reader/"+unique).setAllowedOverMetered(!settings().optBoolean("wifiDownloads",false));
        long id=dm().enqueue(request);String ids=getSharedPreferences("downloads",0).getString("ids","");getSharedPreferences("downloads",0).edit().putString("ids",ids+id+",").commit();return new JSONObject().put("downloadId",id);
    }
    private Set<Long> downloadIds(){Set<Long> ids=new HashSet<>();for(String s:getSharedPreferences("downloads",0).getString("ids","").split(",")){try{ids.add(Long.parseLong(s));}catch(Exception ignored){}}return ids;}
    private JSONArray downloads()throws Exception {
        JSONArray out=new JSONArray();Set<Long> ids=downloadIds();if(ids.isEmpty())return out;
        long[] values=new long[ids.size()];int p=0;for(long id:ids)values[p++]=id;
        try(Cursor c=dm().query(new DownloadManager.Query().setFilterById(values))){if(c==null)return out;while(c.moveToNext()){
            JSONObject item=new JSONObject().put("id",c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)))
                .put("name",c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)))
                .put("url",c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_URI)))
                .put("mime",c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_MEDIA_TYPE)))
                .put("status",c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)))
                .put("bytes",c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                .put("total",c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
                .put("reason",c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)));out.put(item);
        }}return out;
    }
    private void cancelDownload(long id)throws Exception {
        if(!downloadIds().contains(id))throw new IOException("Unknown download");
        try(Cursor c=dm().query(new DownloadManager.Query().setFilterById(id))){if(c!=null&&c.moveToFirst()&&c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))==DownloadManager.STATUS_SUCCESSFUL)throw new IOException("Completed files are preserved. Manage them in Files.");}
        dm().remove(id);
    }
    private void share(JSONObject a)throws Exception {
        Intent intent;
        if(a.has("downloadId")){long id=a.getLong("downloadId");if(!downloadIds().contains(id))throw new IOException("Unknown download");Uri uri=dm().getUriForDownloadedFile(id);if(uri==null)throw new IOException("Wait for the download to complete.");String mime=dm().getMimeTypeForDownloadedFile(id);intent=new Intent(Intent.ACTION_SEND).setType(mime==null?"application/octet-stream":mime).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);}
        else {String url=a.getString("url");if(!Policy.https(url))throw new IOException("Invalid link");intent=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,url);}
        startActivity(Intent.createChooser(intent,"Share"));
    }
    private void openDownload(long id)throws Exception{
        if(!downloadIds().contains(id))throw new IOException("Unknown download");Uri uri=dm().getUriForDownloadedFile(id);if(uri==null)throw new IOException("Wait for the download to complete.");
        String mime=dm().getMimeTypeForDownloadedFile(id);if(mime==null)mime="application/octet-stream";
        try{startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));}
        catch(ActivityNotFoundException e){throw new IOException("No app is available to open this file. Try Share or Save copy.");}
    }
    private void export(String id,JSONObject a)throws Exception {
        long downloadId=a.getLong("downloadId");Uri source=dm().getUriForDownloadedFile(downloadId);
        if(!downloadIds().contains(downloadId)||source==null)throw new IOException("Download the file first.");
        if(pendingExportId!=null||pendingPickerId!=null)throw new IOException("A file picker is already open.");pendingExportId=id;pendingExport=a;
        workers.execute(()->{try{
            if(a.optBoolean("extract"))verifyAudio(source);
            main.post(()->{try{
                if(requestGate.currentId(id)==null){pendingExportId=null;pendingExport=null;return;}
                pendingOperation("export:"+source);String mime=a.optBoolean("extract")?"audio/mp4":dm().getMimeTypeForDownloadedFile(downloadId);if(mime==null)mime="application/octet-stream";
                startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,a.optBoolean("extract")?"audio.m4a":Policy.filename(a.optString("name","media"))),EXPORT);
            }catch(Exception e){pendingExportId=null;pendingExport=null;clearPendingOperation();reply(id,null,safeError(e));}});
        }catch(Exception e){main.post(()->{pendingExportId=null;pendingExport=null;reply(id,null,safeError(e));});}});
    }
    private boolean removeCreatedDocument(Uri uri){
        if(uri==null)return true;try{return android.provider.DocumentsContract.deleteDocument(getContentResolver(),uri);}catch(Exception ignored){return false;}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request!=PICK_UPLOAD&&request!=EXPORT)return;
        String priorOperation=getSharedPreferences("operations",0).getString("pending","");
        if(request==PICK_UPLOAD)clearPendingOperation();
        if(request==PICK_UPLOAD){
            String id=pendingPickerId,user=pendingUploadUser;pendingPickerId=null;pendingUploadUser=null;
            if(id==null||requestGate.currentId(id)==null){notice("File selection was interrupted. Choose the file again; your draft is preserved.");return;}
            if(result!=RESULT_OK||data==null||data.getData()==null){reply(id,null,"File selection cancelled");return;}
            try{
                Uri uri=data.getData();String mime=getContentResolver().getType(uri),name="upload";long size=-1;
                try(Cursor c=getContentResolver().query(uri,null,null,null,null)){if(c!=null&&c.moveToFirst()){name=c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME));int col=c.getColumnIndex(OpenableColumns.SIZE);if(col>=0&&!c.isNull(col))size=c.getLong(col);}}
                final String filename=name,kind=mime==null?"application/octet-stream":mime;
                long max=kind.equals("video/mp4")||kind.equals("image/gif")?100L*1024*1024:12L*1024*1024;
                if(size<0||size>max){reply(id,null,"Choose a local file within the site's size limit (12 MB images; 100 MB GIF/MP4).");return;}
                new AlertDialog.Builder(this).setTitle("Upload media?").setMessage("Upload "+filename+" to "+(kind.equals("video/mp4")?"Videy":"Scored")+" for your post?")
                    .setNegativeButton("Cancel",(d,w)->reply(id,null,"Upload cancelled"))
                    .setPositiveButton("Upload",(d,w)->workers.execute(()->{try{reply(id,api.upload(this,uri,filename,kind,user),null);}catch(Exception e){reply(id,null,safeError(e));}})).setOnCancelListener(d->reply(id,null,"Upload cancelled")).show();
            }catch(Exception e){reply(id,null,safeError(e));}
        }else{
            String id=pendingExportId;JSONObject a=pendingExport;
            final Uri destination=data==null?null:data.getData();
            if(id==null||a==null||requestGate.currentId(id)==null){
                pendingExportId=null;pendingExport=null;clearPendingOperation();
                workers.execute(()->{boolean protectedSource=destination!=null&&priorOperation.equals("export:"+destination);boolean clean=result!=RESULT_OK||protectedSource||removeCreatedDocument(destination);notice("Save was interrupted. Choose the destination again."+(clean?"":" An incomplete file remains; remove it in Files."));});return;
            }
            if(result!=RESULT_OK||destination==null){pendingExportId=null;pendingExport=null;clearPendingOperation();reply(id,null,"Save cancelled");return;}
            workers.execute(()->{Uri source=dm().getUriForDownloadedFile(a.optLong("downloadId"));boolean protectedSource=destination.equals(source);try{
                if(source==null)throw new IOException("The original download is no longer available.");
                if(source.equals(destination))throw new IOException("Choose a different destination from the original download.");
                try{getContentResolver().takePersistableUriPermission(destination,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(SecurityException ignored){}
                if(!getSharedPreferences("operations",0).edit().putString("pending","export-writing").putString("source",source.toString()).putString("destination",destination.toString()).commit())throw new IOException("Could not save recovery information. The original download is preserved.");
                if(a.optBoolean("extract"))extractAudio(source,destination);
                else try(InputStream in=getContentResolver().openInputStream(source);OutputStream out=getContentResolver().openOutputStream(destination,"wt")){if(in==null||out==null)throw new IOException("Could not open the selected files.");byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}
                if(!clearPendingOperation())throw new IOException("Could not finish saving the recovery record. The original download is preserved.");
                reply(id,new JSONObject().put("saved",true),null);
            }catch(Exception e){boolean clean=protectedSource||removeCreatedDocument(destination);reply(id,null,safeError(e)+(clean?"":" An incomplete file remains at the selected destination; remove it in Files."));}finally{clearPendingOperation();main.post(()->{pendingExportId=null;pendingExport=null;});}});
        }
    }
    private int audioTrack(android.media.MediaExtractor extractor){
        for(int i=0;i<extractor.getTrackCount();i++)if("audio/mp4a-latm".equals(extractor.getTrackFormat(i).getString(android.media.MediaFormat.KEY_MIME)))return i;return -1;
    }
    private void verifyAudio(Uri source)throws Exception{
        android.media.MediaExtractor extractor=new android.media.MediaExtractor();
        try(android.content.res.AssetFileDescriptor input=getContentResolver().openAssetFileDescriptor(source,"r")){
            if(input==null)throw new IOException("Could not open the downloaded video.");extractor.setDataSource(input.getFileDescriptor(),input.getStartOffset(),input.getLength());
            if(audioTrack(extractor)<0)throw new IOException("This video has no supported AAC audio track. No output file was created.");
        }finally{extractor.release();}
    }
    private void extractAudio(Uri source,Uri destination)throws Exception {
        android.media.MediaExtractor extractor=new android.media.MediaExtractor();android.media.MediaMuxer muxer=null;boolean started=false;
        try(android.content.res.AssetFileDescriptor input=getContentResolver().openAssetFileDescriptor(source,"r")){
            if(input==null)throw new IOException("Could not open the downloaded video.");extractor.setDataSource(input.getFileDescriptor(),input.getStartOffset(),input.getLength());int track=audioTrack(extractor);
            if(track<0)throw new IOException("This video has no supported AAC audio track. The original video is preserved.");
            extractor.selectTrack(track);
            try(ParcelFileDescriptor output=getContentResolver().openFileDescriptor(destination,"rwt")){
                if(output==null)throw new IOException("Could not open the output file.");muxer=new android.media.MediaMuxer(output.getFileDescriptor(),android.media.MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
                int target=muxer.addTrack(extractor.getTrackFormat(track));muxer.start();started=true;
                java.nio.ByteBuffer buffer=java.nio.ByteBuffer.allocate(1024*1024);android.media.MediaCodec.BufferInfo info=new android.media.MediaCodec.BufferInfo();
                while(true){int n=extractor.readSampleData(buffer,0);if(n<0)break;info.set(0,n,extractor.getSampleTime(),extractor.getSampleFlags());muxer.writeSampleData(target,buffer,info);extractor.advance();}
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
    private void external(String url){if(!Policy.https(url))return;if(websitePanel==null){reader.evaluateJavascript("window.ReaderPause && window.ReaderPause()",null);openWebsite(url,null,false);}else website.loadUrl(url);}
    private void hideFullScreen(){if(fullScreen!=null){root.removeView(fullScreen);fullScreen=null;fullScreenCallback.onCustomViewHidden();fullScreenCallback=null;getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}}
    @Override public void onBackPressed(){if(fullScreen!=null){hideFullScreen();return;}if(website!=null){closeWebsite();return;}reader.evaluateJavascript("window.ReaderBack && window.ReaderBack()",null);}
    @Override protected void onResume(){super.onResume();activityPaused=false;if(loginMode){main.removeCallbacks(signInPoll);main.post(signInPoll);}}
    @Override protected void onPause(){activityPaused=true;main.removeCallbacks(signInPoll);super.onPause();if(reader!=null)reader.evaluateJavascript("window.ReaderPause && window.ReaderPause()",null);CookieManager.getInstance().flush();}
    @Override public void onConfigurationChanged(Configuration c){super.onConfigurationChanged(c);event("systemTheme",(c.uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES);}
    @Override protected void onDestroy(){websiteGeneration++;loginMode=false;main.removeCallbacks(signInPoll);if(networkCallback!=null)((ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(networkCallback);if(port!=null)port.close();if(website!=null)website.destroy();if(reader!=null)reader.destroy();workers.shutdown();requestGate.reset();super.onDestroy();}
}
