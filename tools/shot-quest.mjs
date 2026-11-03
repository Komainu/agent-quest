/* tools/shot-quest.mjs — クエスト帳の検査（2026-10-13）
   使い方: node tools/shot-quest.mjs   （dist/agent-quest.html を先に build）
     ・1〜2（つなぐ → 生み出す）だけ順番必須、3 からは自由
     ・チェックは「成功を確かめた記録」があるときだけ付く（ニュースを買う → ✓）
     ・x402 の支払いで、お店が builder-code の拡張を出していれば、このアプリのコードを s に足して返す
     ・最後のクエスト：Base の取引の中身に Builder Code の印があるかを確かめる
     ・全部そろったら「ぜんぶクリア」 */
import { chromium } from 'playwright';
import { withAutoConfirm } from './auto-confirm.mjs';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { privateKeyToAccount } = require('viem/accounts');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'dist', 'agent-quest.html'))); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/';
const ACC = privateKeyToAccount('0x' + '11'.repeat(32));
const OWNER = ACC.address.toLowerCase();
const TX_BIRTH = '0x' + 'ab'.repeat(32), TX_FB = '0x' + 'cd'.repeat(32);
const AGENT = { agentId: '4660', name: 'ピクセル', owner: OWNER, tx: TX_BIRTH, chain: 8453, t: Date.now() };
const CODE = 'bc_l49l6vty';
const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
const suffix = (codes) => { const b = hex(codes.join(',')); return b + (b.length / 2).toString(16).padStart(2, '0') + '00' + '8021'.repeat(8); };

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
/* 2026-10-19 クエストの窓は「1画面に1ステップ」（src/wizard.js）。先のステップの部品を押す前に、そのステップへ進める */
const wz = (page, n) => page.evaluate((n) => { if (window.AQ && AQ.wizard && AQ.wizard.at()) AQ.wizard.go(n, false); }, n).then(() => page.waitForTimeout(150));
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
withAutoConfirm(browser);   // ウォレットに頼む前の確認は自動で押す（tools/auto-confirm.mjs）

async function setup(opts = {}) {
  const page = await browser.newPage({ viewport: opts.vp || { width: 1440, height: 900 } });
  const errs = [], shop = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.exposeFunction('__signTyped', async (json) => {
    const td = JSON.parse(json); const { EIP712Domain, ...types } = td.types;
    return ACC.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
  });
  await page.addInitScript((o) => {
    if (sessionStorage.getItem('seeded')) return;           // 読み込み直しでは消さない
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    if (o.agent) localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
    localStorage.setItem('aq.myAgent.key', JSON.stringify({ d: 'x', x: 'y', did: 'did:key:z6MkRobotKeyAbcdefghijkmnopqrstuvwxyz12345' }));
    for (const [k, v] of Object.entries(o.seed || {})) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, { agent: opts.agent === undefined ? AGENT : opts.agent, seed: opts.seed || {} });
  await page.addInitScript((o) => {
    const n64 = (n) => BigInt(n).toString(16).padStart(64, '0');
    window.ethereum = { on: () => {}, request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [o.owner];
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_call') { const d = params[0].data; if (d.startsWith('0x70a08231')) return '0x' + n64(500000); if (d.startsWith('0x6352211e')) return '0x' + n64(BigInt(o.owner)); if (d.startsWith('0xe94a0102')) return '0x' + n64(window.__authUsed ? 1 : 0); return '0x'; }
      if (method === 'eth_signTypedData_v4') return window.__signTyped(params[1]);
      if (method === 'eth_blockNumber') return '0x100000';
      if (method === 'eth_getLogs') return window.__logsHit ? [{ transactionHash: '0x' + '7b'.repeat(32), topics: params[0].topics }] : [];
      return null;
    } };
  }, { owner: OWNER });
  const NEWS_REQ = { scheme: 'exact', network: 'eip155:8453', amount: '5000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: '0x079471E6F43b6feeF80895E19cBFcBB496904852', maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } };
  await page.route('https://x402-seller-pmlm.onrender.com/**', async (route) => {
    const req = route.request(); const h = req.headers();
    if (new URL(req.url()).pathname === '/') { shop.wakes = (shop.wakes || 0) + 1; return route.fulfill({ status: 200, body: 'ok' }); }   // 窓を開いたときの「お店を起こす」頼み
    shop.push({ url: req.url(), sig: h['payment-signature'] });
    const pr = { x402Version: 2, error: 'Payment required', resource: { url: req.url(), description: 'News', mimeType: 'application/json' }, accepts: [NEWS_REQ] };
    if (opts.ext) pr.extensions = opts.ext;
    const hdr = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'PAYMENT-REQUIRED', 'content-type': 'application/json', 'payment-required': Buffer.from(JSON.stringify(pr)).toString('base64') };
    if (!h['payment-signature']) return route.fulfill({ status: 402, headers: hdr, body: '{}' });
    if (opts.paidHang) return;                                        // 署名を付けた2回目に、お店が返事をしない（2026-10-21 利用者のところで起きた）
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ count: 1, articles: [{ title: 'Base headline', url: 'https://example.com/a', source: 'X', publishedAt: new Date().toISOString() }] }) });
  });
  const txInput = opts.txInput || {};
  await page.route('https://base.blockscout.com/**', (route) => {
    const u = route.request().url(); const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (opts.bsDown) return;                                          // Blockscout がまったく返事をしない（2026-10-22）
    const m = u.match(/\/transactions\/(0x[0-9a-f]{64})/);
    if (m && opts.bsHang) return;                                     // Blockscout が返事をしない（利用者のパソコンで起きた）
    if (m) return txInput[m[1]] ? route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ hash: m[1], raw_input: txInput[m[1]] }) }) : route.fulfill({ status: 404, headers: cors, body: '{}' });
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [
      { from: { hash: ACC.address }, to: { hash: '0x079471E6F43b6feeF80895E19cBFcBB496904852' }, token: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC' },
        total: { value: '5000', decimals: '6' }, timestamp: new Date(Date.now() + 500).toISOString(), transaction_hash: '0x' + '9a'.repeat(32), method: 'transferWithAuthorization' }] }) });
  });
  /* Base の公式の入口（取引の中身を読む）。opts.rpcTx のときだけ答える（ほかは今までどおり） */
  if (opts.rpcTx) await page.route('https://mainnet.base.org/**', (route) => {
    const q = JSON.parse(route.request().postData() || '{}');
    if (q.method !== 'eth_getTransactionByHash') return route.fallback();
    const inp = txInput[q.params[0]];
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result: inp ? { hash: q.params[0], input: inp } : null }) });
  });
  await page.route('https://technocore.chat/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{"messages":[]}' }));
  await page.route('https://kibble.world/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(opts.board || {}) }));
  await page.goto(URL0);
  await page.waitForFunction(() => window.AQ && window.AQ.quest && window.AQ.app);
  return { page, errs, shop };
}
const book = (page) => page.evaluate(() => ({
  count: document.getElementById('questCount').innerText,
  q: Object.fromEntries([...document.querySelectorAll('#questList .quest')].map(b => [b.dataset.q, b.classList.contains('done') ? 'done' : (b.disabled ? 'locked' : 'open')])),
  toast: document.getElementById('questToast').className.includes('show') ? document.getElementById('questToast').innerText : '',
  say: (document.getElementById('questSay') || {}).innerText || '',
  door: (document.getElementById('startBirthS') || {}).innerText || '' }));

