---
name: gov-scan
description: >
  정부지원사업을 OpenAPI(기업마당 bizinfo + K-Startup)로 모조리 스캔하고, 작업폴더의
  자격요건.md로 신청자격을 자동 판정한 뒤, 조사한 전건을 Google Sheet DB에 기록한다.
  자격 해당 건은 사용자 확인 후 kdr 스킬로 신청서/사업계획서를 HWPX로 작성한다.
  상태값: 해당없음·작성중·결과대기·탈락·선정·완료·보류.
  트리거: "gov-scan", "정부지원사업 스캔", "지원사업 찾아줘", "정부사업 조사",
  "지원사업 DB 갱신", "신청서 작성해줘(정부지원사업)".
---

# gov-scan — 정부지원사업 자동 스캔·판정·작성

발동된 **작업폴더**에서 동작한다. 사업을 모조리 긁어 자격을 판정하고, 조사한 전건을 Google Sheet에
기록하며, 해당 건은 [`kdr`](../kdr/SKILL.md) 스킬로 한글(HWPX) 신청 문서를 만든다.

```
자격요건.md ─┐
             ├─ scan.mjs ─→ 공고 정규화 ─→ 자격판정 ─→ db_sync.mjs(Sheet upsert)
config.json ─┘                                │
                                              └─ (해당 & 사용자확인) ─→ kdr ─→ output/*.hwpx
```

`<SKILL>` = `~/.claude/skills/gov-scan`. kdr = `~/.claude/skills/kdr` (없으면 설치 안내).

---

## 0단계 — 환경 점검 (최초 1회)

작업폴더에 아래가 있는지 확인하고 없으면 **템플릿을 복사**한 뒤 사용자에게 채우게 한다.

```bash
node <SKILL>/scripts/setup.mjs    # 작업폴더에 자격요건.md, config.json 없으면 생성
```

- `자격요건.md` — 회사 프로파일(업종/지역/업력/매출/기업유형/인증/대표자/관심분야). 형식: `references/eligibility-format.md`.
- `config.json` — API 키 2종 + Apps Script 웹앱 URL. 형식·발급법: `references/sources.md`, `references/apps-script.md`.

**키가 비어 있으면** → `references/sources.md`의 발급 절차를 사용자에게 안내하고, 발급된 값을 `config.json`에
넣게 한다(또는 환경변수 `BIZINFO_KEY`·`DATA_GO_KR_KEY`·`GS_WEBAPP_URL`). 키 없이는 스캔 불가.

**Apps Script 웹앱이 없으면** → `references/apps-script.md`의 `Code.gs`를 스프레드시트에 배포하도록 안내(1회).
배포 URL을 `config.json.webappUrl`에 넣는다. **URL을 넣은 직후 연결을 반드시 검증한다:**
```bash
node <SKILL>/scripts/db_sync.mjs --config config.json --ping       # 연결·인증·헤더
node <SKILL>/scripts/db_sync.mjs --config config.json --selftest   # 쓰기→읽기→삭제 round-trip(비파괴)
```
→ `통과 ✅`가 떠야 4단계(DB 기록)로 간다. 실패하면 DB 기록을 시도하지 말고 원인부터 잡는다.

---

## 1단계 — 자격요건 로드 (다중주체)

`자격요건.md`를 읽어 **공통** + **신청주체 N개**(예: 본인=기존 사업자, 제자=예비창업자)를 구조화한다.
주체별로 창업단계·사업자형태·대표자(연령·성별)·인증·규모를, 공통으로 지역·업종·관심분야·수혜이력을 추출.
**핵심: 주체 중 하나라도 자격 충족 시 그 공고는 `해당`**(OR 매칭). 형식·인터뷰 체크리스트는 `references/eligibility-format.md`.

프로파일이 비었거나 모호하면 체크리스트(A 창업단계 / B 대표자 / C 규모·지역 / D 이력)로 **사용자에게 물어
자격요건.md를 갱신**한 뒤 진행한다.

---

## 2단계 — 사업 스캔 (모조리)

