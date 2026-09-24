# PAC ファイル テスター

公開 URL: **https://yorozu-craft.com/pac-tester/**

PAC ファイル（proxy.pac）の `FindProxyForURL` を、URL の一覧でまとめてテストするツール。戻り値の一覧表、構文・ロジックのチェック、新旧の差分比較。通信しない 1 ファイルの HTML で、PAC の中身は外に出ません。
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。企画は yorozu-plans の `docs/05_PACテスター.md`。

## 本体はダウンロード版の 1 ファイル

md-viewer と同じ形（オーナー決定）。**`pac-tester.html`（1 ファイルの HTML）が本体**で、インストール不要・通信なし・広告と解析なし。`index.html` は紹介とダウンロードのページで、広告とアクセス解析はここと `guide.html` だけに入れる。「ブラウザで試す」はダウンロード版と同じ `pac-tester.html` を開く。

| ページ | 広告・解析 | 検索 |
|-------|-----------|------|
| `index.html`（紹介・ダウンロード） | AdSense・Cloudflare ビーコンあり | index |
| `en/index.html`・`en/guide.html`（英語版） | AdSense・Cloudflare ビーコンあり | index |
| `guide.html`（使い方） | AdSense・Cloudflare ビーコンあり | index |
| `pac-tester.html`（本体） | **なし**（外部への通信を一切しない） | `noindex`、sitemap に載せない |

## 機能

- **PAC の入力**：貼り付け、ファイルを開く・ドラッグ＆ドロップ（UTF-8 で読めなければ Shift_JIS）。入力が止まって 400ms 後に自動で評価（Ctrl+Enter・「評価する」でもすぐ）
- **テストする URL**：1 行に 1 つ。スキームを省くと http。`#` で始まる行はメモ。ホスト名は `new URL()` で取り出す（小文字・ポートなし）。`.txt` で読み込み・保存。最大 2,000 件
- **評価の設定**：ホスト名と IP の対応表（DNS の代わり。「ホスト IP」と hosts ファイルの「IP ホスト…」の両方、`*.example.com` の形も可）、`myIpAddress()` の値、評価に使う日時と UTC との時差、https の URL のパスとクエリを除いて渡すか（既定オン。Chrome・Edge と同じ）
- **ヘルパー関数**（`src/pac-runtime.js`）：isPlainHostName・dnsDomainIs・localHostOrDomainIs・isResolvable・isInNet・dnsResolve・convert_addr・myIpAddress・dnsDomainLevels・shExpMatch・weekdayRange・dateRange・timeRange・alert。Firefox・Chromium の実装（Netscape 由来の同じコード）に合わせた。意図して変えた点は 3 つ：
  - shExpMatch は `*` と `?` だけを特別扱いし、ほかの記号は文字そのもの（ブラウザの実装は `.` だけを逃がすので `[ ]` や `+` が正規表現として効く）
  - dateRange の終わりに月だけを書いたときは、その月の末日まで（ブラウザの実装は 12/31 に setMonth するので、31 日の無い月で翌月の 1〜3 日までになる）
  - timeRange の 4・6 引数の形は秒まで正しく比べる（ブラウザの実装は開始側の秒に「いまの秒」が残る）。2 引数の形が日をまたがない（`timeRange(22, 6)` は常に false）のはブラウザと同じ
