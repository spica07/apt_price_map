/*
 * 서울 아파트 실거래가 지도 - 서비스 워커
 *
 * 전략: stale-while-revalidate — 캐시가 있으면 즉시 보여주고 백그라운드로 갱신,
 * 없으면 네트워크로 받아 캐시에 저장. 오프라인이면 캐시로, 페이지 이동은 index.html로 폴백.
 *
 * 콘텐츠를 크게 바꾸면 CACHE 버전 숫자를 올려서 옛 캐시를 비운다.
 */
/* v10: 지도에 서울 초등학교 표시(토글 가능), 단지에서 가장 가까운
   초등학교를 팝업·상세 페이지에 표시(배정 학교와 다를 수 있다는 문구
   포함) 추가. index.html/app.js/detail.js/style.css와
   data.js(nearestSchool 필드) + 새 파일 assets/js/schools.js가 바뀌었다.
   v9: 모바일에서 지도/목록을 나눠 보여주는 보기 전환(지도·목록 탭) 추가.
   기존엔 모바일에서도 데스크톱과 같은 레이아웃(고정 높이 자르기)을 써서
   목록이 찌그러져 보였다 — 900px 미만은 지도 또는 목록 하나만, 페이지
   스크롤 그대로 쓰는 방식으로 바꿨다. 단지 목록 정렬(최신거래순/가격
   높은순/낮은순)도 추가. index.html/app.js/style.css 변경.
   v8: 2026년 전세가율(매매 대비 전세가) 카드 표시·필터 추가로
   index.html/app.js/style.css와 data.js(jeonseRatio2026 필드)가 바뀌었다.
   v7: "더 보기" 버튼(.list-more-btn)이 padding 없이 폭도 안 잡혀 상세
   페이지에서 거의 안 보이던 문제를 고쳐 style.css가 바뀌었다.
   v6: 단지 상세 페이지(detail.html, 전체 거래 더보기) 추가, 전월세 거래
   목록에 신규/갱신 표시 추가로 index.html/app.js/style.css와
   data.js(재수집) + assets/data/deals/*.json가 바뀌었다.
   v5: 필터 접이식 전환 + 단지 목록 더보기. v4: 리포트 동별 초고가 표.
   v3: 검색·자치구·동 필터. v2: 가격·면적 필터와 단지 목록 패널. */
const CACHE = 'apt-price-map-cache-v10';

/* data.js 는 일부러 뺐다 — 16.6MB라 addAll 이 실패하면 설치 자체가 무산된다.
   아래 stale-while-revalidate 가 첫 조회 때 알아서 캐시에 넣는다. */
const CORE_ASSETS = [
  'index.html',
  'report.html',
  'detail.html',
  'manifest.json',
  'assets/css/style.css',
  'assets/js/app.js',
  'assets/js/report.js',
  'assets/js/detail.js',
  'assets/js/schools.js',
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
