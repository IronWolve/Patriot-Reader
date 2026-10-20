package app.patriotreader;

import android.app.DownloadManager;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.ContentUris;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.system.Os;
import android.system.OsConstants;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Owns download registration, private transfer cancellation and public publication across Activities. */
public final class DownloadStore {
    private static final int PUBLICATION_JOB=37;
    private static final ExecutorService jobStarts=Executors.newSingleThreadExecutor();
    static final class WorkOwner {
        private volatile boolean stopped;
        void stop(){stopped=true;}
        boolean isStopped(){return stopped;}
        void checkpoint()throws PublicationStopped{if(stopped)throw new PublicationStopped();}
    }
    private static final WorkOwner foreground=new WorkOwner();
    static final class PublicationStopped extends IOException {PublicationStopped(){super("Publication paused for a later job.");}}
    static void schedule(Context context){
        JobScheduler jobs=(JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        jobs.schedule(new JobInfo.Builder(PUBLICATION_JOB,new ComponentName(context,PublicationService.class))
            .setMinimumLatency(1000).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_LINEAR).build());
    }
    public static final class CompletionReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context,Intent intent){if(intent!=null&&DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction()))schedule(context);}
    }
    public static final class BootReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context,Intent intent){if(intent!=null&&Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()))schedule(context);}
    }
    public static final class PublicationService extends JobService {
        private volatile JobParameters active;
        private volatile WorkOwner owner;
        private void finish(JobParameters params,WorkOwner token,boolean retry){new android.os.Handler(android.os.Looper.getMainLooper()).post(()->{
            if(active==params&&owner==token){active=null;owner=null;jobFinished(params,retry);}
        });}
        @Override public boolean onStartJob(JobParameters params){
            if(owner!=null)owner.stop();WorkOwner token=new WorkOwner();owner=token;active=params;Context app=getApplicationContext();
            jobStarts.execute(()->{try{token.checkpoint();DownloadStore store=get(app);token.checkpoint();store.scan(token,retry->finish(params,token,retry));}
                catch(PublicationStopped stopped){}catch(Exception error){finish(params,token,true);}});return true;
        }
        @Override public boolean onStopJob(JobParameters params){if(active==params){if(owner!=null)owner.stop();owner=null;active=null;}return true;}
    }
    interface Listener {void changed();}
    private static DownloadStore instance;
    static synchronized DownloadStore get(Context context)throws IOException{
        if(instance==null)instance=new DownloadStore(context.getApplicationContext());return instance;
    }
    private final Context context;private final DownloadManager manager;private final SharedPreferences prefs;
    private final File staging;private final JSONObject records;
    private final ExecutorService publications=Executors.newSingleThreadExecutor();
    private final Set<Long> publishing=new HashSet<>();
    private final CompletedDownloadCache<JSONObject> completed=new CompletedDownloadCache<>();
    private boolean metadataDirty;
    private Listener listener;
    private DownloadStore(Context context)throws IOException{
        this.context=context;manager=(DownloadManager)context.getSystemService(Context.DOWNLOAD_SERVICE);prefs=context.getSharedPreferences("downloads",0);
        File directory=context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if(directory==null)throw new IOException("Download storage is unavailable.");staging=new File(directory,"pending");
        if(!staging.isDirectory()&&!staging.mkdirs())throw new IOException("Could not prepare download storage.");
        JSONObject loaded;try{loaded=new JSONObject(prefs.getString("records","{}"));}catch(Exception error){throw new IOException("Saved download history could not be read. Its original record and files are preserved. Retry after storage recovers; saved files can still be managed in Android Files.",error);}records=loaded;
        // Older app versions registered only IDs. Their public destinations are never moved or removed.
        for(String value:prefs.getString("ids","").split(","))try{String id=String.valueOf(Long.parseLong(value));if(!records.has(id)){records.put(id,new JSONObject());metadataDirty=true;}}catch(Exception ignored){}
    }
    synchronized void listen(Listener next){listener=next;}
    synchronized void detach(Listener old){if(listener==old)listener=null;}
    private void changed(){Listener current;synchronized(this){current=listener;}if(current!=null)current.changed();}
    private void persist()throws IOException{
        metadataDirty=true;
        if(!prefs.edit().putString("records",records.toString()).remove("ids").commit())throw new IOException("Could not save download history. The system download is preserved; reopen Downloads to recover it.");
        metadataDirty=false;
    }
    private void commitRecord(long id,JSONObject value)throws Exception{
        JSONObject candidate=new JSONObject(records.toString()).put(String.valueOf(id),value);
        if(!prefs.edit().putString("records",candidate.toString()).remove("ids").commit())throw new IOException("Could not finish saving download history; its private source is preserved.");
        records.put(String.valueOf(id),value);metadataDirty=false;
    }
    private static boolean publicUri(Uri uri){return "content".equals(uri.getScheme())&&"media".equals(uri.getAuthority())&&uri.getPath()!=null&&uri.getPath().matches("/(external|external_primary)/downloads/[1-9][0-9]*");}
    private void scan(WorkOwner owner,Consumer<Boolean> done){publications.execute(()->{
        boolean success=false;try{owner.checkpoint();list(owner,false);success=true;}catch(Exception ignored){}
        final boolean scanned=success;publications.execute(()->{try{owner.checkpoint();boolean retry=!scanned;try{retry|=hasPendingPublication(owner);}catch(Exception uncertain){retry=true;}done.accept(retry);}catch(PublicationStopped stopped){}});
    });}
    private synchronized boolean hasPendingPublication(WorkOwner owner)throws Exception{
        owner.checkpoint();if(metadataDirty)return true;
        Iterator<String> keys=records.keys();while(keys.hasNext()){
            owner.checkpoint();String key=keys.next();JSONObject meta=records.optJSONObject(key);if(meta==null||meta.has("publishedUri")||meta.optBoolean("cancelled"))continue;
            if(meta.optBoolean("cancelRequested"))return true;if(meta.has("publicationError"))continue;
            if(meta.optBoolean("copyComplete")&&meta.has("pendingUri"))return true;
            long id;try{id=Long.parseLong(key);}catch(NumberFormatException invalid){continue;}
            JSONObject item=query(id);if(meta.optBoolean("private")&&item!=null&&item.optInt("status")==DownloadManager.STATUS_SUCCESSFUL)return true;
        }return false;
    }
    private JSONObject record(long id)throws Exception{
        String key=String.valueOf(id);JSONObject value=records.optJSONObject(key);if(value==null){value=new JSONObject();records.put(key,value);metadataDirty=true;}return value;
    }
    private static String text(Cursor c,String column){int index=c.getColumnIndex(column);return index<0||c.isNull(index)?"":c.getString(index);}
    private static String mime(String value){String result=value==null?"":value.split(";",2)[0].trim().toLowerCase(Locale.ROOT);return result.isEmpty()?"application/octet-stream":result;}
    private boolean privateFile(String value){
        try{Uri uri=Uri.parse(value);if(!"file".equals(uri.getScheme()))return false;File file=new File(uri.getPath()).getCanonicalFile();return file.getParentFile().equals(staging.getCanonicalFile());}catch(Exception error){return false;}
    }
    private boolean privateOwned(JSONObject item,JSONObject meta){
        if(!meta.optBoolean("private")||!privateFile(meta.optString("stagingUri")))return false;
        String local=item.optString("local");return local.isEmpty()||local.equals(meta.optString("stagingUri"));
    }
    private JSONObject row(Cursor c)throws Exception{
        return new JSONObject().put("id",c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)))
            .put("name",text(c,DownloadManager.COLUMN_TITLE)).put("url",text(c,DownloadManager.COLUMN_URI))
            .put("mime",mime(text(c,DownloadManager.COLUMN_MEDIA_TYPE))).put("status",c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)))
            .put("bytes",c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
            .put("total",c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
            .put("reason",c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)))
            .put("local",text(c,DownloadManager.COLUMN_LOCAL_URI));
    }
    private JSONObject query(long id)throws Exception{
        try(Cursor c=manager.query(new DownloadManager.Query().setFilterById(id))){if(c==null)throw new IOException("Could not confirm the local download state.");return c.moveToFirst()?row(c):null;}
    }
    synchronized JSONObject enqueue(JSONObject args,boolean unmeteredOnly)throws Exception{
        String url=args.getString("url");if(!Policy.media(url))throw new IOException("This source has no supported direct download. Open the original instead.");
        JSONArray current=list();for(int i=0;i<current.length();i++){
            JSONObject item=current.getJSONObject(i);if(url.equals(item.optString("url"))&&item.optInt("status")!=DownloadManager.STATUS_FAILED
                &&!(item.optInt("status")==DownloadManager.STATUS_SUCCESSFUL&&!item.optBoolean("available")))return new JSONObject().put("downloadId",item.getLong("id")).put("duplicate",true);
        }
        String name=Policy.filename(args.optString("name",Uri.parse(url).getLastPathSegment()));String unique=UUID.randomUUID().toString()+"-"+name;
        DownloadManager.Request request=new DownloadManager.Request(Uri.parse(url)).setTitle(name).setDescription("Patriot Reader media")
            .addRequestHeader("User-Agent",Policy.USER_AGENT).setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(context,Environment.DIRECTORY_DOWNLOADS,"pending/"+unique).setAllowedOverMetered(!unmeteredOnly);
        long id=manager.enqueue(request);record(id).put("private",true).put("stagingUri",Uri.fromFile(new File(staging,unique)).toString()).put("unmeteredOnly",unmeteredOnly);persist();schedule(context);
        return new JSONObject().put("downloadId",id);
    }
    synchronized JSONArray list()throws Exception{return list(true);}
    synchronized JSONArray list(boolean validateCompleted)throws Exception{return list(foreground,validateCompleted);}
    private synchronized JSONArray list(WorkOwner owner,boolean validateCompleted)throws Exception{
        owner.checkpoint();Map<Long,JSONObject> rows=new HashMap<>();
        // Querying this app's system history also recovers an ID whose registration commit failed.
        try(Cursor c=manager.query(new DownloadManager.Query())){if(c==null)throw new IOException("Could not read local download history.");while(c.moveToNext()){
            owner.checkpoint();
            JSONObject item=row(c);long id=item.getLong("id");JSONObject meta=record(id);rows.put(id,item);
            if(privateFile(item.optString("local"))&&!meta.optBoolean("private")){meta.put("private",true).put("stagingUri",item.optString("local"));metadataDirty=true;}
            for(String field:new String[]{"name","url","mime"})if(!String.valueOf(meta.opt(field)).equals(String.valueOf(item.opt(field)))){meta.put(field,item.opt(field));metadataDirty=true;}
            // DownloadManager owns live progress. Only a completed source needs a durable size receipt.
            if(item.optInt("status")==DownloadManager.STATUS_SUCCESSFUL)for(String field:new String[]{"bytes","total"})if(!String.valueOf(meta.opt(field)).equals(String.valueOf(item.opt(field)))){meta.put(field,item.opt(field));metadataDirty=true;}
        }}
        owner.checkpoint();if(metadataDirty)try{persist();}catch(IOException ignored){} // Retain dirty state so rediscovery retries registration.
        JSONArray result=new JSONArray();Iterator<String> keys=records.keys();
        while(keys.hasNext()){
            owner.checkpoint();
            String key=keys.next();long id;try{id=Long.parseLong(key);}catch(Exception ignored){continue;}
            JSONObject meta=records.optJSONObject(key);if(meta==null||meta.optBoolean("cancelled"))continue;
            JSONObject item=rows.get(id);
            if(meta.optBoolean("cancelRequested")){
                try{
                    if(item!=null){if(!privateOwned(item,meta))throw new IOException("Cancellation destination changed.");owner.checkpoint();manager.remove(id);}
                    owner.checkpoint();JSONObject cancelled=new JSONObject(meta.toString()).put("cancelled",true);cancelled.remove("cancelRequested");commitRecord(id,cancelled);continue;
                }catch(PublicationStopped stopped){throw stopped;}catch(Exception pending){if(item==null)continue;item.remove("local");item.put("status",DownloadManager.STATUS_PAUSED).put("canceling",true).put("cancelable",true).put("available",false);result.put(item);continue;}
            }
            if(meta.has("publishedUri")){
                item=new JSONObject().put("id",id).put("status",DownloadManager.STATUS_SUCCESSFUL).put("reason",0);
                for(String field:new String[]{"name","url","mime","bytes","total"})item.put(field,meta.opt(field));
                // Only a known private staging file may be removed after durable publication.
                JSONObject old=rows.get(id);if(old!=null&&privateFile(old.optString("local"))){owner.checkpoint();manager.remove(id);}
            }else if(item==null&&meta.has("pendingUri")&&meta.optBoolean("copyComplete")){
                item=new JSONObject(meta.toString()).put("id",id);if(meta.has("publicationError"))item.put("status",DownloadManager.STATUS_FAILED).put("publishingFailed",true);else{schedulePublication(id,owner);item.put("status",DownloadManager.STATUS_RUNNING).put("publishing",true);}
            }else if(item==null)continue;
            else if(item.optInt("status")==DownloadManager.STATUS_SUCCESSFUL&&meta.optBoolean("private")&&privateFile(item.optString("local"))){
                if(meta.has("publicationError"))item.put("status",DownloadManager.STATUS_FAILED).put("publishingFailed",true).put("publicationError",meta.optString("publicationError"));
                else{schedulePublication(id,owner);item.put("status",DownloadManager.STATUS_RUNNING).put("publishing",true);}
            }
            // The queried legacy row is refreshed on every scan, so source/size/type changes
            // invalidate its snapshot without another descriptor open. Never use this identity
            // as ownership or as a replacement for action/preview version validation.
            String completedIdentity=meta.has("publishedUri")?"public:"+meta.getString("publishedUri"):
                "legacy:"+new JSONArray().put(id).put(item.optString("local")).put(item.optString("url")).put(item.optString("mime")).put(item.optLong("bytes",-1)).put(item.optLong("total",-1)).toString();
            item.remove("local");item.put("cancelable",meta.optBoolean("private")&&!publishing.contains(id)&&!meta.has("publishedUri")&&!meta.has("pendingUri"));
            if(item.optInt("status")==DownloadManager.STATUS_SUCCESSFUL){
                final long completedId=id;
                // Reuse only metadata for the same public URI or current legacy row. Actions/media still open
                // and verify the current descriptor; explicit/foreground refresh validates all.
                JSONObject details=completed.resolve(id,completedIdentity,validateCompleted,()->{
                    JSONObject value=new JSONObject();
                    try(Source source=open(completedId)){
                        value.put("available",true).put("bytes",source.size).put("total",source.size).put("mime",source.mime).put("copyable",source.copyable).put("contentVersion",source.contentVersion);
                        if(DownloadMedia.supported(source.mime)){
                            value.put("previewUrl",Policy.ORIGIN+"/downloads/"+completedId+"/media?v="+source.contentVersion);
                            if(source.mime.startsWith("video/"))value.put("posterUrl",Policy.ORIGIN+"/downloads/"+completedId+"/thumbnail?v="+source.contentVersion);
                        }
                    }catch(Exception unavailable){value.put("available",false).put("copyable",false);}
                    return value;
                });
                Iterator<String> fields=details.keys();while(fields.hasNext()){String field=fields.next();item.put(field,details.get(field));}
            }else item.put("available",false).put("copyable",false);
            result.put(item);
        }
        return result;
    }
    private void schedulePublication(long id,WorkOwner owner)throws PublicationStopped{
        owner.checkpoint();
        JSONObject meta=records.optJSONObject(String.valueOf(id));
        if(meta!=null&&(meta.has("publicationError")||meta.optBoolean("cancelRequested"))||publishing.contains(id))return;
        publishing.add(id);publications.execute(()->{
            try{owner.checkpoint();publish(id,owner);}catch(PublicationStopped stopped){}catch(Exception error){if(!owner.isStopped())synchronized(this){
                try{record(id).put("publicationError","Could not save this file to public Downloads. Free storage or restore file access, then retry saving the local file.");persist();}catch(Exception ignored){}
            }}
            finally{synchronized(this){publishing.remove(id);}changed();}
        });
    }
    synchronized void retryPublication(long id)throws Exception{
        JSONObject meta=records.optJSONObject(String.valueOf(id));
        if(meta==null||meta.optBoolean("cancelled")||meta.optBoolean("cancelRequested")||!meta.optBoolean("private")||meta.has("publishedUri"))throw new IOException("No unfinished local save was found.");
        JSONObject retry=new JSONObject(meta.toString());retry.remove("publicationError");commitRecord(id,retry);schedulePublication(id,foreground);schedule(context);
    }
    private void publish(long id,WorkOwner owner)throws Exception{
        owner.checkpoint();
        JSONObject item,meta;Uri output;boolean complete;
        synchronized(this){
            item=query(id);meta=record(id);
            if(meta.optBoolean("cancelled")||meta.optBoolean("cancelRequested")||meta.has("publishedUri"))return;
            if(item==null){if(!meta.has("pendingUri")||!meta.optBoolean("copyComplete"))return;item=new JSONObject(meta.toString());}
            else if(item.optInt("status")!=DownloadManager.STATUS_SUCCESSFUL||!privateOwned(item,meta))return;
            output=meta.has("pendingUri")?Uri.parse(meta.getString("pendingUri")):null;complete=meta.optBoolean("copyComplete");
        }
        if(output!=null&&!publicUri(output))throw new IOException("Invalid pending download output.");
        ContentResolver resolver=context.getContentResolver();
        if(output!=null){
            owner.checkpoint();boolean exists;
            // An empty cursor proves absence; null/permission/provider errors remain uncertain and preserve the receipt.
            try(Cursor found=resolver.query(MediaStore.setIncludePending(output),new String[]{MediaStore.MediaColumns._ID,MediaStore.MediaColumns.OWNER_PACKAGE_NAME},null,null,null)){
                if(found==null)throw new IOException("Could not confirm the pending output. Retry when file access is restored.");
                exists=found.moveToFirst();if(exists&&!context.getPackageName().equals(found.getString(1)))throw new IOException("The pending output ownership changed; the original download is preserved.");
            }
            if(!exists){
                if(item==null||!privateOwned(item,meta))throw new IOException("The saved output is missing and its original local source is unavailable.");
                try(ParcelFileDescriptor original=manager.openDownloadedFile(id)){if(original==null||!OsConstants.S_ISREG(Os.fstat(original.getFileDescriptor()).st_mode))throw new IOException("The original local source is unavailable.");}
                synchronized(this){owner.checkpoint();JSONObject reset=new JSONObject(meta.toString());for(String field:new String[]{"pendingUri","copyComplete","publicationName","publicName"})reset.remove(field);commitRecord(id,reset);meta=reset;}
                output=null;complete=false;
            }
        }
        if(output==null){
            synchronized(this){owner.checkpoint();if(!meta.has("publicationName")){String nonce=UUID.randomUUID().toString();JSONObject named=new JSONObject(meta.toString()).put("publicationName","Patriot Reader pending "+nonce).put("publicName",nonce+"-"+Policy.filename(item.optString("name","media")));commitRecord(id,named);meta=named;}}
            String pendingName=meta.getString("publicationName"),relative=Environment.DIRECTORY_DOWNLOADS+"/Patriot Reader/";
            if(!pendingName.matches("Patriot Reader pending [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))throw new IOException("Invalid pending download receipt.");
            // The name receipt precedes insert. Recover this one app-owned hidden row if the process died before saving its URI.
            try(Cursor existing=resolver.query(MediaStore.setIncludePending(MediaStore.Downloads.EXTERNAL_CONTENT_URI),new String[]{MediaStore.MediaColumns._ID,MediaStore.MediaColumns.DISPLAY_NAME},
                    MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=? AND "+MediaStore.MediaColumns.RELATIVE_PATH+"=? AND "+MediaStore.MediaColumns.IS_PENDING+"=1",new String[]{context.getPackageName(),relative},null)){
                if(existing==null)throw new IOException("Could not inspect pending downloads. Retry when file access is restored.");while(existing.moveToNext()){
                    owner.checkpoint();
                    String actual=existing.getString(1);
                    if(actual!=null&&(actual.equals(pendingName)||actual.matches(java.util.regex.Pattern.quote(pendingName)+"\\.[A-Za-z0-9]{1,20}"))){
                        if(output!=null)throw new IOException("Several pending outputs match this save; the original download is preserved.");
                        output=ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI,existing.getLong(0));
                    }
                }
            }
            if(output==null){
                owner.checkpoint();
                ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,pendingName);
                values.put(MediaStore.MediaColumns.MIME_TYPE,item.optString("mime","application/octet-stream"));values.put(MediaStore.MediaColumns.RELATIVE_PATH,relative);values.put(MediaStore.MediaColumns.IS_PENDING,1);
                output=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);if(output==null)throw new IOException("Could not create the public download.");
            }
            synchronized(this){
                try{owner.checkpoint();JSONObject pending=new JSONObject(meta.toString()).put("pendingUri",output.toString()).put("copyComplete",false);commitRecord(id,pending);meta=pending;}
                catch(PublicationStopped stopped){throw stopped;}
                catch(Exception error){resolver.delete(output,null,null);throw error;}
            }
        }
        if(!complete){
            owner.checkpoint();
            try(ParcelFileDescriptor input=manager.openDownloadedFile(id);InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(input);OutputStream out=resolver.openOutputStream(output,"wt")){
                if(out==null)throw new IOException("Could not save the public download.");copyBytes(in,out,owner);
            }
            synchronized(this){owner.checkpoint();JSONObject copied=new JSONObject(meta.toString()).put("copyComplete",true);commitRecord(id,copied);meta=copied;}
        }
        synchronized(this){owner.checkpoint();if(!meta.has("publicName")){JSONObject named=new JSONObject(meta.toString()).put("publicName",UUID.randomUUID()+"-"+Policy.filename(item.optString("name","media")));commitRecord(id,named);meta=named;}}
        owner.checkpoint();
        ContentValues ready=new ContentValues();ready.put(MediaStore.MediaColumns.IS_PENDING,0);ready.put(MediaStore.MediaColumns.DISPLAY_NAME,meta.getString("publicName"));if(resolver.update(output,ready,null,null)!=1)throw new IOException("Could not finish the public download.");
        synchronized(this){
            owner.checkpoint();
            JSONObject published=new JSONObject(meta.toString()).put("publishedUri",output.toString());published.remove("pendingUri");published.remove("copyComplete");published.remove("publicationName");commitRecord(id,published);
            // Promotion owns this ID throughout; cancel cannot remove a completed public file.
            JSONObject current=query(id);if(current!=null&&privateFile(current.optString("local"))){owner.checkpoint();manager.remove(id);}
        }
    }
    static void copyBytes(InputStream input,OutputStream output,WorkOwner owner)throws IOException{
        byte[] buffer=new byte[65536];while(true){owner.checkpoint();int count=input.read(buffer);owner.checkpoint();if(count<0)return;if(count>0)output.write(buffer,0,count);}
    }
    synchronized void cancel(long id)throws Exception{
        JSONObject meta=records.optJSONObject(String.valueOf(id)),item=query(id);
        if(meta==null)throw new IOException("Unknown download.");
        if(meta.has("publishedUri"))throw new IOException("Completed files are preserved. Manage them in Files.");
        if(meta.has("pendingUri"))throw new IOException("This local save has a pending output. Retry saving to finish it safely.");
        if(publishing.contains(id))throw new IOException("This file is being saved to Downloads. Wait for it to finish.");
        if(item==null||!privateOwned(item,meta))throw new IOException("This older download already uses public Downloads. Manage it with Android Downloads; the app will preserve its file.");
        JSONObject requested=new JSONObject(meta.toString()).put("cancelRequested",true);commitRecord(id,requested);
        try{manager.remove(id);JSONObject cancelled=new JSONObject(requested.toString()).put("cancelled",true);cancelled.remove("cancelRequested");commitRecord(id,cancelled);}
        catch(Exception pending){schedule(context);throw new IOException("Cancellation is pending. Reopen Downloads to check it.");}
        changed();
    }
    synchronized Source open(long id)throws Exception{
        JSONObject meta=records.optJSONObject(String.valueOf(id));if(meta==null||meta.optBoolean("cancelled")||meta.optBoolean("cancelRequested"))throw new IOException("Unknown download.");
        Uri uri;String kind;ParcelFileDescriptor descriptor;
        if(meta.has("publishedUri")){
            uri=Uri.parse(meta.getString("publishedUri"));if(!publicUri(uri))throw new IOException("Invalid local download.");kind=mime(meta.optString("mime"));descriptor=context.getContentResolver().openFileDescriptor(uri,"r");
        }else{
            JSONObject item=query(id);if(item==null||item.optInt("status")!=DownloadManager.STATUS_SUCCESSFUL)throw new IOException("Wait for the download to finish.");
            if(meta.optBoolean("private"))throw new IOException("The file is being saved to public Downloads.");
            uri=manager.getUriForDownloadedFile(id);kind=mime(item.optString("mime"));descriptor=manager.openDownloadedFile(id);
        }
        if(descriptor==null||uri==null){if(descriptor!=null)descriptor.close();throw new IOException("This local file is no longer available.");}
        try{
            try{String current=context.getContentResolver().getType(uri);if(current!=null&&!current.trim().isEmpty())kind=mime(current);}catch(Exception unavailableMetadata){} // Keep a readable legacy source usable.
            android.system.StructStat stat=Os.fstat(descriptor.getFileDescriptor());if(!OsConstants.S_ISREG(stat.st_mode))throw new IOException("This download is not a local media file.");
            String version=contentVersion(stat.st_dev,stat.st_ino,stat.st_size,stat.st_mtim.tv_sec,stat.st_mtim.tv_nsec,stat.st_ctim.tv_sec,stat.st_ctim.tv_nsec,kind);
            return new Source(uri,kind,descriptor,stat.st_size,stat.st_mtime,version);
        }catch(Exception error){descriptor.close();throw error;}
    }
    static final class Source implements AutoCloseable {
        final Uri uri;final String mime,contentVersion;final boolean copyable;final ParcelFileDescriptor descriptor;final long size,modified;
        Source(Uri uri,String mime,ParcelFileDescriptor descriptor,long size,long modified,String version){this.uri=uri;this.mime=mime;this.descriptor=descriptor;this.size=size;this.modified=modified;contentVersion=version;copyable=mime.startsWith("image/")&&DownloadMedia.supported(mime);}
        @Override public void close()throws IOException{descriptor.close();}
    }
    static String contentVersion(long device,long inode,long size,long modifiedSeconds,long modifiedNanos,long changedSeconds,long changedNanos,String mime)throws Exception{
        String metadata=device+":"+inode+":"+size+":"+modifiedSeconds+":"+modifiedNanos+":"+changedSeconds+":"+changedNanos+":"+mime;
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(metadata.getBytes(StandardCharsets.UTF_8));StringBuilder value=new StringBuilder(64);
        for(byte b:digest){value.append(Character.forDigit((b>>>4)&15,16));value.append(Character.forDigit(b&15,16));}return value.toString();
    }
}
