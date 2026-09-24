// PAC の標準ヘルパー関数（src/pac-runtime.js）のテスト: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const PacRuntime = require('../src/pac-runtime.js');

const hosts = {
  'files.example.com': '192.168.10.20',
  'app.example.org': '172.16.5.4',
  '*.lab.example': '10.9.0.1',
  'WWW.Example.NET': '203.0.113.10',
};
// 2026-09-24（木）20:00 UTC ＝ 2026-09-25（金）05:00 日本時間（UTC+9）
const NOW = Date.UTC(2026, 8, 24, 20, 0, 0);
const h = PacRuntime.create({ hosts, myIp: '192.168.1.10', nowMs: NOW, tzOffsetMin: 540 }).helpers;
const at = (y, mo, d, hh, mi, ss) => PacRuntime.create({ nowMs: Date.UTC(y, mo - 1, d, hh, mi || 0, ss || 0) - 540 * 60000, tzOffsetMin: 540 }).helpers;

test('shExpMatch: * は 0 文字以上、? は 1 文字。全体が一致したときだけ true', () => {
  assert.equal(h.shExpMatch('www.example.com', '*.example.com'), true);
  assert.equal(h.shExpMatch('a.b.example.com', '*.example.com'), true);
  assert.equal(h.shExpMatch('example.com', '*.example.com'), false);
  assert.equal(h.shExpMatch('www.example.com.evil.example', '*.example.com'), false);
  assert.equal(h.shExpMatch('abc', '*'), true);
  assert.equal(h.shExpMatch('', '*'), true);
  assert.equal(h.shExpMatch('a.b', '?.b'), true);
  assert.equal(h.shExpMatch('ab.b', '?.b'), false);
  assert.equal(h.shExpMatch('.b', '?.b'), false);
  assert.equal(h.shExpMatch('host01.example.com', 'host??.example.com'), true);
  assert.equal(h.shExpMatch('host1.example.com', 'host??.example.com'), false);
  assert.equal(h.shExpMatch('http://www.example.com/a/b', 'http://*.example.com/*'), true);
  assert.equal(h.shExpMatch('http://www.example.com', 'http://*.example.com/*'), false);
});

test('shExpMatch: ドットやほかの記号は文字そのもの。大文字・小文字は区別する', () => {
  assert.equal(h.shExpMatch('axb', 'a.b'), false);
  assert.equal(h.shExpMatch('a.b', 'a.b'), true);
  assert.equal(h.shExpMatch('a+b', 'a+b'), true);
  assert.equal(h.shExpMatch('aab', 'a+b'), false);
  assert.equal(h.shExpMatch('x[1]', 'x[1]'), true);
  assert.equal(h.shExpMatch('x1', 'x[1]'), false);
  assert.equal(h.shExpMatch('WWW.example.com', 'www.example.com'), false);
});

test('isInNet: サブネットの判定', () => {
  assert.equal(h.isInNet('192.168.1.10', '192.168.0.0', '255.255.0.0'), true);
  assert.equal(h.isInNet('192.169.0.1', '192.168.0.0', '255.255.0.0'), false);
  assert.equal(h.isInNet('172.31.255.255', '172.16.0.0', '255.240.0.0'), true);
  assert.equal(h.isInNet('172.32.0.0', '172.16.0.0', '255.240.0.0'), false);
  assert.equal(h.isInNet('172.15.255.255', '172.16.0.0', '255.240.0.0'), false);
  assert.equal(h.isInNet('10.1.2.3', '10.1.2.3', '255.255.255.255'), true);
  assert.equal(h.isInNet('10.1.2.4', '10.1.2.3', '255.255.255.255'), false);
  assert.equal(h.isInNet('198.51.100.7', '0.0.0.0', '0.0.0.0'), true);
  assert.equal(h.isInNet('192.168.100.25', '192.168.100.0', '255.255.255.0'), true);
  // ホスト名は対応表で IP にしてから比べる。解決できなければ false
  assert.equal(h.isInNet('files.example.com', '192.168.0.0', '255.255.0.0'), true);
  assert.equal(h.isInNet('app.example.org', '172.16.0.0', '255.240.0.0'), true);
  assert.equal(h.isInNet('unknown.example.com', '0.0.0.0', '0.0.0.0'), false);
  // 形の正しくないネットワーク・マスクは false
  assert.equal(h.isInNet('10.0.0.1', '10.0.0.0', '/8'), false);
  assert.equal(h.isInNet('10.0.0.1', '10.0.0', '255.0.0.0'), false);
  assert.equal(h.isInNet('10.0.0.1', '10.0.0.0', '255.0.0.256'), false);
});

