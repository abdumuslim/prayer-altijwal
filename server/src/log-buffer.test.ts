import { beforeEach, describe, expect, it } from "vitest";
import {
  RING_CAPACITY,
  bufferSize,
  clearBuffer,
  getRecentLogs,
  parseLine,
  pushLine,
  redact,
  registerRedactedSecrets,
} from "./log-buffer.js";

function line(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 50,
    time: Date.UTC(2026, 6, 26, 12, 0, 0),
    component: "test",
    msg: "something failed",
    ...over,
  });
}

beforeEach(() => {
  clearBuffer();
  registerRedactedSecrets([]);
});

describe("redaction", () => {
  it("masks the password inside a Postgres DSN", () => {
    // pg puts the whole connection string in its error messages.
    const raw = line({
      msg: "connect failed for postgresql://prayer_user:sup3rs3cret@rag-postgres-1:5432/prayer",
    });
    const out = redact(raw);
    expect(out).not.toContain("sup3rs3cret");
    expect(out).toContain("postgresql://prayer_user:[redacted]@rag-postgres-1");
  });

  it("masks coordinates wherever they appear", () => {
    const raw = line({ lat: 33.31527, lon: 44.36611, nested: { latitude: 1.5 } });
    const out = redact(raw);
    expect(out).not.toContain("33.31527");
    expect(out).not.toContain("44.36611");
    expect(out).not.toContain("1.5");
  });

  it("masks registered secret values anywhere in the line", () => {
    registerRedactedSecrets(["AIzaSyEXAMPLEKEY123456", undefined, "short"]);
    const out = redact(line({ msg: "upstream rejected key AIzaSyEXAMPLEKEY123456" }));
    expect(out).not.toContain("AIzaSyEXAMPLEKEY123456");
    expect(out).toContain("[redacted]");
  });

  it("ignores values too short to be secrets (avoids shredding ordinary text)", () => {
    registerRedactedSecrets(["abc"]);
    expect(redact(line({ msg: "abc def" }))).toContain("abc def");
  });
});

describe("parsing", () => {
  it("keeps warnings, errors and fatals", () => {
    expect(parseLine(line({ level: 40 }))?.level).toBe("warn");
    expect(parseLine(line({ level: 50 }))?.level).toBe("error");
    expect(parseLine(line({ level: 60 }))?.level).toBe("fatal");
  });

  it("drops info and debug", () => {
    expect(parseLine(line({ level: 30 }))).toBeNull();
    expect(parseLine(line({ level: 20 }))).toBeNull();
  });

  it("never throws on malformed input", () => {
    for (const bad of ["", "not json", "{", '{"level":', "null", "[]"]) {
      expect(() => parseLine(bad)).not.toThrow();
      expect(parseLine(bad)).toBeNull();
    }
  });

  it("extracts the error message and truncates long fields", () => {
    const entry = parseLine(line({ err: { message: "x".repeat(900), type: "Error" } }));
    expect(entry?.err?.length).toBeLessThanOrEqual(501);
    expect(entry?.err?.endsWith("…")).toBe(true);
  });
});

describe("the ring", () => {
  it("returns newest first", () => {
    pushLine(line({ msg: "first" }));
    pushLine(line({ msg: "second" }));
    expect(getRecentLogs().map((e) => e.msg)).toEqual(["second", "first"]);
  });

  it("never grows past its capacity", () => {
    for (let i = 0; i < RING_CAPACITY + 250; i++) pushLine(line({ msg: `entry ${i}` }));
    expect(bufferSize()).toBe(RING_CAPACITY);
    // The oldest entries are the ones dropped.
    expect(getRecentLogs({ limit: 1 })[0]?.msg).toBe(`entry ${RING_CAPACITY + 249}`);
  });

  it("filters by level and component", () => {
    pushLine(line({ level: 40, component: "places", msg: "warned" }));
    pushLine(line({ level: 50, component: "push", msg: "errored" }));
    expect(getRecentLogs({ level: "error" }).map((e) => e.msg)).toEqual(["errored"]);
    expect(getRecentLogs({ component: "places" }).map((e) => e.msg)).toEqual(["warned"]);
  });

  it("stores redacted content, not just redacted views", () => {
    registerRedactedSecrets(["VAPIDPRIVATEKEYVALUE"]);
    pushLine(line({ msg: "sending with VAPIDPRIVATEKEYVALUE" }));
    expect(JSON.stringify(getRecentLogs())).not.toContain("VAPIDPRIVATEKEYVALUE");
  });
});
