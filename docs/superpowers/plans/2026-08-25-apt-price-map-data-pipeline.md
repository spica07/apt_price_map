# apt_price_map 데이터 파이프라인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울 열린데이터광장의 아파트 매매·전월세 실거래가(2025~2026년, 아파트만)를 단지(지번) 단위로 집계해 `assets/js/data.js`를 생성하는 파이썬 파이프라인을 만든다.

**Architecture:** `tools/fetch_sale.py`와 `tools/fetch_rent.py`가 각각 원자료를 받아 아파트만 걸러 JSON으로 저장하고, `tools/geocode.py`가 유니크 지번을 카카오 로컬 API로 지오코딩해 캐시에 저장하며, `tools/build_data.py`가 셋을 모아 단지 단위로 집계한 `assets/js/data.js`를 만든다. 네 스크립트는 `tools/common.py`의 순수 함수(단지 키, 지번주소 포맷, 평당가 계산, 서울 열린데이터광장 페이지네이션)를 공유한다.

**Tech Stack:** Python 3 (`py` 실행기), `requests`(카카오 호출), `urllib.request`(서울 열린데이터광장 호출, 표준 라이브러리). 이 워크스페이스의 다른 지도 프로젝트들과 마찬가지로 pytest는 쓰지 않는다 — 각 테스트 파일은 `py tools/test_X.py`로 직접 실행하는 `assert` 기반 스크립트다.

**Spec:** `docs/superpowers/specs/2026-08-25-apt-price-map-design.md`

## Global Constraints

- 기간: RCPT_YR(접수연도) 기준 2025~2026년만 가져온다. (그 이전 데이터는 절대 가져오지 않는다.)
- 물건: `BLDG_USG == "아파트"`인 행만 남긴다. 연립다세대·오피스텔·단독다가구 등은 제외한다.
- 매매 데이터는 `RTRCN_DAY`(해제일자)가 있으면 취소된 거래이므로 제외한다.
- 단지 식별 키는 단지명 문자열이 아니라 `자치구|법정동|본번|부번`(지번)이다 — 단지명 표기가 시점마다 흔들릴 수 있기 때문이다.
- 인증키: 서울 열린데이터광장 `SEOUL_OPENDATA_KEY`, 카카오 `KAKAO_REST_KEY` — 모두 `apt_price_map/.env`에 둔다. `.env`는 절대 커밋하지 않는다.
- 파이썬 실행은 `python`이 아니라 `py`를 쓴다.
- 큰 원자료 산출물(`sale_raw.json`, `rent_raw.json`)은 `.gitignore`에 넣는다. 지오코딩 캐시(`geocode_cache.json`)는 재사용 가치가 있으니 커밋한다.

---

## Task 1: 공용 모듈 `common.py` — 단지 키, 지번주소, 평당가, 페이지네이션

**Files:**
- Create: `apt_price_map/.gitignore`
- Create: `apt_price_map/.env.example`
- Create: `apt_price_map/tools/common.py`
- Test: `apt_price_map/tools/test_common.py`

**Interfaces:**
- Produces:
  - `common.load_env_key(root: Path, var_name: str) -> str`
  - `common.parcel_key(row: dict) -> str` — `"{CGG_NM}|{STDG_NM}|{MNO}|{SNO}"`
  - `common.lot_address(row: dict) -> str` — `"서울특별시 {CGG_NM} {STDG_NM} {지번}"`
  - `common.price_per_pyeong(amount_10k_won: float, area_m2: float) -> float | None`
  - `common.fetch_seoul_dataset(key: str, service: str, year: str, keep_row: Callable[[dict], bool], per_page: int = 1000, sleep: float = 0.1, log: Callable[[str], None] = print) -> list[dict]`

- [ ] **Step 1: `.gitignore`와 `.env.example` 작성**

`apt_price_map/.gitignore`:
```
.env
__pycache__/
*.pyc
tools/sale_raw.json
tools/rent_raw.json
```

