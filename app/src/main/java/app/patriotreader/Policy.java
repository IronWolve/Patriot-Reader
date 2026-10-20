package app.patriotreader;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** URL policy is independent of Android so its boundaries can be tested locally. */
public final class Policy {
    public static final String SITE = "https://patriots.win";
    public static final String SCORED = "https://scored.co";
    public static boolean apiSite(String value){return SITE.equals(value)||SCORED.equals(value);}
    public static String siteOrigin(String value){
        if(!https(value))return "";String host=URI.create(value).getHost();
        return host.equals("patriots.win")||host.equals("www.patriots.win")?SITE:host.equals("scored.co")||host.equals("www.scored.co")?SCORED:"";
    }
    public static final String ORIGIN = "https://appassets.androidplatform.net";
    public static final String USER_AGENT = "Mozilla/5.0 (Android 10; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0";
    private static final Set<String> WRITES = new HashSet<>(Arrays.asList(
        "/api/v2/action/create_post", "/api/v2/action/create_comment", "/api/v2/action/vote",
        "/api/v2/post/set_flair", "/api/v2/post/delete_flair", "/api/v2/action/create_message",
        "/api/v2/action/report", "/api/v2/action/block", "/api/v2/action/save", "/api/v2/action/unsave",
        "/api/v2/community/subscribe", "/api/v2/community/unsubscribe"));
    private static final Set<String> READS = new HashSet<>(Arrays.asList(
        "/api/v2/post/hotv2.json", "/api/v2/post/newv2.json", "/api/v2/post/activev2.json",
        "/api/v2/post/risingv2.json", "/api/v2/post/topv2.json", "/api/v2/post/post.json",
        "/api/v2/post/search.json", "/api/v2/post/profile.json", "/api/v2/community/post_flairs.json",
        "/api/v2/user/about.json", "/api/v2/message/messages.json", "/api/v2/message/message.json", "/api/v2/upload/token.json",
        "/api/v2/comment/thread", "/api/v2/comment/profile.json", "/api/v2/content/profile.json",
        "/api/v2/community/report_reasons", "/api/v2/community/communities.json", "/api/v2/community/community.json", "/api/v2/community/search.json", "/api/v2/folder/get_folders.json", "/api/v2/folder/get_folder.json"));
    public static boolean apiAllowed(String method, String path) {
        try {
            URI u = new URI(path);
            if (u.isAbsolute() || u.getRawAuthority()!=null || u.getFragment()!=null || path.contains("%") || path.contains("\\")) return false;
            return ("GET".equals(method) ? READS : "POST".equals(method) ? WRITES : new HashSet<String>()).contains(u.getPath());
        } catch (Exception e) { return false; }
    }
    public static boolean https(String value) {
        try {
            URI u = new URI(value);
            String h = u.getHost();
            return "https".equals(u.getScheme()) && h != null && u.getUserInfo()==null && (u.getPort()==-1 || u.getPort()==443)
                && h.contains(".") && !h.endsWith(".local") && !h.equals("localhost") && !h.matches("[0-9.]+") && !h.contains(":");
        } catch (Exception e) { return false; }
    }
    public static boolean site(String value) {
        try { return !siteOrigin(value).isEmpty(); }
        catch(Exception e){return false;}
    }
    private static boolean siteId(String value){
        if(value==null||!value.matches("[A-Za-z0-9]{1,24}"))return false;
        try{String id=value;
            if(!id.matches("[0-9]+")){java.math.BigInteger n=java.math.BigInteger.ZERO,base=java.math.BigInteger.valueOf(62);String alphabet="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
                for(char c:value.toCharArray())n=n.multiply(base).add(java.math.BigInteger.valueOf(alphabet.indexOf(c)));
                id=new String(n.toByteArray(),java.nio.charset.StandardCharsets.US_ASCII).replace(String.valueOf((char)0),"");}
            return id.matches("[0-9]{1,16}")&&new java.math.BigInteger(id).signum()>0&&new java.math.BigInteger(id).compareTo(java.math.BigInteger.valueOf(9007199254740991L))<=0;
        }catch(Exception e){return false;}
    }
    public static boolean readerLink(String value){
        if(!https(value))return false;URI u=URI.create(value);
        if(siteOrigin(value).isEmpty())return false;
        if(u.getPath().matches("/c/[A-Za-z0-9_-]{1,64}/?"))return true;
        if(u.getPath().matches("/u/[A-Za-z0-9_-]{1,64}/?"))return true;
        String[] parts=u.getPath().replaceFirst("^/","").split("/");int index=parts.length>1&&parts[0].equals("p")?0:parts.length>3&&parts[0].equals("c")&&parts[2].equals("p")?2:-1;
        if(index<0||!siteId(parts[index+1]))return false;
        for(int i=index+2;i<parts.length;i++)if(parts[i].equals("c"))return i+1<parts.length&&siteId(parts[i+1]);
        return true;
    }
    public static boolean xPost(String value){
        if(!https(value))return false;URI u=URI.create(value);String h=u.getHost();
        return Arrays.asList("x.com","www.x.com","twitter.com","www.twitter.com","mobile.twitter.com").contains(h)
            && u.getPath().matches("/(?:[A-Za-z0-9_]+|i/web)/status/[0-9]+/?");
    }
    public static boolean rumble(String value){
        if(!https(value))return false;URI u=URI.create(value);
        return ("rumble.com".equals(u.getHost())||"www.rumble.com".equals(u.getHost()))
            && u.getPath().matches("/(?:v[a-zA-Z0-9]+-[^/]+\\.html|embed/[a-zA-Z0-9]+/?)");
    }
    public static boolean directMedia(String value){
        return https(value)&&URI.create(value).getPath().matches("(?i).*\\.(png|jpe?g|gif|webp|mp4|m4v|webm|ogv|mp3|m4a|aac|ogg|oga|opus|wav|flac)$");
    }
    public static boolean media(String value) {
        if(!https(value)) return false;
        String h=URI.create(value).getHost();
        return directMedia(value)||h.equals("media.scored.co") || h.equals("img.scored.co") || h.equals("media.patriots.win")
            || h.equals("img.patriots.win") || h.equals("cdn.videy.co") || h.equals("preview.redd.it") || h.equals("i.redd.it")
            || h.equals("media.communities.win") || h.equals("media.greatawakening.win") || h.equals("media.kotakuinaction2.win")
            || h.equals("pbs.twimg.com") || h.equals("video.twimg.com") || h.equals("i.ytimg.com") || h.equals("static-assets-1.truthsocial.com");
    }
    public static boolean embedDocument(String value){
        if(!https(value))return false;URI u=URI.create(value);
        return ("www.youtube-nocookie.com".equals(u.getHost())&&u.getPath().startsWith("/embed/"))
            ||("rumble.com".equals(u.getHost())&&u.getPath().matches("/embed/[a-zA-Z0-9]+/?"));
    }
    public static boolean embedResource(String value){
        if(!https(value))return false;String h=URI.create(value).getHost();
        return h.equals("rumble.com")||h.equals("static.rumble.com")||h.endsWith(".cdn.rumble.cloud")
            ||h.equals("www.youtube-nocookie.com")||h.equals("www.youtube.com")||h.equals("m.youtube.com")||h.endsWith(".googlevideo.com")
            ||h.equals("i.ytimg.com")||h.equals("s.ytimg.com")||h.equals("www.gstatic.com")||h.equals("fonts.gstatic.com")||h.equals("jnn-pa.googleapis.com");
    }
    public static String filename(String name) {
        String safe=(name==null?"media":name).replaceAll("[^A-Za-z0-9._ -]", "_").replaceAll("^\\.+", "");
        return safe.isEmpty()?"media":safe.substring(0, Math.min(100,safe.length()));
    }
    private Policy() {}
}
