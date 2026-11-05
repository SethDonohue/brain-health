package com.sethdonohue.brainhealth;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Receives screenshots, PDFs and text shared to Brain Health from other apps
 * (Android share sheet) and hands them to the web app, which opens the import preview.
 */
@CapacitorPlugin(name = "ShareIn")
public class ShareInPlugin extends Plugin {
    private static final int MAX_BYTES = 20 * 1024 * 1024;
    private JSObject pending;

    @Override
    public void load() {
        capture(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (capture(intent)) notifyListeners("shared", new JSObject(), true);
    }

    /** Returns and clears the item waiting to be imported, if any. */
    @PluginMethod
    public void consume(PluginCall call) {
        JSObject r = new JSObject();
        if (pending != null) {
            r.put("item", pending);
            pending = null;
        }
        call.resolve(r);
    }

    private boolean capture(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String type = intent.getType();
        JSObject o = new JSObject();
        o.put("mime", type);
        if (type != null && type.startsWith("text/")) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text == null) return false;
            o.put("text", text.toString());
        } else {
            Uri uri = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) return false;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) return false;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_BYTES) return false;
                }
                o.put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                String resolved = getContext().getContentResolver().getType(uri);
                if (resolved != null) o.put("mime", resolved);
            } catch (Exception e) {
                return false;
            }
        }
        pending = o;
        // don't import the same share again when the activity is recreated
        intent.setAction(Intent.ACTION_MAIN);
        return true;
    }
}
