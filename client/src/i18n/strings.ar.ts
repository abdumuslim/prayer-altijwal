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
  "prayer.asr": "العصر",
  "prayer.maghrib": "المغرب",
  "prayer.isha": "العشاء",

  // Next-prayer hero
  "next.label": "الصلاة القادمة",
  "next.header": "الوقت المتبقي للاذان القادم",
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

  // Settings
  "settings.title": "الإعدادات",
  "settings.language": "اللغة",
  "settings.done": "تم",

  // Notifications
  "notify.title": "تذكيرات الصلاة",
  "notify.subtitle": "اضبط تذكيرات لكل صلاة",
  "notify.enable": "تفعيل التذكيرات",
  "notify.enabled": "التذكيرات مُفعّلة",
  "notify.disable": "إيقاف",
  "notify.prayers": "أي الصلوات",
  "notify.timing": "التوقيت",
  "notify.leadTime": "الدقائق قبل الأذان",
  "notify.atTime": "عند الأذان",
  "notify.beforeTiming": "قبل",
  "notify.minBefore": "قبل {min} دقيقة",
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

  // Misc
  "common.cancel": "إلغاء",
  "common.close": "إغلاق",
  "lang.toggle": "English",
};
