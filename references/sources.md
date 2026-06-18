# 데이터 소스 — API 엔드포인트·필드매핑·키 발급

정부지원사업은 **공식 OpenAPI 2종**으로 수집한다(HTML 크롤링보다 안정적). 둘 다 무료.

---

## A. 기업마당 bizinfo — 지원사업정보 API

중앙부처·지자체·유관기관의 지원사업 공고 **통합**. 분야 8종(금융/기술/인력/수출/내수/창업/경영/기타).

- **엔드포인트**: `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do`
- **인증**: 쿼리파라미터 `crtfcKey=<발급키>`
- **응답형식**: `dataType=json` (기본 XML/RSS)
- **주요 파라미터**
  | 파라미터 | 의미 | 예 |
  |---|---|---|
  | `crtfcKey` | 인증키(필수) | `xxxxxxxx` |
  | `dataType` | 응답형식 | `json` |
  | `searchCnt` | 가져올 건수 | `100` |
  | `searchLclasId` | 분야 대분류 코드(선택) | `01`~`08` |
  | `hashtags` | 키워드(선택) | `창업` |

- **응답 필드 매핑**(목록 item → 정규화 스키마). *포털 개정 가능 → 첫 실행 시 `scan.mjs --probe`로 원본 키 확인 후 대조.*
  | 정규화 키 | bizinfo 원본 후보키 |
  |---|---|
  | `id` | `pblancId` |
  | `title` | `pblancNm` |
  | `org` | `jrsdInsttNm`(소관) / `excInsttNm`(수행) |
  | `field` | `pldirSportRealmLclasCodeNm` |
  | `applyStart`/`applyEnd` | `reqstBeginEndDe`("YYYYMMDD ~ YYYYMMDD" 파싱) |
  | `registeredAt` | `creatPnttm` |
  | `detailUrl` | `pblancUrl` (없으면 `https://www.bizinfo.go.kr/...view.do?pblancId=<id>` 합성) |
  | `requirementText` | `bsnsSumryCn`(사업개요) 등 요약 필드 |

### 키 발급 — bizinfo crtfcKey
1. https://www.bizinfo.go.kr 접속 → 회원가입/로그인.
2. **활용정보 → 정책정보 개방(OpenAPI)** → "지원사업정보 API" → **활용신청/인증키 발급**.
   (직접 경로: `apiList.do` → 지원사업정보 API 상세)
3. 발급된 `crtfcKey`를 `config.json.bizinfoKey` 또는 환경변수 `BIZINFO_KEY`에 입력.

---

## B. K-Startup — 사업공고 조회서비스 (공공데이터포털)

창업진흥원 사업공고·통합공고. REST, JSON, 개발계정 **10,000건/일** 무료.

- **포털 데이터**: https://www.data.go.kr/data/15125364/openapi.do (창업진흥원 K-Startup 조회서비스)
- **엔드포인트 형태**(data.go.kr 표준 조회서비스):
  `https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01`
  *오퍼레이션·버전 접미는 포털 상세에서 확인(개정 가능). `--probe`로 검증.*
- **인증**: 쿼리파라미터 `serviceKey=<디코딩키>` (URL인코딩 키면 그대로, 디코딩키면 인코딩 필요 — scan.mjs가 양쪽 시도)
- **주요 파라미터**: `page=1` · `perPage=100` · `returnType=json`
- **응답 필드 매핑**(`data[]` item → 정규화). *원본 키는 한글 약어. 첫 실행 시 `--probe`로 확인.*
  | 정규화 키 | K-Startup 원본 후보키 |
  |---|---|
  | `id` | `pbanc_sn` (공고일련번호) |
  | `title` | `biz_pbanc_nm` / `intg_pbanc_biz_nm` |
  | `org` | `pbanc_ntrp_nm`(수행기관) |
  | `field` | `supt_biz_clsfc` (지원분야) |
  | `applyStart`/`applyEnd` | `pbanc_rcpt_bgng_dt` / `pbanc_rcpt_end_dt` |
  | `detailUrl` | `detl_pg_url` |
  | `requirementText` | `aply_trgt_ctnt`(신청대상) + `supt_regin`(지원지역) |

### 키 발급 — data.go.kr serviceKey
1. https://www.data.go.kr 접속 → 회원가입/로그인.
2. 데이터 `15125364` 페이지에서 **활용신청** → 즉시 승인(자동).
3. 마이페이지 → 오픈API → 인증키(일반/Decoding) 확인 → `config.json.dataGoKrKey` 또는 환경변수 `DATA_GO_KR_KEY`.

---

## 정규화 출력 스키마 (scan.json)

```json
{
  "scannedAt": "<ISO8601, 호출 시 OS time>",
  "items": [
    {
      "source": "bizinfo|kstartup",
      "id": "<원본 고유ID>",
      "key": "<source>:<id>",
      "title": "사업명",
      "org": "소관/수행기관",
      "field": "분야",
      "applyStart": "YYYY-MM-DD|null",
      "applyEnd": "YYYY-MM-DD|null",
      "detailUrl": "https://...",
      "requirementText": "신청대상/지역/요건 요약",
      "registeredAt": "YYYY-MM-DD|null",
      "raw": { "...원본 item 보존..." }
    }
  ]
}
```

`raw`를 항상 보존해 필드매핑이 틀려도 판정 단계에서 원문을 참조할 수 있게 한다.

## 확장(선택)
- 지자체 개별 포털·나라장터(조달청)·각 부처 공고는 별도 어댑터로 `scan.mjs`에 추가 가능.
  현재 범위는 bizinfo + K-Startup로 충분한 커버리지를 갖는다.
