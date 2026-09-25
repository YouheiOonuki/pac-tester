// 日本語版（pac-tester.html）と英語版（pac-tester-en.html）のテスト: node --test tests/*.test.js
// 受け入れ: 文言は両方の言語にそろっている。英語版に日本語が残っていない。ロジックは 1 つで、評価の結果は言語によらず同じ
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const MSG = require('../src/messages.js');
const Core = require('../src/core.js');
const { evalPac, sampleConfig } = require('./helpers.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CoreJa = Core.forLang('ja');
const CoreEn = Core.forLang('en');
// 日本語の文字（ひらがな・カタカナ・漢字・全角の記号と英数字・和文の句読点と全角スペース）
const JAPANESE = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]/;

// すべてのキーを「a.b.c」の形で並べる（配列は長さだけ見る）
function keysOf(obj, prefix) {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...keysOf(v, key));
    else out.push(key);
  }
  return out.sort();
}
const get = (obj, key) => key.split('.').reduce((o, k) => o[k], obj);
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('文言: ja と en は同じキー・同じ型・同じ差し込み（{…}）を持つ', () => {
  const ja = keysOf(MSG.ja);
  const en = keysOf(MSG.en);
  assert.deepEqual(en, ja);
  for (const key of ja) {
    const a = get(MSG.ja, key), b = get(MSG.en, key);
    assert.equal(Array.isArray(a), Array.isArray(b), key);
    if (Array.isArray(a)) {
      if (!/^html\./.test(key)) assert.equal(a.length, b.length, key);   // HTML のコメント以外（CSV の見出し・曜日・月）は数も同じ
      continue;
    }
    assert.equal(typeof a, 'string', key);
    assert.equal(typeof b, 'string', key);
    assert.equal(placeholders(a), placeholders(b), key + ' の差し込み');
    if (key !== 'html.lang' && key !== 'app.lintSuffix') assert.ok(b.length > 0, key + ' が空');
  }
});

test('文言: 英語の文言に日本語が無い（「日本語版」へのリンクの 1 か所だけ）', () => {
  for (const key of keysOf(MSG.en)) {
    let v = get(MSG.en, key);
    v = Array.isArray(v) ? v.join('\n') : v;
    if (key === 'html.aboutLinksHtml') v = v.replace(/<span lang="ja">[^<]*<\/span>/g, '');
    assert.doesNotMatch(v, JAPANESE, key + ': ' + v);
  }
});

test('文言: src/app.html の {{t:キー}} と messages.js の html が過不足なく対応する', () => {
  const used = new Set([...read('src/app.html').matchAll(/\{\{t:(\w+)\}\}/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), Object.keys(MSG.ja.html).sort());
  // テンプレートの中には、文言を直接書かない
  assert.doesNotMatch(read('src/app.html'), JAPANESE);
});

test('文言: core.js・app.js・sandbox.html・worker.js・pac-runtime.js のコード（コメントを除く）に日本語の文言が無い', () => {
  for (const f of ['src/core.js', 'src/app.js', 'src/worker.js', 'src/pac-runtime.js']) {
    const code = read(f);
    const tokens = [...acorn.tokenizer(code, { ecmaVersion: 'latest' })];
    for (const t of tokens) {
      if (t.type.label === 'string' || t.type.label === 'template' || t.type.label === 'regexp') {
        assert.doesNotMatch(String(t.value && t.value.pattern !== undefined ? t.value.pattern : t.value), JAPANESE, f + ': ' + code.slice(t.start, t.end));
      }
    }
  }
  const sb = read('src/sandbox.html').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(sb, JAPANESE, 'src/sandbox.html');
});

test('英語版: pac-tester-en.html に日本語が無い（「日本語版」へのリンクの 1 か所だけ）。lang="en"', () => {
  const html = read('pac-tester-en.html');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>PAC File Tester<\/title>/);
  const intentional = html.match(/<span lang="ja">[^<]*<\/span>/g) || [];
  assert.equal(intentional.length, 1);
  const rest = html.replace(/<span lang="ja">[^<]*<\/span>/g, '');
  const lines = rest.split('\n').filter((l) => JAPANESE.test(l));
  assert.deepEqual(lines, []);
  // 隔離用の枠の HTML も英語
  assert.match(html, /\\u003chtml lang=\\"en\\">/);
});

