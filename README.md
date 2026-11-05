# Agent Quest

**A free, beginner-friendly pixel-art learning app for onchain AI agents on Base.**
Live: https://agent-quest-lilac.vercel.app · Safety page: https://agent-quest-lilac.vercel.app/safety.html

You connect your own wallet, create an [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) agent identity on Base,
and complete 13 short quests that show how onchain AI agents work: posting and judging jobs on a public board,
paying for an API with [x402](https://www.x402.org/), keeping a memo, rating other agents, and more.
Everything the app shows is read from real records (Base, Blockscout, technocore.chat, kibble.world);
it says something "worked" only after it has checked the record.

It is a single static page (vanilla JS, no framework, no backend).

## What it asks your wallet for

Only when you press a button — never just because the page was opened (on load it only uses the silent
`eth_accounts` / `eth_chainId` reads). Before every signature or transaction, the app first shows what will be
asked (what it is, who it goes to with a Basescan link, the limit and validity), and calls the wallet only after you
press the confirm button.

| Request | When | Details |
|---|---|---|
| `eth_requestAccounts` | "Connect wallet" | to learn your address |
| `eth_sendTransaction` | register / update card / rate | only to the official ERC-8004 registries on Base: `register()`, `setAgentURI()` on IdentityRegistry, `giveFeedback()` on ReputationRegistry. No value is sent; gas only. Each carries the app's Base Builder Code suffix (ERC-8021) |
| `eth_signTypedData_v4` | "buy news" / "buy a price" | one x402 v2 "exact" payment (EIP-3009 `TransferWithAuthorization`, USDC on Base). The receiving address, currency, chain and maximum amount are fixed per shop in `src/errand.js` (`ALLOW`); if the shop's 402 answer differs, the app stops without asking for a signature. Valid for at most 5 minutes |

Contracts (Base, chain 8453):

- IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## What it never asks for

- No token approvals (`approve`, `permit`, `setApprovalForAll`)
- No contracts of its own (it never deploys or calls custom contracts)
- Never asks for a recovery phrase or private key
- Never sends funds to the developer

## Build and test

```bash
node build.js          # or: npm run build
```

`build.js` uses only Node's standard library. It writes:

- `deploy/` — what Vercel serves: `index.html` (one file), `safety.html`, `.well-known/security.txt`, icons, `manifest.webmanifest`
- `dist/agent-quest.html` (one file that opens on its own) and `dist/artifact.html`

For development, open `index.html` directly (or run `start.bat` / `start-server.ps1` to serve it from `http://localhost`,
which wallets need).

Tests use Playwright (Chromium), viem and `@flop-labs/tclk` as dev dependencies:

```bash
npm ci
npm test               # build, then the main checks one by one (tools/run-tests.mjs)
node tools/run-tests.mjs shot-safety   # run only matching tests
```

If Playwright cannot find its browser, set `CHROMIUM_PATH` to a Chromium binary. Screenshots go to `SHOT_DIR`
(default: the OS temp folder) or `tools/*.png` (ignored by git).

## Vercel

`vercel.json` runs `node build.js` with no install step and serves `deploy/`. It also sets security headers
(`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, a `frame-ancestors 'none'` CSP,
and a report-only CSP that lists every host the app talks to).

Environment variables (all optional):

| Name | What |
|---|---|
| `AQ_RPC_URL` | your own Base RPC endpoint (for example Alchemy). Falls back to `https://mainnet.base.org`. Keep it out of git (`rpc-url.txt` is ignored) |
| `AQ_SITE_URL` | the public URL, for `og:image`, `canonical` and `security.txt` (`site-url.txt` also works) |
| `AQ_BASE_APP_ID` | your Base Dashboard App ID, written as `<meta name="base:app_id">` (`base-app-id.txt` also works) |

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Komainu.

## Security contact

Please open an issue: https://github.com/Komainu/agent-quest/issues (also in `/.well-known/security.txt`).

---

## 日本語

**Agent Quest** は、初心者向けの無料のドット絵の学習アプリです。自分のウォレットをつなぎ、Base に ERC-8004 の
エージェントを作って、13 のクエストでオンチェーンの AI エージェントのしくみを学びます。サーバーを持たない1ページだけのアプリです。

- ウォレットに頼むのは、ボタンを押したときだけです（接続・ERC-8004 公式の登録先への取引・x402 の支払いの署名）。
  署名や取引の前に、アプリの中で中身（何を頼むか・相手・上限と期限）を見せ、確認のボタンを押してからウォレットを呼びます
- トークンの使用許可（approve・permit・setApprovalForAll）、自前のコントラクト、シードフレーズや秘密鍵の入力、開発者への送金は、どれもありません
- 組み立て：`node build.js`。テスト：`npm ci` のあと `npm test`
- Vercel の環境変数：`AQ_RPC_URL`（自分用の Base の窓口）・`AQ_SITE_URL`（公開先の URL）・`AQ_BASE_APP_ID`（Base Dashboard の App ID）
- 詳しくは [安全について](https://agent-quest-lilac.vercel.app/safety.html) を見てください
- ライセンス：MIT です（[LICENSE](LICENSE)・著作権者 Komainu・2026 年）
