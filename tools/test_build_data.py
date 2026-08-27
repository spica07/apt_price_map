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
     "RENT_AREA": "127.66", "GRFE": "80000", "RTFE": "203", "NEW_UPDT_YN": "갱신"},
    {"CGG_NM": "강동구", "STDG_NM": "상일동", "MNO": "0521", "SNO": "0000",
     "BLDG_NM": "고덕자이", "CTRT_DAY": "20260629", "RENT_SE": "전세",
     "RENT_AREA": "59.939", "GRFE": "73000", "RTFE": "0", "NEW_UPDT_YN": "신규"},
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
    assert wolse["서초구|서초동|1682|0000"]["deals"][0]["renewed"] is True
    assert jeonse["강동구|상일동|0521|0000"]["deals"][0]["renewed"] is False


def test_aggregate_sale_does_not_cap_deals():
    many_rows = [
        {"CGG_NM": "강남구", "STDG_NM": "역삼동", "MNO": "0001", "SNO": "0000",
         "BLDG_NM": "테스트", "CTRT_DAY": "202601" + str(i + 1).zfill(2), "THING_AMT": "10000",
         "ARCH_AREA": "84.0", "FLR": "1"}
        for i in range(25)
    ]
    result = build_data.aggregate_sale(many_rows)
    key = "강남구|역삼동|0001|0000"
    assert result[key]["count"] == 25
    assert len(result[key]["deals"]) == 25  # MAX_DEALS(20)로 잘리지 않는다 — 상세페이지 전체 내역용


def test_aggregate_sale_avg_2026_only_uses_2026_deals():
    rows = [
        {"CGG_NM": "강남구", "STDG_NM": "역삼동", "MNO": "0001", "SNO": "0000",
         "BLDG_NM": "테스트", "CTRT_DAY": "20251231", "THING_AMT": "10000", "ARCH_AREA": "33.058", "FLR": "1"},
        {"CGG_NM": "강남구", "STDG_NM": "역삼동", "MNO": "0001", "SNO": "0000",
         "BLDG_NM": "테스트", "CTRT_DAY": "20260101", "THING_AMT": "20000", "ARCH_AREA": "33.058", "FLR": "1"},
    ]
    result = build_data.aggregate_sale(rows)
    key = "강남구|역삼동|0001|0000"
    # 33.058㎡ = 정확히 10평. 2025년 1000/평 + 2026년 2000/평.
    assert result[key]["avgPricePerPyeong"] == 1500
    assert result[key]["avgPricePerPyeong2026"] == 2000  # 2026년 거래 한 건만 반영


def test_jeonse_ratio_2026_computed_when_both_present():
    sale_entry = {"avgPricePerPyeong2026": 2000}
    jeonse_entry = {"avgDepositPerPyeong2026": 1400}
    assert build_data.jeonse_ratio_2026(sale_entry, jeonse_entry) == 70


def test_jeonse_ratio_2026_none_when_either_side_missing():
    assert build_data.jeonse_ratio_2026(None, {"avgDepositPerPyeong2026": 1000}) is None
    assert build_data.jeonse_ratio_2026({"avgPricePerPyeong2026": 1000}, None) is None
    assert build_data.jeonse_ratio_2026(
        {"avgPricePerPyeong2026": None}, {"avgDepositPerPyeong2026": 1000}
    ) is None


def test_split_full_and_capped_caps_data_js_but_keeps_full_file():
    sale_agg = build_data.aggregate_sale(SALE_ROWS)
    meta = build_data.collect_meta(SALE_ROWS, [])
    cache = {"노원구|상계동|0173|0001": {"lat": 37.66, "lng": 127.06}}
    complexes, _ = build_data.build_complexes(sale_agg, {}, {}, meta, cache, [])
    full_by_idx, capped = build_data.split_full_and_capped(complexes, max_deals=1)
    assert len(capped[0]["sale"]["deals"]) == 1
    assert len(full_by_idx[0]["sale"]) == 2
    assert full_by_idx[0]["jeonse"] == []
    assert full_by_idx[0]["wolse"] == []
    assert len(complexes[0]["sale"]["deals"]) == 2  # 원본은 그대로 — capped가 훼손하지 않는다


def test_build_complexes_skips_missing_geocode():
    sale_agg = build_data.aggregate_sale(SALE_ROWS)
    meta = build_data.collect_meta(SALE_ROWS, [])
    complexes, skipped = build_data.build_complexes(sale_agg, {}, {}, meta, {}, [])
    assert complexes == []
    assert skipped == 1


