# クラウドセッションへの作業指示：MetaMask の「詐欺サイト」誤検知を減らす

## 背景

- **Agent Quest**：初心者向けのドット絵の学習アプリです。ウォレットをつなぎ、Base に ERC-8004 のエージェントを作って、13 のクエストで動かします。
  - 公開先：https://agent-quest-lilac.vercel.app
  - Vercel が、このリポジトリから `node build.js` で `deploy/` を組み立てて公開しています（vercel.json）。
- **問題**：MetaMask で接続すると、全画面の「Deceptive site ahead / 自己責任で行ってください」が出ます。
  - MetaMask の eth-phishing-detect の一覧には、このドメインは載っていません。動的なスキャン（Blockaid など）による判定と考えられます。
  - 理由は公開されていません。
  - Blockaid への誤検知報告（Mistake）と開発者の確認依頼（Developer）は送信済みです。
- **目的**：審査する人や自動スキャンから見て「正規の学習アプリ」だとはっきり分かるようにすることです。あわせて、詐欺サイトに似た特徴を減らします。アプリの体験は壊さないでください。

## 守ること

- **鍵や個人情報**：`rpc-url.txt`・鍵・個人のメールアドレスは、コミットしないでください。Alchemy の窓口は、Vercel の環境変数 `AQ_RPC_URL` から build.js が読み込みます。
- **main には直接 push しない**：ブランチを作って Pull Request にしてください。Vercel が PR ごとにプレビューの URL を作ります。
- **作業の進め方**：
  - 中身の変更は小さなコミットに分けてください。
  - 各コミットのあとに、関係するテストを流してください。
  - コミットメッセージは日本語で構いません。
- **アプリ内の文言の決まり（利用者の希望）**：
  - 日本語版は日本語だけ、英語版は英語だけで書きます。混ざっていないかは `tools/check-lang.mjs` で確かめます。
  - プレイする人が大事という立場で書きます。開発者は試験官ではありません。「〜してもかまいません」のような許可・採点の口調は避け、「〜することもできます」のようにやわらかく書きます。
  - 字は大きすぎないようにします（今の大きさが好み）。
- **作り話をしない**：「できた」と表示するのは、記録で確かめたときだけにします（各ファイルの冒頭の方針に従ってください）。
- **構成はそのまま**：vanilla JS・サーバーなし・1ページです。フレームワークや大きな依存は足さないでください。

## 作業

### 0. 下ごしらえ（テストが動くようにする）

- `tools/*.mjs` には、前の環境の絶対パスが残っています。直して、このリポジトリだけで動くようにしてください。
  - 例：`/home/claude/node_modules/playwright/index.mjs`、`executablePath: '/opt/pw-browsers/chromium'`、scratchpad の `viem` や `@flop-labs/tclk` のパス
- `package.json` を作ります。
  - devDependencies：playwright・viem・@flop-labs/tclk@0.1.0
  - scripts：`build`（node build.js）と `test`（主なテストをまとめて実行）
- `test` に入れるテスト：
  - `tools/check-*.js` すべて
  - `tools/check-lang.mjs`
  - `tools/shot-quest.mjs`、`shot-tech.mjs`、`shot-errand.mjs`、`shot-social.mjs`、`shot-robot.mjs`、`shot-birth.mjs`、`shot-start.mjs`
- 並べて同時に流すとタイミングで落ちることがあるので、1本ずつ順に流してください。
- リポジトリの直下に、以前の手作業の公開で置いた組み立て済みのファイル（icon-*.png・og-image.png・manifest.webmanifest）が残っていたら消してください（今は build.js が deploy/ に作ります）。assets/ の中のものは消さないでください。
- Vercel では依存を入れません（vercel.json の installCommand はそのまま）。`build.js` は Node の標準機能だけで動くようにしておいてください。

### 1. 詐欺サイトに似た特徴を減らす

1. **x402 の支払い先を固定する**（`src/errand.js`）
   - 今は、ニュースのお店（`x402-seller-pmlm.onrender.com`）の `payTo` を、402 の返事からそのまま使っています（上限 0.05 USDC のみ）。
   - お店ごとに、許す `payTo`・`asset`（Base USDC）・`network`（eip155:8453）・金額の上限を、コードに固定してください。
   - 返事の中身がその一覧と違ったら、署名を求めずに中止し、正直に知らせます。
   - 本物の payTo は、お店に支払いなしで一度問い合わせ、402 の返事（PAYMENT-REQUIRED ヘッダ）から確かめてください。例：`curl -i 'https://x402-seller-pmlm.onrender.com/news?q=Base&limit=5&hours=48'`。
   - テストにある `0x079471E6F43b6feeF80895E19cBFcBB496904852` は検査用の値で、本物とは限りません。
   - CoinGecko の値段のお店は、すでに固定の payTo を持っています（`SHOPS.price.req`）。同じ形にそろえてください。
