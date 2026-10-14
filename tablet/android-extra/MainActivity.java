package com.bespoketailoring.tablet;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ImmersivePlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Opening the keyboard or a system dialog can reveal the bars; hide them again on return.
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && ImmersivePlugin.on) ImmersivePlugin.apply(this);
    }
}