def test_build_complexes_skips_key_missing_from_meta_without_crashing():
    # geocode_cache.json은 사람이 손댈 수 있는 커밋된 파일이라, 키가 geocode_cache에는
    # 있지만 meta에는 없는 상황이 생길 수 있다. meta[key]로 그냥 접근하면 KeyError로
    # 죽어야 할 이유가 없다 — 좌표가 없을 때와 마찬가지로 skipped로 세고 건너뛰어야 한다.
    sale_agg = build_data.aggregate_sale(SALE_ROWS)
    cache = {"노원구|상계동|0173|0001": {"lat": 37.66, "lng": 127.06}}
    complexes, skipped = build_data.build_complexes(sale_agg, {}, {}, {}, cache, [])
    assert complexes == []
    assert skipped == 1


def test_build_complexes_includes_geocoded():
    sale_agg = build_data.aggregate_sale(SALE_ROWS)
    meta = build_data.collect_meta(SALE_ROWS, [])
    cache = {"노원구|상계동|0173|0001": {"lat": 37.66, "lng": 127.06}}
    complexes, skipped = build_data.build_complexes(sale_agg, {}, {}, meta, cache, [])
    assert skipped == 0
    assert complexes[0]["name"] == "벽산"
    assert complexes[0]["sale"]["count"] == 2
    assert complexes[0]["jeonse"] is None
    assert complexes[0]["wolse"] is None
    assert complexes[0]["jeonseRatio2026"] is None  # 전세 데이터가 없으니 계산 못 한다
    assert complexes[0]["nearestSchool"] is None  # 학교 목록을 안 줬으니 계산 못 한다


def test_build_complexes_computes_jeonse_ratio_when_both_modes_present():
    same_parcel_jeonse = [
        {"CGG_NM": "노원구", "STDG_NM": "상계동", "MNO": "0173", "SNO": "0001",
         "BLDG_NM": "벽산", "CTRT_DAY": "20260815", "RENT_SE": "전세",
         "RENT_AREA": "59.9", "GRFE": "40000", "RTFE": "0", "NEW_UPDT_YN": "신규"},
    ]
    sale_agg = build_data.aggregate_sale(SALE_ROWS)
    jeonse_agg = build_data.aggregate_rent(same_parcel_jeonse, "전세")
    meta = build_data.collect_meta(SALE_ROWS, same_parcel_jeonse)
    cache = {"노원구|상계동|0173|0001": {"lat": 37.66, "lng": 127.06}}
    complexes, _ = build_data.build_complexes(sale_agg, jeonse_agg, {}, meta, cache, [])
    assert complexes[0]["jeonseRatio2026"] is not None
    assert 0 < complexes[0]["jeonseRatio2026"] < 100


def test_nearest_school_picks_closest():
    schools = [
        {"name": "먼학교", "district": "강남구", "lat": 37.60, "lng": 127.10},
        {"name": "가까운학교", "district": "강남구", "lat": 37.501, "lng": 127.001},
    ]
    result = build_data.nearest_school(37.5, 127.0, schools)
    assert result["name"] == "가까운학교"
    assert result["district"] == "강남구"
    assert result["distanceM"] > 0


def test_nearest_school_empty_list_returns_none():
    assert build_data.nearest_school(37.5, 127.0, []) is None


def test_build_complexes_fills_nearest_school_when_list_given():
    sale_agg = build_data.aggregate_sale(SALE_ROWS)
    meta = build_data.collect_meta(SALE_ROWS, [])
    cache = {"노원구|상계동|0173|0001": {"lat": 37.66, "lng": 127.06}}
    schools = [{"name": "상계초등학교", "district": "노원구", "lat": 37.661, "lng": 127.061}]
    complexes, _ = build_data.build_complexes(sale_agg, {}, {}, meta, cache, schools)
    assert complexes[0]["nearestSchool"]["name"] == "상계초등학교"


if __name__ == "__main__":
    test_aggregate_sale_groups_by_parcel_and_sorts_latest_first()
    test_aggregate_rent_splits_jeonse_and_wolse()
    test_aggregate_sale_does_not_cap_deals()
    test_aggregate_sale_avg_2026_only_uses_2026_deals()
    test_jeonse_ratio_2026_computed_when_both_present()
    test_jeonse_ratio_2026_none_when_either_side_missing()
    test_split_full_and_capped_caps_data_js_but_keeps_full_file()
    test_build_complexes_skips_missing_geocode()
    test_build_complexes_skips_key_missing_from_meta_without_crashing()
    test_build_complexes_includes_geocoded()
    test_build_complexes_computes_jeonse_ratio_when_both_modes_present()
    test_nearest_school_picks_closest()
    test_nearest_school_empty_list_returns_none()
    test_build_complexes_fills_nearest_school_when_list_given()
    print("OK: build_data.py 14개 테스트 통과")
