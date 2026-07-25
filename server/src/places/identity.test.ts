import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { clientIdOf, clientIpOf, ipPrefix } from "./identity.js";

function req(headers: Record<string, string | undefined>, remote = "10.0.0.1"): Request {
  return { headers, socket: { remoteAddress: remote } } as unknown as Request;
}

describe("ipPrefix", () => {
  // Addresses here are from the RFC 5737 documentation range on purpose — real
  // infrastructure IPs live in docs/OPERATIONS.md, which is gitignored, and must
  // never be copied into a committed file.
  it("keeps only the /24 of an IPv4 address", () => {
    expect(ipPrefix("203.0.113.221")).toBe("203.0.113.0/24");
    // Two neighbours on the same subnet share a counter — intended: that is a
    // household or a mobile carrier NAT.
    expect(ipPrefix("203.0.113.5")).toBe(ipPrefix("203.0.113.200"));
    expect(ipPrefix("203.0.114.5")).not.toBe(ipPrefix("203.0.113.5"));
  });

  it("unwraps IPv6-mapped IPv4 addresses that Node reports on v4 sockets", () => {
    expect(ipPrefix("::ffff:203.0.113.221")).toBe("203.0.113.0/24");
  });

  it("keeps only the /64 of an IPv6 address", () => {
    expect(ipPrefix("2001:db8:1234:5678:9abc:def0:1234:5678")).toBe("2001:db8:1234:5678::/64");
    expect(ipPrefix("2001:db8:1234:5678:aaaa::1")).toBe("2001:db8:1234:5678::/64");
  });

  it("drops an IPv6 zone index", () => {
    expect(ipPrefix("fe80::1%eth0")).toBe("fe80::/64");
  });

  it("never throws on rubbish", () => {
    expect(ipPrefix("")).toBe("unknown");
    expect(ipPrefix("   ")).toBe("unknown");
    expect(ipPrefix("not-an-ip")).toBe("unknown");
    expect(ipPrefix("1.2.3")).toBe("unknown");
  });
});

describe("clientIpOf", () => {
  it("prefers Cloudflare's header, which is what actually fronts the API", () => {
    expect(clientIpOf(req({ "cf-connecting-ip": "5.6.7.8", "x-forwarded-for": "1.2.3.4" }))).toBe(
      "5.6.7.8",
    );
  });

  it("falls back to the first X-Forwarded-For entry (the original client)", () => {
    expect(clientIpOf(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.9, 172.16.0.1" }))).toBe("1.2.3.4");
  });

  it("falls back to the socket when there is no proxy at all", () => {
    expect(clientIpOf(req({}, "9.9.9.9"))).toBe("9.9.9.9");
  });

  it("ignores an empty proxy header rather than returning a blank id", () => {
    expect(clientIpOf(req({ "cf-connecting-ip": "  " }, "9.9.9.9"))).toBe("9.9.9.9");
  });
});

describe("clientIdOf", () => {
  it("accepts a well-formed app-generated id", () => {
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(clientIdOf(req({ "x-client-id": id }), "1.2.3.0/24")).toBe(id);
  });

  it("falls back to the IP prefix when the header is missing", () => {
    expect(clientIdOf(req({}), "1.2.3.0/24")).toBe("ip:1.2.3.0/24");
  });

  it("rejects a hostile id rather than storing it as a key", () => {
    for (const bad of ["", "short", "x".repeat(200), "has spaces", "'; DROP TABLE--"]) {
      expect(clientIdOf(req({ "x-client-id": bad }), "1.2.3.0/24")).toBe("ip:1.2.3.0/24");
    }
  });
});
