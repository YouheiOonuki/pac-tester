// 「保存した内容をすべて消す（初期状態に戻す）」ボタン（reset-storage.js。yorozu-plans ROADMAP K123）のテスト
// 正本は youheioonuki.github.io の tools/common/reset-storage.test.js。このファイルは repo の値を持たない（yorozu-plans D683・Q-882）。
// repo の値は、同じフォルダの reset-storage.values.json だけが持つ。ページのボタンの値は、その値と 1 字まで突き合わせる（ページの値が誤っていたら落ちる）
//   src          … reset-storage.js の場所（repo の最上位から）。require と、埋め込みの元の両方に使う
//   prefixes     … このツールのキーの接頭辞（ボタンの data-reset-storage）。書いていないページはこの値
//   legacy       … 接頭辞の無い旧キー（ボタンの data-reset-legacy）。書いていないページはこの値
//   pagePrefixes … 画面ごとに消す範囲を分けるページ: { "ページ": [接頭辞] }。どれも prefixes のどれかで始まる
//   pageLegacy   … ページごとの旧キー: { "ページ": [旧キー] }。[] は「このページは旧キーを消さない」
//   inline       … reset-storage.js を <script src> ではなく、ページの中に埋め込んでいるページ（1 ファイルにビルドするもの）
//   skipDirs     … ページを探さないフォルダ（node_modules・tests・test・.git・.github・tools のほかに）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'reset-storage.values.json'), 'utf8'));
const KEYS = ['src', 'prefixes', 'legacy', 'pagePrefixes', 'pageLegacy', 'inline', 'skipDirs'];
const R = require(path.join(ROOT, V.src));
const SKIP_DIRS = new Set(['node_modules', 'tests', 'test', '.git', '.github', 'tools', ...V.skipDirs]);
const INLINE_MARK = 'root.ResetStorage = api;';

test('値のファイルは決まった 7 つの名前だけを、決まった形で持つ', () => {
  assert.deepEqual(Object.keys(V).sort(), [...KEYS].sort(), 'reset-storage.values.json の名前');
  assert.equal(typeof V.src, 'string');
  for (const k of ['prefixes', 'legacy', 'inline', 'skipDirs']) assert.ok(Array.isArray(V[k]) && V[k].every((x) => typeof x === 'string' && x), k);
  assert.ok(V.prefixes.length > 0, 'prefixes が空');
  for (const k of ['pagePrefixes', 'pageLegacy']) {
    assert.ok(V[k] && typeof V[k] === 'object' && !Array.isArray(V[k]), k);
    for (const [page, list] of Object.entries(V[k])) assert.ok(Array.isArray(list) && list.every((x) => typeof x === 'string' && x), k + ' の ' + page);
  }
  for (const [page, list] of Object.entries(V.pagePrefixes)) {
    assert.ok(list.length > 0, 'pagePrefixes の ' + page + ' が空');
    for (const p of list) assert.ok(V.prefixes.some((q) => p.startsWith(q)), 'pagePrefixes の ' + page + ' の ' + p + ' はこのツールの接頭辞で始まらない');
  }
});

function fakeStorage(init) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    keys() { return [...m.keys()].sort(); },
  };
}

test('消すのはこのツールの接頭辞のキー（と旧キー）だけで、ほかのツールのキーは残す', () => {
  const init = { 'zz-other-tool_x': '1', 'zzother_theme': 'dark', 'unrelated': 'u' };
  for (const p of V.prefixes) { init[p + 'a'] = '1'; init[p + 'b'] = '2'; }
  for (const k of V.legacy) init[k] = 'old';
  const expectedLeft = Object.keys(init).filter((k) => !V.prefixes.some((p) => k.startsWith(p)) && !V.legacy.includes(k)).sort();
  const s = fakeStorage(init);
  const gone = R.clear(s, V.prefixes, V.legacy);
  assert.equal(gone.length, V.prefixes.length * 2 + V.legacy.length);
  assert.deepEqual(s.keys(), expectedLeft);
  assert.ok(expectedLeft.length > 0);
});

test('空の接頭辞では何も消さない', () => {
  assert.deepEqual(R.keysToRemove(['a', 'b'], [''], []), []);
  assert.deepEqual(R.keysToRemove(['a', 'b'], R.splitList(' , '), R.splitList('')), []);
});

function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...htmlFiles(path.join(dir, e.name))); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
  return out;
}

/** ページのスクリプト（インラインと、リポジトリ内の src）が localStorage / indexedDB を使うか */
function usesStorage(file, html) {
  let code = '';
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[1]);
    if (!src) { code += m[2]; continue; }
    if (/^(https?:)?\/\//.test(src[1]) || /reset-storage\.js/.test(src[1])) continue;
    const p = path.join(path.dirname(file), src[1].split(/[?#]/)[0]);
    if (fs.existsSync(p)) code += fs.readFileSync(p, 'utf8');
  }
  code = code.replace(/(^|[^:\\'"])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');   // コメントの中の語は数えない（行のコメントが先。「topics/*.js」のような文字を /* と読まないように）
  return /\blocalStorage\b|\bindexedDB\b/.test(code);
}

const PAGES = htmlFiles(ROOT).filter((f) => usesStorage(f, fs.readFileSync(f, 'utf8')));
const relOf = (f) => path.relative(ROOT, f).split(path.sep).join('/');

test('localStorage を使うページには、消すボタンと reset-storage.js があり、ボタンの値が値のファイルと同じ', () => {
  assert.ok(PAGES.length > 0, 'localStorage を使うページが見つからない');
  for (const f of PAGES) {
    const html = fs.readFileSync(f, 'utf8');
    const rel = relOf(f);
    const btn = /<button\b[^>]*\bdata-reset-storage="([^"]*)"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    assert.ok(btn, rel + ' に data-reset-storage のボタンが無い');
    assert.deepEqual(R.splitList(btn[1]), V.pagePrefixes[rel] || V.prefixes, rel + ' の接頭辞');
    const legacy = /\bdata-reset-legacy="([^"]*)"/.exec(btn[0]);
    assert.deepEqual(legacy ? R.splitList(legacy[1]) : [], V.pageLegacy[rel] || V.legacy, rel + ' の旧キー');
    const label = btn[2].replace(/<[^>]+>/g, '').trim();
    assert.ok(label === '保存した内容をすべて消す（初期状態に戻す）' || label === 'Delete everything saved (reset)', rel + ' の文言: ' + label);
    if (V.inline.includes(rel)) {
      assert.ok(fs.readFileSync(path.join(ROOT, V.src), 'utf8').includes(INLINE_MARK));
      assert.ok(html.includes(INLINE_MARK), rel + ' に ' + V.src + ' が埋め込まれていない');
      continue;
    }
    const src = /<script\b[^>]*\bsrc="([^"]*reset-storage\.js)"/.exec(html);
    assert.ok(src, rel + ' に reset-storage.js が無い');
    assert.ok(fs.existsSync(path.join(path.dirname(f), src[1].split(/[?#]/)[0])), rel + ' の reset-storage.js のパス');
  }
});

test('値のファイルが名指すページは、どれも localStorage を使うページ（古い値を残さない）', () => {
  const rels = new Set(PAGES.map(relOf));
  for (const k of ['pagePrefixes', 'pageLegacy']) for (const page of Object.keys(V[k])) assert.ok(rels.has(page), k + ' の ' + page + ' は、localStorage を使うページに無い');
  for (const page of V.inline) assert.ok(rels.has(page), 'inline の ' + page + ' は、localStorage を使うページに無い');
});
