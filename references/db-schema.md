# DB 스키마 — Google Sheet (gid=0)

스프레드시트는 **각 사용자가 본인 것을 사용**한다(시트 `DB`, gid=0 권장). `config.json.sheetId`는 참고용(선택).
읽기/쓰기는 **Apps Script 웹앱**을 경유한다(`references/apps-script.md`). 비공개 시트라 직접 접근 불가.

## 컬럼(1행 헤더, 고정 순서)

| # | 컬럼 | 설명 |
|---|---|---|
| 1 | `key` | **고유키** = `<source>:<id>` (예: `bizinfo:PBLN_000...`). upsert 기준. |
| 2 | `source` | `bizinfo` / `kstartup` |
| 3 | `id` | 원본 공고 고유ID |
| 4 | `title` | 사업명 |
| 5 | `org` | 소관/수행기관 |
| 6 | `field` | 분야 |
| 7 | `applyStart` | 신청시작일 (YYYY-MM-DD) |
| 8 | `applyEnd` | 신청마감일 (YYYY-MM-DD) |
| 9 | `detailUrl` | 공고 상세 URL |
| 10 | `eligibility` | 자격판정: `해당` / `해당없음` / `검토필요` |
| 11 | `eligibilityReason` | 판정 근거 한 줄 |
| 12 | `status` | **상태**(아래 라이프사이클) |
| 13 | `docPath` | 작성된 HWPX 경로(작업폴더 기준) |
| 14 | `firstSeen` | 최초 기록일 |
| 15 | `updatedAt` | 갱신일 |
| 16 | `note` | 비고(수동 메모) |

## 상태(status) 라이프사이클

```
                ┌─ 해당없음            (자격 미해당 — 종착)
스캔/판정 ─────┤
                ├─ 보류  ──────────────(검토필요 또는 수동 보류)
                │
                └─ 작성중 ─→ 결과대기 ─→ ┬─ 선정 ─→ 완료
                  (자격 해당)  (제출함)   └─ 탈락
```

- **초기값**(db_sync 신규 insert 시):
  - `eligibility=해당` → `status=작성중`
  - `eligibility=해당없음` → `status=해당없음`
  - `eligibility=검토필요` → `status=보류`
- **수동 전이**: 사용자가 진행 상황을 알려주면 `db_sync.mjs --set "key=값"`으로 갱신.

## 멱등(upsert) 규칙

- 키 존재 → **메타 컬럼만 갱신**(title/org/field/applyEnd/detailUrl/eligibility/eligibilityReason/updatedAt).
- `status`는 다음 경우 **덮어쓰지 않는다**(사용자 진행상태 보호):
  - 기존 status가 `결과대기 / 선정 / 탈락 / 완료 / 보류` 중 하나면 그대로 유지.
  - 기존이 `작성중`이고 새 판정이 `해당없음`이면 → `해당없음`으로 강등(아직 손 안 댔으므로). 단 `docPath`가 있으면 유지.
- 키 없음 → 신규 row 추가(초기값 규칙 적용), `firstSeen`·`updatedAt` 기록.

## 통계 출력

db_sync는 동기화 후 `{ inserted, updated, skipped, byStatus }`를 출력한다 → 사용자에게 요약 보고.
