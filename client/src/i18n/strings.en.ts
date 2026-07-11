// English string dictionary. Flat keys; {var} placeholders interpolated by t().

export const en = {
  // App
  "app.title": "Prayer Times",
  "app.tagline": "Accurate times for your location",

  // Prayer names
  "prayer.fajr": "Fajr",
  "prayer.sunrise": "Sunrise",
  "prayer.dhuhr": "Dhuhr",
  "prayer.jumuah": "Jumu'ah",
  "prayer.asr": "Asr",
  "prayer.maghrib": "Maghrib",
  "prayer.isha": "Isha",

  // Next-prayer hero
  "next.label": "Next Prayer",
  "next.header": "Until the adhan",
  "next.in": "in {time}",
  "next.tomorrow": "Tomorrow",
  "next.now": "It's time",
  "next.passed": "Passed",
  "next.remaining": "Time Remaining",

  // Events (the 10 tracked Islamic events)
  "event.islamicNewYear": "Islamic New Year",
  "event.ashura": "Day of Ashura",
  "event.mawlid": "Mawlid al-Nabi",
  "event.israMiraj": "Isra & Mi'raj",
  "event.midShaban": "Mid-Sha'ban",
  "event.ramadanStart": "Start of Ramadan",
  "event.laylatAlQadr": "Laylat al-Qadr",
  "event.eidAlFitr": "Eid al-Fitr",
  "event.arafah": "Day of Arafah",
  "event.eidAlAdha": "Eid al-Adha",
  "event.upcoming": "Upcoming",
  "event.next": "Next Event",
  "event.today": "Today",
  "event.inDays": "in {days} days",
  "event.inDay": "in 1 day",
  "event.tomorrow": "Tomorrow",

  // Location bar
  "location.nearest": "Nearest: {city}",
  "location.detecting": "Detecting your location…",
  "location.unknown": "Location not set",
  "location.change": "Change",
  "location.useGps": "Use My Location",
  "location.set": "Set Your Location",

  // City search
  "search.title": "Search City",
  "search.placeholder": "Type a city name…",
  "search.noResults": "No cities found",
  "search.searching": "Searching…",
  "search.hint": "Search for any city worldwide",
  "search.governoratesIn": "Cities in {country}",

  // Settings
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.done": "Done",

  // Notifications
  "notify.title": "Prayer Reminders",
  "notify.subtitle": "Set reminders for each prayer",
  "notify.enable": "Enable Reminders",
  "notify.enabled": "Reminders On",
  "notify.disable": "Turn Off",
  "notify.prayers": "Which Prayers",
  "notify.timing": "When",
  "notify.leadTime": "Minutes Before",
  "notify.atTime": "At adhan",
  "notify.beforeTiming": "Before",
  "notify.afterTiming": "After",
  "notify.minBefore": "{min} min before",
  "notify.minAfter": "{min} min after",
  "notify.leadTimeAfter": "Minutes After",
  "notify.customMinutes": "Custom",
  "notify.kind": "Alert type",
  "notify.kindNotification": "Notification",
  "notify.kindAlarm": "Alarm",
  "notify.alarmSound": "Alarm tone",
  "notify.tonesApp": "App tones",
  "notify.tonesDevice": "Device tones",
  "notify.sunnahTargets": "Sunnah & adhkar",
  "notify.allPrayers": "All prayers",
  "notify.selectAll": "Select all",
  "notify.clearAll": "Clear",
  "notify.add": "Add Reminder",
  "notify.save": "Save",
  "notify.edit": "Edit",
  "notify.delete": "Delete",
  "notify.listSep": ", ",
  "notify.iosHint": "Add to Home Screen to enable reminders",
  "notify.iosHintDetail": "On iPhone: tap Share, then Add to Home Screen.",
  "notify.unsupported": "Reminders aren't supported on this browser.",
  "notify.permissionDenied": "Notifications are blocked. Enable them in browser settings.",
  "notify.saving": "Saving…",
  // Native (Capacitor) app — alarm permission onboarding + offline note.
  "notify.permsTitle": "Alarm permissions",
  "notify.permNotifications": "Notifications",
  "notify.permNotificationsDesc": "Required to show reminders",
  "notify.permExact": "Exact alarms",
  "notify.permExactDesc": "So the alarm rings at the exact time",
  "notify.permFullScreen": "Full-screen alarm",
  "notify.permFullScreenDesc": "To show the alarm over the lock screen",
  "notify.permBattery": "Battery-saver exemption",
  "notify.permBatteryDesc": "So the system doesn't stop the alarm",
  "notify.permAllow": "Allow",
  "notify.permOpenSettings": "Open settings",
  "notify.permOemNotice":
    "On some devices (Xiaomi, Huawei, Oppo…) enable \"Autostart\" and remove battery restrictions so the alarm works reliably.",
  "notify.permGranted": "On",
  "notify.offlineNote": "Reminders work offline",

  // Alarm (full-screen)
  "alarm.stop": "Stop",

  // Sunnah satellites + iqama
  "sunnah.duha": "Duha",
  "sunnah.qiyam": "Qiyam",
  "iqama.title": "Iqama Timing",
  "iqama.subtitle": "Minutes from adhan to iqama",
  "iqama.in": "Iqama in {time}",
  "iqama.minutes": "{min} min",
  "iqama.decrease": "Decrease",
  "iqama.increase": "Increase",

  // States / errors
  "error.title": "Something went wrong",
  "error.retry": "Try Again",
  "error.location": "We couldn't get your location.",
  "error.locationDenied": "Location access was denied. Search for your city instead.",
  "error.fetch": "Couldn't load prayer times. Check your connection.",
  "error.boundary": "The app hit an unexpected error.",
  "error.reload": "Reload",
  "loading.times": "Calculating prayer times…",

  // Worship tracker — check-in
  "track.q": "Where did you pray {prayer}?",
  "track.masjid": "Masjid",
  "track.home": "Home",
  "track.missed": "Missed",
  "track.inMasjid": "In the masjid +3",
  "track.atHome": "At home +2",
  "track.missedTip": "Missed −1",
  "track.logPrayer": "Log this prayer",
  "track.adhkarChip": "Post-prayer adhkar",
  "track.done": "Done",

  // Worship tracker — rawatib
  "rawatib.label": "Rawatib",
  "rawatib.title": "Rawatib Sunnah",
  "rawatib.rakaat": "{n} rak'ah",
  "rawatib.footer": "+1 point per slot · a slot opens after its prayer's adhan",
  "rawatib.beforeFajr": "Before Fajr",
  "rawatib.beforeDhuhr": "Before Dhuhr",
  "rawatib.afterDhuhr": "After Dhuhr",
  "rawatib.afterMaghrib": "After Maghrib",
  "rawatib.afterIsha": "After Isha",

  // Worship tracker — adhkar
  "adhkar.label": "Adhkar",
  "adhkar.title": "Today's Adhkar",
  "adhkar.morning": "Morning adhkar",
  "adhkar.evening": "Evening adhkar",
  "adhkar.morningNote": "From Fajr to Asr",
  "adhkar.eveningNote": "From Asr to Fajr",
  "adhkar.afterPrayer": "After {prayer}",
  "adhkar.start": "Start",
  "adhkar.readerAfter": "Post-prayer adhkar · {prayer}",
  "adhkar.tapHint": "Tap anywhere to count",
  "adhkar.reward": "+1 point on completing the adhkar",
  "adhkar.morningNow": "Morning now",
  "adhkar.eveningNow": "Evening now",

  // Worship tracker — stats
  "stats.title": "Worship Record",
  "stats.of": "of {n}",
  "stats.streakDays": "{n} consecutive days",
  "stats.best": "Best day:",
  "stats.fard": "Obligatory",
  "stats.rawatib": "Rawatib",
  "stats.adhkar": "Adhkar",
  "stats.duhaQiyam": "Duha & Qiyam",
  "stats.today": "Today",
  "stats.week": "Week",
  "stats.month": "Month",
  "stats.months": "Months",

  // Worship features (Settings opt-in — all off by default)
  "worship.settings.title": "Additional Features",
  "worship.settings.subtitle": "Choose what to show",
  "worship.feature.duha": "Duha Prayer",
  "worship.feature.qiyam": "Qiyam (Night Prayer)",
  "worship.feature.rawatib": "Rawatib",
  "worship.feature.adhkar": "Adhkar",
  "worship.feature.record": "Record",

  // Misc
  "common.cancel": "Cancel",
  "common.close": "Close",
  "lang.toggle": "العربية",
} as const;

export type StringKey = keyof typeof en;
