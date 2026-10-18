package app.patriotreader;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Terminal upload receipts are independent of Activity/message lifetimes. */
final class UploadResults {
    static final class Receipt {
        final String id,username,site,url,name;final long completedAt;
        Receipt(String id,String username,String site,String url,String name,long completedAt){this.id=id;this.username=username;this.site=site;this.url=url;this.name=name;this.completedAt=completedAt;}
    }
    interface Persistence {boolean save(Map<String,Receipt> values);}
    /** Pure ownership/commit core; Android JSON and preferences are adapters below. */
    static final class Ledger {
        private final Persistence storage;private final boolean unreadable;private Map<String,Receipt> values;private boolean durable=true;
        Ledger(Persistence storage,Map<String,Receipt> initial,boolean unreadable){this.storage=storage;values=new LinkedHashMap<>(initial);this.unreadable=unreadable;}
        private void readable()throws IOException{if(unreadable)throw new IOException("Saved upload results could not be read. Their original record is preserved; new uploads are blocked to avoid overwriting it.");}
        private boolean save(Map<String,Receipt> candidate){try{return storage.save(new LinkedHashMap<>(candidate));}catch(Exception error){return false;}}
        synchronized Receipt find(String id,String user,String site)throws IOException{
            readable();retry();Receipt value=values.get(id);if(value==null)return null;
            if(!value.username.equalsIgnoreCase(user)||!value.site.equals(site))throw new IOException("This upload operation belongs to another account.");
            if(!durable)throw new IOException("This upload finished, but its result still needs saving. Keep the app open and recover its link from New post.");return value;
        }
        synchronized boolean remember(Receipt value)throws IOException{readable();values.put(value.id,value);durable=save(values);return durable;}
        synchronized boolean retry(){if(unreadable||durable)return false;durable=save(values);return durable;}
        synchronized List<Receipt> list()throws IOException{readable();retry();return new ArrayList<>(values.values());}
        synchronized boolean durable(){return durable;}
        synchronized void acknowledge(List<String> ids,String username)throws IOException{
            readable();if(username.isEmpty())throw new IOException("Upload receipt account is required.");Map<String,Receipt> candidate=new LinkedHashMap<>(values);
            for(String id:ids){Receipt value=candidate.get(id);if(value!=null&&!value.username.equalsIgnoreCase(username))throw new IOException("An upload result belongs to a different account.");candidate.remove(id);}
            if(!save(candidate))throw new IOException("Could not acknowledge upload results. Their links are preserved for retry.");values=candidate;durable=true;
        }
    }
    private static UploadResults instance;
    static synchronized UploadResults get(Context context){if(instance==null)instance=new UploadResults(context.getApplicationContext());return instance;}
    private final Ledger ledger;
    private static JSONObject json(Receipt value)throws Exception{return new JSONObject().put("operationId",value.id).put("username",value.username).put("site",value.site).put("url",value.url).put("name",value.name).put("completedAt",value.completedAt);}
    private UploadResults(Context context){
        SharedPreferences prefs=context.getSharedPreferences("file-results",0);Map<String,Receipt> initial=new LinkedHashMap<>();boolean unreadable=false;
        try{JSONObject data=new JSONObject(prefs.getString("uploads","{}"));java.util.Iterator<String> keys=data.keys();while(keys.hasNext()){
            String id=keys.next();JSONObject value=data.getJSONObject(id);if(!id.equals(value.getString("operationId")))throw new IOException("Mismatched receipt ID");
            initial.put(id,new Receipt(id,value.getString("username"),value.getString("site"),value.getString("url"),value.getString("name"),value.getLong("completedAt")));
        }}catch(Exception invalid){unreadable=true;initial.clear();}
        ledger=new Ledger(values->{try{JSONObject data=new JSONObject();for(Map.Entry<String,Receipt> entry:values.entrySet())data.put(entry.getKey(),json(entry.getValue()));return prefs.edit().putString("uploads",data.toString()).commit();}catch(Exception error){return false;}},initial,unreadable);
    }
    synchronized JSONObject find(String id,String user,String site)throws Exception{Receipt result=ledger.find(id,user,site);return result==null?null:json(result);}
    synchronized boolean remember(FileOperationGate.State operation,JSONObject result)throws Exception{
        if(operation==null)throw new IOException("Upload owner is unavailable.");return ledger.remember(new Receipt(operation.id,operation.username,operation.site,result.getString("url"),result.optString("name","Uploaded media"),System.currentTimeMillis()));
    }
    synchronized JSONObject list()throws Exception{JSONArray list=new JSONArray();for(Receipt receipt:ledger.list())list.put(json(receipt).put("durable",ledger.durable()));return new JSONObject().put("results",list);}
    synchronized boolean retry(){return ledger.retry();}
    synchronized void acknowledge(JSONArray ids,String user)throws Exception{List<String> names=new ArrayList<>();for(int i=0;i<ids.length();i++)names.add(ids.getString(i));ledger.acknowledge(names,user);}
}
