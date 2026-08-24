// Minimal offline-support service worker. No build-time asset manifest (no
// PWA plugin) — instead it opportunistically caches whatever the app
// actually requests during a successful online visit, so the current day's
// puzzle keeps working offline once it's been loaded. Spec §2.1 / §5.3.

// Bumped when caching behaviour changes — the activate handler deletes any
// cache whose name doesn't match, which purges entries written under the old
// rules (notably stale /api/ responses cached before they were excluded).
const CACHE_NAME = "giveortake-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match("/index.html")) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API responses are live data (leaderboard standings, challenge lookups)
  // and must never be served from cache — cache-first here would freeze the
  // leaderboard permanently for anyone with the worker installed. Left to the
  // network entirely, so an offline failure surfaces as a normal fetch error
  // the UI already handles, rather than silently stale data.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations network-first (so today's schedule/content updates show up
  // while online); hashed build assets and content JSON cache-first since
  // they're effectively immutable once fetched.
  event.respondWith(request.mode === "navigate" ? networkFirst(request) : cacheFirst(request));
});

/**
 * Daily reminder notifications.
 *
 * In the installed Android app these are delegated to the app itself by
 * androidbrowserhelper's TrustedWebActivityService, so they arrive looking
 * like Give or Take rather than like Chrome. In a browser they are ordinary
 * web notifications. Same code path either way.
 */
self.addEventListener("push", (event) => {
  // A push with no body, or an unparseable one, still deserves a notification
  // rather than nothing — the point is the nudge, not the wording.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Give or Take";
  const body = payload.body || "Today's five are up.";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Collapses onto any previous unread reminder rather than stacking a
      // week of them for someone who has been away.
      tag: "daily-reminder",
      renotify: true,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  // Focus an already-open copy rather than opening a second one.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