test('日本語版: pac-tester.html は lang="ja" で、見出しは日本語のまま', () => {
  const html = read('pac-tester.html');
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<title>PAC ファイル テスター<\/title>/);
  assert.match(html, /<h2 id="pt-h-pac">PAC ファイル<\/h2>/);
  assert.match(html, /\\u003chtml lang=\\"ja\\">/);
});

// ---------- 評価の結果は言語によらず同じ ----------
const FW = String.fromCharCode(0x3000);
const pac = (body) => 'function FindProxyForURL(url, host) {\n' + body + '\n}\n';
const LINT_CASES = [
  '',
  pac('  if (isPlainHostName(host))' + FW + 'return "DIRECT";\n  return "DIRECT";'),
  pac('  if (host == "www' + FW + '.example.com") return "DIRECT";\n  return "DIRECT";'),
  pac('  if (host == “a.example.com”) return "DIRECT";\n  return "DIRECT";'),
  pac('  if (isPlainHostName(host)) return "DIRECT";\n  if (dnsDomainIs(host, ".example.com")) return "PROXY p.example.net:8080";'),
  pac('  if (isPlainHostName(host)) return;\n  return "DIRECT";'),
  'function FindProxyForURL(url, host) {\n  if (isPlainHostName(host)) {\n    return "DIRECT";\n  return "PROXY p.example.net:8080";\n}\n',
  pac('  if (isPlainHostName(host) { return "DIRECT"; }\n  return "DIRECT";'),
  pac('  return "DIRECT"; }'),
  pac('  if (host == "a.example.com) return "DIRECT";\n  return "DIRECT";'),
  pac('  if (host = = "a") return "DIRECT";\n  return "DIRECT";'),
  'function findProxyForUrl(url, host) { return "DIRECT"; }',
  'function FindProxyForURL(url) { return "DIRECT"; }',
  pac('  if (shExpMatch(host, "*.example.com")) return "PROXY a.example.net:8080";\n  if (shExpMatch(host, "www.example.com")) return "DIRECT";\n  if (dnsDomainIs(host, ".example.org")) return "DIRECT";\n  if (host == "app.example.org") return "DIRECT";\n  return "DIRECT";'),
  pac('  if (shExpMatch(host, "http://www.example.com/*")) return "DIRECT";\n  if (shExpMatch(host, ".example.org")) return "DIRECT";\n  if (shExpMatch(host, "WWW.example.net")) return "DIRECT";\n  if (shExpMatch(host, "(a|b).example.net")) return "DIRECT";\n  if (shExpMatch(url, "http://files.example.com")) return "DIRECT";\n  if (shExpMatch(url, "files.example.com/*")) return "DIRECT";\n  if (shExpMatch(url, "https://a.example.com/x/y")) return "DIRECT";\n  if (shExpMatch(host, "example.com")) return "DIRECT";\n  return "DIRECT";'),
  pac('  if (isInNet(host, "10.0.0.0", "/8")) return "DIRECT";\n  if (isInNet(host, "255.255.0.0", "10.0.0.0")) return "DIRECT";\n  if (weekdayRange("mon", "fri")) return "DIRECT";\n  if (timeRange(22, 6)) return "DIRECT";\n  if (dnsDomainIs(host, "example.com")) return "DIRECT";\n  if (isPlainHostName(host, 1)) return "DIRECT";\n  return "PROXY a.example.net:8080, DIRECT";'),
  'function isInNet(a, b, c) { return true; }\nfunction FindProxyForURL(u, h) { return "PROXY"; }\nfunction FindProxyForURL(u, h) { return "PROXY a.example.com:99999"; }',
  pac('  var s = "​"; var t = `x'),
];

