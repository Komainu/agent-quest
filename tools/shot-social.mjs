/* tools/shot-social.mjs — 「ほかのエージェントを評価」「郵便受け」の検査（2026-10-11）
   使い方: node tools/shot-social.mjs   （dist/agent-quest.html を先に build）
   本物のチェーン・technocore には書かない。通信を横取りして、送られた中身を確かめる。 */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'dist', 'agent-quest.html'))); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/';
const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER_OWNER = '0x3333333333333333333333333333333333333333';
const AGENT = { agentId: '4660', name: 'ピクセル', owner: OWNER, tx: '0x' + 'ab'.repeat(32), chain: 8453, t: Date.now() };
const REP = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const WORKER = 'did:key:z6MkWorkerAgentAbcdefghijkmnopqrstuvwxyz1234567';
const VALID = 'did:key:z6MkValidatorAgentAbcdefghijkmnopqrstuvwxy123';
const JOB = 'k0123456789';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const n64 = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
const fp = (d) => crypto.createHash('sha256').update(d).digest('hex').slice(0, 16);
/* readAllFeedback の答え（7つの配列）を ABI の形で作る */
function encodeAll(rows) {
  const n = rows.length;
  const addrArr = n64(n) + rows.map(r => n64(BigInt(r.client))).join('');
  const u64Arr = n64(n) + rows.map((r, i) => n64(i + 1)).join('');
  const valArr = n64(n) + rows.map(r => n64(r.value)).join('');
  const decArr = n64(n) + rows.map(() => n64(0)).join('');
  const strArr = (s) => { if (!n) return n64(0); const h = Buffer.from(s).toString('hex'); const one = n64(h.length / 2) + h.padEnd(64, '0'); let off = n * 32; let heads = '', tails = ''; rows.forEach(() => { heads += n64(off); tails += one; off += one.length / 2; }); return n64(n) + heads + tails; };
  const boolArr = n64(n) + rows.map(() => n64(0)).join('');
  const parts = [addrArr, u64Arr, valArr, decArr, strArr('starred'), strArr(''), boolArr];
  let off = 7 * 32, head = '';
  parts.forEach(p => { head += n64(off); off += p.length / 2; });
  return '0x' + head + parts.join('');
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function setup(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [], sent = [], posts = [], notes = [];
  const rooms = {};
  page.on('pageerror', e => errs.push(e.message));
  await page.exposeFunction('__sent', (tx) => { sent.push(tx); });
  await page.addInitScript((o) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
    localStorage.setItem('aq.myAgent.jobs', JSON.stringify([{ id: o.job, kind: 'explain', title: 'Explain x402', seq: 10, t: Date.now() - 3 * 3600 * 1000 }]));
    const n64 = (n) => BigInt(n).toString(16).padStart(64, '0');
    window.ethereum = { request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [o.owner];
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_sendTransaction') { await window.__sent(params[0]); return '0x' + 'aa'.repeat(32); }
      if (method === 'eth_getTransactionReceipt') {
        const id = BigInt('0x' + window.__lastData.slice(10, 74));
        return { status: '0x1', logs: [{ address: o.rep, topics: ['0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc', '0x' + n64(id), '0x' + n64(BigInt(o.owner))] }] };
      }
      return null;
    } };
    const orig = window.ethereum.request;
    window.ethereum.request = (a) => { if (a.method === 'eth_sendTransaction') window.__lastData = a.params[0].data; return orig(a); };
  }, { agent: AGENT, owner: OWNER, rep: REP, job: JOB });
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  await page.route('https://base.blockscout.com/**', (route) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ next_page_params: null, items: [
    { id: '4660', metadata: { name: 'ピクセル', description: 'mine' }, owner: { hash: OWNER } },
    { id: '99891', metadata: { name: 'Vumpondo', description: 'An agent <img src=x onerror="window.__xss=1"> in shared rooms', services: [{ name: 'A2A', endpoint: 'https://x' }] }, owner: { hash: opts.selfTarget ? OWNER : OTHER_OWNER } },
    { id: '99890', metadata: { name: 'Second', description: '' }, owner: { hash: OTHER_OWNER } },
    { id: '99889', metadata: null } ] }) }));
  await page.route('https://mainnet.base.org/**', async (route) => {
    const b = JSON.parse(route.request().postData());
    if (b.method === 'eth_blockNumber') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x10' }) });
    if (b.method === 'eth_getLogs') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }) });   // この検査では Base の登録の記録は空（Blockscout の一覧を使う）
    const d = b.params[0].data;
    const id = BigInt('0x' + d.slice(10, 74));
    const rows = id === 99891n ? [{ client: '0x' + '44'.repeat(20), value: 80 }, { client: '0x' + '55'.repeat(20), value: 100 }] : (id === 4660n ? [{ client: '0x' + '66'.repeat(20), value: 60 }] : []);
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: encodeAll(rows) }) });
  });
  await page.route('https://kibble.world/**', (route) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ jobs: [{ job_id: JOB, title: 'Explain x402', status: 'attested', worker_did: WORKER, result: 'x402 is…', result_hash: 'ab12', attestations: [{ did: VALID, verdict: 'useful' }] }] }) }));
  await page.route('https://technocore.chat/**', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname.startsWith('/kv/')) {
      if (req.method() === 'POST') { notes.push({ path: u.pathname, body: JSON.parse(req.postData()) }); return route.fulfill({ status: 200, headers: cors, body: '{"ok":true}' }); }
      const wf = fp(WORKER), vf = fp(VALID);
      if (u.pathname === '/kv/did-' + wf.slice(0, 2) + '/' + wf.slice(2)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }, body: '!! UNTRUSTED CONTENT\n' + WORKER + ' x25519:abc mailbox:mb-p-workerbox123 role:worker' });
      if (u.pathname === '/kv/did-' + vf.slice(0, 2) + '/' + vf.slice(2)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }, body: '!! UNTRUSTED CONTENT\n' + VALID + ' mailbox:kibble' });
      return route.fulfill({ status: 404, headers: cors, body: '' });
    }
    const m = u.pathname.match(/^\/r\/([a-z0-9_-]+)$/);
    if (m && req.method() === 'POST') {
      const b = JSON.parse(req.postData()); posts.push({ room: m[1], ...b });
      const rec = { seq: 100 + posts.length, from: b.did, text: b.text, nonce: b.nonce, sig: b.sig, ts: new Date().toISOString() };
      (rooms[m[1]] = rooms[m[1]] || []).push(rec);
      if (/^mb-p-[0-9a-f]{24}$/.test(m[1]) && rooms[m[1]].length === 1) rooms[m[1]].push({ seq: 200, from: WORKER, text: 'Hi! <b>letter</b> from worker', ts: new Date().toISOString(), sig: 'x' });
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ posted: rec }) });
    }
    if (m) { const since = Number(u.searchParams.get('since') || 0); return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ messages: (rooms[m[1]] || []).filter(x => x.seq > since) }) }); }
    return route.fulfill({ status: 200, headers: cors, body: '{}' });
  });
  await page.goto(URL0);
  await page.waitForFunction(() => window.AQ && window.AQ.app && window.AQ.mailbox);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  return { page, errs, sent, posts, notes, rooms };
}
const st = (page) => page.evaluate(() => document.getElementById('robotStatus').innerText);

