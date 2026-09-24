// ===========================
// 計算ロジック（画面から切り離した純粋関数）
// DOM や localStorage に触らない。tests/calc.test.js から node --test で確かめる
// ブラウザでは window.Calc、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  /**
   * 例: 金額を指定の単位で切り上げる（使わなければ消す）
   * @param {number} amount 金額
   * @param {number} unit   単位（例: 100）
   * @returns {number}
   */
  function roundUp(amount, unit) {
    var a = Number(amount), u = Number(unit) || 1;
    if (!isFinite(a)) return NaN;
    return Math.ceil(a / u) * u;
  }

  var api = { roundUp: roundUp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
