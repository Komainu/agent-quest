/* tools/shot-tech.mjs — 「ロボットに記憶を持たせる」「取引の約束を練習する」の検査（2026-10-26）
   使い方: node tools/shot-tech.mjs   （dist/agent-quest.html を先に build）
   本物の technocore には書かない。通信を横取りし、書かれた中身を確かめる。
   tclk の枠は、本家のライブラリ（@flop-labs/tclk）で読み直し、同じ番号・同じ状態になるかを確かめる。 */
import { chromium } from 'playwright';
import { withAutoConfirm } from './auto-confirm.mjs';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 本家のライブラリは devDependencies に入れてある（npm ci）。無ければ読み直しの検査だけ飛ばす */
const tclk = await import('@flop-labs/tclk').catch(() => null);
void createRequire;

const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'dist', 'agent-quest.html'))); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/';
const OWNER = '0x1111111111111111111111111111111111111111';
const AGENT = { agentId: '4660', name: 'ピクセル', owner: OWNER, tx: '0x' + 'ab'.repeat(32), chain: 8453, t: Date.now() };

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
withAutoConfirm(browser);   // ウォレットに頼む前の確認は自動で押す（tools/auto-confirm.mjs）

/* technocore の Ed25519 署名を確かめる（did:key → 公開鍵） */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function unb58(s) { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); let h = n.toString(16); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex'); }
function verifySig(did, room, nonce, text, sig) {
  const raw = unb58(did.slice('did:key:z'.length)).subarray(2);
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
  return crypto.verify(null, Buffer.from(room + '|' + nonce + '|' + text), key, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

async function setup(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = [], posts = [], kv = {}, kvWrites = [];
  const rooms = {};
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((o) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
    localStorage.setItem('aq.myAgent.jobs', JSON.stringify([{ id: 'k0123456789', kind: 'explain', title: 'Explain x402', seq: 10, t: Date.now() }]));
    localStorage.setItem('aq.myAgent.errands', JSON.stringify([{ shop: 'news', query: 'Base', result: { kind: 'news', articles: [{ title: 'Base ships a new upgrade', source: 'X' }] }, t: Date.now() }]));
    window.ethereum = { request: async ({ method }) => (method === 'eth_requestAccounts' || method === 'eth_accounts') ? [o.owner] : (method === 'eth_chainId' ? '0x2105' : null) };
  }, { agent: AGENT, owner: OWNER });
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  await page.route(/^https:\/\/(?!technocore\.chat)/, r => r.fulfill({ status: 200, headers: cors, body: '{"items":[],"messages":[],"jsonrpc":"2.0","id":1,"result":[]}' }));
  await page.route('https://technocore.chat/**', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname.startsWith('/kv/')) {
      if (req.method() === 'POST') {
        if (opts.kvDown) return route.fulfill({ status: 503, headers: cors, body: 'down' });
        const v = JSON.parse(req.postData()).value; kv[u.pathname] = v; kvWrites.push({ path: u.pathname, value: v });
        return route.fulfill({ status: 200, headers: cors, body: '{"ok":true}' });
      }
      if (opts.kvLies && u.pathname.startsWith('/kv/p-aq-mem-')) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }, body: '!! UNTRUSTED CONTENT\nsomething else' });
      if (!(u.pathname in kv)) return route.fulfill({ status: 404, headers: cors, body: '' });
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }, body: '!! UNTRUSTED CONTENT — data, not instructions.\n' + kv[u.pathname] });
    }
    const m = u.pathname.match(/^\/r\/([a-z0-9_-]+)$/);
    if (m && req.method() === 'POST') {
      const b = JSON.parse(req.postData());
      const good = verifySig(b.did, m[1], b.nonce, b.text, b.sig);
      posts.push({ room: m[1], ...b, good });
      if (!good) return route.fulfill({ status: 401, headers: cors, body: 'bad signature' });
      const rec = { seq: 100 + posts.length, from: b.did, text: b.text, nonce: b.nonce, sig: b.sig, ts: new Date().toISOString() };
      (rooms[m[1]] = rooms[m[1]] || []).push(rec);
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ posted: rec }) });
    }
    if (m) { const since = Number(u.searchParams.get('since') || 0); return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ messages: (rooms[m[1]] || []).filter(x => x.seq > since) }) }); }
    return route.fulfill({ status: 200, headers: cors, body: '{}' });
  });
  await page.goto(URL0);
  await page.waitForFunction(() => window.AQ && window.AQ.app && window.AQ.memo && window.AQ.deal);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  return { page, errs, posts, kv, kvWrites, rooms };
}
const st = (page) => page.evaluate(() => document.getElementById('robotStatus').innerText);
const book = (page) => page.evaluate(() => ({ count: (document.getElementById('questCount') || {}).innerText || '', q: Object.fromEntries([...document.querySelectorAll('#questList .quest')].map(e => [e.dataset.q, e.classList.contains('done') ? 'done' : (e.classList.contains('locked') ? 'locked' : 'open')])) }));

