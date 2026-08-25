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


def test_build_complexes_skips_key_missing_from_meta_without_crashing():
    # geocode_cache.json은 사람이 손댈 수 있는 커밋된 파일이라, 키가 geocode_cache에는
    # 있지만 meta에는 없는 상황이 생길 수 있다. meta[key]로 그냥 접근하면 KeyError로
    # 죽어야 할 이유가 없다 — 좌표가 없을 때와 마찬가지로 skipped로 세고 건너뛰어야 한다.
    sale_agg = build_data.aggregate_sale(SALE_ROWS)
    cache = {"노원구|상계동|0173|0001": {"lat": 37.66, "lng": 127.06}}
    complexes, skipped = build_data.build_complexes(sale_agg, {}, {}, {}, cache)
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
    test_build_complexes_skips_key_missing_from_meta_without_crashing()
    test_build_complexes_includes_geocoded()
    print("OK: build_data.py 5개 테스트 통과")