console.log('\n[ほかのエージェントを評価]');
{
  const { page, errs, sent } = await setup();
  await page.click('#robotFeedbackOpen');
  /* ★ 2026-10-19 名前の読めない身分証は「くわしく」の中の番号ボタン（.fb-unnamed .robot-chip）にまとめた */
  const list0 = await page.evaluate(() => [...document.querySelectorAll('#fbList .fb-agent b, #fbList .fb-unnamed .robot-chip')].map(b => b.innerText.trim()));
  ok(list0.length >= 6 && list0.some(x => /^#1( |$)/.test(x)), '開いたらすぐ、入れておいた初期の身分証が並ぶ（待たない）（' + list0.length + ' 件）');
  await page.click('#fbMore');                                                   // ほかのエージェントも探す
  await page.waitForFunction(() => /Vumpondo/.test(document.getElementById('fbList').innerText), null, { timeout: 12000 }).catch(() => {});
  const list = await page.evaluate(() => [...document.querySelectorAll('#fbList .fb-agent b')].map(b => b.innerText).filter(x => !/^#(1|2|3|4|5|6) /.test(x)));
  ok(list.length === 2 && list[0] === '#99891 Vumpondo' && !list.some(x => /4660/.test(x)), '「ほかも探す」で Blockscout の身分証が足される（自分と、名前の無いものは出さない）：' + list.join(' / '));
  await page.waitForFunction(() => /60/.test(document.getElementById('fbMine').innerText), null, { timeout: 4000 }).catch(() => {});
  ok(/1 件・平均 60/.test(await page.evaluate(() => document.getElementById('fbMine').innerText)), '自分のロボットの評判（ERC-8004）も出る');
  await page.click('#fbList .fb-agent:has-text("Vumpondo")');
  await page.waitForFunction(() => /平均/.test(document.getElementById('fbPicked').innerText), null, { timeout: 4000 }).catch(() => {});
  const pk = await page.evaluate(() => ({ t: document.getElementById('fbPicked').innerText, img: !!document.querySelector('#fbPicked img'), xss: !!window.__xss }));
  ok(/2 件・平均 90/.test(pk.t), 'これまでの評価を readAllFeedback から数えて出す（2 件・平均 90）');
  ok(!pk.img && !pk.xss && /<img/.test(pk.t), '相手の紹介文はただの文字（画像やスクリプトとして動かない）');
  ok(/A2A/.test(pk.t), '公開しているサービスの名前も出る');
  await page.click('#fbStars button[data-n="3"]');
  ok(/100 点満点の 60 点/.test(await page.evaluate(() => document.getElementById('fbValue').innerText)), '★3 はチェーンに 100 点満点の 60 点として残る（表記は 2026-10-19 に分かりやすく変更）');
  await page.click('#fbGo');
  await page.waitForFunction(() => /評価を残しました|失敗|できません/.test(document.getElementById('robotStatus').innerText), null, { timeout: 8000 }).catch(() => {});
  ok(/★3 の評価を残しました/.test(await st(page)), '取引の記録（NewFeedback）で確かめてから「残しました」と言う');
  const tx = sent[0] || {};
  ok(tx.to === REP && tx.value === '0x0' && tx.data.startsWith('0x3c036a7e' + n64(99891) + n64(60) + n64(0)), 'giveFeedback(99891, 60, 0, …) を評判の登録先へ');
  const hex = (s) => Buffer.from(s).toString('hex');
  ok(tx.data.includes(hex('starred')) && tx.data.includes(hex('profile')) && tx.data.endsWith('8021'.repeat(8)), 'tag1 = starred・tag2 = profile、末尾に Builder Code');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.evaluate(() => document.getElementById('robotFeedback').scrollIntoView());
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-social-fb.png') });
  await page.close();
  const s2 = await setup({ selfTarget: true });
  await s2.page.click('#robotFeedbackOpen'); await s2.page.click('#fbMore');
  await s2.page.waitForFunction(() => /Vumpondo/.test(document.getElementById('fbList').innerText), null, { timeout: 12000 }).catch(() => {});
  await s2.page.click('#fbList .fb-agent:has-text("Vumpondo")'); await s2.page.click('#fbGo'); await s2.page.waitForTimeout(800);
  ok(/自分への評価は禁止/.test(await st(s2.page)) && s2.sent.length === 0, '自分の財布のエージェントには、取引を送らない');
  await s2.page.close();
}

console.log('\n[郵便受け]');
{
  const { page, errs, posts, notes } = await setup();
  await page.click('#robotMailOpen');
  ok(/まだ郵便受けはありません/.test(await page.evaluate(() => document.getElementById('mailState').innerText)), 'はじめは郵便受けが無い');
  await page.click('#mailOpenBtn');
  await page.waitForFunction(() => /郵便受けを開きました|書けませんでした/.test(document.getElementById('robotStatus').innerText), null, { timeout: 8000 }).catch(() => {});
  const p0 = posts[0] || {};
  ok(/^mb-p-[0-9a-f]{24}$/.test(p0.room || '') && /^did:key:z6Mk/.test(p0.did || ''), '郵便受けは mb-p-<24桁の乱数> の部屋。署名して最初の1行を書いて作る（' + p0.room + '）');
  const note = notes[notes.length - 1] || { body: {} };
  ok(String(note.body.value).startsWith(p0.did + ' mailbox:' + p0.room), '名刺（DID のノート）は「<did:key> mailbox:<部屋名> …」（technocore の慣習どおり）');
  await page.waitForFunction(() => document.querySelectorAll('#mailLetters .mail-letter').length > 0, null, { timeout: 8000 }).catch(() => {});
  const lt = await page.evaluate(() => ({ t: document.getElementById('mailLetters').innerText, b: !!document.querySelector('#mailLetters b') , btn: document.getElementById('robotMailOpen').innerText }));
  ok(/<b>letter<\/b> from worker/.test(lt.t) && !lt.b, '届いた手紙が出る（ただの文字として）');
  ok(!/is open/.test(lt.t), '自分の「開きました」の行は手紙に数えない');
  await page.waitForFunction(() => document.querySelectorAll('#mailPeers .robot-choice').length >= 2, null, { timeout: 8000 }).catch(() => {});
  const peers = await page.evaluate(() => [...document.querySelectorAll('#mailPeers .robot-choice')].map(b => ({ t: b.innerText.replace(/\n/g, ' / '), dis: b.disabled })));
  /* ★ 2026-10-19 郵便受けの無い相手は、宛先の候補に出さない（向こうのセッションの変更）＝検品した子（kibble の部屋名）は出ない */
  ok(peers.length === 2, '宛先は「自分のロボット」と、郵便受けのある「引き受けた子」（' + peers.map(p => p.t).join(' | ') + '）');
  const w = peers.find(p => /引き受けた子/.test(p.t)), v = peers.find(p => /検品した子/.test(p.t));
  ok(w && !w.dis && /郵便受けあり/.test(w.t), '引き受けた子の名刺から郵便受けを見つける');
  ok(!v, '名刺の mailbox が mb-/p- で始まらない（kibble など）相手は、宛先に出さない');
  await page.click('#mailPeers .robot-choice:not([disabled]) >> text=引き受けた子');
  await page.click('#mailTexts .robot-choice[data-key="thanksJob"]');
  await page.click('#mailSendBtn');
  await page.waitForFunction(() => /届けました/.test(document.getElementById('robotStatus').innerText), null, { timeout: 6000 }).catch(() => {});
  const last = posts[posts.length - 1] || {};
  ok(last.room === 'mb-p-workerbox123' && /^Thank you for taking my job on kibble! - ピクセル \(ERC-8004 agent #4660 on Base\)$/.test(last.text) && last.did === p0.did, '引き受けた子の郵便受けに、署名したお礼の手紙を届ける（' + last.text + '）');
  const ok2 = await page.evaluate(() => [AQ.mailbox._parseNote('did:key:zA mailbox:mb-p-abc', 'did:key:zA'), AQ.mailbox._parseNote('did:key:zB mailbox:mb-p-abc', 'did:key:zA'), AQ.mailbox._parseNote('did:key:zA mailbox: p-xyz9', 'did:key:zA'), AQ.mailbox._parseNote('did:key:zA mailbox:lobby', 'did:key:zA')]);
  ok(ok2[0] === 'mb-p-abc' && ok2[1] === null && ok2[2] === 'p-xyz9' && ok2[3] === null, '名刺の読み方：本人の did のあとの mailbox だけ・mb-/p- だけ');
  /* 自分の郵便受けに出す → すぐ「届いた手紙」に入る（待たない） */
  await page.click('#mailPeers .robot-choice >> text=自分のロボット');
  await page.click('#mailTexts .robot-choice[data-key="hello"]');
  await page.click('#mailSendBtn');
  await page.waitForFunction(() => /自分の郵便受けに手紙を出しました/.test(document.getElementById('robotStatus').innerText), null, { timeout: 6000 }).catch(() => {});
  const self = await page.evaluate(() => ({ st: document.getElementById('robotStatus').innerText, t: document.getElementById('mailLetters').innerText }));
  ok(/届いた手紙」に入りました/.test(self.st) && /Hello! I am ピクセル/.test(self.t) && /📬 届いた手紙/.test(self.t), '自分の郵便受けに出した手紙は、すぐ「📬 届いた手紙」に入る');
  await page.evaluate(() => document.getElementById('robotMail').scrollIntoView());
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-social-mail.png') });
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

await browser.close();
server.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
