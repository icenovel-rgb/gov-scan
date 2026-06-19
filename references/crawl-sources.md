# 크롤 소스 — API 없는 기관 게시판 직접 순회

bizinfo·K-Startup OpenAPI에 안 잡히는 **지자체·유관기관 공고**를 직접 긁어 같은 파이프라인에 합친다.
대상 목록은 작업폴더 `crawl-sources.json`(템플릿에서 복사). 추출은 **LLM(너)이 WebFetch로** 수행한다
(사이트마다 HTML이 달라 고정 스크래퍼보다 LLM 추출이 견고).

## 크롤 단계 (스캔 2-b)

`crawl-sources.json`의 각 `sources[]`에 대해:
1. `listUrl`(있으면) 또는 `homepage`를 **WebFetch** → 공고 목록 추출(제목·상세링크·작성일·마감).
   - `homepage`만 있으면 먼저 공고/사업공고/공지 게시판을 찾아 들어간다.
   - `altUrls`가 있으면 함께 순회.
2. 각 공고를 **정규화 스키마**로 변환(`references/sources.md`의 scan.json 형식과 동일):
   - `source` = 기관명(예: `gcaf`), `id` = 게시물 식별자(wr_id 등), `key` = `<source>:<id>`
   - `title`·`detailUrl`·`applyEnd`(파악되면)·`registeredAt`·`requirementText`(상세페이지 보강 가능)
3. API 스캔 결과(`scan.json`)에 **append** → 이후 판정·DB·collect는 동일하게 진행.
4. 접수중 필터: 마감이 지난 건 제외(`registeredAt`/마감 텍스트 기반, 불확실하면 남김).

> 크롤 항목도 DB에 `해당없음` 포함 전건 기록(상태 라이프사이클 동일). `source`가 기관명이라 API 건과 구분된다.

## 첨부 수집(크롤 건)

bizinfo처럼 `flpthNm`이 없으므로, 해당 건은 **상세페이지를 WebFetch**해서 첨부 다운로드 링크
(gnuboard `download.php?bo_table=..&wr_id=..&no=..` 등)를 추출한 뒤 `collect.mjs`로 받거나 직접 내려받는다.
사이트별로 다르니 상세페이지에서 링크를 먼저 확인한다.

## 한계 (정직)

- **JS 렌더링 사이트**: WebFetch는 정적 HTML만 본다. 목록을 JS로 그리는 포털은 항목이 안 보일 수 있음
  (`verified:false` + `note`에 표시). 이 경우 검색엔진 경유(WebSearch site:) 또는 RSS/모바일 페이지 시도.
- **HTML 개편**: 게시판 구조가 바뀌면 추출이 흔들림 → 매 크롤 시 LLM이 현재 구조를 보고 적응.
- **분량**: 도청 같은 대형 고시공고는 키워드(`keyword` 필드)로 1차 좁힌다.

## 소스 추가/관리

`crawl-sources.json`에 `{name, listUrl|homepage, region?, keyword?, verified, note}` 추가.
- `verified:true`는 게시판 URL·정적추출 확인된 것(현재 경남문화예술진흥원).
- 새 기관은 `homepage`만 넣어도 되고, 첫 크롤에서 실제 게시판을 찾아 `listUrl`을 채워 넣는다.

### 기본 등록 목록 (경남 중심 시드)
경남문화예술진흥원(검증) · 경남테크노파크 · 창원산업진흥원 · 경남창조경제혁신센터 ·
경남신용보증재단(자금) · 경상남도청 고시공고 · 소상공인시장진흥공단(소상공인).
→ 지역/업종에 맞게 사용자가 가감.
