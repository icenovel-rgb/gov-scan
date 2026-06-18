#!/usr/bin/env node
// collect.mjs — judged.json 에서 status/eligibility 로 고른 사업마다 폴더를 만들고
// 공고문·첨부서식(신청서·가이드·FAQ 등)을 내려받고 공고요약(공고.md)·메타를 저장한다.
//   node collect.mjs --in judged.json --status 작성중 [--eligibility 해당] [--out-dir 사업]
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}
const inPath = arg('in', 'judged.json');
const wantStatus = arg('status', null);       // 예: 작성중
const wantElig = arg('eligibility', null);    // 예: 해당
const outDir = arg('out-dir', '사업');

const data = JSON.parse(readFileSync(inPath, 'utf8'));
let items = data.items || [];
if (wantElig) items = items.filter(i => i.eligibility === wantElig);
if (wantStatus) items = items.filter(i => (i.status || statusFromElig(i.eligibility)) === wantStatus);
if (!wantElig && !wantStatus) items = items.filter(i => i.eligibility === '해당'); // 기본: 해당만

function statusFromElig(e) { return e === '해당' ? '작성중' : e === '해당없음' ? '해당없음' : '보류'; }
const slug = (s) => (s || 'untitled').replace(/[\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const splitAt = (s) => (s ? String(s).split('@').map(x => x.trim()).filter(Boolean) : []);

async function download(url, dest) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 64) return { ok: false, error: `too small (${buf.length}B)` };
    writeFileSync(dest, buf);
    return { ok: true, bytes: buf.length };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

mkdirSync(outDir, { recursive: true });
const report = [];

for (const it of items) {
  const dir = join(outDir, slug(it.title));
  mkdirSync(dir, { recursive: true });
  const raw = it.raw || {};
  const files = [];

  // 공고문 (printFlpthNm / printFileNm)
  const annUrls = splitAt(raw.printFlpthNm), annNames = splitAt(raw.printFileNm);
  annUrls.forEach((u, i) => files.push({ kind: '공고문', url: u, name: annNames[i] || `공고문_${i + 1}` }));
  // 첨부 서식 (flpthNm / fileNm)
  const atUrls = splitAt(raw.flpthNm), atNames = splitAt(raw.fileNm);
  atUrls.forEach((u, i) => files.push({ kind: '첨부', url: u, name: atNames[i] || `첨부_${i + 1}` }));

  const dl = [];
  for (const f of files) {
    let name = f.name.replace(/[\/\\:*?"<>|]/g, '_');
    if (!/\.\w{2,5}$/.test(name)) name += '.bin';
    const res = await download(f.url, join(dir, name));
    dl.push({ ...f, name, ...res });
  }

  // 공고 요약 (공고.md)
  const md = [
    `# ${it.title}`, '',
    `- **출처/키**: ${it.source} · ${it.key}`,
    `- **소관/수행**: ${it.org || '-'}`,
    `- **분야**: ${it.field || '-'}`,
    `- **신청기간**: ${it.applyStart || '?'} ~ ${it.applyEnd || '?'}`,
    `- **자격판정**: ${it.eligibility} — ${it.eligibilityReason || ''}`,
    `- **상세공고**: ${it.detailUrl || '-'}`,
    `- **접수방법**: ${raw.reqstMthPapersCn || '-'}`,
    `- **접수처(URL)**: ${raw.rceptEngnHmpgUrl || '-'}`,
    '', '## 사업개요', '', (raw.bsnsSumryCn || '(요약 없음)').replace(/<[^>]+>/g, ''),
    '', '## 신청대상', '', (raw.trgetNm || '-'),
    '', '## 수집 파일', '',
    ...dl.map(d => `- [${d.kind}] ${d.name} — ${d.ok ? `${d.bytes}B ✅` : `실패(${d.error})`}`),
  ].join('\n');
  writeFileSync(join(dir, '공고.md'), md);
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(it, null, 2));

  report.push({ title: it.title, dir, downloaded: dl.filter(d => d.ok).length, failed: dl.filter(d => !d.ok).length });
}

console.log(JSON.stringify({ outDir, count: report.length, items: report }, null, 2));
