/* tools/shot-safety.mjs — MetaMask の誤検知への対応の検査（2026-11-02）
   使い方: node tools/shot-safety.mjs   （node build.js を先に）
     1. ページを開いただけでは、ウォレットに接続・切り替え・署名・取引を頼まない（eth_accounts などの読み取りだけ）
     2. x402 の支払い先がお店ごとの一覧と違えば、確認も署名も頼まずに中止する
     3. ウォレットに頼む前の確認を通らないと、署名・取引を頼まない（やめたら何も頼まない）
     4. safety.html が日本語・英語で出る（英語の節にかなが無い）・始めの画面とページの下からリンクがある
     5. vercel.json が正しい JSON で、安全のための応答ヘッダがある。security.txt の連絡先は Issues
   ここでは確認を自動で押さない（tools/auto-confirm.mjs は使わない）。 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  const f = path.join(ROOT, 'deploy', u === '/' ? 'index.html' : u);
  if (!f.startsWith(path.join(ROOT, 'deploy')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; r.end('not found'); return; }
  r.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream'); r.end(fs.readFileSync(f));
});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/';
const OWNER = '0x1111111111111111111111111111111111111111';
const AGENT = { agentId: '4660', name: 'ピクセル', owner: OWNER, tx: '0x' + 'ab'.repeat(32), chain: 8453, t: Date.now() };
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NEWS_PAY_TO = '0x079471E6F43b6feeF80895E19cBFcBB496904852';
const NEWS_PAY_TO_LC = NEWS_PAY_TO.toLowerCase();
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

/** 偽のウォレット。頼まれたことを window.__calls に残す */
async function page0(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = [], shop = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((o) => {
    if (!sessionStorage.getItem('aq.t.init')) {
      localStorage.clear();
      if (o.agent) localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
      if (o.openBirth) sessionStorage.setItem('aq.openBirth', '1');
      sessionStorage.setItem('aq.t.init', '1');
    }
    const calls = window.__calls = [];
    const n64 = (n) => BigInt(n).toString(16).padStart(64, '0');
    let receiptTries = 0;
    const provider = { isMetaMask: true, on() {}, removeListener() {}, request: async ({ method, params }) => {
      calls.push(method);
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [o.owner];
        case 'eth_chainId': return '0x2105';
        case 'eth_getCode': return '0x60806040';
        case 'eth_call': return params[0].data.startsWith('0x70a08231') ? '0x' + n64(500000) : '0x';
        case 'eth_signTypedData_v4': (window.__signed = window.__signed || []).push(JSON.parse(params[1])); return '0x' + '12'.repeat(65);
        case 'eth_sendTransaction': return '0x' + 'ab'.repeat(32);
        case 'eth_getTransactionReceipt':
          if (receiptTries++ < 1) return null;
          return { status: '0x1', logs: [{ address: o.registry, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x' + '0'.repeat(64), '0x' + '0'.repeat(24) + o.owner.slice(2), '0x' + (4660).toString(16).padStart(64, '0')] }] };
        default: return null;
      }
    } };
    window.ethereum = provider;
    /* EIP-6963 で名乗るウォレットも1つ（名乗っただけで接続を頼まないかを見る） */
    window.addEventListener('eip6963:requestProvider', () => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: 'u-1', name: 'MetaMask', icon: 'data:image/png;base64,', rdns: 'io.metamask' }, provider }) }));
    });
  }, { agent: opts.agent || null, openBirth: !!opts.openBirth, owner: OWNER, registry: REGISTRY });
  const payTo = opts.payTo || NEWS_PAY_TO;
  await page.route('https://x402-seller-pmlm.onrender.com/**', async (route) => {
    const req = route.request(); const h = req.headers();
    if (new URL(req.url()).pathname === '/') return route.fulfill({ status: 200, body: 'ok' });   // 起こしておく呼び出し
    shop.push({ url: req.url(), sig: h['payment-signature'] || null });
    const acc = { scheme: 'exact', network: 'eip155:8453', amount: opts.amount || '5000', asset: opts.asset || USDC, payTo, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } };
    const pr = { x402Version: 2, error: 'Payment required', resource: { url: req.url(), description: 'News', mimeType: 'application/json' }, accepts: [acc] };
    const hdr = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'PAYMENT-REQUIRED', 'content-type': 'application/json', 'payment-required': Buffer.from(JSON.stringify(pr)).toString('base64') };
    if (!h['payment-signature']) return route.fulfill({ status: 402, headers: hdr, body: '{}' });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ count: 1, articles: [{ title: 'Base headline', url: 'https://example.com/a', source: 'X', publishedAt: null }] }) });
  });
  await page.route(/^https:\/\/(?!x402-seller-pmlm)/, r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"items":[],"messages":[]}' }));
  await page.goto(URL0);
  await page.waitForFunction(() => window.AQ && window.AQ.app && window.AQ.errand && window.AQ.confirm);
  return { page, errs, shop };
}
const calls = (page) => page.evaluate(() => window.__calls.slice());
const st = (page, id = 'robotStatus') => page.evaluate((id) => document.getElementById(id).innerText, id);
const SILENT = new Set(['eth_accounts', 'eth_chainId']);
const ASKS = ['eth_requestAccounts', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_signTypedData_v4', 'eth_sendTransaction', 'personal_sign', 'wallet_sendCalls', 'wallet_requestPermissions'];

console.log('\n[1. ページを開いただけでは、ウォレットに頼まない]');
for (const [label, opts] of [['エージェントが無い', {}], ['エージェントがある', { agent: AGENT }], ['読み込み直しで作る窓を開く', { openBirth: true }]]) {
  const { page, errs } = await page0(opts);
  await page.waitForTimeout(2500);
  if (opts.agent) { await page.click('#startBirth'); await page.waitForTimeout(800); }   // クエスト帳を開いても頼まない
  const c = await calls(page);
  ok(c.every(m => SILENT.has(m)), label + '：頼んだのは読み取りだけ（' + ([...new Set(c)].join(', ') || 'なし') + '）');
  ok(!c.some(m => ASKS.includes(m)), label + '：接続・切り替え・署名・取引は1つも頼まない');
  ok(errs.length === 0, label + '：JS のエラーなし' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[2. 支払い先が一覧と違えば、署名を頼まずに中止する]');
for (const [label, opts, re] of [
  ['受取先が違う', { payTo: '0x2222222222222222222222222222222222222222' }, /受取先/],
  ['お金の種類が違う', { asset: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' }, /USDC/],
  ['上限より高い', { amount: '20000' }, /0\.02 USDC/],
  ['上限をわずかに超える（10001）', { amount: '10001' }, /0\.010001 USDC/]]) {
  const { page, shop } = await page0({ agent: AGENT, ...opts });
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#robotErrandOpen');
  await page.click('#errandShops .robot-chip[data-key="news"]').catch(() => {});
  await page.click('#errandGo');
  await page.waitForFunction(() => /中止|動いていません|払えません|払わず/.test(document.getElementById('robotStatus').innerText), null, { timeout: 15000 }).catch(() => {});
  const c = await calls(page), s = await st(page);
  ok(!c.includes('eth_signTypedData_v4'), label + '：署名を頼まない');
  ok(!(await page.evaluate(() => AQ.confirm.isOpen())), label + '：確認の枠も出さない');
  ok(shop.length === 1 && !shop[0].sig, label + '：お店へは 402 をもらう1回だけ（署名付きでは頼まない）');
  ok(re.test(s) && /お金は動いていません|払わずに中止/.test(s), label + '：正直に知らせる（' + s.slice(0, 60) + '）');
  await page.close();
}

console.log('\n[2b. 金額は上限（0.01 USDC）以下なら、言い値が変わっても買える]');
for (const [amount, price] of [['4000', '0.004'], ['10000', '0.01']]) {
  const { page, shop } = await page0({ agent: AGENT, amount });
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#robotErrandOpen');
  await page.click('#errandShops .robot-chip[data-key="news"]').catch(() => {});
  await page.click('#errandGo');
  await page.waitForSelector('.wallet-confirm', { timeout: 15000 }).catch(() => {});
  const box = await page.evaluate(() => (document.querySelector('.wallet-confirm') || {}).innerText || '');
  ok(new RegExp('ニュースのお店に ' + price.replace('.', '\\.') + ' USDC を1回だけ払う署名').test(box), amount + '：確認の枠には、お店の言い値（' + price + ' USDC）をそのまま出す');
  await page.click('.wallet-confirm-ok').catch(() => {});
  await page.waitForFunction(() => /お使い成功|うまく|中止|受け取/.test(document.getElementById('robotStatus').innerText), null, { timeout: 15000 }).catch(() => {});
  const signed = await page.evaluate(() => window.__signed || []);
  ok(signed.length === 1 && signed[0].message.value === amount && signed[0].message.to.toLowerCase() === NEWS_PAY_TO_LC, amount + '：署名する金額は言い値どおり（' + (signed[0] ? signed[0].message.value : 'なし') + '）');
  ok(shop.filter(x => x.sig).length === 1, amount + '：署名を付けて1回だけ頼む');
  await page.close();
}
{
  const { page } = await page0({ agent: AGENT });
  const v = await page.evaluate(() => {
    const pr = (n) => (Number(n) / 1e6).toString();
    const out = { max: pr(AQ.errand._allow.news.maxAmount), texts: {} };
    for (const l of ['ja', 'en']) { AQ.i18n.set(l); out.texts[l] = ['errand.lead.news', 'errand.pick.news.sub', 'errand.go.news', 'quest.cost.usdc', 'quest.news.what'].map(k => AQ.i18n.t(k)); }
    AQ.i18n.set('ja');
    return out;
  });
  const all = [...v.texts.ja, ...v.texts.en];
  ok(v.max === '0.01' && all.every(s => s.includes('0.01 USDC')), '画面の説明の「0.01 USDC まで」は、コードの上限（' + v.max + ' USDC）と同じ');
  ok(!all.some(s => /0\.005/.test(s)), '画面の説明に、変わりうる言い値（0.005 など）を固定で書かない');
  ok(v.texts.ja.every(s => /まで/.test(s)) && v.texts.en.every(s => /up to/.test(s)), '日本語は「まで」、英語は「up to」で、上限だと分かる書き方');
  await page.close();
}

console.log('\n[3. 確認を通らないと、ウォレットに頼まない]');
{
  const { page, shop } = await page0({ agent: AGENT });
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#robotErrandOpen');
  await page.click('#errandShops .robot-chip[data-key="news"]').catch(() => {});
  await page.click('#errandGo');
  await page.waitForSelector('.wallet-confirm', { timeout: 15000 }).catch(() => {});
  const box = await page.evaluate(() => { const b = document.querySelector('.wallet-confirm'); return b ? { t: b.innerText, links: [...b.querySelectorAll('a')].map(a => a.href) } : null; });
  ok(!!box, '署名の前に、アプリの中で確認の枠を出す');
  ok(box && /ニュースのお店に 0\.005 USDC を1回だけ払う署名/.test(box.t), '何を頼むか（' + (box ? box.t.split('\n')[1] : '') + '）');
  ok(box && /0x0794…4852/.test(box.t) && box.links.includes('https://basescan.org/address/' + NEWS_PAY_TO), '相手は短いアドレスと Basescan へのリンク');
  ok(box && /上限/.test(box.t) && /0\.005 USDC/.test(box.t) && /期限/.test(box.t) && /300 秒/.test(box.t), '上限と期限');
  let c = await calls(page);
  ok(!c.includes('eth_signTypedData_v4'), '確認の枠が出ているあいだは、署名を頼まない');
  await page.click('.wallet-confirm-no');
  await page.waitForTimeout(300);
  c = await calls(page);
  ok(!c.includes('eth_signTypedData_v4') && shop.filter(x => x.sig).length === 0, '「やめる」を押すと、署名もお店への支払いもしない');
  ok(/やめました/.test(await st(page)), '「やめました」と知らせる（' + (await st(page)) + '）');
  await page.click('#errandGo');
  await page.waitForSelector('.wallet-confirm-ok', { timeout: 15000 }).catch(() => {});
  ok(!(await calls(page)).includes('eth_signTypedData_v4'), 'もう一度押しても、確認までは署名を頼まない');
  await page.click('.wallet-confirm-ok');
  await page.waitForFunction(() => window.__calls.includes('eth_signTypedData_v4'), null, { timeout: 5000 }).catch(() => {});
  c = await calls(page);
  ok(c.filter(m => m === 'eth_signTypedData_v4').length === 1, '「ウォレットで確かめる」を押してから、署名を1回だけ頼む');
  await page.close();
}
{
  const { page } = await page0({});
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#birthConnect'); await page.waitForTimeout(200);
  await page.fill('#birthName', 'ピクセル');
  await page.click('#birthGo');
  await page.waitForSelector('#birthScreen .wallet-confirm', { timeout: 10000 }).catch(() => {});
  const t1 = await page.evaluate(() => (document.querySelector('#birthScreen .wallet-confirm') || {}).innerText || '');
  ok(/エージェント「ピクセル」を登録する取引/.test(t1) && /IdentityRegistry 0x8004…a432/.test(t1) && /ガス代だけ/.test(t1), 'エージェントの登録も、取引の前に中身を見せる（' + t1.split('\n')[1] + '）');
  ok(!(await calls(page)).includes('eth_sendTransaction'), '確認を押すまでは取引を頼まない');
  await page.click('#birthScreen .wallet-confirm-ok');
  await page.waitForFunction(() => window.__calls.includes('eth_sendTransaction'), null, { timeout: 5000 }).catch(() => {});
  ok((await calls(page)).includes('eth_sendTransaction'), '押したら取引を頼む');
  await page.close();
}
{
  const { page } = await page0({});
  await page.evaluate(() => { localStorage.setItem('aq.lang', 'en'); });
  await page.reload(); await page.waitForFunction(() => window.AQ && window.AQ.app && window.AQ.confirm);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#birthConnect'); await page.waitForTimeout(200);
  await page.fill('#birthName', 'Pixel');
  await page.click('#birthGo');
  await page.waitForSelector('#birthScreen .wallet-confirm', { timeout: 10000 }).catch(() => {});
  const t2 = await page.evaluate(() => (document.querySelector('#birthScreen .wallet-confirm') || {}).innerText || '');
  ok(/registers the agent "Pixel" on Base/.test(t2) && !/[぀-ヿ一-鿿]/.test(t2), '英語の表示では、確認の枠も英語だけ（' + t2.split('\n')[1] + '）');
  await page.click('#birthScreen .wallet-confirm-no');
  await page.waitForTimeout(200);
  ok(!(await calls(page)).includes('eth_sendTransaction') && /Stopped/.test(await st(page, 'birthStatus')), '「Stop」なら取引を頼まない');
  await page.close();
}

console.log('\n[4. 安全についてのページ]');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL0 + 'safety.html?lang=ja');
  const ja = await page.evaluate(() => ({ lang: document.documentElement.lang, vis: document.getElementById('ja').hidden ? '' : document.getElementById('ja').innerText, enHidden: document.getElementById('en').hidden, title: document.title, wide: document.documentElement.scrollWidth }));
  ok(ja.lang === 'ja' && ja.enHidden && /安全について/.test(ja.title), '?lang=ja で日本語の節だけを出す');
  for (const a of ['0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'])
    ok(ja.vis.includes(a), '使うコントラクト ' + a.slice(0, 8) + '… が載っている');
  ok(/approve/.test(ja.vis) && /permit/.test(ja.vis) && /setApprovalForAll/.test(ja.vis) && /秘密鍵/.test(ja.vis) && /開発者へお金を送ることはありません/.test(ja.vis), '「しないこと」が載っている');
  ok(await page.evaluate(() => [...document.querySelectorAll('#ja a')].some(a => a.href === 'https://github.com/Komainu/agent-quest')), 'このリポジトリへのリンクがある');
  ok(ja.wide <= 390, 'スマホの幅でも横にはみ出さない（' + ja.wide + 'px）');
  await page.click('.lang button[data-l="en"]');
  const en = await page.evaluate(() => ({ lang: document.documentElement.lang, vis: document.getElementById('en').innerText, jaHidden: document.getElementById('ja').hidden, saved: localStorage.getItem('aq.lang') }));
  ok(en.lang === 'en' && en.jaHidden && /What it never asks for/.test(en.vis), '切り替えると英語の節だけを出す');
  ok(!/[぀-ヿ一-鿿]/.test(en.vis), '英語の節には、かな・漢字が無い');
  ok(en.saved === 'en', '選んだ言語はアプリと同じ場所（aq.lang）に覚える');
  await page.goto(URL0 + 'safety.html?lang=en');
  ok(await page.evaluate(() => !document.getElementById('en').hidden && document.getElementById('ja').hidden), '?lang=en で英語の節を出す');
  ok(errs.length === 0, 'JS のエラーなし');
  await page.close();
}
{
  const { page } = await page0({});
  const l = await page.evaluate(() => ({
    start: [document.getElementById('startSafety').getAttribute('href'), document.getElementById('startSafety').innerText, !document.getElementById('startScreen').hidden],
    foot: [document.getElementById('footSafety').getAttribute('href'), document.getElementById('footSafety').innerText],
    gh: document.getElementById('footGithub').href }));
  ok(l.start[0] === 'safety.html' && /ウォレットに頼むこと/.test(l.start[1]) && l.start[2], '始めの画面に、安全についてのページへの小さなリンク（' + l.start[1] + '）');
  ok(l.foot[0] === 'safety.html' && l.foot[1] === '安全について' && l.gh === 'https://github.com/Komainu/agent-quest', 'ページの下に、安全について・GitHub へのリンク');
  const head = await page.evaluate(() => ({ title: document.title, desc: (document.querySelector('meta[name="description"]') || {}).content || '', canon: (document.querySelector('link[rel="canonical"]') || {}).href || null }));
  ok(/Agent Quest/.test(head.title) && /学習アプリ/.test(head.desc) && /learning app/.test(head.desc), 'title と description（学習アプリだと分かる）');
  ok(head.canon === null || /^https:\/\/[^/]+\/$/.test(head.canon), 'canonical は公開先の URL（site-url.txt / AQ_SITE_URL があるとき）');
  await page.close();
}

console.log('\n[5. 応答ヘッダ（vercel.json）と security.txt]');
{
  let v = null; try { v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')); } catch (e) {}
  ok(!!v, 'vercel.json は正しい JSON');
  ok(v && v.installCommand === 'echo skip-install' && v.buildCommand === 'node build.js' && v.outputDirectory === 'deploy', 'build の設定はそのまま（依存を入れない）');
  const all = ((v && v.headers) || []).find(h => h.source === '/(.*)');
  const H = Object.fromEntries(((all && all.headers) || []).map(h => [h.key.toLowerCase(), h.value]));
  ok(H['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff');
  ok(H['referrer-policy'] === 'strict-origin-when-cross-origin', 'Referrer-Policy: strict-origin-when-cross-origin');
  ok(H['x-frame-options'] === 'DENY', 'X-Frame-Options: DENY');
  ok(/frame-ancestors 'none'/.test(H['content-security-policy'] || ''), "CSP の frame-ancestors 'none'（ほかのサイトの枠に入れさせない）");
  ok(/camera=\(\)/.test(H['permissions-policy'] || '') && /microphone=\(\)/.test(H['permissions-policy'] || '') && /geolocation=\(\)/.test(H['permissions-policy'] || ''), 'Permissions-Policy で使わない機能を止める');
  const ro = H['content-security-policy-report-only'] || '';
  const cs = ((ro.match(/connect-src ([^;]+)/) || [])[1] || '').split(/\s+/);
  /* アプリが通信する相手（src/ の中で fetch する宛先） */
  const need = ['https://technocore.chat', 'https://kibble.world', 'https://mainnet.base.org', 'https://base.blockscout.com', 'https://eth.blockscout.com', 'https://optimism.blockscout.com',
                'https://x402-seller-pmlm.onrender.com', 'https://pro-api.coingecko.com', 'https://ipfs.io'];
  ok(need.every(h => cs.includes(h)), 'connect-src に、アプリが通信する相手がそろっている（' + need.filter(h => !cs.includes(h)).join(', ') + '）');
  ok(!cs.includes('*') && !cs.includes('https:'), 'connect-src は「どこでも」にしない');
  ok(/script-src 'self' 'unsafe-inline'/.test(ro), "1ページの中のスクリプトなので script-src 'unsafe-inline'");
  const src = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(ROOT, 'data', 'chains.js'), 'utf8');
  const hosts = [...new Set([...src.matchAll(/(?:BASE|KIBBLE|api|rpc|resource)\s*[:=]\s*'(https:\/\/[^/']+)/g)].map(m => m[1]))];
  ok(hosts.length >= 6 && hosts.every(h => cs.includes(h)), 'src/ に書いてある通信先はすべて connect-src に入っている（' + hosts.filter(h => !cs.includes(h)).join(', ') + '）');
  const sec = fs.readFileSync(path.join(ROOT, 'deploy', '.well-known', 'security.txt'), 'utf8');
  ok(/^Contact: https:\/\/github\.com\/Komainu\/agent-quest\/issues$/m.test(sec) && /^Expires: \d{4}-\d\d-\d\dT/m.test(sec), 'security.txt の連絡先は GitHub Issues、期限つき');
  ok(!/@/.test(sec), 'security.txt にメールアドレスを入れない');
}

await browser.close(); server.close();
console.log(bad ? `\n✗ ${bad} 件` : '\n✓ すべて OK');
process.exit(bad ? 1 : 0);
