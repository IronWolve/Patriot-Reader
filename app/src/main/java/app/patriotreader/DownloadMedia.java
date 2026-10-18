package app.patriotreader;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Pure route/range helpers. No filesystem path or remote URL is accepted. */
final class DownloadMedia {
    private static final Pattern ROUTE=Pattern.compile("^/downloads/([1-9][0-9]{0,18})/(media|thumbnail)$");
    static final class Route {
        final long id;final boolean thumbnail;
        Route(long id,boolean thumbnail){this.id=id;this.thumbnail=thumbnail;}
    }
    static Route route(String path){
        if(path==null)return null;Matcher m=ROUTE.matcher(path);if(!m.matches())return null;
        try{return new Route(Long.parseLong(m.group(1)),m.group(2).equals("thumbnail"));}catch(NumberFormatException e){return null;}
    }
    static boolean validVersionQuery(String query){return query!=null&&query.matches("v=[0-9a-f]{64}");}
    static boolean matchesExpectedVersion(String expected,String actual){return expected==null||expected.isEmpty()||expected.matches("[0-9a-f]{64}")&&expected.equals(actual);}
    static boolean supported(String mime){
        if(mime==null)return false;
        switch(mime.toLowerCase(Locale.ROOT)){
            case "image/jpeg":case "image/png":case "image/gif":case "image/webp":case "image/avif":case "image/bmp":
            case "video/mp4":case "video/webm":case "video/ogg":case "video/3gpp":case "video/x-matroska":
            case "audio/mpeg":case "audio/mp4":case "audio/aac":case "audio/ogg":case "audio/wav":case "audio/x-wav":case "audio/flac":case "audio/webm":case "audio/opus":return true;
            default:return false;
        }
    }
    static final class Range {
        final long start,length,total;final boolean partial,valid;
        Range(long start,long length,long total,boolean partial,boolean valid){this.start=start;this.length=length;this.total=total;this.partial=partial;this.valid=valid;}
    }
    static Range range(String header,long total){
        if(total<0)throw new IllegalArgumentException("Unknown media size");
        if(header==null||header.trim().isEmpty())return new Range(0,total,total,false,true);
        String value=header.trim();
        if(!value.startsWith("bytes=")||value.indexOf(',')>=0||total==0)return new Range(0,0,total,true,false);
        String[] parts=value.substring(6).split("-",-1);
        if(parts.length!=2||!parts[0].matches("[0-9]*")||!parts[1].matches("[0-9]*"))return new Range(0,0,total,true,false);
        try{
            long start,end;
            if(parts[0].isEmpty()){
                long suffix=Long.parseLong(parts[1]);if(suffix<=0)return new Range(0,0,total,true,false);
                start=total-Math.min(suffix,total);end=total-1;
            }else{
                start=Long.parseLong(parts[0]);end=parts[1].isEmpty()?total-1:Long.parseLong(parts[1]);
                if(start>=total||end<start)return new Range(0,0,total,true,false);end=Math.min(end,total-1);
            }
            return new Range(start,end-start+1,total,true,true);
        }catch(NumberFormatException e){return new Range(0,0,total,true,false);}
    }
    static InputStream limited(InputStream input,long length){
        return new FilterInputStream(input){
            private long remaining=length;
            @Override public int read()throws IOException{if(remaining<=0)return -1;int n=super.read();if(n>=0)remaining--;return n;}
            @Override public int read(byte[] b,int offset,int count)throws IOException{
                if(count==0)return 0;if(remaining<=0)return -1;
                int n=in.read(b,offset,(int)Math.min((long)count,remaining));if(n>0)remaining-=n;return n;
            }
            @Override public long skip(long count)throws IOException{long n=in.skip(Math.min(Math.max(0,count),remaining));remaining-=n;return n;}
            @Override public int available()throws IOException{return (int)Math.min((long)in.available(),remaining);}
        };
    }
    private DownloadMedia(){}
}
