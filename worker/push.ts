import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

export { VAPID_PUBLIC_KEY } from "../src/game/pushKey.ts";
import { VAPID_PUBLIC_KEY } from "../src/game/pushKey.ts";

/** Push services want a way to contact whoever is sending. */
const VAPID_SUBJECT = "mailto:contactme@give-or-take.com";

/** Local hour a reminder should land in. Morning, when the day's puzzle is new. */
export const REMINDER_LOCAL_HOUR = 9;

export interface StoredSubscription {
  endpoint: string;
  player_id: string;
  p256dh: string;
  auth: string;
  utc_offset_minutes: number;
  last_sent_date: string | null;
}

/** The subscriber's wall-clock time, as their own date and hour. */
export function localNow(utcOffsetMinutes: number, now: Date): { date: string; hour: number } {
  const shifted = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

/**
 * Whether this subscription should be sent to on this sweep.
 *
 * Three conditions, and all of them exist to avoid being annoying: it has to
 * be morning where they are, they must not already have been sent to today,
 * and they must not have already played — a reminder to do something you have
 * done is the fastest way to get notifications turned off.
 */
export function isDue(
  sub: StoredSubscription,
  now: Date,
  playedDatesByPlayer: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const { date, hour } = localNow(sub.utc_offset_minutes, now);
  if (hour !== REMINDER_LOCAL_HOUR) return false;
  if (sub.last_sent_date === date) return false;
  return !playedDatesByPlayer.get(sub.player_id)?.has(date);
}

export interface SendOutcome {
  endpoint: string;
  /** Gone means the browser dropped the subscription and the row should go. */
  gone: boolean;
  ok: boolean;
}

/**
 * Encrypts and delivers one reminder.
 *
 * A push service answers 404 or 410 when a subscription no longer exists —
 * app uninstalled, permission revoked, browser data cleared. Those rows are
 * dead and are reported back for deletion rather than retried forever.
 */
export async function sendReminder(
  sub: StoredSubscription,
  privateKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    expirationTime: null,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  try {
    const payload = await buildPushPayload(
      {
        data: JSON.stringify({
          title: "Give or Take",
          body: "Today's five are up. How tight can you go?",
          url: "/",
        }),
        options: { ttl: 12 * 60 * 60 },
      },
      subscription,
      { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey },
    );

    const res = await fetchImpl(sub.endpoint, payload);
    return { endpoint: sub.endpoint, gone: res.status === 404 || res.status === 410, ok: res.ok };
  } catch {
    // A transient failure is not evidence the subscription is dead, so it is
    // left in place to be retried on tomorrow's sweep.
    return { endpoint: sub.endpoint, gone: false, ok: false };
  }
}