```bash
node <SKILL>/scripts/scan.mjs --config config.json --out scan.json
# 옵션: --since YYYY-MM-DD (등록일 하한, 기본 30일전) --open-only(접수중만, 기본 on)
#       --source bizinfo|kstartup|all(기본) --probe(첫 응답 원본키 출력: 필드매핑 검증용)
```
- **bizinfo**(기업마당): 중앙부처·지자체·유관기관 통합, 8개 분야(금융/기술/인력/수출/내수/창업/경영/기타).
- **kstartup**: 창업진흥원 사업공고·통합공고.
- 정규화 스키마로 통합 출력(`scan.json`). 신청마감 지난 공고는 기본 제외(`--open-only`).
- 출력 필드·소스 상세: `references/sources.md`.

> **첫 실행 시**: `--probe`로 원본 응답 키를 확인하고 `references/sources.md`의 매핑표와 대조해
> 필드명이 맞는지 1회 검증한다(포털 API 필드명이 개정될 수 있음).

## 3단계 — 자격 판정

각 공고를 1단계의 **모든 주체**와 대조한다(OR 매칭 — 한 주체라도 충족하면 해당).
공고 원문 요건은 `scan.json`의 `requirementText`(목록 API 요약) + 필요 시 `detailUrl`을 WebFetch로 보강.
판정은 LLM(너) 자신이 수행하며 결과를 두 값으로 남긴다:

- `eligibility`: **해당** | **해당없음** | **검토필요**(정보 부족)
- `eligibilityReason`: 한 줄 근거 — **어느 주체로 해당/배제인지 명시**(예: "주체2(예비창업자)로 해당", "전 주체 소재지 미달 → 해당없음").

보수적으로: 모든 주체가 명백히 배제면 `해당없음`, 한 주체라도 명백히 충족이면 `해당`, 애매하면 `검토필요`(스킵 말고 DB엔 기록).

## 4단계 — DB 기록 (조사한 전건)

판정 결과를 포함해 **스캔한 모든 건**을 Google Sheet에 upsert 한다.

```bash
node <SKILL>/scripts/db_sync.mjs --config config.json --in scan.json
# 키: (출처 + 사업ID) → 신규는 추가, 기존은 status 보존하며 메타만 갱신
```
- 컬럼·상태 라이프사이클: `references/db-schema.md`.
- **상태 초기값**: `해당` → `작성중`, `해당없음` → `해당없음`, `검토필요` → `보류`.
- 멱등: 재실행해도 중복 없음. 이미 `결과대기/선정/탈락/완료`인 행의 status는 **덮어쓰지 않는다**.
- 동기화 후 db_sync는 신규/갱신/스킵 건수를 출력 → 사용자에게 보고.

## 5단계 — 문서 작성 (해당 건, 확인 후)

DB 기록 뒤, `status=작성중`(자격 해당) 목록을 **사용자에게 보여주고** 어떤 건을 작성할지 고른다.
선택된 각 건마다:

1. 작업폴더에 `사업명-slug/` 폴더 생성, 공고 상세를 WebFetch로 수집.
2. [`kdr`](../kdr/SKILL.md) 스킬을 호출 → `report.md` 설계(신청서/사업계획서 양식) → 이미지(필요시) → `build_report.mjs`로 HWPX 조립 → `verify_report.mjs` 검증.
3. 산출물 경로(`.../output/report.hwpx`)를 해당 행의 `작성문서경로`에 기록(`db_sync.mjs --update` 사용).

> 자동 일괄 작성이 아니라 **건별 확인 후** 작성한다(토큰·시간 절약). "전부 작성"을 명시하면 일괄 진행.

---

## 상태 운영 (사용자 수동 갱신)

제출/결과는 사용자가 알려주면 status를 갱신한다:
`작성중 → 결과대기 → (선정|탈락) → 완료`, 언제든 `보류`. 갱신:
```bash
node <SKILL>/scripts/db_sync.mjs --config config.json --set "<출처>:<사업ID>=결과대기"
```

## 참고 문서
- `references/sources.md` — bizinfo/K-Startup API 엔드포인트·파라미터·필드매핑·키 발급법
- `references/db-schema.md` — Sheet 컬럼·상태 라이프사이클·멱등 규칙
- `references/eligibility-format.md` — 자격요건.md 양식·판정 기준
- `references/apps-script.md` — Sheet 읽기/쓰기용 Apps Script 웹앱 배포(Code.gs)
- `templates/` — 자격요건.md · config.json · Code.gs 원본
