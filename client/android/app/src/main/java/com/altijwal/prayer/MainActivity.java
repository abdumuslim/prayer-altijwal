package com.altijwal.prayer;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;
import com.altijwal.prayer.alarm.PrayerAlarmPlugin;
import com.altijwal.prayer.compass.CompassPlugin;

public class MainActivity extends BridgeActivity {
    /**
     * Combined font-scale tolerance (docs/V2_REDESIGN_SPEC.md Phase 8.5): the
     * WebView's default textZoom already follows Configuration.fontScale; the
     * cap keeps extreme system scales (1.5–2.0×) from breaking the no-scroll
     * Home budget. A system font-size change recreates the activity (no
     * fontScale entry in android:configChanges), so onCreate re-applies it.
     */
    private static final float MAX_FONT_SCALE = 1.3f;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the app-local plugins before the bridge initializes.
        registerPlugin(PrayerAlarmPlugin.class);
        registerPlugin(CompassPlugin.class);
        super.onCreate(savedInstanceState);

        float scale = getResources().getConfiguration().fontScale;
        WebSettings settings = bridge.getWebView().getSettings();
        settings.setTextZoom(Math.round(Math.min(scale, MAX_FONT_SCALE) * 100f));
    }
}
