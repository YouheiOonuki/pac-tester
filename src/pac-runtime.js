// ===========================
// PAC ファイル テスター — PAC の標準ヘルパー関数（isInNet・shExpMatch など）
// Node のテスト（require）と、PAC を評価する Worker（文字列として埋め込む）の両方で使う
// 画面・通信には触れない純粋な関数だけを置く
//
// ふるまいは Firefox・Chromium の PAC の実装（どちらも Netscape の元の実装を引き継いだもの）に合わせている。
// 違うところは guide.html の「ヘルパー関数の一覧と注意点」に書いた
//   - shExpMatch: 使える記号は * と ? だけ（ブラウザの実装では [ ] や + などが正規表現として効いてしまうが、ここでは文字として扱う）
//   - dateRange: 終わりに月だけを書いたとき、その月の末日までとする（ブラウザの実装では 31 日のない月で数日ずれる）
//   - 時刻: 「評価に使う日時」と「UTC との時差」を設定で決める（実行している端末の時計は使わない）
// ===========================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PacRuntime = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WDAYS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  var MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  var IPV4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

  function isValidIpAddress(s) {
    var m = IPV4.exec(String(s));
    if (!m) return false;
    for (var i = 1; i <= 4; i++) if (Number(m[i]) > 255) return false;
    return true;
  }

  // shExpMatch のパターンを正規表現にする（* は 0 文字以上、? は 1 文字。ほかの記号は文字そのもの）
  function globToRegExp(pattern) {
    var src = String(pattern).replace(/[.+^${}()|[\]\\\/]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + src + '$');
  }

  // ホスト名→IP の対応表を作る。キーは小文字。"*.example.com" のように先頭の "*." で下のホストすべてにも当てられる
  function makeResolver(hosts) {
    var exact = Object.create(null);
    var wild = [];
    Object.keys(hosts || {}).forEach(function (k) {
      var name = k.trim().toLowerCase().replace(/\.$/, '');
      var ip = String(hosts[k]).trim();
      if (!name || !ip) return;
      if (name.indexOf('*.') === 0) wild.push({ suffix: name.slice(1), ip: ip });
      else exact[name] = ip;
    });
    wild.sort(function (a, b) { return b.suffix.length - a.suffix.length; });
    return function (host) {
      if (host === null || host === undefined) return null;
      var h = String(host).trim().toLowerCase().replace(/\.$/, '');
      if (isValidIpAddress(h)) return h;               // IP アドレスはそのまま
      if (/^\[?[0-9a-f:]+\]?$/.test(h) && h.indexOf(':') >= 0) return null; // IPv6 は扱わない
      if (h === 'localhost') return exact.localhost || '127.0.0.1';
      if (exact[h]) return exact[h];
      for (var i = 0; i < wild.length; i++) {
        if (h.length > wild[i].suffix.length && h.slice(-wild[i].suffix.length) === wild[i].suffix) return wild[i].ip;
      }
      return null;                                     // 対応表にないホストは「解決できない」
    };
  }

  // 日時: nowMs（UTC のミリ秒）と tzOffsetMin（UTC との時差・分。日本は 540）から、
  // 「その地域の壁時計」を UTC の Date として表す（getUTC* で読む）
  function wallClock(nowMs, tzOffsetMin, gmt) {
    return new Date(nowMs + (gmt ? 0 : tzOffsetMin * 60000));
  }
  function lastDay(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }

  function create(cfg) {
    cfg = cfg || {};
    var resolve = makeResolver(cfg.hosts);
    var myIp = cfg.myIp && isValidIpAddress(cfg.myIp) ? String(cfg.myIp) : '127.0.0.1';
    var tz = typeof cfg.tzOffsetMin === 'number' && isFinite(cfg.tzOffsetMin) ? cfg.tzOffsetMin : 0;
    var alerts = [];
    var regexCache = Object.create(null);

    function nowMs() {
      return typeof cfg.nowMs === 'number' && isFinite(cfg.nowMs) ? cfg.nowMs : Date.now();
    }
    function lastIsGmt(args) {
      return args.length > 0 && args[args.length - 1] === 'GMT';
    }

    var h = {};

    // ホスト名にドットが無い（例: intranet）。IPv6 アドレス（: を含む）も「ドット無し」とはしない
    h.isPlainHostName = function (host) {
      return String(host).search(/\.|:/) === -1;
    };

    // host が domain で終わる（大文字・小文字は区別する。ブラウザと同じ）
    h.dnsDomainIs = function (host, domain) {
      host = String(host); domain = String(domain);
      return host.length >= domain.length && host.substring(host.length - domain.length) === domain;
    };

    // host が hostdom と同じか、ドメイン無しで hostdom の先頭部分と同じ
    h.localHostOrDomainIs = function (host, hostdom) {
      host = String(host); hostdom = String(hostdom);
      return host === hostdom || hostdom.lastIndexOf(host + '.', 0) === 0;
    };

    h.isResolvable = function (host) {
      return resolve(host) !== null;
    };

    h.dnsResolve = function (host) {
      return resolve(host);
    };

    h.myIpAddress = function () {
      return myIp;
    };

    // ドットの数（www.example.com → 2）
    h.dnsDomainLevels = function (host) {
      return String(host).split('.').length - 1;
    };

    // IP アドレスを 32 ビットの整数にする（ブラウザと同じく符号付き）
    h.convert_addr = function (ipchars) {
      var b = String(ipchars).split('.');
      return ((b[0] & 0xff) << 24) | ((b[1] & 0xff) << 16) | ((b[2] & 0xff) << 8) | (b[3] & 0xff);
    };

    // ホスト名を渡したときは、対応表で IP アドレスにしてから比べる（解決できなければ false）
    h.isInNet = function (ipaddr, pattern, maskstr) {
      if (!isValidIpAddress(pattern) || !isValidIpAddress(maskstr)) return false;
      if (!isValidIpAddress(ipaddr)) {
        ipaddr = resolve(ipaddr);
        if (ipaddr === null) return false;
      }
      var host = h.convert_addr(ipaddr);
      var pat = h.convert_addr(pattern);
      var mask = h.convert_addr(maskstr);
      return (host & mask) === (pat & mask);
    };

    // * は 0 文字以上、? は 1 文字。全体が一致したときだけ true（大文字・小文字は区別する）
    h.shExpMatch = function (str, pattern) {
      var key = String(pattern);
      var re = regexCache[key] || (regexCache[key] = globToRegExp(key));
      return re.test(String(str));
    };

    // weekdayRange("MON", "FRI") / weekdayRange("SAT") / 最後に "GMT" で UTC の曜日
    h.weekdayRange = function () {
      var args = Array.prototype.slice.call(arguments);
      var gmt = lastIsGmt(args);
      if (gmt) args.pop();
      if (args.length < 1) return false;
      var wday = wallClock(nowMs(), tz, gmt).getUTCDay();
      var d1 = args[0] in WDAYS ? WDAYS[args[0]] : -1;
      var d2 = args.length >= 2 ? (args[1] in WDAYS ? WDAYS[args[1]] : -1) : d1;
      if (d1 === -1 || d2 === -1) return false;
      if (d1 <= d2) return d1 <= wday && wday <= d2;
      return d2 >= wday || wday >= d1;                  // FRI〜MON のような、週をまたぐ指定
    };

    // dateRange(日) / dateRange("月") / dateRange(年) / dateRange(日1, 日2) / dateRange("月1", "月2") /
    // dateRange(日, "月", 日, "月") / dateRange("月", 年, "月", 年) / dateRange(日, "月", 年, 日, "月", 年)
    h.dateRange = function () {
      var args = Array.prototype.slice.call(arguments);
      var gmt = lastIsGmt(args);
      if (gmt) args.pop();
      var argc = args.length;
      if (argc < 1) return false;
      var now = wallClock(nowMs(), tz, gmt);
      var cy = now.getUTCFullYear(), cm = now.getUTCMonth(), cd = now.getUTCDate();
      if (argc === 1) {
        var v = parseInt(args[0], 10);
        if (isNaN(v)) return cm === (args[0] in MONTHS ? MONTHS[args[0]] : -1);
        if (v < 32) return cd === v;
        return cy === v;
      }
      function side(list) {
        var s = {};
        list.forEach(function (a) {
          var v = parseInt(a, 10);
          if (isNaN(v)) s.m = a in MONTHS ? MONTHS[a] : -1;
          else if (v < 32) s.d = v;
          else s.y = v;
        });
        return s;
      }
      var half = argc >> 1;
      var a = side(args.slice(0, half));
      var b = side(args.slice(half));
      if (a.m === -1 || b.m === -1) return false;
      // 日だけを 2 つ指定したときは、今月の中の範囲
      if (argc === 2 && a.d !== undefined && b.d !== undefined) { a.m = cm; b.m = cm; }
      var y1 = a.y !== undefined ? a.y : cy;
      var m1 = a.m !== undefined ? a.m : 0;
      var y2 = b.y !== undefined ? b.y : cy;
      var m2 = b.m !== undefined ? b.m : 11;
      var start = Date.UTC(y1, m1, a.d !== undefined ? a.d : 1, 0, 0, 0);
      var end = Date.UTC(y2, m2, b.d !== undefined ? b.d : lastDay(y2, m2), 23, 59, 59);
      var t = Math.floor(now.getTime() / 1000) * 1000;
      if (start <= end) return start <= t && t <= end;
      return t <= end || t >= start;                    // 年末年始をまたぐ指定（例: "DEC", "JAN"）
    };

    // timeRange(時) / timeRange(時1, 時2) / timeRange(時1, 分1, 時2, 分2) / timeRange(時1, 分1, 秒1, 時2, 分2, 秒2)
    // 時を 2 つ書く形は「時1 ≤ 今の時 ≤ 時2」で、日をまたがない（ブラウザと同じ。timeRange(22, 6) は常に false）
    h.timeRange = function () {
      var args = Array.prototype.slice.call(arguments);
      var gmt = lastIsGmt(args);
      if (gmt) args.pop();
      var argc = args.length;
      if (argc < 1) return false;
      var now = wallClock(nowMs(), tz, gmt);
      var hour = now.getUTCHours();
      var n = args.map(function (x) { return Number(x); });
      if (argc === 1) return hour === n[0];
      if (argc === 2) return n[0] <= hour && hour <= n[1];
      var sec = hour * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
      var s1, s2;
      if (argc === 4) { s1 = n[0] * 3600 + n[1] * 60; s2 = n[2] * 3600 + n[3] * 60 + 59; }
      else if (argc === 6) { s1 = n[0] * 3600 + n[1] * 60 + n[2]; s2 = n[3] * 3600 + n[4] * 60 + n[5]; }
      else throw new Error('timeRange: 引数の数が正しくありません（1・2・4・6 個）');
      if (s1 <= s2) return s1 <= sec && sec <= s2;
      return sec <= s2 || sec >= s1;                    // 22:00〜06:00 のような、日をまたぐ指定
    };

    h.alert = function (msg) {
      if (alerts.length < 50) alerts.push(String(msg).slice(0, 500));
    };

    return {
      helpers: h,
      takeAlerts: function () { var a = alerts.slice(); alerts.length = 0; return a; }
    };
  }

  var HELPER_NAMES = ['isPlainHostName', 'dnsDomainIs', 'localHostOrDomainIs', 'isResolvable', 'isInNet',
    'dnsResolve', 'convert_addr', 'myIpAddress', 'dnsDomainLevels', 'shExpMatch', 'weekdayRange',
    'dateRange', 'timeRange', 'alert'];

  return {
    create: create,
    HELPER_NAMES: HELPER_NAMES,
    isValidIpAddress: isValidIpAddress,
    globToRegExp: globToRegExp
  };
});
