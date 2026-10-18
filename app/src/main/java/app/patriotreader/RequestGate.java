package app.patriotreader;

import java.io.IOException;

/** Keeps asynchronous work attached to its reader document and originating account. */
final class RequestGate {
    private long generation;
    synchronized void reset(){generation++;}
    synchronized String bind(String id){return generation+":"+id;}
    synchronized String currentId(String bound){
        if(bound==null)return null;String prefix=generation+":";
        return bound.startsWith(prefix)?bound.substring(prefix.length()):null;
    }
    static void requireAccount(String expected,String actual)throws IOException{
        if(expected!=null&&!expected.equalsIgnoreCase(actual))throw new IOException("Your account changed. Reopen the action under the original account.");
    }
}
