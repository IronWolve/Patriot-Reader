package app.patriotreader;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** URL policy is independent of Android so its boundaries can be tested locally. */
public final class Policy {
    public static final String SITE = "https://patriots.win";
    public static final String ORIGIN = "https://appassets.androidplatform.net";
    public static final String USER_AGENT = "Mozilla/5.0 (Android 10; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0";
    private static final Set<String> WRITES = new HashSet<>(Arrays.asList(
        "/api/v2/action/create_post", "/api/v2/action/create_comment", "/api/v2/action/vote",
        "/api/v2/post/set_flair", "/api/v2/post/delete_flair"));
    private static final Set<String> READS = new HashSet<>(Arrays.asList(
        "/api/v2/post/hotv2.json", "/api/v2/post/newv2.json", "/api/v2/post/activev2.json",
        "/api/v2/post/risingv2.json", "/api/v2/post/topv2.json", "/api/v2/post/post.json",
        "/api/v2/post/search.json", "/api/v2/post/profile.json", "/api/v2/community/post_flairs.json",
        "/api/v2/user/about.json", "/api/v2/message/messages.json", "/api/v2/upload/token.json"));
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
        try { URI u=new URI(value);return https(value) && "patriots.win".equals(u.getHost()); }
        catch(Exception e){return false;}
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
        return https(value)&&URI.create(value).getPath().matches("(?i).*\\.(mp4|m4v|webm|ogv|mp3|m4a|aac|ogg|oga|opus|wav|flac)$");
    }
    public static boolean media(String value) {
        if(!https(value)) return false;
        String h=URI.create(value).getHost();
        return directMedia(value)||h.equals("media.scored.co") || h.equals("img.scored.co") || h.equals("media.patriots.win")
            || h.equals("img.patriots.win") || h.equals("cdn.videy.co") || h.equals("preview.redd.it") || h.equals("i.redd.it")
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
