#!/usr/bin/env node
// scan.mjs — bizinfo + K-Startup OpenAPI 에서 지원사업 공고를 모조리 수집해 정규화 scan.json 생성.
// 자격판정은 하지 않는다(그건 스킬=LLM 담당). 여기서는 수집·정규화·접수중 필터만.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}
const has = (n) => process.argv.includes('--' + n);

const cfgPath = arg('config', 'config.json');
const outPath = arg('out', 'scan.json');
const source = arg('source', 'all');
const probe = has('probe');
const openOnly = arg('open-only', null) === null ? true : arg('open-only') !== 'false';

const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const env = process.env;
const BIZ_KEY = cfg.bizinfoKey || env.BIZINFO_KEY;
const DGK_KEY = cfg.dataGoKrKey || env.DATA_GO_KR_KEY;

const sinceDays = Number(arg('since-days', cfg.scanSinceDays || 30));
const today = new Date(); today.setHours(0, 0, 0, 0);
const sinceDate = new Date(today.getTime() - sinceDays * 86400000);

// ---- helpers ----
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
function parseYmd(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]); d.setHours(0, 0, 0, 0);
  return isNaN(d) ? null : d;
}
const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return null; };

async function getJson(url) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
  try { return JSON.parse(txt); } catch (e) { throw new Error('non-JSON response: ' + txt.slice(0, 200)); }
}
function pickArray(j) {
  if (Array.isArray(j)) return j;
  for (const k of ['jsonArray', 'items', 'data', 'result', 'list', 'response']) {
    if (Array.isArray(j?.[k])) return j[k];
    if (j?.[k] && Array.isArray(j[k].items)) return j[k].items;
    if (j?.[k]?.body?.items) { const it = j[k].body.items; return Array.isArray(it) ? it : (it.item || []); }
  }
  if (j?.body?.items) { const it = j.body.items; return Array.isArray(it) ? it : (it.item || []); }
  return [];
}

// ---- bizinfo ----
async function scanBizinfo() {
  if (!BIZ_KEY) return { items: [], note: 'no bizinfoKey' };
  const p = new URLSearchParams({ crtfcKey: BIZ_KEY, dataType: 'json', searchCnt: String(arg('count', 200)) });
  const url = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?${p}`;
  const j = await getJson(url);
  const arr = pickArray(j);
  if (probe && arr[0]) console.error('[probe bizinfo keys]', Object.keys(arr[0]));
  const items = arr.map(it => {
    const span = pick(it, ['reqstBeginEndDe', 'rceptPd', 'applyPd']);
    let s = null, e = null;
    if (span && /~/.test(span)) { const [a, b] = String(span).split('~'); s = parseYmd(a); e = parseYmd(b); }
    else { s = parseYmd(pick(it, ['reqstBeginDe', 'rceptBeginDe'])); e = parseYmd(pick(it, ['reqstEndDe', 'rceptEndDe'])); }
    const id = pick(it, ['pblancId', 'pblntfId', 'id', 'seq']);
    return {
      source: 'bizinfo', id: id ? String(id) : null,
      title: pick(it, ['pblancNm', 'pblntfNm', 'title']),
      org: pick(it, ['jrsdInsttNm', 'excInsttNm', 'organ']),
      field: pick(it, ['pldirSportRealmLclasCodeNm', 'fldNm', 'category']),
      applyStart: toISO(s), applyEnd: toISO(e),
      detailUrl: pick(it, ['pblancUrl', 'rdfUrl']) ||
        (id ? `https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=${id}` : null),
      requirementText: [pick(it, ['bsnsSumryCn', 'cn', 'sumry']), pick(it, ['trgetNm', 'sportTrget'])].filter(Boolean).join(' / '),
      registeredAt: toISO(parseYmd(pick(it, ['creatPnttm', 'regDt', 'registDt']))),
      raw: it,
    };
  });
  return { items };
}

// ---- K-Startup ----
async function scanKstartup() {
  if (!DGK_KEY) return { items: [], note: 'no dataGoKrKey' };
  const base = cfg.kstartupEndpoint ||
    'https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01';
  const perPage = Number(arg('count', 200));
  // serviceKey 는 이미 인코딩된 경우가 많아 수동 append (이중인코딩 방지). 실패 시 인코딩 재시도.
  const qs = `page=1&perPage=${perPage}&returnType=json`;
  const tryUrls = [
    `${base}?serviceKey=${DGK_KEY}&${qs}`,
    `${base}?serviceKey=${encodeURIComponent(DGK_KEY)}&${qs}`,
  ];
  let j, lastErr;
  for (const u of tryUrls) { try { j = await getJson(u); break; } catch (e) { lastErr = e; } }
  if (!j) throw lastErr;
  const arr = pickArray(j);
  if (probe && arr[0]) console.error('[probe kstartup keys]', Object.keys(arr[0]));
  const items = arr.map(it => {
    const id = pick(it, ['pbanc_sn', 'pbancSn', 'id']);
    return {
      source: 'kstartup', id: id ? String(id) : null,
      title: pick(it, ['biz_pbanc_nm', 'intg_pbanc_biz_nm', 'bizPbancNm', 'title']),
      org: pick(it, ['pbanc_ntrp_nm', 'pbancNtrpNm', 'excInsttNm']),
      field: pick(it, ['supt_biz_clsfc', 'suptBizClsfc', 'biz_category']),
      applyStart: toISO(parseYmd(pick(it, ['pbanc_rcpt_bgng_dt', 'pbancRcptBgngDt']))),
      applyEnd: toISO(parseYmd(pick(it, ['pbanc_rcpt_end_dt', 'pbancRcptEndDt']))),
      detailUrl: pick(it, ['detl_pg_url', 'detlPgUrl']),
      requirementText: [pick(it, ['aply_trgt_ctnt', 'aplyTrgtCtnt']), pick(it, ['supt_regin', 'suptRegin']), pick(it, ['biz_gdnc_url'])].filter(Boolean).join(' / '),
      registeredAt: null,
      raw: it,
    };
  });
  return { items };
}

// ---- run ----
const out = { scannedAt: new Date().toISOString(), filters: { openOnly, sinceDays }, sources: {}, items: [] };
const tasks = [];
if (source === 'all' || source === 'bizinfo') tasks.push(['bizinfo', scanBizinfo]);
if (source === 'all' || source === 'kstartup') tasks.push(['kstartup', scanKstartup]);

for (const [name, fn] of tasks) {
  try {
    const r = await fn();
    out.sources[name] = { count: r.items.length, note: r.note || null };
    out.items.push(...r.items);
  } catch (e) {
    out.sources[name] = { count: 0, error: String(e.message || e) };
    console.error(`[${name}] ERROR:`, e.message || e);
  }
}

// 접수중 필터 + 등록일 하한
let items = out.items;
if (openOnly) items = items.filter(it => !it.applyEnd || parseYmd(it.applyEnd) >= today);
items = items.filter(it => {
  if (!it.registeredAt) return true;
  return parseYmd(it.registeredAt) >= sinceDate;
});
// key 부여 + id 없는 항목 제거
items = items.filter(it => it.id).map(it => ({ ...it, key: `${it.source}:${it.id}` }));
// dedup
const seen = new Set();
items = items.filter(it => seen.has(it.key) ? false : (seen.add(it.key), true));

out.items = items;
out.total = items.length;
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  scannedAt: out.scannedAt, sources: out.sources, total: out.total, out: outPath,
  note: '다음: scan.json 의 각 item 을 자격요건.md 와 대조해 eligibility/eligibilityReason 을 채운 뒤 db_sync.mjs',
}, null, 2));
