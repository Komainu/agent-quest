/* tools/shot-errand.mjs — 「x402 でお使い」「身分証を育てる」の検査（2026-10-11）
   使い方: node tools/shot-errand.mjs   （dist/agent-quest.html を先に build）

   本物の財布・お店・チェーンは使わない。
     ・ブラウザの「財布」は、Node 側の本物の鍵（テスト用）で EIP-712 に署名する
     ・お店（CoinGecko）への通信を横取りし、届いた PAYMENT-SIGNATURE を
       ファシリテータと同じやり方（viem の verifyTypedData）で確かめる
         - x402 v2 の形（x402Version / accepted / payload.authorization / signature）
         - accepted が Bazaar の支払い条件と同じか
         - 署名が from の鍵のものか（USDC の EIP-712：name "USD Coin" / version "2" / chainId 8453）
         - 期限（validBefore）が 60 秒以内、金額 10000（0.01 USDC）、受取先
     ・身分証の書き換えは、送られた data が setAgentURI(番号, data:…base64) になっているか
       と、中身が EIP-8004 の登録ファイルの形か */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire('/tmp/claude-0/-home-claude/771479e9-d120-5f80-8905-16d478e5aced/scratchpad/k/');
const { privateKeyToAccount } = require('viem/accounts');
const { verifyTypedData } = require('viem');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'dist', 'agent-quest.html'))); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/';
const KEY = '0x' + '11'.repeat(32);
const ACC = privateKeyToAccount(KEY);
const OWNER = ACC.address.toLowerCase();
const AGENT = { agentId: '4660', name: 'ピクセル', owner: OWNER, tx: '0x' + 'ab'.repeat(32), chain: 8453, t: Date.now() };
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const TX_PAY = '0x' + 'cd'.repeat(32), TX_CARD = '0x' + 'ef'.repeat(32);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function setup(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [], shop = [], sent = [];
  let lastUri = null;
  page.on('pageerror', e => errs.push(e.message));
  await page.exposeFunction('__signTyped', async (json) => {
    const td = JSON.parse(json); const { EIP712Domain, ...types } = td.types;
    return ACC.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
  });
  await page.exposeFunction('__sent', (tx) => { sent.push(tx); });
  await page.addInitScript((o) => {
    localStorage.clear();
    localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
    localStorage.setItem('aq.myAgent.key', JSON.stringify({ d: 'x', x: 'y', did: 'did:key:z6MkRobotKeyAbcdefghijkmnopqrstuvwxyz12345' }));
    let uri = 'data:application/json;base64,e30';
    const n64 = (n) => BigInt(n).toString(16).padStart(64, '0');
    const enc = (s) => { const h = [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join(''); return '0x' + n64(32) + n64(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0'); };
    window.ethereum = { request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [o.owner];
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_call') {
        const d = params[0].data;
        if (d.startsWith('0x70a08231')) return '0x' + n64(o.balance);                 // USDC balanceOf
        if (d.startsWith('0x6352211e')) return '0x' + n64(BigInt(o.chainOwner));        // ownerOf
        if (d.startsWith('0xc87b56dd')) return enc(uri);                                 // tokenURI
        return '0x';
      }
      if (method === 'eth_signTypedData_v4') { if (o.reject) { const e = new Error('User rejected'); e.code = 4001; throw e; } return window.__signTyped(params[1]); }
      if (method === 'eth_sendTransaction') {
        await window.__sent(params[0]);
        const h = params[0].data.slice(10); const len = parseInt(h.slice(128, 192), 16);
        const bytes = h.slice(192, 192 + len * 2); uri = new TextDecoder().decode(new Uint8Array(bytes.match(/../g).map(x => parseInt(x, 16))));
        return o.txCard;
      }
      if (method === 'eth_getTransactionReceipt') return { status: '0x1', logs: [{ address: o.registry,
        topics: ['0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb', '0x' + n64(o.agent.agentId), '0x' + n64(BigInt(o.owner))] }] };
      return null;
    } };
  }, { agent: AGENT, owner: OWNER, balance: opts.balance != null ? opts.balance : 500000, chainOwner: opts.chainOwner || OWNER,
       reject: !!opts.reject, txCard: TX_CARD, registry: REGISTRY });
  await page.route('https://pro-api.coingecko.com/**', async (route) => {
    const req = route.request(); const h = req.headers();
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    const sig = h['payment-signature'];
    shop.push({ url: req.url(), sig });
    if (!sig) return route.fulfill({ status: opts.no402 ? 200 : 402, headers: cors, body: JSON.stringify({ error: 'Payment required' }) });
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ data: [{ id: 'base_0xpool', type: 'pool', attributes: { name: 'WETH / USDC 0.05%', base_token_price_usd: '3123.456' }, relationships: { dex: { data: { id: 'uniswap-v3-base' } } } }] }) });
  });
  const NEWS_REQ = { scheme: 'exact', network: 'eip155:8453', amount: '5000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: '0x079471E6F43b6feeF80895E19cBFcBB496904852', maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } };
  await page.route('https://x402-seller-pmlm.onrender.com/**', async (route) => {
    const req = route.request(); const h = req.headers();
    shop.push({ url: req.url(), sig: h['payment-signature'] });
    const pr = { x402Version: 2, error: 'Payment required', resource: { url: req.url(), description: 'News', mimeType: 'application/json' },
      accepts: [{ ...NEWS_REQ, network: 'eip155:137', asset: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' }, NEWS_REQ] };
    const hdr = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'PAYMENT-REQUIRED', 'content-type': 'application/json', 'payment-required': Buffer.from(JSON.stringify(pr)).toString('base64') };
    if (!h['payment-signature']) return route.fulfill({ status: 402, headers: hdr, body: '{}' });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ count: 2, articles: [
      { title: 'Base hits record <script>alert(1)</script> activity', url: 'https://example.com/a', source: 'Decrypt', publishedAt: new Date().toISOString() },
      { title: 'Second headline', url: 'javascript:alert(1)', source: 'X', publishedAt: null } ] }) });
  });
  await page.route('https://base.blockscout.com/**', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
    body: JSON.stringify({ items: opts.noChain ? [] : [
      { from: { hash: ACC.address }, to: { hash: '0x110cdBba7FE6434Ec4CE3464CC523942ad6Fb784' }, token: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC' },
        total: { value: '10000', decimals: '6' }, timestamp: new Date(Date.now() + 500).toISOString(), transaction_hash: TX_PAY, method: 'transferWithAuthorization' },
      { from: { hash: ACC.address }, to: { hash: '0x079471E6F43b6feeF80895E19cBFcBB496904852' }, token: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC' },
        total: { value: '5000', decimals: '6' }, timestamp: new Date(Date.now() + 500).toISOString(), transaction_hash: '0x' + '9a'.repeat(32), method: 'transferWithAuthorization' }] }) }));
  await page.route('https://technocore.chat/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{"messages":[]}' }));
  await page.route('https://kibble.world/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await page.goto(URL0);
  await page.waitForFunction(() => window.AQ && window.AQ.app && window.AQ.errand);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  return { page, errs, shop, sent };
}
const st = (page) => page.evaluate(() => document.getElementById('robotStatus').innerText);

