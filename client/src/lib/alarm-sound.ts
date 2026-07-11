// Alarm playback — plays the user-selected MP3 tone (client/public/alarms, see
// lib/alarm-sounds) on loop while an alarm is ringing, and single-shot for the
// Settings preview. One shared HTMLAudioElement is reused (alarm and preview are
// never concurrent). `unlockAlarmAudio()` MUST be called from a user gesture (a
// tap in the rule form) so a later, gesture-less alarm — triggered by a
// service-worker push — can play: once the element has played from a gesture it
// stays "activated" across src changes, so `startAlarm()` succeeds without its
// own gesture. If it is ever still blocked, `startAlarm()` returns false and the
// overlay retries on the first tap.

import { loadState } from "@/lib/storage";
import { alarmSoundSrc } from "@/lib/alarm-sounds";

let audio: HTMLAudioElement | null = null;

function el(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

/** Resolve the currently-selected tone's URL from persisted settings. */
export function getSelectedAlarmSrc(): string {
  try {
    return alarmSoundSrc(loadState().alarmSound);
  } catch {
    return alarmSoundSrc("");
  }
}

/**
 * Pre-warm the audio pipeline from within a user gesture so a later push-driven
 * alarm can play without its own gesture. Loads + briefly (muted) plays the
 * selected tone, then pauses. Safe to call repeatedly.
 */
export function unlockAlarmAudio(): void {
  const a = el();
  if (!a) return;
  a.src = getSelectedAlarmSrc();
  a.loop = false;
  a.muted = true;
  const done = () => {
    a.pause();
    try {
      a.currentTime = 0;
    } catch {
      /* ignore */
    }
    a.muted = false;
  };
  a.play().then(done).catch(() => {
    a.muted = false;
  });
}

/**
 * Start the looping alarm tone (the overlay stops it after 2 min or on dismiss).
 * Returns false if audio is unavailable or the element stays blocked (no prior
 * gesture) — the overlay then degrades to visual/vibration and retries on tap.
 */
export async function startAlarm(): Promise<boolean> {
  const a = el();
  if (!a) return false;
  a.src = getSelectedAlarmSrc();
  a.loop = true;
  a.muted = false;
  a.volume = 1;
  a.onended = null; // clear any leftover preview callback
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  try {
    await a.play();
    return true;
  } catch {
    return false;
  }
}

/** Stop the alarm (or preview) and rewind. */
export function stopAlarm(): void {
  if (!audio) return;
  audio.pause();
  audio.loop = false;
  try {
    audio.currentTime = 0;
  } catch {
    /* ignore */
  }
}

/**
 * Preview one tone once (single-shot) from a Settings tap — a direct user
 * gesture, so autoplay is never blocked. Stops any current playback first.
 */
export async function previewAlarm(src: string, onEnded?: () => void): Promise<void> {
  const a = el();
  if (!a) return;
  stopAlarm();
  a.src = src;
  a.loop = false;
  a.muted = false;
  a.volume = 1;
  a.onended = onEnded ?? null;
  try {
    a.currentTime = 0;
  } catch {
    /* ignore */
  }
  try {
    await a.play();
  } catch {
    /* ignore — preview is best-effort */
  }
}

/** Stop a preview (alias of stopAlarm — they share the element). */
export const stopPreview = stopAlarm;
