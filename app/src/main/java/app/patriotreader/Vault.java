package app.patriotreader;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class Vault {
    private final Context context;
    private boolean unreadable;
    Vault(Context context){this.context=context;}
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias("reader-session")) {
            KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder("reader-session",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();
        }
        return (SecretKey)store.getKey("reader-session",null);
    }
    synchronized void save(JSONObject value) throws Exception {
        if(unreadable)resetKey();
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        String encrypted=Base64.encodeToString(cipher.doFinal(value.toString().getBytes("UTF-8")),Base64.NO_WRAP);
        if(!context.getSharedPreferences("session",0).edit().putString("data",encrypted)
            .putString("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).commit()) throw new Exception("Could not save login");
        unreadable=false;
    }
    synchronized JSONObject read() {
        android.content.SharedPreferences prefs=context.getSharedPreferences("session",0);
        if(!prefs.contains("data"))return new JSONObject();
        try{
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(prefs.getString("iv",""),Base64.NO_WRAP)));
            JSONObject value=new JSONObject(new String(c.doFinal(Base64.decode(prefs.getString("data",""),Base64.NO_WRAP)),"UTF-8"));unreadable=false;return value;
        }catch(Exception error){unreadable=true;return new JSONObject();}
    }
    synchronized boolean needsReset(){return unreadable;}
    private void resetKey()throws Exception{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(store.containsAlias("reader-session"))store.deleteEntry("reader-session");}
    synchronized void clear()throws Exception{
        if(!context.getSharedPreferences("session",0).edit().clear().commit())throw new Exception("Could not reset saved login");
        unreadable=false;try{resetKey();}catch(Exception unavailable){unreadable=true;}
    }
}
