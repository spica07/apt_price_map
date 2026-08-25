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
            # 극소수 행은 원본 데이터 자체에 CGG_NM/STDG_NM/MNO/SNO/BLDG_NM이
            # 모두 비어 있다(예: rent_raw.json 5건). common.lot_address()는
            # int('')에서 죽으므로, 지번을 만들 수 없는 행은 건너뛴다
            # (geocode.py의 collect_parcels()와 같은 가드).
            if not str(r.get("MNO", "")).strip():
                continue
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
