# Apps Script 웹앱 — 비공개 Sheet 읽기/쓰기

비공개 스프레드시트(401)에 인증파일 없이 접근하기 위해, 스프레드시트에 **Apps Script 웹앱**을
1회 배포한다. 스킬(`db_sync.mjs`)은 이 URL로 JSON POST/GET 한다.

## 배포 절차 (1회, 사용자가 수행)

1. 대상 스프레드시트 열기 → 메뉴 **확장 프로그램 → Apps Script**.
2. `templates/Code.gs`(아래 동일) 전체를 붙여넣기. 맨 위 `SECRET`를 임의의 긴 문자열로 바꾼다.
3. **배포 → 새 배포 → 유형: 웹 앱**.
   - 실행 계정: **나(소유자)**
   - 액세스 권한: **모든 사용자**(토큰으로 보호되므로 안전) — 또는 "링크가 있는 모든 사용자"
4. 권한 승인(최초 1회) → 배포 후 **웹 앱 URL**(`https://script.google.com/macros/s/.../exec`)을 복사.
5. `config.json`에 입력:
   ```json
   { "webappUrl": "https://script.google.com/macros/s/XXXX/exec", "webappSecret": "<위 SECRET와 동일>" }
   ```

## 코드 변경 후 재배포
스크립트를 수정하면 **배포 → 배포 관리 → 편집(연필) → 버전: 새 버전 → 배포**. URL은 유지된다.

## API 계약 (db_sync.mjs ↔ 웹앱)

POST JSON `{ secret, action, ... }`:

| action | payload | 동작 |
|---|---|---|
| `ping` | — | 연결/인증/헤더 점검. `{sheet, headers, rowCount, version}` 반환(쓰기 없음) |
| `read` | — | 전체 행을 객체배열로 반환 |
| `upsert` | `rows: [...]` | 키(`key`) 기준 upsert. 멱등규칙은 db-schema.md. 응답 `{inserted, updated, skipped, byStatus}` |
| `setStatus` | `key, status` | 해당 행 status 갱신 |
| `setField` | `key, field, value` | 임의 컬럼 1개 갱신(예: docPath) |
| `delete` | `key` | 해당 행 삭제(self-test 정리용) |

GET `?secret=...&action=read` 도 동일하게 read 지원(빠른 점검용).

응답: `{ ok: true, ... }` 또는 `{ ok: false, error }`.

## 배포 직후 검증 (필수)

URL을 config.json 에 넣은 뒤 **반드시** 연결을 검증한다:

```bash
node <SKILL>/scripts/db_sync.mjs --config config.json --ping       # 연결·인증·헤더 OK?
node <SKILL>/scripts/db_sync.mjs --config config.json --selftest   # 쓰기→읽기→삭제 round-trip
```
- `--ping`: 시트 도달·SECRET 일치·헤더 정상 확인(쓰기 없음).
- `--selftest`: 센티넬 행을 넣고 되읽어 확인한 뒤 삭제까지 검증(비파괴). `통과 ✅` 떠야 DB를 신뢰.
- 실패 시: URL/SECRET 오타, 배포 액세스 권한(모든 사용자), Code.gs 버전(재배포) 점검.

---

## Code.gs (전문 — templates/Code.gs와 동일)