`apt_price_map/.env.example`:
```
# 서울 열린데이터광장 인증키 (data.seoul.go.kr, 계정당 하나, 모든 데이터셋 공통)
SEOUL_OPENDATA_KEY=

# 카카오 로컬 API 키 (다른 지도 프로젝트와 같은 키를 재사용해도 된다)
KAKAO_REST_KEY=
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apt_price_map/tools/test_common.py`:
```python
# -*- coding: utf-8 -*-
"""common.py 순수 함수 확인. pytest 없이 `py tools/test_common.py`로 직접 돌린다."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common


def test_parcel_key():
    row = {"CGG_NM": "노원구", "STDG_NM": "상계동", "MNO": "0173", "SNO": "0001"}
    assert common.parcel_key(row) == "노원구|상계동|0173|0001"


def test_lot_address_with_sno():
    row = {"CGG_NM": "은평구", "STDG_NM": "구산동", "MNO": "0355", "SNO": "0035"}
    assert common.lot_address(row) == "서울특별시 은평구 구산동 355-35"


def test_lot_address_without_sno():
    row = {"CGG_NM": "노원구", "STDG_NM": "상계동", "MNO": "0173", "SNO": "0000"}
    assert common.lot_address(row) == "서울특별시 노원구 상계동 173"


def test_price_per_pyeong():
    # 84.5㎡(약 25.57평) 55,000만원 → 평당 약 2,151만원
    result = common.price_per_pyeong(55000, 84.5)
    assert 2150 < result < 2152


def test_price_per_pyeong_zero_area_returns_none():
    assert common.price_per_pyeong(55000, 0) is None


def test_load_env_key():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / ".env").write_text("SEOUL_OPENDATA_KEY=abc123\nKAKAO_REST_KEY=xyz\n", encoding="utf-8")
        assert common.load_env_key(root, "SEOUL_OPENDATA_KEY") == "abc123"
        assert common.load_env_key(root, "KAKAO_REST_KEY") == "xyz"


if __name__ == "__main__":
    test_parcel_key()
    test_lot_address_with_sno()
    test_lot_address_without_sno()
    test_price_per_pyeong()
    test_price_per_pyeong_zero_area_returns_none()
    test_load_env_key()
    print("OK: common.py 6개 테스트 통과")
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `py apt_price_map/tools/test_common.py`
Expected: `ModuleNotFoundError: No module named 'common'` (common.py가 아직 없음)

- [ ] **Step 4: `common.py` 구현**

`apt_price_map/tools/common.py`:
```python
# -*- coding: utf-8 -*-
"""서울시 아파트 실거래가 파이프라인이 공유하는 함수.
fetch_sale.py / fetch_rent.py / geocode.py / build_data.py 가 모두 이 모듈로
단지를 식별하고 지번주소를 만들고 서울 열린데이터광장을 호출한다.
"""
import json
import time
import urllib.request