- **結果の表**：URL ごとの戻り値、戻り値ごとの色と件数（押すと絞り込み）、文字での絞り込み、「エラー・注意だけ」、`alert()` の出力、エラー・タイムアウト、戻り値の形の注意（`,` 区切り・ポートの範囲など）、CSV 保存（BOM 付き UTF-8。`=` などで始まる値は `'` を前に付ける）
- **構文・ロジックのチェック**（`src/core.js` の `lint`。acorn で構文木を作るだけで、PAC は実行しない）：
  - FindProxyForURL があるか（名前の大文字・小文字の違いも指摘）、引数の数、2 つ以上の定義
  - 全角文字・全角スペース・ゼロ幅スペースなど：コードの中はエラー、文字列の中は注意、コメントの中は出さない（コメント・文字列・正規表現の位置は独自の簡易スキャナで調べるので、構文エラーがあっても動く）
  - 括弧 `(){}[]` と引用符の対応（開いた位置・ずれた位置を行番号つきで）、acorn の構文エラーを日本語にしたもの
  - 最後の return 漏れ（if/else・switch・try・無限ループを考えた「必ず return するか」の判定）、値の無い return、戻り値の文字列の形
  - shExpMatch のパターン一覧と注意（host にスキーム・パス・ポート・大文字、`*` の付け忘れ、url に `/` が抜けている、使えない記号、https のパス）
  - **ルールの隠れ**：FindProxyForURL の直下の `if (…) return …;` の並びと else if の並びで、条件が `shExpMatch(x, "P")`・`dnsDomainIs(x, ".d")`（`*.d` とみなす）・`x == "h"` とその `||` のとき、上のパターンが下のパターンをすべて含むか（`*` と `?` のパターンどうしの包含を DP で近似判定）。戻り値が同じなら「参考」、違えば「注意」。url・host を書き換える文があれば、そこで比較をやめる
  - isInNet のマスクの形・連続していないマスク、dnsDomainIs の先頭のドット、weekdayRange の小文字、`timeRange(22, 6)`
- **差分モード**：旧 PAC と新 PAC を同じ URL 一覧で評価し、結果（空白をそろえた戻り値、エラー・タイムアウト）が変わった行だけに色と「変更」の印。件数を表示。「変わった行だけ」の絞り込み。CSV に旧・新の両方
- **見本**：架空のドメイン（example.com・example.net・example.org・`.example`）とプライベート・文書用の IP アドレスだけを使った一般的な PAC・URL 一覧・ホスト表。初めて開いたとき（と、PAC を保存していないとき）に出る
- **保存**：評価の設定を `pac-tester_settings` に保存。PAC と URL 一覧は既定では保存しない（「このブラウザに保存する」をオンにしたときだけ `pac-tester_draft`。オフに戻すと消す）。すべて try/catch

## PAC の隔離（REVIEW C3-2 の方式）

貼られた PAC はページのオリジンでは実行しない。

1. ページ（`src/app.js`）が `<iframe sandbox="allow-scripts">` を作り、`srcdoc` に隔離用の枠（`src/sandbox.html`）を入れる。`allow-same-origin` を付けないので、枠のオリジンは `null`（opaque origin）
2. 枠の中で、`pac-runtime.js`＋設定＋`worker.js`＋ユーザーの PAC をつなげた文字列を Blob にし、その Blob URL（`blob:null/…`）で Worker を起動する。PAC は Worker の中だけで動く
3. やりとりは postMessage だけ（ページ ⇔ 枠 ⇔ Worker）。ページは `e.source` が枠のときだけ受け取り、jobId・添え字・型を確かめてから表に入れる
4. タイムアウト：1 URL につき 200ms。枠が `worker.terminate()` で止めて Worker を作り直し、次の URL へ進む。PAC の読み込み（関数の外のコード）は 1000ms。枠そのものが 3 秒応答しないときは、ページが枠ごと作り直す（見張り役。ブラウザでの確認ではこの経路は起きていない）
5. 通信の禁止：ページの CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'`。srcdoc の枠はページの CSP を引き継ぎ、さらに枠自身の meta でも `connect-src 'none'` などを指定。Blob の Worker は作った枠の CSP を引き継ぐ。`unsafe-eval` が無いので、PAC の中の `eval`・`Function` も使えない

### ブラウザでの確認（2026-09-24、Playwright の Chromium、`file://` と `http://127.0.0.1` の両方）

