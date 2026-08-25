/* 단지 상세 페이지 — 매매·전세·월세 거래 내역을 한 페이지에 모아 보여준다.
   URL: detail.html?idx=<APT_COMPLEXES 배열 인덱스>

   data.js에는 단지당 최근 20건만 있다(용량 때문). 전체 내역은
   assets/data/deals/<idx>.json 에 따로 있어 이 페이지에서만 받아온다.
   그 파일이 오기 전에는 우선 data.js의 20건으로 빠르게 그리고,
   받아오면 그걸로 다시 그려 "더 보기"가 전체 내역까지 이어지게 한다.
*/
(function () {
  'use strict';

  var ROWS = window.APT_COMPLEXES || [];
  var idx = Number(new URLSearchParams(location.search).get('idx'));
  var complex = ROWS[idx];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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

  var body = document.getElementById('detailBody');

  if (!complex) {
    document.getElementById('detailMeta').textContent = '';
    body.innerHTML = '<section class="panel"><p class="report-note">' +
      '단지를 찾을 수 없어요. <a href="index.html">지도로 돌아가기</a></p></section>';
    return;
  }

  document.title = complex.name + ' — 서울 아파트 실거래가 지도';
  document.getElementById('detailName').textContent = complex.name;
  document.getElementById('detailMeta').textContent = complex.gu + ' ' + complex.dong;

  var MODES = [
    { key: 'sale', label: '매매', field: 'sale', metricField: 'avgPricePerPyeong', metricLabel: '평당가' },
    { key: 'jeonse', label: '전세', field: 'jeonse', metricField: 'avgDepositPerPyeong', metricLabel: '평당 보증금' },
    { key: 'wolse', label: '월세', field: 'wolse', metricField: 'avgDepositPerPyeong', metricLabel: '평당 보증금' }
  ];

  var PAGE_SIZE = 20;
  var shownCount = { sale: PAGE_SIZE, jeonse: PAGE_SIZE, wolse: PAGE_SIZE };
  var fullDeals = null; // { sale:[...], jeonse:[...], wolse:[...] } — 받아오면 채워진다

  function dealsFor(m) {
    if (fullDeals) return fullDeals[m.key];
    var entry = complex[m.field];
    return entry ? entry.deals : [];
  }

  function dealRowHtml(m, d) {
    if (m.key === 'sale') {
      return '<tr><td>' + esc(formatDate(d.date)) + '</td><td>' + esc(formatWon(d.price)) +
        '</td><td>-</td><td>' + d.area.toFixed(1) + '㎡</td><td>' + d.floor + '층</td><td>-</td></tr>';
    }
    var rentTxt = d.rent > 0 ? esc(formatWon(d.rent)) : '-';
    var tag = '<span class="deal-tag ' + (d.renewed ? 'renew">갱신' : 'new">신규') + '</span>';
    return '<tr><td>' + esc(formatDate(d.date)) + '</td><td>' + esc(formatWon(d.deposit)) +
      '</td><td>' + rentTxt + '</td><td>' + d.area.toFixed(1) + '㎡</td><td>' + d.floor + '층</td><td>' + tag + '</td></tr>';
  }

  function sectionHtml(m) {
    var entry = complex[m.field];
    var head = '<section class="panel detail-section"><h2 class="report-h">' + esc(m.label) + '</h2>';
    if (!entry) {
      return head + '<p class="report-note">거래 내역이 없어요.</p></section>';
    }
    var stats = '<div class="stat-tiles">' +
      '<div class="stat-tile"><span class="num">' + entry.count.toLocaleString() + '</span><span class="lbl">거래 건수</span></div>' +
      '<div class="stat-tile"><span class="num">' + esc(formatWon(entry[m.metricField])) + '</span><span class="lbl">' + esc(m.metricLabel) + '</span></div>' +
      '<div class="stat-tile"><span class="num">' + esc(formatDate(entry.latestDate)) + '</span><span class="lbl">최근 거래일</span></div>' +
      '</div>';
    var deals = dealsFor(m);
    var shown = deals.slice(0, shownCount[m.key]);
    var rows = shown.map(function (d) { return dealRowHtml(m, d); }).join('');
    var table = '<div class="table-wrap"><table class="report-table">' +
      '<thead><tr><th>날짜</th><th>금액</th><th>월세</th><th>면적</th><th>층</th><th>구분</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
    var moreBtn = shown.length < deals.length
      ? '<button class="list-more-btn" type="button" data-more="' + m.key + '">더 보기 (' +
        shown.length.toLocaleString() + ' / ' + deals.length.toLocaleString() + ')</button>'
      : '';
    return head + stats + table + moreBtn + '</section>';
  }

  function render() {
    body.innerHTML = MODES.map(sectionHtml).join('');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-more]');
    if (!btn) return;
    var key = btn.getAttribute('data-more');
    shownCount[key] += PAGE_SIZE;
    render();
  });

  render(); // data.js의 최근 20건으로 우선 보여준다

  fetch('assets/data/deals/' + idx + '.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      fullDeals = data;
      render();
    })
    .catch(function () { /* 전체 내역을 못 받아와도 최근 20건은 이미 보이고 있다 */ });
})();
