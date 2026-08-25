/*
 * 서울 아파트 실거래가 지도 - 서비스 워커
 *
 * 전략: stale-while-revalidate — 캐시가 있으면 즉시 보여주고 백그라운드로 갱신,
 * 없으면 네트워크로 받아 캐시에 저장. 오프라인이면 캐시로, 페이지 이동은 index.html로 폴백.
 *
 * 콘텐츠를 크게 바꾸면 CACHE 버전 숫자를 올려서 옛 캐시를 비운다.
 */
/* v3: 검색·자치구·동 필터 추가로 index.html/app.js/style.css가 또 함께 바뀌었다.
   v2: 가격·면적 필터와 단지 목록 패널 추가. */
const CACHE = 'apt-price-map-cache-v3';

/* data.js 는 일부러 뺐다 — 16.6MB라 addAll 이 실패하면 설치 자체가 무산된다.
   아래 stale-while-revalidate 가 첫 조회 때 알아서 캐시에 넣는다. */
const CORE_ASSETS = [
  'index.html',
  'report.html',
  'manifest.json',
  'assets/css/style.css',
  'assets/js/app.js',
  'assets/js/report.js',
  'assets/icons/app-icon-192.png',
  'assets/icons/app-icon-512.png',
  'assets/icons/app-icon-apple-180.png',
  'assets/icons/app-icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(staleWhileRevalidate(event));
});

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(fetchPromise);
    return cached;
  }

  const res = await fetchPromise;
  if (res) return res;

  if (req.mode === 'navigate') {
    const fallback = await cache.match('index.html');
    if (fallback) return fallback;
  }
  return new Response('오프라인 상태예요. 인터넷에 연결한 뒤 다시 시도해 주세요.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
