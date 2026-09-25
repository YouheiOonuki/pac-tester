// ===========================
// PAC ファイル テスター — PAC を評価する Worker の中で動く部分
// 隔離用の枠（sandbox.html）が、pac-runtime.js・設定（__PT_CFG）・このファイル・ユーザーの PAC を
// つなげて 1 つの Blob にし、Worker として起動する。ページ本体（pac-tester.html）とは別のオリジン（null）で動く
// 文言は設定の msg（messages.js の worker）で受け取る
// ===========================
var __pt = PacRuntime.create(__PT_CFG);

// ヘルパー関数を PAC から呼べるようにする。PAC の中に同じ名前の関数が書いてあれば、そちらを優先する（ブラウザと同じ）
PacRuntime.HELPER_NAMES.forEach(function (name) {
  if (typeof self[name] !== 'function') self[name] = __pt.helpers[name];
});

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.type !== 'eval') return;
  var out = { type: 'result', id: d.id };
  var t0 = Date.now();
  try {
    if (typeof FindProxyForURL !== 'function') throw new Error((__PT_CFG.msg && __PT_CFG.msg.noEntry) || 'FindProxyForURL is not defined');
    var v = FindProxyForURL(d.url, d.host);
    out.ok = true;
    out.valueType = v === null ? 'null' : typeof v;
    out.value = typeof v === 'string' ? v : String(v);
  } catch (err) {
    out.ok = false;
    out.error = err && err.name && err.message ? err.name + ': ' + err.message : String(err);
  }
  out.ms = Date.now() - t0;
  out.alerts = __pt.takeAlerts();
  self.postMessage(out);
};
