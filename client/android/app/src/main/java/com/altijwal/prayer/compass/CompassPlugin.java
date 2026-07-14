package com.altijwal.prayer.compass;

import android.content.Context;
import android.hardware.GeomagneticField;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.SystemClock;
import android.view.HapticFeedbackConstants;
import android.view.Surface;
import android.view.View;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Fused-sensor compass for the qibla card (docs/QIBLA_MASJID_SPEC.md §5b).
 * TYPE_ROTATION_VECTOR (gyro-stabilized + tilt-compensated) remapped for the
 * current display rotation, plus Android's built-in WMM declination
 * (GeomagneticField), so the emitted trueHeading is degrees CW from TRUE north.
 * Emits throttled ~20 Hz "heading" events; needs no permissions. App-local and
 * deliberately separate from PrayerAlarmPlugin (spec Q7).
 */
@CapacitorPlugin(name = "Compass")
public class CompassPlugin extends Plugin implements SensorEventListener {

    private static final long EMIT_INTERVAL_MS = 50; // ~20 Hz

    private SensorManager sensorManager;
    private Sensor rotationSensor;
    /** JS called start() and has not called stop() — survives pause/resume. */
    private boolean started = false;
    private boolean registered = false;
    private float declination = 0f;
    private int sensorAccuracy = SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM;
    private long lastEmit = 0;

    private final float[] rotationMatrix = new float[9];
    private final float[] remapped = new float[9];
    private final float[] orientation = new float[3];
    private final float[] truncated = new float[4];

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (rotationSensor == null) {
            call.reject("ROTATION_VECTOR sensor unavailable");
            return;
        }
        // Declination from Android's bundled WMM — no network, no library.
        Double lat = call.getDouble("lat");
        Double lon = call.getDouble("lon");
        Double alt = call.getDouble("alt");
        declination = new GeomagneticField(
                lat == null ? 0f : lat.floatValue(),
                lon == null ? 0f : lon.floatValue(),
                alt == null ? 0f : alt.floatValue(),
                System.currentTimeMillis()
        ).getDeclination();

        started = true;
        register();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        started = false;
        unregister();
        call.resolve();
    }

    /** Subtle qibla lock-on confirmation haptic (no VIBRATE permission needed). */
    @PluginMethod
    public void pulse(PluginCall call) {
        View webView = getBridge().getWebView();
        if (webView != null) {
            final int constant = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? HapticFeedbackConstants.CONFIRM
                    : HapticFeedbackConstants.CLOCK_TICK;
            webView.post(() -> webView.performHapticFeedback(constant));
        }
        call.resolve();
    }

    // Battery: never run the sensor while the app is backgrounded; re-register
    // on resume only if JS still wants events.
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        unregister();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (started) {
            register();
        }
    }

    private void register() {
        if (!registered && sensorManager != null && rotationSensor != null) {
            sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME);
            registered = true;
        }
    }

    private void unregister() {
        if (registered && sensorManager != null) {
            sensorManager.unregisterListener(this);
            registered = false;
        }
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR) {
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (now - lastEmit < EMIT_INTERVAL_MS) {
            return;
        }
        lastEmit = now;

        // Some devices report 5 values; older getRotationMatrixFromVector
        // implementations throw past 4 — truncate defensively.
        float[] values = event.values;
        if (values.length > 4) {
            System.arraycopy(values, 0, truncated, 0, 4);
            values = truncated;
        }
        SensorManager.getRotationMatrixFromVector(rotationMatrix, values);

        // Remap so the heading follows the SCREEN top at any display rotation.
        int axisX = SensorManager.AXIS_X;
        int axisY = SensorManager.AXIS_Y;
        switch (displayRotation()) {
            case Surface.ROTATION_90:
                axisX = SensorManager.AXIS_Y;
                axisY = SensorManager.AXIS_MINUS_X;
                break;
            case Surface.ROTATION_180:
                axisX = SensorManager.AXIS_MINUS_X;
                axisY = SensorManager.AXIS_MINUS_Y;
                break;
            case Surface.ROTATION_270:
                axisX = SensorManager.AXIS_MINUS_Y;
                axisY = SensorManager.AXIS_X;
                break;
            default:
                break;
        }
        SensorManager.remapCoordinateSystem(rotationMatrix, axisX, axisY, remapped);
        SensorManager.getOrientation(remapped, orientation);

        float magnetic = ((float) Math.toDegrees(orientation[0]) + 360f) % 360f;
        float trueHeading = (magnetic + declination + 360f) % 360f;

        JSObject data = new JSObject();
        data.put("trueHeading", (double) trueHeading);
        data.put("magneticHeading", (double) magnetic);
        data.put("declination", (double) declination);
        data.put("accuracy", accuracyLabel(sensorAccuracy));
        notifyListeners("heading", data);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        sensorAccuracy = accuracy;
    }

    private int displayRotation() {
        try {
            if (getActivity() == null) {
                return Surface.ROTATION_0;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                return getActivity().getDisplay().getRotation();
            }
            return getActivity().getWindowManager().getDefaultDisplay().getRotation();
        } catch (Exception e) {
            return Surface.ROTATION_0;
        }
    }

    private static String accuracyLabel(int accuracy) {
        switch (accuracy) {
            case SensorManager.SENSOR_STATUS_ACCURACY_HIGH:
                return "high";
            case SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM:
                return "medium";
            case SensorManager.SENSOR_STATUS_ACCURACY_LOW:
                return "low";
            default:
                return "unreliable";
        }
    }
}
