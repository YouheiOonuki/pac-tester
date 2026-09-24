// ===========================
// __TITLE__ — 画面の制御
// 計算は calc.js（純粋関数）、時点のある値は constants.js に置く
// ===========================
(function () {
  'use strict';

  // --- ブラウザへの保存（README「ツールを追加するとき」12） ---
  // キーは必ず "__REPO___" で始める。全ツールが同じオリジンで localStorage を共有しているため
  var KEY_PREFIX = '__REPO___';
  var store = {
    get: function (name, fallback) {
      try {
        var v = localStorage.getItem(KEY_PREFIX + name);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }   // 保存できない環境（プライベートモードなど）でも動くように
    },
    set: function (name, value) {
      try { localStorage.setItem(KEY_PREFIX + name, JSON.stringify(value)); } catch (e) { /* 保存できなくても続ける */ }
    },
  };

  // --- 共有 URL（README「ツールを追加するとき」11） ---
  // 入力内容は "#" 以降に入れる（? クエリはサーバーとアクセス解析に届くので使わない）
  function toShareHash(state) {
    return '#s=' + encodeURIComponent(JSON.stringify(state));
  }
  function fromShareHash(hash) {
    var m = /^#s=(.+)$/.exec(hash || '');
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
  }

  // --- ここから下をツールに合わせて書き換える（例: 金額を 100 円単位で切り上げる） ---
  var el = {
    amount: document.getElementById('amount'),
    result: document.getElementById('result'),
    share: document.getElementById('share'),
  };

  function update() {
    var v = window.Calc.roundUp(el.amount.value, 100);
    el.result.textContent = isFinite(v) ? v.toLocaleString('ja-JP') + ' 円' : '—';
    store.set('draft', { amount: el.amount.value });
  }

  el.share.addEventListener('click', function () {
    var url = location.href.split('#')[0] + toShareHash({ amount: el.amount.value });
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
    history.replaceState(null, '', url);
  });

  var shared = fromShareHash(location.hash);
  el.amount.value = (shared || store.get('draft', {})).amount || '';
  el.amount.addEventListener('input', update);
  update();

  // PWA-BEGIN（オフライン対応にしないツールでは、init.mjs がこのブロックを消す）
  // 登録は './sw.js' だけ。scope: '/' を指定しない（README「ツールを追加するとき」13）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
  }
  // PWA-END
})();
