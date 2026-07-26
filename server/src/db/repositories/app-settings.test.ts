import { describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createAppSettings } from "./app-settings.js";

/**
 * The safety property that matters: a database problem must NEVER change
 * behaviour. Verified here rather than by stopping Postgres in production —
 * that instance is shared with the other apps on the VPS.
 */
function poolThatFails(): pg.Pool {
  return {
    query: vi.fn(async () => {
      throw new Error("connection refused");
    }),
  } as unknown as pg.Pool;
}

function poolReturning(rows: { key: string; value: unknown }[]): pg.Pool {
  return {
    query: vi.fn(async () => ({ rows })),
  } as unknown as pg.Pool;
}

describe("app settings", () => {
  it("returns the fallback when the database is unreachable", async () => {
    const settings = createAppSettings(poolThatFails());
    await expect(settings.get("places.enabled", true)).resolves.toBe(true);
    await expect(settings.get("places.monthlyUnitCap", 4500)).resolves.toBe(4500);
    // A missing store must not read as "everything off".
    await expect(settings.get("places.enabled", false)).resolves.toBe(false);
  });

  it("never throws out of get(), whatever the database does", async () => {
    const settings = createAppSettings(poolThatFails());
    await expect(settings.get("anything", "default")).resolves.toBe("default");
    await expect(settings.all()).resolves.toEqual({});
  });

  it("returns a stored override when one exists", async () => {
    const settings = createAppSettings(poolReturning([{ key: "places.enabled", value: false }]));
    await expect(settings.get("places.enabled", true)).resolves.toBe(false);
  });

  it("treats a null row as no override", async () => {
    // DELETE /api/admin/settings/:name stores null rather than removing the row.
    const settings = createAppSettings(poolReturning([{ key: "places.enabled", value: null }]));
    await expect(settings.get("places.enabled", true)).resolves.toBe(true);
  });

  it("ignores a stored value of the wrong type", async () => {
    // A corrupt row is not an instruction.
    const settings = createAppSettings(
      poolReturning([{ key: "places.monthlyUnitCap", value: "lots" }]),
    );
    await expect(settings.get("places.monthlyUnitCap", 4500)).resolves.toBe(4500);
  });

  it("caches, so a request-path read is not a query per request", async () => {
    const pool = poolReturning([{ key: "k", value: 1 }]);
    const settings = createAppSettings(pool);
    await settings.get("k", 0);
    await settings.get("k", 0);
    await settings.get("k", 0);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent refreshes into one query", async () => {
    const pool = poolReturning([{ key: "k", value: 1 }]);
    const settings = createAppSettings(pool);
    await Promise.all([settings.get("k", 0), settings.get("k", 0), settings.get("k", 0)]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
