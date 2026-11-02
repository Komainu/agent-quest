/* =============================================================
   build.js — 1ファイルにまとめる（配布・デモ用）
   -------------------------------------------------------------
   使い方:  node build.js
   出力:
     dist/agent-quest.html … 単体で開ける完全なHTML（配布用）
     dist/artifact.html    … Artifact 公開用（doctype/head/body なし）

   開発中は index.html をそのまま開けばよく、build は配る直前だけ。
   ============================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* index.html に書いてある順番をそのまま使う（順番の正が1か所で済む） */
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const cssFile = (html.match(/<link rel="stylesheet" href="(css\/[^"]+)"/) || [])[1];

const css = fs.readFileSync(path.join(ROOT, cssFile), 'utf8');
const js = scripts.map(f => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  return `/* ===== ${f} ===== */\n${src}`;
}).join('\n');

/* ★ 2026-10-23 自分用の Base の窓口（Alchemy など）。ルートの rpc-url.txt に1行あれば、配布用ファイルにだけ入れる
   （src/config.js の rpcUrl。手元の作業ファイルには鍵を書かない） */
let rpcUrl = '';
try { rpcUrl = fs.readFileSync(path.join(ROOT, 'rpc-url.txt'), 'utf8').trim(); } catch (e) {}
/* ★ 2026-11-02 Vercel などで組み立てるときは、環境変数 AQ_RPC_URL でも渡せる（鍵を GitHub に置かないため） */
if (!rpcUrl && process.env.AQ_RPC_URL) rpcUrl = String(process.env.AQ_RPC_URL).trim();
if (rpcUrl && !/^https:\/\/[^\s"'<>]+$/.test(rpcUrl)) { console.log('  ✗ rpc-url.txt が https:// で始まる1行ではないので、使いません'); rpcUrl = ''; }
const jsAll = rpcUrl ? js.replace('/* ===== src/rpc.js =====', 'AQ.config.rpcUrl = ' + JSON.stringify(rpcUrl) + ';\n/* ===== src/rpc.js =====') : js;

/* index.html から本体（main 要素）だけ取り出す */
const bodyInner = html.split('<main class="wrap">')[1].split('</main>')[0];

const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&family=IBM+Plex+Mono:wght@400;600&family=Press+Start+2P&display=swap">';

const title = (html.match(/<title>([^<]+)<\/title>/) || [, 'Agent Quest'])[1];

/* ★ 2026-10-23 アイコン（assets/ のドット絵：仕事札「x402」を掲げるロボット）。
   1ファイルで配っても出るよう、タブのアイコンは data: で埋め込む */
const asset = (f) => { try { return fs.readFileSync(path.join(ROOT, 'assets', f)); } catch (e) { return null; } };
const dataPng = (f) => { const b = asset(f); return b ? 'data:image/png;base64,' + b.toString('base64') : ''; };
const icons = [
  dataPng('icon-32.png') && `<link rel="icon" type="image/png" sizes="32x32" href="${dataPng('icon-32.png')}">`,
  dataPng('icon-64.png') && `<link rel="icon" type="image/png" sizes="64x64" href="${dataPng('icon-64.png')}">`
].filter(Boolean).join('\n');

const inner = `<title>${title}</title>
${icons}
${fonts}
<style>
${css}
</style>
<main class="wrap">${bodyInner}</main>
<script>
${jsAll}
</script>`;

const HEAD_LINES = 2 + (icons ? icons.split('\n').length : 0);   // title・アイコン・フォント までが head
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

fs.writeFileSync(path.join(ROOT, 'dist', 'artifact.html'), inner);

fs.writeFileSync(path.join(ROOT, 'dist', 'agent-quest.html'),
`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${inner.split('\n').slice(0, HEAD_LINES).join('\n')}
</head>
<body>
${inner.split('\n').slice(HEAD_LINES).join('\n')}
</body>
</html>`);

console.log('built:');
console.log('  dist/agent-quest.html');
console.log('  dist/artifact.html');
console.log('  scripts inlined:', scripts.length);
console.log('  Base の窓口: ' + (rpcUrl ? '自分用（rpc-url.txt）→ だめなら mainnet.base.org' : 'mainnet.base.org（自分用の窓口は rpc-url.txt に書くと入ります）'));

/* ★ 2026-10-09: 公開用（Base Dashboard に登録するため）。
   deploy/index.html … ホスティング（Vercel・Netlify など）にそのまま置く1ファイル。
   ルートに base-app-id.txt（Base Dashboard の App ID を1行だけ書く）があれば、
   Base が持ち主の確認に使う <meta name="base:app_id"> を head に入れる。 */
{
  let appId = '';
  try { appId = fs.readFileSync(path.join(ROOT, 'base-app-id.txt'), 'utf8').trim(); } catch (e) {}
  if (!appId && process.env.AQ_BASE_APP_ID) appId = String(process.env.AQ_BASE_APP_ID).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const metaApp = appId ? `<meta name="base:app_id" content="${esc(appId)}">\n` : '';
  /* ★ 2026-10-23 アイコンと共有用の画像。assets/ の画像を deploy/ にも置く（ホスティングにそのまま上げられる）。
     共有用の画像（og:image）は絶対 URL が要るので、ルートに site-url.txt（公開先の URL を1行）があるときだけ入れる */
  let siteUrl = '';
  try { siteUrl = fs.readFileSync(path.join(ROOT, 'site-url.txt'), 'utf8').trim().replace(/\/+$/, ''); } catch (e) {}
  if (!siteUrl && process.env.AQ_SITE_URL) siteUrl = String(process.env.AQ_SITE_URL).trim().replace(/\/+$/, '');
  fs.mkdirSync(path.join(ROOT, 'deploy'), { recursive: true });   // ★ 2026-11-02 まっさらな場所（Vercel など）でも先に作る
  ['icon-32.png', 'icon-64.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-1024.png', 'og-image.png'].forEach(f => {
    const b = asset(f); if (b) fs.writeFileSync(path.join(ROOT, 'deploy', f), b);
  });
  fs.writeFileSync(path.join(ROOT, 'deploy', 'manifest.webmanifest'), JSON.stringify({
    name: 'Agent Quest', short_name: 'Agent Quest', start_url: '.', display: 'standalone',
    background_color: '#16223a', theme_color: '#16223a',
    icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
  }, null, 2));
  const metaIcons = `<link rel="apple-touch-icon" sizes="180x180" href="icon-180.png">\n<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#16223a">\n`;
  /* ★ 2026-10-26 共有用の画像は、中身が変わったら URL も変わるように ?v=<中身の短い番号> を付ける
     （X や DeBank などは画像を URL ごとに覚えておくので、同じ URL のままだと古い画像が出つづける） */
  const ogBuf = asset('og-image.png');
  const ogV = ogBuf ? require('crypto').createHash('sha256').update(ogBuf).digest('hex').slice(0, 8) : '';
  const ogImg = siteUrl + '/og-image.png' + (ogV ? '?v=' + ogV : '');
  const metaShare = siteUrl
    ? `<meta property="og:url" content="${esc(siteUrl)}/">\n<meta property="og:image" content="${esc(ogImg)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${esc(ogImg)}">\n`
    : '';
  /* ★ 2026-11-02 説明は「無料の学習アプリ」「秘密鍵を求めない」がはっきり分かるように（審査する人・自動スキャン向け） */
  const desc = '無料の学習アプリ。13 のクエストで、はじめての AI エージェントを Base で動かします。シードフレーズや秘密鍵は求めません / A free learning app: build and run your first onchain AI agent on Base in 13 quests. It never asks for your recovery phrase or private key.';
  const metaCanon = siteUrl ? `<link rel="canonical" href="${esc(siteUrl)}/">\n` : '';
  fs.mkdirSync(path.join(ROOT, 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'deploy', 'index.html'),
`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${metaApp}${metaIcons}${metaShare}${metaCanon}<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="Agent Quest">
<meta property="og:description" content="${esc(desc)}">
${inner.split('\n').slice(0, HEAD_LINES).join('\n')}
</head>
<body>
${inner.split('\n').slice(HEAD_LINES).join('\n')}
</body>
</html>`);
  /* ★ 2026-11-02 安全についてのページ（src/pages/safety.html）と /.well-known/security.txt。
     連絡先はこのリポジトリの GitHub Issues（メールアドレスは入れない） */
  const REPO = 'https://github.com/Komainu/agent-quest';
  const safety = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'safety.html'), 'utf8')
    .replace('<!--CANONICAL-->', siteUrl ? `<link rel="canonical" href="${esc(siteUrl)}/safety.html">` : '');
  fs.writeFileSync(path.join(ROOT, 'deploy', 'safety.html'), safety);
  fs.writeFileSync(path.join(ROOT, 'dist', 'safety.html'), safety);
  const expires = new Date(Date.now() + 365 * 86400000);
  expires.setUTCHours(0, 0, 0, 0);
  fs.mkdirSync(path.join(ROOT, 'deploy', '.well-known'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'deploy', '.well-known', 'security.txt'),
    `Contact: ${REPO}/issues\n` +
    `Expires: ${expires.toISOString().replace('.000Z', 'Z')}\n` +
    `Preferred-Languages: ja, en\n` +
    (siteUrl ? `Canonical: ${siteUrl}/.well-known/security.txt\n` : ''));
  console.log('deploy/safety.html・deploy/.well-known/security.txt を書きました');
  console.log('deploy/index.html' + (appId ? '（base:app_id 入り）' : '（App ID 未設定：base-app-id.txt を置くと入ります）'));
  console.log('  アイコン・manifest.webmanifest を deploy/ に置きました' + (siteUrl ? '（共有用の画像 og:image 入り：' + siteUrl + '）' : '（共有用の画像は未設定：公開先の URL を site-url.txt に書くと入ります）'));
}