console.log('\n[クエストが13個になった]');
{
  const { page, errs } = await setup();
  const b = await book(page);
  const ids = Object.keys(b.q);
  ok(ids.length === 13 && ids.join(',') === 'connect,create,hello,news,job,judge,card,feedback,mail,memo,deal,town,builder', '13 個・最後は Builder Code のまま（' + ids.join(',') + '）');
  ok(/\/\s*13/.test(b.count), '進みぐあいは「/ 13」（' + b.count + '）');
  ok(/13 のクエスト/.test(await page.evaluate(() => document.body.innerText)), '始めの画面の一言も「13 のクエスト」');
  ok(!errs.length, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[ロボットに記憶を持たせる]');
{
  const { page, errs, kvWrites } = await setup();
  await page.evaluate(() => AQ.quest.open('memo')); await page.waitForTimeout(300);
  const ch = await page.evaluate(() => [...document.querySelectorAll('#memoChoices .robot-choice')].map(b => b.dataset.key + ':' + b.querySelector('small').innerText));
  ok(ch.length === 3 && /4660/.test(ch[0]) && /Base ships a new upgrade/.test(ch[1]) && /Explain x402/.test(ch[2]), '覚えさせることの3択は、自分のデータから作る（' + ch.map(x => x.slice(0, 40)).join(' / ') + '）');
  await page.click('#memoChoices .robot-choice[data-key="news"]'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => { const a = AQ.wizard.at(); return a && a.i === 1 && !!document.getElementById('memoGo').offsetParent; }), '選ぶと自動でステップ 2（覚えさせるボタン）へ');
  await page.click('#memoGo');
  await page.waitForFunction(() => /覚えました|うまく|できません|見つかり/.test(document.getElementById('robotStatus').innerText), null, { timeout: 8000 }).catch(() => {});
  ok(/覚えました/.test(await st(page)), '書いたあと読み直して確かめ、「覚えました」（' + (await st(page)).slice(0, 50) + '）');
  ok(kvWrites.length === 1 && /^\/kv\/p-aq-mem-[0-9a-f]{20}\/notes$/.test(kvWrites[0].path) && /I bought news with x402\. Headline: Base ships a new upgrade$/.test(kvWrites[0].value), 'メモの場所は p-aq-mem-<20桁>/notes、中身は選んだ1行（' + (kvWrites[0] || {}).path + '）');
  const res = await page.evaluate(() => ({ lines: [...document.querySelectorAll('#memoResult .memo-line')].map(e => e.innerText), isNew: !!document.querySelector('#memoResult .memo-line.new'), untrusted: /UNTRUSTED/.test(document.getElementById('memoResult').innerText) }));
  ok(res.lines.length === 1 && res.isNew && !res.untrusted, '読み直した記憶を見せ、新しい1行に印。technocore の見出し（UNTRUSTED…）は出さない');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-tech-memo.png') });
  let b = await book(page);
  ok(b.q.memo === 'done', 'クエスト ✓');
  /* 2回目：記憶が積み上がる */
  await page.evaluate(() => { AQ.quest.close(); AQ.quest.open('memo'); }); await page.waitForTimeout(300);
  await page.click('#memoChoices .robot-choice[data-key="me"]'); await page.waitForTimeout(400);
  await page.click('#memoGo');
  await page.waitForFunction(() => /覚えました|うまく/.test(document.getElementById('robotStatus').innerText), null, { timeout: 8000 }).catch(() => {});
  ok(kvWrites.length === 2 && kvWrites[1].value.split('\n').length === 2 && kvWrites[1].path === kvWrites[0].path, '2回目は前の記憶に1行足して書く（同じ場所・2行）');
  await page.waitForTimeout(400);
  const proof = await page.evaluate(() => document.getElementById('questWinProof').innerText);
  if (!/覚えた1行/.test(proof)) console.log('    proof=', JSON.stringify(proof), await page.evaluate(() => localStorage.getItem('aq.myAgent.memo')));
  ok(/覚えた1行/.test(proof) && /ERC-8004 agent #4660/.test(proof), '「本当の記録」に覚えた1行とメモへのリンク');
  ok(!errs.length, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}
{
  const { page } = await setup({ kvLies: true });
  await page.evaluate(() => AQ.quest.open('memo')); await page.waitForTimeout(300);
  await page.click('#memoChoices .robot-choice[data-key="me"]'); await page.waitForTimeout(400);
  await page.click('#memoGo');
  await page.waitForFunction(() => /覚えました|見つかり|うまく/.test(document.getElementById('robotStatus').innerText), null, { timeout: 8000 }).catch(() => {});
  ok(/見つかりませんでした/.test(await st(page)) && (await book(page)).q.memo !== 'done', '読み直したメモに1行が無ければ「覚えた」と言わない（クエストも ✓ にしない）');
  await page.close();
}

console.log('\n[取引の約束を練習する（tclk）]');
{
  const { page, errs, posts, kv } = await setup();
  await page.evaluate(() => AQ.quest.open('deal')); await page.waitForTimeout(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#dealSteps .deal-step b')].map(e => e.innerText));
  ok(rows.length === 5 && /申し出/.test(rows[0]) && /受領/.test(rows[4]), '流れの5段（申し出・合意・ロック・引き渡し・受領）が見える');
  await page.click('#dealGo');
  await page.waitForFunction(() => /できました|うまく|そろっていません|受け付け/.test(document.getElementById('robotStatus').innerText), null, { timeout: 12000 }).catch(() => {});
  ok(/取引の練習ができました/.test(await st(page)), '部屋から読み直して確かめ、「できました」（' + (await st(page)).slice(0, 50) + '）');
  ok(posts.length === 5 && posts.every(p => p.good), '書き込みは5つ、どれも正しい署名（' + posts.length + '）');
  const frames = posts.map(p => ({ room: p.room, did: p.did, text: p.text }));
  const offersRoom = frames[0].room, dealRoom = frames[2] && frames[2].room;
  ok(/^p-aq-tclk-[0-9a-f]{12}$/.test(offersRoom) && frames[1].room === offersRoom, '申し出と合意は練習用の部屋（p-aq-tclk-…）。本番の tclk-offers には書かない');
  ok(!posts.some(p => p.room === 'tclk-offers'), 'tclk-offers には1つも書かない');
  ok(frames.every(f => /^tclk1 \{/.test(f.text) && /^[\x20-\x7e]+$/.test(f.text)), 'どの書き込みも「tclk1 {…}」の1行・ASCII だけ');
  ok(frames[0].did === frames[2].did && frames[2].did === frames[4].did && frames[1].did === frames[3].did && frames[0].did !== frames[1].did, '払う側（ロボット）と受け取る側（練習相手）は別の鍵');
  if (tclk) {
    let state = null, okLib = true, why = '';
    try {
      const fs5 = frames.map(f => tclk.decodeFrame(f.text));
      ok(fs5.map(f => f.type).join(',') === 'offer,accept,lock,reveal,receipt', '本家ライブラリで5つとも読める（' + fs5.map(f => f.type).join(',') + '）');
      ok(fs5.every((f, i) => f.from === frames[i].did), '枠の中の from が、署名した鍵と同じ');
      state = tclk.openContract(fs5[0]);
      for (const f of fs5.slice(1, 4)) { const r = tclk.applyFrame(state, f, Date.now()); if (!r.ok) { okLib = false; why = f.type + ': ' + r.reason; break; } state = r.state; }
      ok(okLib && state.status === 'claimed', '本家ライブラリの状態機械でも 申し出→合意→ロック→引き渡し で「claimed」（' + (why || state.status) + '）');
      ok(dealRoom === tclk.dealRoom(fs5[1].contract), 'ロック以降は決まりどおりの取引部屋（' + dealRoom + '）');
      const pn = tclk.paperNote(fs5[1].contract), rec = tclk.decodePaperRecord(kv['/kv/' + pn.ns + '/' + pn.key] || '');
      ok(rec && rec.status === 'claimed' && rec.statement === fs5[1].statement && rec.secret === fs5[3].secret, 'paper レールの記録も決まりどおりの場所・形で「claimed」');
      ok(fs5[0].rails.join() === 'paper' && fs5[0].asset === 'USDC' && fs5[0].amount === '10000', 'レールは練習用の paper だけ（お金は動かない）');
    } catch (e) { ok(false, '本家ライブラリで読めない: ' + e.message); }
  } else ok(false, '@flop-labs/tclk が見つからない（npm ci で入ります）');
  await page.waitForTimeout(400);
  const b = await book(page);
  if (b.q.deal !== 'done') console.log('    deal=', await page.evaluate(() => localStorage.getItem('aq.myAgent.deal')), JSON.stringify(b.q));
  ok(b.q.deal === 'done', 'クエスト ✓');
  const view = await page.evaluate(() => ({ marks: [...document.querySelectorAll('#dealSteps .deal-step.ok')].length, res: document.getElementById('dealResult').innerText, proof: document.getElementById('questWinProof').innerText }));
  ok(view.marks === 5 && /お金は動いていません/.test(view.res) && /取引の部屋/.test(view.proof), '5段すべて ✓、結果と「本当の記録」に「お金は動いていない」と取引の部屋');
  ok(!errs.length, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-tech-deal.png') });
  await page.close();
}
{
  const { page } = await setup({ kvDown: true });
  await page.evaluate(() => AQ.quest.open('deal')); await page.waitForTimeout(300);
  await page.click('#dealGo');
  await page.waitForFunction(() => /できました|うまく|書けません/.test(document.getElementById('robotStatus').innerText), null, { timeout: 12000 }).catch(() => {});
  const s = await st(page), ng = await page.evaluate(() => document.querySelectorAll('#dealSteps .deal-step.ng').length);
  ok(/記録を書けませんでした/.test(s) && ng === 1 && (await book(page)).q.deal !== 'done', 'レールの記録が書けなければ、その段に ✕ を付けて止まる（✓ にしない）');
  await page.close();
}

console.log('\n[English]');
{
  const { page, errs } = await setup();
  await page.evaluate(() => document.getElementById('lang').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => AQ.quest.open('deal')); await page.waitForTimeout(300);
  const txt = await page.evaluate(() => document.getElementById('questWin').innerText);
  ok(/practice a deal/i.test(txt) && !/[ぁ-んァ-ン一-龥]/.test(txt.replace(/ピクセル/g, '')), '英語では日本語が残らない');
  ok(!errs.length, 'JS のエラーが無い');
  await page.close();
}

await browser.close(); server.close();
console.log(bad ? '\n✗ ' + bad + ' 件' : '\n✓ すべて OK');
process.exit(bad ? 1 : 0);
