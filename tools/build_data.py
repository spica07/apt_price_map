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
DEALS_DIR = ROOT / "assets" / "data" / "deals"
MAX_DEALS = 20  # data.js(지도·목록)에 넣는 최근 거래 상한 — 전체 내역은 DEALS_DIR에 따로 둔다

# 초등학교 위치는 이 워크스페이스의 형제 프로젝트 elementary_school_map이
# 이미 수집·정리해 둔 것을 그대로 가져다 쓴다(전국 6,303개 중 서울만).
# 그 프로젝트의 데이터가 갱신되면 이 파이프라인을 다시 돌려야 반영된다.
SCHOOL_SOURCE = ROOT.parent / "elementary_school_map" / "assets" / "js" / "data.js"
SCHOOLS_OUT = ROOT / "assets" / "js" / "schools.js"


def _to_int(value):
    """층수처럼 정수값인데 원본에서 float/문자열로 올 수 있는 필드를 int로 통일한다."""
    if value in (None, ""):
        return value
    return int(float(value))


def _avg_price_per_pyeong_for_year(rows, amount_field, area_field, year):
    """rows 중 계약일(CTRT_DAY)이 year로 시작하는 것만 골라 평당가(또는
    평당 보증금) 평균을 낸다. 해당 연도 거래가 없으면 None."""
    values = [
        p for r in rows
        if r["CTRT_DAY"].startswith(year)
        and (p := common.price_per_pyeong(float(r[amount_field]), float(r[area_field]))) is not None
    ]
    return round(sum(values) / len(values)) if values else None


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
            "avgPricePerPyeong2026": _avg_price_per_pyeong_for_year(group, "THING_AMT", "ARCH_AREA", "2026"),
            "latestPrice": int(float(latest["THING_AMT"])),
            "latestDate": latest["CTRT_DAY"],
            "deals": [
                {
                    "date": r["CTRT_DAY"],
                    "price": int(float(r["THING_AMT"])),
                    "area": float(r["ARCH_AREA"]),
                    "floor": _to_int(r.get("FLR")),
                }
                for r in group
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
            "avgDepositPerPyeong2026": _avg_price_per_pyeong_for_year(group, "GRFE", "RENT_AREA", "2026"),
            "latestDeposit": int(float(latest["GRFE"])),
            "latestRent": int(float(latest["RTFE"])),
            "latestDate": latest["CTRT_DAY"],
            "deals": [
                {
                    "date": r["CTRT_DAY"],
                    "deposit": int(float(r["GRFE"])),
                    "rent": int(float(r["RTFE"])),
                    "area": float(r["RENT_AREA"]),
                    "floor": _to_int(r.get("FLR")),
                    "renewed": r.get("NEW_UPDT_YN") == "갱신",
                }
                for r in group
            ],
        }
    return out


def load_seoul_schools():
    """elementary_school_map/assets/js/data.js에서 window.SCHOOLS 배열을
    꺼내 서울만 남긴다. 그 파일은 JS라 `window.SCHOOLS = [...];` 줄을
    문자열로 잘라 JSON으로 읽는다."""
    text = SCHOOL_SOURCE.read_text(encoding="utf-8")
    marker = "window.SCHOOLS = "
    start = text.index(marker) + len(marker)
    end = text.index(";\n", start)
    schools = json.loads(text[start:end])
    return [s for s in schools if s.get("region") == "서울"]


def nearest_school(lat, lng, schools):
    """단지 좌표에서 직선거리로 가장 가까운 학교 하나. schools가 비어 있으면 None."""
    best = None
    best_d = None
    for s in schools:
        d = common.haversine_m(lat, lng, s["lat"], s["lng"])
        if best_d is None or d < best_d:
            best_d, best = d, s
    if best is None:
        return None
    return {"name": best["name"], "district": best["district"], "distanceM": round(best_d)}


