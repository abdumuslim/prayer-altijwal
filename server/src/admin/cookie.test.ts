import { describe, it, expect } from "vitest";
import { clearCookie, parseCookies, serializeCookie } from "./cookie.js";

describe("parseCookies", () => {
  it("returns an empty object for missing or empty headers", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
    expect(parseCookies("   ")).toEqual({});
  });

  it("parses one and many cookies", () => {
    expect(parseCookies("padm=abc")).toEqual({ padm: "abc" });
    expect(parseCookies("a=1; b=2;c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("keeps everything after the first '=' (base64 values contain them)", () => {
    expect(parseCookies("padm=aGVsbG8=.c2ln")).toEqual({ padm: "aGVsbG8=.c2ln" });
  });

  it("ignores malformed segments instead of throwing", () => {
    expect(parseCookies("novalue; =noname; ok=1")).toEqual({ ok: "1" });
  });

  it("decodes percent-encoding and survives invalid encoding", () => {
    expect(parseCookies("x=a%20b")).toEqual({ x: "a b" });
    expect(() => parseCookies("x=%E0%A4%A")).not.toThrow();
    expect(parseCookies("x=%E0%A4%A")).toEqual({ x: "%E0%A4%A" });
  });

  it("keeps the first occurrence of a repeated name", () => {
    // A second Set-Cookie for the same name must not let a caller shadow ours.
    expect(parseCookies("padm=real; padm=forged")).toEqual({ padm: "real" });
  });

  it("ignores absurdly long headers", () => {
    expect(parseCookies(`x=${"a".repeat(10_000)}`)).toEqual({});
  });
});

describe("serializeCookie", () => {
  it("emits the hardened defaults", () => {
    const out = serializeCookie("padm", "v", { maxAgeSec: 60, secure: true });
    expect(out).toContain("padm=v");
    expect(out).toContain("HttpOnly");
    expect(out).toContain("SameSite=Strict");
    expect(out).toContain("Path=/api/admin");
    expect(out).toContain("Max-Age=60");
    expect(out).toContain("Secure");
  });

  it("omits Secure when not requested (http://localhost dev)", () => {
    expect(serializeCookie("padm", "v", { maxAgeSec: 60, secure: false })).not.toContain("Secure");
  });

  it("percent-encodes the value", () => {
    expect(serializeCookie("padm", "a b;c", { maxAgeSec: 1, secure: true })).toContain(
      "padm=a%20b%3Bc",
    );
  });
});

describe("clearCookie", () => {
  it("expires immediately with matching attributes", () => {
    const out = clearCookie("padm", { secure: true });
    expect(out).toContain("padm=");
    expect(out).toContain("Max-Age=0");
    expect(out).toContain("Path=/api/admin");
  });
});
