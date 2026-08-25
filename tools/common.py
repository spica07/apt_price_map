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


def has_lot(row):
    """lot_address()가 만들 수 있는 지번인지. 극소수 행은 위치 필드가 통째로 비어 있다."""
    return str(row.get("MNO", "")).strip().isdigit() and str(row.get("SNO", "")).strip().isdigit()


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
        raise RuntimeError(f"{year}년 {service} 요청 실패: {result['CODE']} {result['MESSAGE']}")
    total = int(first["list_total_count"])
    log(f"{year}년 {service}: 전체 {total:,}건")

    kept = [r for r in first.get("row", []) if keep_row(r)]
    fetched = len(first.get("row", []))
    start = per_page + 1
    while fetched < total:
        end = start + per_page - 1
        page = call(start, end)
        result = page["RESULT"]
        if result["CODE"] != "INFO-000":
            raise RuntimeError(f"{year}년 {service} 요청 실패(페이지 {start}-{end}): {result['CODE']} {result['MESSAGE']}")
        chunk = page.get("row", [])
        if not chunk:
            break
        kept.extend(r for r in chunk if keep_row(r))
        fetched += len(chunk)
        start += per_page
        if start % 10000 < per_page:
            log(f"  {fetched:,}/{total:,} 조회, {len(kept):,}건 누적")
        time.sleep(sleep)

    if fetched < total:
        raise RuntimeError(f"{year}년 {service}: {fetched:,}/{total:,}건만 받음 — 중간에 페이지 요청이 끊겼을 수 있다")
    return kept
