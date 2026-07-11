package com.altijwal.prayer;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.altijwal.prayer.alarm.PrayerAlarmPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the app-local PrayerAlarm plugin before the bridge initializes.
        registerPlugin(PrayerAlarmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
