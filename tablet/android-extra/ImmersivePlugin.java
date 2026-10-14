package com.bespoketailoring.tablet;

import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Full screen for the register: hides Android's status bar (top) and navigation bar (bottom).
// A swipe from the edge shows them for a moment, then they hide again.
@CapacitorPlugin(name = "Immersive")
public class ImmersivePlugin extends Plugin {
    static boolean on = false;

    static void apply(android.app.Activity activity) {
        if (activity == null) return;
        Window w = activity.getWindow();
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        if (c == null) return;
        if (on) {
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            c.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            apply(getActivity());
            JSObject r = new JSObject();
            r.put("on", on);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject r = new JSObject();
        r.put("on", on);
        call.resolve(r);
    }

    // Android can bring the bars back after the app was in the background; hide them again.
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (on) getActivity().runOnUiThread(() -> apply(getActivity()));
    }
}
