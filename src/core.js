// ===========================
// PAC ファイル テスター — 画面から切り離した純粋な関数（Node のテストと画面の両方で使う）
// URL 一覧・ホスト表の読み取り、構文・ロジックのチェック（lint。acorn で構文木を作るだけで、PAC は実行しない）、
// 戻り値の形のチェック、差分、CSV、見本
// 注意: このファイルは pac-tester.html の script 要素にそのまま入るので、「<」のすぐ後ろに script と書かない
// ===========================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PacCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 見本（架空のドメイン example.com / example.net / example.org / *.example と、プライベート IP アドレスだけ） ----------
  var SAMPLE_PAC = [
    '// 見本の PAC ファイル（架空のドメインとプライベート IP アドレスだけを使っています）',
    'function FindProxyForURL(url, host) {',
    '  // 1. ドットの無いホスト名（例: http://intranet/）はプロキシを通さない',
    '  if (isPlainHostName(host)) {',
    '    return "DIRECT";',
    '  }',
    '',
    '  // 2. 組織の中のドメインはプロキシを通さない',
    '  if (dnsDomainIs(host, ".corp.example") || host == "corp.example") {',
    '    return "DIRECT";',
    '  }',
    '',
    '  // 3. プライベート IP アドレス（ホスト名は「ホスト名と IP アドレスの対応表」で IP にしてから比べる）',
    '  if (isInNet(host, "10.0.0.0", "255.0.0.0") ||',
    '      isInNet(host, "172.16.0.0", "255.240.0.0") ||',
    '      isInNet(host, "192.168.0.0", "255.255.0.0") ||',
    '      isInNet(host, "127.0.0.0", "255.0.0.0")) {',
    '    return "DIRECT";',
    '  }',
    '',
    '  // 4. 動画の配信は別のプロキシへ',
    '  if (shExpMatch(host, "*.video.example.net")) {',
    '    return "PROXY proxy2.example.net:8080";',
    '  }',
    '',
    '  // 5. 更新ファイルの配布サーバー（http だけ）はプロキシを通さない',
    '  if (shExpMatch(url, "http://update.example.org/*")) {',
    '    return "DIRECT";',
    '  }',
    '',
    '  // 6. 支店のネットワーク（自分の IP アドレスで判断）は支店のプロキシへ。つながらなければ直接',
    '  if (isInNet(myIpAddress(), "192.168.100.0", "255.255.255.0")) {',
    '    return "PROXY branch-proxy.example.net:8080; DIRECT";',
    '  }',
    '',
    '  // 7. それ以外は標準のプロキシ。落ちていたら予備のプロキシ',
    '  return "PROXY proxy.example.net:8080; PROXY proxy-backup.example.net:8080";',
    '}',
    ''
  ].join('\n');

  var SAMPLE_URLS = [
    '# 1 行に 1 つの URL（# で始まる行はメモ）',
    'http://intranet/',
    'https://portal.corp.example/login',
    'https://files.example.com/share/report.xlsx',
    'http://app.example.org/',
    'http://10.20.30.40/',
    'https://media.video.example.net/watch?v=1',
    'http://update.example.org/pkg/latest.bin',
    'https://update.example.org/pkg/latest.bin',
    'https://www.example.com/',
    'https://shop.example.net/cart',
    ''
  ].join('\n');

  var SAMPLE_HOSTS = [
    '# ホスト名 と IP アドレス（1 行に 1 組。hosts ファイルと同じ「IP ホスト名」の順でも可）',
    'files.example.com 192.168.10.20',
    'app.example.org 172.16.5.4',
    'www.example.com 203.0.113.10',
    'shop.example.net 198.51.100.20',
    ''
  ].join('\n');

  var SAMPLE_MY_IP = '192.168.1.10';

  // ---------- 文字まわり ----------
  var IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  function isIPv4(s) {
    var m = IPV4.exec(String(s));
    if (!m) return false;
    for (var i = 1; i <= 4; i++) if (Number(m[i]) > 255) return false;
    return true;
  }

  // ---------- URL 一覧 ----------
  // opts.stripHttpsPath: https（と wss）の URL は、パスとクエリを除いて「https://ホスト/」だけを渡す（Chrome・Edge の動き）
  function parseUrlList(text, opts) {
    opts = opts || {};
    var out = [];
    String(text || '').split(/\r\n?|\n/).forEach(function (raw, i) {
      var line = raw.trim();
      if (!line || line.charAt(0) === '#') return;
      var src = /^[a-z][a-z0-9+.-]*:\/\//i.test(line) ? line : 'http://' + line;
      var item = { line: i + 1, raw: line };
      try {
        var u = new URL(src);
        if (!u.hostname) throw new Error('no host');
        var host = u.hostname;
        if (host.charAt(0) === '[') host = host.slice(1, -1);
        u.hash = '';
        u.username = '';
        u.password = '';
        item.url = u.href;
        item.host = host;
        item.pacUrl = opts.stripHttpsPath && (u.protocol === 'https:' || u.protocol === 'wss:')
          ? u.protocol + '//' + u.host + '/'
          : u.href;
      } catch (e) {
        item.error = 'URL として読めません';
      }
      out.push(item);
    });
    return out;
  }

  // ---------- ホスト名と IP の対応表 ----------
  function parseHostTable(text) {
    var hosts = {};
    var errors = [];
    String(text || '').split(/\r\n?|\n/).forEach(function (raw, i) {
      var line = raw.replace(/#.*$/, '').trim();
      if (!line) return;
      var parts = line.split(/[\s,=\t]+/).filter(Boolean);
      if (parts.length < 2) { errors.push({ line: i + 1, message: 'ホスト名と IP アドレスの 2 つを書いてください' }); return; }
      var ip, names;
      if (isIPv4(parts[0])) { ip = parts[0]; names = parts.slice(1); }
      else if (isIPv4(parts[1])) { ip = parts[1]; names = [parts[0]]; }
      else { errors.push({ line: i + 1, message: 'IPv4 アドレス（例: 192.168.0.10）が見つかりません' }); return; }
      names.forEach(function (n) { hosts[n.toLowerCase()] = ip; });
    });
    return { hosts: hosts, errors: errors };
  }

  // ---------- 戻り値の形 ----------
  var PROXY_ITEM = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5|QUIC)\s+(\[[0-9A-Fa-f:.]+\]|[^\s:;\[\]]+)(:(\d{1,5}))?$/i;

  // 戻り値の文字列を調べる。問題がなければ null、あれば日本語の説明
  function checkReturnValue(s) {
    if (typeof s !== 'string') return '文字列ではありません';
    var t = s.trim();
    if (!t) return '空の文字列です（ブラウザは DIRECT として扱うことが多いですが、意図どおりか確かめてください）';
    if (/[\u3000\uFF01-\uFF5E]/.test(s)) return '全角文字が入っています';
    if (t.indexOf(',') >= 0 && t.indexOf(';') < 0 && /(PROXY|DIRECT|SOCKS|HTTPS?)\b.*,/i.test(t)) return '区切りに「,」が使われています（正しくは「;」）';
    var items = t.split(';').map(function (x) { return x.trim(); }).filter(function (x, i, a) { return x || i < a.length - 1; });
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) return '「;」が続いています（空の項目があります）';
      if (/^DIRECT$/i.test(it)) continue;
      var m = PROXY_ITEM.exec(it);
      if (!m) {
        if (/^(PROXY|HTTP|HTTPS|SOCKS[45]?)$/i.test(it)) return '「' + it + '」の後ろにホスト名:ポートがありません';
        if (/^(PROXY|HTTPS?|SOCKS[45]?):/i.test(it)) return '「' + it + '」: 種類とホスト名の間は空白で区切ります（例: PROXY proxy.example.com:8080）';
        return '「' + it + '」は DIRECT・PROXY ホスト:ポート・SOCKS ホスト:ポート などの形になっていません';
      }
      if (m[4] !== undefined && (Number(m[4]) < 1 || Number(m[4]) > 65535)) return '「' + it + '」のポート番号が 1〜65535 の範囲外です';
    }
    return null;
  }

  // 比べやすい形にする（「;」の前後の空白をそろえる）
  function normalizeValue(s) {
    return String(s).trim().split(';').map(function (x) { return x.trim().replace(/\s+/g, ' '); })
      .filter(function (x) { return x; }).join('; ');
  }

  // 色分けの種類: direct / proxy / proxy-direct（プロキシ→だめなら直接）/ socks / invalid / error
  function classifyResult(r) {
    if (!r) return 'pending';
    if (!r.ok) return r.timeout ? 'timeout' : 'error';
    if (r.valueType !== 'string' || checkReturnValue(r.value)) return 'invalid';
    var items = normalizeValue(r.value).split('; ');
    var hasDirect = items.some(function (x) { return /^DIRECT$/i.test(x); });
    var hasSocks = items.some(function (x) { return /^SOCKS/i.test(x); });
    if (items.every(function (x) { return /^DIRECT$/i.test(x); })) return 'direct';
    if (hasSocks) return 'socks';
    return hasDirect ? 'proxy-direct' : 'proxy';
  }

  // 結果を 1 つの文字列にする（表示・差分・CSV 用）
  function resultText(r) {
    if (!r) return '';
    if (!r.ok) return r.timeout ? '（タイムアウト）' : '（エラー）' + (r.error || '');
    if (r.valueType !== 'string') return '（' + r.valueType + '）' + r.value;
    return normalizeValue(r.value);
  }

  // ---------- 差分 ----------
  // resultsA・resultsB は URL の順に並んだ評価結果。返り値は URL ごとの { changed, a, b }
  function diffResults(urls, resultsA, resultsB) {
    var rows = [];
    var changed = 0;
    for (var i = 0; i < urls.length; i++) {
      var a = resultsA[i], b = resultsB[i];
      var c = resultText(a) !== resultText(b);
      if (c) changed++;
      rows.push({ index: i, changed: c, a: a, b: b });
    }
    return { rows: rows, changed: changed };
  }

  // ---------- CSV ----------
  function csvField(v) {
    var s = v === undefined || v === null ? '' : String(v);
    // 表計算ソフトで式として読まれないようにする
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(header, rows) {
    return [header].concat(rows).map(function (r) { return r.map(csvField).join(','); }).join('\r\n') + '\r\n';
  }

  // ---------- shExpMatch のパターン（* と ?）どうしの包含 ----------
  function normalizeGlob(p) {
    var s = String(p).replace(/\*+/g, '*');
    // 「*?」と「?*」は同じ意味なので、? を前に寄せる
    var prev;
    do { prev = s; s = s.replace(/\*\?/g, '?*').replace(/\*+/g, '*'); } while (s !== prev);
    return s;
  }
  // p1 が p2 を含む（p2 に当てはまる文字列は、必ず p1 にも当てはまる）なら true。近似（true と言えるときだけ true）
  function globCovers(p1, p2) {
    var a = normalizeGlob(p1), b = normalizeGlob(p2);
    var memo = {};
    function m(i, j) {
      var key = i + ',' + j;
      if (key in memo) return memo[key];
      var r;
      if (i === a.length) r = j === b.length;
      else if (a[i] === '*') {
        r = false;
        for (var k = j; k <= b.length && !r; k++) r = m(i + 1, k);
      } else if (j === b.length || b[j] === '*') r = false;
      else if (a[i] === '?') r = m(i + 1, j + 1);
      else r = a[i] === b[j] && m(i + 1, j + 1);
      memo[key] = r;
      return r;
    }
    return m(0, 0);
  }

  // ---------- 文字列・コメントの位置と、括弧の対応（構文エラーがあっても動く簡易な読み取り） ----------
  var REGEX_AFTER_WORD = { 'return': 1, 'typeof': 1, 'case': 1, 'do': 1, 'else': 1, 'in': 1, 'of': 1, 'new': 1, 'delete': 1, 'void': 1, 'throw': 1, 'instanceof': 1 };
  function scanSource(code) {
    var regions = [];
    var stack = [];
    var bracketIssues = [];
    var n = code.length;
    var i = 0;
    var last = '';           // 直前の意味のある記号か単語（/ が割り算か正規表現かの判断用）
    var mismatch = false;
    var PAIR = { ')': '(', ']': '[', '}': '{' };
    while (i < n) {
      var c = code[i];
      var d = code[i + 1];
      if (c === '/' && d === '/') {
        var e = code.indexOf('\n', i);
        if (e < 0) e = n;
        regions.push({ type: 'comment', start: i, end: e });
        i = e;
        continue;
      }
      if (c === '/' && d === '*') {
        var e2 = code.indexOf('*/', i + 2);
        var closed = e2 >= 0;
        e2 = closed ? e2 + 2 : n;
        regions.push({ type: 'comment', start: i, end: e2, unterminated: !closed });
        i = e2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        var j = i + 1;
        while (j < n && code[j] !== c && (c === '`' || code[j] !== '\n')) {
          if (code[j] === '\\') j++;
          j++;
        }
        var ok = j < n && code[j] === c;
        regions.push({ type: 'string', start: i, end: ok ? j + 1 : j, unterminated: !ok, quote: c });
        i = ok ? j + 1 : j;
        last = 'x';
        continue;
      }
      if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(last) >= 0 || REGEX_AFTER_WORD[last])) {
        var k = i + 1, inClass = false;
        while (k < n && code[k] !== '\n') {
          if (code[k] === '\\') { k += 2; continue; }
          if (code[k] === '[') inClass = true;
          else if (code[k] === ']') inClass = false;
          else if (code[k] === '/' && !inClass) break;
          k++;
        }
        if (k < n && code[k] === '/') {
          k++;
          while (k < n && /[a-z]/i.test(code[k])) k++;
          regions.push({ type: 'regex', start: i, end: k });
          i = k;
          last = 'x';
          continue;
        }
      }
      if (c === '(' || c === '[' || c === '{') {
        stack.push({ ch: c, pos: i });
      } else if (c === ')' || c === ']' || c === '}') {
        if (!mismatch) {
          var top = stack.pop();
          if (!top) {
            bracketIssues.push({ pos: i, kind: 'extra', ch: c });
            mismatch = true;
          } else if (top.ch !== PAIR[c]) {
            bracketIssues.push({ pos: i, kind: 'mismatch', ch: c, open: top });
            mismatch = true;
          }
        }
      }
      if (/\s/.test(c)) { i++; continue; }
      if (/[A-Za-z0-9_$]/.test(c)) {
        var w = i;
        while (w < n && /[A-Za-z0-9_$]/.test(code[w])) w++;
        last = code.slice(i, w);
        i = w;
        continue;
      }
      last = c;
      i++;
    }
    if (!mismatch) {
      stack.forEach(function (s) { bracketIssues.push({ pos: s.pos, kind: 'unclosed', ch: s.ch }); });
    }
    return { regions: regions, bracketIssues: bracketIssues };
  }

  function lineStarts(code) {
    var starts = [0];
    for (var i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
    return starts;
  }
  function posToLoc(starts, pos) {
    var lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, col: pos - starts[lo] + 1 };
  }

  // ---------- 構文エラーの日本語 ----------
  function translateSyntaxError(msg, atEnd) {
    var m = String(msg).replace(/\s*\(\d+:\d+\)\s*$/, '');
    var r;
    if (/^Unexpected token/.test(m)) {
      return atEnd
        ? 'コードが途中で終わっています（閉じ括弧「}」「)」が足りない可能性があります）'
        : 'ここで予期しない記号があります（括弧・引用符・カンマ・セミコロン・演算子の過不足を確かめてください）';
    }
    if (/^Unterminated string constant/.test(m)) return '文字列の引用符が閉じていません（" と \' の対応を確かめてください）';
    if (/^Unterminated comment/.test(m)) return 'コメント（/* … */）が閉じていません';
    if (/^Unterminated template/.test(m)) return 'テンプレート文字列（` … `）が閉じていません';
    if (/^Unterminated regular expression/.test(m)) return '正規表現（/ … /）が閉じていません';
    if ((r = /^Unexpected character '(.+)'/.exec(m))) return '使えない文字「' + r[1] + '」があります（全角の記号や、和文の引用符ではありませんか）';
    if ((r = /^Unexpected keyword '(.+)'/.exec(m))) return 'ここに「' + r[1] + '」は書けません';
    if (/^'return' outside of function/.test(m)) return 'return が関数の外にあります（{ } の対応を確かめてください）';
    if ((r = /^Identifier '(.+)' has already been declared/.exec(m))) return '「' + r[1] + '」が 2 回宣言されています';
    if (/^Assigning to rvalue/.test(m)) return '代入できない場所に「=」があります（比べるときは == か === です）';
    if (/^Invalid regular expression/.test(m)) return '正規表現の書き方が正しくありません';
    if (/^Octal literal in strict mode/.test(m)) return '0 で始まる数字は書けません';
    if (/^Unexpected reserved word/.test(m)) return '予約語はここに書けません';
    return '構文エラー（' + m + '）';
  }

  // ---------- 構文木の読み取り ----------
  function children(node) {
    var out = [];
    for (var k in node) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range') continue;
      var v = node[k];
      if (v && typeof v === 'object') {
        if (Array.isArray(v)) { v.forEach(function (x) { if (x && typeof x.type === 'string') out.push(x); }); }
        else if (typeof v.type === 'string') out.push(v);
      }
    }
    return out;
  }
  function isFunctionNode(n) {
    return n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
  }
  // すべてのノードを訪れる（intoFunctions が false なら、中の関数には入らない）
  function walk(node, fn, intoFunctions, isRoot) {
    if (!node) return;
    fn(node);
    if (!isRoot && !intoFunctions && isFunctionNode(node)) return;
    children(node).forEach(function (c) { walk(c, fn, intoFunctions, false); });
  }

  // break で抜ける可能性（ループ・switch の中の break。ラベル付きは近似）
  function containsBreak(node) {
    var found = false;
    (function visit(n, depth) {
      if (found || !n) return;
      if (isFunctionNode(n)) return;
      if (n.type === 'BreakStatement' && (depth === 0 || n.label)) { found = true; return; }
      var loopOrSwitch = /^(While|DoWhile|For|ForIn|ForOf)Statement$|^SwitchStatement$/.test(n.type);
      children(n).forEach(function (c) { visit(c, loopOrSwitch ? depth + 1 : depth); });
    })(node, 0);
    return found;
  }

  // この文を実行すると、必ず return か throw で抜けるか（最後まで落ちないか）
  function terminates(s) {
    if (!s) return false;
    switch (s.type) {
      case 'ReturnStatement':
      case 'ThrowStatement':
        return true;
      case 'BlockStatement':
        return s.body.some(terminates);
      case 'IfStatement':
        return !!s.alternate && terminates(s.consequent) && terminates(s.alternate);
      case 'TryStatement':
        if (s.finalizer && terminates(s.finalizer)) return true;
        return terminates(s.block) && (!s.handler || terminates(s.handler.body));
      case 'WhileStatement':
      case 'ForStatement':
        var infinite = s.type === 'ForStatement' ? !s.test : (s.test.type === 'Literal' && s.test.value === true);
        return infinite && !containsBreak(s.body);
      case 'DoWhileStatement':
        return terminates(s.body) && !containsBreak(s.body);
      case 'SwitchStatement':
        var hasDefault = s.cases.some(function (c) { return !c.test; });
        if (!hasDefault || !s.cases.length) return false;
        if (s.cases.some(function (c) { return c.consequent.some(function (x) { return containsBreak({ type: 'BlockStatement', body: [x] }) || x.type === 'BreakStatement'; }); })) return false;
        var lastCase = s.cases[s.cases.length - 1];
        return lastCase.consequent.some(terminates);
      case 'LabeledStatement':
        return terminates(s.body);
      default:
        return false;
    }
  }

  function strLit(n) {
    if (!n) return null;
    if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
    if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
    return null;
  }

  // shExpMatch などの第 1 引数が何か（url・host・そのほかの変数名）
  function argRole(n, params) {
    if (!n) return null;
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.arguments.length &&
        n.callee.property && /^to(Lower|Upper)Case$/.test(n.callee.property.name || '')) {
      var r = argRole(n.callee.object, params);
      return r ? r + '.' + n.callee.property.name : null;
    }
    if (n.type !== 'Identifier') return null;
    if (params.url && n.name === params.url) return 'url';
    if (params.host && n.name === params.host) return 'host';
    return n.name;
  }

  function findEntry(ast) {
    var found = [];
    ast.body.forEach(function (s) {
      if (s.type === 'FunctionDeclaration' && s.id && s.id.name === 'FindProxyForURL') found.push(s);
      else if (s.type === 'VariableDeclaration') {
        s.declarations.forEach(function (d) {
          if (d.id.type === 'Identifier' && d.id.name === 'FindProxyForURL' && d.init && isFunctionNode(d.init)) found.push(d.init);
        });
      } else if (s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' &&
          s.expression.left.type === 'Identifier' && s.expression.left.name === 'FindProxyForURL' && isFunctionNode(s.expression.right)) {
        found.push(s.expression.right);
      }
    });
    return found;
  }

  var HELPER_ARGS = {
    isPlainHostName: 1, dnsDomainIs: 2, localHostOrDomainIs: 2, isResolvable: 1, isInNet: 3, dnsResolve: 1,
    convert_addr: 1, myIpAddress: 0, dnsDomainLevels: 1, shExpMatch: 2
  };
  var WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  // if の条件が「shExpMatch(host, "P") || dnsDomainIs(host, ".d") || host == "h"」の形なら、パターンの一覧にする
  function simpleClauses(test, params) {
    if (!test) return null;
    if (test.type === 'LogicalExpression' && test.operator === '||') {
      var l = simpleClauses(test.left, params), r = simpleClauses(test.right, params);
      return l && r ? l.concat(r) : null;
    }
    if (test.type === 'CallExpression' && test.callee.type === 'Identifier' && test.arguments.length === 2) {
      var role = argRole(test.arguments[0], params);
      var p = strLit(test.arguments[1]);
      if (!role || p === null) return null;
      if (test.callee.name === 'shExpMatch') return [{ role: role, pattern: p, node: test }];
      if (test.callee.name === 'dnsDomainIs' && !/[*?]/.test(p)) return [{ role: role, pattern: '*' + p, node: test, shown: 'dnsDomainIs(' + role + ', "' + p + '")' }];
      return null;
    }
    if (test.type === 'BinaryExpression' && (test.operator === '==' || test.operator === '===')) {
      var sides = [[test.left, test.right], [test.right, test.left]];
      for (var i = 0; i < 2; i++) {
        var ro = argRole(sides[i][0], params);
        var lit = strLit(sides[i][1]);
        if (ro && lit !== null && !/[*?]/.test(lit)) return [{ role: ro, pattern: lit, node: test, shown: ro + ' == "' + lit + '"' }];
      }
    }
    return null;
  }

  function singleReturnValue(s) {
    if (!s) return undefined;
    if (s.type === 'ReturnStatement') return strLit(s.argument);
    if (s.type === 'BlockStatement' && s.body.length === 1) return singleReturnValue(s.body[0]);
    return undefined;
  }

  function assignsTo(node, names) {
    var hit = false;
    walk(node, function (n) {
      if (hit) return;
      if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && names.indexOf(n.left.name) >= 0) hit = true;
      if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier' && names.indexOf(n.argument.name) >= 0) hit = true;
    }, false, true);
    return hit;
  }

  // ---------- lint 本体 ----------
  // 返り値: { issues: [{ severity: 'error'|'warning'|'info', line, col, message }], patterns: [{ line, col, role, pattern, notes }], parsed }
  function lint(code, acorn) {
    code = String(code || '');
    var issues = [];
    var patterns = [];
    var starts = lineStarts(code);
    function add(sev, pos, msg, kind) {
      var loc = typeof pos === 'number' ? posToLoc(starts, pos) : (pos || { line: 0, col: 0 });
      issues.push({ severity: sev, line: loc.line, col: loc.col, message: msg, kind: kind || '' });
    }
    function nodeLoc(n) { return { line: n.loc.start.line, col: n.loc.start.column + 1 }; }

    if (!code.trim()) {
      add('error', null, 'PAC が空です', 'empty');
      return finish();
    }

    // 1. 全角文字（コメントの中は問題なし。文字列の中は警告。コードの中はエラー）
    var scan = scanSource(code);
    var regionAt = [];
    scan.regions.forEach(function (r) { regionAt.push(r); });
    var ri = 0;
    var wideCount = 0;
    var wideRe = /[^\x00-\x7F]+/g;
    var mm;
    while ((mm = wideRe.exec(code)) && wideCount < 40) {
      var pos = mm.index;
      while (ri < regionAt.length && regionAt[ri].end <= pos) ri++;
      var reg = ri < regionAt.length && regionAt[ri].start <= pos ? regionAt[ri] : null;
      if (reg && reg.type === 'comment') continue;
      var chunk = mm[0];
      var what = describeWide(chunk);
      wideCount++;
      if (reg && (reg.type === 'string' || reg.type === 'regex')) {
        add('warning', pos, '文字列の中に' + what + 'があります「' + chunk.slice(0, 12) + '」（ホスト名や戻り値に全角文字は使えません）', 'wide-string');
      } else {
        add('error', pos, 'コードの中に' + what + 'があります「' + visible(chunk.slice(0, 12)) + '」（半角に直してください）', 'wide-code');
      }
    }

    // 2. 括弧と引用符の対応
    scan.regions.forEach(function (r) {
      if (r.unterminated && r.type === 'string') add('error', r.start, '引用符 ' + r.quote + ' が閉じていません', 'quote');
      if (r.unterminated && r.type === 'comment') add('error', r.start, 'コメント（/* … */）が閉じていません', 'comment');
    });
    scan.bracketIssues.slice(0, 5).forEach(function (b) {
      if (b.kind === 'extra') add('error', b.pos, '閉じ括弧「' + b.ch + '」に対応する開き括弧がありません', 'bracket');
      else if (b.kind === 'mismatch') {
        var o = posToLoc(starts, b.open.pos);
        add('error', b.pos, '括弧の対応がずれています: ' + o.line + ' 行目の「' + b.open.ch + '」を「' + b.ch + '」で閉じています', 'bracket');
      } else add('error', b.pos, '開き括弧「' + b.ch + '」が閉じていません', 'bracket');
    });

    // 3. 構文（acorn）
    var ast = null;
    try {
      ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script', locations: true, allowReturnOutsideFunction: false });
    } catch (e) {
      var atEnd = typeof e.pos === 'number' && e.pos >= code.replace(/\s+$/, '').length;
      var loc = e.loc ? { line: e.loc.line, col: e.loc.column + 1 } : null;
      add('error', loc, translateSyntaxError(e.message, atEnd), 'syntax');
      return finish();
    }

    // 4. FindProxyForURL
    var entries = findEntry(ast);
    if (!entries.length) {
      add('error', null, 'FindProxyForURL という関数がありません（名前の大文字・小文字も確かめてください）', 'no-entry');
      var near = [];
      walk(ast, function (n) {
        if (n.type === 'FunctionDeclaration' && n.id && /^findproxyforurl$/i.test(n.id.name)) near.push(n);
      }, true, true);
      near.forEach(function (n) { add('error', nodeLoc(n), '「' + n.id.name + '」は名前が違います（正しくは FindProxyForURL）', 'no-entry'); });
    }
    if (entries.length > 1) {
      add('warning', nodeLoc(entries[1]), 'FindProxyForURL が ' + entries.length + ' つあります（最後に書いたものが使われます）', 'dup-entry');
    }
    var fn = entries[entries.length - 1];
    var params = {};
    if (fn) {
      if (fn.params.length !== 2) add('warning', nodeLoc(fn), 'FindProxyForURL の引数は (url, host) の 2 つです（今は ' + fn.params.length + ' つ）', 'params');
      if (fn.params[0] && fn.params[0].type === 'Identifier') params.url = fn.params[0].name;
      if (fn.params[1] && fn.params[1].type === 'Identifier') params.host = fn.params[1].name;
      if (fn.async || fn.generator) add('error', nodeLoc(fn), 'FindProxyForURL を async や function* にはできません', 'params');

      // 5. 最後の return
      var body = fn.body;
      if (body.type === 'BlockStatement' && !terminates(body)) {
        add('warning', { line: body.loc.end.line, col: body.loc.end.column }, '関数の最後まで来たときの return がありません（どの条件にも当てはまらない URL で、戻り値が undefined になります。最後に return "DIRECT"; などを書いてください）', 'no-return');
      }

      // 6. return の値の形
      walk(body, function (n) {
        if (n.type !== 'ReturnStatement') return;
        if (!n.argument) { add('warning', nodeLoc(n), '値の無い return があります（戻り値が undefined になります）', 'return-value'); return; }
        var v = strLit(n.argument);
        if (v !== null) {
          var bad = checkReturnValue(v);
          if (bad) add('warning', nodeLoc(n), '戻り値 "' + v + '": ' + bad, 'return-value');
        }
      }, false, true);
    }

    // 7. ヘルパー関数の呼び方と、shExpMatch のパターン
    walk(ast, function (n) {
      if (n.type === 'FunctionDeclaration' && n.id && n.id.name !== 'FindProxyForURL' && (HELPER_ARGS[n.id.name] !== undefined || /^(weekdayRange|dateRange|timeRange|alert)$/.test(n.id.name))) {
        add('info', nodeLoc(n), '標準のヘルパー関数「' + n.id.name + '」を自分で定義しています（こちらの定義が使われます）', 'override');
      }
      if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier') return;
      var name = n.callee.name;
      var args = n.arguments;
      if (name === 'shExpMatch' && args.length === 2) {
        var pat = strLit(args[1]);
        var role = argRole(args[0], params);
        if (pat === null) return;
        var notes = shExpNotes(role, pat);
        patterns.push({ line: n.loc.start.line, col: n.loc.start.column + 1, role: role || '?', pattern: pat, notes: notes });
        notes.forEach(function (x) { add(x.severity, nodeLoc(n), 'shExpMatch(' + (role || '…') + ', "' + pat + '"): ' + x.message, 'pattern'); });
      }
      if (HELPER_ARGS[name] !== undefined && args.length !== HELPER_ARGS[name] && !(name === 'shExpMatch' && args.length === 2)) {
        add('warning', nodeLoc(n), name + ' の引数は ' + HELPER_ARGS[name] + ' つです（今は ' + args.length + ' つ）', 'args');
      }
      if (name === 'isInNet' && args.length === 3) {
        [1, 2].forEach(function (k) {
          var v = strLit(args[k]);
          if (v !== null && !isIPv4(v)) add('warning', nodeLoc(n), 'isInNet の' + (k === 1 ? '第 2 引数（ネットワーク）' : '第 3 引数（マスク）') + ' "' + v + '" が IPv4 アドレスの形になっていません（例: "255.255.0.0"。"/16" の形は使えません）', 'args');
        });
        var net = strLit(args[1]), mask = strLit(args[2]);
        if (net !== null && mask !== null && isIPv4(mask) && !isContiguousMask(mask)) {
          add('warning', nodeLoc(n), 'isInNet のマスク "' + mask + '" は、1 が左から連続していません（ネットワークとマスクを逆に書いていませんか）', 'args');
        }
      }
      if (name === 'dnsDomainIs' && args.length === 2) {
        var dom = strLit(args[1]);
        if (dom !== null && dom.charAt(0) !== '.' && dom.indexOf('.') > 0) {
          add('info', nodeLoc(n), 'dnsDomainIs(…, "' + dom + '") は、先頭にドットが無いので「bad' + dom + '」のようなホストにも当てはまります（サブドメインだけなら ".' + dom + '"）', 'domain');
        }
        if (dom !== null && /[*?]/.test(dom)) add('warning', nodeLoc(n), 'dnsDomainIs では * や ? は使えません（shExpMatch を使います）', 'domain');
      }
      if (name === 'weekdayRange') {
        args.forEach(function (a) {
          var v = strLit(a);
          if (v !== null && v !== 'GMT' && WEEKDAYS.indexOf(v) < 0) {
            add('warning', nodeLoc(n), 'weekdayRange の "' + v + '" は使えません（"MON" のように大文字の英語 3 文字。小文字は多くのブラウザで false になります）', 'args');
          }
        });
      }
      if (name === 'timeRange' && args.length >= 2) {
        var nums = args.filter(function (a) { return strLit(a) !== 'GMT'; });
        if (nums.length === 2 && nums[0].type === 'Literal' && nums[1].type === 'Literal' && Number(nums[0].value) > Number(nums[1].value)) {
          add('warning', nodeLoc(n), 'timeRange(' + nums[0].value + ', ' + nums[1].value + ') は、多くのブラウザで常に false です（時だけの指定は日をまたげません。timeRange(' + nums[0].value + ', 0, ' + nums[1].value + ', 0) の形なら日をまたげます）', 'args');
        }
      }
    }, true, true);

    // 8. ルールの隠れ（上のパターンが下のパターンを完全に含んでいる）
    if (fn && fn.body.type === 'BlockStatement') shadowCheck(fn.body.body, params, add);

    return finish();

    function finish() {
      var order = { error: 0, warning: 1, info: 2 };
      issues.sort(function (a, b) { return (order[a.severity] - order[b.severity]) || (a.line - b.line) || (a.col - b.col); });
      return { issues: issues, patterns: patterns, parsed: !!ast };
    }
  }

  function visible(s) {
    return s.replace(/\u3000/g, '□').replace(/[\u00A0\u200B-\u200D\u2060\uFEFF]/g, '▯');
  }
  function describeWide(s) {
    if (/\u3000/.test(s)) return '全角スペース';
    if (/[\u200B-\u200D\u2060\uFEFF]/.test(s)) return '目に見えない文字（ゼロ幅スペースなど）';
    if (/\u00A0/.test(s)) return '特殊な空白（ノーブレークスペース）';
    if (/[\u2018\u2019\u201C\u201D\u300C\u300D]/.test(s)) return '和文の引用符';
    if (/[\uFF01-\uFF5E]/.test(s)) return '全角の英数字・記号';
    return '全角文字';
  }
  function isContiguousMask(mask) {
    var b = mask.split('.').map(Number);
    var v = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    var inv = (~v) >>> 0;
    return (inv & (inv + 1)) === 0;
  }

  // shExpMatch のパターンの、明らかな誤り
  function shExpNotes(role, p) {
    var notes = [];
    var baseRole = role ? role.replace(/\.to(Lower|Upper)Case$/, '') : role;
    var isHost = baseRole === 'host';
    var isUrl = baseRole === 'url';
    if (/^\s|\s$/.test(p)) notes.push({ severity: 'warning', message: '前後に空白があります（空白も文字として比べます）' });
    if (/[\u3000\uFF01-\uFF5E]/.test(p)) notes.push({ severity: 'warning', message: '全角文字が入っています' });
    if (/[\[\]+^$|\\(){}]/.test(p)) notes.push({ severity: 'warning', message: 'shExpMatch で使える記号は * と ? だけです（正規表現ではありません）' });
    if (isHost) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.indexOf('://') >= 0) notes.push({ severity: 'warning', message: 'host にはスキーム（http:// など）は含まれません。URL 全体と比べるなら shExpMatch(url, …) にします' });
      else if (p.indexOf('/') >= 0) notes.push({ severity: 'warning', message: 'host にはパス（/ 以降）は含まれません' });
      if (/[A-Z]/.test(p) && role === 'host') notes.push({ severity: 'warning', message: '大文字が入っています（ブラウザが渡すホスト名は小文字なので、当てはまりません）' });
      if (/:\d+\*?$/.test(p) && p.indexOf('://') < 0) notes.push({ severity: 'warning', message: 'host にはポート番号は含まれません' });
      if (!/[*?\/]/.test(p)) {
        if (p.charAt(0) === '.') notes.push({ severity: 'warning', message: '* がありません。「' + p + '」という名前そのものとしか一致しません（サブドメインすべてなら "*' + p + '"）' });
        else notes.push({ severity: 'info', message: '* も ? も無いので、ホスト名が完全に同じときだけ一致します' + (p.split('.').length === 2 ? '（サブドメインも含めるなら "*.' + p + '" も書きます）' : '') });
      }
    }
    if (isUrl) {
      if (!/^[*?]/.test(p) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) notes.push({ severity: 'warning', message: 'url はスキーム（http:// など）から始まります。先頭を "*" か "http://" にしてください' });
      else if (/^[a-z][a-z0-9+.-]*:\/\/[^\/*]+$/i.test(p)) notes.push({ severity: 'warning', message: 'url は最後に「/」やパスが付くので、このパターンとは一致しません（末尾に "/*" を付けてください）' });
      if (/^https:\/\/[^\/]*\/./i.test(p) && !/^https:\/\/[^\/]*\/\*$/i.test(p)) notes.push({ severity: 'info', message: 'Chrome・Edge などは https の URL のパスとクエリを PAC に渡さない（https://ホスト/ だけ）ので、パスを使った判定は効きません' });
    }
    return notes;
  }

  function shadowCheck(stmts, params, add) {
    var active = [];   // これまでの if で「当てはまったら必ず return する」パターン
    var roles = [params.url, params.host].filter(Boolean);
    stmts.forEach(function (s) {
      if (s.type !== 'IfStatement') {
        if (assignsTo(s, roles)) active = [];   // url・host を書き換えたら、ここまでの比較は使わない
        return;
      }
      var chain = [];
      var cur = s;
      while (cur && cur.type === 'IfStatement') {
        chain.push(cur);
        cur = cur.alternate;
      }
      var local = [];    // 同じ if〜else if の中の、上の条件（return しなくても下には来ない）
      chain.forEach(function (st) {
        var clauses = simpleClauses(st.test, params);
        if (!clauses) return;
        var ret = singleReturnValue(st.consequent);
        clauses.forEach(function (c) {
          var pool = local.concat(active);
          for (var i = 0; i < pool.length; i++) {
            var a = pool[i];
            if (a.role !== c.role || a.node === c.node) continue;
            if (globCovers(a.pattern, c.pattern)) {
              var same = ret !== undefined && ret !== null && a.ret === ret;
              var aShown = a.shown || 'shExpMatch(' + a.role + ', "' + a.pattern + '")';
              var cShown = c.shown || 'shExpMatch(' + c.role + ', "' + c.pattern + '")';
              add(same ? 'info' : 'warning', { line: c.node.loc.start.line, col: c.node.loc.start.column + 1 },
                'このルール ' + cShown + ' には到達しません。' + a.node.loc.start.line + ' 行目の ' + aShown + ' が先にすべて当てはまります' +
                (same ? '（戻り値が同じなので結果は変わりません）' : '（順番を入れ替えるか、上のパターンを狭めてください）'), 'shadow');
              break;
            }
          }
        });
        var withRet = clauses.map(function (c) { return { role: c.role, pattern: c.pattern, node: c.node, shown: c.shown, ret: ret }; });
        local = local.concat(withRet);
        if (terminates(st.consequent)) active = active.concat(withRet);
      });
    });
  }

  return {
    SAMPLE_PAC: SAMPLE_PAC,
    SAMPLE_URLS: SAMPLE_URLS,
    SAMPLE_HOSTS: SAMPLE_HOSTS,
    SAMPLE_MY_IP: SAMPLE_MY_IP,
    isIPv4: isIPv4,
    parseUrlList: parseUrlList,
    parseHostTable: parseHostTable,
    checkReturnValue: checkReturnValue,
    normalizeValue: normalizeValue,
    classifyResult: classifyResult,
    resultText: resultText,
    diffResults: diffResults,
    toCsv: toCsv,
    globCovers: globCovers,
    scanSource: scanSource,
    translateSyntaxError: translateSyntaxError,
    terminates: terminates,
    lint: lint
  };
});
