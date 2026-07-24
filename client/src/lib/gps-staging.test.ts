import { describe, expect, test, vi } from "vitest";
import { GPS_STAGES, runStagedFix } from "./gps-staging";

interface Call {
  options: PositionOptions;
  silent: boolean;
}

/**
 * A requestFix mock that resolves FALSE for the given stage option-objects
 * (compared by reference — runStagedFix passes the GPS_STAGES objects through
 * unchanged) and TRUE otherwise. It never rejects, mirroring the real adapter
 * useLocation.requestGps — an earlier mock that *threw* on failure hid a bug
 * where the staging treated every stage as a success.
 */
function mockFix(failFor: PositionOptions[]) {
  const calls: Call[] = [];
  const requestFix = vi.fn(
    async (options: PositionOptions, opts?: { silent?: boolean }): Promise<boolean> => {
      calls.push({ options, silent: opts?.silent ?? false });
      return !failFor.includes(options);
    },
  );
  return { requestFix, calls };
}

describe("runStagedFix", () => {
  test("fast coarse succeeds → skips the patient fallback and refines SILENTLY", async () => {
    const { requestFix, calls } = mockFix([]);
    await runStagedFix(requestFix);
    expect(calls.map((c) => c.options)).toEqual([GPS_STAGES.fastCoarse, GPS_STAGES.refine]);
    // The regression this suite exists for: a slow/failed precise refine must not
    // flash a location error over a list already painted from the coarse fix.
    expect(calls.find((c) => c.options === GPS_STAGES.refine)?.silent).toBe(true);
  });

  test("fast coarse fails → the patient coarse fallback RUNS, then a silent refine", async () => {
    const { requestFix, calls } = mockFix([GPS_STAGES.fastCoarse]);
    await runStagedFix(requestFix);
    // Guards the review bug: with a never-rejecting adapter the old try/catch
    // skipped patientCoarse entirely. It must run when fastCoarse returns false.
    expect(calls.map((c) => c.options)).toEqual([
      GPS_STAGES.fastCoarse,
      GPS_STAGES.patientCoarse,
      GPS_STAGES.refine,
    ]);
    expect(calls.at(-1)?.silent).toBe(true); // a coarse fix landed → refine stays silent
  });

  test("both coarse stages fail → refine is the NON-silent real attempt; its success does not throw", async () => {
    const { requestFix, calls } = mockFix([GPS_STAGES.fastCoarse, GPS_STAGES.patientCoarse]);
    await expect(runStagedFix(requestFix)).resolves.toBeUndefined();
    expect(calls.at(-1)?.options).toBe(GPS_STAGES.refine);
    expect(calls.at(-1)?.silent).toBe(false); // no fix yet → the refine may surface its error
  });

  test("every stage fails → throws so the caller keeps the surfaced error", async () => {
    const { requestFix } = mockFix([
      GPS_STAGES.fastCoarse,
      GPS_STAGES.patientCoarse,
      GPS_STAGES.refine,
    ]);
    await expect(runStagedFix(requestFix)).rejects.toThrow("gps unavailable");
  });
});
