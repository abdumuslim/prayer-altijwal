import { describe, it, expect } from "vitest";
import { startCommunityRefresh } from "./community-refresh.js";
import { ResidentIndex } from "./resident-index.js";
import type { Masjid } from "./google-places.js";
import type {
  ContributionStatus,
  MasjidContributionsRepo,
} from "../db/repositories/masjid-contributions.js";

/** Repo stub: only approved() matters for the serving read-back path. */
function fakeRepo(approvedRows: Masjid[]): MasjidContributionsRepo {
  return {
    async submit() {
      return true;
    },
    async approved() {
      return approvedRows;
    },
    async listByStatus() {
      return [];
    },
    async counts() {
      return { pending: 0, approved: 0, rejected: 0 } as Record<ContributionStatus, number>;
    },
    async update() {
      return null;
    },
  };
}

describe("community refresh venue filter", () => {
  it("never serves an approved husseiniya-named row", async () => {
    const rows: Masjid[] = [
      { id: "usr:1", name: "جامع الرحمن", lat: 33.3, lon: 44.4, address: null },
      { id: "usr:2", name: "حسينية الزهراء", lat: 33.31, lon: 44.41, address: null },
    ];
    const index = ResidentIndex.fromRows([]);
    const captured: Masjid[][] = [];
    const original = index.setCommunity.bind(index);
    index.setCommunity = (served: Masjid[]) => {
      captured.push(served);
      original(served);
    };

    const job = startCommunityRefresh(fakeRepo(rows), index, 60_000);
    try {
      const liveCount = await job.refreshNow();
      const served = captured.at(-1) ?? [];
      // The husseiniya is filtered out even though it was approved.
      expect(served.map((m) => m.name)).toEqual(["جامع الرحمن"]);
      expect(liveCount).toBe(1);
    } finally {
      job.stop();
    }
  });

  it("never serves an approved row pinned outside the Iraq bbox", async () => {
    const rows: Masjid[] = [
      { id: "usr:1", name: "جامع الرحمن", lat: 33.3, lon: 44.4, address: null },
      { id: "usr:2", name: "Out of area", lat: 40.7128, lon: -74.006, address: null }, // New York
    ];
    const index = ResidentIndex.fromRows([]);
    const captured: Masjid[][] = [];
    const original = index.setCommunity.bind(index);
    index.setCommunity = (served: Masjid[]) => {
      captured.push(served);
      original(served);
    };

    const job = startCommunityRefresh(fakeRepo(rows), index, 60_000);
    try {
      const liveCount = await job.refreshNow();
      const served = captured.at(-1) ?? [];
      // The out-of-bbox row is dropped at read-back even though it was approved:
      // an operator edit could move a row out, and the resident index is Iraq-only.
      expect(served.map((m) => m.name)).toEqual(["جامع الرحمن"]);
      expect(liveCount).toBe(1);
    } finally {
      job.stop();
    }
  });
});