console.log('\n[x402 でお使い]');
{
  const { page, errs, shop } = await setup();
  await page.click('#robotErrandOpen'); await page.click('#errandShops .robot-chip[data-key="price"]');
  const ch = await page.evaluate(() => [...document.querySelectorAll('#errandChoices .robot-choice')].map(b => b.dataset.key + ':' + b.innerText.replace(/\n/g, ' / ')));
  ok(ch.length === 4 && /0\.01 USDC/.test(ch[0]), '選択肢は3つ＋自分で選ぶ、値段（0.01 USDC）も出る（' + ch.map(c => c.split(' / ')[0]).join('、') + '）');
  await page.click('#errandGo');
  await page.waitForFunction(() => /お使い成功/.test(document.getElementById('robotStatus').innerText) || /うまく|受け取り|足り/.test(document.getElementById('robotStatus').innerText), null, { timeout: 15000 }).catch(() => {});
  ok(/お使い成功/.test(await st(page)) && /Base の記録でも確かめました/.test(await st(page)), '成功と、Base の記録で支払いを確かめたことを言う（' + (await st(page)).slice(0, 40) + '）');
  ok(shop.length === 2 && !shop[0].sig && !!shop[1].sig, 'お店へは2回：1回目は払わずに（402 を受け取る）、2回目に署名を付けて');
  ok(/onchain\/search\/pools\?query=weth&network=base/.test(shop[0].url), '頼む中身は「Base の weth の取引所」（' + shop[0].url.split('?')[1] + '）');
  const p = JSON.parse(Buffer.from(shop[1].sig || 'e30=', 'base64').toString('utf8'));
  ok(p.x402Version === 2 && p.accepted && p.payload && p.payload.authorization && p.payload.signature, 'PAYMENT-SIGNATURE は x402 v2 の形（x402Version / accepted / payload）');
  const REQ = { scheme: 'exact', network: 'eip155:8453', amount: '10000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: '0x110cdBba7FE6434Ec4CE3464CC523942ad6Fb784', maxTimeoutSeconds: 60, extra: { name: 'USD Coin', version: '2' } };
  ok(JSON.stringify(p.accepted) === JSON.stringify(REQ), 'accepted は Bazaar に出ている CoinGecko の支払い条件と同じ');
  const a = p.payload.authorization || {};
  const now = Math.floor(Date.now() / 1000);
  ok(a.from === OWNER && a.to === REQ.payTo && a.value === '10000' && a.validAfter === '0' && Number(a.validBefore) > now && Number(a.validBefore) <= now + 61 && /^0x[0-9a-f]{64}$/.test(a.nonce),
     '許可の中身：ロボットの財布 → お店、0.01 USDC、期限 60 秒以内、32バイトの乱数');
  let valid = false;
  try {
    valid = await verifyTypedData({ address: a.from, domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: REQ.asset },
      types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
      primaryType: 'TransferWithAuthorization', message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce }, signature: p.payload.signature });
  } catch (e) { valid = 'ERR ' + e.message; }
  ok(valid === true, '署名は、ファシリテータと同じ確かめ方（EIP-712 / USDC の EIP-3009）で本物（' + valid + '）');
  const res = await page.evaluate(() => document.getElementById('errandResult').innerText);
  ok(/\$3,123\.46/.test(res) && /WETH \/ USDC/.test(res) && /支払いの取引を見る/.test(res), '買ってきた値段と取引所、支払いの取引へのリンクが出る');
  /* 街で見る */
  await page.click('#errandResult .go'); await page.waitForTimeout(1200);
  const town = await page.evaluate(() => ({ types: AQ.app.events.map(e => e.type), actors: [...new Set(AQ.app.events.map(e => String(e.actor)))], stage: document.getElementById('scene').dataset.stage,
    settled: AQ.app.events.find(e => e.type === 'payment.settled'), label: AQ.nick.forActor(AQ.app.events[0].actor) }));
  ok(town.types.join(',') === 'run.start,tool.call,payment.required,result.error,payment.sent,payment.settled,result.ok,run.end', '街の場面は実際に起きた順（頼む→402→署名して頼みなおす→確定→受け取る）');
  ok(town.settled && town.settled.tx === TX_PAY && town.settled.meta.tSource === 'chain' && town.settled.meta.method === 'transferWithAuthorization', '確定のコマは、チェーンで見つけた取引（立会人が載せた transferWithAuthorization）');
  ok(town.stage === 'city' && town.actors.length === 1 && town.label === 'ピクセル #4660', '街で、自分のロボットだけが「ピクセル #4660」として出る');
  const kinds = await page.evaluate(() => AQ.app.clock.beats.map(b => b.kind));
  console.log('    beats:', kinds.join(','));
  for (const [i, nm] of [[2, 'a'], [4, 'b'], [5, 'c']]) {
    await page.evaluate((i) => { const c = AQ.app.clock; c.pause(); c.seek(Math.min(i, c.beats.length - 1)); c.elapsed = c.durationOf(c.index) * 0.7; c.onFrame(); }, i);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-errand-town-' + nm + '.png') });
  }
  const shopName = await page.evaluate(() => { const w = AQ.world || AQ.WORLD || {}; return ((w.objects || []).find(o => o.liveLabel) || {}).liveLabel || null; });
  ok(shopName === 'pro-api.coingecko.com', 'お店の看板は本物の相手先（' + shopName + '）。架空の看板のままにしない');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[x402 でお使い：ニュース（言い値をその場で 402 から読む）]');
{
  const { page, errs, shop } = await setup();
  await page.click('#robotErrandOpen');
  const on = await page.evaluate(() => ({ shop: (document.querySelector('#errandShops .robot-chip.on') || {}).dataset?.key, ch: [...document.querySelectorAll('#errandChoices .robot-choice b')].map(b => b.innerText) }));
  ok(on.shop === 'news' && on.ch.length === 4 && /Base の最新ニュース/.test(on.ch[0]), 'はじめはニュースのお店。選択肢は3つ＋自分で書く（' + on.ch.join('、') + '）');
  await page.click('#errandGo');
  await page.waitForFunction(() => /お使い成功|うまく|受け取り|足り|中止/.test(document.getElementById('robotStatus').innerText), null, { timeout: 15000 }).catch(() => {});
  ok(/お使い成功/.test(await st(page)), 'ニュースのお使いが成功（' + (await st(page)).slice(0, 30) + '）');
  const p = JSON.parse(Buffer.from((shop[1] || {}).sig || 'e30=', 'base64').toString('utf8'));
  ok(shop.length === 2 && /q=Base%20blockchain&limit=5&hours=48/.test(shop[0].url), '頼む中身：「Base blockchain」の48時間以内の見出し5本');
  ok(p.accepted && p.accepted.network === 'eip155:8453' && p.accepted.amount === '5000' && p.accepted.payTo === '0x079471E6F43b6feeF80895E19cBFcBB496904852', '402 の PAYMENT-REQUIRED から、Base の USDC で払える条件を選んで払う（Polygon は選ばない）');
  ok(p.resource && /onrender\.com\/news/.test(p.resource.url) && p.resource.description === 'News', 'resource も、お店が 402 で書いてきたものをそのまま返す（x402 v2 の手順どおり）');
  const a = p.payload.authorization;
  ok(a.value === '5000' && Number(a.validBefore) <= Math.floor(Date.now() / 1000) + 301, '許可の金額は 0.005 USDC、期限はお店の maxTimeoutSeconds（300秒）以内');
  const res = await page.evaluate(() => ({ t: document.getElementById('errandResult').innerText, links: [...document.querySelectorAll('#errandResult .errand-news a')].map(a => a.getAttribute('href')), scripts: document.querySelectorAll('#errandResult script').length }));
  ok(/Base hits record <script>alert\(1\)<\/script> activity/.test(res.t) && res.scripts === 0, '届いた見出しはただの文字として出す');
  ok(res.links.length === 1 && res.links[0] === 'https://example.com/a', 'リンクは https のものだけ（javascript: などは付けない）');
  ok(/0\.005 USDC/.test(res.t), '払った額（0.005 USDC）を出す');
  await page.click('#errandResult .go'); await page.waitForTimeout(800);
  const town = await page.evaluate(() => ({ stage: document.getElementById('scene').dataset.stage, settled: AQ.app.events.find(e => e.type === 'payment.settled'), amt: (AQ.app.events.find(e => e.type === 'payment.sent') || {}).amount }));
  ok(town.stage === 'city' && town.settled && town.amt && town.amt.value === '0.005', '街で、0.005 USDC の支払いとして再生する');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[ロボットの一日を街で見る]');
{
  const { page, errs } = await setup();
  await page.evaluate(() => {
    const now = Date.now();
    AQ.activity.add({ kind: 'post', t0: now - 60000, t1: now - 59000, room: 'kibble', text: 'JOB v1 | k0000000001 | explain | Explain x402 |', seq: 5 });
    AQ.activity.add({ kind: 'card', t0: now - 50000, t1: now - 40000, tx: '0x' + '12'.repeat(32) });
    AQ.activity.add({ kind: 'feedback', t0: now - 30000, t1: now - 20000, tx: '0x' + '34'.repeat(32), agentId: '99891', name: 'Vumpondo', stars: 4 });
    AQ.activity.add({ kind: 'mail-send', t0: now - 10000, t1: now - 9000, text: 'Hello!' });
  });
  await page.evaluate(() => AQ.birth.open()); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById('robotTown').hidden), '「ロボットの一日を街で見る」が出る');
  await page.click('#robotTown'); await page.waitForTimeout(900);
  const d = await page.evaluate(() => ({ stage: document.getElementById('scene').dataset.stage, targets: [...new Set(AQ.app.events.filter(e => e.target).map(e => e.target))], actors: [...new Set(AQ.app.events.map(e => String(e.actor)))], open: !document.getElementById('birthScreen').hidden }));
  ok(d.stage === 'city' && !d.open, '街の場面で再生する（掲示板だけの行動も街で）');
  ok(d.targets.join(' | ') === 'https://technocore.chat/r/kibble | ERC-8004 Identity | ERC-8004 Reputation | https://technocore.chat/r/mailbox', '行き先：掲示板 → 身分証の登録先 → 評判の登録先 → 郵便受け（部屋名は出さない）');
  ok(d.actors.length === 1, '出るのは自分のロボットだけ');
  const labels = await page.evaluate(() => (AQ.world.objects || []).filter(o => o.liveLabel).map(o => o.liveLabel));
  ok(labels.includes('ERC-8004 Identity') && labels.includes('ERC-8004 Reputation'), '登録先の建物の看板は本物の名前（' + labels.join(' / ') + '）');
  const says = [];
  for (const [i, nm] of [[1, 'p'], [3, 'a'], [4, 'a2'], [5, 'b']]) {
    await page.evaluate((i) => { const c = AQ.app.clock; c.pause(); c.seek(Math.min(i, c.beats.length - 1)); c.elapsed = c.durationOf(c.index) * 0.8; c.onFrame(); }, i);
    await page.waitForTimeout(400);
    /* ★ 2026-10-18 説明の窓の1行目は「動き i / n」になった。その次の行が説明 */
    says.push(await page.evaluate(() => document.getElementById('cmdWinBody').innerText.split('\n').filter(x => x.trim() && !/^(動き|step) \d+ \/ \d+/.test(x.trim()))[0] || ''));
    await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-day-' + nm + '.png') });
  }
  console.log('    says:', says.join(' / '));
  ok(!says.some(x => /これをください/.test(x)) && says.some(x => /身分証/.test(x)), '説明は実際にしたこと（書き込み・身分証・評価）で、「これをください」とは言わない');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[お使い：うまくいかないとき]');
{
  let s = await setup({ balance: 5000 });
  await s.page.click('#robotErrandOpen'); await s.page.click('#errandShops .robot-chip[data-key="price"]'); await s.page.click('#errandGo'); await s.page.waitForTimeout(800);
  ok(/足りません/.test(await st(s.page)) && s.shop.length === 1 && !s.shop[0].sig, 'USDC が足りなければ、言い値を聞いたところで止める（署名は求めない）');
  await s.page.close();
  s = await setup({ reject: true });
  await s.page.click('#robotErrandOpen'); await s.page.click('#errandShops .robot-chip[data-key="price"]'); await s.page.click('#errandGo'); await s.page.waitForTimeout(1200);
  ok(/取り消されました/.test(await st(s.page)) && s.shop.length === 1, 'MetaMask で取り消したら、お金は動かず、2回目は頼まない');
  await s.page.close();
  s = await setup({ no402: true });
  await s.page.click('#robotErrandOpen'); await s.page.click('#errandShops .robot-chip[data-key="price"]'); await s.page.click('#errandGo'); await s.page.waitForTimeout(1000);
  ok(/402/.test(await st(s.page)) && s.shop.length === 1, 'お店が 402 を返さなければ、署名を求めずに中止');
  await s.page.close();
  s = await setup({ noChain: true });
  await s.page.evaluate(() => { const r = window.setTimeout; window.setTimeout = (f, ms, ...a) => r(f, Math.min(ms, 5), ...a); });
  await s.page.click('#robotErrandOpen'); await s.page.click('#errandShops .robot-chip[data-key="price"]'); await s.page.click('#errandGo');
  await s.page.waitForFunction(() => /お使い成功/.test(document.getElementById('robotStatus').innerText), null, { timeout: 15000 }).catch(() => {});
  ok(/まだ見つかりません/.test(await st(s.page)), 'チェーンの記録が見つからなければ「まだ見つからない」と正直に言う');
  await s.page.click('#errandResult .go'); await s.page.waitForTimeout(600);
  ok(!(await s.page.evaluate(() => AQ.app.events.some(e => e.type === 'payment.settled'))), 'そのときは、確定（チェーンに載った）のコマを作らない');
  await s.page.close();
}