test('lint: 日本語版と英語版で、見つかる問題（重さ・種類・行・桁）とパターンの一覧が同じ。文言だけが違う', () => {
  for (const code of LINT_CASES.concat([CoreJa.SAMPLE_PAC, CoreEn.SAMPLE_PAC])) {
    const a = CoreJa.lint(code, acorn), b = CoreEn.lint(code, acorn);
    const shape = (r) => ({
      issues: r.issues.map((i) => [i.severity, i.kind, i.line, i.col]),
      patterns: r.patterns.map((p) => [p.line, p.col, p.role, p.pattern, p.notes.map((n) => n.severity)]),
      parsed: r.parsed,
    });
    assert.deepEqual(shape(b), shape(a), JSON.stringify(code));
    b.issues.forEach((i) => assert.doesNotMatch(i.message.replace(/"[^"]*"/g, ''), JAPANESE, i.message));
  }
});

test('見本: 英語版の見本は、コメントのほかは日本語版と同じ（評価の結果も同じ）', () => {
  const strip = (s) => s.split('\n').map((l) => l.replace(/^(\s*)(\/\/|#).*$/, '$1$2')).join('\n');
  assert.equal(strip(CoreEn.SAMPLE_PAC), strip(CoreJa.SAMPLE_PAC));
  assert.equal(strip(CoreEn.SAMPLE_URLS), strip(CoreJa.SAMPLE_URLS));
  assert.equal(strip(CoreEn.SAMPLE_HOSTS), strip(CoreJa.SAMPLE_HOSTS));
  assert.equal(CoreEn.SAMPLE_MY_IP, CoreJa.SAMPLE_MY_IP);
  assert.deepEqual(CoreEn.parseHostTable(CoreEn.SAMPLE_HOSTS).hosts, CoreJa.parseHostTable(CoreJa.SAMPLE_HOSTS).hosts);
  const urlsJa = CoreJa.parseUrlList(CoreJa.SAMPLE_URLS, { stripHttpsPath: true });
  const urlsEn = CoreEn.parseUrlList(CoreEn.SAMPLE_URLS, { stripHttpsPath: true });
  assert.deepEqual(urlsEn, urlsJa);
  const resJa = evalPac(CoreJa.SAMPLE_PAC, urlsJa, sampleConfig());
  const resEn = evalPac(CoreEn.SAMPLE_PAC, urlsEn, sampleConfig());
  assert.deepEqual(resEn, resJa);
  assert.deepEqual(CoreEn.lint(CoreEn.SAMPLE_PAC, acorn).issues, []);
  // 見本は架空のドメインだけ（sample.test.js と同じ決まり）
  const names = (CoreEn.SAMPLE_PAC + CoreEn.SAMPLE_URLS + CoreEn.SAMPLE_HOSTS).match(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/gi).filter((s) => /[a-z]/i.test(s) && !/^\d/.test(s));
  for (const n of names) assert.match(n.toLowerCase(), /(^|\.)(example\.(com|net|org)|example)$|^(pkg\/)?latest\.bin$|^report\.xlsx$/, n);
});

test('結果の文字列・色分け・差分・戻り値のチェック: 言語によらず同じ判定', () => {
  const rs = [
    { ok: true, value: 'DIRECT', valueType: 'string' },
    { ok: true, value: 'PROXY a.example.com:8080 ;DIRECT', valueType: 'string' },
    { ok: true, value: 'PROXY', valueType: 'string' },
    { ok: true, value: 'undefined', valueType: 'undefined' },
    { ok: false, timeout: true, error: 'x' },
    { ok: false, error: 'ReferenceError: x' },
  ];
  for (const r of rs) {
    assert.equal(CoreEn.classifyResult(r), CoreJa.classifyResult(r));
    assert.equal(CoreEn.checkReturnValue(r.value) === null, CoreJa.checkReturnValue(r.value) === null);
  }
  const urls = CoreEn.parseUrlList('http://a.example.com/\nhttp://b.example.com/\nhttp://c.example.com/', {});
  const a = [rs[0], rs[4], rs[5]], b = [rs[1], rs[4], rs[0]];
  assert.deepEqual(CoreEn.diffResults(urls, a, b).rows.map((r) => r.changed), CoreJa.diffResults(urls, a, b).rows.map((r) => r.changed));
  assert.equal(CoreEn.resultText(rs[4]), '(timeout)');
  assert.equal(CoreEn.parseUrlList('http://', {})[0].error, 'Not a valid URL');
});

// ---------- ビルドした 2 つのファイルは、文言のほかは同じコード ----------
// script 要素の中身を取り出し、acorn のトークン（コメントと空白を除いたもの）で比べる。
// 隔離用の枠の HTML（文字列）は中身を取り出し、その中の script と、さらにその中の pac-runtime.js・worker.js（文字列）も同じように比べる
function scriptsOf(html) {
  return [...html.matchAll(/<script>\/\* ([^\n]*?) \*\/\n([\s\S]*?)\n<\/script>/g)].map((m) => ({ label: m[1], code: m[2] }));
}
function tokens(code) {
  const out = [];
  for (const t of acorn.tokenizer(code, { ecmaVersion: 'latest' })) {
    let v = t.value;
    if (t.type.label === 'regexp') v = v.pattern + '/' + v.flags;
    if (t.type.label === 'string' && typeof v === 'string' && v.length > 300 && /FindProxyForURL|PacRuntime/.test(v)) {
      out.push(...tokens(v));   // 埋め込んだ JS（pac-runtime.js・worker.js）は、中身のトークンで比べる
      continue;
    }
    out.push(t.type.label + ':' + (v === undefined ? '' : String(v)));
  }
  return out;
}
function sandboxScript(code) {
  const m = /^window\.PT_SANDBOX_HTML = ("(?:[^"\\]|\\.)*");$/.exec(code.trim());
  assert.ok(m, '隔離用の枠の文字列');
  const html = JSON.parse(m[1]);
  const s = /<script>\n([\s\S]*?)<\/script>/.exec(html);
  return { html, code: s[1] };
}

test('ビルド: 日本語版と英語版は、文言（window.PT_MSG）のほかは同じコード（acorn・core.js・隔離用の枠・app.js・reset-storage.js）', () => {
  const ja = scriptsOf(read('pac-tester.html'));
  const en = scriptsOf(read('pac-tester-en.html'));
  assert.equal(ja.length, 6);
  assert.equal(en.length, 6);
  // 0: acorn（そのまま）、1: 文言、2: core.js、3: 隔離用の枠、4: app.js、5: reset-storage.js（保存した内容をすべて消す）
  assert.equal(en[0].code, ja[0].code, 'acorn');
  assert.match(ja[1].code, /^window\.PT_MSG = /);
  assert.match(en[1].code, /^window\.PT_MSG = /);
  assert.deepEqual(tokens(en[2].code), tokens(ja[2].code), 'core.js');
  assert.deepEqual(tokens(en[4].code), tokens(ja[4].code), 'app.js');
  assert.deepEqual(tokens(en[5].code), tokens(ja[5].code), 'reset-storage.js');
  const sj = sandboxScript(ja[3].code), se = sandboxScript(en[3].code);
  assert.deepEqual(tokens(se.code), tokens(sj.code), 'sandbox.html の script（pac-runtime.js・worker.js を含む）');
  assert.match(sj.html, /<html lang="ja">/);
  assert.match(se.html, /<html lang="en">/);
});

test('ビルド: 埋め込んだ文言は messages.js のその言語の分（ページで使う core・app・sandbox・worker）', () => {
  for (const [file, lang] of [['pac-tester.html', 'ja'], ['pac-tester-en.html', 'en']]) {
    const s = scriptsOf(read(file))[1].code;
    const json = s.replace(/^window\.PT_MSG = /, '').replace(/;$/, '');
    const m = JSON.parse(json);
    const L = MSG[lang];
    assert.deepEqual(m, { core: L.core, app: L.app, sandbox: L.sandbox, worker: L.worker }, file);
    // ブラウザと同じように、埋め込んだ文言で core.js を動かしても、Node の forLang と同じ結果
    const vm = require('node:vm');
    const ctx = vm.createContext({ PT_MSG: m });
    ctx.self = ctx;
    vm.runInContext(scriptsOf(read(file))[2].code, ctx);
    const C = ctx.PacCore;
    const ref = Core.forLang(lang);
    for (const code of LINT_CASES) assert.deepEqual(JSON.parse(JSON.stringify(C.lint(code, acorn))), JSON.parse(JSON.stringify(ref.lint(code, acorn))), file);
    assert.equal(C.SAMPLE_PAC, ref.SAMPLE_PAC);
  }
});