```javascript
const SECRET = 'CHANGE_ME_to_a_long_random_string';   // ← 반드시 변경
const SHEET_NAME = 'DB';
const HEADERS = ['key','source','id','title','org','field','applyStart','applyEnd',
  'detailUrl','eligibility','eligibilityReason','status','docPath','firstSeen','updatedAt','note'];
const KEEP_STATUS = ['결과대기','선정','탈락','완료','보류'];   // status 덮어쓰기 금지 집합

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); }
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); }
  return sh;
}
function nowStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd');
}
function readAll_(sh) {
  const vals = sh.getDataRange().getValues();
  const head = vals.shift() || HEADERS;
  return vals.map(r => { const o = {}; head.forEach((h,i)=>o[h]=r[i]); return o; });
}
function indexByKey_(sh) {
  const vals = sh.getDataRange().getValues(); vals.shift();
  const m = {}; vals.forEach((r,i)=>{ if (r[0]) m[r[0]] = i + 2; }); // 1-based, +헤더
  return m;
}
function rowFromObj_(o) { return HEADERS.map(h => o[h] != null ? o[h] : ''); }

function upsert_(sh, rows) {
  const idx = indexByKey_(sh);
  let inserted=0, updated=0, skipped=0;
  rows.forEach(item => {
    const key = item.key;
    if (!key) { skipped++; return; }
    if (idx[key]) {
      const rownum = idx[key];
      const cur = {}; HEADERS.forEach((h,i)=>cur[h]=sh.getRange(rownum,i+1).getValue());
      // status 보호
      let status = cur.status;
      if (KEEP_STATUS.indexOf(cur.status) === -1) {
        // 작성중/해당없음/빈값 → 새 판정 반영
        if (item.eligibility === '해당') status = (cur.docPath ? cur.status : '작성중');
        else if (item.eligibility === '해당없음') status = (cur.docPath ? cur.status : '해당없음');
        else if (item.eligibility === '검토필요') status = '보류';
        if (!status) status = cur.status;
      }
      const merged = Object.assign({}, cur, {
        title:item.title, org:item.org, field:item.field, applyStart:item.applyStart,
        applyEnd:item.applyEnd, detailUrl:item.detailUrl, eligibility:item.eligibility,
        eligibilityReason:item.eligibilityReason, status:status, updatedAt:nowStr_()
      });
      sh.getRange(rownum,1,1,HEADERS.length).setValues([rowFromObj_(merged)]);
      updated++;
    } else {
      let status = '보류';
      if (item.eligibility === '해당') status = '작성중';
      else if (item.eligibility === '해당없음') status = '해당없음';
      const row = Object.assign({}, item, {
        status: item.status || status, firstSeen: nowStr_(), updatedAt: nowStr_()
      });
      sh.appendRow(rowFromObj_(row));
      inserted++;
    }
  });
  const byStatus = {};
  readAll_(sh).forEach(r => { byStatus[r.status] = (byStatus[r.status]||0)+1; });
  return { inserted, updated, skipped, byStatus };
}

function setCell_(sh, key, field, value) {
  const idx = indexByKey_(sh);
  if (!idx[key]) return { ok:false, error:'key not found: '+key };
  const col = HEADERS.indexOf(field); if (col < 0) return { ok:false, error:'bad field: '+field };
  sh.getRange(idx[key], col+1).setValue(value);
  sh.getRange(idx[key], HEADERS.indexOf('updatedAt')+1).setValue(nowStr_());
  return { ok:true };
}

function deleteRow_(sh, key) {
  const idx = indexByKey_(sh);
  if (!idx[key]) return { ok:false, error:'key not found: ' + key };
  sh.deleteRow(idx[key]);
  return { ok:true, deleted: key };
}

function handle_(params) {
  if (params.secret !== SECRET) return { ok:false, error:'unauthorized' };
  const sh = sheet_();
  switch (params.action) {
    case 'ping':      return { ok:true, sheet: sh.getName(), headers: HEADERS,
                               rowCount: Math.max(0, sh.getLastRow() - 1), version: 2 };
    case 'read':      return { ok:true, rows: readAll_(sh) };
    case 'upsert':    return Object.assign({ ok:true }, upsert_(sh, params.rows || []));
    case 'setStatus': return Object.assign({ ok:true }, setCell_(sh, params.key, 'status', params.status));
    case 'setField':  return Object.assign({ ok:true }, setCell_(sh, params.key, params.field, params.value));
    case 'delete':    return deleteRow_(sh, params.key);
    default:          return { ok:false, error:'unknown action' };
  }
}
function doPost(e) {
  let p = {}; try { p = JSON.parse(e.postData.contents); } catch(_) {}
  return ContentService.createTextOutput(JSON.stringify(handle_(p)))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify(handle_(e.parameter || {})))
    .setMimeType(ContentService.MimeType.JSON);
}
```
