// ===========================
// PAC ファイル テスター — 画面の制御
// 純粋関数は core.js（window.PacCore）、構文の解析は acorn（window.acorn）。
// PAC は、このページでは実行しない。sandbox の iframe（オリジン null）の中の Worker に渡して評価する（sandbox.html）
// 外部には一切通信しない（Content-Security-Policy でも禁止している）
// 画面の文言は messages.js の app（build.mjs が window.PT_MSG として言語ごとに埋め込む）
// 注意: このファイルは pac-tester.html の script 要素にそのまま入るので、「<」のすぐ後ろに script と書かない
// ===========================
(function () {
  'use strict';

  var Core = window.PacCore;
  var acorn = window.acorn;
  var SANDBOX_HTML = window.PT_SANDBOX_HTML;
  var MSG = window.PT_MSG;
  var A = MSG.app;
  var fmt = Core.fmt;

  var EVAL_DELAY = 400;        // 入力が止まってから評価するまで（ミリ秒）
  var TIMEOUT_MS = 200;        // 1 つの URL の評価にかけてよい時間
  var LOAD_TIMEOUT_MS = 1000;  // PAC の読み込み（関数の外のコード）にかけてよい時間
  var WATCHDOG_MS = 3000;      // 枠から返事が無いまま、この時間がたったら枠ごと作り直す
  var MAX_URLS = 2000;

  // --- ブラウザへの保存（キーは必ず "pac-tester_" で始める。読み書きはすべて try/catch） ---
  // 日本語版と英語版で同じキーを使う（中身は言語によらない設定と入力なので、どちらで開いても続きから使える）
  var KEY_PREFIX = 'pac-tester_';
  var store = {
    get: function (name, fallback) {
      try {
        var v = window.localStorage.getItem(KEY_PREFIX + name);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (name, value) {
      try { window.localStorage.setItem(KEY_PREFIX + name, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove: function (name) {
      try { window.localStorage.removeItem(KEY_PREFIX + name); } catch (e) { /* 何もしない */ }
    }
  };

  function $(id) { return document.getElementById(id); }
  var el = {
    run: $('pt-run'), diff: $('pt-diff'), sample: $('pt-sample'), about: $('pt-about'),
    pacA: $('pt-pac-a'), pacB: $('pt-pac-b'), pacALabel: $('pt-pac-a-label'), pacBWrap: $('pt-pac-b-wrap'),
    fileA: $('pt-file-a'), fileB: $('pt-file-b'), fileInput: $('pt-file-input'), copyAB: $('pt-copy-ab'),
    saveDraft: $('pt-save-draft'),
    lint: $('pt-lint'), lintSummary: $('pt-lint-summary'), patterns: $('pt-patterns'), patternsCount: $('pt-patterns-count'),
    urls: $('pt-urls'), urlsOpen: $('pt-urls-open'), urlsSave: $('pt-urls-save'), urlsInput: $('pt-urls-input'),
    settings: $('pt-settings'), settingsSummary: $('pt-settings-summary'),
    hosts: $('pt-hosts'), hostsErrors: $('pt-hosts-errors'), myIp: $('pt-myip'),
    useNow: $('pt-use-now'), datetime: $('pt-datetime'), tz: $('pt-tz'), stripHttps: $('pt-strip-https'),
    summary: $('pt-summary'), legend: $('pt-legend'), filter: $('pt-filter'),
    onlyChanged: $('pt-only-changed'), onlyChangedWrap: $('pt-only-changed-wrap'), onlyProblems: $('pt-only-problems'),
    csv: $('pt-csv'), thead: $('pt-thead'), tbody: $('pt-tbody'), whenUsed: $('pt-when-used'),
    status: $('pt-status'), drop: $('pt-drop'),
    toast: $('pt-toast'), toastText: $('pt-toast-text'), toastAction: $('pt-toast-action'),
    aboutDialog: $('pt-about-dialog'), licenseText: $('pt-license-text')
  };

  var state = {
    diff: false,
    urls: [],           // parseUrlList の結果（エラーの行も含む）
    evalUrls: [],       // 評価する URL（エラーの行を除く）
    results: { a: [], b: [] },
    loadError: { a: null, b: null },
    job: null,          // { id, keys, done: {a, b}, started }
    jobSeq: 0,
    usedWhen: '',
    valueFilter: null,  // 凡例で選んだ戻り値
    fileName: { a: '', b: '' }
  };

  // ---------- お知らせ ----------
  var toastTimer = null;
  function toast(text, actionLabel, action) {
    el.toastText.textContent = text;
    if (actionLabel) {
      el.toastAction.textContent = actionLabel;
      el.toastAction.hidden = false;
      el.toastAction.onclick = function () { hideToast(); action(); };
    } else {
      el.toastAction.hidden = true;
      el.toastAction.onclick = null;
    }
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 3500);
  }
  function hideToast() { el.toast.hidden = true; }
  function setStatus(text, warn) {
    el.status.textContent = text;
    el.status.className = warn ? 'is-warn' : '';
  }

  // ---------- 設定 ----------
  function tzLabel(min) {
    var sign = min < 0 ? '−' : '+';
    var a = Math.abs(min);
    return 'UTC' + sign + Math.floor(a / 60) + ':' + ('0' + (a % 60)).slice(-2);
  }
  function fillTz() {
    var list = [];
    for (var m = -12 * 60; m <= 14 * 60; m += 30) list.push(m);
    [345, 525, 765, 825].forEach(function (x) { list.push(x); });   // +5:45・+8:45・+12:45・+13:45
    list.sort(function (a, b) { return a - b; });
    list.forEach(function (m) {
      var o = document.createElement('option');
      o.value = String(m);
      o.textContent = tzLabel(m) + (m === 540 ? A.tzJapan : '');
      el.tz.appendChild(o);
    });
  }
  function pad(n) { return ('0' + n).slice(-2); }
  function wallString(ms, tz) {
    var d = new Date(ms + tz * 60000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  }
  function describeWhen(ms, tz) {
    var d = new Date(ms + tz * 60000);
    return fmt(A.whenFormat, {
      y: d.getUTCFullYear(), mon: A.months[d.getUTCMonth()], d: d.getUTCDate(), wd: A.weekdays[d.getUTCDay()],
      time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()), tz: tzLabel(tz)
    });
  }

  function readSettings() {
    var tz = Number(el.tz.value);
    var nowMs;
    if (el.useNow.checked || !el.datetime.value) nowMs = Date.now();
    else {
      var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(el.datetime.value);
      nowMs = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - tz * 60000 : Date.now();
    }
    var table = Core.parseHostTable(el.hosts.value);
    return {
      hosts: table.hosts, hostErrors: table.errors,
      myIp: el.myIp.value.trim(), tz: tz, nowMs: nowMs,
      stripHttps: el.stripHttps.checked
    };
  }

  function saveSettings() {
    store.set('settings', {
      hosts: el.hosts.value,
      myIp: el.myIp.value,
      useNow: el.useNow.checked,
      datetime: el.datetime.value,
      tz: Number(el.tz.value),
      stripHttps: el.stripHttps.checked,
      saveDraft: el.saveDraft.checked
    });
  }

  function saveDraft() {
    if (!el.saveDraft.checked) return;
    var ok = store.set('draft', { pacA: el.pacA.value, pacB: el.pacB.value, urls: el.urls.value, diff: state.diff, fileA: state.fileName.a, fileB: state.fileName.b });
    if (!ok) setStatus(A.saveFailed, true);
  }

  function updateSettingsSummary(s) {
    var n = Object.keys(s.hosts).length;
    el.settingsSummary.textContent = fmt(A.settingsSummary, {
      n: n, ip: s.myIp || A.notSet, when: el.useNow.checked ? A.nowLabel : describeWhen(s.nowMs, s.tz)
    });
    el.hostsErrors.textContent = s.hostErrors.slice(0, 5).map(function (e) { return fmt(A.hostErrLine, { line: e.line, msg: e.message }); }).join(A.sep);
    el.datetime.disabled = el.useNow.checked;
  }

  // ---------- 隔離用の枠（iframe sandbox） ----------
  var sandbox = { frame: null, ready: false, queue: null, lastHeard: 0 };

  function createSandbox() {
    if (sandbox.frame) sandbox.frame.remove();
    var f = document.createElement('iframe');
    // allow-same-origin を付けないので、枠のオリジンは null（このページの保存領域には届かない）
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('title', A.iframeTitle);
    f.setAttribute('aria-hidden', 'true');
    f.setAttribute('tabindex', '-1');
    f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    f.srcdoc = SANDBOX_HTML;
    sandbox.frame = f;
    sandbox.ready = false;
    document.body.appendChild(f);
  }

  function postToSandbox(msg) {
    if (sandbox.ready && sandbox.frame && sandbox.frame.contentWindow) {
      sandbox.frame.contentWindow.postMessage(msg, '*');
    } else {
      sandbox.queue = msg;       // 準備ができたら送る（最後の 1 件だけ）
    }
  }

  window.addEventListener('message', function (e) {
    if (!sandbox.frame || e.source !== sandbox.frame.contentWindow) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    sandbox.lastHeard = Date.now();
    if (d.type === 'hello') {
      sandbox.ready = true;
      if (sandbox.queue) { var q = sandbox.queue; sandbox.queue = null; postToSandbox(q); }
      return;
    }
    var job = state.job;
    if (!job || d.jobId !== job.id) return;
    if (d.type === 'result') {
      var list = state.results[d.key];
      if (!list || typeof d.index !== 'number' || d.index < 0 || d.index >= state.evalUrls.length) return;
      list[d.index] = {
        ok: !!d.ok, timeout: !!d.timeout,
        value: typeof d.value === 'string' ? d.value : '',
        valueType: typeof d.valueType === 'string' ? d.valueType : '',
        error: typeof d.error === 'string' ? d.error : '',
        alerts: Array.isArray(d.alerts) ? d.alerts.map(String) : [],
        ms: typeof d.ms === 'number' ? d.ms : 0
      };
      scheduleRender();
    } else if (d.type === 'load-error') {
      state.loadError[d.key] = String(d.message || '');
      var from = typeof d.fromIndex === 'number' ? d.fromIndex : 0;
      var arr = state.results[d.key];
      if (arr) for (var i = from; i < state.evalUrls.length; i++) arr[i] = { ok: false, error: A.loadErrorRow, alerts: [] };
      scheduleRender();
    } else if (d.type === 'done') {
      job.finished = true;
      state.job = null;
      finishStatus(job);
      scheduleRender();
    }
  });

  // 枠が応答しなくなったら、枠ごと作り直す（ページ本体は止まらない）
  setInterval(function () {
    var job = state.job;
    if (!job || !sandbox.ready) return;
    if (Date.now() - Math.max(sandbox.lastHeard, job.started) > WATCHDOG_MS) {
      ['a', 'b'].forEach(function (k) {
        var arr = state.results[k];
        for (var i = 0; i < state.evalUrls.length; i++) {
          if (job.keys.indexOf(k) >= 0 && !arr[i]) arr[i] = { ok: false, error: A.watchdogRow, alerts: [] };
        }
      });
      state.job = null;
      createSandbox();
      setStatus(A.watchdogStatus, true);
      scheduleRender();
    }
  }, 500);

  // ---------- 評価 ----------
  var evalTimer = null;
  function scheduleEval() {
    clearTimeout(evalTimer);
    evalTimer = setTimeout(runAll, EVAL_DELAY);
  }

  function runAll() {
    clearTimeout(evalTimer);
    var s = readSettings();
    updateSettingsSummary(s);
    renderLint();
    state.urls = Core.parseUrlList(el.urls.value, { stripHttpsPath: s.stripHttps });
    state.evalUrls = state.urls.filter(function (u) { return !u.error; }).slice(0, MAX_URLS);
    var keys = state.diff ? ['a', 'b'] : ['a'];
    state.results = { a: [], b: [] };
    state.loadError = { a: null, b: null };
    state.usedWhen = describeWhen(s.nowMs, s.tz);
    var job = { id: ++state.jobSeq, keys: keys, started: Date.now(), t0: performance.now() };
    state.job = job;
    if (!state.evalUrls.length) {
      state.job = null;
      postToSandbox({ type: 'cancel' });
      render();
      return;
    }
    postToSandbox({
      type: 'run', jobId: job.id, timeoutMs: TIMEOUT_MS, loadTimeoutMs: LOAD_TIMEOUT_MS,
      pacs: keys.map(function (k) { return { key: k, code: (k === 'a' ? el.pacA : el.pacB).value }; }),
      urls: state.evalUrls.map(function (u) { return { url: u.pacUrl, host: u.host }; }),
      cfg: { hosts: s.hosts, myIp: s.myIp, nowMs: s.nowMs, tzOffsetMin: s.tz, msg: MSG.worker },
      msg: MSG.sandbox
    });
    setStatus(A.evaluating);
    render();
  }

  function finishStatus(job) {
    var n = state.evalUrls.length;
    var sec = ((performance.now() - job.t0) / 1000).toFixed(2);
    var timeouts = 0;
    job.keys.forEach(function (k) { state.results[k].forEach(function (r) { if (r && r.timeout) timeouts++; }); });
    setStatus(fmt(A.finished, {
      n: n, x2: job.keys.length > 1 ? A.finishedX2 : '', sec: sec, to: timeouts ? fmt(A.finishedTimeouts, { n: timeouts }) : ''
    }), timeouts > 0);
  }

  // ---------- lint の表示 ----------
  var SEV = { error: A.sevError, warning: A.sevWarning, info: A.sevInfo };
  var lintCache = { a: { code: null, res: null }, b: { code: null, res: null } };
  function lintOf(key) {
    var code = (key === 'a' ? el.pacA : el.pacB).value;
    var c = lintCache[key];
    if (c.code !== code) { c.code = code; c.res = Core.lint(code, acorn); }
    return c.res;
  }

  function renderLint() {
    var keys = state.diff ? ['a', 'b'] : ['a'];
    el.lint.textContent = '';
    var totals = { error: 0, warning: 0, info: 0 };
    var allPatterns = [];
    keys.forEach(function (key) {
      var res = lintOf(key);
      var group = document.createElement('div');
      group.className = 'pt-lint-group';
      if (state.diff) {
        var h = document.createElement('h3');
        h.textContent = key === 'a' ? A.oldPac : A.newPac;
        group.appendChild(h);
      }
      if (!res.issues.length) {
        var ok = document.createElement('p');
        ok.className = 'pt-ok';
        ok.textContent = A.noProblems;
        group.appendChild(ok);
      } else {
        var ul = document.createElement('ul');
        ul.className = 'pt-issues';
        res.issues.slice(0, 80).forEach(function (it) {
          totals[it.severity]++;
          var li = document.createElement('li');
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'pt-issue';
          b.title = it.line ? fmt(A.goToLine, { line: it.line }) : '';
          var sev = document.createElement('span');
          sev.className = 'pt-sev pt-sev-' + it.severity;
          sev.textContent = SEV[it.severity];
          var loc = document.createElement('span');
          loc.className = 'pt-loc';
          loc.textContent = it.line ? fmt(A.lineN, { line: it.line }) : '';
          var msg = document.createElement('span');
          msg.className = 'pt-msg';
          msg.textContent = it.message;
          b.appendChild(sev); b.appendChild(loc); b.appendChild(msg);
          b.addEventListener('click', function () { goToLine(key === 'a' ? el.pacA : el.pacB, it.line, it.col); });
          li.appendChild(b);
          ul.appendChild(li);
        });
        group.appendChild(ul);
      }
      el.lint.appendChild(group);
      res.patterns.forEach(function (p) { allPatterns.push({ key: key, p: p }); });
    });
    var parts = [];
    if (totals.error) parts.push(fmt(A.lintErrors, { n: totals.error }));
    if (totals.warning) parts.push(fmt(A.lintWarnings, { n: totals.warning }));
    if (totals.info) parts.push(fmt(A.lintInfos, { n: totals.info }));
    el.lintSummary.textContent = parts.length ? parts.join(A.lintJoin) + A.lintSuffix : A.noIssues;
    renderPatterns(allPatterns);
  }

  function renderPatterns(list) {
    el.patternsCount.textContent = fmt(A.patternsCount, { n: list.length });
    el.patterns.textContent = '';
    if (!list.length) {
      var p = document.createElement('p');
      p.className = 'pt-hint';
      p.textContent = A.noPatterns;
      el.patterns.appendChild(p);
      return;
    }
    var t = document.createElement('table');
    t.className = 'pt-pattern-table';
    var headRow = document.createElement('tr');
    (state.diff ? ['PAC'] : []).concat([A.thLine, A.thRole, A.thPattern, A.thNotes]).forEach(function (text) {
      var th = document.createElement('th');
      th.textContent = text;
      headRow.appendChild(th);
    });
    var thead = document.createElement('thead');
    thead.appendChild(headRow);
    t.appendChild(thead);
    var tb = document.createElement('tbody');
    list.forEach(function (x) {
      var tr = document.createElement('tr');
      var cells = [];
      if (state.diff) cells.push(x.key === 'a' ? A.oldShort : A.newShort);
      cells.push(String(x.p.line), x.p.role, null, x.p.notes.map(function (n) { return n.message; }).join(A.sep) || '—');
      cells.forEach(function (c, i) {
        var td = document.createElement('td');
        if (c === null) {
          var code = document.createElement('code');
          code.textContent = '"' + x.p.pattern + '"';
          td.appendChild(code);
        } else td.textContent = c;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    el.patterns.appendChild(t);
  }

  function goToLine(ta, line, col) {
    if (!line) { ta.focus(); return; }
    var lines = ta.value.split('\n');
    var pos = 0;
    for (var i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    var end = pos + (lines[line - 1] || '').length;
    ta.focus();
    ta.setSelectionRange(pos, end);
    // 選んだ行が見えるようにスクロールする
    var lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (line - 4) * lh);
    ta.scrollIntoView({ block: 'nearest' });
  }

  // ---------- 結果の表 ----------
  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; render(); });
  }

  // 戻り値ごとの色（DIRECT は緑、ほかは出てきた順に 6 色）
  function colorClasses() {
    var map = Object.create(null);
    var n = 0;
    ['a', 'b'].forEach(function (k) {
      state.results[k].forEach(function (r) {
        if (!r) return;
        var kind = Core.classifyResult(r);
        var text = Core.resultText(r);
        if (text in map) return;
        if (kind === 'direct') map[text] = 'k-direct';
        else if (kind === 'error' || kind === 'timeout' || kind === 'invalid') map[text] = 'k-' + kind;
        else map[text] = 'k-c' + (n++ % 6);
      });
    });
    return map;
  }

  function valueCell(r, colors) {
    var frag = document.createDocumentFragment();
    var span = document.createElement('span');
    if (!r) {
      span.className = 'pt-val k-pending';
      span.textContent = state.job ? A.pending : '—';
      frag.appendChild(span);
      return frag;
    }
    var text = Core.resultText(r);
    span.className = 'pt-val ' + (colors[text] || '');
    if (!r.ok) {
      span.textContent = r.timeout ? A.timeout : A.error;
      frag.appendChild(span);
      var note = document.createElement('span');
      note.className = 'pt-note is-err';
      note.textContent = r.error;
      frag.appendChild(note);
    } else {
      span.textContent = r.valueType === 'string' ? (r.value === '' ? A.emptyString : Core.normalizeValue(r.value))
        : r.valueType === 'undefined' ? A.undefinedValue : fmt(A.typedValue, { v: r.value, type: r.valueType });
      frag.appendChild(span);
      var bad = r.valueType === 'string' ? Core.checkReturnValue(r.value) : A.notStringValue;
      if (bad) {
        var n2 = document.createElement('span');
        n2.className = 'pt-note is-warn';
        n2.textContent = '⚠ ' + bad;
        frag.appendChild(n2);
      }
    }
    (r.alerts || []).forEach(function (a) {
      var al = document.createElement('span');
      al.className = 'pt-alert';
      al.textContent = 'alert: ' + a;
      frag.appendChild(al);
    });
    return frag;
  }

  function isProblem(r) {
    if (!r) return false;
    var k = Core.classifyResult(r);
    return k === 'error' || k === 'timeout' || k === 'invalid';
  }

  function render() {
    var diff = state.diff;
    var colors = colorClasses();
    var urls = state.evalUrls;
    var ra = state.results.a, rb = state.results.b;
    var d = diff ? Core.diffResults(urls, ra, rb) : null;
    var q = el.filter.value.trim().toLowerCase();
    var onlyChanged = diff && el.onlyChanged.checked;
    var onlyProblems = el.onlyProblems.checked;

    // 見出し
    el.thead.textContent = '';
    var headRow = document.createElement('tr');
    ['#', A.thUrl].concat(diff ? [A.oldPac, A.newPac] : [A.thResult]).forEach(function (text) {
      var th = document.createElement('th');
      th.textContent = text;
      headRow.appendChild(th);
    });
    el.thead.appendChild(headRow);

    // 凡例（戻り値ごとの件数。押すと絞り込み）
    var counts = Object.create(null);
    var order = [];
    var keyForLegend = diff ? 'b' : 'a';
    state.results[keyForLegend].forEach(function (r) {
      if (!r) return;
      var t = Core.resultText(r);
      var label = r.ok ? t : (r.timeout ? A.timeout : A.error);
      if (!(label in counts)) { counts[label] = { n: 0, text: t }; order.push(label); }
      counts[label].n++;
    });
    if (state.valueFilter && !(state.valueFilter in counts)) state.valueFilter = null;
    el.legend.textContent = '';
    order.forEach(function (label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = colors[counts[label].text] || '';
      b.textContent = label + '  ' + counts[label].n;
      b.title = fmt(diff ? A.legendTitleDiff : A.legendTitle, { label: label });
      b.setAttribute('aria-pressed', state.valueFilter === label ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.valueFilter = state.valueFilter === label ? null : label;
        render();
      });
      el.legend.appendChild(b);
    });

    // 行
    var frag = document.createDocumentFragment();
    var shown = 0;
    urls.forEach(function (u, i) {
      var a = ra[i], b = rb[i];
      var changed = d ? d.rows[i].changed && !!a && !!b : false;
      if (onlyChanged && !changed) return;
      if (onlyProblems && !isProblem(a) && !isProblem(b)) return;
      if (state.valueFilter) {
        var r = diff ? b : a;
        if (!r) return;
        var label = r.ok ? Core.resultText(r) : (r.timeout ? A.timeout : A.error);
        if (label !== state.valueFilter) return;
      }
      if (q) {
        var hay = (u.url + ' ' + u.host + ' ' + Core.resultText(a) + ' ' + Core.resultText(b)).toLowerCase();
        if (hay.indexOf(q) < 0) return;
      }
      shown++;
      var tr = document.createElement('tr');
      if (changed) tr.className = 'is-changed';
      var tdN = document.createElement('td');
      tdN.className = 'pt-num';
      tdN.textContent = String(i + 1);
      tr.appendChild(tdN);
      var tdU = document.createElement('td');
      tdU.className = 'pt-url';
      tdU.appendChild(document.createTextNode(u.url));
      if (changed) {
        var badge = document.createElement('span');
        badge.className = 'pt-badge';
        badge.textContent = A.changed;
        tdU.appendChild(badge);
      }
      var small = document.createElement('small');
      small.textContent = 'host: ' + u.host + (u.pacUrl !== u.url ? fmt(A.pacUrlPart, { url: u.pacUrl }) : '');
      tdU.appendChild(small);
      tr.appendChild(tdU);
      var tdA = document.createElement('td');
      tdA.className = 'pt-res';
      tdA.appendChild(valueCell(a, colors));
      tr.appendChild(tdA);
      if (diff) {
        var tdB = document.createElement('td');
        tdB.className = 'pt-res';
        tdB.appendChild(valueCell(b, colors));
        tr.appendChild(tdB);
      }
      frag.appendChild(tr);
    });
    el.tbody.textContent = '';
    if (!shown) {
      var tr0 = document.createElement('tr');
      var td0 = document.createElement('td');
      td0.colSpan = diff ? 4 : 3;
      td0.className = 'pt-empty';
      td0.textContent = urls.length ? A.noMatchRows : A.noUrls;
      tr0.appendChild(td0);
      el.tbody.appendChild(tr0);
    } else el.tbody.appendChild(frag);

    // まとめ
    var badLines = state.urls.filter(function (u) { return u.error; });
    var parts = [];
    var doneA = ra.filter(Boolean).length;
    parts.push(fmt(A.sumUrls, { n: urls.length }));
    if (state.job) parts.push(fmt(A.sumEvaluating, { done: Math.min(doneA, urls.length), n: urls.length }));
    if (diff && d) {
      var complete = !state.job;
      var changedCount = d.rows.filter(function (row) { return row.changed && row.a && row.b; }).length;
      parts.push(fmt(A.sumChanged, { soFar: complete ? '' : A.sumSoFar, n: changedCount }));
    }
    var problems = 0;
    urls.forEach(function (u, i) { if (isProblem(ra[i]) || (diff && isProblem(rb[i]))) problems++; });
    if (problems) parts.push(fmt(A.sumProblems, { n: problems }));
    if (badLines.length) {
      parts.push(fmt(A.sumBadLines, {
        n: badLines.length, lines: badLines.slice(0, 3).map(function (u) { return fmt(A.lineN, { line: u.line }); }).join(A.sumJoin)
      }));
    }
    if (state.urls.filter(function (u) { return !u.error; }).length > MAX_URLS) parts.push(fmt(A.sumMax, { n: MAX_URLS }));
    if (shown !== urls.length && urls.length) parts.push(fmt(A.sumShown, { n: shown }));
    el.summary.textContent = parts.join(A.sumJoin);
    var le = [];
    if (state.loadError.a) le.push((diff ? A.loadErrOld : '') + state.loadError.a);
    if (state.loadError.b) le.push(A.loadErrNew + state.loadError.b);
    el.whenUsed.textContent = (le.length ? le.join(A.sep) + A.sep : '') + (state.usedWhen ? fmt(A.usedWhen, { when: state.usedWhen }) : '');
  }

  // ---------- 差分モード ----------
  function setDiff(on) {
    state.diff = on;
    document.body.classList.toggle('pt-diff-mode', on);
    el.diff.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.pacBWrap.hidden = !on;
    el.onlyChangedWrap.hidden = !on;
    el.pacALabel.textContent = on ? A.oldPacLabel : A.pacLabel;
    if (on && !el.pacB.value.trim()) {
      el.pacB.value = el.pacA.value;
      toast(A.copiedToNew);
    }
  }

  // ---------- ファイル ----------
  function decodeText(buf) {
    // ほとんどは UTF-8。Windows のメモ帳などで作った Shift_JIS のファイルも読めるようにする
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''); } catch (e) { /* 次へ */ }
    try { return new TextDecoder('shift_jis').decode(buf); } catch (e) { /* 次へ */ }
    return new TextDecoder('utf-8').decode(buf);
  }
  function readFile(file, done) {
    if (file.size > 5 * 1024 * 1024) { toast(A.fileTooBig); return; }
    var r = new FileReader();
    r.onload = function () { done(decodeText(new Uint8Array(r.result))); };
    r.onerror = function () { toast(A.fileReadError); };
    r.readAsArrayBuffer(file);
  }
  function openPac(key, file) {
    readFile(file, function (text) {
      if (key === 'b' && !state.diff) setDiff(true);
      (key === 'a' ? el.pacA : el.pacB).value = text.replace(/\r\n?/g, '\n');
      state.fileName[key] = file.name;
      (key === 'a' ? el.fileA : el.fileB).textContent = file.name;
      saveDraft();
      runAll();
      toast(fmt(A.opened, { name: file.name }));
    });
  }
  function openUrls(file) {
    readFile(file, function (text) {
      el.urls.value = text.replace(/\r\n?/g, '\n');
      saveDraft();
      runAll();
      toast(fmt(A.loaded, { name: file.name }));
    });
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function exportCsv() {
    var urls = state.evalUrls;
    if (!urls.length) { toast(A.noResults); return; }
    var rows = [];
    var header;
    if (state.diff) {
      var d = Core.diffResults(urls, state.results.a, state.results.b);
      header = A.csvHeaderDiff;
      urls.forEach(function (u, i) {
        var a = state.results.a[i], b = state.results.b[i];
        rows.push([i + 1, u.url, u.pacUrl, u.host, Core.resultText(a), Core.resultText(b), d.rows[i].changed ? A.changed : '',
          ((a && a.alerts) || []).join(' / '), ((b && b.alerts) || []).join(' / ')]);
      });
    } else {
      header = A.csvHeader;
      urls.forEach(function (u, i) {
        var r = state.results.a[i];
        var note = r && r.ok ? (r.valueType === 'string' ? Core.checkReturnValue(r.value) : A.csvNotString) : '';
        rows.push([i + 1, u.url, u.pacUrl, u.host, Core.resultText(r), note || '', ((r && r.alerts) || []).join(' / '), r ? r.ms : '']);
      });
    }
    download(state.diff ? 'pac-diff.csv' : 'pac-results.csv', '\uFEFF' + Core.toCsv(header, rows), 'text/csv;charset=utf-8');
  }

  // ---------- 見本 ----------
  function loadSample(withUndo) {
    var prev = { a: el.pacA.value, b: el.pacB.value, urls: el.urls.value, hosts: el.hosts.value, myIp: el.myIp.value, diff: state.diff };
    el.pacA.value = Core.SAMPLE_PAC;
    el.pacB.value = '';
    el.urls.value = Core.SAMPLE_URLS;
    el.hosts.value = Core.SAMPLE_HOSTS;
    el.myIp.value = Core.SAMPLE_MY_IP;
    state.fileName = { a: '', b: '' };
    el.fileA.textContent = A.sampleName;
    el.fileB.textContent = '';
    setDiff(false);
    saveSettings();
    saveDraft();
    runAll();
    if (withUndo) {
      toast(A.replacedWithSample, A.undo, function () {
        el.pacA.value = prev.a; el.pacB.value = prev.b; el.urls.value = prev.urls; el.hosts.value = prev.hosts; el.myIp.value = prev.myIp;
        el.fileA.textContent = '';
        setDiff(prev.diff);
        saveSettings();
        saveDraft();
        runAll();
      });
    }
  }

  // ---------- 起動 ----------
  function init() {
    fillTz();
    var saved = store.get('settings', null);
    var defaultTz = -new Date().getTimezoneOffset();
    if (saved && typeof saved === 'object') {
      el.hosts.value = typeof saved.hosts === 'string' ? saved.hosts : Core.SAMPLE_HOSTS;
      el.myIp.value = typeof saved.myIp === 'string' ? saved.myIp : Core.SAMPLE_MY_IP;
      el.useNow.checked = saved.useNow !== false;
      el.datetime.value = typeof saved.datetime === 'string' ? saved.datetime : '';
      el.tz.value = String(typeof saved.tz === 'number' ? saved.tz : defaultTz);
      el.stripHttps.checked = saved.stripHttps !== false;
      el.saveDraft.checked = saved.saveDraft === true;
    } else {
      el.hosts.value = Core.SAMPLE_HOSTS;
      el.myIp.value = Core.SAMPLE_MY_IP;
      el.useNow.checked = true;
      el.tz.value = String(defaultTz);
      el.stripHttps.checked = true;
      el.saveDraft.checked = false;
    }
    if (!el.tz.value) el.tz.value = '0';
    if (!el.datetime.value) el.datetime.value = wallString(Date.now(), Number(el.tz.value));

    var draft = el.saveDraft.checked ? store.get('draft', null) : null;
    if (draft && typeof draft === 'object' && typeof draft.pacA === 'string') {
      el.pacA.value = draft.pacA;
      el.pacB.value = typeof draft.pacB === 'string' ? draft.pacB : '';
      el.urls.value = typeof draft.urls === 'string' ? draft.urls : Core.SAMPLE_URLS;
      state.fileName = { a: draft.fileA || '', b: draft.fileB || '' };
      el.fileA.textContent = state.fileName.a;
      el.fileB.textContent = state.fileName.b;
      setDiff(draft.diff === true);
      setStatus(A.openedSaved);
    } else {
      el.pacA.value = Core.SAMPLE_PAC;
      el.urls.value = Core.SAMPLE_URLS;
      el.fileA.textContent = A.sampleName;
      setStatus(A.showingSample);
    }

    try { el.licenseText.textContent = $('licenses').textContent.trim(); } catch (e) { /* 何もしない */ }

    createSandbox();
    runAll();

    // 入力したら評価し直す
    [el.pacA, el.pacB, el.urls].forEach(function (t) {
      t.addEventListener('input', function () {
        var label = t === el.pacA ? el.fileA : t === el.pacB ? el.fileB : null;
        if (label && label.textContent && label.textContent.slice(-A.editing.length) !== A.editing) label.textContent += A.editing;
        saveDraft();
        scheduleEval();
      });
    });
    [el.hosts, el.myIp, el.datetime].forEach(function (t) {
      t.addEventListener('input', function () { saveSettings(); scheduleEval(); });
    });
    [el.useNow, el.tz, el.stripHttps].forEach(function (t) {
      t.addEventListener('change', function () { saveSettings(); runAll(); });
    });
    el.saveDraft.addEventListener('change', function () {
      saveSettings();
      if (el.saveDraft.checked) { saveDraft(); toast(A.draftOn); }
      else { store.remove('draft'); toast(A.draftOff); }
    });

    el.run.addEventListener('click', runAll);
    el.diff.addEventListener('click', function () { setDiff(!state.diff); saveDraft(); runAll(); });
    el.copyAB.addEventListener('click', function () { el.pacB.value = el.pacA.value; saveDraft(); runAll(); });
    el.sample.addEventListener('click', function () { loadSample(true); });
    el.about.addEventListener('click', function () { el.aboutDialog.showModal(); });
    el.csv.addEventListener('click', exportCsv);
    [el.filter].forEach(function (t) { t.addEventListener('input', scheduleRender); });
    [el.onlyChanged, el.onlyProblems].forEach(function (t) { t.addEventListener('change', scheduleRender); });

    // ファイルを開く
    var openKey = 'a';
    document.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { openKey = b.getAttribute('data-open'); el.fileInput.value = ''; el.fileInput.click(); });
    });
    el.fileInput.addEventListener('change', function () { if (el.fileInput.files[0]) openPac(openKey, el.fileInput.files[0]); });
    el.urlsOpen.addEventListener('click', function () { el.urlsInput.value = ''; el.urlsInput.click(); });
    el.urlsInput.addEventListener('change', function () { if (el.urlsInput.files[0]) openUrls(el.urlsInput.files[0]); });
    el.urlsSave.addEventListener('click', function () {
      download('pac-test-urls.txt', el.urls.value.replace(/\n/g, '\r\n'), 'text/plain;charset=utf-8');
    });

    // ドラッグ＆ドロップ（URL の欄に落とすと URL 一覧、新 PAC の欄なら新 PAC、ほかは PAC）
    var dragDepth = 0;
    document.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      el.drop.hidden = false;
    });
    document.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) el.drop.hidden = true;
    });
    document.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      el.drop.hidden = true;
      var f = e.dataTransfer.files[0];
      if (!f) return;
      var t = e.target;
      if (t && t.closest && t.closest('#pt-urls')) openUrls(f);
      else if (t && t.closest && t.closest('#pt-pac-b-wrap')) openPac('b', f);
      else openPac('a', f);
    });
    function hasFiles(e) {
      return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
    }

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runAll(); }
    });
  }

  init();
})();