- Blob の Worker は sandbox の枠の中でも起動できた（`blob:null/…`、Worker の `self.origin` は `"null"`）
- 見本の 10 件が期待値の表どおり。壊れた PAC でチェックの結果が出る。差分モードで変えた 2 行だけが強調される
- `while(true){}` の PAC に URL 10 件：10 件ともタイムアウト、全体 2.2〜2.3 秒。その間 requestAnimationFrame は 130 回以上動き、フレームの間隔は最大 26〜29ms、評価中のチェックボックスのクリックは 0.1ms で処理された
- fetch・XMLHttpRequest・Image・importScripts・WebSocket・EventSource・sendBeacon・top/parent/document・localStorage・indexedDB・caches・eval・Function を試す PAC：XHR と EventSource は CSP で止まり（Playwright の記録で失敗理由 `csp`）、fetch・WebSocket は要求として記録すらされず、ほかは例外（ReferenceError・SecurityError・EvalError など）。別に立てた受け側のサーバーへの着信は 0 件。ページ自身と `blob:null/…` 以外に外へ出た要求は無い
- 幅 390px（ダークモード）で横スクロールなし（`scrollWidth` 390）
- 確かめていないもの：Firefox・Safari（この環境に無い）、見張り役による枠の作り直し

## ビルド方法

```sh
npm ci            # package.json で固定したライブラリ（acorn）を入れる
node build.mjs    # pac-tester.html と THIRD_PARTY_LICENSES.txt を作る
node --test tests/*.test.js
```

- `build.mjs` は依存パッケージなし。`src/app.html` に `src/app.css`・`acorn/dist/acorn.js`・`src/core.js`・隔離用の枠（`window.PT_SANDBOX_HTML` という文字列。中に `pac-runtime.js` と `worker.js` を文字列で入れる）・`src/app.js` をそのまま埋め込む
- 埋め込む JS に `</script` があれば `<\/script` にし、`<script` があればビルドを止める。枠の HTML は JSON 文字列にし、`<` を `<` にして入れる。`src/*.js` にも「`<` のすぐ後ろに script」と書かない
- 同じ入力なら同じ `pac-tester.html` になる。CI（`.github/workflows/test.yml`）で `npm ci && node build.mjs` のあと差分が無いことを確かめるので、**`src/` やライブラリを直したら、ビルドした `pac-tester.html` も一緒にコミットする**
- サイズ（2026-09-24 のビルド）：`pac-tester.html` 370,426 バイト（約 370KB）。うち acorn.js 245,232 バイト。ライブラリを更新したら紹介ページの「約 370KB」と JSON-LD の `fileSize` も直す

## ライブラリとライセンス

| ライブラリ | バージョン | ライセンス | 埋め込むファイル | 用途 |
|-----------|-----------|-----------|----------------|------|
| acorn | 8.18.0 | MIT | `dist/acorn.js` | lint の構文解析だけ（ページで解析しても PAC は実行されない） |

- `package.json` の `devDependencies` にバージョンを固定（`^` なし）。`package-lock.json` もコミットする。acorn 8 は依存パッケージなし
- ライセンス全文は `build.mjs` が集めて `THIRD_PARTY_LICENSES.txt` と `pac-tester.html` の末尾（`<script type="text/plain" id="licenses">`、画面の「ライセンス」ボタンで表示）に入れる

## 保守

| 時期 | 確認すること | 直す場所 |
|------|------------|---------|
| 半年に 1 回（3 月・9 月ごろ） | acorn の新しい版、`npm audit` | `package.json` のバージョン → `npm install` → `node build.mjs` → テスト → ブラウザで見本・チェック・差分・無限ループを確認 → `pac-tester.html`・`THIRD_PARTY_LICENSES.txt`・`package-lock.json` をコミット |
| ライブラリを更新したとき | ファイルサイズ、ライセンス | `index.html`・`en/index.html` の「約 370KB」・JSON-LD の `fileSize`、`guide.html`・`en/guide.html` の「ライセンス一覧」、この README |
| ブラウザの PAC の扱いが変わったとき | https のパスの扱い・ヘルパー関数の差 | `src/pac-runtime.js`・`src/core.js`・`guide.html`・`en/guide.html` |

