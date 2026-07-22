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
 * Heading is degrees CW from TRUE north: a tilt-compensated azimuth remapped for
 * the current display rotation, plus Android's built-in WMM declination
 * (GeomagneticField). Emits throttled ~20 Hz "heading" events; needs no
 * permissions. App-local and deliberately separate from PrayerAlarmPlugin (Q7).
 *
 * <p>Three sensor paths, best first — budget phones (e.g. Galaxy A21) have no
 * gyroscope, so TYPE_ROTATION_VECTOR simply does not exist there and the compass
 * used to fail outright:
 * <ol>
 *   <li>{@code rotation-vector} — gyro-fused, the accurate path;</li>
 *   <li>{@code geomagnetic-rv} — Android's accel+mag fusion, no gyro (steady but
 *       noisier under movement);</li>
 *   <li>{@code accel-mag} — our own low-passed getRotationMatrix fallback,
 *       reported at MOST "medium" accuracy since nothing stabilizes it.</li>
 * </ol>
 * The active path ships in every event as {@code source} so the hidden
 * diagnostic can show which one a device landed on.
 */
@CapacitorPlugin(name = "Compass")
public class CompassPlugin extends Plugin implements SensorEventListener {

    private static final long EMIT_INTERVAL_MS = 50; // ~20 Hz

    private static final int MODE_NONE = 0;
    private static final int MODE_ROTATION_VECTOR = 1;
    private static final int MODE_GEOMAGNETIC_RV = 2;
    private static final int MODE_ACCEL_MAG = 3;

    /** Low-pass weight for the raw accel/mag vectors (mode 3 only). */
    private static final float LOW_PASS_ALPHA = 0.15f;

    private SensorManager sensorManager;
    private Sensor rotationSensor;   // rotation vector (either flavour)
    private Sensor accelSensor;      // mode 3 only
    private Sensor magSensor;        // mode 3 only
    private int mode = MODE_NONE;

    /** JS called start() and has not called stop() — survives pause/resume. */
    private boolean started = false;
    private boolean registered = false;
    private float declination = 0f;
    private int sensorAccuracy = SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM;
    private long lastEmit = 0;

    private final float[] rotationMatrix = new float[9];
    private final float[] inclinationMatrix = new float[9];
    private final float[] remapped = new float[9];
    private final float[] orientation = new float[3];
    private final float[] truncated = new float[4];

