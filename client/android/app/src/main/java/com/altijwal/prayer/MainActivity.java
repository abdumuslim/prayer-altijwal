package com.altijwal.prayer;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.altijwal.prayer.alarm.PrayerAlarmPlugin;
import com.altijwal.prayer.compass.CompassPlugin;

import java.util.Locale;

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

        // The WebView's native horizontal overscroll-stretch steals the touch
        // stream: the document never pans horizontally, so any horizontal drag
        // (the TabPager swipe) triggered the stretch animation and Chromium
        // delivered pointercancel ~15px in — swipes could never commit on
        // device (dispatch-log verified on the Pixel 7 Pro; touch-action:none
        // did NOT prevent it, so this must be killed natively). Vertical
        // scrolling is unaffected (it happens inside the DOM, not the WebView).
        bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);

        initDeterministicInsets();
    }

    /**
     * Deterministic edge-to-edge insets (2026-07-19, real-Pixel tab-bar fix).
     *
     * Capacitor 8.4.1's SystemBars only keeps the WebView edge-to-edge AND
     * injects real --safe-area-inset-* values when the WebView is Chromium ≥140
     * AND its async viewport-fit=cover probe has completed; every other branch
     * pads the WebView parent natively and injects ZEROS. On the Pixel that
     * pipeline left the WebView drawn under the gesture bar with 0-valued vars,
     * so the tab bar was clipped (env(safe-area-inset-bottom) is not reliable
     * for the Android nav bar either — surfaces.css reads
     * --inset-* = max(env(), var()) and both were 0).
     *
     * This listener replaces Capacitor's (same view — the last registered
     * listener wins) and removes every gate: the WebView is ALWAYS edge-to-edge
     * and the real system-bar+cutout insets are ALWAYS injected under the same
     * --safe-area-inset-* names the CSS already consumes. SystemBars' DOM-ready
     * requestApplyInsets() still fires, so the vars are (re)injected after the
     * document exists and on every inset change (rotation, IME). IME handling
     * mirrors Capacitor's passthrough branch: pad the parent by the keyboard
     * height while it shows (and zero the CSS bottom inset, which the padding
     * already covers).
     */
    private void initDeterministicInsets() {
        final View parent = (View) bridge.getWebView().getParent();
        ViewCompat.setOnApplyWindowInsetsListener(parent, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            int imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;

            v.setPadding(0, 0, 0, imeVisible ? imeBottom : 0);

            float density = getResources().getDisplayMetrics().density;
            String script = String.format(
                Locale.US,
                "try{var s=document.documentElement.style;" +
                    "s.setProperty('--safe-area-inset-top','%dpx');" +
                    "s.setProperty('--safe-area-inset-right','%dpx');" +
                    "s.setProperty('--safe-area-inset-bottom','%dpx');" +
                    "s.setProperty('--safe-area-inset-left','%dpx');}catch(e){}",
                Math.round(bars.top / density),
                Math.round(bars.right / density),
                imeVisible ? 0 : Math.round(bars.bottom / density),
                Math.round(bars.left / density)
            );
            bridge.getWebView().evaluateJavascript(script, null);

            // Pass through untouched: Chromium ≥140 also derives env() from these.
            return insets;
        });
        ViewCompat.requestApplyInsets(parent);
    }
}
