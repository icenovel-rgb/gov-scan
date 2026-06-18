# gov-scan — 정부지원사업 자동 스캔·판정·작성 스킬

정부지원사업을 **공식 OpenAPI**로 모조리 스캔하고, 회사 자격요건과 대조해 신청가능 여부를
자동 판정하며, 조사한 **전건을 Google Sheet에 기록**하는 Claude Code 스킬입니다.
자격에 해당하는 건은 [`kdr`](https://github.com/icenovel-rgb/kdr) 스킬로 한글(HWPX) 신청서까지 작성합니다.

```
자격요건.md ─┐
             ├─ scan(bizinfo+K-Startup) ─→ 자격판정 ─→ Google Sheet DB(전건 기록)
config.json ─┘                                   │
                                                 └─ (해당 & 확인) ─→ kdr ─→ *.hwpx
```

발동된 **작업폴더**에서 동작합니다. `~/.claude/skills/gov-scan/`에 두고 `/gov-scan`으로 호출.

## 무엇을 하나

- **스캔**: 기업마당(bizinfo, 중앙·지자체·유관기관 통합 8개 분야) + K-Startup(창업) OpenAPI에서 접수중 공고 수집
- **판정**: `자격요건.md`(회사 프로파일) vs 공고 신청자격 → `해당 / 해당없음 / 검토필요` + 사유
- **DB 기록**: 조사한 **모든 건**을 시트에 upsert. 상태값 `해당없음·작성중·결과대기·탈락·선정·완료·보류` (재스캔해도 진행상태 보존)
- **문서작성**: 해당 건을 사용자 확인 후 `kdr`로 HWPX 신청서/사업계획서 생성

## 설치

```bash
git clone https://github.com/icenovel-rgb/gov-scan.git ~/.claude/skills/gov-scan
# 한글 문서 작성용 kdr 스킬도 필요
git clone https://github.com/icenovel-rgb/kdr.git ~/.claude/skills/kdr
```

## 준비 (키만 넣으면 됨)

작업폴더에서 `/gov-scan` 호출 → `setup`이 `자격요건.md`·`config.json`을 생성합니다. 아래 3가지를 채우세요.

| 항목 | 발급/생성 | config.json 키 |
|---|---|---|
| 기업마당 인증키 | [bizinfo.go.kr](https://www.bizinfo.go.kr) → 활용정보 → 정책정보 개방 → 활용신청(무료) | `bizinfoKey` |
| 공공데이터 인증키 | [data.go.kr 데이터 15125364](https://www.data.go.kr/data/15125364/openapi.do) → 활용신청(무료, 즉시승인) | `dataGoKrKey` |
| Google Sheet 웹앱 | 본인 시트에 `templates/Code.gs` 배포(1회) → 웹앱 URL | `webappUrl`, `webappSecret` |

> 두 OpenAPI 키는 독립적입니다 — 하나만 넣어도 그 소스만으로 동작합니다.
> Google Sheet은 **본인 시트**를 쓰며, 비공개 시트라 직접 접근이 안 되므로 Apps Script 웹앱을 경유합니다.
> 자세한 절차: [`references/sources.md`](references/sources.md), [`references/apps-script.md`](references/apps-script.md).

## 사용

```text
/gov-scan
```
→ 자격요건 로드 → 스캔 → 판정 → DB 기록 → (해당 건 확인 후) kdr로 문서 작성.

스크립트 직접 호출:
```bash
node ~/.claude/skills/gov-scan/scripts/setup.mjs                       # 작업폴더 초기화/점검
node ~/.claude/skills/gov-scan/scripts/scan.mjs --config config.json   # 스캔 → scan.json
node ~/.claude/skills/gov-scan/scripts/db_sync.mjs --config config.json --in judged.json   # DB upsert
```

## 구성

```
SKILL.md                  # 오케스트레이션(0~5단계)
scripts/  setup.mjs · scan.mjs · db_sync.mjs
references/ sources.md · db-schema.md · eligibility-format.md · apps-script.md
templates/ 자격요건.md · config.json · Code.gs
```

## 라이선스

MIT. 한글 문서 작성은 외부 스킬 [kdr](https://github.com/icenovel-rgb/kdr)에 위임합니다.
