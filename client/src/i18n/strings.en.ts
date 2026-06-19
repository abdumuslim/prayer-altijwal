// English string dictionary. Flat keys; {var} placeholders interpolated by t().

export const en = {
  // App
  "app.title": "Prayer Times",
  "app.tagline": "Accurate times for your location",

  // Prayer names
  "prayer.fajr": "Fajr",
  "prayer.sunrise": "Sunrise",
  "prayer.dhuhr": "Dhuhr",
  "prayer.asr": "Asr",
  "prayer.maghrib": "Maghrib",
  "prayer.isha": "Isha",

  // Next-prayer hero
  "next.label": "Next Prayer",
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
  "event.today": "Today",
  "event.inDays": "in {days} days",
  "event.inDay": "in 1 day",
  "event.tomorrow": "Tomorrow",

  // Methods (the 13 calculation methods)
  "method.MWL": "Muslim World League",
  "method.ISNA": "Islamic Society of North America",
  "method.Egyptian": "Egyptian General Authority",
  "method.UmmAlQura": "Umm al-Qura, Makkah",
  "method.Karachi": "University of Karachi",
  "method.Dubai": "Dubai",
  "method.Qatar": "Qatar",
  "method.Kuwait": "Kuwait",
  "method.Singapore": "Singapore (MUIS)",
  "method.Diyanet": "Turkey (Diyanet)",
  "method.Tehran": "Tehran, Geophysics",
  "method.Jafari": "Shia (Jafari)",
  "method.BaghdadYMA": "Baghdad — Young Muslims Assoc.",

  // Location bar
  "location.nearest": "Nearest: {city}",
  "location.detecting": "Detecting your location…",
  "location.unknown": "Location not set",
  "location.change": "Change",
  "location.useGps": "Use My Location",
  "location.set": "Set Your Location",

  // Method chip
  "chip.auto": "Auto",
  "chip.method": "Method",

  // City search
  "search.title": "Search City",
  "search.placeholder": "Type a city name…",
  "search.noResults": "No cities found",
  "search.searching": "Searching…",
  "search.hint": "Search for any city worldwide",

  // Settings
  "settings.title": "Settings",
  "settings.calcMethod": "Calculation Method",
  "settings.autoDetected": "Auto (detected: {method})",
  "settings.manual": "Manual Override",
  "settings.resetAuto": "Reset to Auto",
  "settings.asr": "Asr Calculation",
  "settings.asr.standard": "Standard",
  "settings.asr.hanafi": "Hanafi",
  "settings.asr.standardHint": "Shafi'i, Maliki, Hanbali",
  "settings.asr.hanafiHint": "Later afternoon",
  "settings.language": "Language",
  "settings.done": "Done",
  "settings.baghdadNote": "Baghdad-calibrated offsets active",

  // Notifications
  "notify.title": "Prayer Reminders",
  "notify.subtitle": "Get notified before each prayer",
  "notify.enable": "Enable Reminders",
  "notify.enabled": "Reminders On",
  "notify.disable": "Turn Off",
  "notify.prayers": "Which Prayers",
  "notify.leadTime": "Remind Me",
  "notify.atTime": "At time",
  "notify.minBefore": "{min} min before",
  "notify.iosHint": "Add to Home Screen to enable reminders",
  "notify.iosHintDetail": "On iPhone: tap Share, then Add to Home Screen.",
  "notify.unsupported": "Reminders aren't supported on this browser.",
  "notify.permissionDenied": "Notifications are blocked. Enable them in browser settings.",
  "notify.saving": "Saving…",

  // States / errors
  "error.title": "Something went wrong",
  "error.retry": "Try Again",
  "error.location": "We couldn't get your location.",
  "error.locationDenied": "Location access was denied. Search for your city instead.",
  "error.fetch": "Couldn't load prayer times. Check your connection.",
  "error.boundary": "The app hit an unexpected error.",
  "error.reload": "Reload",
  "loading.times": "Calculating prayer times…",

  // Misc
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.credit": "City data © GeoNames",
  "lang.toggle": "العربية",
} as const;

export type StringKey = keyof typeof en;
