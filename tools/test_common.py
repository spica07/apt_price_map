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


def test_has_lot_true_when_mno_and_sno_present():
    row = {"MNO": "0173", "SNO": "0001"}
    assert common.has_lot(row) is True


def test_has_lot_false_when_mno_blank():
    row = {"MNO": "", "SNO": "0001"}
    assert common.has_lot(row) is False


def test_has_lot_false_when_sno_blank():
    # MNO는 있지만 SNO가 비어 있는 경우 — lot_address()가 int('')에서 죽는 케이스
    row = {"MNO": "0173", "SNO": ""}
    assert common.has_lot(row) is False


def test_price_per_pyeong():
    # 84.5㎡(약 25.57평) 55,000만원 → 평당 약 2,151만원
    result = common.price_per_pyeong(55000, 84.5)
    assert 2150 < result < 2152


def test_price_per_pyeong_zero_area_returns_none():
    assert common.price_per_pyeong(55000, 0) is None


def test_haversine_m_same_point_is_zero():
    assert common.haversine_m(37.5, 127.0, 37.5, 127.0) == 0


def test_haversine_m_matches_known_distance_roughly():
    # 위도 0.01도 차이는 대략 1.11km
    d = common.haversine_m(37.50, 127.00, 37.51, 127.00)
    assert 1050 < d < 1200


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
    test_has_lot_true_when_mno_and_sno_present()
    test_has_lot_false_when_mno_blank()
    test_has_lot_false_when_sno_blank()
    test_price_per_pyeong()
    test_price_per_pyeong_zero_area_returns_none()
    test_haversine_m_same_point_is_zero()
    test_haversine_m_matches_known_distance_roughly()
    test_load_env_key()
    print("OK: common.py 11개 테스트 통과")
