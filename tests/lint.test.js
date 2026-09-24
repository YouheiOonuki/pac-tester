// 構文・ロジックのチェック（lint）のテスト: node --test tests/*.test.js
// 受け入れ: 全角スペースの混入、return 漏れ、括弧の不一致、ルールの隠れ、スキーム付きのパターンを検出する
const test = require('node:test');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const Core = require('../src/core.js');

const FW_SPACE = String.fromCharCode(0x3000);
const lint = (code) => Core.lint(code, acorn);
const kinds = (res, sev) => res.issues.filter((i) => !sev || i.severity === sev).map((i) => i.kind);
const pac = (body) => 'function FindProxyForURL(url, host) {\n' + body + '\n}\n';

test('全角スペース: コードの中はエラー、文字列の中は注意、コメントの中は問題なし', () => {
  const inCode = lint(pac('  if (isPlainHostName(host))' + FW_SPACE + 'return "DIRECT";\n  return "DIRECT";'));
  const hit = inCode.issues.find((i) => i.kind === 'wide-code');
  assert.ok(hit, '全角スペースを見つける');
  assert.equal(hit.severity, 'error');
  assert.equal(hit.line, 2);
  assert.match(hit.message, /全角スペース/);

  const inString = lint(pac('  if (host == "www' + FW_SPACE + '.example.com") return "DIRECT";\n  return "DIRECT";'));
  assert.deepEqual(kinds(inString), ['wide-string']);
  assert.equal(inString.issues[0].severity, 'warning');

  const inComment = lint(pac('  // コメントの中の' + FW_SPACE + '全角スペースと「かっこ」\n  /* 複数行の' + FW_SPACE + 'コメント */\n  return "DIRECT";'));
  assert.deepEqual(inComment.issues, []);
});

test('全角の記号・和文の引用符（構文エラーにもなる）', () => {
  const res = lint(pac('  if (host == ' + String.fromCharCode(0x201C) + 'a.example.com' + String.fromCharCode(0x201D) + ') return "DIRECT";\n  return "DIRECT";'));
  assert.ok(kinds(res, 'error').includes('wide-code'));
  assert.ok(res.issues.some((i) => i.kind === 'syntax' && /使えない文字/.test(i.message)));
});

test('return 漏れ: 最後の return が無いと注意。else まで return していれば出ない', () => {
  const missing = lint(pac('  if (isPlainHostName(host)) return "DIRECT";\n  if (dnsDomainIs(host, ".example.com")) return "PROXY p.example.net:8080";'));
  assert.ok(kinds(missing).includes('no-return'));

  const elseChain = lint(pac('  if (isPlainHostName(host)) {\n    return "DIRECT";\n  } else if (dnsDomainIs(host, ".example.com")) {\n    return "PROXY p.example.net:8080";\n  } else {\n    return "DIRECT";\n  }'));
  assert.ok(!kinds(elseChain).includes('no-return'));

  const elseMissing = lint(pac('  if (isPlainHostName(host)) {\n    return "DIRECT";\n  } else if (dnsDomainIs(host, ".example.com")) {\n    return "PROXY p.example.net:8080";\n  }'));
  assert.ok(kinds(elseMissing).includes('no-return'));

  const switchOk = lint(pac('  switch (host) {\n    case "a": return "DIRECT";\n    default: return "PROXY p.example.net:8080";\n  }'));
  assert.ok(!kinds(switchOk).includes('no-return'));

  const noValue = lint(pac('  if (isPlainHostName(host)) return;\n  return "DIRECT";'));
  assert.ok(kinds(noValue).includes('return-value'));
});

test('括弧の不一致: 開き括弧が閉じていない・対応がずれている・余分な閉じ括弧', () => {
  const unclosed = lint('function FindProxyForURL(url, host) {\n  if (isPlainHostName(host)) {\n    return "DIRECT";\n  return "PROXY p.example.net:8080";\n}\n');
  const b = unclosed.issues.filter((i) => i.kind === 'bracket');
  assert.ok(b.length >= 1);
  assert.ok(b.some((i) => i.line === 1 && /閉じていません/.test(i.message)));
  assert.ok(unclosed.issues.some((i) => i.kind === 'syntax' && /途中で終わっています/.test(i.message)));

  const mismatch = lint(pac('  if (isPlainHostName(host) { return "DIRECT"; }\n  return "DIRECT";'));
  assert.ok(mismatch.issues.some((i) => i.kind === 'bracket' && /対応がずれています/.test(i.message)));
  assert.ok(kinds(mismatch).includes('syntax'));

  const extra = lint(pac('  return "DIRECT"; }'));
  assert.ok(extra.issues.some((i) => i.kind === 'bracket' && /対応する開き括弧がありません/.test(i.message)));

  // 文字列・コメント・正規表現の中の括弧は数えない
  const ok = lint(pac('  // ) } ]\n  if (/^a[(]b$/.test(host) || host == "x(y") return "DIRECT";\n  return "DIRECT";'));
  assert.deepEqual(kinds(ok).filter((k) => k === 'bracket' || k === 'syntax'), []);
});