console.log('\n[はじめて：1〜2 だけ順番]');
{
  const { page, errs } = await setup({ agent: null });
  const door0 = await page.evaluate(() => document.getElementById('startBirthS').innerText);
  ok(/0\s*\/\s*13/.test(door0), '入口の扉に進みぐあい（0/13）が出る（' + door0 + '）');
  await page.click('#startBirth'); await page.waitForTimeout(300);
  let b = await book(page);
  ok(Object.keys(b.q).length === 13 && /0/.test(b.count), 'クエストは 13 個、はじめは 0 個クリア（' + b.count + '）');
  ok(b.q.connect === 'open' && b.q.create === 'locked' && Object.entries(b.q).filter(([k]) => !['connect', 'create'].includes(k)).every(([, v]) => v === 'locked'), '最初は「つなぐ」だけ選べる。ほかは🔒');
  await page.click('#questList .quest[data-q="connect"]'); await page.waitForTimeout(150);
  const det = await page.evaluate(() => { const w = document.getElementById('questWin'); return { shown: !w.hidden, t: w.innerText,
    btn: w.contains(document.getElementById('birthConnect')) && document.getElementById('birthConnect').offsetParent !== null,
    big: parseFloat(getComputedStyle(document.getElementById('questWinWhat')).fontSize) }; });
  ok(det.shown && /💡/.test(det.t) && /ウォレットをつなぐ/.test(det.t), '選ぶと、クエストの窓が開いて説明（何をする・何がわかる）が出る');
  ok(det.btn, '窓の中に、そのクエストの操作（ウォレットをつなぐボタン）がある');
  ok(det.big >= 15, '窓の説明は大きな字（' + det.big + 'px）');
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-start.png') });
  await page.click('#birthConnect'); await page.waitForTimeout(800);
  b = await book(page);
  ok(b.q.connect === 'done' && b.q.create === 'open' && b.q.news === 'locked', 'つないだら ✓。次の「生み出す」だけが開き、3 以降はまだ🔒');
  ok(/つなぐ|ウォレット/.test(b.toast), 'クリアの知らせが出る（' + b.toast.replace(/\n/g, ' ') + '）');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[エージェントがいる：3 から自由]');
{
  const { page, errs, shop } = await setup({ ext: { 'builder-code': { info: { s: ['other_app'] }, schema: { type: 'object' } } } });
  await page.click('#startBirth'); await page.waitForTimeout(300);
  let b = await book(page);
  ok(b.q.connect === 'done' && b.q.create === 'done' && ['hello', 'news', 'job', 'judge', 'card', 'feedback', 'mail', 'memo', 'deal', 'town', 'builder'].every(k => b.q[k] === 'open'), '1〜2 は ✓、残り 11 個はどれからでも選べる');
  ok(!b.toast, '開いた直後は、前から済んでいた分を「いまクリア」と祝わない');
  ok(/2\s*\/\s*13/.test(b.count), '進みぐあい 2/13（' + b.count + '）');
  /* ニュースを買う → ✓ */
  await page.click('#questList .quest[data-q="news"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !document.getElementById('robotErrand').hidden && document.getElementById('questWin').contains(document.getElementById('robotErrand')) && (document.querySelector('#errandShops .robot-chip.on') || {}).dataset?.key === 'news'), 'クエストの窓の中で、ニュースのお使いが開く');
  await page.waitForTimeout(200);
  ok(shop.wakes === 1, 'ニュースの窓を開いたら、眠っているかもしれないお店を前もって起こす（' + shop.wakes + ' 回）');
  await page.click('#errandChoices .robot-choice >> nth=0'); await page.waitForTimeout(700);
  ok(await page.evaluate(() => { const a = AQ.wizard.at(); return a && a.i === 1 && !document.getElementById('errandChoices').offsetParent && !!document.getElementById('errandGo').offsetParent; }), '1画面に1ステップ：買うものを選ぶと、自動で「ステップ 2」（買いに行かせるボタンだけ）に進む');
  await page.click('#errandGo');
  await page.waitForFunction(() => /お使い成功|うまく|受け取り|足り|中止/.test(document.getElementById('robotStatus').innerText), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  b = await book(page);
  ok(b.q.news === 'done' && /3\s*\/\s*13/.test(b.count), 'ニュースが届いたら ✓（' + b.count + '）');
  ok(/ニュース/.test(b.toast), '「ニュース」クリアの知らせ（' + b.toast.replace(/\n/g, ' ') + '）');
  const p = JSON.parse(Buffer.from((shop[1] || {}).sig || 'e30=', 'base64').toString('utf8'));
  const s = p.extensions && p.extensions['builder-code'] && p.extensions['builder-code'].info && p.extensions['builder-code'].info.s;
  ok(Array.isArray(s) && s[0] === 'other_app' && s.includes(CODE), 'お店が builder-code を出していれば、支払いの拡張 s にこのアプリのコードを足す（' + JSON.stringify(s) + '）');
  ok(p.extensions['builder-code'].schema && p.extensions['builder-code'].schema.type === 'object', '拡張のほかの部分（schema）はお店のものをそのまま返す');
  ok(await page.evaluate(() => AQ.birth && /3\s*\/\s*13/.test(document.getElementById('startBirthS').innerText)), '入口の扉の数字も 3/13 に変わる');
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-news.png') });
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[ニュース：支払いの取引を Base の記録から探す（Blockscout が黙っていても）（2026-10-22）]');
for (const mode of ['logs', 'authOnly']) {
  const { page, errs } = await setup({ bsDown: true });
  await page.evaluate((m) => { window.__logsHit = m === 'logs'; window.__authUsed = m === 'authOnly'; }, mode);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#questList .quest[data-q="news"]'); await page.waitForTimeout(300);
  await page.click('#errandChoices .robot-choice >> nth=0'); await page.waitForTimeout(700);
  const t0 = Date.now();
  await page.click('#errandGo');
  await page.waitForFunction(() => /お使い成功/.test(document.getElementById('robotStatus').innerText), null, { timeout: 25000 }).catch(() => {});
  const ms = Date.now() - t0, st = await page.evaluate(() => document.getElementById('robotStatus').innerText);
  const rec = await page.evaluate(() => (JSON.parse(localStorage.getItem('aq.myAgent.errands') || '[]').slice(-1)[0] || {}));
  if (mode === 'logs') ok(/確かめられます|確かめました/.test(st) && rec.tx === '0x' + '7b'.repeat(32) && ms < 10000, 'Blockscout が黙っていても、USDC の契約の記録（AuthorizationUsed）から支払いの取引を見つける（' + Math.round(ms / 1000) + ' 秒）');
  else ok(/USDC の契約）で確かめました/.test(st) && rec.paid === true && !rec.tx, '取引の番号が見つからなくても、署名が使われたことを Base の記録で確かめられれば「支払いは確かめた」と言う（' + st.slice(0, 30) + '）');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[ニュース：署名のあと、お店が返事をしない（2026-10-21）]');
for (const used of [false, true]) {
  const { page, errs } = await setup({ paidHang: true });
  await page.evaluate((u) => { window.__authUsed = u; AQ.errand._timing({ paid: 1500, gap: 200, tries: 3 }); }, used);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#questList .quest[data-q="news"]'); await page.waitForTimeout(300);
  await page.click('#errandChoices .robot-choice >> nth=0'); await page.waitForTimeout(700);
  await page.click('#errandGo');
  await page.waitForFunction(() => /もう一度頼んでいます.*（[1-9]\d* 秒）/.test(document.getElementById('robotStatus').innerText), null, { timeout: 8000 }).catch(() => {});
  const mid = await page.evaluate(() => document.getElementById('robotStatus').innerText);
  ok(/もう一度頼んでいます.*（\d+ 秒）/.test(mid), '待っているあいだは秒数を数えて見せる（' + mid.slice(-20) + '）');
  await page.waitForFunction(() => /Base の記録/.test(document.getElementById('robotStatus').innerText) && !/確かめています/.test(document.getElementById('robotStatus').innerText), null, { timeout: 10000 }).catch(() => {});
  const st = await page.evaluate(() => document.getElementById('robotStatus').innerText);
  if (used) ok(/支払い（0\.005 USDC）は Base の記録に載りましたが.*品物が届きませんでした/.test(st), 'お店が黙ったまま、支払いはチェーンに載っていた → そう正直に言う（' + st.slice(0, 40) + '）');
  else ok(/いまのところ Base の記録に載っていません（お金は動いていません）/.test(st), 'お店が黙ったまま、支払いも載っていない → 「お金は動いていません」（' + st.slice(0, 40) + '）');
  ok(await page.evaluate(() => !document.getElementById('errandGo').disabled), '止まったままにせず、もう一度押せる');
  if (!used) {
    const offer = await page.evaluate(() => { const b = document.querySelector('#questSay .quest-say-act'); return b && b.offsetParent ? b.innerText : ''; });
    ok(/完了にする/.test(offer), 'お店の側で止まったら「このクエストを完了にする」ボタンを出す（' + offer + '）');
    await page.click('#questSay .quest-say-act'); await page.waitForTimeout(500);
    const b2 = await book(page);
    const proof = await page.evaluate(() => document.getElementById('questWinProof').innerText);
    ok(b2.q.news === 'done' && /自分で完了にしました（ニュースは買えていません）/.test(proof), '押すとクリアになり、記録には「お店が止まっていたので自分で完了にした（買えていない）」と正直に書く');
  }
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[builder-code を出さないお店には足さない]');
{
  const { page, errs, shop } = await setup();
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#robotErrandOpen'); await page.click('#errandGo');
  await page.waitForFunction(() => /お使い成功|うまく|受け取り|足り|中止/.test(document.getElementById('robotStatus').innerText), null, { timeout: 15000 }).catch(() => {});
  const p = JSON.parse(Buffer.from((shop[1] || {}).sig || 'e30=', 'base64').toString('utf8'));
  ok(p.x402Version === 2 && !p.extensions, '拡張を出していないお店には、勝手に拡張を付けない');
  const r = await page.evaluate(() => [AQ.errand._withBuilderCode(null), JSON.stringify(AQ.errand._withBuilderCode({ 'builder-code': { info: { s: ['bc_l49l6vty'] } } }))]);
  ok(r[0] === null && r[1] === '{"builder-code":{"info":{"s":["bc_l49l6vty"]}}}', '同じコードを二重に足さない');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[最後のクエスト：Builder Code の印]');
{
  const H = (n) => '0x' + n.toString(16).padStart(64, '0');
  const r0 = await setup();
  const v = await r0.page.evaluate(([a, b, c]) => [AQ.quest._hasCode(a), AQ.quest._hasCode(b), AQ.quest._hasCode(c)],
    ['0x7a5f1b' + suffix([CODE]), '0x7a5f1b' + suffix(['someone']), '0x7a5f1b' + hex(CODE) + 'ff']);
  ok(v[0] === true && v[1] === false && v[2] === false, '印の読み方：末尾が 8021×8 で、その中にこのアプリのコードがあるときだけ');
  await r0.page.close();

  /* 印の無い取引だけ → まだ */
  {
    const { page, errs } = await setup({ txInput: { [TX_BIRTH]: '0x7a5f1b' + '00'.repeat(40) } });
    await page.click('#startBirth'); await page.waitForTimeout(200);
    await page.click('#questList .quest[data-q="builder"]'); await page.click('#questWinGo');
    await page.waitForFunction(() => /まだ|見つかり/.test(document.getElementById('questSay').innerText), null, { timeout: 5000 }).catch(() => {});
    const b = await book(page);
    ok(b.q.builder === 'open' && b.say.length > 0, '印が見つからなければ ✓ を付けない（' + b.say + '）');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  /* 印のある取引 → ✓ */
  {
    const { page, errs } = await setup({ txInput: { [TX_BIRTH]: '0x7a5f1b' + '00'.repeat(40) + suffix([CODE]), [TX_FB]: '0xabcdef' + '00'.repeat(40) },
      seed: { 'aq.myAgent.feedback': [{ tx: TX_FB, agentId: '9', stars: 5, t: Date.now() }] } });
    await page.click('#startBirth'); await page.waitForTimeout(200);
    await page.click('#questList .quest[data-q="builder"]'); await page.click('#questWinGo');
    await page.waitForFunction(() => document.querySelector('#questList .quest[data-q="builder"].done'), null, { timeout: 5000 }).catch(() => {});
    /* 印が1つ見つかった時点でクリアになる（2026-10-20）。ほかの取引の行は、調べ終わるのを待ってから見る */
    await page.waitForFunction(() => !/確かめています/.test(document.getElementById('questBuilder').innerText), null, { timeout: 10000 }).catch(() => {});
    const b = await book(page);
    const list = await page.evaluate(() => [...document.querySelectorAll('#questBuilder li')].map(l => l.className + ':' + l.innerText));
    ok(b.q.builder === 'done', '自分の取引に印が見つかったら ✓（' + b.say + '）');
    ok(list.length === 2 && list.some(l => /^ok:/.test(l)) && list.some(l => /^ng:/.test(l)), '取引ごとに「印あり／なし」を出す（' + list.map(l => l.split(':')[0]).join(',') + '）');
    ok(await page.evaluate(() => [...document.querySelectorAll('#questBuilder a')].every(a => /^https:\/\/basescan\.org\/tx\/0x[0-9a-f]{64}$/.test(a.href))), 'それぞれ Basescan で確かめられるリンクつき');
    await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-builder.png') });
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  /* Blockscout が返事をしなくても止まらない（2026-10-19 利用者の報告：「確かめています…」のまま止まる） */
  {
    const { page, errs } = await setup({ bsHang: true, rpcTx: true, txInput: { [TX_BIRTH]: '0x7a5f1b' + '00'.repeat(40) + suffix([CODE]) } });
    await page.click('#startBirth'); await page.waitForTimeout(200);
    const t0 = Date.now();
    await page.click('#questList .quest[data-q="builder"]'); await page.click('#questWinGo');
    await page.waitForFunction(() => document.querySelector('#questList .quest[data-q="builder"].done'), null, { timeout: 6000 }).catch(() => {});
    const ms = Date.now() - t0, b = await book(page);
    ok(b.q.builder === 'done' && ms < 4000, 'Blockscout が黙っていても、Base の公式の入口（mainnet.base.org）で読んですぐ ✓（' + ms + 'ms）');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  /* どちらも黙っていても、8 秒で打ち切って結果を出す */
  {
    const { page, errs } = await setup({ bsHang: true, txInput: { [TX_BIRTH]: '0x00' } });
    await page.route('https://mainnet.base.org/**', () => {});      // 返事をしない
    await page.click('#startBirth'); await page.waitForTimeout(200);
    await page.click('#questList .quest[data-q="builder"]'); await page.click('#questWinGo');
    const busy = () => [...document.querySelectorAll('#questBuilder li')].some(l => /確かめています/.test(l.innerText));
    await page.waitForFunction(busy => !eval(busy)(), busy.toString(), { timeout: 15000 }).catch(() => {});
    const still = await page.evaluate(busy);
    const txt = await page.evaluate(() => document.getElementById('questBuilder').innerText + ' / ' + document.getElementById('questSay').innerText);
    ok(!still && /読めません/.test(txt), 'どこも返事をしないときも、8 秒で打ち切って「読めませんでした」と出す（止まったままにしない）（' + txt.replace(/\n/g, ' ').slice(0, 120) + '）');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
}

console.log('\n[ぜんぶクリア]');
{
  const did = 'did:key:z6MkRobotKeyAbcdefghijkmnopqrstuvwxyz12345';
  const seed = {
    'aq.myAgent.posts': [{ room: 'lobby', seq: 1, from: did, text: 'hi' }, { room: 'kibble', seq: 2, from: did, text: 'ATTEST v1 | k1 | useful | rh:x | ok' }],
    'aq.myAgent.errands': [{ shop: 'news', result: { kind: 'news' }, tx: null }],
    'aq.myAgent.jobs': [{ id: 'k1' }], 'aq.myAgent.card': { tx: null }, 'aq.myAgent.feedback': [{ tx: null }],
    'aq.quest.mail': '1', 'aq.quest.town': '1', 'aq.quest.seen': '12',
    'aq.myAgent.memo': { line: 'x', url: 'https://technocore.chat/kv/p-aq-mem-0/notes' }, 'aq.myAgent.deal': { contract: '0x' + 'ab'.repeat(32), dealRoom: 'mb-p-tclk-abababababababab' }
  };
  const { page, errs } = await setup({ seed, txInput: { [TX_BIRTH]: '0x00' + suffix([CODE]) } });
  await page.click('#startBirth'); await page.waitForTimeout(300);
  let b = await book(page);
  ok(Object.values(b.q).filter(v => v === 'done').length === 12 && b.q.builder === 'open', '12 個 ✓、残りは Builder Code だけ');
  await page.click('#questList .quest[data-q="builder"]'); await page.click('#questWinGo');
  await page.waitForFunction(() => !document.getElementById('questDone').hidden, null, { timeout: 5000 }).catch(() => {});
  b = await book(page);
  const done = await page.evaluate(() => ({ shown: !document.getElementById('questDone').hidden, t: document.getElementById('questDone').innerText }));
  ok(/13\s*\/\s*13/.test(b.count) && done.shown, 'ぜんぶ ✓ で、完了のメッセージが出る（' + done.t.slice(0, 30) + '）');
  ok(b.toast.length > 0, 'ぜんぶクリアの知らせ（' + b.toast.replace(/\n/g, ' ') + '）');
  ok(await page.evaluate(() => document.getElementById('certWin').hidden), '全部そろった瞬間には、まだ修了証を出さない（最後の結果を見てもらう）');
  await page.waitForFunction(() => !document.getElementById('certWin').hidden, null, { timeout: 6000 }).catch(() => {});
  const cert = await page.evaluate(() => ({ shown: !document.getElementById('certWin').hidden, name: document.getElementById('certName').innerText,
    quests: document.querySelectorAll('#certQuests li').length, proof: document.getElementById('certProof').innerText, meta: document.getElementById('certMeta').innerText,
    links: [...document.querySelectorAll('#certProof a')].map(a => a.href) }));
  ok(cert.shown, '全部そろうと、修了証の窓が自動で開く');
  ok(cert.name === 'エージェント #4660「ピクセル」' && cert.quests === 13, '修了証に、エージェントの番号と名前・13のクエストが出る');
  ok(/1 件で、Builder Code（bc_l49l6vty）の印を確かめました/.test(cert.proof) && cert.links.some(h => /basescan\.org\/tx\//.test(h)), 'Builder Code の印を確かめた取引（Basescan へのリンク）が出る（' + cert.proof.split('\n')[0] + '）');
  ok(/発行日：/.test(cert.meta) && /持ち主：0x/.test(cert.meta), '発行日と持ち主が出る');
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-cert.png') });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#certSave')]);
  ok(dl && /^agent-quest-certificate-4660\.png$/.test(dl.suggestedFilename()), '「画像で保存」で PNG を保存できる（' + (dl ? dl.suggestedFilename() : 'なし') + '）');
  if (dl) { const fp = await dl.path(); const head = fs.readFileSync(fp).slice(0, 4).toString('hex'); ok(head === '89504e47', '保存したのは本物の PNG'); fs.copyFileSync(fp, path.join(ROOT, 'tools', 'shot-quest-cert-saved.png')); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById('certWin').hidden && !document.getElementById('questCertBtn').hidden), 'Esc で閉じ、クエスト帳の「🎓 修了証を見る」からまた開ける');
  await page.click('#questWinClose').catch(() => {});
  await page.click('#questCertBtn'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById('certWin').hidden), '「🎓 修了証を見る」で開く');
  await page.click('#certClose');
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-all.png') });
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[納品を判定する：やってみるの反応]');
{
  const did = 'did:key:z6MkRobotKeyAbcdefghijkmnopqrstuvwxyz12345';
  const JOBS = [{ id: 'kold000001', title: 'Explain how x402 payments work in 3 short sentences', t: Date.now() - 86400000, seq: 10 }];
  const sayOf = (page) => page.evaluate(() => document.getElementById('questSay').innerText);
  const go = async (page) => { await page.click('#questList .quest[data-q="judge"]'); await page.waitForFunction(() => !/読んでいます/.test(document.getElementById('questSay').innerText) && document.getElementById('questSay').innerText, null, { timeout: 5000 }).catch(() => {}); };
  /* A: 古くて一覧から外れた仕事だけ */
  {
    const { page, errs } = await setup({ seed: { 'aq.myAgent.jobs': JOBS } });
    await page.click('#startBirth'); await page.waitForTimeout(200);
    await go(page);
    const v = await page.evaluate(() => ({ open: !document.getElementById('robotJobs').hidden, st: [...document.querySelectorAll('#robotJobsList .robot-job-st')].map(e => e.innerText), sub: document.getElementById('robotJobsList').innerText, btn: !!document.querySelector('#questSay .quest-say-act') }));
    const msg = await sayOf(page);
    ok(/判定できる納品がありません/.test(msg) && /新しく仕事を頼んで/.test(msg), '押すと、なぜできないか・次に何をするかをクエスト帳に書く（' + msg.slice(0, 40) + '）');
    ok(v.open && v.st[0] === '一覧から外れました' && /古くなって/.test(v.sub), '頼んだ仕事の一覧も開き、「一覧から外れました」と出す');
    ok(v.btn, '「新しく仕事を頼む」ボタンが出る');
    await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-judge-old.png') });
    await page.click('#questSay .quest-say-act'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => !document.getElementById('robotJobForm').hidden && document.getElementById('questWin').contains(document.getElementById('robotJobForm')) && /仕事を頼む/.test(document.getElementById('questWinTitle').innerText)), 'そのボタンで「仕事を頼む」のクエストの窓に移る');
    /* 閉じたら、移したパネルは元の場所（ロボットの欄）へ戻る */
    await page.click('#questWinClose'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.getElementById('questWin').hidden && document.getElementById('robotBox').contains(document.getElementById('robotJobForm')) && document.getElementById('robotBox').contains(document.getElementById('robotStatus')) && document.getElementById('questBook').contains(document.getElementById('questSay'))), '窓を閉じると、パネルは元の場所へ戻る');
    /* もう一度開いても、同じ案内が出る */
    await go(page);
    ok(await page.evaluate(() => !document.getElementById('robotJobs').hidden) && /判定できる納品がありません/.test(await sayOf(page)), 'もう一度開いても、一覧と案内が出る');
    /* Esc で窓だけ閉じる（自分のエージェントの画面は開いたまま） */
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.getElementById('questWin').hidden && !document.getElementById('birthScreen').hidden), 'Esc で窓だけ閉じる');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  /* B: 一覧から外れたが、ロボットが控えていた納品がある */
  {
    const posts = [{ room: 'kibble', seq: 11, from: 'did:key:z6MkWorkerXyz', text: 'DELIVER v1 | kold000001 | x402 lets a server ask for payment with HTTP 402.', ts: new Date().toISOString() }];
    const { page, errs } = await setup({ seed: { 'aq.myAgent.jobs': JOBS, 'aq.myAgent.posts': posts } });
    await page.click('#startBirth'); await page.waitForTimeout(200);
    await go(page);
    /* ★ 2026-10-19 判定は「① 読む → ② 判定する」（向こうのセッション）。控えの説明は「くわしく」に畳んである */
    const v = await page.evaluate(() => ({ t: document.getElementById('robotJobsList').textContent, next: !!document.querySelector('#robotJobsList .robot-step-go') }));
    ok(/判定できる納品が 1 件/.test(await sayOf(page)), '控えの納品があれば「判定できる納品が 1 件」（' + (await sayOf(page)).slice(0, 30) + '）');
    ok(v.next && /HTTP 402/.test(v.t) && /数えられるかは分かりません/.test(v.t), '控えの納品を出し、判定へ進める。kibble に数えられるかは分からないと正直に書く');
    await page.click('#robotJobsList .robot-step-go'); await page.waitForTimeout(800);
    ok(await page.evaluate(() => !!document.querySelector('#robotJobsList .robot-judge') && AQ.wizard.at().i === 1 && document.querySelectorAll('#robotJobsList [data-job-card]').length === 1), '「判定へ進む」で、上の見出しも「ステップ 2 判定する」になり、その仕事だけが出る');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  /* E: 1件判定したあと（2026-10-19 利用者「一件だけでよい」「クリアなのに判定待ちの文言で混乱」） */
  {
    const DID0 = 'did:key:z6MkRobotKeyAbcdefghijkmnopqrstuvwxyz12345';
    const jobs2 = [{ id: 'kold000001', title: 'Explain how x402 payments work in 3 short sentences', t: Date.now() - 86400000, seq: 10 },
                   { id: 'kold000002', title: 'What is ERC-8004?', t: Date.now() - 3600000, seq: 12 }];
    const board = { jobs: [{ job_id: 'kold000001', status: 'delivered', result: 'Three sentences.', result_hash: 'ab12', attestations: [] },
                           { job_id: 'kold000002', status: 'delivered', result: 'An identity standard.', result_hash: 'cd34', attestations: [] }] };
    const { page, errs } = await setup({ seed: { 'aq.myAgent.jobs': jobs2, 'aq.myAgent.judged': { kold000001: 'useful' },
      'aq.myAgent.posts': [{ room: 'kibble', seq: 20, from: DID0, text: 'ATTEST v1 | kold000001 | useful | rh:ab12 | clear' }] }, board });
    await page.click('#startBirth'); await page.waitForTimeout(200);
    await go(page); await page.waitForTimeout(500);
    const v = await page.evaluate(() => ({ top: [...document.querySelectorAll('#robotJobsList > .robot-job')].map(c => c.querySelector('.robot-job-st').innerText),
      rest: !!document.querySelector('#robotJobsList > details.robot-jobs-rest') && !document.querySelector('#robotJobsList > details.robot-jobs-rest').open,
      say: document.getElementById('questSay').innerText, head: document.getElementById('wzHead').innerText }));
    ok(v.top.length === 1 && /判定ずみ（受け取る）/.test(v.top[0]), '判定したら、その仕事1件だけを出し、札は「判定ずみ（受け取る）」（kibble がまだ「判定待ち」でも）（' + v.top.join(',') + '）');
    ok(v.rest, 'ほかの仕事は「くわしく」に畳む（判定は任意）');
    ok(!/判定できる納品/.test(v.say) && /ぜんぶ完了/.test(v.head), '「判定できる納品が N 件」とは言わず、上の帯は「ステップ 2 / 2 · ✓ ぜんぶ完了」（' + v.head.replace(/\n/g, ' ').slice(0, 40) + '）');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  /* C: 一覧に載っていて納品ずみ／D: まだ待ち */
  for (const [st, want] of [['delivered', /判定できる納品が 1 件/], ['claimed', /まだ納品が届いていません（待っている仕事 1 件）/]]) {
    const board = { jobs: [{ job_id: 'kold000001', status: st, result: st === 'delivered' ? 'Three sentences.' : null, result_hash: 'ab12', attestations: [] }] };
    const { page, errs } = await setup({ seed: { 'aq.myAgent.jobs': JOBS }, board });
    await page.click('#startBirth'); await page.waitForTimeout(200);
    await go(page);
    ok(want.test(await sayOf(page)), st + ' → ' + (await sayOf(page)).slice(0, 36));
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
}

console.log('\n[身分証を育てる：財布が2つ（MetaMask と Rabby）]');
{
  const OTHER = '0x2222222222222222222222222222222222222222';
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((o) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1'); localStorage.clear();
      localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
      localStorage.setItem('aq.myAgent.key', JSON.stringify({ d: 'x', x: 'y', did: 'did:key:z6MkRobotKeyAbc' }));
    }
    window.__calls = [];
    const mk = (name, acc) => ({ on() {}, request: async ({ method }) => { window.__calls.push(name + ':' + method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [acc];
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_call') return '0x' + '0'.repeat(24) + acc.slice(2);
      if (method === 'eth_sendTransaction') return new Promise(() => {});   // 確認画面で待っている
      return null; } });
    const ws = [{ info: { uuid: 'a', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider: mk('mm', o.other) },
                { info: { uuid: 'b', name: 'Rabby Wallet', icon: '', rdns: 'io.rabby' }, provider: mk('rabby', o.owner) }];
    window.addEventListener('eip6963:requestProvider', () => ws.forEach(w => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: w }))));
  }, { agent: AGENT, owner: OWNER, other: OTHER });
  await page.route(/^https:\/\//, r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"items":[],"messages":[]}' }));
  await page.goto(URL0); await page.waitForFunction(() => window.AQ && window.AQ.quest);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#questList .quest[data-q="card"]'); await page.waitForTimeout(300);
  await wz(page, 2); await page.click('#cardGo'); await page.waitForTimeout(900);
  const inView = (id) => page.evaluate((id) => { const e = document.getElementById(id), b = document.getElementById('questWinBody').getBoundingClientRect(), r = e.getBoundingClientRect();
    return !e.hidden && r.height > 0 && r.top >= b.top - 2 && r.bottom <= b.bottom + 2 && document.getElementById('questWin').contains(e); }, id);
  const st1 = await page.evaluate(() => document.getElementById('robotStatus').innerText);
  ok(/すぐ下のボタンで使うウォレットを選んで/.test(st1), '財布が2つなら「すぐ下のボタンで選んで」と言う（' + st1.slice(0, 30) + '）');
  ok(await inView('birthWallets') && await inView('robotStatus'), '案内と、財布を選ぶボタンが、窓の中の見えるところに出る（下に隠れない）');
  ok(await page.evaluate(() => { const a = document.getElementById('robotCard').compareDocumentPosition(document.getElementById('birthWallets')); return !!(a & Node.DOCUMENT_POSITION_FOLLOWING); }), '財布を選ぶボタンは、身分証のパネルのすぐ下');
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-card-pick.png') });
  /* MetaMask（持ち主ではない口座）を選ぶ → 「持ち主ではない」と言い、選び直せる */
  await page.click('#birthWallets .birth-wallet:has-text("MetaMask")'); await page.waitForTimeout(400);
  await wz(page, 2); await page.click('#cardGo'); await page.waitForTimeout(900);
  const st2 = await page.evaluate(() => document.getElementById('robotStatus').innerText);
  ok(/0x2222…2222）は、ロボットの財布（0x[0-9a-f]{4}…[0-9a-f]{4}）ではありません/.test(st2) && /別のウォレットを選んで/.test(st2), '持ち主ではない口座なら、そう言う（Rabby の名前も出す）（' + st2.slice(0, 60) + '）');
  ok(await inView('birthWallets'), '持ち主と違うときは、別の財布を選ぶボタンをもう一度出す');
  /* Rabby（持ち主）を選ぶ → 次はそのまま進んで、取引の確認画面を頼む */
  await page.click('#birthWallets .birth-wallet:has-text("Rabby")'); await page.waitForTimeout(400);
  await wz(page, 2); await page.click('#cardGo'); await page.waitForTimeout(900);
  const c1 = await page.evaluate(() => window.__calls.filter(c => /eth_sendTransaction/.test(c)));
  ok(c1.length === 1 && c1[0] === 'rabby:eth_sendTransaction', 'Rabby を選ぶと、Rabby に取引の確認を頼む（' + c1.join(',') + '）');
  ok(/確認/.test(await page.evaluate(() => document.getElementById('robotStatus').innerText)), 'ウォレットの確認画面を待っていると伝える');
  /* 読み込み直しても、選んだ財布（Rabby）を覚えている */
  await page.reload(); await page.waitForFunction(() => window.AQ && window.AQ.quest); await page.waitForTimeout(200);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#questList .quest[data-q="card"]'); await page.waitForTimeout(300);
  await wz(page, 2); await page.click('#cardGo'); await page.waitForTimeout(900);
  const c2 = await page.evaluate(() => window.__calls.filter(c => /eth_sendTransaction/.test(c)));
  ok(c2.length === 1 && c2[0] === 'rabby:eth_sendTransaction', '読み込み直しても、前に選んだ財布（Rabby）でそのまま進む（' + c2.join(',') + '）');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[途中でウォレットのアドレスを変えた／最初からやり直す]');
{
  const OTHER = '0x2222222222222222222222222222222222222222';
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((o) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1'); localStorage.clear();
      localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
      localStorage.setItem('aq.myAgent.key', JSON.stringify({ d: 'x', x: 'y', did: 'did:key:z6MkRobotKeyAbc' }));
      localStorage.setItem('aq.myAgent.jobs', JSON.stringify([{ id: 'k1', title: 't' }]));
      localStorage.setItem('aq.quest.mail', '1');
      localStorage.setItem('aq.lang', 'ja');
    }
    window.__acc = o.other; const hs = [];
    window.ethereum = { on: (ev, f) => { if (ev === 'accountsChanged') hs.push(f); },
      request: async ({ method }) => (method === 'eth_accounts' || method === 'eth_requestAccounts') ? [window.__acc] : (method === 'eth_chainId' ? '0x2105' : null) };
    window.__switch = (a) => { window.__acc = a; hs.forEach(f => f([a])); };
  }, { agent: AGENT, other: OTHER });
  await page.route(/^https:\/\//, r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"items":[],"messages":[]}' }));
  await page.goto(URL0); await page.waitForFunction(() => window.AQ && window.AQ.quest);
  await page.click('#startBirth'); await page.waitForTimeout(400);
  const w1 = await page.evaluate(() => ({ shown: !document.getElementById('ownerWarn').hidden, t: document.getElementById('ownerWarn').innerText }));
  ok(w1.shown && /持ち主ではありません/.test(w1.t) && /0x2222…2222/.test(w1.t) && /#4660/.test(w1.t), '開いたとき、いまの口座が持ち主と違えばそう出す（' + w1.t.split('\n')[0] + '）');
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-owner.png') });
  await page.click('#questList .quest[data-q="card"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !document.getElementById('questWinWarn').hidden && /持ち主ではありません/.test(document.getElementById('questWinWarn').innerText)), 'クエストの窓の上にも出す');
  await page.evaluate((a) => window.__switch(a), OWNER); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById('ownerWarn').hidden && document.getElementById('questWinWarn').hidden), 'ウォレットで持ち主に切り替えたら、警告は消える');
  await page.evaluate((a) => window.__switch(a), OTHER); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById('questWinWarn').hidden), 'また別の口座にしたら、また出す');
  /* やり直す：1回目は確かめるだけ、2回目で消す */
  await page.click('#questWinWarn .reset-btn'); await page.waitForTimeout(150);
  const armed = await page.evaluate(() => ({ t: document.querySelector('#questWinWarn .reset-btn').innerText, kept: !!localStorage.getItem('aq.myAgent') }));
  ok(/本当に消しますか/.test(armed.t) && armed.kept, '1回目は「本当に消しますか？」と聞くだけ（まだ消さない）');
  await Promise.all([page.waitForNavigation(), page.click('#questWinWarn .reset-btn')]);
  await page.waitForFunction(() => window.AQ && window.AQ.quest); await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ agent: localStorage.getItem('aq.myAgent'), keys: Object.keys(localStorage).filter(k => /^aq\.(myAgent|quest\.)/.test(k)), lang: localStorage.getItem('aq.lang'),
    open: !document.getElementById('birthScreen').hidden, count: document.getElementById('questCount').innerText, form: !document.getElementById('birthForm').hidden,
    warn: document.getElementById('ownerWarn').hidden, reset: document.getElementById('questReset').hidden }));
  ok(after.agent === null && after.keys.length === 0, '2回目で、このブラウザのエージェントの記録と進みぐあいを消す（残り ' + after.keys.join(',') + '）');
  ok(after.lang === 'ja', '表示言語などの好みは残す');
  ok(after.open && after.form && /^0 \//.test(after.count) && after.warn, '読み込み直すと、すぐ「自分のエージェントを作る」が開き、クエストは 0 から（' + after.count + '）');
  ok(after.reset, '消すものが無いときは、やり直すボタンを出さない');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}
{
  const { page, errs } = await setup();
  await page.click('#startBirth'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ shown: !document.getElementById('questReset').hidden, t: document.getElementById('questReset').innerText, warn: document.getElementById('ownerWarn').hidden }));
  ok(r.shown && /最初からやり直す/.test(r.t) && /チェーンに残り/.test(r.t), 'クエスト帳の下に「最初からやり直す」と、チェーンの記録は消えない説明');
  ok(r.warn, '持ち主の口座なら警告は出ない');
  await page.click('#questReset .reset-btn'); await page.waitForTimeout(3300);   // 描き直し（3秒ごと）があっても、確認待ちが消えない
  ok(await page.evaluate(() => /本当に消しますか/.test(document.querySelector('#questReset .reset-btn').innerText) && !!localStorage.getItem('aq.myAgent')), '1回目は確かめるだけで、確認待ちは描き直しでも消えない');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[部屋で見たあと、クエストへ戻る]');
{
  const did = 'did:key:z6MkRobotKeyAbcdefghijkmnopqrstuvwxyz12345';
  const { page, errs } = await setup({ seed: { 'aq.myAgent.posts': [{ room: 'lobby', seq: 7, from: did, text: 'hello from Pixel', ts: new Date().toISOString() }] } });
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#questList .quest[data-q="hello"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => { const b = document.getElementById('robotWatch'); return !b.hidden && document.getElementById('questWin').contains(b); }), 'あいさつのクエストの窓に「部屋で見る」がある');
  await page.click('#robotWatch'); await page.waitForTimeout(700);
  const v = await page.evaluate(() => ({ birth: document.getElementById('birthScreen').hidden, stage: document.getElementById('scene').dataset.stage,
    ret: !document.getElementById('questReturn').hidden, t: document.getElementById('questReturnGo').innerText,
    r: document.getElementById('questReturn').getBoundingClientRect().toJSON() }));
  ok(v.birth && v.stage === 'room', '部屋の場面に切り替わる');
  ok(v.ret && /クエストにもどる（掲示板であいさつ）/.test(v.t), '画面の上に「◀ クエストにもどる（掲示板であいさつ）」が出る（' + v.t + '）');
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: v.r.x + 20, y: v.r.y + v.r.height / 2 });
  ok(hit === 'questReturnGo', 'ほかのボタンに隠れず押せる');
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-return.png') });
  await page.click('#questReturnGo'); await page.waitForTimeout(400);
  const b = await page.evaluate(() => ({ birth: !document.getElementById('birthScreen').hidden, win: !document.getElementById('questWin').hidden, title: document.getElementById('questWinTitle').innerText, ret: document.getElementById('questReturn').hidden }));
  ok(b.birth && b.win && /掲示板であいさつ/.test(b.title) && b.ret, '押すと、同じクエストの窓に戻る（札は消える）');
  /* 仕事を頼む・納品を判定するの窓にも「部屋で見る」がある */
  for (const q of ['job', 'judge']) {
    await page.click('#questWinClose'); await page.waitForTimeout(100);
    await page.click('#questList .quest[data-q="' + q + '"]'); await page.waitForTimeout(400);
    ok(await page.evaluate(() => { const b = document.getElementById('robotWatch'); return !b.hidden && b.offsetParent !== null && document.getElementById('questWin').contains(b); }), q + ' のクエストの窓にも「部屋で見る」がある');
  }
  /* 自分で閉じたときは出さない */
  await page.click('#questWinClose'); await page.click('#birthClose'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById('questReturn').hidden), '自分で閉じたときは、戻る札を出さない');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[買ってきたニュースに日本語の訳を添える]');
{
  const ERR = [{ t: Date.now(), t0: Date.now(), shop: 'news', query: 'AI agents', price: '0.004', tx: '0x' + 'cd'.repeat(32),
    result: { kind: 'news', count: 2, articles: [{ title: 'Citi becomes latest US bank to restrict AI agents', url: 'https://example.com/a', source: 'ft.com' },
                                                  { title: 'Personal AI agents: what they do', url: 'https://example.com/b', source: 'x.com' }] } }];
  const run = async (mode) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript((o) => {
      localStorage.clear();
      localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
      localStorage.setItem('aq.myAgent.key', JSON.stringify({ d: 'x', x: 'y', did: 'did:key:z6MkRobotKeyAbc' }));
      localStorage.setItem('aq.myAgent.errands', JSON.stringify(o.err));
      if (o.mode === 'none') { try { Object.defineProperty(self, 'Translator', { value: undefined, configurable: true, writable: true }); } catch (e) {} }
      else {
        window.__created = 0;
        window.Translator = { availability: async () => (o.mode === 'broken' ? 'downloadable' : o.mode),
          create: async (opt) => { window.__created++; if (o.mode === 'broken') { const e = new Error('model unavailable'); e.name = 'NotSupportedError'; throw e; } return { translate: async (s) => '［訳］' + s.length + '文字の見出し' }; } };
      }
    }, { agent: AGENT, err: ERR, mode });
    await page.route(/^https:\/\//, r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"items":[],"messages":[]}' }));
    await page.goto(URL0); await page.waitForFunction(() => window.AQ && window.AQ.quest);
    await page.click('#startBirth'); await page.waitForTimeout(200);
    await page.click('#questList .quest[data-q="news"]'); await page.waitForTimeout(500);
    return { page, errs };
  };
  {
    const { page, errs } = await run('available');
    const v = await page.evaluate(() => ({ tr: [...document.querySelectorAll('#errandResult .tr-ja')].map(e => e.innerText), note: (document.querySelector('#errandResult .tr-note') || {}).innerText || '',
      orig: [...document.querySelectorAll('#errandResult .errand-news a')].map(a => a.innerText) }));
    ok(v.tr.length === 2 && v.tr[0] === '［訳］' + 'Citi becomes latest US bank to restrict AI agents'.length + '文字の見出し', 'ブラウザの翻訳機能があれば、各見出しの下に訳を添える（' + v.tr[0] + '）');
    ok(v.orig.length === 2 && /^Citi becomes/.test(v.orig[0]), '原文（リンク）はそのまま残す');
    ok(/機械翻訳/.test(v.note), '訳は「ブラウザの機械翻訳」と書き添える');
    await page.evaluate(() => document.getElementById('errandResult').scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-translate.png') });
    await page.click('#langPill button[data-l="en"]'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.querySelectorAll('#errandResult .tr-ja').length === 0), '英語の表示では訳を付けない');
    await page.click('#langPill button[data-l="ja"]'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.querySelectorAll('#errandResult .tr-ja').length === 2), '日本語に戻すと、また訳が出る');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  {
    const { page, errs } = await run('downloadable');
    const b0 = await page.evaluate(() => ({ btn: !!document.querySelector('#errandResult .tr-btn'), tr: document.querySelectorAll('#errandResult .tr-ja').length, created: window.__created }));
    ok(b0.btn && b0.tr === 0 && b0.created === 0, '訳の部品がまだ無いときは、勝手にダウンロードせず「日本語に訳す」ボタンを出す');
    await page.click('#errandResult .tr-btn'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.querySelectorAll('#errandResult .tr-ja').length === 2), 'ボタンを押すと訳が出る');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  {
    const { page, errs } = await run('broken');
    await page.click('#errandResult .tr-btn'); await page.waitForTimeout(300);
    const v = await page.evaluate(() => ({ tr: document.querySelectorAll('#errandResult .tr-ja').length, btn: !!document.querySelector('#errandResult .tr-btn'), href: (document.querySelector('#errandResult .tr-google') || {}).href || '', note: (document.querySelector('#errandResult .tr-note') || {}).innerText || '' }));
    ok(v.tr === 0 && !v.btn && /translate\.google\.com/.test(v.href) && /Google 翻訳/.test(v.note), 'Chrome の翻訳機能が失敗したら、Google 翻訳のリンクに切り替える（赤字のエラーは出さない・2026-10-19）（' + v.note.slice(0, 40) + '）');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  {
    const { page, errs } = await run('none');
    const v = await page.evaluate(() => ({ tr: document.querySelectorAll('#errandResult .tr-ja').length, href: (document.querySelector('#errandResult .tr-google') || {}).href || '', note: (document.querySelector('#errandResult .tr-note') || {}).innerText || '' }));
    if (process.env.DBG) console.log(await page.evaluate(() => document.getElementById('errandResult').innerHTML));
    ok(v.tr === 0, '翻訳の機能が無いブラウザでは、訳を作らない（作り話をしない）');
    ok(/^https:\/\/translate\.google\.com\/\?sl=auto&tl=ja/.test(v.href) && v.href.includes(encodeURIComponent('Citi becomes latest')), '代わりに「Google 翻訳で開く」リンク（見出しを入れて）を出す');
    ok(/Google 翻訳（外のサイト）に文が送られて/.test(v.note), 'リンクを押すと文が外のサイトに送られることを書く');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
}

console.log('\n[ほかのエージェントを評価：一覧の読み込み（Base の登録の記録から）]');
{
  const REG = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'.toLowerCase();
  const n64 = (n) => BigInt(n).toString(16).padStart(64, '0');
  const strData = (str) => { const h = Buffer.from(str).toString('hex'); return '0x' + n64(32) + n64(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64 || 64, '0'); };
  const b64 = (o) => 'data:application/json;base64,' + Buffer.from(JSON.stringify(o)).toString('base64');
  const log = (id, owner, uri, blk) => ({ address: REG, topics: ['0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a', '0x' + n64(id), '0x' + '0'.repeat(24) + owner.slice(2)], data: strData(uri), blockNumber: '0x' + blk.toString(16) });
  const O1 = '0x' + '6'.repeat(40);
  const run = async (mode) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [], calls = { bs: 0, logs: 0 }; page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript((o) => {
      if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.clear();
        localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
        localStorage.setItem('aq.myAgent.key', JSON.stringify({ d: 'x', x: 'y', did: 'did:key:z6MkRobotKeyAbc' })); }
    }, { agent: AGENT });
    await page.route('https://base.blockscout.com/**', async (r) => { calls.bs++; if (mode === 'bsonly') return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ id: '777', metadata: { name: 'Golf', description: 'from blockscout' }, owner: { hash: O1 } }], next_page_params: null }) }); });   // それ以外は返事をしない（止まる）
    await page.route('https://cards.example/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Echo', description: 'card over https' }) }));
    await page.route('https://ipfs.io/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Foxtrot', description: 'card on ipfs' }) }));
    await page.route('https://nocors.example/**', r => r.fulfill({ status: 404, body: '' }));
    await page.route('https://mainnet.base.org/**', async (r) => {
      const b = JSON.parse(r.request().postData() || '{}');
      const reply = (result) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) });
      if (mode === 'rpcdown' || mode === 'bsonly') return r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '' });
      if (b.method === 'eth_blockNumber') return reply('0x5000');
      if (b.method === 'eth_getLogs') {
        calls.logs++;
        const to = parseInt(b.params[0].toBlock, 16);
        if (mode === 'bulk') return reply(Array.from({ length: 6 }, (_, i) => log(9000 + i, '0x' + '7'.repeat(40), 'https://bulk.example/a/' + i, to)));
        if (to === 0x5000) return reply([
          ...Array.from({ length: 6 }, (_, i) => log(9000 + i, '0x' + '7'.repeat(40), 'https://bulk.example/a/' + i, to)),
          log(4001, O1, b64({ name: 'Delta', description: 'card in data uri', services: [{ name: 'A2A' }] }), to),
          log(4002, O1, 'https://cards.example/a.json', to),
          log(4003, OWNER, b64({ name: 'MySecondAgent' }), to),
          log(4004, O1, 'https://nocors.example/c.json', to) ]);
        if (to === 0x5000 - 400) return reply([log(3990, O1, 'ipfs://bafyexample', to)]);
        return reply([]);
      }
      const d = (b.params && b.params[0] && b.params[0].data) || '';
      if (d.startsWith('0xc87b56dd')) {
        if (d.endsWith(n64(1))) return reply(strData(b64({ name: 'ClawNews', description: 'live from chain', services: [{ name: 'web' }] })));
        if (d.endsWith(n64(3))) return reply(strData('https://cards.example/three.json'));
        return reply(strData('https://nocors.example/x/' + parseInt(d.slice(-8), 16)));
      }
      return reply('0x' + n64(32) + n64(0) + n64(0) + n64(0));
    });
    await page.route(/^https:\/\/(technocore|kibble)/, r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
    await page.goto(URL0); await page.waitForFunction(() => window.AQ && window.AQ.quest);
    await page.click('#startBirth'); await page.waitForTimeout(200);
    const t0 = Date.now();
    await page.click('#questList .quest[data-q="feedback"]');
    await page.waitForSelector('#fbList .fb-agent', { timeout: 3000 }).catch(() => {});
    const firstMs = Date.now() - t0;
    /* ★ 2026-10-19 名前の読めない身分証は「くわしく」の中の番号ボタン（.fb-unnamed .robot-chip）にまとめた（向こうのセッションの変更） */
    const first = await page.evaluate(() => document.querySelectorAll('#fbList .fb-agent, #fbList .fb-unnamed .robot-chip').length);
    await page.waitForTimeout(400);                                                  // 名前の読み直し（Base から1件ずつ）
    const featured = await page.evaluate(() => [...document.querySelectorAll('#fbList .fb-agent b')].map(b => b.innerText));
    if (mode !== 'nosearch') {
      await page.click('#fbMore');
      await page.waitForFunction(() => !/読んでいます/.test(document.getElementById('fbList').innerText), null, { timeout: 20000 }).catch(() => {});
    }
    return { page, errs, calls, firstMs, first, featured };
  };
  {
    const { page, errs, calls, firstMs, first, featured } = await run('chain');
    ok(first >= 6 && firstMs < 1500, '開いたらすぐ（' + firstMs + 'ms）、入れておいた初期の身分証が ' + first + ' 件並ぶ（Blockscout は返事をしない状態）');
    ok(featured.includes('#1 ClawNews') && featured.includes('#3 Echo'), '名前は Base から読み直して書き換える（data: も https も）（' + featured.slice(0, 3).join(' / ') + '）');
    const un = await page.evaluate(() => { const d = document.querySelector('#fbList .fb-unnamed'); return d ? { txt: d.textContent, ids: [...d.querySelectorAll('.robot-chip')].map(b => b.textContent.trim()) } : { txt: '', ids: [] }; });
    ok(un.ids.includes('#4') && /nocors\.example/.test(un.txt), '名前を読めないものは「くわしく」に、置き場所（サイト）ごとの番号ボタンでまとめる（' + un.ids.join(' ') + '）');
    const v = await page.evaluate(() => [...document.querySelectorAll('#fbList .fb-agent b')].map(b => b.innerText));
    ok(['#4001 Delta', '#4002 Echo', '#3990 Foxtrot'].every(x => v.includes(x)), '「ほかも探す」を押すと、Base の登録の記録から足す（data: も https も ipfs も読む）');
    ok(!v.some(x => /#900\d/.test(x)), '同じサイトから大量に登録された身分証は出さない');
    ok(!v.some(x => /4003|4660/.test(x)), '自分（同じ持ち主）の身分証は出さない');
    const un2 = await page.evaluate(() => [...document.querySelectorAll('#fbList .fb-unnamed .robot-chip')].map(b => b.textContent.trim()));
    ok(un2.includes('#4004'), '中身を読ませてくれないサイトの身分証も、番号と置き場所で選べる');
    ok(v.includes('#4001 Delta') && !v.some(x => /#4004/.test(x)), '名前と紹介の読めるものだけを大きく並べる（読めないものは畳む）');
    await page.evaluate(() => { document.querySelector('#fbList .fb-unnamed').open = true; });
    await page.click('#fbList .fb-unnamed .robot-chip:text-is("#4004")'); await page.waitForTimeout(700);
    ok(await page.evaluate(() => AQ.wizard.at().i === 1), '1画面に1ステップ：相手を選ぶと、自動で「★を付ける」へ進む');
    const pk = await page.evaluate(() => ({ link: (document.querySelector('#fbPicked a') || {}).href || '', go: !document.getElementById('fbGo').disabled }));
    ok(pk.link === 'https://nocors.example/c.json' && pk.go, '選ぶと「身分証を開く」リンクが出て、評価ボタンが押せる');
    await wz(page, 0); await page.click('#fbList .fb-agent:has-text("Delta")'); await page.waitForTimeout(300);
    ok(/card in data uri/.test(await page.evaluate(() => document.getElementById('fbPicked').innerText)), '紹介文も出る');
    await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-feedback.png') });
    /* 番号で選ぶ（折りたたみの中） */
    ok(await page.evaluate(() => !document.querySelector('.fb-byid-box').open), '番号で選ぶ欄は、ふだんは閉じている');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  {
    const { page, errs } = await run('bulk');
    const t = await page.evaluate(() => document.getElementById('fbList').innerText);
    ok(/まとめて大量に登録された身分証ばかりでした/.test(t), '大量登録ばかりなら、そう言う');
    ok(await page.evaluate(() => document.querySelectorAll('#fbList .fb-agent, #fbList .fb-unnamed .robot-chip').length >= 6), 'それでも、入れておいた身分証からは選べる');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  {
    const { page, errs } = await run('bsonly');
    await page.waitForTimeout(500);
    const v = await page.evaluate(() => [...document.querySelectorAll('#fbList .fb-agent b')].map(b => b.innerText));
    ok(v.includes('#777 Golf'), 'Base の記録が読めないときは、Blockscout から読めたものを出す（' + v.join(',') + '）');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
}

console.log('\n[はじめの画面：Agent Quest・クエストがいちばん上]');
{
  {
    const { page, errs } = await setup({ agent: null });
    const v = await page.evaluate(() => ({ logo: document.querySelector('.start-logo').innerText, title: document.title, h1: document.querySelector('header h1').innerText,
      first: document.querySelector('.start-card > section, .start-card > h3').id, dots: document.querySelectorAll('#startQuestDots li').length,
      go: document.getElementById('startQuestGoT').innerText, focus: document.activeElement && document.activeElement.id }));
    ok(v.logo === 'AGENT QUEST' && /^Agent Quest( — |$)/.test(v.title) && v.h1 === 'AGENT QUEST', 'アプリの名前は Agent Quest（ロゴ・題名・見出し）');
    ok(v.first === 'startQuest' && v.dots === 13, 'はじめの画面のいちばん上はクエスト（13 の印）');
    ok(/クエストを始める/.test(v.go) && v.focus === 'startQuestGo', '初めての人には「▶ クエストを始める」。最初からそのボタンにフォーカス');
    await page.click('#startQuestGo'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.getElementById('questWin').hidden && /ウォレットをつなぐ/.test(document.getElementById('questWinTitle').innerText)), '押すと「ウォレットをつなぐ」のクエストの窓が開く');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
  {
    const { page, errs } = await setup();
    const v = await page.evaluate(() => ({ agent: document.getElementById('startQuestAgent').innerText, go: document.getElementById('startQuestGoS').innerText, done: document.querySelectorAll('#startQuestDots li.done').length }));
    ok(/#4660「ピクセル」/.test(v.agent) && /次のクエスト：掲示板であいさつ/.test(v.go) && v.done === 2, '続きの人には、自分のエージェントと「次のクエスト」・済んだ印（' + v.done + '）');
    await page.click('#startQuestGo'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => /掲示板であいさつ/.test(document.getElementById('questWinTitle').innerText)), '「▶ 続きから」で次のクエストの窓が開く');
    ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
    await page.close();
  }
}

console.log('\n[もう一度見る：動き i / n・はじめから全部]');
{
  const { page, errs } = await setup();
  await page.evaluate(() => { document.getElementById('startScreen').hidden = true; AQ.app.startIntro(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(2); c.onFrame(); });
  if (await page.evaluate(() => document.getElementById('cmdWin').dataset.cmd !== 'inspect')) await page.click('#cmdInspect');
  await page.waitForTimeout(150);
  const mid = await page.evaluate(() => ({ t: document.getElementById('cmdWinBody').innerText, n: AQ.app.clock.beats.length }));
  if (process.env.DBG) console.log(JSON.stringify(mid));
  ok(new RegExp('動き 3 / ' + mid.n).test(mid.t) && new RegExp('この動き（3/' + mid.n + '）だけもう一度').test(mid.t) && /はじめから全部見る/.test(mid.t), '途中では「動き 3 / n」と、「この動き（3/n）だけもう一度」「はじめから全部見る」の2つ');
  await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(c.beats.length - 1); c.elapsed = c.durationOf(c.index) + 1; c.onFrame(); });
  await page.waitForTimeout(150);
  const end = await page.evaluate(() => ({ t: document.getElementById('cmdWinBody').innerText, replay: !!document.querySelector('#cmdWinBody [data-act="replay"]'), big: !!document.querySelector('#cmdWinBody .cmd-restart') }));
  ok(/おわり/.test(end.t) && !end.replay && end.big, '最後まで見終わったら「おわり」と出て、「はじめから全部見る」だけを大きく出す（動かないボタンは出さない）');
  await page.click('#cmdWinBody [data-act="restart"]'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ i: AQ.app.clock.index, playing: AQ.app.clock.playing }));
  ok(r.i === 0 && r.playing, '押すと、はじめ（動き 1）から再生する');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[1画面に1ステップ（2026-10-19）]');
{
  const { page, errs } = await setup();
  await page.click('#startBirth'); await page.waitForTimeout(200);
  const at = () => page.evaluate(() => AQ.wizard.at());
  const seen = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && !!e.offsetParent; }, id);
  /* 生み出した直後は「次は掲示板であいさつ」へ進む道をはっきり出す（2026-10-19 利用者「ここだけ次に進むべき方向が不明瞭」） */
  ok(await page.evaluate(() => /まず掲示板であいさつ/.test(document.getElementById('questNextS').innerText) && !document.getElementById('birthNextQuest').hidden), '生まれた直後は「まず掲示板であいさつ」と案内し、生まれた知らせの下にも大きなボタンを出す');
  await page.click('#questList .quest[data-q="create"]'); await page.waitForTimeout(400);
  ok(await seen('questWinCta'), '「エージェントを生み出す」の窓にも「次は掲示板であいさつ」の大きなボタン');
  await page.click('#questWinCta'); await page.waitForTimeout(400);
  ok(/掲示板であいさつ/.test(await page.evaluate(() => document.getElementById('questWinTitle').innerText)), 'そのボタンで、あいさつのクエストの窓へ移る');
  await page.click('#questWinClose'); await page.waitForTimeout(200);
  /* 身分証：得意なこと（いくつでも → 次へ）→ 紹介（押すと自動で次へ）→ 確かめて書き込む */
  await page.click('#questList .quest[data-q="card"]'); await page.waitForTimeout(400);
  ok((await at()).i === 0 && await seen('cardSkills') && !(await seen('cardIntros')) && !(await seen('cardGo')), '最初のステップは「得意なこと」だけが出る');
  ok(await seen('questWinLearn') && /ステップ 1 \/ 3/.test(await page.evaluate(() => document.getElementById('wzHead').innerText)), '上に「ステップ 1 / 3」の見出し。最初のステップだけ 💡 の説明も出る');
  await page.click('#wzNext'); await page.waitForTimeout(400);
  ok((await at()).i === 1 && await seen('cardIntros') && !(await seen('questWinLearn')), '「次へ」で紹介文を選ぶステップへ。2画面目からは長い説明をしまう');
  await page.click('#cardIntros .robot-choice >> nth=1'); await page.waitForTimeout(700);
  ok((await at()).i === 2 && await seen('cardGo') && await seen('cardVisual'), '紹介文を押すと、自動で「確かめて書き込む」へ進む');
  const chips = await page.evaluate(() => [...document.querySelectorAll('#wzHead .wz-chip')].map(c => c.innerText));
  ok(chips.length === 2, '前のステップで選んだものが札で残る（' + chips.join(' / ').replace(/\n/g, ' ') + '）');
  await page.click('#wzHead .wz-chip >> nth=0'); await page.waitForTimeout(400);
  ok((await at()).i === 0, '札を押すと、そのステップへ戻れる');
  await page.click('#questWinClose'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.querySelector('#robotCard .wz-off') && document.getElementById('robotBox').contains(document.getElementById('robotCard'))), '窓を閉じると、隠していた部品は元どおり（ロボットの欄では全部見える）');
  /* 仕事を頼む：「自分で書く」は自動で進まず、書くと「次へ」が出る */
  await page.click('#questList .quest[data-q="job"]'); await page.waitForTimeout(400);
  await page.click('#robotChoices .robot-choice[data-key="free"]'); await page.waitForTimeout(600);
  ok((await at()).i === 0 && !(await seen('wzNext')), '「自分で書く」を選んでも勝手に進まない（まだ書いていないので「次へ」も出さない）');
  await page.fill('#robotJobTitle', 'Write a haiku about Base'); await page.waitForTimeout(150);
  ok(await seen('wzNext'), '書くと「次へ」が出る');
  await page.click('#wzNext'); await page.waitForTimeout(400);
  ok((await at()).i === 1 && await seen('robotJobGo') && !(await seen('robotChoices')), '「次へ」で「掲示板に貼る」ボタンだけの画面へ');
  await page.click('#questWinClose'); await page.waitForTimeout(200);
  /* 郵便受け：まだ開いていなければ、ステップ 1（開く）から */
  await page.click('#questList .quest[data-q="mail"]'); await page.waitForTimeout(400);
  ok((await at()).i === 0 && await seen('mailOpenBtn') && !(await seen('mailSend')), '郵便受けは、まず「開く」だけ');
  await page.click('#questWinClose'); await page.waitForTimeout(200);
  /* あいさつ（ボタン1つ）は今のまま */
  await page.click('#questList .quest[data-q="hello"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => AQ.wizard.at() === null && document.getElementById('wzHead').hidden), 'ボタン1つで終わるクエストは、ステップの見出しを出さない');
  await page.click('#questWinClose'); await page.waitForTimeout(200);
  /* 判定の読み込みを待つあいだに別のクエストへ移っても、判定の案内が別の窓に出ない（2026-10-19 利用者の報告：評価の窓に赤字） */
  await page.route('https://kibble.world/**', async (r) => { await new Promise(res => setTimeout(res, 1200)); r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"jobs":[]}' }); });
  await page.evaluate(() => localStorage.setItem('aq.myAgent.jobs', JSON.stringify([{ id: 'kold000001', title: 'old job', t: Date.now() - 9e8, seq: 1 }])));
  await page.click('#questList .quest[data-q="judge"]'); await page.waitForTimeout(150);
  await page.click('#questWinNext'); await page.waitForTimeout(1800);
  ok(await page.evaluate(() => !/判定/.test(document.getElementById('questSay').innerText) && !/判定/.test(document.getElementById('questWinTitle').innerText)), '判定の読み込み中に次のクエストへ移っても、判定の案内はそちらの窓に出ない');
  await page.click('#questWinClose'); await page.waitForTimeout(200);
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[クエスト1の窓は「つなぐ」だけ（2026-10-22）]');
{
  const { page, errs } = await setup({ agent: null });
  await page.click('#startBirth'); await page.waitForTimeout(300);
  const seen = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && !!e.offsetParent; }, id);
  await page.click('#questList .quest[data-q="connect"]'); await page.waitForTimeout(400);
  ok(await seen('birthConnect') && !(await seen('birthName')) && !(await seen('birthGo')), 'クエスト1の窓には「ウォレットをつなぐ」だけ（名前の欄と「作る」は出ない）');
  await page.click('#birthConnect'); await page.waitForTimeout(800);
  await page.waitForFunction(() => !document.querySelector('#questList .quest[data-q="create"]').disabled, null, { timeout: 5000 }).catch(() => {});
  await page.click('#questWinClose'); await page.waitForTimeout(200);
  await page.click('#questList .quest[data-q="create"]', { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(400);
  ok(await seen('birthName') && await seen('birthGo'), 'クエスト2の窓には、名前の欄と「作る」が出る');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[スマホの幅]');
{
  const { page, errs } = await setup({ vp: { width: 390, height: 844 } });
  await page.click('#startBirth'); await page.waitForTimeout(300);
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, list: document.getElementById('questList').getBoundingClientRect().width,
    over: [...document.querySelectorAll('#questList .quest')].some(b => b.scrollWidth > b.clientWidth + 2) }));
  ok(w.sw <= 390 && !w.over, '横にはみ出さない（' + w.sw + 'px）');
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-quest-mobile.png') });
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[English]');
{
  const { page, errs } = await setup();
  await page.evaluate(() => document.getElementById('lang').click());
  await page.click('#startBirth'); await page.waitForTimeout(300);
  const t = await page.evaluate(() => document.getElementById('questBook').innerText);
  ok(!/[ぁ-んァ-ン]/.test(t), '英語表示ではクエスト帳に日本語が残らない（' + t.slice(0, 50).replace(/\n/g, ' ') + '）');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

await browser.close(); server.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