直したら、`guide.html` の「更新履歴」に日付と内容を 1 行足す。

## ファイル

| ファイル | 役割 |
|---------|------|
| `pac-tester.html` | **本体**（ビルドで作る。ダウンロード版・「ブラウザで試す」の両方） |
| `index.html` | 紹介・ダウンロードのページ |
| `guide.html` | PAC の基本・使い方・ヘルパー関数の一覧と注意点・よくあるミス・差分モード・安全性・ライセンス一覧・よくある質問・ご利用上の注意・更新履歴 |
| `en/index.html` / `en/guide.html` | 英語版の紹介・使い方（2026-09-24。K65）。本体 `pac-tester.html` の画面は日本語のままなので、紹介ページに画面の日本語ラベルと英語の意味の対応表を置いている。**本体のラベルを変えたら、この表も直す**。日本語版とは `hreflang` で相互に結ぶ（共通の決まりは youheioonuki.github.io の README「ツールを追加するとき」23） |
| `src/app.html` | 本体の HTML のひな形（`{{…}}` を build.mjs が埋める） |
| `src/app.css` | 本体の見た目（和紙風の配色、ダークモード対応） |
| `src/app.js` | 本体の画面の制御・隔離用の枠の管理・結果の表・保存 |
| `src/core.js` | 画面から切り離した純粋関数（URL 一覧・ホスト表・lint・パターンの包含・戻り値のチェック・差分・CSV・見本。UMD） |
| `src/pac-runtime.js` | PAC の標準ヘルパー関数（UMD。Node のテストと Worker の両方で使う） |
| `src/sandbox.html` | 隔離用の枠（srcdoc）。Worker の起動・タイムアウト・中継 |
| `src/worker.js` | Worker の中で FindProxyForURL を呼ぶ部分 |
| `build.mjs` | `pac-tester.html` と `THIRD_PARTY_LICENSES.txt` を作る |
| `package.json` / `package-lock.json` | 埋め込むライブラリ（dev 依存、バージョン固定） |
| `THIRD_PARTY_LICENSES.txt` | 同梱ライブラリのライセンス全文（ビルドで作る） |
| `style.css` | 紹介・使い方ページの見た目 |
| `404.html` | ツール配下の存在しない URL で出るページ（サイト共通のもの） |
| `favicon.svg` / `apple-touch-icon.png` / `og-image.png` | アイコン / ホーム画面用アイコン / SNS 共有用画像（1200×630） |
| `sitemap.xml` | サイトマップ（index.html・guide.html と、その英語版 en/ の 2 ページ） |
| `tests/runtime.test.js` | ヘルパー関数（shExpMatch・isInNet・dnsDomainIs・日時の関数など） |
| `tests/sample.test.js` | 見本の PAC の期待値の表（Node の vm で評価）・無限ループのタイムアウト・見本が架空のドメインだけか |
| `tests/lint.test.js` | チェック（全角スペース・return 漏れ・括弧・ルールの隠れ・パターン・戻り値の形） |
| `tests/core.test.js` | URL 一覧・ホスト表・差分（変わらない URL は強調しない）・CSV |
| `tests/build.test.js` | ビルドした `pac-tester.html`（外部への通信・広告が無い、CSP、隔離の方式、ライセンス） |
| `tests/helpers.js` | テスト用に PAC を vm で評価する関数 |

テストは `node --test tests/*.test.js`。`.github/workflows/test.yml` で push・PR のたびに、`npm ci`・ビルドの差分確認・テストを自動で行う。

## ライセンス

MIT License（`LICENSE`）。同梱ライブラリのライセンスは `THIRD_PARTY_LICENSES.txt`。