test('引用符の対応: 閉じていない文字列', () => {
  const res = lint(pac('  if (host == "a.example.com) return "DIRECT";\n  return "DIRECT";'));
  assert.ok(kinds(res).includes('quote') || res.issues.some((i) => i.kind === 'syntax'));
  assert.ok(res.issues.some((i) => i.severity === 'error'));
});

test('構文エラーは日本語で、行と桁を出す', () => {
  const res = lint(pac('  if (host = = "a") return "DIRECT";\n  return "DIRECT";'));
  const s = res.issues.find((i) => i.kind === 'syntax');
  assert.ok(s);
  assert.equal(s.line, 2);
  assert.ok(s.col > 0);
  assert.doesNotMatch(s.message, /Unexpected/);
  assert.equal(Core.translateSyntaxError('Unterminated string constant (3:5)'), '文字列の引用符が閉じていません（" と \' の対応を確かめてください）');
});

test('FindProxyForURL が無い・名前が違う', () => {
  const res = lint('function findProxyForUrl(url, host) { return "DIRECT"; }');
  assert.ok(kinds(res, 'error').includes('no-entry'));
  assert.ok(res.issues.some((i) => /findProxyForUrl/.test(i.message)));
  assert.ok(!kinds(lint('var FindProxyForURL = function (url, host) { return "DIRECT"; };')).includes('no-entry'));
  assert.ok(kinds(lint('function FindProxyForURL(url) { return "DIRECT"; }')).includes('params'));
});

test('ルールの隠れ: 上のパターンが下のパターンをすべて含むと注意', () => {
  const res = lint(pac([
    '  if (shExpMatch(host, "*.example.com")) return "PROXY a.example.net:8080";',
    '  if (shExpMatch(host, "www.example.com")) return "DIRECT";',
    '  if (shExpMatch(host, "*.example.org")) return "DIRECT";',
    '  return "DIRECT";',
  ].join('\n')));
  const sh = res.issues.filter((i) => i.kind === 'shadow');
  assert.equal(sh.length, 1);
  assert.equal(sh[0].severity, 'warning');
  assert.equal(sh[0].line, 3);
  assert.match(sh[0].message, /2 行目/);
});

test('ルールの隠れ: else if の並び、|| の条件、dnsDomainIs、戻り値が同じなら参考', () => {
  const chain = lint(pac([
    '  if (shExpMatch(host, "*.example.com") || shExpMatch(host, "*.example.net")) {',
    '    alert("x");',
    '  } else if (shExpMatch(host, "*.sub.example.net")) {',
    '    return "DIRECT";',
    '  }',
    '  return "DIRECT";',
  ].join('\n')));
  assert.ok(chain.issues.some((i) => i.kind === 'shadow' && i.line === 4));

  const dom = lint(pac([
    '  if (dnsDomainIs(host, ".example.com")) return "PROXY a.example.net:8080";',
    '  if (host == "app.example.com") return "DIRECT";',
    '  return "DIRECT";',
  ].join('\n')));
  assert.ok(dom.issues.some((i) => i.kind === 'shadow' && i.line === 3));

  const same = lint(pac([
    '  if (shExpMatch(host, "*.example.com")) return "DIRECT";',
    '  if (shExpMatch(host, "a.example.com")) return "DIRECT";',
    '  return "PROXY a.example.net:8080";',
  ].join('\n')));
  const s = same.issues.find((i) => i.kind === 'shadow');
  assert.equal(s.severity, 'info');

  // 上の if が return しないときは、隠れにならない
  const noReturn = lint(pac([
    '  if (shExpMatch(host, "*.example.com")) alert("x");',
    '  if (shExpMatch(host, "a.example.com")) return "DIRECT";',
    '  return "DIRECT";',
  ].join('\n')));
  assert.ok(!kinds(noReturn).includes('shadow'));

  // 狭いものが先なら問題なし
  const ok = lint(pac([
    '  if (shExpMatch(host, "a.example.com")) return "DIRECT";',
    '  if (shExpMatch(host, "*.example.com")) return "PROXY a.example.net:8080";',
    '  return "DIRECT";',
  ].join('\n')));
  assert.ok(!kinds(ok).includes('shadow'));
});

