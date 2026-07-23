// Arabic string dictionary. Same keys as strings.en.ts (the StringKey source of
// truth), so t() is type-safe and the two stay in lockstep.

import type { StringKey } from "@/i18n/strings.en";

export const ar: Record<StringKey, string> = {
  // App
  "app.title": "أوقات الصلاة",
  "app.tagline": "أوقات دقيقة حسب موقعك",

  // Prayer names
  "prayer.fajr": "الفجر",
  "prayer.sunrise": "الشروق",
  "prayer.dhuhr": "الظهر",
  "prayer.jumuah": "الجمعة",
  "prayer.asr": "العصر",
  "prayer.maghrib": "المغرب",
  "prayer.isha": "العشاء",

  // Next-prayer hero
  "next.label": "الصلاة القادمة",
  "next.header": "المتبقي للأذان",
  "next.in": "بعد {time}",
  "next.tomorrow": "غدًا",
  "next.now": "حان وقت الصلاة",
  "next.passed": "انتهى",
  "next.remaining": "الوقت المتبقي",

  // Events
  "event.islamicNewYear": "رأس السنة الهجرية",
  "event.ashura": "يوم عاشوراء",
  "event.mawlid": "المولد النبوي",
  "event.israMiraj": "الإسراء والمعراج",
  "event.midShaban": "ليلة النصف من شعبان",
  "event.ramadanStart": "بداية رمضان",
  "event.laylatAlQadr": "ليلة القدر",
  "event.eidAlFitr": "عيد الفطر",
  "event.arafah": "يوم عرفة",
  "event.eidAlAdha": "عيد الأضحى",
  "event.upcoming": "المناسبة القادمة",
  "event.next": "المناسبة القادمة",
  "event.today": "اليوم",
  "event.inDays": "بعد {days} أيام",
  "event.inDay": "بعد يوم واحد",
  "event.tomorrow": "غدًا",

  // Location bar
  "location.nearest": "الأقرب: {city}",
  "location.detecting": "جارٍ تحديد موقعك…",
  "location.unknown": "لم يُحدَّد الموقع",
  "location.change": "تغيير",
  "location.useGps": "استخدم موقعي",
  "location.set": "حدّد موقعك",

  // City search
  "search.title": "ابحث عن مدينة",
  "search.placeholder": "اكتب اسم المدينة…",
  "search.noResults": "لا توجد مدن مطابقة",
  "search.searching": "جارٍ البحث…",
  "search.hint": "ابحث عن أي مدينة في العالم",
  "search.governoratesIn": "مدن {country}",

  // Bottom navigation (v2 shell — labels user-approved)
  "nav.home": "الرئيسية",
  "nav.times": "الاتجاهات",
  "nav.reports": "التقارير",
  "nav.settings": "الإعدادات",
  // A11y (Phase 8 — PROPOSED, pending user approval): the nav landmark name;
  // it was mislabeled with nav.home («الرئيسية») before.
  "nav.label": "التنقل",

  // المواقيت tab (strings user-approved in the v2 preview)

  // بوصلة القبلة (QIBLA_MASJID_SPEC §7 — PROPOSED strings, pending user approval)
  "qibla.title": "اتجاه القبلة",
  "qibla.start": "ابدأ البوصلة",
  "qibla.starting": "جارٍ تشغيل البوصلة…",
  "qibla.bearing": "القبلة",
  "qibla.distance": "المسافة إلى الكعبة",
  "qibla.aligned": "أنت باتجاه القبلة",
  "qibla.calibrate": "حرّك الهاتف على شكل 8 لمعايرة البوصلة",
  "qibla.holdFlat": "أمسك الهاتف أفقيًا",
  "qibla.static": "وجّه أعلى الهاتف نحو الشمال ثم اتبع السهم",
  "qibla.permission": "اسمح بالوصول إلى حساسات الحركة",
  "qibla.unavailable": "البوصلة غير متوفرة على هذا الجهاز",
  "qibla.acc.high": "دقة عالية",
  "qibla.acc.medium": "دقة متوسطة",
  "qibla.acc.low": "دقة منخفضة",
  "qibla.acc.unreliable": "بحاجة إلى معايرة",

  // أقرب المساجد (QIBLA_MASJID_SPEC §7 — PROPOSED strings, pending user approval)
  "masjid.title": "أقرب المساجد",
  "masjid.gpsPrompt": "لإيجاد أقرب المساجد فعّل تحديد موقعك الدقيق",
  "masjid.gpsButton": "استخدام موقعي",
  "masjid.none": "لا توجد مساجد قريبة ضمن 5 كم",
  "masjid.error": "تعذّر جلب المساجد القريبة",
  "masjid.maps": "خرائط Google",
  "masjid.waze": "Waze",
  "masjid.walk": "مشيًا",
  "masjid.drive": "بالسيارة",
  // Arabic number agreement: 1 → دقيقة · 2 → دقيقتان · 3–10 → دقائق · 11+ → دقيقة
  "masjid.minute": "دقيقة",
  "masjid.minuteDual": "دقيقتان",
  "masjid.minutePlural": "دقائق",
  "masjid.retry": "إعادة المحاولة",
  "masjid.mapTitle": "خريطة الاتجاهات إلى المسجد",
  "masjid.locating": "جارٍ تحديد موقعك…",
  "ptr.pull": "اسحب للأسفل للتحديث",
  "ptr.release": "أفلت للتحديث",
  "ptr.refreshing": "جارٍ التحديث…",

  // Settings
  "settings.title": "الإعدادات",
  "settings.language": "اللغة",
  "settings.done": "تم",
  "settings.version": "الإصدار",

  // Appearance (theme gallery + font size — strings user-approved)
  "settings.theme": "المظهر",
  "settings.themeSubtitle": "اختر لغة التصميم",
  "theme.night": "الليل",
  "theme.glass": "الزجاج",
  "theme.material": "ماتيريال",
  "theme.contrast": "تباين عالٍ",

  // Notifications
  "notify.title": "تذكيرات الصلاة",
  "notify.subtitle": "اضبط تذكيرات لكل صلاة",
  "notify.enable": "تفعيل التذكيرات",
  "notify.enabled": "التذكيرات مُفعّلة",
  "notify.disable": "إيقاف",
  "notify.prayers": "أي الصلوات",
  "notify.timing": "التوقيت",
  "notify.leadTime": "الدقائق قبل الأذان",
  "notify.atTime": "عند",
  "notify.beforeTiming": "قبل",
  "notify.afterTiming": "بعد",
  "notify.minBefore": "قبل {min} دقيقة",
  "notify.minAfter": "بعد {min} دقيقة",
  "notify.leadTimeAfter": "الدقائق بعد الوقت",
  "notify.customMinutes": "مخصص",
  "notify.kind": "نوع التنبيه",
  "notify.kindNotification": "إشعار",
  "notify.kindAlarm": "منبه",
  "notify.alarmSound": "نغمة المنبّه",
  // A11y (Phase 8 — PROPOSED, pending user approval): preview-button name.
  "notify.preview": "معاينة النغمة",
  "notify.tonesApp": "نغمات التطبيق",
  "notify.tonesDevice": "نغمات الجهاز",
  "notify.sunnahTargets": "السنن والأذكار",
  "notify.allPrayers": "كل الصلوات",
  "notify.selectAll": "تحديد الكل",
  "notify.clearAll": "مسح",
  "notify.add": "إضافة تذكير",
  "notify.save": "حفظ",
  "notify.edit": "تعديل",
  "notify.delete": "حذف",
  "notify.listSep": "، ",
  "notify.iosHint": "أضف إلى الشاشة الرئيسية لتفعيل التذكيرات",
  "notify.iosHintDetail": "على آيفون: اضغط مشاركة ثم أضف إلى الشاشة الرئيسية.",
  "notify.unsupported": "التذكيرات غير مدعومة في هذا المتصفح.",
  "notify.permissionDenied": "الإشعارات محظورة. فعّلها من إعدادات المتصفح.",
  "notify.saving": "جارٍ الحفظ…",
  // Native (Capacitor) app — alarm permission onboarding + offline note.
  "notify.permsTitle": "أذونات المنبّه",
  "notify.permNotifications": "الإشعارات",
  "notify.permNotificationsDesc": "مطلوبة لإظهار التذكيرات",
  "notify.permExact": "التنبيهات الدقيقة",
  "notify.permExactDesc": "لينطلق المنبّه في وقته تمامًا",
  "notify.permFullScreen": "التنبيه بملء الشاشة",
  "notify.permFullScreenDesc": "لإظهار المنبّه فوق شاشة القفل",
  "notify.permBattery": "استثناء موفّر البطارية",
  "notify.permBatteryDesc": "حتى لا يوقف النظامُ المنبّه",
  "notify.permAllow": "السماح",
  "notify.permOpenSettings": "فتح الإعدادات",
  "notify.permOemNotice":
    "على بعض الأجهزة (شاومي، هواوي، أوبو…) فعّل «التشغيل التلقائي» وأزل قيود البطارية عن التطبيق ليعمل المنبّه بثبات.",
  "notify.permGranted": "مُفعّل",
  "notify.offlineNote": "تعمل التذكيرات دون إنترنت",

  // Alarm (full-screen)
  "alarm.stop": "إيقاف",

  // Sunnah satellites + iqama
  "sunnah.duha": "الضحى",
  "sunnah.qiyam": "قيام",
  "iqama.title": "توقيت الإقامة",
  "iqama.subtitle": "الدقائق بين الأذان والإقامة",
  "iqama.in": "الإقامة بعد {time}",
  "iqama.minutes": "{min} دقيقة",
  "iqama.decrease": "إنقاص",
  "iqama.increase": "زيادة",

  // States / errors
  "error.title": "حدث خطأ ما",
  "error.retry": "أعد المحاولة",
  "error.location": "تعذّر تحديد موقعك.",
  "error.locationDenied": "تم رفض الوصول للموقع. ابحث عن مدينتك بدلاً من ذلك.",
  "error.fetch": "تعذّر تحميل أوقات الصلاة. تحقّق من اتصالك.",
  "error.boundary": "واجه التطبيق خطأً غير متوقع.",
  "error.reload": "إعادة التحميل",
  "loading.times": "جارٍ حساب أوقات الصلاة…",

  // Worship tracker — check-in
  "track.q": "أين صلّيت {prayer}؟",
  "track.masjid": "مسجد",
  "track.home": "بيت",
  "track.missed": "فائتة",
  "track.inMasjid": "في المسجد +3",
  "track.atHome": "في البيت +2",
  "track.missedTip": "فائتة −1",
  "track.logPrayer": "سجّل الصلاة",
  "track.adhkarChip": "أذكار بعد الصلاة",
  "track.done": "اكتمل",
  // A11y (Phase 8 — PROPOSED, pending user approval): ScorePill accessible name.
  "track.scoreLabel": "نقاط اليوم {points} · {streak} يوم متتالي",

  // Worship tracker — rawatib
  "rawatib.label": "الرواتب",
  "rawatib.title": "السنن الرواتب",
  "rawatib.rakaat": "{n} ركعة",
  "rawatib.footer": "+1 نقطة لكل موضع · تُفتح المواضع بعد أذان صلاتها",
  "rawatib.beforeFajr": "قبل الفجر",
  "rawatib.beforeDhuhr": "قبل الظهر",
  "rawatib.afterDhuhr": "بعد الظهر",
  "rawatib.afterMaghrib": "بعد المغرب",
  "rawatib.afterIsha": "بعد العشاء",

  // Worship tracker — adhkar
  "adhkar.label": "الأذكار",
  "adhkar.title": "أذكار اليوم",
  "adhkar.morning": "أذكار الصباح",
  "adhkar.evening": "أذكار المساء",
  "adhkar.morningNote": "من الفجر إلى العصر",
  "adhkar.eveningNote": "من العصر إلى الفجر",
  "adhkar.afterPrayer": "بعد {prayer}",
  "adhkar.start": "ابدأ",
  "adhkar.readerAfter": "أذكار بعد الصلاة · {prayer}",
  "adhkar.tapHint": "اضغط في أي مكان للعدّ",
  "adhkar.reward": "+1 نقطة عند إتمام الأذكار",
  "adhkar.morningNow": "الصباح الآن",
  "adhkar.eveningNow": "المساء الآن",

  // Worship tracker — stats
  "stats.streakDays": "{n} أيام متتالية",
  "stats.best": "أفضل يوم:",
  "stats.fard": "الفرائض",
  "stats.rawatib": "الرواتب",
  "stats.adhkar": "الأذكار",
  "stats.duhaQiyam": "الضحى والقيام",
  "stats.today": "اليوم",
  "stats.week": "أسبوع",
  "stats.month": "شهر",
  "stats.months": "أشهر",

  // Reports tab (v2 Phase 6 — wording user-approved via ?design=9 + spec §6)
  "reports.trendTitle": "التقدّم",
  "reports.heatmapTitle": "آخر 62 يومًا",
  "reports.perPrayerTitle": "سجل الصلوات (آخر 62 يومًا)",
  "reports.lifetime": "الإجمالي الكلي",
  "reports.points": "النقاط",
  "reports.daysLogged": "يومًا",
  "reports.perfectDays": "أيام كاملة",
  "reports.bestDay": "أفضل يوم",
  "reports.emptyTitle": "السجل غير مفعّل",
  "reports.emptyBody": "فعّل ميزة السجل لتتبّع صلواتك ونقاطك اليومية",
  "reports.enableRecord": "تفعيل السجل",

  // Worship features (Settings opt-in — all off by default)
  "worship.settings.title": "المزايا الاضافية",
  "worship.settings.subtitle": "اختر ما تريد إظهاره",
  "worship.feature.duha": "صلاة الضحى",
  "worship.feature.qiyam": "قيام الليل",
  "worship.feature.rawatib": "الرواتب",
  "worship.feature.adhkar": "الأذكار",
  "worship.feature.record": "السجل",

  // Misc
  "common.cancel": "إلغاء",
  "common.close": "إغلاق",
  "lang.toggle": "English",
};
