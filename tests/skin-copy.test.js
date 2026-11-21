// 1 ファイルで動く本体（src/app.css。build.mjs が pac-tester.html・pac-tester-en.html に埋め込む）は皮を読み込めないので、皮の値を写して持つ。
// 写しが皮（style.css に配ってある yorozu-common v2 の begin〜end）と食い違わないことを見る（値を 2 か所に持つのは機械が突き合わせるときだけ）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
// 明るい表示と暗い表示のトークン（最初の宣言のかたまりと、prefers-color-scheme: dark の中）
function tokens(css) {
  const dark = css.indexOf('prefers-color-scheme: dark'), pick = (s) => Object.fromEntries([...s.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const next = dark < 0 ? -1 : css.indexOf('@media', dark);   // 暗い表示のかたまりだけ（後ろの @media は含めない）
  return { light: pick(dark < 0 ? css : css.slice(0, dark)), dark: dark < 0 ? {} : pick(css.slice(dark, next < 0 ? undefined : next)) };
}
const skinCss = read('style.css').split('/* yorozu-common:begin')[1].split('/* yorozu-common:end')[0];
const skin = tokens(skinCss);
test('src/app.css の色・角・押せる高さは皮と同じ値', () => {
  const app = tokens(read('src/app.css'));
  let n = 0;
  for (const mode of ['light', 'dark']) for (const [k, v] of Object.entries(app[mode])) if (k in skin[mode] && !k.startsWith('--font')) { assert.equal(v, skin[mode][k], mode + ' ' + k); n++; }
  assert.ok(n >= 10, n + ' 個');
});
