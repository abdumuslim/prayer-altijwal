package com.altijwal.prayer;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.altijwal.prayer.alarm.PrayerAlarmPlugin;
import com.altijwal.prayer.compass.CompassPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the app-local plugins before the bridge initializes.
        registerPlugin(PrayerAlarmPlugin.class);
        registerPlugin(CompassPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
