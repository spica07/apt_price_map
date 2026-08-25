# 서울 아파트 실거래가 지도

서울시 아파트 매매·전세·월세 실거래가(2025~2026년, 서울 열린데이터광장)를
단지 단위로 모아 지도에 표시하는 PWA입니다.

## 담긴 것

- 서울 아파트 8,810개 단지, 25개 자치구 전체
- 매매 6,420 / 전세 6,888 / 월세 6,855개 단지에 거래 데이터 보유
- 단지 클릭 시 최근 거래(최대 20건, 최신순) 확인, 상세 페이지에서는 전체 내역을 더 보기로 확인
- 평당가(전세·월세는 평당 보증금) 분위수 기준 마커 색상

## 실행

정적 파일이라 아무 웹서버로나 열면 됩니다.

```bash
py -m http.server 8000
# http://localhost:8000
```

## 데이터 갱신

원자료 수집부터 지도 데이터 생성까지, **반드시 이 순서로** 실행합니다.
순서를 건너뛰면(특히 `geocode.py`) 새로 생긴 단지가 좌표가 없어 조용히
지도에서 빠집니다.

```bash
py tools/fetch_sale.py      # 매매 실거래가 (서울 열린데이터광장 SEOUL_OPENDATA_KEY)
py tools/fetch_rent.py      # 전월세 실거래가 (같은 키, 훨씬 오래 걸림 — 585,601건 기준 약 1시간)
py tools/geocode.py         # 단지 좌표 (카카오 KAKAO_REST_KEY, 캐시로 재실행 시 새 단지만 조회)
py tools/build_data.py      # -> assets/js/data.js (단지당 최근 20건) + assets/data/deals/<idx>.json (단지별 전체 내역)
py tools/make_icons.py      # 아이콘을 다시 만들 때만 (브랜드 색을 바꾼 경우 등)
```

`assets/data/deals/`는 상세 페이지(`detail.html`)가 "더 보기"로 전체 내역을
보여줄 때 쓰는 단지별 파일입니다. `data.js`처럼 최종 산출물이라 커밋해야
GitHub Pages에서 동작합니다 — `build_data.py`를 다시 돌리면 파일 수천 개가
통째로 새로 만들어지니, 커밋 전에 `git status`로 규모를 한번 확인하세요.

인증키는 `.env`에 둡니다 (`.env.example` 참고):
- `SEOUL_OPENDATA_KEY` — 서울 열린데이터광장(data.seoul.go.kr) 계정당 발급되는 일반 인증키
- `KAKAO_REST_KEY` — 카카오 로컬 API (다른 다있맵 지도와 같은 키를 재사용해도 됩니다)

### 지오코딩 실패 단지

`geocode.py` 실행 시 콘솔에 성공/실패 건수가 찍힙니다. 실패한 지번은
`tools/geocode_cache.json`에서 값이 `null`인 항목으로 남아 있어,
아래처럼 뽑아볼 수 있습니다.

```bash
py -c "
import json
cache = json.load(open('tools/geocode_cache.json', encoding='utf-8'))
for k, v in cache.items():
    if v is None:
        print(k)
"
```

재개발·재건축으로 지번이 통합·변경된 경우가 많아, 실패한 지번은 수동으로
최신 주소를 확인해 `geocode_cache.json`에 좌표를 직접 채워 넣고
`build_data.py`를 다시 돌리는 방법으로 보정할 수 있습니다.
