# apt_price_map 프론트엔드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `assets/js/data.js`(서울 아파트 8,810개 단지, 매매/전세/월세)를 지도에 표시하는 정적 PWA를 만든다. 상단 토글로 매매·전세·월세를 전환하고, 마커는 평당가(또는 평당 보증금) 분위수 색상으로 칠하며, 클릭하면 최근 거래 내역을 보여준다.

**Architecture:** 데이터가 이미 준비돼 있으므로(데이터 파이프라인 플랜에서 완성) 이 플랜은 순수 프론트엔드다. 단지 수(8,810)가 `library_map`(3,353)과 같은 자릿수라 `shelter_map`의 줌별 뷰포트 렌더러(63,042곳 대응)는 쓰지 않는다 — `library_map`/`museum_map`처럼 전체 마커를 한 번에 그리는 단순한 방식을 그대로 따른다. 그래서 `render.js`를 따로 두지 않고 `app.js` 하나에 데이터 로드·마커 렌더링·팝업·범례·모드 토글을 모두 담는다. `찜`·검색·목록/카드 뷰·모달 상세·"내 주변" 연동은 이번 범위에 넣지 않는다(지도 하나로 끝나는 화면).

**Tech Stack:** 정적 HTML/CSS/JS, Leaflet 1.9.4(CDN), PWA(manifest+service worker), 아이콘 생성은 Python(Pillow) — `py` 실행기 사용.

**Spec:** `docs/superpowers/specs/2026-08-25-apt-price-map-design.md` (지도 UI 섹션)

## Global Constraints

- 이모지 금지 — 아이콘은 인라인 SVG(`class="ico"`, `viewBox="0 0 24 24"`)만 쓴다.
- 독도는 `markDokdo()`로 항상 그린다(코드에는 무조건 넣고, 서울 전역이 보이는 초기 화면에서는 화면 밖이라 안 보이는 게 정상 — 축소해야 보인다).
- 브랜드 색(`--sign`)은 `#7A2E38`(짙은 와인/적갈색) — 기존 다있맵 형제 지도들의 `--sign` 값(`#2E7D5B #E2681C #A8232B #F5A700 #1F5136 #6B2D5C #6E3B1F #C2703D #6B7A29 #1D4E5A #0E7C86 #12457E`)과 겹치지 않는지 확인했다.
- 다크 모드는 넣지 않는다 — `museum_map`/`library_map`/`shelter_map` 모두 `color-scheme: light` 고정이고, 이 프로젝트도 같은 관례를 따른다(다크 테마를 쓰는 곳은 `observatory_map` 하나뿐이고 이유가 명시돼 있다).
- 데이터 필드명은 실제 `assets/js/data.js`를 확인해 확정했다 — `window.APT_COMPLEXES`는 객체 배열이고 각 원소는 `{gu, dong, name, lat, lng, sale, jeonse, wolse}`. `sale`은 `null` 또는 `{count, avgPricePerPyeong, latestPrice, latestDate, deals:[{date, price, area, floor}, ...]}` (최대 20건, 최신순). `jeonse`/`wolse`는 `null` 또는 `{count, avgDepositPerPyeong, latestDeposit, latestRent, latestDate, deals:[{date, deposit, rent, area, floor}, ...]}`. 가격류 필드는 전부 **만원 단위 정수**, `area`는 ㎡ 실수, `floor`는 정수, `date`는 `"YYYYMMDD"` 문자열. `window.DATA_META = {generatedAt, total}`.
- 파이썬 실행은 `python`이 아니라 `py`.
- 정적 파일이라 `py -m http.server`로 그대로 테스트한다.

---

## Task 1: PWA 스캐폴드 — `manifest.json` + 아이콘

**Files:**
- Create: `apt_price_map/manifest.json`
- Create: `apt_price_map/tools/make_icons.py`
- Generated (by Step 2): `apt_price_map/assets/icons/app-icon-192.png`, `app-icon-512.png`, `app-icon-apple-180.png`, `app-icon-maskable-512.png`

**Interfaces:**
- Produces: 4개 PNG 아이콘 파일(뒤 태스크의 `index.html`/`manifest.json`이 참조), 브랜드 색 `#7A2E38` 확정.

