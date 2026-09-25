// ===========================
// 保存した内容をすべて消す（初期状態に戻す）— yorozu-craft の全ツール共通（yorozu-plans ROADMAP K123）
// <button type="button" data-reset-storage="<リポジトリ名>_"> を押すと、確認を 1 回出してから、
// その接頭辞で始まる localStorage のキー（と data-reset-legacy に並べた接頭辞なしの旧キー）だけを消し、
// ページを読み直して初期状態に戻す。全ツールが同じオリジン（yorozu-craft.com）なので、ほかのツールのキーは消さない。
// 接頭辞と旧キーは空白かカンマで区切って複数書ける。確認の文は data-reset-confirm で差し替えられる。
// data-reset-hold を付けると、押すだけでは動かず 1 秒の長押しで確認を出す（こども向けの画面）。
// ===========================
(function (root) {
  'use strict';

  function splitList(s) {
    return String(s || '').split(/[\s,]+/).filter(function (x) { return x !== ''; });
  }

  /** 消すキーを選ぶ（DOM や localStorage に触らない。tests から確かめる） */
  function keysToRemove(keys, prefixes, legacy) {
    prefixes = (prefixes || []).filter(function (p) { return p !== ''; });   // 空の接頭辞で全部消さない
    legacy = legacy || [];
    return keys.filter(function (k) {
      if (legacy.indexOf(k) !== -1) return true;
      for (var i = 0; i < prefixes.length; i++) if (k.indexOf(prefixes[i]) === 0) return true;
      return false;
    });
  }

  /** storage（localStorage と同じ形）から、選んだキーを消す。消したキーを返す */
  function clear(storage, prefixes, legacy) {
    var all = [];
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i);
      if (k !== null) all.push(k);
    }
    var gone = keysToRemove(all, prefixes, legacy);
    gone.forEach(function (k) { try { storage.removeItem(k); } catch (e) { /* 消せなくても続ける */ } });
    return gone;
  }

  var api = { keysToRemove: keysToRemove, clear: clear, splitList: splitList };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.ResetStorage = api;

  var MSG = {
    ja: 'このツールがこの端末に保存した内容（入力・履歴・設定）をすべて消して、初期状態に戻します。消した内容は元に戻せません。よろしいですか？',
    en: 'Delete everything this tool has saved in this browser (inputs, history, settings) and reset it to the initial state? This cannot be undone.',
  };

  function wire(btn) {
    function run() {
      var lang = /^en\b/i.test(document.documentElement.lang || '') ? 'en' : 'ja';
      if (!root.confirm(btn.getAttribute('data-reset-confirm') || MSG[lang])) return;
      var prefixes = splitList(btn.getAttribute('data-reset-storage'));
      var legacy = splitList(btn.getAttribute('data-reset-legacy'));
      try {
        clear(root.localStorage, prefixes, legacy);
        // 読み直すまでの間に（pagehide などで）保存し直されないよう、消したキーへの書き込みを止める
        var setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (keysToRemove([String(k)], prefixes, legacy).length) return;
          return setItem.call(this, k, v);
        };
      } catch (e) { /* localStorage が使えない環境では、消すものも無い */ }
      // # 以降（共有リンクの中身など）も外して、最初の画面を開き直す
      root.location.replace(root.location.pathname + root.location.search);
    }
    if (!btn.hasAttribute('data-reset-hold')) { btn.addEventListener('click', run); return; }
    // data-reset-hold: 1 秒の長押しで確認を出す（こどもが遊ぶ画面で、誤って押さないように）
    var timer = null;
    function up() { if (timer) { clearTimeout(timer); timer = null; } }
    btn.addEventListener('pointerdown', function () { up(); timer = setTimeout(function () { timer = null; run(); }, 1000); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, up); });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-reset-storage]'), wire);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : this);
