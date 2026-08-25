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
            # 극소수 행은 원본 데이터 자체에 CGG_NM/MNO/SNO 등 위치 정보가 비어 있다
            # (예: rent_raw.json 5건). 지오코딩할 주소를 만들 수 없으니 건너뛴다.
            if not common.has_lot(row):
                continue
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
    else:
        print(f"  ! 레이트리밋 소진: {address!r}")
        return None

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