def load_env_key(root, var_name):
    for line in (root / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith(var_name + "="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError(f".env 에서 {var_name}를 찾을 수 없습니다.")


def parcel_key(row):
    """자치구+법정동+지번(본번-부번)으로 단지를 식별한다.
    단지명(BLDG_NM) 표기가 시점마다 흔들릴 수 있어 이름 대신 지번을 키로 쓴다."""
    return f"{row['CGG_NM']}|{row['STDG_NM']}|{row['MNO']}|{row['SNO']}"


def lot_address(row):
    """지오코딩에 넣을 지번주소. 부번이 0이면 본번만 쓴다."""
    mno = str(int(row["MNO"]))
    sno = str(int(row["SNO"]))
    lot = mno if sno == "0" else f"{mno}-{sno}"
    return f"서울특별시 {row['CGG_NM']} {row['STDG_NM']} {lot}"


def price_per_pyeong(amount_10k_won, area_m2):
    """만원 단위 금액과 ㎡ 면적으로 평(3.3058㎡)당 가격(만원)을 낸다."""
    pyeong = area_m2 / 3.3058
    if pyeong <= 0:
        return None
    return amount_10k_won / pyeong


def fetch_seoul_dataset(key, service, year, keep_row, per_page=1000, sleep=0.1, log=print):
    """서울 열린데이터광장 OpenAPI에서 RCPT_YR=year 인 행을 모두 받는다.
    keep_row(row) -> bool 을 만족하는 행만 남긴다(불필요한 행을 메모리에 쌓지 않으려 페이지마다 거른다).
    요청 URL: http://openapi.seoul.go.kr:8088/{key}/json/{service}/{start}/{end}/{year}
    """
    def call(start, end):
        url = f"http://openapi.seoul.go.kr:8088/{key}/json/{service}/{start}/{end}/{year}"
        with urllib.request.urlopen(url, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))[service]

    first = call(1, per_page)
    result = first["RESULT"]
    if result["CODE"] != "INFO-000":
        raise SystemExit(f"{year}년 {service} 요청 실패: {result['CODE']} {result['MESSAGE']}")
    total = int(first["list_total_count"])
    log(f"{year}년 {service}: 전체 {total:,}건")

    kept = [r for r in first.get("row", []) if keep_row(r)]
    fetched = len(first.get("row", []))
    start = per_page + 1
    while fetched < total:
        end = start + per_page - 1
        chunk = call(start, end).get("row", [])
        if not chunk:
            break
        kept.extend(r for r in chunk if keep_row(r))
        fetched += len(chunk)
        start += per_page
        if start % 10000 < per_page:
            log(f"  {fetched:,}/{total:,} 조회, {len(kept):,}건 누적")
        time.sleep(sleep)
    return kept
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `py apt_price_map/tools/test_common.py`
Expected: `OK: common.py 6개 테스트 통과`

- [ ] **Step 6: 커밋**

```bash
cd apt_price_map
git add .gitignore .env.example tools/common.py tools/test_common.py
git commit -m "feat: 공용 모듈 common.py — 단지 키·지번주소·평당가·페이지네이션"
```

---

## Task 2: `fetch_sale.py` — 매매 원자료 수집

**Files:**
- Create: `apt_price_map/tools/fetch_sale.py`

**Interfaces:**
- Consumes: `common.load_env_key`, `common.fetch_seoul_dataset` (Task 1)
- Produces: `apt_price_map/tools/sale_raw.json` — 아파트 매매(취소 제외) 행의 JSON 배열. 각 행은 서울 열린데이터광장 `tbLnOpendataRtmsV` 원본 필드(`CGG_NM`, `STDG_NM`, `MNO`, `SNO`, `BLDG_NM`, `CTRT_DAY`, `THING_AMT`, `ARCH_AREA`, `FLR` 등)를 그대로 갖는다. Task 5(build_data.py)가 이 파일을 읽는다.

이 스크립트는 실제 서울 열린데이터광장 인증키와 네트워크가 있어야 동작하므로, 이 워크스페이스의 다른 수집 스크립트들과 같은 방식으로 검증한다: 실행 후 콘솔에 찍히는 건수와 산출물을 사람이 확인한다(네트워크 모킹 테스트는 만들지 않는다).

- [ ] **Step 1: `fetch_sale.py` 작성**

`apt_price_map/tools/fetch_sale.py`:
```python
# -*- coding: utf-8 -*-
"""서울 열린데이터광장 부동산 실거래가(매매, tbLnOpendataRtmsV)를
2025~2026년만 가져와 아파트만 걸러 tools/sale_raw.json 으로 저장한다.

RCPT_YR(접수연도) 기준으로 연도를 나눈다 — 실제 계약일(CTRT_DAY)이 다른
해로 찍히는 행이 섞여 있어(신고 지연 등), "2025~2026년"은 접수연도 기준이다.
인증키는 ../.env 의 SEOUL_OPENDATA_KEY.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "sale_raw.json"
SERVICE = "tbLnOpendataRtmsV"
YEARS = ["2025", "2026"]


def is_apartment_sale(row):
    return row.get("BLDG_USG") == "아파트" and not row.get("RTRCN_DAY")


def main():
    key = common.load_env_key(ROOT, "SEOUL_OPENDATA_KEY")
    all_rows = []
    for year in YEARS:
        rows = common.fetch_seoul_dataset(key, SERVICE, year, is_apartment_sale)
        print(f"  {year}년 아파트 매매: {len(rows):,}건")
        all_rows.extend(rows)

    OUT.write_text(json.dumps(all_rows, ensure_ascii=False), encoding="utf-8")
    print(f"저장: {OUT} ({len(all_rows):,}건)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 실제 키로 실행해 검증**

`apt_price_map/.env`를 만들고 `SEOUL_OPENDATA_KEY`를 채운 뒤:

Run: `cd apt_price_map && py tools/fetch_sale.py`

Expected:
- 콘솔에 `2025년 tbLnOpendataRtmsV: 전체 N건`, `2026년 ...` 이 찍히고, 각 연도 뒤에 `아파트 매매: M건`이 찍힌다
- `tools/sale_raw.json`이 생성된다
- 아래 명령으로 모든 행의 `BLDG_USG`가 `"아파트"`인지, `RTRCN_DAY`가 모두 비어 있는지 확인:

```bash
py -c "
import json
rows = json.load(open('apt_price_map/tools/sale_raw.json', encoding='utf-8'))
assert all(r['BLDG_USG'] == '아파트' for r in rows)
assert all(not r.get('RTRCN_DAY') for r in rows)
assert all(r['RCPT_YR'] in ('2025', '2026') for r in rows)
print(f'OK: {len(rows):,}건, 모두 아파트/미해제/2025~2026년')
"
```

- [ ] **Step 3: 커밋**

```bash
cd apt_price_map
git add tools/fetch_sale.py
git commit -m "feat: 아파트 매매 실거래가 수집 스크립트 fetch_sale.py"
```

---

## Task 3: `fetch_rent.py` — 전월세 원자료 수집

**Files:**
- Create: `apt_price_map/tools/fetch_rent.py`

**Interfaces:**
- Consumes: `common.load_env_key`, `common.fetch_seoul_dataset` (Task 1)
- Produces: `apt_price_map/tools/rent_raw.json` — 아파트 전월세 행의 JSON 배열. 각 행은 `tbLnOpendataRentV` 원본 필드(`CGG_NM`, `STDG_NM`, `MNO`, `SNO`, `BLDG_NM`, `CTRT_DAY`, `RENT_SE`, `RENT_AREA`, `GRFE`, `RTFE`, `FLR` 등)를 그대로 갖는다. `RENT_SE`는 `"전세"` 또는 `"월세"`. Task 5가 이 파일을 읽는다.

- [ ] **Step 1: `fetch_rent.py` 작성**

`apt_price_map/tools/fetch_rent.py`:
```python
# -*- coding: utf-8 -*-
"""서울 열린데이터광장 부동산 전월세가(tbLnOpendataRentV)를
2025~2026년만 가져와 아파트만 걸러 tools/rent_raw.json 으로 저장한다.
fetch_sale.py 와 같은 접수연도(RCPT_YR) 기준 해석을 따른다.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "rent_raw.json"
SERVICE = "tbLnOpendataRentV"
YEARS = ["2025", "2026"]


def is_apartment_rent(row):
    return row.get("BLDG_USG") == "아파트"


def main():
    key = common.load_env_key(ROOT, "SEOUL_OPENDATA_KEY")
    all_rows = []
    for year in YEARS:
        rows = common.fetch_seoul_dataset(key, SERVICE, year, is_apartment_rent)
        jeonse = sum(1 for r in rows if r.get("RENT_SE") == "전세")
        wolse = sum(1 for r in rows if r.get("RENT_SE") == "월세")
        print(f"  {year}년 아파트 전월세: {len(rows):,}건 (전세 {jeonse:,} / 월세 {wolse:,})")
        all_rows.extend(rows)

    OUT.write_text(json.dumps(all_rows, ensure_ascii=False), encoding="utf-8")
    print(f"저장: {OUT} ({len(all_rows):,}건)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 실제 키로 실행해 검증**

Run: `cd apt_price_map && py tools/fetch_rent.py`

Expected:
- 연도별 전세/월세 건수가 콘솔에 찍힌다 (전체 데이터셋 기준 2025년만 백만 건 넘게 조회되므로 몇 분 걸릴 수 있다)
- `tools/rent_raw.json`이 생성된다

```bash
py -c "
import json
rows = json.load(open('apt_price_map/tools/rent_raw.json', encoding='utf-8'))
assert all(r['BLDG_USG'] == '아파트' for r in rows)
assert all(r['RENT_SE'] in ('전세', '월세') for r in rows)
assert all(r['RCPT_YR'] in ('2025', '2026') for r in rows)
print(f'OK: {len(rows):,}건, 모두 아파트/전세또는월세/2025~2026년')
"
```

- [ ] **Step 3: 커밋**

```bash
cd apt_price_map
git add tools/fetch_rent.py
git commit -m "feat: 아파트 전월세 실거래가 수집 스크립트 fetch_rent.py"
```

---

## Task 4: `geocode.py` — 단지 좌표 조회

**Files:**
- Create: `apt_price_map/tools/geocode.py`
- Test: `apt_price_map/tools/test_geocode.py`

**Interfaces:**
- Consumes: `common.load_env_key`, `common.parcel_key`, `common.lot_address` (Task 1); `sale_raw.json`, `rent_raw.json` (Task 2, 3)
- Produces:
  - `geocode.geocode_one(session, cache: dict, key: str, address: str) -> dict | None` — `{"lat": float, "lng": float}` 또는 실패 시 `None`. `cache`에 이미 있으면 세션을 쓰지 않는다.
  - `geocode.collect_parcels() -> dict[str, str]` — `{parcel_key: 지번주소}`
  - `apt_price_map/tools/geocode_cache.json` — `{parcel_key: {"lat":.., "lng":..} | null}`. Task 5가 이 파일을 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성 (네트워크는 가짜 세션으로 대체)**

`apt_price_map/tools/test_geocode.py`:
```python
# -*- coding: utf-8 -*-
"""geocode.py의 캐싱/응답 처리 로직을 네트워크 없이 확인한다."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geocode


class FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json = json_data or {}

    def raise_for_status(self):
        pass

    def json(self):
        return self._json


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0

    def get(self, url, params=None, timeout=None):
        self.calls += 1
        return self.responses.pop(0)


def test_geocode_one_hit():
    session = FakeSession([FakeResponse(200, {"documents": [{"y": "37.5", "x": "127.0"}]})])
    cache = {}
    result = geocode.geocode_one(session, cache, "k1", "서울특별시 노원구 상계동 173")
    assert result == {"lat": 37.5, "lng": 127.0}
    assert cache["k1"] == {"lat": 37.5, "lng": 127.0}
    assert session.calls == 1


def test_geocode_one_uses_cache():
    session = FakeSession([])  # 캐시가 있으면 세션을 아예 쓰지 않아야 한다
    cache = {"k1": {"lat": 1.0, "lng": 2.0}}
    result = geocode.geocode_one(session, cache, "k1", "아무 주소")
    assert result == {"lat": 1.0, "lng": 2.0}
    assert session.calls == 0


def test_geocode_one_no_result_caches_none():
    session = FakeSession([FakeResponse(200, {"documents": []})])
    cache = {}
    result = geocode.geocode_one(session, cache, "k2", "존재하지 않는 주소")
    assert result is None
    assert cache["k2"] is None


if __name__ == "__main__":
    test_geocode_one_hit()
    test_geocode_one_uses_cache()
    test_geocode_one_no_result_caches_none()
    print("OK: geocode.py 3개 테스트 통과")
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `py apt_price_map/tools/test_geocode.py`
Expected: `ModuleNotFoundError: No module named 'geocode'`

- [ ] **Step 3: `geocode.py` 구현**

`apt_price_map/tools/geocode.py`:
```python
# -*- coding: utf-8 -*-
"""sale_raw.json + rent_raw.json 에서 단지(지번) 목록을 유니크하게 뽑아
카카오 로컬 API로 좌표를 조회하고 tools/geocode_cache.json 에 저장한다.
캐시에 이미 있는 지번은 다시 조회하지 않는다.
인증키는 ../.env 의 KAKAO_REST_KEY (다른 지도 프로젝트와 같은 키를 재사용해도 된다).
"""
import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
CACHE_FILE = TOOLS / "geocode_cache.json"
KAKAO_ADDR_URL = "https://dapi.kakao.com/v2/local/search/address.json"


def collect_parcels():
    """sale_raw.json / rent_raw.json 에서 유니크한 (parcel_key -> 지번주소)를 모은다."""
    parcels = {}
    for name in ("sale_raw.json", "rent_raw.json"):
        path = TOOLS / name
        if not path.exists():
            continue
        rows = json.loads(path.read_text(encoding="utf-8"))
        for row in rows:
            key = common.parcel_key(row)
            if key not in parcels:
                parcels[key] = common.lot_address(row)
    return parcels


def geocode_one(session, cache, key, address):
    """캐시에 있으면 그대로 반환. 없으면 카카오 주소검색을 호출해 채운다.
    실패(결과 없음/에러)도 None으로 캐시해 재실행 때 다시 조회하지 않는다."""
    if key in cache:
        return cache[key]

    hit = None
    for attempt in range(3):
        try:
            r = session.get(KAKAO_ADDR_URL, params={"query": address}, timeout=15)
            if r.status_code == 429:
                time.sleep(1.0)
                continue
            r.raise_for_status()
            docs = r.json().get("documents", [])
            if docs:
                hit = {"lat": float(docs[0]["y"]), "lng": float(docs[0]["x"])}
            time.sleep(0.05)
            break
        except requests.RequestException as e:
            if attempt == 2:
                print(f"  ! 요청 실패: {address!r} ({e})")
                return None
            time.sleep(0.5)

    cache[key] = hit
    return hit


def main():
    kakao_key = common.load_env_key(ROOT, "KAKAO_REST_KEY")
    session = requests.Session()
    session.headers["Authorization"] = "KakaoAK " + kakao_key

    cache = json.loads(CACHE_FILE.read_text(encoding="utf-8")) if CACHE_FILE.exists() else {}
    parcels = collect_parcels()
    print(f"유니크 단지(지번): {len(parcels):,}개")

    found = failed = 0
    for i, (key, address) in enumerate(parcels.items(), 1):
        hit = geocode_one(session, cache, key, address)
        if hit:
            found += 1
        else:
            failed += 1
        if i % 200 == 0:
            CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            print(f"  [{i:,}/{len(parcels):,}] 성공 {found:,} / 실패 {failed:,}")

    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    print(f"완료: 성공 {found:,} / 실패 {failed:,} -> {CACHE_FILE}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `py apt_price_map/tools/test_geocode.py`
Expected: `OK: geocode.py 3개 테스트 통과`

- [ ] **Step 5: 실제 데이터로 실행해 검증**

`apt_price_map/.env`에 `KAKAO_REST_KEY`를 채운 뒤 (Task 2, 3에서 만든 `sale_raw.json`/`rent_raw.json`이 있어야 한다):

Run: `cd apt_price_map && py tools/geocode.py`

Expected:
- `유니크 단지(지번): N개` — 서울 아파트 단지 수와 비슷한 규모(수천 단위)여야 한다. 수만 개가 나오면 `parcel_key`가 지번이 아니라 거래 건 단위로 쪼개지고 있다는 뜻이니 원인을 확인한다.
- `tools/geocode_cache.json`이 생성되고, 성공/실패 건수가 출력된다.
- 실패율이 눈에 띄게 높으면(예: 30% 이상) 몇 개 실패 사례의 지번주소를 직접 카카오맵에서 검색해 주소 포맷 문제인지 확인한다.

- [ ] **Step 6: 커밋**

```bash
cd apt_price_map
git add tools/geocode.py tools/test_geocode.py tools/geocode_cache.json
git commit -m "feat: 단지 지오코딩 스크립트 geocode.py"
```

---

## Task 5: `build_data.py` — 단지 단위 집계 → `assets/js/data.js`

**Files:**
- Create: `apt_price_map/tools/build_data.py`
- Test: `apt_price_map/tools/test_build_data.py`

**Interfaces:**
- Consumes: `common.parcel_key`, `common.price_per_pyeong` (Task 1); `sale_raw.json`, `rent_raw.json` (Task 2, 3); `geocode_cache.json` (Task 4)
- Produces:
  - `build_data.aggregate_sale(rows: list[dict]) -> dict[str, dict]` — `parcel_key -> {"count", "avgPricePerPyeong", "latestPrice", "latestDate", "deals": [...]}`
  - `build_data.aggregate_rent(rows: list[dict], rent_se: str) -> dict[str, dict]` — `parcel_key -> {"count", "avgDepositPerPyeong", "latestDeposit", "latestRent", "latestDate", "deals": [...]}`
  - `build_data.collect_meta(*row_lists: list[dict]) -> dict[str, tuple[str, str, str]]` — `parcel_key -> (자치구, 법정동, 단지명)`
  - `build_data.build_complexes(sale_agg, jeonse_agg, wolse_agg, meta, geocode_cache) -> tuple[list[dict], int]` — `(단지 리스트, 좌표 없어 제외된 단지 수)`
  - `apt_price_map/assets/js/data.js` — `window.APT_COMPLEXES`(단지 배열)와 `window.DATA_META`. 이후 프론트엔드 플랜이 이 전역 변수를 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`apt_price_map/tools/test_build_data.py`:
```python
# -*- coding: utf-8 -*-
"""build_data.py의 집계 로직을 실제 API 응답 형태의 픽스처로 확인한다."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data


SALE_ROWS = [
    {"CGG_NM": "노원구", "STDG_NM": "상계동", "MNO": "0173", "SNO": "0001",
     "BLDG_NM": "벽산", "CTRT_DAY": "20260810", "THING_AMT": "55000",
     "ARCH_AREA": "59.9", "FLR": "5"},
    {"CGG_NM": "노원구", "STDG_NM": "상계동", "MNO": "0173", "SNO": "0001",
     "BLDG_NM": "벽산", "CTRT_DAY": "20260821", "THING_AMT": "57000",
     "ARCH_AREA": "59.9", "FLR": "8"},
]

RENT_ROWS = [
    {"CGG_NM": "서초구", "STDG_NM": "서초동", "MNO": "1682", "SNO": "0000",
     "BLDG_NM": "서초래미안", "CTRT_DAY": "20260717", "RENT_SE": "월세",
     "RENT_AREA": "127.66", "GRFE": "80000", "RTFE": "203"},
    {"CGG_NM": "강동구", "STDG_NM": "상일동", "MNO": "0521", "SNO": "0000",
     "BLDG_NM": "고덕자이", "CTRT_DAY": "20260629", "RENT_SE": "전세",
     "RENT_AREA": "59.939", "GRFE": "73000", "RTFE": "0"},
]


def test_aggregate_sale_groups_by_parcel_and_sorts_latest_first():
    result = build_data.aggregate_sale(SALE_ROWS)
    key = "노원구|상계동|0173|0001"
    assert result[key]["count"] == 2
    assert result[key]["latestDate"] == "20260821"
    assert result[key]["latestPrice"] == 57000.0
    assert len(result[key]["deals"]) == 2
    assert result[key]["deals"][0]["date"] == "20260821"


def test_aggregate_rent_splits_jeonse_and_wolse():
    jeonse = build_data.aggregate_rent(RENT_ROWS, "전세")
    wolse = build_data.aggregate_rent(RENT_ROWS, "월세")
    assert "강동구|상일동|0521|0000" in jeonse
    assert "강동구|상일동|0521|0000" not in wolse
    assert "서초구|서초동|1682|0000" in wolse
    assert wolse["서초구|서초동|1682|0000"]["latestRent"] == 203.0


def test_build_complexes_skips_missing_geocode():
    sale_agg = build_data.aggregate_sale(SALE_ROWS)
    meta = build_data.collect_meta(SALE_ROWS, [])
    complexes, skipped = build_data.build_complexes(sale_agg, {}, {}, meta, {})
    assert complexes == []
    assert skipped == 1


def test_build_complexes_includes_geocoded():
    sale_agg = build_data.aggregate_sale(SALE_ROWS)
    meta = build_data.collect_meta(SALE_ROWS, [])
    cache = {"노원구|상계동|0173|0001": {"lat": 37.66, "lng": 127.06}}
    complexes, skipped = build_data.build_complexes(sale_agg, {}, {}, meta, cache)
    assert skipped == 0
    assert complexes[0]["name"] == "벽산"
    assert complexes[0]["sale"]["count"] == 2
    assert complexes[0]["jeonse"] is None
    assert complexes[0]["wolse"] is None


if __name__ == "__main__":
    test_aggregate_sale_groups_by_parcel_and_sorts_latest_first()
    test_aggregate_rent_splits_jeonse_and_wolse()
    test_build_complexes_skips_missing_geocode()
    test_build_complexes_includes_geocoded()
    print("OK: build_data.py 4개 테스트 통과")
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `py apt_price_map/tools/test_build_data.py`
Expected: `ModuleNotFoundError: No module named 'build_data'`

- [ ] **Step 3: `build_data.py` 구현**

`apt_price_map/tools/build_data.py`:
```python
# -*- coding: utf-8 -*-
"""sale_raw.json + rent_raw.json + geocode_cache.json 을 단지 단위로 모아
../assets/js/data.js 를 만든다.
"""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
OUT = ROOT / "assets" / "js" / "data.js"
MAX_DEALS = 20  # 팝업에 보여줄 최근 거래 상한


def aggregate_sale(rows):
    """단지(지번) 키로 매매 거래를 모은다."""
    by_key = {}
    for r in rows:
        by_key.setdefault(common.parcel_key(r), []).append(r)

    out = {}
    for key, group in by_key.items():
        group.sort(key=lambda r: r["CTRT_DAY"], reverse=True)
        prices = [
            p for r in group
            if (p := common.price_per_pyeong(float(r["THING_AMT"]), float(r["ARCH_AREA"]))) is not None
        ]
        latest = group[0]
        out[key] = {
            "count": len(group),
            "avgPricePerPyeong": round(sum(prices) / len(prices)) if prices else None,
            "latestPrice": float(latest["THING_AMT"]),
            "latestDate": latest["CTRT_DAY"],
            "deals": [
                {
                    "date": r["CTRT_DAY"],
                    "price": float(r["THING_AMT"]),
                    "area": float(r["ARCH_AREA"]),
                    "floor": r.get("FLR"),
                }
                for r in group[:MAX_DEALS]
            ],
        }
    return out


def aggregate_rent(rows, rent_se):
    """단지(지번) 키로 전세 또는 월세 거래를 모은다. rent_se는 '전세' 또는 '월세'."""
    filtered = [r for r in rows if r.get("RENT_SE") == rent_se]
    by_key = {}
    for r in filtered:
        by_key.setdefault(common.parcel_key(r), []).append(r)

    out = {}
    for key, group in by_key.items():
        group.sort(key=lambda r: r["CTRT_DAY"], reverse=True)
        deposits = [
            p for r in group
            if (p := common.price_per_pyeong(float(r["GRFE"]), float(r["RENT_AREA"]))) is not None
        ]
        latest = group[0]
        out[key] = {
            "count": len(group),
            "avgDepositPerPyeong": round(sum(deposits) / len(deposits)) if deposits else None,
            "latestDeposit": float(latest["GRFE"]),
            "latestRent": float(latest["RTFE"]),
            "latestDate": latest["CTRT_DAY"],
            "deals": [
                {
                    "date": r["CTRT_DAY"],
                    "deposit": float(r["GRFE"]),
                    "rent": float(r["RTFE"]),
                    "area": float(r["RENT_AREA"]),
                    "floor": r.get("FLR"),
                }
                for r in group[:MAX_DEALS]
            ],
        }
    return out


def collect_meta(*row_lists):
    """parcel_key -> (자치구, 법정동, 단지명). 가장 최근 거래의 표기를 쓴다."""
    latest = {}
    for rows in row_lists:
        for r in rows:
            key = common.parcel_key(r)
            if key not in latest or r["CTRT_DAY"] > latest[key]["CTRT_DAY"]:
                latest[key] = r
    return {
        key: (r["CGG_NM"], r["STDG_NM"], r.get("BLDG_NM") or common.lot_address(r))
        for key, r in latest.items()
    }


def build_complexes(sale_agg, jeonse_agg, wolse_agg, meta, geocode_cache):
    keys = set(sale_agg) | set(jeonse_agg) | set(wolse_agg)
    complexes = []
    skipped = 0
    for key in sorted(keys):
        geo = geocode_cache.get(key)
        if not geo:
            skipped += 1
            continue
        gu, dong, name = meta[key]
        complexes.append({
            "gu": gu,
            "dong": dong,
            "name": name,
            "lat": geo["lat"],
            "lng": geo["lng"],
            "sale": sale_agg.get(key),
            "jeonse": jeonse_agg.get(key),
            "wolse": wolse_agg.get(key),
        })
    return complexes, skipped


def main():
    sale_rows = json.loads((TOOLS / "sale_raw.json").read_text(encoding="utf-8"))
    rent_rows = json.loads((TOOLS / "rent_raw.json").read_text(encoding="utf-8"))
    geocode_cache = json.loads((TOOLS / "geocode_cache.json").read_text(encoding="utf-8"))

    sale_agg = aggregate_sale(sale_rows)
    jeonse_agg = aggregate_rent(rent_rows, "전세")
    wolse_agg = aggregate_rent(rent_rows, "월세")
    meta = collect_meta(sale_rows, rent_rows)

    complexes, skipped = build_complexes(sale_agg, jeonse_agg, wolse_agg, meta, geocode_cache)

    gu_set = sorted({c["gu"] for c in complexes})
    print(f"단지 {len(complexes):,}개 (좌표 없어 제외 {skipped:,}개)")
    print(f"자치구 {len(gu_set)}개: {', '.join(gu_set)}")
    for label, field in (("매매", "sale"), ("전세", "jeonse"), ("월세", "wolse")):
        n = sum(1 for c in complexes if c[field])
        print(f"  {label} 데이터 있는 단지: {n:,}개")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    meta_out = {"generatedAt": date.today().isoformat(), "total": len(complexes)}
    js = (
        "/* 서울 아파트 실거래가 데이터 — 자동 생성 파일 */\n"
        "window.APT_COMPLEXES = " + json.dumps(complexes, ensure_ascii=False, indent=2) + ";\n"
        "window.DATA_META = " + json.dumps(meta_out, ensure_ascii=False, indent=2) + ";\n"
    )
    OUT.write_text(js, encoding="utf-8")
    print(f"저장: {OUT}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `py apt_price_map/tools/test_build_data.py`
Expected: `OK: build_data.py 4개 테스트 통과`

- [ ] **Step 5: 실제 데이터로 실행해 검증**

Run: `cd apt_price_map && py tools/build_data.py`

Expected:
- `단지 N개 (좌표 없어 제외 M개)` — 서울 25개 자치구가 모두 `자치구 25개: ...`에 나열되는지 확인한다. 25개보다 적게 나오면 특정 구에 2025~2026년 아파트 거래(매매·전세·월세 어느 쪽도) 자체가 없거나, 지오코딩이 그 구에서만 실패했다는 뜻이니 원인을 확인한다.
- 매매/전세/월세 세 모드 모두 "데이터 있는 단지" 수가 0이 아닌지 확인한다.
- `assets/js/data.js`가 생성된다. 아래로 형태를 눈으로 확인:

```bash
py -c "
import json
text = open('apt_price_map/assets/js/data.js', encoding='utf-8').read()
assert 'window.APT_COMPLEXES' in text
assert 'window.DATA_META' in text
print('OK: data.js 생성 확인')
"
```

- [ ] **Step 6: 커밋**

```bash
cd apt_price_map
git add tools/build_data.py tools/test_build_data.py assets/js/data.js
git commit -m "feat: 단지 단위 집계 스크립트 build_data.py -> assets/js/data.js"
```

---

## 다음 단계

이 플랜은 데이터 파이프라인까지만 다룬다. `assets/js/data.js`가 만들어지면, 이를 지도에 표시하는 프론트엔드(`index.html`, `assets/js/app.js`, `assets/js/render.js`, `assets/css/style.css`, `manifest.json`, `sw.js`, `report.html`)는 별도 플랜(`apt_price_map-frontend`)으로 이어간다 — 두 서브시스템은 독립적으로 완성·검증 가능해 나눴다.
