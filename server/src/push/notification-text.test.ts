import { describe, it, expect } from "vitest";
import { buildPushPayload } from "./notification-text.js";

describe("buildPushPayload", () => {
  it("localizes the five fard titles + at-time body (ar/en)", () => {
    expect(buildPushPayload("fajr", 0, "ar")).toMatchObject({ title: "الفجر", body: "حان وقت الصلاة" });
    expect(buildPushPayload("isha", 0, "en")).toMatchObject({ title: "Isha", body: "It's time to pray" });
  });

  it("shows الجمعة for dhuhr only on Fridays", () => {
    expect(buildPushPayload("dhuhr", 0, "ar", { friday: true }).title).toBe("الجمعة");
    expect(buildPushPayload("dhuhr", 0, "ar", { friday: false }).title).toBe("الظهر");
    expect(buildPushPayload("dhuhr", 0, "en", { friday: true }).title).toBe("Jumu'ah");
    // Friday flag never affects a non-dhuhr prayer.
    expect(buildPushPayload("asr", 0, "ar", { friday: true }).title).toBe("العصر");
  });

  it("titles + at-time bodies for the sunnah/adhkar targets", () => {
    expect(buildPushPayload("duha", 0, "ar")).toMatchObject({ title: "صلاة الضحى", body: "بدأ وقت الضحى" });
    expect(buildPushPayload("qiyam", 0, "ar")).toMatchObject({
      title: "قيام الليل",
      body: "بدأ الثلث الأخير من الليل",
    });
    expect(buildPushPayload("adhkar_morning", 0, "ar")).toMatchObject({
      title: "أذكار الصباح",
      body: "حان وقت أذكار الصباح",
    });
    expect(buildPushPayload("adhkar_evening", 0, "en")).toMatchObject({
      title: "Evening adhkar",
      body: "Time for evening adhkar",
    });
  });

  it("before (+lead) and after (−lead) bodies with Latin numerals", () => {
    expect(buildPushPayload("fajr", 10, "ar").body).toBe("بعد 10 دقيقة");
    expect(buildPushPayload("fajr", 10, "en").body).toBe("in 10 minutes");
    expect(buildPushPayload("duha", -30, "ar").body).toBe("منذ 30 دقيقة");
    expect(buildPushPayload("duha", -30, "en").body).toBe("30 minutes ago");
  });

  it("falls back to the raw target name for an unknown key", () => {
    expect(buildPushPayload("mystery", 0, "ar").title).toBe("mystery");
  });
});
