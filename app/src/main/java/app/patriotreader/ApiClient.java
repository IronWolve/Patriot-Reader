package app.patriotreader;

import java.io.*;
import java.net.*;
import org.json.*;

final class ApiClient {
    private final Vault vault;
    final CacheStore cache;
    ApiClient(Vault vault,CacheStore cache){this.vault=vault;this.cache=cache;}
    static byte[] read(InputStream in,int max)throws IOException {
        try(InputStream input=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] b=new byte[16384];int n;while((n=input.read(b))!=-1){if(out.size()+n>max)throw new IOException("Response is too large");out.write(b,0,n);}return out.toByteArray();
        }
    }
    static HttpURLConnection connection(String url)throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();c.setConnectTimeout(15000);c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(false);c.setRequestProperty("User-Agent",Policy.USER_AGENT);return c;
    }
    static String query(JSONObject values)throws Exception {
        StringBuilder b=new StringBuilder();java.util.Iterator<String> keys=values.keys();while(keys.hasNext()){
            String k=keys.next();if(b.length()>0)b.append('&');b.append(URLEncoder.encode(k,"UTF-8")).append('=').append(URLEncoder.encode(String.valueOf(values.get(k)),"UTF-8"));
        }return b.toString();
    }
    JSONObject request(String method,String path,JSONObject values,JSONObject auth)throws Exception {
        String params=query(values);HttpURLConnection c=connection(Policy.SITE+path+(method.equals("GET")&&!params.isEmpty()?"?"+params:""));
        c.setRequestMethod(method);c.setRequestProperty("Accept","application/json");
        if(auth!=null){c.setRequestProperty("X-Api-Key",auth.getString("api_key"));c.setRequestProperty("X-Api-Secret",auth.getString("api_secret"));}
        try{
            if(method.equals("POST")){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/x-www-form-urlencoded");try(OutputStream o=c.getOutputStream()){o.write(params.getBytes("UTF-8"));}}
            int status=c.getResponseCode();if(status==401||status==403)throw new ApiError(auth==null?"The website refused this public request. Retry or open the website.":"Sign in again or complete verification on the website.");if(status<200||status>=300)throw new IOException("Website returned HTTP "+status);
            JSONObject data=new JSONObject(new String(read(c.getInputStream(),8*1024*1024),"UTF-8"));
            Object result=data.opt("status");
            if(Boolean.FALSE.equals(result) || result instanceof String && !"success".equals(result)) {
                String message=data.optString("error",String.valueOf(result));if(message.isEmpty())message=String.valueOf(result);
                throw new ApiError(message);
            }
            return data;
        }finally{c.disconnect();}
    }
    JSONObject call(String method,String path,JSONObject values,String expectedUser)throws Exception {
        if(!Policy.apiAllowed(method,path))throw new IOException("Unsupported site operation");
        JSONObject saved=vault.read();
        RequestGate.requireAccount(expectedUser,saved.optString("username",""));
        if(method.equals("POST")&&!saved.has("api_key"))throw new ApiError("Sign in before posting or changing flair.");
        String namespace=saved.optString("username","guest").toLowerCase(java.util.Locale.ROOT);
        String key=namespace+":"+path+"?"+query(values);
        boolean cacheable=method.equals("GET")&&(path.startsWith("/api/v2/post/")||path.endsWith("post_flairs.json"));
        try{
            // Public reads need no account token. /token is only available after login.
            JSONObject data=request(method,path,values,saved.has("api_key")?saved:null);
            if(cacheable)cache.put(key,data);
            return new JSONObject().put("data",data).put("cached",false).put("savedAt",System.currentTimeMillis());
        }catch(ApiError error){throw error;}
        catch(Exception error){
            if(cacheable){JSONObject old=cache.get(key);if(old!=null)return old.put("cached",true);}
            throw error;
        }
    }
    JSONObject rumbleEmbed(String url)throws Exception {
        if(!Policy.rumble(url))throw new IOException("Unsupported Rumble video link.");
        JSONObject saved=cache.get("rumble:"+url);if(saved!=null)return saved.getJSONObject("data");
        HttpURLConnection c=connection("https://rumble.com/api/Media/oembed.json?url="+URLEncoder.encode(url,"UTF-8"));
        try{
            if(c.getResponseCode()!=200)throw new IOException("Rumble could not load this embedded video. You can open the original.");
            JSONObject data=new JSONObject(new String(read(c.getInputStream(),65536),"UTF-8"));
            java.util.regex.Matcher match=java.util.regex.Pattern.compile("src=[\"'](https://rumble\\.com/embed/[a-zA-Z0-9]+/?)[\"']").matcher(data.optString("html"));
            if(!match.find()||!Policy.embedDocument(match.group(1)))throw new IOException("This Rumble video is not available as an embed.");
            JSONObject result=new JSONObject().put("url",match.group(1));cache.put("rumble:"+url,result);return result;
        }finally{c.disconnect();}
    }
    JSONObject truthPost(String id)throws Exception {
        if(!id.matches("[0-9]{1,24}"))throw new IOException("Invalid Truth Social post ID.");
        String key="truth:"+id;
        // Public status metadata only. Never send the site's credentials or cookies here.
        HttpURLConnection c=connection("https://truthsocial.com/api/v1/statuses/"+id);
        c.setRequestProperty("Accept","application/json");
        try{
            int status=c.getResponseCode();
            if(status>=400&&status<500)throw new ApiError(status==404?"This Truth Social post is unavailable.":"Truth Social refused this public post request.");
            if(status!=200)throw new IOException("Truth Social could not load this post.");
            JSONObject post=new JSONObject(new String(read(c.getInputStream(),1024*1024),"UTF-8"));
            if(!id.equals(post.optString("id"))||post.optJSONObject("account")==null||!(post.opt("content") instanceof String))throw new IOException("Truth Social returned an unexpected post.");
            cache.put(key,post);
            return new JSONObject().put("data",post).put("cached",false).put("savedAt",System.currentTimeMillis());
        }catch(ApiError error){throw error;}
        catch(Exception error){JSONObject old=cache.get(key);if(old!=null)return old.put("cached",true);throw error;}
        finally{c.disconnect();}
    }
    JSONObject validateSession(JSONObject auth)throws Exception {
        if(auth.optString("api_key").isEmpty()||auth.optString("api_secret").isEmpty())throw new IOException("Finish signing in on the website first.");
        JSONObject profile=request("GET","/api/v2/user/about.json",new JSONObject().put("user","me"),auth).getJSONArray("users").getJSONObject(0);
        String username=profile.optString("username");if(username.isEmpty())throw new IOException("The website did not confirm a signed-in account.");
        return new JSONObject().put("username",username);
    }
    JSONObject upload(android.content.Context context,android.net.Uri uri,String name,String mime,String expectedUser)throws Exception {
        JSONObject auth=vault.read();RequestGate.requireAccount(expectedUser,auth.optString("username",""));if(!auth.has("api_key"))throw new IOException("Sign in before uploading.");
        boolean video="video/mp4".equals(mime);long max=video||"image/gif".equals(mime)?100L*1024*1024:12L*1024*1024;
        if(!video&&!mime.matches("image/(jpeg|png|gif|webp)"))throw new IOException("Choose JPG, PNG, GIF, WebP or MP4.");
        String target;
        if(video)target="https://videy.co/api/upload";
        else {JSONObject token=request("GET","/api/v2/upload/token.json",new JSONObject().put("uploadType","postMedia"),auth);target="https://media.scored.co/api/upload?token="+URLEncoder.encode(token.getString("token"),"UTF-8");}
        String boundary="Reader"+java.util.UUID.randomUUID().toString().replace("-","");
        HttpURLConnection c=connection(target);c.setReadTimeout(120000);c.setRequestMethod("POST");c.setDoOutput(true);c.setChunkedStreamingMode(65536);c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
        try(OutputStream out=c.getOutputStream();InputStream in=context.getContentResolver().openInputStream(uri)){
            out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+Policy.filename(name)+"\"\r\nContent-Type: "+mime+"\r\n\r\n").getBytes("UTF-8"));
            long total=0;byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){total+=n;if(total>max)throw new IOException("This file exceeds the site's upload limit.");out.write(b,0,n);}out.write(("\r\n--"+boundary+"--\r\n").getBytes("UTF-8"));
        }
        try{int status=c.getResponseCode();if(status<200||status>=300)throw new IOException("Upload failed (HTTP "+status+").");
            JSONObject data=new JSONObject(new String(read(c.getInputStream(),1024*1024),"UTF-8"));String id=data.getString("id");
            if(!id.matches("[A-Za-z0-9._-]+"))throw new IOException("Unexpected upload response.");
            return new JSONObject().put("url",video?"https://cdn.videy.co/"+id+".mp4":"https://media.scored.co/post/"+id).put("name",name);
        }finally{c.disconnect();}
    }
    static final class ApiError extends IOException {ApiError(String message){super(message);}}
}
