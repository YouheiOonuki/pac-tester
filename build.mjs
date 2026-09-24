// pac-tester.html（1 ファイルで動くダウンロード版）と THIRD_PARTY_LICENSES.txt を作る
//
//   npm ci          # package.json で固定したライブラリを入れる（最初と、ライブラリを更新したとき）
//   node build.mjs
//
// - src/app.html に src/app.css・acorn・src/core.js・隔離用の枠（src/sandbox.html）・src/app.js をそのまま埋め込む
// - 隔離用の枠には src/pac-runtime.js と src/worker.js を文字列として入れる（枠の中で Blob にして Worker を起動する）
// - acorn は、パッケージがブラウザ用に配っているビルド済みのファイル（dist/acorn.js）を使う
// - 同梱ライブラリのライセンス全文を、pac-tester.html の末尾と THIRD_PARTY_LICENSES.txt に入れる
// - 日付など実行するたびに変わる値は入れない（同じ入力なら同じファイルになる。CI で確かめている）
// 依存パッケージなし（Node 20 以上）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const NM = path.join(ROOT, 'node_modules');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

if (!fs.existsSync(path.join(NM, 'acorn'))) {
  console.error('node_modules がありません。先に npm ci を実行してください。');
  process.exit(1);
}

const pkgJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

// ---------- 埋め込むライブラリ（ブラウザ用のビルド済みファイル） ----------
const LIBS = [
  { name: 'acorn', pkg: 'acorn', file: 'dist/acorn.js', license: 'MIT', use: 'PAC の構文を調べる（構文木を作るだけで、PAC は実行しない）' },
];
for (const lib of LIBS) {
  lib.version = pkgJson(path.join(NM, lib.pkg)).version;
  lib.code = fs.readFileSync(path.join(NM, lib.pkg, lib.file), 'utf8');
}

// ---------- ライセンス全文を集める ----------
function repoUrl(p) {
  let r = p.repository;
  if (r && typeof r === 'object') r = r.url;
  if (!r) return p.homepage || '';
  r = String(r).replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
  if (/^github:/.test(r)) r = 'https://github.com/' + r.slice(7);
  else if (/^[\w.-]+\/[\w.-]+$/.test(r)) r = 'https://github.com/' + r;
  return r;
}

function findPkg(name, fromDir) {
  let d = fromDir;
  for (;;) {
    const p = path.join(d, 'node_modules', name);
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
    if (d === ROOT) return null;
    d = path.dirname(d);
  }
}

// 同梱ライブラリと、その依存パッケージをすべてたどる（acorn 8 は依存なし）
const seen = new Map();
function walk(name, fromDir) {
  const dir = findPkg(name, fromDir);
  if (!dir) throw new Error('パッケージが見つかりません: ' + name);
  if (seen.has(dir)) return;
  const p = pkgJson(dir);
  seen.set(dir, p);
  for (const dep of Object.keys(p.dependencies || {}).sort()) {
    if (dep.startsWith('@types/')) continue;
    walk(dep, dir);
  }
}
for (const lib of LIBS) walk(lib.pkg, ROOT);

const entries = [];
for (const [dir, p] of seen) {
  const files = fs.readdirSync(dir).filter((f) => /^(licen[sc]e|copying)(\b|[-_.]|$)/i.test(f)).sort();
  if (!files.length) throw new Error('ライセンスのファイルがありません: ' + p.name);
  entries.push({
    name: p.name, version: p.version, license: p.license || '（ファイルを参照）', repo: repoUrl(p),
    text: files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n?/g, '\n').trim()).join('\n\n'),
  });
}
entries.sort((a, b) => (a.name + '@' + a.version).localeCompare(b.name + '@' + b.version, 'en'));

