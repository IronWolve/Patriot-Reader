package app.patriotreader;

import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import org.json.JSONObject;

final class CacheStore {
    private final File root;
    private volatile long limit=64L*1024*1024;
    CacheStore(File root){this.root=root;root.mkdirs();}
    static String hash(String s)throws Exception{
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(s.getBytes("UTF-8"));StringBuilder b=new StringBuilder();
        for(byte v:digest)b.append(String.format("%02x",v&255));return b.toString();
    }
    synchronized JSONObject get(String key)throws Exception {
        File f=new File(root,hash(key)+".json");
        if(!f.isFile())return null;
        JSONObject obj=new JSONObject(new String(Files.readAllBytes(f.toPath()),"UTF-8"));
        if(System.currentTimeMillis()-obj.optLong("savedAt")>7L*24*60*60*1000){f.delete();return null;}
        return obj;
    }
    synchronized void put(String key,JSONObject data)throws Exception {
        JSONObject value=new JSONObject().put("data",data).put("savedAt",System.currentTimeMillis()).put("cached",false);
        byte[] bytes=value.toString().getBytes("UTF-8");if(bytes.length>4*1024*1024 || bytes.length>limit)return;
        File target=new File(root,hash(key)+".json"), temp=new File(root,hash(key)+".tmp");
        Files.write(temp.toPath(),bytes);Files.move(temp.toPath(),target.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);trim();
    }
    synchronized long size(){long sum=0;File[] files=root.listFiles();if(files!=null)for(File f:files)sum+=f.length();return sum;}
    synchronized void setLimit(long bytes){limit=bytes;trim();}
    private void trim(){File[] files=root.listFiles();if(files==null)return;Arrays.sort(files,Comparator.comparingLong(File::lastModified));long size=size();for(File f:files){if(size<=limit)break;long n=f.length();if(f.delete())size-=n;}}
    synchronized void clear(){File[] files=root.listFiles();if(files!=null)for(File f:files)f.delete();}
}
