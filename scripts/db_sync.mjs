#!/usr/bin/env node
// db_sync.mjs — Apps Script 웹앱을 경유해 Google Sheet 와 동기화.
//   --in <judged.json>           : items(eligibility 포함) upsert
//   --read                       : 전체 행 조회(출력)
//   --set "<key>=<status>"       : status 갱신
//   --update "<key>:docPath=<경로>" : 임의 컬럼 1개 갱신
import { readFileSync, existsSync } from 'node:fs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}
const has = (n) => process.argv.includes('--' + n);

const cfg = JSON.parse(readFileSync(arg('config', 'config.json'), 'utf8'));
const env = process.env;
const URL_ = cfg.webappUrl || env.GS_WEBAPP_URL;
const SECRET = cfg.webappSecret || env.GS_WEBAPP_SECRET;
if (!URL_ || !SECRET) { console.error('webappUrl / webappSecret 누락 — references/apps-script.md 참고'); process.exit(1); }

async function call(payload) {
  const r = await fetch(URL_, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SECRET, ...payload }),
  });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { throw new Error('non-JSON from webapp: ' + txt.slice(0, 300)); }
  if (!j.ok) throw new Error('webapp error: ' + (j.error || JSON.stringify(j)));
  return j;
}

const COLS = ['key', 'source', 'id', 'title', 'org', 'field', 'applyStart', 'applyEnd',
  'detailUrl', 'eligibility', 'eligibilityReason', 'status', 'docPath', 'note'];

try {
  if (has('ping')) {
    const j = await call({ action: 'ping' });
    const headOk = Array.isArray(j.headers) && j.headers[0] === 'key' && j.headers.includes('status');
    console.log(JSON.stringify({
      ok: true, sheet: j.sheet, rowCount: j.rowCount, version: j.version,
      headerValid: headOk,
      verdict: headOk ? '연결 정상 ✅ (시트 도달·인증·헤더 OK)' : '⚠️ 연결됐으나 헤더 비정상 — Code.gs HEADERS 확인',
    }, null, 2));
    if (!headOk) process.exit(2);
  } else if (has('selftest')) {
    // 비파괴 round-trip: 센티넬 행 upsert → read 확인 → delete → 원상복구
    const K = '__selftest__:0';
    const sentinel = { key: K, source: '__selftest__', id: '0', title: 'gov-scan 연결테스트', eligibility: '해당없음' };
    const up = await call({ action: 'upsert', rows: [sentinel] });
    const rd = await call({ action: 'read' });
    const found = rd.rows.find(r => r.key === K);
    const del = await call({ action: 'delete', key: K });
    const after = await call({ action: 'read' });
    const cleaned = !after.rows.find(r => r.key === K);
    const pass = !!found && cleaned;
    console.log(JSON.stringify({
      ok: pass,
      steps: { upsert: up.inserted + up.updated > 0, readBack: !!found, deleted: del.ok === true, cleanedUp: cleaned },
      verdict: pass ? '쓰기/읽기/삭제 round-trip 통과 ✅ — DB 신뢰 가능' : '❌ round-trip 실패 — apps-script.md 점검',
    }, null, 2));
    if (!pass) process.exit(2);
  } else if (has('read')) {
    const j = await call({ action: 'read' });
    console.log(JSON.stringify({ ok: true, count: j.rows.length, rows: j.rows }, null, 2));
  } else if (arg('set', null)) {
    const [key, status] = String(arg('set')).split('=');
    await call({ action: 'setStatus', key: key.trim(), status: status.trim() });
    console.log(JSON.stringify({ ok: true, set: { key: key.trim(), status: status.trim() } }));
  } else if (arg('update', null)) {
    // 형식: key:field=value
    const m = String(arg('update')).match(/^(.+?):(\w+)=(.*)$/);
    if (!m) throw new Error('--update 형식: "<key>:<field>=<value>"');
    await call({ action: 'setField', key: m[1].trim(), field: m[2].trim(), value: m[3] });
    console.log(JSON.stringify({ ok: true, update: { key: m[1].trim(), field: m[2], value: m[3] } }));
  } else if (has('report')) {
    // 해당/검토 건만 별도 탭으로 뷰 생성(+이름변경). --report [탭이름] --statuses "작성중,보류"
    const tn = arg('report', null);
    const targetName = (typeof tn === 'string') ? tn : undefined;
    const statuses = arg('statuses', null) ? String(arg('statuses')).split(',').map(s => s.trim()) : undefined;
    const j = await call({ action: 'report', targetName, statuses });
    console.log(JSON.stringify(j, null, 2));
  } else if (arg('in', null)) {
    const inPath = arg('in');
    if (!existsSync(inPath)) throw new Error('no input: ' + inPath);
    const data = JSON.parse(readFileSync(inPath, 'utf8'));
    const items = Array.isArray(data) ? data : (data.items || []);
    const rows = items.filter(it => it.key || (it.source && it.id)).map(it => {
      const row = {};
      for (const c of COLS) if (it[c] != null) row[c] = it[c];
      row.key = it.key || `${it.source}:${it.id}`;
      if (!row.eligibility) { row.eligibility = '검토필요'; }
      return row;
    });
    const j = await call({ action: 'upsert', rows });
    console.log(JSON.stringify({
      ok: true, sent: rows.length,
      inserted: j.inserted, updated: j.updated, skipped: j.skipped, byStatus: j.byStatus,
    }, null, 2));
  } else {
    console.error('사용: --ping | --selftest | --in <json> | --read | --set "key=status" | --update "key:field=value"');
    process.exit(1);
  }
} catch (e) {
  console.error('ERROR:', e.message || e);
  process.exit(1);
}
