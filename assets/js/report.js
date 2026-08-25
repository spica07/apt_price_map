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

  document.title = '데이터 리포트 (' + (META.generatedAt || '') + ') — 서울 아파트 실거래가 지도';
})();