def write_schools_js(schools):
    """지도에 그릴 서울 초등학교 목록을 별도 파일로 만든다 — data.js와
    분리해 상세 페이지(학교 목록 자체는 필요 없다)가 이 큰 파일을 안 받게 한다."""
    compact = [
        {
            "name": s["name"],
            "address": s["address"],
            "district": s["district"],
            "lat": s["lat"],
            "lng": s["lng"],
            "studentCount": s.get("studentCount"),
            "classCount": s.get("classCount"),
        }
        for s in schools
    ]
    js = (
        "/* 서울 초등학교 위치 — elementary_school_map에서 가져온 자동 생성 파일 */\n"
        "window.SCHOOLS_SEOUL = " + json.dumps(compact, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    SCHOOLS_OUT.write_text(js, encoding="utf-8")


def collect_meta(*row_lists):
    """parcel_key -> (자치구, 법정동, 단지명). 가장 최근 거래의 표기를 쓴다."""
    latest = {}
    for rows in row_lists:
        for r in rows:
            # 극소수 행은 원본 데이터 자체에 CGG_NM/STDG_NM/MNO/SNO/BLDG_NM이
            # 모두 비어 있다(예: rent_raw.json 5건). common.lot_address()는
            # int('')에서 죽으므로, 지번을 만들 수 없는 행은 건너뛴다
            # (geocode.py의 collect_parcels()와 같은 가드).
            if not common.has_lot(r):
                continue
            key = common.parcel_key(r)
            if key not in latest or r["CTRT_DAY"] > latest[key]["CTRT_DAY"]:
                latest[key] = r
    return {
        key: (r["CGG_NM"], r["STDG_NM"], r.get("BLDG_NM") or common.lot_address(r))
        for key, r in latest.items()
    }


def jeonse_ratio_2026(sale_entry, jeonse_entry):
    """2026년 평당 매매가 대비 평당 전세가(전세가율, %). 둘 다 2026년
    거래가 있어야 계산할 수 있다 — 한쪽이라도 없으면 None."""
    if not sale_entry or not jeonse_entry:
        return None
    sale_2026 = sale_entry.get("avgPricePerPyeong2026")
    jeonse_2026 = jeonse_entry.get("avgDepositPerPyeong2026")
    if not sale_2026 or not jeonse_2026:
        return None
    return round(jeonse_2026 / sale_2026 * 100)


def build_complexes(sale_agg, jeonse_agg, wolse_agg, meta, geocode_cache, seoul_schools):
    keys = set(sale_agg) | set(jeonse_agg) | set(wolse_agg)
    complexes = []
    skipped = 0
    for key in sorted(keys):
        geo = geocode_cache.get(key)
        if not geo:
            skipped += 1
            continue
        entry = meta.get(key)
        if entry is None:
            skipped += 1
            continue
        gu, dong, name = entry
        sale_entry = sale_agg.get(key)
        jeonse_entry = jeonse_agg.get(key)
        lat, lng = round(geo["lat"], 6), round(geo["lng"], 6)
        complexes.append({
            "gu": gu,
            "dong": dong,
            "name": name,
            "lat": lat,
            "lng": lng,
            "sale": sale_entry,
            "jeonse": jeonse_entry,
            "wolse": wolse_agg.get(key),
            "jeonseRatio2026": jeonse_ratio_2026(sale_entry, jeonse_entry),
            "nearestSchool": nearest_school(lat, lng, seoul_schools),
        })
    return complexes, skipped


def split_full_and_capped(complexes, max_deals):
    """단지별 {sale,jeonse,wolse} 전체 거래(파일로 저장)와, data.js에 넣을
    최근 max_deals건짜리 얕은 복사본을 나눈다. aggregate_sale/aggregate_rent가
    이미 최신순으로 정렬해 뒀으므로 앞에서 자르면 최근 것부터 남는다."""
    full_by_idx = []
    capped = []
    for c in complexes:
        full = {}
        capped_c = dict(c)
        for mode in ("sale", "jeonse", "wolse"):
            entry = c[mode]
            full[mode] = entry["deals"] if entry else []
            if entry:
                capped_entry = dict(entry)
                capped_entry["deals"] = entry["deals"][:max_deals]
                capped_c[mode] = capped_entry
        full_by_idx.append(full)
        capped.append(capped_c)
    return full_by_idx, capped


def main():
    sale_rows = json.loads((TOOLS / "sale_raw.json").read_text(encoding="utf-8"))
    rent_rows = json.loads((TOOLS / "rent_raw.json").read_text(encoding="utf-8"))
    geocode_cache = json.loads((TOOLS / "geocode_cache.json").read_text(encoding="utf-8"))

    sale_agg = aggregate_sale(sale_rows)
    jeonse_agg = aggregate_rent(rent_rows, "전세")
    wolse_agg = aggregate_rent(rent_rows, "월세")
    meta = collect_meta(sale_rows, rent_rows)

    seoul_schools = load_seoul_schools()
    print(f"서울 초등학교 {len(seoul_schools):,}개 로드 (출처: {SCHOOL_SOURCE})")

    complexes, skipped = build_complexes(sale_agg, jeonse_agg, wolse_agg, meta, geocode_cache, seoul_schools)

    gu_set = sorted({c["gu"] for c in complexes})
    print(f"단지 {len(complexes):,}개 (좌표 없어 제외 {skipped:,}개)")
    print(f"자치구 {len(gu_set)}개: {', '.join(gu_set)}")
    for label, field in (("매매", "sale"), ("전세", "jeonse"), ("월세", "wolse")):
        n = sum(1 for c in complexes if c[field])
        print(f"  {label} 데이터 있는 단지: {n:,}개")
    print(f"  가까운 초등학교 계산된 단지: {sum(1 for c in complexes if c['nearestSchool']):,}개")

    write_schools_js(seoul_schools)
    print(f"저장: {SCHOOLS_OUT}")

    full_by_idx, capped = split_full_and_capped(complexes, MAX_DEALS)

    DEALS_DIR.mkdir(parents=True, exist_ok=True)
    for old in DEALS_DIR.glob("*.json"):
        old.unlink()  # 단지 순서가 바뀌면 옛 idx 파일이 엉뚱한 단지를 가리키므로 매번 싹 지우고 새로 쓴다
    for i, full in enumerate(full_by_idx):
        (DEALS_DIR / f"{i}.json").write_text(
            json.dumps(full, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    total_deals = sum(len(f["sale"]) + len(f["jeonse"]) + len(f["wolse"]) for f in full_by_idx)
    print(f"단지별 전체 거래 파일 {len(full_by_idx):,}개 저장 (거래 {total_deals:,}건) -> {DEALS_DIR}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    meta_out = {"generatedAt": date.today().isoformat(), "total": len(capped)}
    js = (
        "/* 서울 아파트 실거래가 데이터 — 자동 생성 파일 */\n"
        "window.APT_COMPLEXES = " + json.dumps(capped, ensure_ascii=False, separators=(",", ":")) + ";\n"
        "window.DATA_META = " + json.dumps(meta_out, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    OUT.write_text(js, encoding="utf-8")
    print(f"저장: {OUT}")


if __name__ == "__main__":
    main()
