// VIX AI service worker — caches the app shell so the UI still loads offline.
// It never caches /api/chat or Supabase requests: those must always hit the network.
const CACHE = "vix-shell-v1";
const SHELL = [
  "/", "/index.html",
  "/css/styles.css", "/css/auth.css",
  "/js/app.js", "/js/api.js", "/js/store.js", "/js/config.js", "/js/supabase.js", "/js/auth.js",
  "/manifest.webmanifest",
  "/assets/vix-logo.png",
  "/assets/icons/icon-192.png", "/assets/icons/icon-512.png",
  "/pages/login.html", "/pages/signup.html", "/pages/forgot.html", "/pages/reset.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // let Supabase/HF/CDN requests pass straight through
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return; // never cache API calls

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => cached || caches.match("/index.html"));
      return cached || network;
    })
  );
});
