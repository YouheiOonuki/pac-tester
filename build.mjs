// pac-tester.html（日本語）・pac-tester-en.html（英語）（どちらも 1 ファイルで動くダウンロード版）と THIRD_PARTY_LICENSES.txt を作る
//
//   npm ci          # package.json で固定したライブラリを入れる（最初と、ライブラリを更新したとき）
//   node build.mjs
//
// - src/app.html に src/app.css・acorn・文言（src/messages.js のその言語の分）・src/core.js・隔離用の枠（src/sandbox.html）・src/app.js をそのまま埋め込む
// - 言語で変わるのは文言だけ。src/app.html の {{t:キー}} を messages.js の html で置き換え、core・app・sandbox・worker は window.PT_MSG として入れる
// - 英語版は、ソースのコメント（日本語）を取り除いてから埋め込む（JS は acorn でコメントの位置を調べる。日本語版はそのまま）
// - 隔離用の枠には src/pac-runtime.js と src/worker.js を文字列として入れる（枠の中で Blob にして Worker を起動する）
// - acorn は、パッケージがブラウザ用に配っているビルド済みのファイル（dist/acorn.js）を使う
// - 同梱ライブラリのライセンス全文を、pac-tester.html の末尾と THIRD_PARTY_LICENSES.txt に入れる
// - 日付など実行するたびに変わる値は入れない（同じ入力なら同じファイルになる。CI で確かめている）
// 依存パッケージなし（Node 20 以上）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const NM = path.join(ROOT, 'node_modules');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

if (!fs.existsSync(path.join(NM, 'acorn'))) {
  console.error('node_modules がありません。先に npm ci を実行してください。');
  process.exit(1);
}

const pkgJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

// ---------- 埋め込むライブラリ（ブラウザ用のビルド済みファイル） ----------
const MESSAGES = require('./src/messages.js');
const fmt = MESSAGES.fmt;
const LIBS = [
  { name: 'acorn', pkg: 'acorn', file: 'dist/acorn.js', license: 'MIT', useKey: 'acornUse' },
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
    name: p.name, version: p.version, license: p.license || null, repo: repoUrl(p),
    text: files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n?/g, '\n').trim()).join('\n\n'),
  });
}
entries.sort((a, b) => (a.name + '@' + a.version).localeCompare(b.name + '@' + b.version, 'en'));

