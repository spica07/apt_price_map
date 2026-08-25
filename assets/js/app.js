/* 서울 아파트 실거래가 지도 — 앱 로직

   단지 8,810개는 shelter_map(63,042곳)처럼 줌별 뷰포트 렌더러가 필요한
   규모가 아니다. library_map(3,353곳)과 같은 자릿수라 전체 마커를 한 번에
   그리는 단순한 방식을 그대로 쓴다.
*/
(function () {
  'use strict';

  var ROWS = window.APT_COMPLEXES || [];
  var META = window.DATA_META || {};

  var MODES = [
    { key: 'sale', label: '매매', field: 'sale', metricField: 'avgPricePerPyeong', metricLabel: '평당가' },
    { key: 'jeonse', label: '전세', field: 'jeonse', metricField: 'avgDepositPerPyeong', metricLabel: '평당 보증금' },
    { key: 'wolse', label: '월세', field: 'wolse', metricField: 'avgDepositPerPyeong', metricLabel: '평당 보증금' }
  ];
  var state = { mode: 'sale' };

  function modeInfo(key) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].key === key) return MODES[i];
    return MODES[0];
  }

  var ROOT_STYLE = getComputedStyle(document.documentElement);
  function cssVar(name, fallback) {
    return (ROOT_STYLE.getPropertyValue(name) || '').trim() || fallback;
  }
  var PRICE_COLORS = [1, 2, 3, 4, 5].map(function (n) {
    return cssVar('--price-' + n, '#7A2E38');
  });

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 만원 단위 정수 -> "16억 4,000만원" 형태 */
  function formatWon(v) {
    if (v == null) return '';
    var eok = Math.floor(v / 10000);
    var man = v % 10000;
    if (eok > 0 && man > 0) return eok + '억 ' + man.toLocaleString() + '만원';
    if (eok > 0) return eok + '억원';
    return man.toLocaleString() + '만원';
  }

  function formatDate(d) {
    if (!d || d.length !== 8) return '';
    return d.slice(0, 4) + '.' + d.slice(4, 6) + '.' + d.slice(6, 8);
  }

  /* ---------- 분위수 색상 ---------- */
  function quantileBreaks(values, n) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var breaks = [];
    for (var i = 1; i < n; i++) {
      var idx = Math.min(sorted.length - 1, Math.floor(sorted.length * i / n));
      breaks.push(sorted[idx]);
    }
    return breaks;
  }

  function bucketOf(v, breaks) {
    for (var i = 0; i < breaks.length; i++) if (v <= breaks[i]) return i;
    return breaks.length;
  }

  var currentBreaks = [];

  function recomputeBreaks() {
    var info = modeInfo(state.mode);
    var values = [];
    for (var i = 0; i < ROWS.length; i++) {
      var entry = ROWS[i][info.field];
      if (entry && entry[info.metricField] != null) values.push(entry[info.metricField]);
    }
    currentBreaks = values.length ? quantileBreaks(values, 5) : [];
  }

  function colorFor(v) {
    if (!currentBreaks.length) return PRICE_COLORS[2];
    return PRICE_COLORS[bucketOf(v, currentBreaks)];
  }

  /* ---------- 지도 ---------- */
  var map = L.map('map', { zoomControl: true, renderer: L.canvas(), preferCanvas: true })
    .setView([37.5642, 126.99], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  /* 독도 — 배경 지도 표기에 기대지 않고 늘 같은 자리에 직접 그린다.
     행정구역: 경상북도 울릉군 울릉읍 독도리 */
  (function markDokdo() {
    var dokdo = L.circleMarker([37.2429, 131.8664], {
      radius: 5, color: '#2f2e2b', weight: 1.6,
      fillColor: '#ffffff', fillOpacity: 1
    }).addTo(map);
    dokdo.bindTooltip('독도', {
      permanent: true, direction: 'right', offset: [6, 0], className: 'dokdo-label'
    });
    dokdo.bindPopup('<b>독도</b><br>경상북도 울릉군 울릉읍 독도리');
  })();

  var markerLayer = L.layerGroup().addTo(map);

  function dealListHtml(entry, mode) {
    var shown = entry.deals.slice(0, 5);
    var items = shown.map(function (d) {
      if (mode === 'sale') {
        return '<li>' + esc(formatDate(d.date)) + ' · ' + esc(formatWon(d.price)) +
          ' · ' + d.area.toFixed(1) + '㎡ · ' + d.floor + '층</li>';
      }
      var rentPart = d.rent > 0 ? ' · 월세 ' + esc(formatWon(d.rent)) : '';
      return '<li>' + esc(formatDate(d.date)) + ' · 보증금 ' + esc(formatWon(d.deposit)) +
        rentPart + ' · ' + d.area.toFixed(1) + '㎡ · ' + d.floor + '층</li>';
    });
    var more = entry.count > shown.length
      ? '<p class="popup-more">최근 ' + shown.length + '건 표시 · 전체 ' + entry.count.toLocaleString() + '건</p>'
      : '';
    return '<ul class="popup-deals">' + items.join('') + '</ul>' + more;
  }

  function popupHtml(complex, mode) {
    var info = modeInfo(mode);
    var entry = complex[info.field];
    var headline = mode === 'sale'
      ? '최근 ' + esc(formatWon(entry.latestPrice))
      : '최근 보증금 ' + esc(formatWon(entry.latestDeposit)) +
        (entry.latestRent > 0 ? ' · 월세 ' + esc(formatWon(entry.latestRent)) : '');
    var perPyeong = entry[info.metricField];
    return '<div class="popup-name">' + esc(complex.name) + '</div>' +
      '<div class="popup-meta">' + esc(complex.gu) + ' ' + esc(complex.dong) + ' · ' + esc(info.label) + '</div>' +
      '<div class="popup-stat"><b>' + headline + '</b></div>' +
      '<div class="popup-stat">' + esc(info.metricLabel) + ' ' + esc(formatWon(perPyeong)) + ' · 거래 ' + entry.count.toLocaleString() + '건 · ' +
      esc(formatDate(entry.latestDate)) + '</div>' +
      dealListHtml(entry, mode);
  }

  function render() {
    markerLayer.clearLayers();
    recomputeBreaks();
    var info = modeInfo(state.mode);
    var count = 0;
    for (var i = 0; i < ROWS.length; i++) {
      var complex = ROWS[i];
      var entry = complex[info.field];
      if (!entry) continue;
      count++;
      var marker = L.circleMarker([complex.lat, complex.lng], {
        radius: 6,
        fillColor: colorFor(entry[info.metricField]),
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.9
      });
      marker.bindPopup(popupHtml(complex, state.mode));
      marker.addTo(markerLayer);
    }
    document.getElementById('modeCount').textContent = '총 ' + count.toLocaleString() + '개 단지';
    renderLegend();
  }

  function renderLegend() {
    var legend = document.getElementById('mapLegend');
    if (!currentBreaks.length) { legend.innerHTML = ''; return; }
    var info = modeInfo(state.mode);
    var swatches = PRICE_COLORS.map(function (c) {
      return '<span class="legend-dot" style="background:' + c + '"></span>';
    }).join('');
    legend.innerHTML =
      '<span class="legend-lbl">' + esc(info.metricLabel) + ' 낮음</span>' +
      '<span class="legend-scale">' + swatches + '</span>' +
      '<span class="legend-lbl">높음</span>';
  }

  /* ---------- 모드 토글 ---------- */
  function buildModeToggle() {
    var wrap = document.getElementById('modeToggle');
    wrap.innerHTML = MODES.map(function (m) {
      return '<button class="pill' + (m.key === state.mode ? ' active' : '') +
        '" data-mode="' + m.key + '" type="button">' + esc(m.label) + '</button>';
    }).join('');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-mode]');
    if (!btn) return;
    state.mode = btn.getAttribute('data-mode');
    document.querySelectorAll('#modeToggle .pill').forEach(function (p) {
      p.classList.toggle('active', p === btn);
    });
    render();
  });

  /* ---------- 시작 ---------- */
  document.getElementById('totalCount').textContent = (META.total || ROWS.length).toLocaleString();
  document.getElementById('genDate').textContent = META.generatedAt || '';
  buildModeToggle();
  render();

  /* PWA: 서비스 워커 등록 */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('서비스 워커 등록 실패:', err);
      });
    });
  }
})();
