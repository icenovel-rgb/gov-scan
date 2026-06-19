#!/usr/bin/env node
// setup.mjs — 작업폴더에 자격요건.md / config.json 이 없으면 템플릿에서 생성하고, 설정 상태를 점검한다.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(__dir, '..');
const cwd = process.cwd();

function ensure(name, srcRel) {
  const dst = join(cwd, name);
  if (existsSync(dst)) return { name, status: 'exists' };
  copyFileSync(join(SKILL, srcRel), dst);
  return { name, status: 'created' };
}

const results = [
  ensure('자격요건.md', 'templates/자격요건.md'),
  ensure('config.json', 'templates/config.json'),
  ensure('crawl-sources.json', 'templates/crawl-sources.json'),
];

// config 점검
const cfgPath = join(cwd, 'config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const env = process.env;
const missing = [];
if (!(cfg.bizinfoKey || env.BIZINFO_KEY)) missing.push('bizinfoKey (BIZINFO_KEY)');
if (!(cfg.dataGoKrKey || env.DATA_GO_KR_KEY)) missing.push('dataGoKrKey (DATA_GO_KR_KEY)');
if (!(cfg.webappUrl || env.GS_WEBAPP_URL)) missing.push('webappUrl (GS_WEBAPP_URL)');
if (!(cfg.webappSecret || env.GS_WEBAPP_SECRET)) missing.push('webappSecret (GS_WEBAPP_SECRET)');

const profileFilled = readFileSync(join(cwd, '자격요건.md'), 'utf8').replace(/[#>\-\s]|\(.*?\)/g, '').length > 40;

console.log(JSON.stringify({
  cwd, files: results,
  config: { missingKeys: missing, ready: missing.length === 0 },
  profile: { filled: profileFilled },
  next: missing.length
    ? '키 발급 후 config.json 채우기 — references/sources.md, references/apps-script.md 참고'
    : (profileFilled ? '준비 완료 → scan.mjs 실행' : '자격요건.md 를 채운 뒤 scan.mjs 실행'),
}, null, 2));
