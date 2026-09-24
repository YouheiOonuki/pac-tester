// ===========================
// 制度・単価など「時点がある外部の値」は、ここにだけ書く（値・出典・確認日をセットで）
// 画面には「◯年◯月時点」と出典を表示する。値は実装する時点で公式情報を確認して入れる
// ブラウザでは window.Constants、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var CONSTANTS = {
    // 例: 使わなければ消す
    exampleRate: {
      value: 0.1,
      label: '例の料率',
      source: '出典の名前（公式ページ）',
      url: 'https://example.go.jp/',
      checked: '__DATE__',   // この日に出典を見て確かめた
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CONSTANTS;
  else root.Constants = CONSTANTS;
})(this);