// ライセンスの全文（見出しは言語ごと。THIRD_PARTY_LICENSES.txt は日本語版と同じもの）
const RULE = '='.repeat(72);
function licensesFor(B) {
  const lines = [
    B.licTitle,
    '',
    fmt(B.licIntro, { file: B.file }),
    ...LIBS.map((l) => fmt(B.licLibLine, { name: l.name, version: l.version, pkg: l.pkg, path: l.file, license: l.license })),
    '',
    B.licOwnCode,
    'MIT License, Copyright (c) 2026 Youhei Oonuki',
    'https://github.com/YouheiOonuki/pac-tester',
    '',
  ];
  for (const e of entries) {
    lines.push(RULE, `${e.name}@${e.version}  License: ${e.license || B.licSeeFile}${e.repo ? '  ' + e.repo : ''}`, RULE, '', e.text, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
fs.writeFileSync(path.join(ROOT, 'THIRD_PARTY_LICENSES.txt'), licensesFor(MESSAGES.ja.build) + '\n');

// ---------- pac-tester.html・pac-tester-en.html を組み立てる ----------
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

// コメントを取り除く（英語版だけ。ソースのコメントは日本語なので）。acorn でコメントの位置を調べ、
// 行全体がコメントなら行ごと、行末のコメントなら前の空白ごと消す。行の途中のコメントは空白 1 つ（改行を含むなら改行）にする
function stripJsComments(code) {
  const cs = [];
  acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', onComment: (block, text, start, end) => cs.push({ start, end }) });
  let out = '';
  let pos = 0;
  for (const c of cs) {
    let s = c.start, e = c.end;
    let ls = s;
    while (ls > pos && (code[ls - 1] === ' ' || code[ls - 1] === '\t')) ls--;
    const atLineStart = ls === 0 || code[ls - 1] === '\n';
    let le = e;
    while (le < code.length && (code[le] === ' ' || code[le] === '\t')) le++;
    const atLineEnd = le === code.length || code[le] === '\n';
    if (atLineStart && atLineEnd) { s = ls; e = le < code.length ? le + 1 : le; }
    else if (atLineEnd) { s = ls; e = le; }
    else { out += code.slice(pos, s) + (/\n/.test(code.slice(s, e)) ? '\n' : ' '); pos = e; continue; }
    out += code.slice(pos, s);
    pos = e;
  }
  return out + code.slice(pos);
}
function stripCssComments(css) {
  return css.replace(/[ \t]*\/\*[\s\S]*?\*\/[ \t]*(\n)?/g, (m, nl, off, all) => {
    const lineStart = off === 0 || all[off - 1] === '\n';
    return lineStart ? '' : (nl || '');
  });
}
function stripHtmlComments(html) {
  return html.replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\n?/g, '');
}

const acorn = require('acorn');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const favicon = 'data:image/svg+xml,' + encodeURIComponent(read('favicon.svg').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim());
const libSummary = LIBS.map((l) => `${l.name} ${l.version}`).join(', ');
const template = read('src/app.html');

const OUTPUTS = [
  { lang: 'ja', file: 'pac-tester.html', strip: false },
  { lang: 'en', file: 'pac-tester-en.html', strip: true },
];

function build({ lang, file, strip }) {
  const M = MESSAGES[lang];
  const B = M.build;
  if (B.file !== file) throw new Error('messages.js の build.file が違います: ' + lang);
  const js = (p) => (strip ? stripJsComments(read(p)) : read(p));

  // 隔離用の枠（iframe の srcdoc に入れる HTML）。PAC の標準関数と Worker の部分は、枠の中で Blob にする文字列として入れる
  let sandboxHtml = read('src/sandbox.html').replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (k === 'RUNTIME_JSON') return jsString(js('src/pac-runtime.js'));
    if (k === 'WORKER_JSON') return jsString(js('src/worker.js'));
    if (k === 'LANG') return M.html.lang;
    if (k === 'TITLE') return esc(M.html.title);
    throw new Error('未知の置き換え（sandbox.html）: ' + m);
  });
  if (strip) {
    sandboxHtml = stripHtmlComments(sandboxHtml).replace(/(<script>\n)([\s\S]*?)(<\/script>)/, (m, a, code, b) => a + stripJsComments(code) + b);
  }

  // ページに入れる文言（その言語の分だけ）
  const pageMsg = { core: M.core, app: M.app, sandbox: M.sandbox, worker: M.worker };
  const msgJs = 'window.PT_MSG = ' + JSON.stringify(pageMsg, null, 1).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';';

  const scripts = [
    ...LIBS.map((l) => scriptTag(l.code, fmt(B.scriptLib, { name: l.name, version: l.version, license: l.license }))),
    scriptTag(msgJs, B.scriptMessages),
    scriptTag(js('src/core.js'), B.scriptCore),
    scriptTag('window.PT_SANDBOX_HTML = ' + jsString(sandboxHtml) + ';', B.scriptSandbox),
    scriptTag(js('src/app.js'), B.scriptApp),
  ].join('\n');

  const libList = LIBS.map((l) => '        <li>' + esc(fmt(B.libItem, { name: l.name, version: l.version, license: l.license, use: B[l.useKey] })) + '</li>').join('\n');
  const licenses = licensesFor(B);
  if (/<\/?script/i.test(licenses)) throw new Error('ライセンスの本文に「<script」「</script」があります');

  // 1. 文言（{{t:キー}}）を入れる。キーが Html で終わるものはそのまま、ほかはエスケープする。配列は改行でつなぐ
  const withText = template.replace(/\{\{t:(\w+)\}\}/g, (m, k) => {
    if (!(k in M.html)) throw new Error('messages.js の html に無いキー（' + lang + '）: ' + k);
    const v = Array.isArray(M.html[k]) ? M.html[k].join('\n') : M.html[k];
    return /Html$/.test(k) ? v : esc(v);
  });
  // 2. 中身を埋め込む。置き換えは 1 回で行う（埋め込んだ中身に {{…}} があっても、もう一度置き換えない）
  const fill = {
    LIB_SUMMARY: libSummary,
    BUILD_NOTE: B.buildNote,
    FAVICON: favicon,
    APP_CSS: strip ? stripCssComments(read('src/app.css')) : read('src/app.css'),
    LIB_LIST: libList,
    SCRIPTS: scripts,
    LICENSES: licenses,
  };
  const out = withText.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in fill)) throw new Error('未知の置き換え: ' + m);
    return fill[k];
  });
  fs.writeFileSync(path.join(ROOT, file), out);
  const size = Buffer.byteLength(out);
  console.log(`${file}: ${size.toLocaleString('en')} バイト（${(size / 1024).toFixed(0)} KB）`);
}

for (const o of OUTPUTS) build(o);
for (const l of LIBS) console.log(`  ${l.name} ${l.version}: ${Buffer.byteLength(l.code).toLocaleString('en')} バイト`);
console.log(`THIRD_PARTY_LICENSES.txt: ${entries.length} パッケージ`);