- [ ] **Step 1: `manifest.json` 작성**

`apt_price_map/manifest.json`:
```json
{
  "name": "서울 아파트 실거래가 지도",
  "short_name": "아파트 시세",
  "description": "서울시 아파트 매매·전세·월세 실거래가 지도 — 단지별 최근 거래가와 평당가. 서울 열린데이터광장 자료.",
  "lang": "ko",
  "dir": "ltr",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#F7F7F5",
  "theme_color": "#7A2E38",
  "categories": ["utilities", "lifestyle", "navigation"],
  "icons": [
    {
      "src": "assets/icons/app-icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "assets/icons/app-icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "assets/icons/app-icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

- [ ] **Step 2: 아이콘 생성 스크립트 작성**

`apt_price_map/tools/make_icons.py`:
```python
# -*- coding: utf-8 -*-
"""앱 아이콘 생성. 고층 아파트 건물 픽토그램(몸체 + 창문 격자)을 그린다.

다있맵 공통 규칙: 면색 위에 흰 픽토그램, 그림자 없음.
maskable 은 안전 영역(중앙 80%) 안에 픽토그램이 들어가도록 더 작게 그린다.
shelter_map/tools/make_icons.py 와 같은 패턴(슈퍼샘플링 후 축소).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")

ICONS = Path(__file__).resolve().parent.parent / "assets" / "icons"
SIGN = (122, 46, 56, 255)     # --sign #7A2E38
INK = (255, 255, 255, 255)
SS = 4                        # 슈퍼샘플링 배율


def draw_building(size, scale):
    """직사각형 몸체(흰색) + 3x5 창문 격자(면색으로 뚫어낸다)."""
    s = size * SS
    img = Image.new("RGBA", (s, s), SIGN)
    d = ImageDraw.Draw(img)

    cx, cy = s / 2, s / 2
    w = s * scale
    h = w * 1.35
    left, top = cx - w / 2, cy - h / 2
    right, bottom = cx + w / 2, cy + h / 2

    d.rectangle([left, top, right, bottom], fill=INK)

    cols, rows = 3, 5
    pad_x, pad_y = w * 0.14, h * 0.08
    gap = w * 0.09
    cell_w = (w - 2 * pad_x - (cols - 1) * gap) / cols
    cell_h = (h - 2 * pad_y - (rows - 1) * gap) / rows
    for r in range(rows):
        for c in range(cols):
            x0 = left + pad_x + c * (cell_w + gap)
            y0 = top + pad_y + r * (cell_h + gap)
            d.rectangle([x0, y0, x0 + cell_w, y0 + cell_h], fill=SIGN)

    return img.resize((size, size), Image.LANCZOS)


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    targets = [
        ("app-icon-192.png", 192, 0.56),
        ("app-icon-512.png", 512, 0.56),
        ("app-icon-apple-180.png", 180, 0.56),
        ("app-icon-maskable-512.png", 512, 0.42),
    ]
    for name, size, scale in targets:
        path = ICONS / name
        draw_building(size, scale).save(path, "PNG", optimize=True)
        print(f"저장: {path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 실행해 아이콘 생성 확인**

Run: `cd apt_price_map && py tools/make_icons.py`
Expected: 콘솔에 4개 저장 경로가 찍히고, `assets/icons/`에 4개 PNG 파일이 생긴다. 파일을 열어(또는 크기 확인) 192/512/180/512 픽셀인지 확인한다.

```bash
py -c "
from PIL import Image
from pathlib import Path
for name, expect in [('app-icon-192.png',192),('app-icon-512.png',512),('app-icon-apple-180.png',180),('app-icon-maskable-512.png',512)]:
    p = Path('apt_price_map/assets/icons')/name
    im = Image.open(p)
    assert im.size == (expect, expect), (name, im.size)
print('OK: 아이콘 4개 크기 확인')
"
```

- [ ] **Step 4: 커밋**

```bash
cd apt_price_map
git add manifest.json tools/make_icons.py assets/icons/
git commit -m "feat: PWA manifest·아이콘 생성 스크립트"
```

---

## Task 2: `assets/css/style.css`

**Files:**
- Create: `apt_price_map/assets/css/style.css`

**Interfaces:**
- Produces: CSS 커스텀 프로퍼티(`--sign`, `--price-1`..`--price-5` 등)와 클래스들. Task 3(`app.js`)이 `--price-N`을 `getComputedStyle`로 읽고, Task 4(`index.html`)/Task 5(`report.html`)가 이 파일을 링크한다.

- [ ] **Step 1: `style.css` 작성**

`apt_price_map/assets/css/style.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Do+Hyeon&family=IBM+Plex+Sans+KR:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');

/* ============================================================
   공공 안내 표지 체계 — 다있맵(daitmap) 지도 PWA 공용
   면색 1개가 앱을 구분하고, 나머지는 전부 조용하게 둔다.
   ============================================================ */

:root {
  --sign: #7A2E38;
  --sign-ink: #FFFFFF;
  --sign-wash: #F3E7E8;

  --bg: #F7F7F5;
  --panel: #FFFFFF;
  --ink: #1A1A18;
  --ink-muted: #5F5E58;
  --line: #DCDBD4;

  /* 가격 분위수 색상 — 평당가/평당보증금이 낮음(연함) -> 높음(진함).
     --sign 을 4단계(중상위)로 두고 앞뒤로 밝기를 벌린다.
     app.js 는 이 다섯 값을 --price-1..5 순서로 읽어 그대로 쓴다. */
  --price-1: #F3D9DC;
  --price-2: #D9A3AA;
  --price-3: #B56672;
  --price-4: #7A2E38;
  --price-5: #4A1620;

  --fs-xxl: 2.19rem;
  --fs-xl:  1.75rem;
  --fs-l:   1.40rem;
  --fs-m:   1.12rem;
  --fs-base: 1rem;
  --fs-s:   0.80rem;

  --tap: 44px;
  --radius-panel: 12px;
  --radius-card: 10px;

  accent-color: var(--sign);
  caret-color: var(--sign);
  scrollbar-color: var(--line) transparent;
  color-scheme: light;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'IBM Plex Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--ink);
  min-height: 100vh;
  -webkit-text-size-adjust: 100%;
}

::selection { background: var(--sign); color: var(--sign-ink); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }
::-webkit-scrollbar-track { background: transparent; }

:where(a, button, input, select, [tabindex]):focus-visible {
  outline: 2px solid var(--sign);
  outline-offset: 2px;
  border-radius: 4px;
}

.num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

/* ---------- 헤더: 표지판 ---------- */
.app-header { padding: max(12px, env(safe-area-inset-top)) 12px 0; }

.header-inner {
  position: relative;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 8px 12px;
  background: var(--sign);
  color: var(--sign-ink);
  border-radius: var(--radius-panel);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .9);
}

.sign-mark { flex: 0 0 auto; width: 26px; height: 26px; fill: currentColor; }
.sign-text { flex: 1; min-width: 0; }
.app-title {
  font-family: 'Do Hyeon', 'IBM Plex Sans KR', sans-serif;
  font-size: var(--fs-l);
  font-weight: 400;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--sign-ink);
  word-break: keep-all;
  text-wrap: balance;
}
.sign-count { flex: 0 0 auto; display: flex; align-items: baseline; gap: 2px; color: var(--sign-ink); }
.sign-count .num { font-size: var(--fs-l); }
.sign-count .unit { font-size: var(--fs-s); opacity: .8; }

.app-notice {
  max-width: 1200px;
  margin: 8px auto 0;
  padding: 0 4px;
  font-size: var(--fs-s);
  line-height: 1.45;
  color: var(--ink-muted);
}

.report-btn {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  min-height: var(--tap);
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  font-size: var(--fs-s);
  text-decoration: none;
  color: var(--sign-ink);
  border: 1px solid rgba(255, 255, 255, .5);
  border-radius: 8px;
}

/* ---------- 레이아웃 ---------- */
.container { max-width: 1200px; margin: 0 auto; padding: 12px 12px max(32px, env(safe-area-inset-bottom)); }
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  padding: 12px;
  margin-bottom: 12px;
}

/* ---------- 모드 토글 (매매/전세/월세) ---------- */
.mode-bar { position: sticky; top: 8px; z-index: 900; }
.mode-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ico {
  width: 20px; height: 20px;
  fill: none; stroke: currentColor; stroke-width: 1.8;
  stroke-linecap: round; stroke-linejoin: round;
  pointer-events: none;
}
.mode-toggle { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; background: var(--panel); }
.mode-toggle .pill { border: none; border-radius: 0; }
.mode-toggle .pill + .pill { box-shadow: inset 1px 0 0 var(--line); }
.pill {
  min-height: var(--tap);
  display: inline-flex;
  align-items: center;
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel);
  font-family: inherit;
  font-size: var(--fs-base);
  color: var(--ink);
  cursor: pointer;
}
.pill.active { background: var(--sign); border-color: var(--sign); color: var(--sign-ink); }
.mode-count { margin-left: auto; font-size: var(--fs-s); color: var(--ink-muted); }

/* ---------- 지도 ---------- */
.map-pane { position: relative; border: 1px solid var(--line); border-radius: var(--radius-panel); overflow: hidden; background: var(--panel); }
#map { height: calc(100dvh - 190px); min-height: 420px; }

.map-legend {
  position: absolute;
  bottom: 10px;
  left: 10px;
  z-index: 800;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  max-width: calc(100% - 20px);
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, .94);
  font-size: var(--fs-s);
  color: var(--ink);
}
.legend-scale { display: flex; align-items: center; gap: 2px; }
.legend-dot {
  display: inline-block;
  width: 14px; height: 14px;
  border: 1.5px solid #fff;
  outline: 1px solid rgba(0, 0, 0, .18);
}
.legend-lbl { color: var(--ink-muted); }

/* Leaflet 팝업 */
.leaflet-popup-content-wrapper { border-radius: var(--radius-card); font-family: 'IBM Plex Sans KR', sans-serif; }
.popup-name { font-size: var(--fs-m); font-weight: 600; color: var(--ink); margin-bottom: 2px; }
.popup-meta { font-size: var(--fs-s); color: var(--ink-muted); margin-bottom: 8px; }
.popup-stat { font-size: var(--fs-base); color: var(--ink); margin-bottom: 6px; }
.popup-stat b { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.popup-deals { list-style: none; font-size: var(--fs-s); color: var(--ink-muted); max-height: 140px; overflow-y: auto; }
.popup-deals li { padding: 3px 0; border-top: 1px solid var(--line); }
.popup-deals li:first-child { border-top: none; }
.popup-more { margin-top: 6px; font-size: var(--fs-s); color: var(--ink-muted); }

/* ---------- 독도 ---------- */
.dokdo-label {
  background: transparent; border: none; box-shadow: none; padding: 0;
  color: #2f2e2b; font-size: 11.5px; font-weight: 700; white-space: nowrap;
  text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff;
}
.dokdo-label.leaflet-tooltip-right::before,
.dokdo-label.leaflet-tooltip-left::before { display: none; }

/* ---------- 푸터 ---------- */
.app-footer { margin-top: 20px; font-size: var(--fs-s); line-height: 1.6; color: var(--ink-muted); }
.site-notice {
  max-width: 1200px; margin: 0 auto;
  padding: 14px 12px max(24px, env(safe-area-inset-bottom));
  font-size: var(--fs-s); line-height: 1.6; color: var(--ink-muted);
}

/* ============================================================
   ≥640px
   ============================================================ */
@media (min-width: 640px) {
  .app-header { padding-left: 16px; padding-right: 16px; }
  .container { padding-left: 16px; padding-right: 16px; }
  .header-inner { min-height: 64px; padding: 10px 16px; gap: 14px; }
  .sign-mark { width: 32px; height: 32px; }
  .app-title { font-size: var(--fs-xl); }
  .sign-count .num { font-size: var(--fs-xl); }
  .panel { padding: 14px; }
  #map { height: calc(100dvh - 210px); }
}

@media (hover: hover) {
  .pill:not(.active):hover { border-color: var(--sign); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}

/* ---------- 리포트 페이지 ---------- */
.report-h {
  font-family: 'Do Hyeon', 'IBM Plex Sans KR', sans-serif;
  font-size: var(--fs-m);
  font-weight: 400;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.stat-tile { padding: 12px; border: 1px solid var(--line); border-radius: 8px; }
.stat-tile .num { display: block; font-size: var(--fs-l); color: var(--sign); }
.stat-tile .lbl { font-size: var(--fs-s); color: var(--ink-muted); }
.table-wrap { overflow-x: auto; }
.report-table { width: 100%; border-collapse: collapse; font-size: var(--fs-base); font-variant-numeric: tabular-nums; }
.report-table th { padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--ink-muted); font-weight: 500; text-align: left; }
.report-table td { padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--ink); }
.report-table td:not(:first-child), .report-table th:not(:first-child) { text-align: right; }
.report-table tr:hover td { background: var(--sign-wash); }
```

- [ ] **Step 2: 커밋**

```bash
cd apt_price_map
git add assets/css/style.css
git commit -m "feat: 프론트엔드 스타일시트 style.css"
```

---

## Task 3: `assets/js/app.js`

**Files:**
- Create: `apt_price_map/assets/js/app.js`

**Interfaces:**
- Consumes: `window.APT_COMPLEXES`, `window.DATA_META`(이미 존재하는 `assets/js/data.js`, 데이터 파이프라인 플랜 산출물)
- Produces: 지도 렌더링, 모드 토글, 범례, 독도 마커, PWA service worker 등록. Task 4(`index.html`)가 이 파일의 DOM id들(`#map`, `#mapLegend`, `#modeToggle`, `#modeCount`, `#totalCount`, `#genDate`)을 제공해야 한다.

- [ ] **Step 1: `app.js` 작성**

`apt_price_map/assets/js/app.js`:
```js
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
```

- [ ] **Step 2: 커밋**

```bash
cd apt_price_map
git add assets/js/app.js
git commit -m "feat: 지도 앱 로직 app.js — 모드 토글·분위수 색상·팝업"
```

---

## Task 4: `index.html`

**Files:**
- Create: `apt_price_map/index.html`

**Interfaces:**
- Consumes: Task 1의 `manifest.json`/아이콘, Task 2의 `assets/css/style.css`, Task 3의 `assets/js/app.js`, 기존 `assets/js/data.js`.
- Produces: `#map`, `#mapLegend`, `#modeToggle`, `#modeCount`, `#totalCount` DOM 요소(Task 3의 `app.js`가 정확히 이 id들을 참조한다) — id가 하나라도 다르면 런타임에서 조용히 아무것도 안 그려진다.

- [ ] **Step 1: `index.html` 작성**

`apt_price_map/index.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.tile.openstreetmap.org https://unpkg.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">
<title>서울 아파트 실거래가 지도</title>
<meta name="description" content="서울시 아파트 매매·전세·월세 실거래가 지도 — 단지별 최근 거래가와 평당가. 서울 열린데이터광장 자료.">
<meta name="theme-color" content="#7A2E38">
<link rel="manifest" href="manifest.json">
<link rel="icon" type="image/png" sizes="512x512" href="assets/icons/app-icon-512.png">
<link rel="apple-touch-icon" sizes="180x180" href="assets/icons/app-icon-apple-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="아파트 시세">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<header class="app-header">
  <div class="header-inner">
    <svg class="sign-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="3" width="14" height="18"/>
      <rect x="7.3" y="5.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="10.7" y="5.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="14.1" y="5.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="7.3" y="9.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="10.7" y="9.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="14.1" y="9.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="7.3" y="13.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="14.1" y="13.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="10.2" y="15" width="3.6" height="6" fill="var(--sign)"/>
    </svg>
    <div class="sign-text">
      <h1 class="app-title">서울 아파트 실거래가</h1>
    </div>
    <p class="sign-count"><span class="num" id="totalCount"></span><span class="unit">단지</span></p>
  </div>
  <p class="app-notice">서울 열린데이터광장 2025~2026년 아파트 매매·전월세 자료를 단지 단위로 모았습니다. 참고용이며 실제 거래는 등기·중개업소를 통해 확인하세요.</p>
</header>

<main class="container">

  <section class="panel mode-bar">
    <div class="mode-row">
      <div class="mode-toggle" id="modeToggle"></div>
      <span class="mode-count" id="modeCount"></span>
    </div>
  </section>

  <section class="map-pane">
    <div id="map"></div>
    <div class="map-legend" id="mapLegend"></div>
  </section>

  <footer class="app-footer">
    <p>자료: 서울 열린데이터광장 「부동산 실거래가 정보」·「부동산 전월세가 정보」 (생성일 <span id="genDate"></span>) · 실제 시세와 다를 수 있습니다.</p>
  </footer>
</main>

<div class="site-notice" role="note">
  © 2026 서울 아파트 실거래가 지도 · 무단 복제를 금합니다. 본 사이트는 정보 공유 목적으로 제공됩니다.
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script src="assets/js/data.js"></script>
<script src="assets/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 브라우저로 확인**

Run: `cd apt_price_map && py -m http.server 8000` 후 `http://localhost:8000`을 연다.

Expected:
- 헤더에 "서울 아파트 실거래가"와 총 단지 수(8,810)가 보인다.
- 매매/전세/월세 세 버튼이 보이고, 기본으로 "매매"가 활성화돼 있다.
- 지도에 마커가 여러 개 찍히고, 확대해서 하나를 클릭하면 팝업에 단지명·구/동·최근 거래가·평당가·최근 거래 목록이 나온다.
- 전세/월세 버튼을 누르면 마커 색과 개수가 바뀐다(매매 6,420 / 전세 6,888 / 월세 6,855 근처 숫자).
- 지도를 서울 밖으로 축소하면 독도가 보인다.
- 브라우저 개발자도구 콘솔에 에러가 없는지 확인한다.
- 푸터에 생성일(`2026-08-25`)이 보인다(`#genDate`는 Task 3의 `app.js`가 이미 채운다).

- [ ] **Step 3: 커밋**

```bash
cd apt_price_map
git add index.html
git commit -m "feat: index.html — 지도 페이지 골격"
```

---

## Task 5: `report.html` + `assets/js/report.js`

**Files:**
- Create: `apt_price_map/report.html`
- Create: `apt_price_map/assets/js/report.js`

**Interfaces:**
- Consumes: `window.APT_COMPLEXES`, `window.DATA_META` (`assets/js/data.js`)
- Produces: 숨겨진 요약 통계 페이지. 기본 내비게이션에는 링크를 두지 않는다(다른 다있맵 지도들의 "리포트 버튼 기본 숨김" 관례).

- [ ] **Step 1: `report.html` 작성**

`apt_price_map/report.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">
<title>데이터 리포트 — 서울 아파트 실거래가 지도</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#7A2E38">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<header class="app-header">
  <div class="header-inner">
    <svg class="sign-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="3" width="14" height="18"/>
      <rect x="7.3" y="5.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="10.7" y="5.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="14.1" y="5.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="7.3" y="9.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="10.7" y="9.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="14.1" y="9.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="7.3" y="13.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="14.1" y="13.3" width="2.6" height="2.6" fill="var(--sign)"/>
      <rect x="10.2" y="15" width="3.6" height="6" fill="var(--sign)"/>
    </svg>
    <div class="sign-text"><h1 class="app-title">데이터 리포트</h1></div>
    <a class="report-btn" href="index.html">지도로</a>
  </div>
  <p class="app-notice">단지 수·자치구 분포·모드별 보유 현황을 기록합니다.</p>
</header>

<main class="container">
  <section class="panel">
    <h2 class="report-h">요약</h2>
    <div class="stat-tiles" id="statTiles"></div>
  </section>

  <section class="panel">
    <h2 class="report-h">자치구별 단지 수</h2>
    <div class="table-wrap"><table class="report-table" id="guTable"></table></div>
  </section>
</main>

<script src="assets/js/data.js"></script>
<script src="assets/js/report.js"></script>
</body>
</html>
```

- [ ] **Step 2: `report.js` 작성**

`apt_price_map/assets/js/report.js`:
```js
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
```

- [ ] **Step 3: 브라우저로 확인**

`http://localhost:8000/report.html`을 연다. 요약 타일 4개(총 단지 8,810, 매매/전세/월세 각 건수)와 자치구 25개가 단지 수 내림차순으로 표로 보이는지 확인한다.

- [ ] **Step 4: 커밋**

```bash
cd apt_price_map
git add report.html assets/js/report.js
git commit -m "feat: report.html — 요약 통계 리포트 페이지"
```

---

## Task 6: `sw.js` — 서비스 워커

**Files:**
- Create: `apt_price_map/sw.js`

**Interfaces:**
- Consumes: Task 1~5가 만든 실제 파일 목록(`CORE_ASSETS`에 정확히 나열해야 한다 — 하나라도 실제로 없는 경로면 `cache.addAll`이 전체 실패해 설치가 무산된다).

- [ ] **Step 1: `sw.js` 작성**

`apt_price_map/sw.js`:
```js
/*
 * 서울 아파트 실거래가 지도 - 서비스 워커
 *
 * 전략: stale-while-revalidate — 캐시가 있으면 즉시 보여주고 백그라운드로 갱신,
 * 없으면 네트워크로 받아 캐시에 저장. 오프라인이면 캐시로, 페이지 이동은 index.html로 폴백.
 *
 * 콘텐츠를 크게 바꾸면 CACHE 버전 숫자를 올려서 옛 캐시를 비운다.
 */
const CACHE = 'apt-price-map-cache-v1';

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
```

- [ ] **Step 2: 실제 파일 목록과 대조**

`CORE_ASSETS`에 적은 9개 경로가 실제로 전부 존재하는지 확인한다:
```bash
cd apt_price_map
for f in index.html report.html manifest.json assets/css/style.css assets/js/app.js assets/js/report.js assets/icons/app-icon-192.png assets/icons/app-icon-512.png assets/icons/app-icon-apple-180.png assets/icons/app-icon-maskable-512.png; do
  test -f "$f" && echo "OK: $f" || echo "MISSING: $f"
done
```
Expected: 전부 `OK`. `MISSING`이 있으면 `sw.js`의 `CORE_ASSETS` 목록 또는 해당 파일 자체를 고친다.

- [ ] **Step 3: 브라우저에서 오프라인 동작 확인**

`http://localhost:8000`을 한 번 로드한 뒤(서비스 워커 설치), 개발자도구 Network 탭에서 "Offline"을 켜고 새로고침한다. 페이지가 캐시에서 뜨는지 확인한다(단, `data.js`는 캐시되지 않으므로 지도 위 마커는 안 뜰 수 있다 — 이는 의도된 동작이다).

- [ ] **Step 4: 커밋**

```bash
cd apt_price_map
git add sw.js
git commit -m "feat: 서비스 워커 sw.js — stale-while-revalidate"
```

---

## Task 7: `README.md`

**Files:**
- Create: `apt_price_map/README.md`

**Interfaces:**
- 문서만 생성한다. 데이터 파이프라인 플랜의 최종 리뷰가 "README에 실행 순서가 없다"고 지적했던 문서 공백을 여기서 메운다.

- [ ] **Step 1: `README.md` 작성**

`apt_price_map/README.md`:
```markdown
# 서울 아파트 실거래가 지도

서울시 아파트 매매·전세·월세 실거래가(2025~2026년, 서울 열린데이터광장)를
단지 단위로 모아 지도에 표시하는 PWA입니다.

## 담긴 것

- 서울 아파트 8,810개 단지, 25개 자치구 전체
- 매매 6,420 / 전세 6,888 / 월세 6,855개 단지에 거래 데이터 보유
- 단지 클릭 시 최근 거래(최대 20건, 최신순) 확인
- 평당가(전세·월세는 평당 보증금) 분위수 기준 마커 색상

## 실행

정적 파일이라 아무 웹서버로나 열면 됩니다.

```bash
py -m http.server 8000
# http://localhost:8000
```

## 데이터 갱신

원자료 수집부터 지도 데이터 생성까지, **반드시 이 순서로** 실행합니다.
순서를 건너뛰면(특히 `geocode.py`) 새로 생긴 단지가 좌표가 없어 조용히
지도에서 빠집니다.

```bash
py tools/fetch_sale.py      # 매매 실거래가 (서울 열린데이터광장 SEOUL_OPENDATA_KEY)
py tools/fetch_rent.py      # 전월세 실거래가 (같은 키, 훨씬 오래 걸림 — 585,601건 기준 약 1시간)
py tools/geocode.py         # 단지 좌표 (카카오 KAKAO_REST_KEY, 캐시로 재실행 시 새 단지만 조회)
py tools/build_data.py      # -> assets/js/data.js
py tools/make_icons.py      # 아이콘을 다시 만들 때만 (브랜드 색을 바꾼 경우 등)
```

인증키는 `.env`에 둡니다 (`.env.example` 참고):
- `SEOUL_OPENDATA_KEY` — 서울 열린데이터광장(data.seoul.go.kr) 계정당 발급되는 일반 인증키
- `KAKAO_REST_KEY` — 카카오 로컬 API (다른 다있맵 지도와 같은 키를 재사용해도 됩니다)

### 지오코딩 실패 단지

`geocode.py` 실행 시 콘솔에 성공/실패 건수가 찍힙니다. 실패한 지번은
`tools/geocode_cache.json`에서 값이 `null`인 항목으로 남아 있어,
아래처럼 뽑아볼 수 있습니다.

```bash
py -c "
import json
cache = json.load(open('tools/geocode_cache.json', encoding='utf-8'))
for k, v in cache.items():
    if v is None:
        print(k)
"
```

재개발·재건축으로 지번이 통합·변경된 경우가 많아, 실패한 지번은 수동으로
최신 주소를 확인해 `geocode_cache.json`에 좌표를 직접 채워 넣고
`build_data.py`를 다시 돌리는 방법으로 보정할 수 있습니다.
```

- [ ] **Step 2: 커밋**

```bash
cd apt_price_map
git add README.md
git commit -m "docs: README — 실행 순서와 데이터 갱신 절차"
```

---

## Self-Review 메모

- **스펙 커버리지**: 매매/전세/월세 토글(Task 3·4), 단지 단위 마커+팝업(Task 3), 평당가 색상 척도(Task 3), 독도 표시(Task 3), 이모지 금지·인라인 SVG(전체), report.html 기본 숨김(Task 5) — 스펙의 "지도 UI" 섹션 항목을 전부 태스크에 배치했다. "내 주변"(`geo.js`)은 스펙에서도 "선택 사항, 나중에 추가"로 명시했으므로 이번 범위에서 뺀 것이 스펙과 일치한다.
- **플레이스홀더 스캔**: 전 태스크의 코드 블록에 TBD/TODO 없음.
- **태스크 간 파일 중복 수정 정리**: 초안에서는 `#genDate` 채우기가 Task 4에서 Task 3이 이미 커밋한 `app.js`를 다시 여는 구조였다 — Task 3의 `app.js` 코드에 처음부터 포함시키도록 고쳐, 각 태스크가 자기 파일만 커밋하게 정리했다.
- **인터페이스 일관성**: `app.js`가 참조하는 DOM id(`#map #mapLegend #modeToggle #modeCount #totalCount #genDate`)가 Task 4의 `index.html`에 전부 존재하는지 대조 완료. `--price-1`..`--price-5`는 Task 2(CSS)에서 정의하고 Task 3(`app.js`)의 `PRICE_COLORS`가 정확히 그 이름으로 읽는다. `sw.js`의 `CORE_ASSETS` 목록은 Task 1·2·3·5가 만드는 실제 파일 경로와 1:1로 맞춰뒀고, Task 6 Step 2에서 실제로 존재하는지 재확인하는 절차를 넣었다.
- **데이터 필드명**: 실제 `assets/js/data.js`를 읽어 `avgPricePerPyeong`/`avgDepositPerPyeong`/`latestPrice`/`latestDeposit`/`latestRent`/`deals[].price`/`deals[].deposit`/`deals[].rent`/`deals[].area`/`deals[].floor` 필드명을 확인했고, 원래 설계 문서와 드리프트 없음을 확인했다.
