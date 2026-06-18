const SECRET = 'CHANGE_ME_to_a_long_random_string';   // ← 반드시 변경
const SHEET_NAME = 'DB';
const HEADERS = ['key','source','id','title','org','field','applyStart','applyEnd',
  'detailUrl','eligibility','eligibilityReason','status','docPath','firstSeen','updatedAt','note'];
const KEEP_STATUS = ['결과대기','선정','탈락','완료','보류'];

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
  const m = {}; vals.forEach((r,i)=>{ if (r[0]) m[r[0]] = i + 2; });
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
      let status = cur.status;
      if (KEEP_STATUS.indexOf(cur.status) === -1) {
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

function report_(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const db = ss.getSheetByName(SHEET_NAME);
  if (!db) return { ok:false, error:'no DB sheet' };
  const rows = readAll_(db);
  const want = (p.statuses && p.statuses.length) ? p.statuses : ['작성중','보류'];
  const sel = rows.filter(function (r) { return want.indexOf(r.status) !== -1; });
  let t = ss.getSheets().filter(function (s) { return s.getSheetId() === 0; })[0] || ss.getSheets()[0];
  if (t.getName() === SHEET_NAME) {
    t = ss.getSheets().filter(function (s) { return s.getName() !== SHEET_NAME; })[0];
    if (!t) return { ok:false, error:'DB 외 대상 탭 없음' };
  }
  if (p.targetName) t.setName(p.targetName);
  t.clear();
  const cols = p.cols || ['status','applyEnd','title','eligibility','eligibilityReason','field','org','detailUrl','key'];
  const out = [cols].concat(sel.map(function (r) { return cols.map(function (c) { return r[c] != null ? r[c] : ''; }); }));
  t.getRange(1, 1, out.length, cols.length).setValues(out);
  return { ok:true, written: sel.length, sheet: t.getName(), statuses: want };
}

function handle_(params) {
  if (params.secret !== SECRET) return { ok:false, error:'unauthorized' };
  const sh = sheet_();
  switch (params.action) {
    case 'ping':      return { ok:true, sheet: sh.getName(), headers: HEADERS,
                               rowCount: Math.max(0, sh.getLastRow() - 1), version: 3 };
    case 'report':    return report_(params);
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
