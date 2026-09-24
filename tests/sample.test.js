// 見本の PAC の期待値の表: node --test tests/*.test.js
// 受け入れ: 見本の PAC で、代表的な URL の戻り値が期待どおりになる
const test = require('node:test');
const assert = require('node:assert/strict');
const { evalPac, sampleConfig, Core } = require('./helpers.js');

// URL → 期待する戻り値（https はパスを除いて渡す＝既定の設定）
const EXPECTED = [
  ['http://intranet/', 'DIRECT'],                                              // 1. ドットの無いホスト名
  ['https://portal.corp.example/login', 'DIRECT'],                            // 2. 組織の中のドメイン
  ['https://files.example.com/share/report.xlsx', 'DIRECT'],                  // 3. 対応表で 192.168.10.20
  ['http://app.example.org/', 'DIRECT'],                                       // 3. 対応表で 172.16.5.4
  ['http://10.20.30.40/', 'DIRECT'],                                           // 3. IP アドレスそのもの
  ['https://media.video.example.net/watch?v=1', 'PROXY proxy2.example.net:8080'], // 4. 動画
  ['http://update.example.org/pkg/latest.bin', 'DIRECT'],                     // 5. http の更新サーバー
  ['https://update.example.org/pkg/latest.bin', 'PROXY proxy.example.net:8080; PROXY proxy-backup.example.net:8080'], // 5 に当たらない（https）
  ['https://www.example.com/', 'PROXY proxy.example.net:8080; PROXY proxy-backup.example.net:8080'], // 対応表で 203.0.113.10（公開側）
  ['https://shop.example.net/cart', 'PROXY proxy.example.net:8080; PROXY proxy-backup.example.net:8080'],
];

test('見本の URL 一覧は、期待値の表と同じ並び', () => {
  const urls = Core.parseUrlList(Core.SAMPLE_URLS, { stripHttpsPath: true });
  assert.deepEqual(urls.map((u) => u.url), EXPECTED.map((e) => e[0]));
});

test('見本の PAC: 代表的な URL の戻り値が期待どおり', () => {
  const urls = Core.parseUrlList(Core.SAMPLE_URLS, { stripHttpsPath: true });
  const res = evalPac(Core.SAMPLE_PAC, urls, sampleConfig());
  res.forEach((r, i) => {
    assert.equal(r.ok, true, urls[i].url + ': ' + r.error);
    assert.equal(r.value, EXPECTED[i][1], urls[i].url);
    assert.equal(Core.checkReturnValue(r.value), null, urls[i].url);
  });
});

test('見本の PAC: 支店のネットワーク（myIpAddress）では支店のプロキシ', () => {
  const urls = Core.parseUrlList('https://www.example.com/\nhttp://intranet/', { stripHttpsPath: true });
  const res = evalPac(Core.SAMPLE_PAC, urls, sampleConfig({ myIp: '192.168.100.25' }));
  assert.equal(res[0].value, 'PROXY branch-proxy.example.net:8080; DIRECT');
  assert.equal(res[1].value, 'DIRECT');
});

test('見本の PAC: https のパスを渡す設定にしても結果は同じ（パスで判定していない）', () => {
  const urls = Core.parseUrlList(Core.SAMPLE_URLS, { stripHttpsPath: false });
  const res = evalPac(Core.SAMPLE_PAC, urls, sampleConfig());
  assert.deepEqual(res.map((r) => r.value), EXPECTED.map((e) => e[1]));
});

test('見本の PAC は lint で問題が出ない', () => {
  const acorn = require('acorn');
  assert.deepEqual(Core.lint(Core.SAMPLE_PAC, acorn).issues, []);
});

test('無限ループする PAC は、1 件ずつタイムアウトになる（Node の vm で 200 ミリ秒）', () => {
  const urls = Core.parseUrlList('http://a.example.com/\nhttp://b.example.com/', {});
  const t0 = Date.now();
  const res = evalPac('function FindProxyForURL(u, h) { while (true) {} }', urls, sampleConfig());
  assert.ok(Date.now() - t0 < 3000);
  res.forEach((r) => { assert.equal(r.ok, false); assert.equal(r.timeout, true); });
});

test('見本は架空のドメインとプライベート・文書用の IP アドレスだけを使う', () => {
  const text = Core.SAMPLE_PAC + Core.SAMPLE_URLS + Core.SAMPLE_HOSTS;
  const names = text.match(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/gi).filter((s) => /[a-z]/i.test(s) && !/^\d/.test(s));
  for (const n of names) assert.match(n.toLowerCase(), /(^|\.)(example\.(com|net|org)|example)$|^(pkg\/)?latest\.bin$|^report\.xlsx$/, n);
  const ips = text.match(/\b\d+\.\d+\.\d+\.\d+\b/g);
  for (const ip of ips) assert.match(ip, /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|255\.|203\.0\.113\.|198\.51\.100\.)/, ip);
});
