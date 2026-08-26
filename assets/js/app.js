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
  var state = { mode: 'sale', q: '', gu: '', dong: '', view: 'map', sort: 'recent' };
  var PAGE_SIZE = 30;
  var renderedCount = PAGE_SIZE;

  function modeInfo(key) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].key === key) return MODES[i];
    return MODES[0];
  }

  /* ---------- 필터(가격·면적) ----------
     단지에는 대표 면적이 없다 — 최근 거래(최대 20건) 각각에 가격·면적이
     있을 뿐이다. 그래서 "조건에 맞는 거래가 하나라도 있는 단지"를 통과시킨다
     (가격·면적 둘 다 만족하는 한 건이 있어야 한다 — 실제 매물 검색과 같은 방식). */
  var filters = {
    priceMin: null, priceMax: null, areaMin: null, areaMax: null,
    ratioMin: null, ratioMax: null
  };

  function parseNum(el) {
    var v = parseFloat(el.value);
    return isNaN(v) ? null : v;
  }

  function readFilters() {
    filters.priceMin = parseNum(document.getElementById('priceMin'));
    filters.priceMax = parseNum(document.getElementById('priceMax'));
    filters.areaMin = parseNum(document.getElementById('areaMin'));
    filters.areaMax = parseNum(document.getElementById('areaMax'));
    filters.ratioMin = parseNum(document.getElementById('ratioMin'));
    filters.ratioMax = parseNum(document.getElementById('ratioMax'));
  }

  function hasActiveFilter() {
    return filters.priceMin != null || filters.priceMax != null ||
           filters.areaMin != null || filters.areaMax != null;
  }

  /* ---------- 검색 · 자치구 · 동 · 전세가율 ----------
     전세가율(jeonseRatio2026)은 거래 한 건이 아니라 단지 전체의 2026년
     통계라, 가격·면적처럼 거래 단위로 걸지 않고 여기서 단지 단위로 건다.
     현재 보고 있는 모드(매매/전세/월세)와 무관하게 항상 적용된다. */
  function matchesSearchAndGu(complex) {
    if (state.gu && complex.gu !== state.gu) return false;
    if (state.dong && complex.dong !== state.dong) return false;
    if (filters.ratioMin != null &&
        (complex.jeonseRatio2026 == null || complex.jeonseRatio2026 < filters.ratioMin)) return false;
    if (filters.ratioMax != null &&
        (complex.jeonseRatio2026 == null || complex.jeonseRatio2026 > filters.ratioMax)) return false;
    if (state.q) {
      var q = state.q;
      if (complex.name.indexOf(q) === -1 && complex.dong.indexOf(q) === -1 &&
          complex.gu.indexOf(q) === -1) return false;
    }
    return true;
  }

  function korSort(a, b) { return a.localeCompare(b, 'ko'); }

  function fillSelect(sel, placeholder, values) {
    sel.innerHTML = '';
    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = placeholder;
    sel.appendChild(opt0);
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  }

  function buildGuSelect() {
    var guSet = {};
    for (var i = 0; i < ROWS.length; i++) guSet[ROWS[i].gu] = true;
    var gus = Object.keys(guSet).sort(korSort);
    fillSelect(document.getElementById('guSelect'), '전체 자치구', gus);
  }

  /* 선택된 자치구 안의 동 목록으로 동 select를 다시 채운다.
     자치구를 고르지 않았으면(전체) 동은 고를 수 없게 비활성화한다 —
     동 이름이 자치구마다 겹쳐서 자치구 없이 고르면 뜻이 애매해진다. */
  function rebuildDongSelect(gu) {
    var dongSel = document.getElementById('dongSelect');
    if (!gu) {
      fillSelect(dongSel, '전체 동', []);
      dongSel.disabled = true;
      return;
    }
    var dongSet = {};
    for (var i = 0; i < ROWS.length; i++) {
      if (ROWS[i].gu === gu) dongSet[ROWS[i].dong] = true;
    }
    fillSelect(dongSel, '전체 동', Object.keys(dongSet).sort(korSort));
    dongSel.disabled = false;
  }

  /* 매매는 거래가, 전세·월세는 보증금을 "가격"으로 본다 */
  function dealPrice(d, mode) { return mode === 'sale' ? d.price : d.deposit; }

  /* 조건을 만족하는 첫 거래를 돌려준다(없으면 null) — 카드에 그 거래를 보여준다 */
  function matchingDeal(entry, mode) {
    var priceMin = filters.priceMin != null ? filters.priceMin * 10000 : null;  // 억 -> 만원
    var priceMax = filters.priceMax != null ? filters.priceMax * 10000 : null;
    var areaMin = filters.areaMin != null ? filters.areaMin * 3.3058 : null;    // 평 -> ㎡
    var areaMax = filters.areaMax != null ? filters.areaMax * 3.3058 : null;
    for (var i = 0; i < entry.deals.length; i++) {
      var d = entry.deals[i];
      var p = dealPrice(d, mode);
      if (priceMin != null && p < priceMin) continue;
      if (priceMax != null && p > priceMax) continue;
      if (areaMin != null && d.area < areaMin) continue;
      if (areaMax != null && d.area > areaMax) continue;
      return d;
    }
    return null;
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
  var markerById = {};
  var listItems = [];

  function dealListHtml(entry, mode) {
    var shown = entry.deals.slice(0, 5);
    var items = shown.map(function (d) {
      if (mode === 'sale') {
        return '<li>' + esc(formatDate(d.date)) + ' · ' + esc(formatWon(d.price)) +
          ' · ' + d.area.toFixed(1) + '㎡ · ' + d.floor + '층</li>';
      }
      var rentPart = d.rent > 0 ? ' · 월세 ' + esc(formatWon(d.rent)) : '';
      var renewTag = '<span class="deal-tag ' + (d.renewed ? 'renew">갱신' : 'new">신규') + '</span>';
      return '<li>' + esc(formatDate(d.date)) + ' · 보증금 ' + esc(formatWon(d.deposit)) +
        rentPart + ' · ' + d.area.toFixed(1) + '㎡ · ' + d.floor + '층 ' + renewTag + '</li>';
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

  /* ---------- 정렬 ---------- */
  /* 카드에 실제로 보이는 값(필터로 걸린 거래가 있으면 그 거래, 없으면
     단지의 최근 거래)을 기준으로 정렬한다 — listCardHtml의 priceLine과 같은 값. */
  function itemPrice(item) {
    var d = item.deal;
    if (state.mode === 'sale') return d ? d.price : item.entry.latestPrice;
    return d ? d.deposit : item.entry.latestDeposit;
  }
  function itemDate(item) {
    var d = item.deal;
    return d ? d.date : item.entry.latestDate;
  }
  function sortListItems() {
    listItems.sort(function (a, b) {
      if (state.sort === 'priceDesc') return itemPrice(b) - itemPrice(a);
      if (state.sort === 'priceAsc') return itemPrice(a) - itemPrice(b);
      return itemDate(b).localeCompare(itemDate(a));  // 'recent' — 기본값
    });
  }

  function render() {
    markerLayer.clearLayers();
    markerById = {};
    listItems = [];
    recomputeBreaks();
    var info = modeInfo(state.mode);
    var active = hasActiveFilter();
    for (var i = 0; i < ROWS.length; i++) {
      var complex = ROWS[i];
      var entry = complex[info.field];
      if (!entry) continue;
      if (!matchesSearchAndGu(complex)) continue;
      var deal = null;
      if (active) {
        deal = matchingDeal(entry, state.mode);
        if (!deal) continue;
      }
      var marker = L.circleMarker([complex.lat, complex.lng], {
        radius: 6,
        fillColor: colorFor(entry[info.metricField]),
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.9
      });
      marker.bindPopup(popupHtml(complex, state.mode));
      marker.addTo(markerLayer);
      markerById[i] = marker;
      listItems.push({ idx: i, complex: complex, entry: entry, deal: deal });
    }
    sortListItems();
    document.getElementById('modeCount').textContent = '총 ' + listItems.length.toLocaleString() + '개 단지';
    renderedCount = PAGE_SIZE;
    renderLegend();
    renderList();
  }

  /* ---------- 목록(지도 옆) ---------- */
  function listCardHtml(item) {
    var info = modeInfo(state.mode);
    var c = item.complex, entry = item.entry, deal = item.deal;
    var priceLine = deal
      ? (state.mode === 'sale'
          ? esc(formatWon(deal.price))
          : esc(formatWon(deal.deposit)) + (deal.rent > 0 ? ' · 월세 ' + esc(formatWon(deal.rent)) : '')) +
        ' · ' + deal.area.toFixed(1) + '㎡'
      : (state.mode === 'sale'
          ? '최근 ' + esc(formatWon(entry.latestPrice))
          : '최근 보증금 ' + esc(formatWon(entry.latestDeposit)) +
            (entry.latestRent > 0 ? ' · 월세 ' + esc(formatWon(entry.latestRent)) : ''));
    var ratioLine = c.jeonseRatio2026 != null
      ? '<div class="cc-ratio">2026년 전세가율 ' + c.jeonseRatio2026 + '%</div>'
      : '';
    return '<article class="complex-card" data-idx="' + item.idx + '">' +
      '<div class="cc-name">' + esc(c.name) + '</div>' +
      '<div class="cc-meta">' + esc(c.gu) + ' ' + esc(c.dong) + '</div>' +
      '<div class="cc-price">' + priceLine + '</div>' +
      '<div class="cc-sub">' + esc(info.metricLabel) + ' ' + esc(formatWon(entry[info.metricField])) + '</div>' +
      ratioLine +
      '<a class="cc-detail-link" href="detail.html?idx=' + item.idx + '">상세보기 — 매매·전세·월세 모두 보기</a>' +
      '</article>';
  }

  function renderList() {
    var wrap = document.getElementById('complexList');
    var empty = document.getElementById('listEmpty');
    var moreBtn = document.getElementById('listMoreBtn');
    document.getElementById('listCount').textContent = listItems.length.toLocaleString() + '개';
    if (!listItems.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
      moreBtn.hidden = true;
      return;
    }
    empty.hidden = true;
    var shown = listItems.slice(0, renderedCount);
    wrap.innerHTML = shown.map(listCardHtml).join('');
    if (shown.length < listItems.length) {
      moreBtn.hidden = false;
      moreBtn.textContent = '더 보기 (' + shown.length.toLocaleString() + ' / ' + listItems.length.toLocaleString() + ')';
    } else {
      moreBtn.hidden = true;
    }
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

  /* ---------- 지도/목록 보기 전환 (900px 미만에서만 뜻이 있다) ---------- */
  function switchView(v) {
    state.view = v;
    document.querySelectorAll('#viewToggle .pill').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-view') === v);
    });
    var grid = document.querySelector('.content-grid');
    grid.classList.remove('view-map', 'view-list');
    grid.classList.add('view-' + v);
    if (v === 'map') setTimeout(function () { map.invalidateSize(); }, 50);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-mode]');
    if (btn) {
      state.mode = btn.getAttribute('data-mode');
      document.querySelectorAll('#modeToggle .pill').forEach(function (p) {
        p.classList.toggle('active', p === btn);
      });
      render();
      return;
    }

    var viewBtn = e.target.closest('[data-view]');
    if (viewBtn) { switchView(viewBtn.getAttribute('data-view')); return; }

    var card = e.target.closest('[data-idx]');
    if (card) {
      var idx = Number(card.getAttribute('data-idx'));
      var marker = markerById[idx];
      var complex = ROWS[idx];
      if (marker && complex) {
        // 목록만 보이는 화면에서 단지를 누르면 지도로 전환해야 마커가 보인다
        if (window.innerWidth <= 900 && state.view !== 'map') switchView('map');
        map.flyTo([complex.lat, complex.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
        map.once('moveend', function () { marker.openPopup(); });
      }
      return;
    }
  });

  /* ---------- 필터 입력 ---------- */
  var filterTimer = null;
  ['priceMin', 'priceMax', 'areaMin', 'areaMax', 'ratioMin', 'ratioMax'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(function () {
        readFilters();
        render();
      }, 250);
    });
  });

  var searchTimer = null;
  document.getElementById('searchInput').addEventListener('input', function (e) {
    clearTimeout(searchTimer);
    var q = e.target.value;
    searchTimer = setTimeout(function () {
      state.q = q.trim();
      render();
    }, 250);
  });

  document.getElementById('guSelect').addEventListener('change', function (e) {
    state.gu = e.target.value;
    state.dong = '';
    rebuildDongSelect(state.gu);
    render();
  });

  document.getElementById('dongSelect').addEventListener('change', function (e) {
    state.dong = e.target.value;
    render();
  });

  document.getElementById('sortSelect').addEventListener('change', function (e) {
    state.sort = e.target.value;
    sortListItems();
    renderedCount = PAGE_SIZE;
    renderList();
  });

  document.getElementById('filterResetBtn').addEventListener('click', function () {
    ['priceMin', 'priceMax', 'areaMin', 'areaMax', 'ratioMin', 'ratioMax'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    document.getElementById('searchInput').value = '';
    document.getElementById('guSelect').value = '';
    state.q = '';
    state.gu = '';
    state.dong = '';
    rebuildDongSelect('');
    readFilters();
    render();
  });

  /* ---------- 시작 ---------- */
  document.getElementById('totalCount').textContent = (META.total || ROWS.length).toLocaleString();
  document.getElementById('genDate').textContent = META.generatedAt || '';
  buildModeToggle();
  buildGuSelect();
  render();
  if (window.innerWidth <= 900) switchView('list');

  document.getElementById('listMoreBtn').addEventListener('click', function () {
    renderedCount += PAGE_SIZE;
    renderList();
  });

  /* ---------- 필터 접기/펴기 ---------- */
  var filterToggleBtn = document.getElementById('filterToggleBtn');
  var filterGroups = document.getElementById('filterGroups');
  filterToggleBtn.addEventListener('click', function () {
    var willOpen = filterGroups.hidden;
    filterGroups.hidden = !willOpen;
    var label = willOpen ? '필터 닫기' : '필터 열기';
    filterToggleBtn.title = label;
    filterToggleBtn.setAttribute('aria-label', label);
    filterToggleBtn.setAttribute('aria-expanded', String(willOpen));
  });

  /* PWA: 서비스 워커 등록 */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('서비스 워커 등록 실패:', err);
      });
    });
  }
})();
