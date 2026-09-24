// テスト用: PAC を Node の vm で評価する（ブラウザの Worker と同じ pac-runtime.js を使う）
// ブラウザ版は隔離用の枠の中の Worker で評価するが、ヘルパー関数と「1 件 200 ミリ秒まで」の決まりは同じ
const vm = require('node:vm');
const PacRuntime = require('../src/pac-runtime.js');
const Core = require('../src/core.js');

function evalPac(code, urls, cfg, timeoutMs = 200) {
  const rt = PacRuntime.create(cfg);
  const ctx = vm.createContext({});
  for (const name of PacRuntime.HELPER_NAMES) ctx[name] = rt.helpers[name];
  try {
    vm.runInContext(code, ctx, { timeout: 1000 });
  } catch (e) {
    return urls.map(() => ({ ok: false, error: '読み込めません: ' + e.message, alerts: [] }));
  }
  return urls.map((u) => {
    ctx.__u = u.pacUrl;
    ctx.__h = u.host;
    try {
      const v = vm.runInContext('FindProxyForURL(__u, __h)', ctx, { timeout: timeoutMs });
      return { ok: true, value: typeof v === 'string' ? v : String(v), valueType: v === null ? 'null' : typeof v, alerts: rt.takeAlerts() };
    } catch (e) {
      const timeout = /timed out/i.test(e.message);
      return { ok: false, timeout, error: e.message, alerts: rt.takeAlerts() };
    }
  });
}

function sampleConfig(extra) {
  return Object.assign({
    hosts: Core.parseHostTable(Core.SAMPLE_HOSTS).hosts,
    myIp: Core.SAMPLE_MY_IP,
    nowMs: Date.UTC(2026, 8, 24, 1, 30, 0),   // 2026-09-24（木）10:30 日本時間
    tzOffsetMin: 540,
  }, extra || {});
}

module.exports = { evalPac, sampleConfig, Core, PacRuntime };
