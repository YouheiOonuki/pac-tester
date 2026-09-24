// テンプレートから作ったリポジトリを、新しいツール用に書き換える（最初に 1 回だけ実行する）
//
//   node tools/init.mjs <リポジトリ名> "<ツール名>" "<説明文>" [--pwa]
//
//   例: node tools/init.mjs loan-sim "住宅ローン 返済シミュレーター" "毎月の返済額と総返済額をすぐ計算。" --pwa
//
// - __REPO__ / __TITLE__ / __DESCRIPTION__ / __DATE__ / __DATE_JA__ を置き換える
// - --pwa なし: オフライン対応をしないので sw.js・manifest.webmanifest と PWA-BEGIN〜PWA-END の部分を消す
// - README の「テンプレートの使い方」の節と、このスクリプト自身を消す
// 依存パッケージなし（Node 20 以上）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const pwa = args.includes('--pwa');
const [repo, title, description] = args.filter((a) => a !== '--pwa');

if (!repo || !title || !description) {
  console.error('使い方: node tools/init.mjs <リポジトリ名> "<ツール名>" "<説明文>" [--pwa]');
  process.exit(1);
}
// README「ツールを追加するとき」1: 英小文字・数字・ハイフンだけ
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(repo)) {
  console.error(`リポジトリ名は英小文字・数字・ハイフンだけにしてください: ${repo}`);
  process.exit(1);
}

const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // 日本時間の日付
const date = now.toISOString().slice(0, 10);
const dateJa = `${now.getUTCFullYear()}年${now.getUTCMonth() + 1}月${now.getUTCDate()}日`;

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escJson = (s) => JSON.stringify(s).slice(1, -1);

const TEXT_EXT = new Set(['.html', '.js', '.css', '.xml', '.webmanifest', '.md', '.svg', '.yml']);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (TEXT_EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

const SELF = fileURLToPath(import.meta.url);

if (!pwa) {
  for (const f of ['sw.js', 'manifest.webmanifest']) fs.rmSync(path.join(ROOT, f), { force: true });
}

for (const file of walk(ROOT)) {
  if (file === SELF) continue;
  const ext = path.extname(file);
  let s = fs.readFileSync(file, 'utf8');
  const before = s;

  if (pwa) {
    // 中身は残し、目印の行だけ消す
    s = s.replace(/^[ \t]*(<!-- PWA-(BEGIN|END) -->|\/\/ PWA-(BEGIN|END).*)\n/gm, '');
  } else {
    s = s.replace(/[ \t]*<!-- PWA-BEGIN -->[\s\S]*?<!-- PWA-END -->\n?/g, '');
    s = s.replace(/[ \t]*\/\/ PWA-BEGIN[\s\S]*?\/\/ PWA-END\n?/g, '');
  }
  if (path.basename(file) === 'README.md') {
    s = s.replace(/<!-- TEMPLATE-BEGIN -->[\s\S]*?<!-- TEMPLATE-END -->\n*/g, '');
  }

  // HTML 内の JSON-LD は JSON として置き換える（HTML の実体参照にすると名前が "&amp;" のまま載る）
  if (ext === '.html') {
    const escLd = (v) => escJson(v).replace(/</g, '\\u003c');
    s = s.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (_, a, body, b) =>
      a + body.replaceAll('__TITLE__', escLd(title)).replaceAll('__DESCRIPTION__', escLd(description)) + b);
  }

  const t = ext === '.html' || ext === '.svg' || ext === '.xml' ? escHtml(title)
    : ext === '.webmanifest' || ext === '.js' ? escJson(title) : title;
  const d = ext === '.html' || ext === '.svg' || ext === '.xml' ? escHtml(description)
    : ext === '.webmanifest' || ext === '.js' ? escJson(description) : description;
  s = s.replaceAll('__REPO__', repo)
    .replaceAll('__TITLE__', t)
    .replaceAll('__DESCRIPTION__', d)
    .replaceAll('__DATE_JA__', dateJa)
    .replaceAll('__DATE__', date);

  if (s !== before) fs.writeFileSync(file, s);
}

fs.rmSync(SELF);
try { fs.rmdirSync(path.dirname(SELF)); } catch { /* tools/ にほかのファイルがあれば残す */ }

console.log(`初期化しました: ${repo}（${title}）${pwa ? ' オフライン対応あり' : ''}`);
console.log('次にやること: README「ツールを追加するとき」の手順（アイコン・og-image.png・本体・使い方ページ・テスト）');
