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
