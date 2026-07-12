package com.altijwal.prayer.alarm;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.view.animation.TranslateAnimation;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.altijwal.prayer.R;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The full-screen ringing screen shown over the lock screen when an alarm fires
 * (docs/NATIVE_ALARM_SPEC.md §3f). Built programmatically to avoid adding
 * user-visible text resources, and styled to MATCH the web AlarmOverlay
 * (docs/FRONTEND.md §9): night background with a warm gold radial glow, a gold
 * ringing label (alarm icon + prayer title), a huge live 12-hour clock with the
 * Arabic day-period, the body line, and the round translucent ✕ stop control
 * (swipe up or tap — language-neutral). Tapping the title opens the app into the
 * web AlarmOverlay via the existing ?alarm=<target>&t=<at> deep link.
 */
public class AlarmActivity extends Activity {
    // Web theme tokens (client/src/index.css): night/gold/ink/ink-dim.
    private static final int COLOR_GOLD = Color.parseColor("#F5C451");
    private static final int COLOR_INK = Color.parseColor("#EAFAF6");
    private static final int COLOR_INK_DIM = Color.parseColor("#8FB3AD");

    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView clock;
    private TextView period;
    private TextView untilLabelView;
    private TextView untilView;
    private long anchorAt;
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (clock != null) {
                updateClock();
                updateCountdown();
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
            // Do NOT requestDismissKeyguard here: on a secured device it pops the
            // PIN/fingerprint prompt OVER the alarm, forcing an unlock before the
            // user can hit Stop. The activity shows fine over the keyguard with
            // setShowWhenLocked and Stop works locked; the keyguard is only
            // dismissed when the user taps through to open the app (openApp).
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        String title = orEmpty(getIntent().getStringExtra("title"));
        String body = orEmpty(getIntent().getStringExtra("body"));
        String untilLabel = orEmpty(getIntent().getStringExtra("untilLabel"));
        final String target = orEmpty(getIntent().getStringExtra("target"));
        final long at = getIntent().getLongExtra("at", System.currentTimeMillis());
        anchorAt = getIntent().getLongExtra("anchorAt", at);

        LinearLayout root = new GlowLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#04181A")); // night (web --color-night)
        root.setPadding(dp(24), dp(64), dp(24), dp(48));

        // ── Ringing label: pulsing gold alarm icon + prayer title ──
        LinearLayout label = new LinearLayout(this);
        label.setOrientation(LinearLayout.HORIZONTAL);
        label.setGravity(Gravity.CENTER_VERTICAL);

        ImageView bell = new ImageView(this);
        bell.setImageResource(R.drawable.ic_alarm_clock);
        AlphaAnimation pulse = new AlphaAnimation(1f, 0.45f);
        pulse.setDuration(900);
        pulse.setRepeatMode(Animation.REVERSE);
        pulse.setRepeatCount(Animation.INFINITE);
        bell.startAnimation(pulse);
        label.addView(bell, new LinearLayout.LayoutParams(dp(24), dp(24)));

        TextView titleView = new TextView(this);
        titleView.setTextColor(COLOR_GOLD);
        titleView.setTextSize(18);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setText(title);
        titleView.setOnClickListener(v -> openApp(target, at));
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        titleLp.setMarginStart(dp(8));
        label.addView(titleView, titleLp);
        // WRAP width so the root's CENTER_HORIZONTAL actually centers the label
        // (vertical LinearLayout children default to MATCH_PARENT).
        LinearLayout.LayoutParams labelLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        labelLp.gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(label, labelLp);

        // ── Center: huge live clock + body (fills the middle) ──
        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams centerLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        // Clock row is always LTR (Latin numerals + trailing Arabic day-period).
        LinearLayout clockRow = new LinearLayout(this);
        clockRow.setOrientation(LinearLayout.HORIZONTAL);
        clockRow.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);
        clockRow.setGravity(Gravity.CENTER);

        clock = new TextView(this);
        clock.setTextColor(COLOR_INK);
        clock.setTextSize(84);
        clock.setTypeface(Typeface.create("sans-serif-black", Typeface.NORMAL));
        clock.setIncludeFontPadding(false);
        clockRow.addView(clock);

        period = new TextView(this);
        period.setTextColor(COLOR_INK_DIM);
        period.setTextSize(24);
        period.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams periodLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        periodLp.setMargins(dp(8), 0, 0, dp(14)); // hug the clock's baseline
        periodLp.gravity = Gravity.BOTTOM;
        clockRow.addView(period, periodLp);
        center.addView(clockRow);
        updateClock();

        // Countdown to the adhan itself — the whole point of a "before" reminder.
        // Reuses the hero's approved label; hidden once the anchor instant passes
        // (or for at-time/after rules where anchorAt <= at).
        if (!untilLabel.isEmpty() && anchorAt > System.currentTimeMillis()) {
            untilLabelView = new TextView(this);
            untilLabelView.setTextColor(COLOR_GOLD & 0x00FFFFFF | 0xB3000000); // gold @ 70%
            untilLabelView.setTextSize(14);
            untilLabelView.setTypeface(Typeface.DEFAULT_BOLD);
            untilLabelView.setText(untilLabel);
            LinearLayout.LayoutParams ulLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            ulLp.topMargin = dp(20);
            ulLp.gravity = Gravity.CENTER_HORIZONTAL;
            center.addView(untilLabelView, ulLp);

            untilView = new TextView(this);
            untilView.setTextColor(COLOR_GOLD);
            untilView.setTextSize(32);
            untilView.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
            untilView.setFontFeatureSettings("'tnum'"); // fixed-width digits — no jitter
            untilView.setTextDirection(View.TEXT_DIRECTION_LTR);
            LinearLayout.LayoutParams uLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            uLp.topMargin = dp(2);
            uLp.gravity = Gravity.CENTER_HORIZONTAL;
            center.addView(untilView, uLp);
            updateCountdown();
        }

