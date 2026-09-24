# __TITLE__

公開 URL: **https://yorozu-craft.com/__REPO__/**

__DESCRIPTION__
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。

<!-- TEMPLATE-BEGIN -->
## テンプレートの使い方（`tools/init.mjs` を実行すると、この節は消えます）

yorozu-craft の新しいツールの雛形です。サイト共通の決まり（youheioonuki.github.io の README「ツールを追加するとき」）のうち、ファイルで守れるものは最初から入れてあります。

1. GitHub で「Use this template」→ リポジトリ名は短いローマ字＋種類（例: `loan-sim`）。URL になる
2. クローンして、初期化スクリプトを 1 回だけ実行する（Node 20 以上）

   ```sh
   node tools/init.mjs loan-sim "住宅ローン 返済シミュレーター" "毎月の返済額と総返済額をすぐ計算。" --pwa
   ```

   - `__REPO__`・`__TITLE__`・`__DESCRIPTION__`・日付を置き換える
   - `--pwa` を付けないと、オフライン対応の部分（`sw.js`・`manifest.webmanifest`・`PWA-BEGIN`〜`PWA-END`）を消す
   - README のこの節と `tools/init.mjs` 自身を消す
3. `node --test tests/*.test.js` が通ることを確かめてからコミット
4. 残りは youheioonuki.github.io の README「ツールを追加するとき」の手順どおり（Pages の公開と Enforce HTTPS、トップの一覧・robots.txt・URL 表への追加など）

最初から入っているもの:

| 決まり | 入っている場所 |
|-------|---------------|
| canonical・OGP・AdSense・Cloudflare ビーコン | `index.html`・`guide.html` の `<head>` と `</body>` 直前 |
| 共通ページへの相対リンク（`../about.html`・`../privacy-policy.html`） | 各ページのフッター |
| ツール配下の 404 | `404.html`（youheioonuki.github.io のものと同じ） |
| 保存キーの接頭辞 `<リポジトリ名>_`・try/catch | `main.js` の `store` |
| 共有 URL は `#s=` | `main.js` の `toShareHash` / `fromShareHash` |
| SW のキャッシュ名の接頭辞・自分のパスだけ扱う・`./sw.js` で登録 | `sw.js`・`main.js` |
| manifest の `id` は `/<リポジトリ名>/` | `manifest.webmanifest` |
| 使い方ページは `guide.html`（注意・データの扱い・根拠と確認日・更新履歴の節つき） | `guide.html` |
| 要望・不具合の報告フォーム（全ツール共通の Google フォーム。リポジトリ名が入った状態で開く） | `guide.html` の「ご利用上の注意・データの扱い」 |
| 時点のある値は値・出典・確認日をセットで 1 か所に | `constants.js`（テストで出典と確認日の書き忘れを検出） |
| 計算は画面から切り離した純粋関数＋テスト | `calc.js`・`tests/`・`.github/workflows/test.yml` |
| 端末のフォント・ダークモード | `style.css` |
| MIT ライセンス | `LICENSE` |

差し替えが必要なもの: `favicon.svg`・`apple-touch-icon.png`（180×180）・`og-image.png`（1200×630）は仮の絵なので、ツールに合わせて作り直す。
<!-- TEMPLATE-END -->

## 機能

- （できることを箇条書きで）
- 入力内容はこの端末のブラウザにだけ保存し、外部には送信しない

## 計算の仕様・根拠

（計算式、使っている値と出典。値は `constants.js` にまとめ、画面の「根拠と確認日」にも出す）

## 保守

| 時期 | 確認すること | 直す場所 |
|------|------------|---------|
| （例: 毎年4月ごろ） | （例: 料率の改定） | `constants.js`、`guide.html` の最終確認日 |

値や計算を直したら、`guide.html` の「更新履歴」に日付と内容を 1 行足す。

## ファイル

| ファイル | 役割 |
|---------|------|
| `index.html` | ツール本体 |
| `guide.html` | 使い方・根拠と確認日・よくある質問・ご利用上の注意・更新履歴 |
| `calc.js` | 計算ロジック（画面から切り離した純粋関数） |
| `constants.js` | 時点のある値（値・出典・確認日） |
| `main.js` | 画面の制御・保存・共有リンク |
| `style.css` | 見た目（和紙風の配色、ダークモード対応） |
| `sw.js` / `manifest.webmanifest` | オフライン対応（使う場合のみ） |
| `404.html` | ツール配下の存在しない URL で出るページ（サイト共通のもの） |
| `favicon.svg` / `apple-touch-icon.png` / `og-image.png` | アイコン / ホーム画面用アイコン / SNS 共有用画像（1200×630） |
| `sitemap.xml` | サイトマップ（robots.txt はドメイン直下で管理） |
| `tests/*.test.js` | テスト（`node --test tests/*.test.js`。`.github/workflows/test.yml` で push・PR のたびに自動実行） |

## ライセンス

MIT License（`LICENSE`）。
