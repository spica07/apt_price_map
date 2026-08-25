(function () {
  'use strict';
  var ROWS = window.APT_COMPLEXES || [];
  var META = window.DATA_META || {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function count(field) {
    var n = 0;
    for (var i = 0; i < ROWS.length; i++) if (ROWS[i][field]) n++;
    return n;
  }

  var saleN = count('sale'), jeonseN = count('jeonse'), wolseN = count('wolse');

  document.getElementById('statTiles').innerHTML = [
    ['총 단지', ROWS.length],
    ['매매 데이터', saleN],
    ['전세 데이터', jeonseN],
    ['월세 데이터', wolseN]
  ].map(function (t) {
    return '<div class="stat-tile"><span class="num">' + t[1].toLocaleString() +
      '</span><span class="lbl">' + esc(t[0]) + '</span></div>';
  }).join('');

  var byGu = {};
  ROWS.forEach(function (c) { byGu[c.gu] = (byGu[c.gu] || 0) + 1; });
  var guRows = Object.keys(byGu).sort(function (a, b) { return byGu[b] - byGu[a]; });

  var html = '<thead><tr><th>자치구</th><th>단지 수</th></tr></thead><tbody>';
  guRows.forEach(function (gu) {
    html += '<tr><td>' + esc(gu) + '</td><td>' + byGu[gu].toLocaleString() + '</td></tr>';
  });
  html += '</tbody>';
  document.getElementById('guTable').innerHTML = html;

  /* ---------- 2026년 동별 평당 초고가 ---------- */
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

  var byDongTop = {};
  ROWS.forEach(function (c) {
    if (!c.sale) return;
    c.sale.deals.forEach(function (d) {
      if (!d.date || d.date.slice(0, 4) !== '2026') return;
      var pyeong = d.area / 3.3058;
      if (pyeong <= 0) return;
      var ppy = d.price / pyeong;
      var cur = byDongTop[c.dong];
      if (!cur || ppy > cur.ppy) {
        byDongTop[c.dong] = { gu: c.gu, dong: c.dong, name: c.name, ppy: ppy, deal: d };
      }
    });
  });
  var topRows = Object.keys(byDongTop).map(function (k) { return byDongTop[k]; })
    .sort(function (a, b) { return b.ppy - a.ppy; });

  var topHtml = '<thead><tr><th>순위</th><th>자치구</th><th>동</th><th>단지</th>' +
    '<th>평당가</th><th>거래가</th><th>면적</th><th>거래일</th></tr></thead><tbody>';
  topRows.forEach(function (r, i) {
    topHtml += '<tr><td>' + (i + 1) + '</td><td>' + esc(r.gu) + '</td><td>' + esc(r.dong) + '</td>' +
      '<td>' + esc(r.name) + '</td><td>' + esc(formatWon(Math.round(r.ppy))) + '</td>' +
      '<td>' + esc(formatWon(r.deal.price)) + '</td><td>' + r.deal.area.toFixed(1) + '㎡</td>' +
      '<td>' + esc(formatDate(r.deal.date)) + '</td></tr>';
  });
  topHtml += '</tbody>';
  document.getElementById('topByDongTable').innerHTML = topHtml;

  document.title = '데이터 리포트 (' + (META.generatedAt || '') + ') — 서울 아파트 실거래가 지도';
})();
