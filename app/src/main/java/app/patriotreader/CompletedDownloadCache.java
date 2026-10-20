package app.patriotreader;

import java.util.HashMap;
import java.util.Map;

/** In-memory completed metadata snapshots; never a substitute for opening an action's file. */
final class CompletedDownloadCache<T> {
    interface Loader<T> {T load() throws Exception;}
    private static final class Entry<T> {
        final String identity;final T value;
        Entry(String identity,T value){this.identity=identity;this.value=value;}
    }
    private final Map<Long,Entry<T>> entries=new HashMap<>();
    synchronized T resolve(long id,String identity,boolean validate,Loader<T> loader)throws Exception{
        Entry<T> old=entries.get(id);
        if(!validate&&old!=null&&old.identity.equals(identity))return old.value;
        entries.remove(id);
        T value=loader.load();entries.put(id,new Entry<>(identity,value));return value;
    }
}
