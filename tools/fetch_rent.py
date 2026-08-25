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
