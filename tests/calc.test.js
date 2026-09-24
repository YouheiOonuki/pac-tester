// 計算ロジックのテスト: node --test tests/*.test.js
// （.github/workflows/test.yml で push・PR のたびに自動実行される）
const test = require('node:test');
const assert = require('node:assert/strict');
const { roundUp } = require('../calc.js');
const CONSTANTS = require('../constants.js');
const fs = require('node:fs');
const path = require('node:path');

// テンプレートのまま（tools/init.mjs がまだある）なら、確認日は "__DATE__" のままでよい
const IS_TEMPLATE = fs.existsSync(path.join(__dirname, '..', 'tools', 'init.mjs'));

test('roundUp: 100 円単位で切り上げ', () => {
  assert.equal(roundUp(1234, 100), 1300);
  assert.equal(roundUp(1200, 100), 1200);
});

test('roundUp: 数でないものは NaN', () => {
  assert.ok(Number.isNaN(roundUp('abc', 100)));
});

test('constants: すべての値に出典と確認日がある', () => {
  for (const [key, c] of Object.entries(CONSTANTS)) {
    assert.ok(c.source && c.url && c.checked, `${key} に source / url / checked が無い`);
    if (IS_TEMPLATE && c.checked === '__DATE__') continue;
    assert.match(c.checked, /^\d{4}-\d{2}-\d{2}$/, `${key} の checked は YYYY-MM-DD`);
  }
});
