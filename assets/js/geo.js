/* 현재 위치 기준 "내 주변" — 다있맵 지도 PWA 공용.
   render.js 와 같은 규칙이다: 한쪽을 고치면 다른 앱에도 같은 파일을 옮기고,
   각 앱의 sw.js 캐시 버전을 함께 올린다.

   권한 팝업은 브라우저가 띄운다. 앱이 대신 그릴 수도, 미리 요청할 수도 없다.
   그래서 페이지 로드가 아니라 버튼을 누른 순간에만 요청한다 — 뜬금없이 뜬
   팝업은 대개 거부로 이어지고, 한 번 거부되면 그 다음부터는 팝업조차 뜨지
   않아 되돌릴 방법이 앱 쪽에 남지 않는다.

   좌표는 저장하지 않는다. 위치는 금방 낡고, 다음 방문에 엉뚱한 동네가
   복원되는 것보다 그때 다시 묻는 편이 정직하다.

   앱이 알려줘야 하는 것은 좌표를 꺼내는 방법(latLngOf)과, 결과가 바뀌었을 때
   다시 그리는 방법(onChange)뿐이다. 목록의 원소가 무엇인지는 묻지 않는다 —
   행 번호든 객체든 Map 의 키로 쓴다.
*/
window.createNearby = function (opts) {
  'use strict';

  var map = opts.map || null;
  var button = opts.button;
  var label = opts.label || button;
  var noticeEl = opts.notice || null;
  var latLngOf = opts.latLngOf;
  var onChange = opts.onChange || function () {};
  var onClear = opts.onClear || function () {};
  var unit = opts.unitLabel || '곳';

  var LIMIT = opts.limit || 100;     // 가까운 순으로 이만큼만 남긴다
  var FAR_KM = opts.farKm || 100;    // 가장 가까운 곳이 이보다 멀면 국내가 아니다
  var ZOOM = opts.zoom || 14;
  var DEG_KM = 111.32;

  var on = false;
  var myPos = null;                  // {lat, lng, accuracy} — 페이지가 사는 동안만
  var dist = new Map();              // 목록 원소 -> km. 내 주변일 때만 채워진다
  var nearestKm = Infinity;
  var meLayer = map ? L.layerGroup().addTo(map) : null;

  function setNotice(msg) {
    if (!noticeEl) return;
    noticeEl.textContent = msg || '';
    noticeEl.hidden = !msg;
  }

  function syncButton(busy) {
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
    button.disabled = !!busy;
    label.textContent = busy ? '위치 확인 중' : '내 주변';
  }

  /* 홈 화면에 설치된 창에는 주소창이 없다. 자물쇠를 누르라는 안내가 가리킬
     UI 자체가 없으므로 복구 경로를 다르게 알려준다. iOS 설치본은 Safari 와
     권한 컨텍스트가 아예 분리돼 있어 시스템 설정으로 가야 한다. */
  function installedApp() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  /* ---------- 내 위치 마커 ----------
     시설 마커가 아니므로 종류 색을 쓰지 않는다. 흰 채움에 어두운 테두리인
     독도와 정반대로 두어 어느 마커와도 헷갈리지 않게 한다. */
  function drawMe() {
    if (!meLayer) return;
    meLayer.clearLayers();
    if (!myPos) return;
    var ink = (getComputedStyle(document.documentElement)
      .getPropertyValue('--ink') || '').trim() || '#1A1A18';
    /* 정확도가 킬로미터로 잡히는 기기(IP 추정으로 떨어지는 데스크톱)에서는
       정확도 원이 화면을 덮는다. 믿을 만할 때만 그린다. */
    if (myPos.accuracy && myPos.accuracy <= 1000) {
      L.circle([myPos.lat, myPos.lng], {
        radius: myPos.accuracy, color: ink, weight: 1, opacity: .25,
        fillColor: ink, fillOpacity: .07
      }).addTo(meLayer);
    }
    L.circleMarker([myPos.lat, myPos.lng], {
      radius: 8, color: '#ffffff', weight: 3, fillColor: ink, fillOpacity: 1
    }).addTo(meLayer).bindTooltip('내 위치', { direction: 'top', offset: [0, -8] });
  }

  /* ---------- 거리 ----------
     하버사인을 돌릴 이유가 없다. 필요한 건 순서와 대략의 거리뿐이다.
     기준점 위도의 코사인으로 경도 축을 한 번 줄여 두면 각 원소는 뺄셈·곱셈
     으로 끝난다. 한국 범위·100km 안에서 오차가 0.1% 미만이라 화면에 적는
     km 에도 그대로 쓴다. 6만 행도 5ms 안쪽이다. */
  function sort(list) {
    if (!on || !myPos) { dist.clear(); return list; }
    var kx = Math.cos(myPos.lat * Math.PI / 180);
    var pairs = [];
    for (var i = 0; i < list.length; i++) {
      var p = latLngOf(list[i]);
      /* 좌표가 없는 항목(주소 미상, 온라인 전용 등)은 거리를 알 수 없다.
         뒤로 밀지 않고 아예 뺀다 — "가까운 곳"을 물었는데 어딘지 모르는 곳이
         섞여 나오면 목록을 신뢰할 수 없다. */
      if (!p || p[0] == null || p[1] == null) continue;
      var dx = (p[1] - myPos.lng) * kx;
      var dy = p[0] - myPos.lat;
      pairs.push([list[i], dx * dx + dy * dy]);   // 정렬에는 제곱이면 충분하다
    }
    pairs.sort(function (a, b) { return a[1] - b[1]; });

    dist.clear();
    var out = [];
    var n = Math.min(pairs.length, LIMIT);
    for (var j = 0; j < n; j++) {
      out.push(pairs[j][0]);
      dist.set(pairs[j][0], Math.sqrt(pairs[j][1]) * DEG_KM);
    }
    nearestKm = n ? dist.get(out[0]) : Infinity;
    return out;
  }

  /* 근사 계산이라 한 자리 미터까지 적으면 없는 정밀도를 있는 척하게 된다 */
  function text(item) {
    var km = dist.get(item);
    if (km == null) return '';
    if (km < 1) return Math.round(km * 100) * 10 + 'm';
    return (km < 10 ? km.toFixed(1) : Math.round(km)) + 'km';
  }

  function tag(item) {
    var t = text(item);
    return t ? '<span class="tag dist">' + t + '</span>' : '';
  }

  function off(msg) {
    if (on) {
      on = false;
      myPos = null;
      dist.clear();
      nearestKm = Infinity;
      drawMe();
      syncButton(false);
    }
    setNotice(msg || '');
  }

  function onPositionError(err) {
    syncButton(false);
    if (err && err.code === 1) {   // PERMISSION_DENIED
      setNotice(installedApp()
        ? '위치 권한이 꺼져 있어요. 휴대폰 설정에서 이 앱의 위치 권한을 허용해 주세요.'
        : '위치 권한이 꺼져 있어요. 주소창의 자물쇠를 눌러 위치를 허용해 주세요.');
      return;
    }
    setNotice('위치를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }

  function onPosition(pos) {
    myPos = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy
    };
    on = true;
    onClear();          /* 내 주변은 지역 필터를 대신한다 */
    syncButton(false);
    onChange();         /* 앱이 다시 그리면서 sort 를 부른다 */

    if (!dist.size) {
      off('조건에 맞는 ' + unit + '이 없어요. 필터를 바꿔 보세요.');
      onChange();
      return;
    }
    if (nearestKm > FAR_KM) {
      off('근처에 ' + unit + '이 없어요. 국내에서 이용해 주세요.');
      onChange();
      return;
    }
    drawMe();
    setNotice('내 위치에서 가까운 순으로 보여드려요.');
    if (map) map.flyTo([myPos.lat, myPos.lng], ZOOM, { duration: 0.8 });
  }

  button.addEventListener('click', function () {
    if (on) { off(); onChange(); return; }
    /* file:// 이나 http:// 에서는 API 자체가 없거나 항상 실패한다 */
    if (!navigator.geolocation || !window.isSecureContext) {
      setNotice('이 브라우저에서는 위치 조회를 쓸 수 없어요.');
      return;
    }
    setNotice('');
    syncButton(true);
    navigator.geolocation.getCurrentPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    });
  });

  return {
    active: function () { return on; },
    /* 필터를 통과한 목록을 넘기면 가까운 순으로 잘라 돌려준다.
       내 주변이 꺼져 있으면 받은 그대로 돌려준다 — 앱은 분기할 필요가 없다. */
    sort: sort,
    text: text,     /* 상세 화면용 "320m" */
    tag: tag,       /* 카드용 <span class="tag dist"> */
    off: off,       /* 지역 필터를 고르는 등 앱이 모드를 접을 때 */
    limit: LIMIT
  };
};