test('dnsResolve・isResolvable: ホスト名と IP の対応表だけを使う', () => {
  assert.equal(h.dnsResolve('files.example.com'), '192.168.10.20');
  assert.equal(h.dnsResolve('FILES.example.com'), '192.168.10.20');
  assert.equal(h.dnsResolve('www.example.net'), '203.0.113.10');
  assert.equal(h.dnsResolve('a.lab.example'), '10.9.0.1');
  assert.equal(h.dnsResolve('x.y.lab.example'), '10.9.0.1');
  assert.equal(h.dnsResolve('lab.example'), null);
  assert.equal(h.dnsResolve('10.20.30.40'), '10.20.30.40');
  assert.equal(h.dnsResolve('localhost'), '127.0.0.1');
  assert.equal(h.dnsResolve('nowhere.example.org'), null);
  assert.equal(h.isResolvable('files.example.com'), true);
  assert.equal(h.isResolvable('nowhere.example.org'), false);
  assert.equal(h.myIpAddress(), '192.168.1.10');
  assert.equal(PacRuntime.create({}).helpers.myIpAddress(), '127.0.0.1');
});

test('dnsDomainIs・localHostOrDomainIs・isPlainHostName・dnsDomainLevels', () => {
  assert.equal(h.dnsDomainIs('www.example.com', '.example.com'), true);
  assert.equal(h.dnsDomainIs('example.com', '.example.com'), false);
  assert.equal(h.dnsDomainIs('www.example.org', '.example.com'), false);
  assert.equal(h.dnsDomainIs('badexample.com', 'example.com'), true);   // 先頭のドットが無いと、ほかの名前にも当てはまる
  assert.equal(h.dnsDomainIs('www.Example.com', '.example.com'), false); // 大文字・小文字は区別する（ブラウザと同じ）

  assert.equal(h.localHostOrDomainIs('www', 'www.example.com'), true);
  assert.equal(h.localHostOrDomainIs('www.example.com', 'www.example.com'), true);
  assert.equal(h.localHostOrDomainIs('www.example.org', 'www.example.com'), false);
  assert.equal(h.localHostOrDomainIs('home', 'www.example.com'), false);
  assert.equal(h.localHostOrDomainIs('ww', 'www.example.com'), false);

  assert.equal(h.isPlainHostName('intranet'), true);
  assert.equal(h.isPlainHostName('www.example.com'), false);
  assert.equal(h.isPlainHostName('::1'), false);

  assert.equal(h.dnsDomainLevels('www.example.com'), 2);
  assert.equal(h.dnsDomainLevels('example.com'), 1);
  assert.equal(h.dnsDomainLevels('intranet'), 0);
});

test('convert_addr: ブラウザと同じ 32 ビットの整数（符号付き）', () => {
  assert.equal(h.convert_addr('10.0.0.1'), 167772161);
  assert.equal(h.convert_addr('192.168.0.1'), -1062731775);
  assert.equal(h.convert_addr('192.168.0.1') >>> 0, 3232235521);
  assert.equal(h.convert_addr('0.0.0.0'), 0);
  assert.equal(h.convert_addr('255.255.255.255'), -1);
});

