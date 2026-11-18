// Deixa o app abrir sem internet. Quando há internet, sempre pega a versão mais nova dos arquivos.
// Ao publicar uma atualização, não precisa mexer aqui: o app se atualiza sozinho na próxima abertura com internet.
const CACHE = "espetaria-app";
const FIREBASE_JS = [
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"
];
const ARQUIVOS = ["./", "index.html", "style.css", "app.js", "banco-nuvem.js", "firebase-config.js", "logo.png", "dev-logo.png", "icon-192.png", "icon-512.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all([
    ...ARQUIVOS.map((u) => c.add(u).catch(() => {})),
    ...FIREBASE_JS.map((u) => fetch(u, { mode: "no-cors" }).then((r) => c.put(u, r)).catch(() => {}))   // versão fixa: guarda uma vez e pronto
  ])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method === "GET" && FIREBASE_JS.includes(req.url)) {       // scripts do Firebase: usa o guardado, senão busca e guarda
    e.respondWith(caches.match(req.url).then((c) => c || fetch(req).then((r) => { const k = r.clone(); caches.open(CACHE).then((x) => x.put(req.url, k)); return r; })));
    return;
  }
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 3000);   // internet ruim: usa a cópia guardada
      const r = await fetch(req, { signal: ctl.signal, cache: "no-cache" }); clearTimeout(t);
      if (r.ok) cache.put(req, r.clone());
      return r;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("index.html")) || Response.error();
    }
  })());
});
