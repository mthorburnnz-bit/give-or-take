import { VAPID_PUBLIC_KEY } from "../game/pushKey.ts";

/**
 * Daily reminder subscriptions, from the browser's side.
 *
 * The state here is deliberately never cached in localStorage. A subscription
 * can be revoked from outside the app entirely — OS notification settings, the
 * browser's site permissions, clearing site data — so the only trustworthy
 * answer to "are reminders on" is to ask the browser every time. A cached flag
 * would show a toggle that lies.
 */

export type ReminderState =
  /** No push support at all, or no service worker: hide the control. */
  | "unsupported"
  /** Permission denied, and the browser will not ask again from a click. */
  | "blocked"
  | "on"
  | "off";

export function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** The Push API wants the key as raw bytes, not the base64url it is shipped as. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  // Backed by a concrete ArrayBuffer, not ArrayBufferLike: applicationServerKey
  // is typed as BufferSource and will not accept the looser form.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function getReminderState(): Promise<ReminderState> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.pushManager.getSubscription()) ? "on" : "off";
  } catch {
    return "unsupported";
  }
}

/**
 * Turns reminders on for this device.
 *
 * The permission prompt has to happen inside the user gesture that called this,
 * which is why it is requested first and nothing is awaited before it.
 *
 * The offset sent is minutes to ADD to UTC — the opposite sign to
 * getTimezoneOffset, which returns minutes to subtract. Getting that backwards
 * puts every reminder twice the offset away from where it belongs, which for
 * New Zealand would be a notification at 9pm.
 */
export async function enableReminders(playerId: string): Promise<ReminderState> {
  if (!isPushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Without this a push arrives with no payload and Chrome refuses the
        // subscription outright.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
        subscription: subscription.toJSON(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // Don't leave a browser subscription we will never send to — it would
      // show as "on" forever while nothing arrived.
      await subscription.unsubscribe().catch(() => {});
      return "off";
    }
    return "on";
  } catch {
    return "off";
  }
}

/** Turns reminders off. Best effort on the server; the browser is the truth. */
export async function disableReminders(): Promise<ReminderState> {
  if (!isPushSupported()) return "unsupported";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return "off";

    // Told first, while the endpoint is still known. If this fails the row is
    // pruned anyway on the first send that comes back 404 or 410.
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});

    await subscription.unsubscribe();
    return "off";
  } catch {
    return "on";
  }
}
