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
  "nav.times": "المواقيت",
  "nav.reports": "التقارير",
  "nav.settings": "الإعدادات",

  // Settings
  "settings.title": "الإعدادات",
  "settings.language": "اللغة",
  "settings.done": "تم",
  "settings.version": "الإصدار",

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
  "stats.title": "سجل العبادة",
  "stats.of": "من {n}",
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