        if (!body.isEmpty()) {
            TextView bodyView = new TextView(this);
            bodyView.setTextColor(COLOR_INK_DIM);
            bodyView.setTextSize(18);
            bodyView.setGravity(Gravity.CENTER);
            bodyView.setText(body);
            LinearLayout.LayoutParams bodyLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            bodyLp.topMargin = dp(12);
            bodyLp.gravity = Gravity.CENTER_HORIZONTAL;
            center.addView(bodyView, bodyLp);
        }
        root.addView(center, centerLp);

        // ── Bottom: bouncing gold chevrons + round translucent ✕ stop ──
        ImageView chevrons = new ImageView(this);
        chevrons.setImageResource(R.drawable.ic_chevrons_up);
        TranslateAnimation bounce = new TranslateAnimation(0, 0, 0, -dp(8));
        bounce.setDuration(600);
        bounce.setRepeatMode(Animation.REVERSE);
        bounce.setRepeatCount(Animation.INFINITE);
        chevrons.startAnimation(bounce);
        LinearLayout.LayoutParams chevLp = new LinearLayout.LayoutParams(dp(24), dp(24));
        chevLp.gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(chevrons, chevLp);

        FrameLayout stop = new FrameLayout(this);
        stop.setBackgroundResource(R.drawable.bg_stop_button);
        ImageView x = new ImageView(this);
        x.setImageResource(R.drawable.ic_x);
        FrameLayout.LayoutParams xLp = new FrameLayout.LayoutParams(dp(28), dp(28), Gravity.CENTER);
        stop.addView(x, xLp);
        LinearLayout.LayoutParams stopLp = new LinearLayout.LayoutParams(dp(64), dp(64));
        stopLp.topMargin = dp(12);
        stopLp.gravity = Gravity.CENTER_HORIZONTAL;
        stop.setOnTouchListener(new SwipeUpToStop());
        root.addView(stop, stopLp);

        setContentView(root);
        handler.postDelayed(tick, 1000);
    }

    /**
     * Root layout that paints the web overlay's warm gold radial glow with a
     * DITHERED shader — the XML GradientDrawable equivalent shows visible
     * banding rings (Android doesn't dither drawable gradients; Chrome does,
     * which is why the web overlay looks smooth).
     */
    private static class GlowLayout extends LinearLayout {
        private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);

        GlowLayout(Context context) {
            super(context);
            setWillNotDraw(false);
            glow.setDither(true);
        }

        @Override
        protected void onSizeChanged(int w, int h, int oldW, int oldH) {
            super.onSizeChanged(w, h, oldW, oldH);
            if (w <= 0 || h <= 0) return;
            // radial-gradient(circle at 50% 32%, rgba(245,196,81,.16), transparent 58%)
            glow.setShader(new RadialGradient(
                    w / 2f, h * 0.32f, Math.max(1f, h * 0.58f),
                    new int[]{0x29F5C451, 0x00F5C451}, null, Shader.TileMode.CLAMP));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            if (glow.getShader() != null) canvas.drawPaint(glow);
            super.onDraw(canvas);
        }
    }

    /** Swipe the ✕ up (≥ threshold) to stop — a quick tap also stops. */
    private class SwipeUpToStop implements View.OnTouchListener {
        private float downY;
        private boolean fired;

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downY = e.getRawY();
                    fired = false;
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    float up = Math.max(0, downY - e.getRawY());
                    v.setTranslationY(-Math.min(up, dp(150)));
                    if (!fired && up >= dp(90)) {
                        fired = true;
                        stopAndFinish();
                    }
                    return true;
                }
                case MotionEvent.ACTION_UP: {
                    float up = downY - e.getRawY();
                    if (!fired && up < dp(10)) {
                        fired = true;
                        v.performClick();
                        stopAndFinish();
                    } else if (!fired) {
                        v.animate().translationY(0).setDuration(200).start();
                    }
                    return true;
                }
                case MotionEvent.ACTION_CANCEL:
                    if (!fired) v.animate().translationY(0).setDuration(200).start();
                    return true;
            }
            return false;
        }
    }

    /** Live 12-hour clock with Latin numerals + localized (Arabic) day-period. */
    private void updateClock() {
        Date now = new Date();
        if (clock != null) clock.setText(new SimpleDateFormat("h:mm", Locale.US).format(now));
        if (period != null) period.setText(new SimpleDateFormat("a", new Locale("ar")).format(now));
    }

    /** Live countdown to the adhan (mm:ss, or h:mm:ss ≥ 1h). Hides at zero. */
    private void updateCountdown() {
        if (untilView == null) return;
        long remaining = anchorAt - System.currentTimeMillis();
        if (remaining <= 0) {
            untilView.setVisibility(View.GONE);
            if (untilLabelView != null) untilLabelView.setVisibility(View.GONE);
            return;
        }
        long totalSec = remaining / 1000;
        long h = totalSec / 3600;
        long m = (totalSec % 3600) / 60;
        long s = totalSec % 60;
        String text = h > 0
                ? String.format(Locale.US, "%d:%02d:%02d", h, m, s)
                : String.format(Locale.US, "%02d:%02d", m, s);
        untilView.setText(text);
    }

    private void stopAndFinish() {
        stopAlarm();
        finish();
    }

    private void openApp(String target, long at) {
        // MainActivity is not showWhenLocked, so ask the user to unlock first
        // (this is the ONLY path that prompts the keyguard — Stop never does).
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    launchApp(target, at);
                }
            });
            return;
        }
        launchApp(target, at);
    }

    private void launchApp(String target, long at) {
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
        period = null;
        untilView = null;
        untilLabelView = null;
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }
}
