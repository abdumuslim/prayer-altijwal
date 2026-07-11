package com.altijwal.prayer.alarm;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The full-screen ringing screen shown over the lock screen when an alarm fires
 * (docs/NATIVE_ALARM_SPEC.md §3f). Built programmatically to avoid adding
 * user-visible text resources: it shows a large live clock, the prayer title
 * (passed from JS — already-approved text), and a language-neutral "✕" stop
 * button. Tapping the title opens the app into the web AlarmOverlay via the
 * existing ?alarm=<target>&t=<at> deep link.
 */
public class AlarmActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView clock;
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (clock != null) {
                clock.setText(new SimpleDateFormat("HH:mm", Locale.US).format(new Date()));
                handler.postDelayed(this, 1000);
            }
        }
    };

    @SuppressWarnings("deprecation")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        String title = orEmpty(getIntent().getStringExtra("title"));
        String body = orEmpty(getIntent().getStringExtra("body"));
        final String target = orEmpty(getIntent().getStringExtra("target"));
        final long at = getIntent().getLongExtra("at", System.currentTimeMillis());

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#0B0F19"));
        int pad = dp(28);
        root.setPadding(pad, pad, pad, pad);

        clock = new TextView(this);
        clock.setTextColor(Color.WHITE);
        clock.setTextSize(72);
        clock.setGravity(Gravity.CENTER);
        clock.setText(new SimpleDateFormat("HH:mm", Locale.US).format(new Date()));
        root.addView(clock);

        TextView titleView = new TextView(this);
        titleView.setTextColor(Color.parseColor("#E6EAF2"));
        titleView.setTextSize(26);
        titleView.setGravity(Gravity.CENTER);
        titleView.setText(title);
        titleView.setPadding(0, dp(8), 0, 0);
        titleView.setOnClickListener(v -> openApp(target, at));
        root.addView(titleView);

        if (!body.isEmpty()) {
            TextView bodyView = new TextView(this);
            bodyView.setTextColor(Color.parseColor("#9AA4B2"));
            bodyView.setTextSize(16);
            bodyView.setGravity(Gravity.CENTER);
            bodyView.setText(body);
            bodyView.setPadding(0, dp(4), 0, 0);
            root.addView(bodyView);
        }

        Button stop = new Button(this);
        stop.setText("✕"); // ✕ — language-neutral
        stop.setTextSize(30);
        stop.setTextColor(Color.WHITE);
        stop.setBackgroundColor(Color.parseColor("#B3261E"));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(88), dp(88));
        lp.topMargin = dp(48);
        stop.setLayoutParams(lp);
        stop.setOnClickListener(v -> {
            stopAlarm();
            finish();
        });
        root.addView(stop);

        setContentView(root);
        handler.postDelayed(tick, 1000);
    }

    private void openApp(String target, long at) {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) return;
        open.setData(Uri.parse("https://prayer.altijwal.com/?alarm=" + target + "&t=" + at));
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        stopAlarm();
        startActivity(open);
        finish();
    }

    private void stopAlarm() {
        Intent stop = new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_STOP);
        startService(stop);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(tick);
        clock = null;
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }
}
