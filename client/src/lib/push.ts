// Web Push helpers: service-worker registration, VAPID key conversion,
// subscribe/unsubscribe via PushManager. iOS requires the site be installed as
// a PWA (standalone) before push works — see NOTIFICATIONS.md §1.

import { fetchVapidKey, subscribePush, unsubscribePush } from "@/lib/api";
import type { AsrMadhab, Lang } from "@/types/api";

export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** True on an iOS device (iPhone/iPad, including iPadOS reporting as Mac). */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  const iOsLike = /iPad|iPhone|iPod/.test(ua);
  const iPadOs =
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  return iOsLike || iPadOs;
}

/** True when launched from the home screen (installed PWA / standalone). */
export function isStandalone(): boolean {
  const mql = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mql || iosStandalone);
}

/** iOS web push only works once added to the home screen (iOS 16.4+). */
export function iosNeedsInstall(): boolean {
  return isIos() && !isStandalone();
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export interface SubscribeContext {
  lat: number;
  lon: number;
  tz: string;
  country: string | null;
  method: string;
  asr: AsrMadhab;
  lang: Lang;
}

/**
 * Request permission, register the SW, subscribe via PushManager, and POST the
 * subscription + context to the backend. Returns the PushSubscription.
 */
export async function subscribe(ctx: SubscribeContext): Promise<PushSubscription> {
  if (!pushSupported()) {
    throw new Error("Push notifications are not supported on this device.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const reg = await ensureServiceWorker();
  const { publicKey } = await fetchVapidKey();

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await subscribePush({
    subscription: sub.toJSON() as PushSubscriptionJSON,
    lat: ctx.lat,
    lon: ctx.lon,
    tz: ctx.tz,
    country: ctx.country,
    method: ctx.method,
    asr: ctx.asr,
    lang: ctx.lang,
  });

  return sub;
}

export async function unsubscribe(): Promise<void> {
  const sub = await getExistingSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } finally {
    await unsubscribePush(endpoint).catch(() => undefined);
  }
}
