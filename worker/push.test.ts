import { describe, it, expect } from "vitest";
import { isDue, localNow, REMINDER_LOCAL_HOUR, type StoredSubscription } from "./push.ts";

function sub(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    endpoint: "https://push.example/abc",
    player_id: "player-abcdef123456",
    p256dh: "p",
    auth: "a",
    utc_offset_minutes: 0,
    last_sent_date: null,
    ...overrides,
  };
}

const NOBODY_PLAYED = new Map<string, Set<string>>();
/** 09:00 UTC, which is the reminder hour for a subscriber at UTC+0. */
const NINE_UTC = new Date("2026-08-24T09:00:00Z");

describe("localNow", () => {
  it("reports the subscriber's own clock, not the server's", () => {
    // NZST is UTC+12: 09:00 UTC is already 21:00 the same evening there.
    expect(localNow(720, NINE_UTC)).toEqual({ date: "2026-08-24", hour: 21 });
    // US Pacific is UTC-7: still the small hours of the same day.
    expect(localNow(-420, NINE_UTC)).toEqual({ date: "2026-08-24", hour: 2 });
  });

  it("rolls the date when the offset crosses midnight", () => {
    const lateUtc = new Date("2026-08-24T23:30:00Z");
    expect(localNow(120, lateUtc)).toEqual({ date: "2026-08-25", hour: 1 });
    const earlyUtc = new Date("2026-08-24T00:30:00Z");
    expect(localNow(-120, earlyUtc)).toEqual({ date: "2026-08-23", hour: 22 });
  });
});

describe("isDue", () => {
  it("sends in the subscriber's morning", () => {
    expect(isDue(sub(), NINE_UTC, NOBODY_PLAYED)).toBe(true);
  });

  it("stays quiet at every other hour", () => {
    for (const hour of [0, 8, 10, 21]) {
      if (hour === REMINDER_LOCAL_HOUR) continue;
      const at = new Date(`2026-08-24T${String(hour).padStart(2, "0")}:00:00Z`);
      expect(isDue(sub(), at, NOBODY_PLAYED)).toBe(false);
    }
  });

  it("fires for a subscriber whose morning is not the server's", () => {
    // 21:00 UTC is 09:00 the next day in NZST.
    const at = new Date("2026-08-24T21:00:00Z");
    expect(isDue(sub({ utc_offset_minutes: 720 }), at, NOBODY_PLAYED)).toBe(true);
    // ...and the same instant is mid-afternoon at UTC+0, so nothing there.
    expect(isDue(sub({ utc_offset_minutes: 0 }), at, NOBODY_PLAYED)).toBe(false);
  });

  it("does not send twice on the same local day", () => {
    // The sweep runs hourly; without this guard it would fire on every pass
    // through the reminder hour and, worse, every hour after a clock change.
    expect(isDue(sub({ last_sent_date: "2026-08-24" }), NINE_UTC, NOBODY_PLAYED)).toBe(false);
  });

  it("sends again the next day", () => {
    expect(isDue(sub({ last_sent_date: "2026-08-23" }), NINE_UTC, NOBODY_PLAYED)).toBe(true);
  });

  it("does not nag someone who has already played", () => {
    // Reminding a player to do the thing they have just done is the quickest
    // way to have notifications switched off.
    const played = new Map([["player-abcdef123456", new Set(["2026-08-24"])]]);
    expect(isDue(sub(), NINE_UTC, played)).toBe(false);
  });

  it("still sends when they played a different day", () => {
    const played = new Map([["player-abcdef123456", new Set(["2026-08-23"])]]);
    expect(isDue(sub(), NINE_UTC, played)).toBe(true);
  });

  it("uses the subscriber's local date when deciding they have played", () => {
    // At UTC+12 it is already the 25th when the server is on the 24th; having
    // played the 24th must not suppress the 25th's reminder.
    const at = new Date("2026-08-24T21:00:00Z");
    const played = new Map([["player-abcdef123456", new Set(["2026-08-24"])]]);
    expect(isDue(sub({ utc_offset_minutes: 720 }), at, played)).toBe(true);
  });
});