test('weekdayRange: 決めた日時で判定する（日本時間 金曜 5:00 ＝ UTC 木曜 20:00）', () => {
  assert.equal(h.weekdayRange('FRI'), true);
  assert.equal(h.weekdayRange('THU'), false);
  assert.equal(h.weekdayRange('THU', 'GMT'), true);
  assert.equal(h.weekdayRange('FRI', 'GMT'), false);
  assert.equal(h.weekdayRange('MON', 'FRI'), true);
  assert.equal(h.weekdayRange('SAT', 'SUN'), false);
  assert.equal(h.weekdayRange('FRI', 'MON'), true);        // 週をまたぐ指定
  assert.equal(h.weekdayRange('SAT', 'THU'), false);
  assert.equal(h.weekdayRange('fri'), false);              // 小文字は使えない（ブラウザと同じ）
  assert.equal(h.weekdayRange(), false);
});

test('timeRange: 時・分・秒の範囲と GMT', () => {
  assert.equal(h.timeRange(5), true);
  assert.equal(h.timeRange(20, 'GMT'), true);
  assert.equal(h.timeRange(9, 17), false);
  assert.equal(h.timeRange(0, 5), true);                  // 時だけの指定は 5:59 までを含む
  assert.equal(h.timeRange(22, 6), false);                // 時だけの指定は日をまたがない（ブラウザと同じ）
  assert.equal(h.timeRange(22, 0, 6, 0), true);           // 時・分の指定は日をまたげる
  assert.equal(h.timeRange(4, 30, 5, 0), true);           // 終わりの分は 59 秒まで
  assert.equal(h.timeRange(5, 0, 1, 5, 30, 0), false);    // 5:00:01〜 なので 5:00:00 は外
  assert.equal(h.timeRange(5, 0, 0, 5, 0, 0), true);
  assert.equal(h.timeRange(19, 0, 21, 0, 'GMT'), true);
  assert.throws(() => h.timeRange(1, 2, 3));
});

test('dateRange: 日・月・年と、その組み合わせ', () => {
  assert.equal(h.dateRange(25), true);
  assert.equal(h.dateRange(24), false);
  assert.equal(h.dateRange(24, 'GMT'), true);
  assert.equal(h.dateRange('SEP'), true);
  assert.equal(h.dateRange('OCT'), false);
  assert.equal(h.dateRange(2026), true);
  assert.equal(h.dateRange(2025), false);
  assert.equal(h.dateRange(20, 26), true);                   // 今月の 20〜26 日
  assert.equal(h.dateRange(1, 24), false);
  assert.equal(h.dateRange('SEP', 'OCT'), true);
  assert.equal(h.dateRange('JAN', 'AUG'), false);
  assert.equal(h.dateRange('DEC', 'OCT'), true);             // 年をまたぐ指定
  assert.equal(h.dateRange('OCT', 'AUG'), false);
  assert.equal(h.dateRange(1, 'SEP', 30, 'SEP'), true);
  assert.equal(h.dateRange(26, 'SEP', 30, 'SEP'), false);
  assert.equal(h.dateRange('SEP', 2026, 'DEC', 2026), true);
  assert.equal(h.dateRange('SEP', 2027, 'DEC', 2027), false);
  assert.equal(h.dateRange(1, 'JAN', 2026, 31, 'DEC', 2026), true);
  assert.equal(h.dateRange(25, 'SEP', 2026, 25, 'SEP', 2026), true);
  assert.equal(h.dateRange('XYZ'), false);
});

test('dateRange: 終わりに月だけを書くと、その月の末日まで', () => {
  assert.equal(at(2026, 2, 28, 23, 30).dateRange('JAN', 'FEB'), true);
  assert.equal(at(2026, 3, 1, 0, 0).dateRange('JAN', 'FEB'), false);
  assert.equal(at(2026, 4, 30, 12).dateRange('APR', 'APR'), true);
  assert.equal(at(2026, 5, 1, 0).dateRange('APR', 'APR'), false);
  assert.equal(at(2026, 1, 3, 9).dateRange('DEC', 'JAN'), true);
});

test('alert: 評価ごとに集める', () => {
  const rt = PacRuntime.create({});
  rt.helpers.alert('a');
  rt.helpers.alert(1);
  assert.deepEqual(rt.takeAlerts(), ['a', '1']);
  assert.deepEqual(rt.takeAlerts(), []);
});
