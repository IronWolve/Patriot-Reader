package app.patriotreader;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class Vault {
    private final Context context;
    private final Set<String> unreadable=new HashSet<>();
    Vault(Context context){this.context=context;}
    // Both approved origins use the same Scored account. Preserve the existing vault.
    private String suffix(String site){if(!Policy.apiSite(site))throw new IllegalArgumentException("Unsupported site");return "";}
    private android.content.SharedPreferences prefs(String site){return context.getSharedPreferences("session"+suffix(site),0);}
    private SecretKey key(String site) throws Exception {
        String alias="reader-session"+suffix(site);KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias(alias)) {
            KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();
        }
        return (SecretKey)store.getKey(alias,null);
    }
    synchronized void save(String site,JSONObject value) throws Exception {
        if(!unreadable.isEmpty())resetKey(site);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(site));
        String encrypted=Base64.encodeToString(cipher.doFinal(value.toString().getBytes("UTF-8")),Base64.NO_WRAP);
        if(!prefs(site).edit().putString("data",encrypted)
            .putString("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).commit())throw new Exception("Could not save login");
        unreadable.clear();
    }
    synchronized JSONObject read(String site) {
        android.content.SharedPreferences prefs=prefs(site);
        if(!prefs.contains("data"))return new JSONObject();
        try{
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(site),new GCMParameterSpec(128,Base64.decode(prefs.getString("iv",""),Base64.NO_WRAP)));
            JSONObject value=new JSONObject(new String(c.doFinal(Base64.decode(prefs.getString("data",""),Base64.NO_WRAP)),"UTF-8"));unreadable.clear();return value;
        }catch(Exception error){unreadable.add(site);return new JSONObject();}
    }
    synchronized boolean needsReset(String site){return !unreadable.isEmpty();}
    private void resetKey(String site)throws Exception{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);String alias="reader-session"+suffix(site);if(store.containsAlias(alias))store.deleteEntry(alias);}
    synchronized void clear(String site)throws Exception{
        if(!prefs(site).edit().clear().commit())throw new Exception("Could not reset saved login");
        unreadable.clear();try{resetKey(site);}catch(Exception unavailable){unreadable.add(site);}
    }
}