    private final float[] gravity = new float[3];
    private final float[] geomagnetic = new float[3];
    private boolean haveGravity = false;
    private boolean haveGeomagnetic = false;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager == null) {
            return;
        }
        rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        if (rotationSensor != null) {
            mode = MODE_ROTATION_VECTOR;
            return;
        }
        rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR);
        if (rotationSensor != null) {
            mode = MODE_GEOMAGNETIC_RV;
            return;
        }
        accelSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        magSensor = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
        if (accelSensor != null && magSensor != null) {
            mode = MODE_ACCEL_MAG;
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (mode == MODE_NONE) {
            call.reject("No orientation sensor available");
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
        JSObject result = new JSObject();
        result.put("source", sourceLabel());
        call.resolve(result);
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
        if (registered || sensorManager == null) {
            return;
        }
        if (mode == MODE_ACCEL_MAG) {
            sensorManager.registerListener(this, accelSensor, SensorManager.SENSOR_DELAY_GAME);
            sensorManager.registerListener(this, magSensor, SensorManager.SENSOR_DELAY_GAME);
            registered = true;
        } else if (rotationSensor != null) {
            sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME);
            registered = true;
        }
    }

    private void unregister() {
        if (registered && sensorManager != null) {
            sensorManager.unregisterListener(this);
            registered = false;
            haveGravity = false;
            haveGeomagnetic = false;
        }
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        int type = event.sensor.getType();
        if (mode == MODE_ACCEL_MAG) {
            if (type == Sensor.TYPE_ACCELEROMETER) {
                lowPass(event.values, gravity, haveGravity);
                haveGravity = true;
            } else if (type == Sensor.TYPE_MAGNETIC_FIELD) {
                lowPass(event.values, geomagnetic, haveGeomagnetic);
                haveGeomagnetic = true;
            } else {
                return;
            }
            if (!haveGravity || !haveGeomagnetic || throttled()) {
                return;
            }
            if (!SensorManager.getRotationMatrix(rotationMatrix, inclinationMatrix, gravity, geomagnetic)) {
                return; // device in free-fall / near-null field — no valid attitude
            }
            emit(-1f);
            return;
        }

        if (type != Sensor.TYPE_ROTATION_VECTOR && type != Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR) {
            return;
        }
        if (throttled()) {
            return;
        }

        // Some devices report 5 values; older getRotationMatrixFromVector
        // implementations throw past 4 — truncate defensively.
        float[] values = event.values;
        if (values.length > 4) {
            System.arraycopy(values, 0, truncated, 0, 4);
            values = truncated;
        }
        SensorManager.getRotationMatrixFromVector(rotationMatrix, values);
        emit(event.values.length >= 5 ? event.values[4] : -1f);
    }

    private boolean throttled() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastEmit < EMIT_INTERVAL_MS) {
            return true;
        }
        lastEmit = now;
        return false;
    }

    /** Exponential smoothing of a raw 3-vector in place (mode 3 is unfiltered otherwise). */
    private static void lowPass(float[] input, float[] out, boolean seeded) {
        if (!seeded) {
            System.arraycopy(input, 0, out, 0, 3);
            return;
        }
        for (int i = 0; i < 3; i++) {
            out[i] += LOW_PASS_ALPHA * (input[i] - out[i]);
        }
    }

    /**
     * Turn the current rotation matrix into a true-north heading event.
     *
     * @param headingAccuracyRad the rotation vector's own heading-uncertainty
     *                           estimate (values[4]), or -1 when unavailable.
     */
    private void emit(float headingAccuracyRad) {
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

        // The rotation vector's 5th element is the sensor's OWN estimated heading
        // accuracy in radians (-1 = no estimate). It is far more honest than the
        // SENSOR_STATUS_* callback: a magnetically swamped device (real Pixel 7
        // Pro case — 171 µT ambient vs Earth's ~47, heading uncertainty ±90°)
        // still reports STATUS high while this estimate screams unreliable. Use
        // the WORSE of the two so the UI shows the calibrate hint instead of
        // «دقة عالية» over a meaningless needle.
        String label = accuracyLabel(sensorAccuracy);
        if (headingAccuracyRad >= 0f) {
            double deg = Math.toDegrees(headingAccuracyRad);
            String estimated = deg <= 5 ? "high" : deg <= 15 ? "medium" : deg <= 30 ? "low" : "unreliable";
            if (rank(estimated) < rank(label)) {
                label = estimated;
            }
        }
        // Nothing stabilizes the hand-rolled fallback (no gyro, no vendor fusion),
        // so never claim "high" on it — the needle wobbles with every hand tremor.
        if (mode == MODE_ACCEL_MAG && rank(label) > rank("medium")) {
            label = "medium";
        }

        JSObject data = new JSObject();
        data.put("trueHeading", (double) trueHeading);
        data.put("magneticHeading", (double) magnetic);
        data.put("declination", (double) declination);
        data.put("accuracy", label);
        data.put("source", sourceLabel());
        notifyListeners("heading", data);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // In the fallback mode the magnetometer is what can go stale; the
        // accelerometer's status says nothing about heading quality.
        if (mode == MODE_ACCEL_MAG && sensor.getType() != Sensor.TYPE_MAGNETIC_FIELD) {
            return;
        }
        sensorAccuracy = accuracy;
    }

    private String sourceLabel() {
        switch (mode) {
            case MODE_ROTATION_VECTOR:
                return "rotation-vector";
            case MODE_GEOMAGNETIC_RV:
                return "geomagnetic-rv";
            case MODE_ACCEL_MAG:
                return "accel-mag";
            default:
                return "none";
        }
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

    /** Orders accuracy labels worst(0)→best(3) so the two signals can be merged. */
    private static int rank(String label) {
        switch (label) {
            case "high":
                return 3;
            case "medium":
                return 2;
            case "low":
                return 1;
            default:
                return 0;
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
