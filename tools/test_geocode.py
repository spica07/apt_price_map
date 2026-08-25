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