console.log('\n[身分証を育てる]');
{
  const { page, errs, sent } = await setup();
  await page.click('#robotCardOpen');
  await page.click('#cardSkills .robot-chip[data-key="review"]');
  await page.click('#cardIntros .robot-choice[data-key="trader"]');
  const pv = JSON.parse(await page.evaluate(() => document.getElementById('cardPreview').textContent));
  ok(pv.type === 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1' && pv.name === 'ピクセル' && pv.active === true, '登録ファイルの形（type / name / active）');
  ok(/price scout|buys market data/.test(pv.description) && /Skills: research, explain, review\./.test(pv.description), '選んだ紹介と得意なことが description に入る（' + pv.description + '）');
  ok(pv.services.length === 1 && pv.services[0].name === 'DID' && /^did:key:z6Mk/.test(pv.services[0].endpoint), '掲示板の名前（did:key）が services の DID として入る');
  ok(pv.registrations[0].agentId === 4660 && pv.registrations[0].agentRegistry === 'eip155:8453:' + REGISTRY, 'registrations に番号と登録先（eip155:8453:…）');
  await page.click('#cardGo');
  await page.waitForFunction(() => /書き換えました|失敗|できません/.test(document.getElementById('robotStatus').innerText), null, { timeout: 10000 }).catch(() => {});
  ok(/読み直して/.test(await st(page)), '書き換えて、読み直して確かめたと言う（' + (await st(page)).slice(0, 30) + '）');
  const tx = sent[0] || {};
  ok(tx.to === REGISTRY && tx.value === '0x0' && tx.data.startsWith('0x0af28bd3' + (4660).toString(16).padStart(64, '0')), '送る取引は setAgentURI(4660, …) を登録先へ・値は 0');
  const h = tx.data.slice(10); const len = parseInt(h.slice(128, 192), 16);
  const uri = Buffer.from(h.slice(192, 192 + len * 2), 'hex').toString('utf8');
  const sent1 = JSON.parse(Buffer.from(uri.replace('data:application/json;base64,', ''), 'base64').toString('utf8'));
  ok(JSON.stringify(sent1) === JSON.stringify(pv), 'チェーンに送る中身は、画面に見せた中身とまったく同じ');
  ok(tx.data.endsWith('8021'.repeat(8)), '取引の末尾に Builder Code（ERC-8021）の印');
  ok(await page.evaluate(() => !document.getElementById('cardDone').hidden && /書き換えの取引/.test(document.getElementById('cardDone').innerText)), '取引と身分証へのリンクが出る');
  await page.evaluate(() => document.getElementById('robotCard').scrollIntoView());
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-errand-card.png') });
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
  const o = await setup({ chainOwner: '0x' + '22'.repeat(20) });
  await o.page.click('#robotCardOpen'); await o.page.click('#cardGo'); await o.page.waitForTimeout(800);
  ok(/書き換えられません/.test(await st(o.page)) && o.sent.length === 0, 'Base の上で持ち主が違えば、取引を送らない');
  await o.page.close();
}

await browser.close();
server.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
