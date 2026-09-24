// URL 一覧・ホスト表・差分・CSV のテスト: node --test tests/*.test.js
// 受け入れ: 差分モードで、変更のない URL は強調されない
const test = require('node:test');
const assert = require('node:assert/strict');
const { evalPac, sampleConfig, Core } = require('./helpers.js');

test('URL 一覧: ホスト名を取り出す。https はパスを除いて渡す設定がある', () => {
  const list = Core.parseUrlList([
    '# メモ',
    '',
    'https://User:Pass@WWW.Example.com:8443/a/b?c=1#frag',
    'www.example.org/path',
    'http://[2001:db8::1]/',
    'http://',
    'ftp://files.example.net/pub/',
  ].join('\r\n'), { stripHttpsPath: true });
  assert.equal(list.length, 5);
  assert.equal(list[0].line, 3);
  assert.equal(list[0].host, 'www.example.com');
  assert.equal(list[0].url, 'https://www.example.com:8443/a/b?c=1');
  assert.equal(list[0].pacUrl, 'https://www.example.com:8443/');
  assert.equal(list[1].url, 'http://www.example.org/path');
  assert.equal(list[1].pacUrl, 'http://www.example.org/path');
  assert.equal(list[2].host, '2001:db8::1');
  assert.ok(list[3].error);
  assert.equal(list[4].host, 'files.example.net');
  const full = Core.parseUrlList('https://www.example.com/a?b=1', { stripHttpsPath: false });
  assert.equal(full[0].pacUrl, 'https://www.example.com/a?b=1');
});

test('ホスト表: 「ホスト IP」と hosts ファイルの「IP ホスト…」の両方を読む', () => {
  const t = Core.parseHostTable([
    '# コメント',
    'App.example.com 10.0.0.5',
    '192.168.0.10  files.example.com  files   # hosts ファイルの形',
    'db.example.org=172.16.0.9',
    'bad line',
    'x.example.com 999.1.1.1',
  ].join('\n'));
  assert.deepEqual(t.hosts, {
    'app.example.com': '10.0.0.5',
    'files.example.com': '192.168.0.10',
    files: '192.168.0.10',
    'db.example.org': '172.16.0.9',
  });
  assert.deepEqual(t.errors.map((e) => e.line), [5, 6]);
});

test('差分: 変わった URL だけが changed。変わっていない URL は強調しない', () => {
  const urls = Core.parseUrlList(Core.SAMPLE_URLS, { stripHttpsPath: true });
  const cfg = sampleConfig();
  const oldRes = evalPac(Core.SAMPLE_PAC, urls, cfg);
  // 新 PAC: 動画のプロキシを変え、example.org を直接にする
  const newPac = Core.SAMPLE_PAC
    .replace('"PROXY proxy2.example.net:8080"', '"PROXY proxy3.example.net:8080"')
    .replace('  // 6. 支店', '  if (dnsDomainIs(host, ".example.org")) {\n    return "DIRECT";\n  }\n\n  // 6. 支店');
  const newRes = evalPac(newPac, urls, cfg);
  const d = Core.diffResults(urls, oldRes, newRes);
  const changedUrls = d.rows.filter((r) => r.changed).map((r) => urls[r.index].url);
  assert.deepEqual(changedUrls, [
    'https://media.video.example.net/watch?v=1',
    'https://update.example.org/pkg/latest.bin',
  ]);
  assert.equal(d.changed, 2);

  // 同じ PAC どうしなら 1 件も変わらない（空白の違いだけも変化にしない）
  const same = Core.diffResults(urls, oldRes, evalPac(Core.SAMPLE_PAC.replace(/; PROXY/g, ';PROXY'), urls, cfg));
  assert.equal(same.changed, 0);
  assert.ok(same.rows.every((r) => !r.changed));
});

test('差分: エラーやタイムアウトになった URL は変化として数える', () => {
  const urls = Core.parseUrlList('http://a.example.com/\nhttp://b.example.com/', {});
  const a = [{ ok: true, value: 'DIRECT', valueType: 'string' }, { ok: true, value: 'DIRECT', valueType: 'string' }];
  const b = [{ ok: true, value: 'DIRECT', valueType: 'string' }, { ok: false, timeout: true, error: 'x' }];
  const d = Core.diffResults(urls, a, b);
  assert.deepEqual(d.rows.map((r) => r.changed), [false, true]);
});

test('結果の種類（色分け用）', () => {
  const c = (value, extra) => Core.classifyResult(Object.assign({ ok: true, value, valueType: 'string' }, extra));
  assert.equal(c('DIRECT'), 'direct');
  assert.equal(c('PROXY a.example.com:8080'), 'proxy');
  assert.equal(c('PROXY a.example.com:8080; DIRECT'), 'proxy-direct');
  assert.equal(c('SOCKS5 a.example.com:1080'), 'socks');
  assert.equal(c('PROXY'), 'invalid');
  assert.equal(c('undefined', { valueType: 'undefined' }), 'invalid');
  assert.equal(Core.classifyResult({ ok: false, timeout: true }), 'timeout');
  assert.equal(Core.classifyResult({ ok: false }), 'error');
});

test('CSV: 引用符・改行・式に見える値の扱い', () => {
  const csv = Core.toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['=1+1', 'line\nbreak']]);
  assert.equal(csv, 'a,b\r\n"x,y","say ""hi"""\r\n\'=1+1,"line\nbreak"\r\n');
});