2. **ウォレットに頼む前に、アプリの中で中身を見せる**
   - 署名・取引の直前に、アプリの中で短く見せます。
     - 何を頼むか（例：「ニュースのお店に 0.005 USDC を1回だけ払う署名」）
     - 相手（Basescan へのリンク付きの短いアドレス）
     - 上限と期限
   - 確認のボタンを押してから、ウォレットを呼んでください。
   - 学習アプリとしても分かりやすくなります。ただし、一手増えすぎてテンポを崩さないようにしてください（今のウィザード `src/wizard.js` の流れに合わせます）。
3. **ウォレットへの頼みは、ボタンを押したときだけにする**
   - ページを開いただけで `eth_requestAccounts`・`wallet_switchEthereumChain`・署名を呼ぶ道すじが無いか、全体を点検してください。
   - 見つかったら直してください。音を立てない `eth_accounts` の読み取りは構いません。
4. **詐欺サイトに多い言葉を減らす**
   - 画面・meta・説明に出る「airdrop / エアドロップ」「claim」「verify wallet」などを見直してください。
   - 例：`robot.rep.note` の「$FLOP エアドロップ」の一文は削るか、言い換えます。
   - kibble の書式名（`CLAIM v1` など）は外部の決まりなので変えないでください。表示用の英語ラベル（"claimed" → "taken" など）は変えて構いません。
5. **「安全について」のページを作る**
   - `deploy/safety.html` を作ります（build.js で書き出し、日英切り替え）。
   - 中身：
     - アプリがウォレットに頼むこと（接続・ERC-8004 公式の登録先への取引・x402 の支払いの署名）
     - 使うコントラクト（IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`、ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`、Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`）と、Basescan へのリンク
     - 「しないこと」（approve / permit / setApprovalForAll なし、自前のコントラクトなし、秘密鍵を求めない、開発者への送金なし）
     - このリポジトリへのリンク
   - 始めの画面の目立ちすぎない場所と、ページの下からリンクしてください。
6. **`/.well-known/security.txt` を置く**
   - 連絡先は、このリポジトリの GitHub Issues の URL にします。メールアドレスは入れません。
7. **安全のための応答ヘッダを足す**（vercel.json の `headers`）
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `X-Frame-Options: DENY` と CSP の `frame-ancestors 'none'`
   - `Permissions-Policy`（使わない機能を止める）
   - CSP の `connect-src` は、実際に通信している相手だけにします。build 後の deploy/index.html を調べ、使っている外部の宛先を全部洗い出してください。
     - 例：technocore.chat、kibble.world、mainnet.base.org、base-mainnet.g.alchemy.com、base.blockscout.com、x402-seller-pmlm.onrender.com、pro-api.coingecko.com
   - 1ページの中に書いたスクリプトなので、`script-src 'unsafe-inline'` は残すしかありません。
   - CSP でアプリが壊れないことを、プレビューの URL で必ず確かめてください。迷ったら、まずは `Content-Security-Policy-Report-Only` で入れてください。
8. **ページの情報を整える**
   - `<title>`・description・`<link rel="canonical">` を整えます。
   - フッターに GitHub へのリンクを置きます。
   - README.md は古い内容（Agent Dispatch Phase 0）なので、今のアプリの英語の説明に書き直してください（日本語の節があってもよい）。
   - README に入れる内容：何をするアプリか、ウォレットに頼むこと・しないこと、build と test の方法、Vercel の環境変数（AQ_RPC_URL・AQ_SITE_URL・AQ_BASE_APP_ID）。

### 2. 確かめる

- `npm test` がすべて通ること。新しく足した動きにはテストを足してください。
  - 支払い先が一覧と違うときに中止するか
  - 確認の画面を通らないとウォレットを呼ばないか
  - safety.html が日英で出るか
  - ヘッダ（vercel.json）が正しい JSON か
- PR のプレビューの URL で、次を目で確かめてスクリーンショットを PR に貼ってください。
  - 始めの画面
  - クエストの窓
  - safety.html
- 最後に PR の説明へ、日本語で次をまとめてください。
  - 何を変えたか
  - 利用者が手でやること（Vercel の設定・Blockaid への追加報告など）

## やらないこと

- ドメインの購入や Vercel・GitHub の設定変更（利用者が行います）
- MetaMask・Blockaid への報告の送信（利用者が行います）
- アプリのクエストの中身や見た目の大きな作り直し
