// ビルドした pac-tester.html（日本語）・pac-tester-en.html（英語）（ダウンロード版）のテスト: node --test tests/*.test.js
// 受け入れ: ダウンロード版の中に、外部へ通信するもの・広告・アクセス解析が入っていない。PAC は隔離した枠で評価する
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BUILDS = ['pac-tester.html', 'pac-tester-en.html'];
const OUR_CODE = ['src/core.js', 'src/app.js', 'src/pac-runtime.js', 'src/worker.js', 'src/sandbox.html', 'src/messages.js'];

// ビルドごとに同じテストをする
function eachBuild(name, fn) {
  for (const file of BUILDS) test(file + ': ' + name, () => fn(read(file), file));
}

eachBuild('外部のファイルを読み込む要素がない（script src・link href・img src など）', (html) => {
  assert.doesNotMatch(html, /<script[^>]*\ssrc\s*=/i, 'script src');
  assert.doesNotMatch(html, /<link[^>]*rel\s*=\s*["']?stylesheet/i, 'link stylesheet');
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  for (const l of links) assert.doesNotMatch(l, /href\s*=\s*["']?(https?:)?\/\//i, l);
  assert.doesNotMatch(html, /<(img|iframe|audio|video|source|embed|object)\b[^>]*\ssrc\s*=\s*["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /@import\s+url\(\s*["']?(https?:)?\/\//i);
});

eachBuild('広告・アクセス解析のコードが入っていない', (html) => {
  for (const s of ['googlesyndication', 'cloudflareinsights', 'adsbygoogle', 'google-adsense-account', 'googletagmanager', 'google-analytics', 'data-cf-beacon']) {
    assert.ok(!html.includes(s), s);
  }
});

test('本ツールのコードは fetch・XMLHttpRequest・WebSocket などで通信しない', () => {
  for (const f of OUR_CODE) {
    const code = read(f);
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|\bimport\s*\(|new\s+Image\b/, f);
    // コードの中の http(s) の URL は、見本の架空のドメイン（example.*）・ドットの無いホスト名（intranet）・プライベート IP アドレスだけ
    // （messages.js の、ビルドのメモ・ライセンスの見出し・「このツールについて」のリンク（押したときだけ開く）の自サイトと GitHub は除く）
    const urls = (code.match(/https?:\/\/[A-Za-z0-9.-]+/g) || [])
      .filter((u) => !/^https?:\/\/([a-z0-9-]+\.)*example(\.(com|net|org))?$/i.test(u) && u !== 'http://intranet' && !/^https?:\/\/(10|127)\.[\d.]+$/.test(u))
      .filter((u) => !(f === 'src/messages.js' && (u === 'https://yorozu-craft.com' || u === 'https://github.com')));
    assert.deepEqual(urls, [], f + ' に URL: ' + urls.join(', '));
  }
});

test('ページ本体では PAC を実行しない（eval・new Function・Worker を使わない）', () => {
  for (const f of ['src/core.js', 'src/app.js']) {
    const code = read(f);
    assert.doesNotMatch(code, /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|new\s+Worker\b|\bsetTimeout\s*\(\s*['"]/, f);
  }
});

eachBuild('Content-Security-Policy で外部への通信を禁止している', (html) => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(m, 'CSP の meta がある');
  const csp = m[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /worker-src blob:(;|$)/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /https?:|\*|unsafe-eval/);
  // CSP の meta は、ほかのスクリプトより前にある
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
});

test('PAC は sandbox の iframe（allow-same-origin なし）の中の Worker で評価する', () => {
  const app = read('src/app.js');
  assert.match(app, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.doesNotMatch(app.replace(/\/\/.*$/gm, ''), /allow-same-origin/);   // コメントを除いたコードに無い
  assert.match(app, /\.srcdoc = SANDBOX_HTML/);
  const sb = read('src/sandbox.html');
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(sb);
  assert.ok(m, '枠にも CSP がある');
  assert.match(m[1], /default-src 'none'/);
  assert.match(m[1], /connect-src 'none'/);
  assert.match(m[1], /worker-src blob:/);
  assert.match(sb, /new Worker\(blobUrl\)/);
  assert.match(sb, /terminate\(\)/);
  // ビルドした HTML の中に、枠の HTML が文字列として入っている
  for (const file of BUILDS) assert.match(read(file), /window\.PT_SANDBOX_HTML = "/, file);
});

eachBuild('noindex（検索には紹介ページ index.html を出す）', (html) => {
  assert.match(html, /<meta name="robots" content="noindex">/);
});

eachBuild('ライブラリとライセンス全文が入っている', (html, file) => {
  const pkg = JSON.parse(read('package.json'));
  for (const [name, ver] of Object.entries(pkg.devDependencies)) {
    assert.match(ver, /^\d+\.\d+\.\d+$/, name + ' はバージョンを固定する');
    assert.ok(html.includes(name + ' ' + ver), name + ' ' + ver);
  }
  assert.match(html, /<script type="text\/plain" id="licenses">/);
  const lic = read('THIRD_PARTY_LICENSES.txt');
  for (const s of ['acorn@', 'MIT License', 'Permission is hereby granted', 'Copyright (C) 2012-2022 by various contributors']) {
    assert.ok(lic.includes(s), 'THIRD_PARTY_LICENSES.txt に ' + s);
    assert.ok(html.includes(s), file + ' に ' + s);
  }
});

eachBuild('script 要素が途中で閉じていない（埋め込んだコードに </script が残っていない）', (html) => {
  const opens = (html.match(/<script\b/gi) || []).length;
  const closes = (html.match(/<\/script>/gi) || []).length;
  assert.equal(opens, closes);
  assert.equal(opens, 6);   // acorn・文言・core.js・隔離用の枠・app.js・ライセンス
});

test('index.html は日本語版、en/index.html・en/guide.html は英語版へリンクし、ダウンロード版はサイトマップに載せない', () => {
  assert.match(read('index.html'), /<a [^>]*href="\.\/pac-tester\.html"[^>]*\sdownload="pac-tester\.html"/);
  const en = read('en/index.html');
  assert.match(en, /<a [^>]*href="\.\.\/pac-tester-en\.html"[^>]*\sdownload="pac-tester-en\.html"/);
  assert.match(en, /"downloadUrl": "https:\/\/yorozu-craft\.com\/pac-tester\/pac-tester-en\.html"/);
  assert.doesNotMatch(en, /href="\.\.\/pac-tester\.html"[^>]*download/);   // 英語のページから日本語版をダウンロードさせない
  assert.doesNotMatch(read('en/guide.html'), /<code>pac-tester\.html<\/code>/);
  const sitemap = read('sitemap.xml');
  assert.doesNotMatch(sitemap, /pac-tester\.html/);
  assert.doesNotMatch(sitemap, /pac-tester-en\.html/);
});

test('紹介ページのファイルサイズ（約 ○KB・JSON-LD の fileSize）が、ビルドしたファイルと合っている', () => {
  for (const [page, file] of [['index.html', 'pac-tester.html'], ['en/index.html', 'pac-tester-en.html']]) {
    const kb = Math.round(fs.statSync(path.join(ROOT, file)).size / 1024);
    const src = read(page);
    const ld = /"fileSize": "(\d+)KB"/.exec(src);
    assert.ok(ld, page + ' に fileSize');
    assert.ok(Math.abs(Number(ld[1]) - kb) <= 10, `${page} の fileSize ${ld[1]}KB と ${file} の ${kb}KB`);
    const shown = /(?:約 |about )(\d+) ?KB/.exec(src);
    assert.ok(shown, page + ' に「約 ○KB」');
    assert.equal(shown[1], ld[1], page + ' の表示と fileSize');
  }
});