test('パターンの包含（* と ?）', () => {
  assert.equal(Core.globCovers('*.example.com', 'www.example.com'), true);
  assert.equal(Core.globCovers('*.example.com', '*.sub.example.com'), true);
  assert.equal(Core.globCovers('*example.com', '*.example.com'), true);
  assert.equal(Core.globCovers('*.example.com', 'example.com'), false);
  assert.equal(Core.globCovers('*.example.com', '*example.com'), false);
  assert.equal(Core.globCovers('host?.example.com', 'host1.example.com'), true);
  assert.equal(Core.globCovers('host1.example.com', 'host?.example.com'), false);
  assert.equal(Core.globCovers('*', 'anything*'), true);
  assert.equal(Core.globCovers('?*', '*?'), true);
  assert.equal(Core.globCovers('http://*', 'http://*.example.com/*'), true);
});

test('shExpMatch のパターン: スキーム付き・* 忘れ・大文字・正規表現の記号を注意し、一覧にする', () => {
  const res = lint(pac([
    '  if (shExpMatch(host, "http://www.example.com/*")) return "DIRECT";',
    '  if (shExpMatch(host, ".example.org")) return "DIRECT";',
    '  if (shExpMatch(host, "WWW.example.net")) return "DIRECT";',
    '  if (shExpMatch(host, "(a|b).example.net")) return "DIRECT";',
    '  if (shExpMatch(url, "http://files.example.com")) return "DIRECT";',
    '  if (shExpMatch(url, "files.example.com/*")) return "DIRECT";',
    '  return "DIRECT";',
  ].join('\n')));
  assert.equal(res.patterns.length, 6);
  const msgs = (line) => res.issues.filter((i) => i.kind === 'pattern' && i.line === line).map((i) => i.message).join('\n');
  assert.match(msgs(2), /スキーム/);
  assert.match(msgs(3), /\* がありません/);
  assert.match(msgs(4), /大文字/);
  assert.match(msgs(5), /\* と \? だけ/);
  assert.match(msgs(6), /末尾に "\/\*"/);
  assert.match(msgs(7), /スキーム/);
  assert.equal(res.patterns[0].role, 'host');
  assert.equal(res.patterns[4].role, 'url');
});

test('ヘルパー関数の呼び方: isInNet のマスク、weekdayRange の小文字、timeRange(22, 6)、戻り値の区切り', () => {
  const res = lint(pac([
    '  if (isInNet(host, "10.0.0.0", "/8")) return "DIRECT";',
    '  if (isInNet(host, "255.255.0.0", "10.0.0.0")) return "DIRECT";',
    '  if (weekdayRange("mon", "fri")) return "DIRECT";',
    '  if (timeRange(22, 6)) return "DIRECT";',
    '  return "PROXY a.example.net:8080, DIRECT";',
  ].join('\n')));
  const at = (line) => res.issues.filter((i) => i.line === line).map((i) => i.message).join('\n');
  assert.match(at(2), /IPv4 アドレスの形/);
  assert.match(at(3), /逆に書いていませんか/);
  assert.match(at(4), /大文字/);
  assert.match(at(5), /常に false/);
  assert.match(at(6), /「;」/);
});

test('戻り値の形のチェック', () => {
  assert.equal(Core.checkReturnValue('DIRECT'), null);
  assert.equal(Core.checkReturnValue('PROXY proxy.example.com:8080; DIRECT'), null);
  assert.equal(Core.checkReturnValue('PROXY a.example.com:8080;PROXY b.example.com:3128;'), null);
  assert.equal(Core.checkReturnValue('SOCKS5 127.0.0.1:1080'), null);
  assert.equal(Core.checkReturnValue('HTTPS [2001:db8::1]:443'), null);
  assert.match(Core.checkReturnValue('PROXY'), /ホスト名:ポート/);
  assert.match(Core.checkReturnValue('PROXY:a.example.com:8080'), /空白/);
  assert.match(Core.checkReturnValue('PROXY a.example.com:8080, DIRECT'), /「,」/);
  assert.match(Core.checkReturnValue('PROXY a.example.com:99999'), /ポート番号/);
  assert.match(Core.checkReturnValue('DIRECT' + String.fromCharCode(0x3000)), /全角/);
  assert.match(Core.checkReturnValue('DIRECTT'), /形になっていません/);
});