const RULE = '='.repeat(72);
let licenses = [
  'THIRD-PARTY SOFTWARE NOTICES / 同梱しているソフトウェアのライセンス',
  '',
  'PAC ファイル テスター（pac-tester.html）には、次のライブラリをそのまま埋め込んでいます。',
  ...LIBS.map((l) => `  - ${l.name} ${l.version}（npm: ${l.pkg}/${l.file}） ${l.license}`),
  '',
  '■ 本ツール自身のコード（src/core.js・src/pac-runtime.js・src/app.js ほか）',
  'MIT License, Copyright (c) 2026 Youhei Oonuki',
  'https://github.com/YouheiOonuki/pac-tester',
  '',
];
for (const e of entries) {
  licenses.push(RULE, `${e.name}@${e.version}  License: ${e.license}${e.repo ? '  ' + e.repo : ''}`, RULE, '', e.text, '');
}
licenses = licenses.join('\n').replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(path.join(ROOT, 'THIRD_PARTY_LICENSES.txt'), licenses + '\n');

// ---------- pac-tester.html を組み立てる ----------
// <script> の中に「</script」があると、そこで要素が終わってしまうので「<\/script」にする。
// 「<script」があると HTML の読み取りが別の状態に入るので、入っていたら止める（今のライブラリには無い）
function scriptSafe(code, label) {
  if (/<script/i.test(code)) throw new Error(label + ' に「<script」という文字列があります。埋め込み方を見直してください');
  return code.replace(/<\/script/gi, '<\\/script');
}
function scriptTag(code, label) {
  return `<script>/* ${label} */\n${scriptSafe(code, label)}\n</script>`;
}
// JavaScript の文字列リテラルにする。「<」は < にするので、script 要素の中に置いても HTML として読まれない
function jsString(s) {
  return JSON.stringify(s).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// 隔離用の枠（iframe の srcdoc に入れる HTML）。PAC の標準関数と Worker の部分は、枠の中で Blob にする文字列として入れる
const sandboxHtml = read('src/sandbox.html').replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
  if (k === 'RUNTIME_JSON') return jsString(read('src/pac-runtime.js'));
  if (k === 'WORKER_JSON') return jsString(read('src/worker.js'));
  throw new Error('未知の置き換え（sandbox.html）: ' + m);
});

const scripts = [
  ...LIBS.map((l) => scriptTag(l.code, `${l.name} ${l.version} | ${l.license} | 全文は末尾の id="licenses"`)),
  scriptTag(read('src/core.js'), 'PAC ファイル テスター: core.js | MIT'),
  scriptTag('window.PT_SANDBOX_HTML = ' + jsString(sandboxHtml) + ';', 'PAC ファイル テスター: 隔離用の枠（sandbox.html・pac-runtime.js・worker.js） | MIT'),
  scriptTag(read('src/app.js'), 'PAC ファイル テスター: app.js | MIT'),
].join('\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const libList = LIBS.map((l) => `        <li>${esc(l.name)} ${esc(l.version)}（${esc(l.license)}）… ${esc(l.use)}</li>`).join('\n');
const libSummary = LIBS.map((l) => `${l.name} ${l.version}`).join(', ');
const favicon = 'data:image/svg+xml,' + encodeURIComponent(read('favicon.svg').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim());

if (/<\/?script/i.test(licenses)) throw new Error('ライセンスの本文に「<script」「</script」があります');

const template = read('src/app.html');
const fill = {
  LIB_SUMMARY: libSummary,
  BUILD_NOTE: 'https://github.com/YouheiOonuki/pac-tester の build.mjs で作成（npm ci && node build.mjs）',
  FAVICON: favicon,
  APP_CSS: read('src/app.css'),
  LIB_LIST: libList,
  SCRIPTS: scripts,
  LICENSES: licenses,
};
// 置き換えは 1 回で行う（埋め込んだ中身に {{…}} があっても、もう一度置き換えない）
const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
  if (!(k in fill)) throw new Error('未知の置き換え: ' + m);
  return fill[k];
});
fs.writeFileSync(path.join(ROOT, 'pac-tester.html'), out);

const size = Buffer.byteLength(out);
console.log(`pac-tester.html: ${size.toLocaleString('en')} バイト（${(size / 1024).toFixed(0)} KB）`);
for (const l of LIBS) console.log(`  ${l.name} ${l.version}: ${Buffer.byteLength(l.code).toLocaleString('en')} バイト`);
console.log(`THIRD_PARTY_LICENSES.txt: ${entries.length} パッケージ`);
