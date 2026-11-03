/* tools/check-lang.mjs — 日本語の画面は日本語、英語の画面は英語でそろっているかの検査（2026-10-16）
   使い方: node tools/check-lang.mjs   （dist/agent-quest.html を先に build）
     ・自分のエージェントの画面（クエスト帳・クエストの窓・ロボットの各パネル）を開き、見えている文字を集める
     ・日本語の画面: 英語の言い回し（固有名詞・記号・番号を除いて、英単語が2つ以上続くもの）があれば ✗
     ・英語の画面: ひらがな・カタカナ・漢字があれば ✗
     ・ほかのエージェントが書いた文（納品・ニュースの見出し・手紙など）は data-foreign の中にあるものとして除く
       （他人の文は訳さない＝作り話をしない） */
import { chromium } from 'playwright';
import { withAutoConfirm } from './auto-confirm.mjs';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'dist', 'agent-quest.html'))); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/';
const OWNER = '0x1111111111111111111111111111111111111111';
const DID = 'did:key:z6MkRobotKeyAbcdefghijkmnopqrstuvwxyz12345';
const AGENT = { agentId: '4660', name: 'Pixel', owner: OWNER, tx: '0x' + 'ab'.repeat(32), chain: 8453, t: Date.now() };
const JOBS = [{ id: 'kold000001', title: 'Explain how x402 payments work in 3 short sentences', key: 'x402', t: Date.now() - 3600000, seq: 10 },
              { id: 'kold000002', title: 'my own words job', t: Date.now() - 3000000, seq: 12 }];
const POSTS = [{ room: 'lobby', seq: 1, from: DID, text: 'hello' },
               { room: 'kibble', seq: 11, from: 'did:key:z6MkWorker', text: 'DELIVER v1 | kold000001 | x402 lets a server ask for payment.' }];
const ERRANDS = [{ t: Date.now() - 100000, t0: Date.now() - 100000, shop: 'news', query: 'Base blockchain', price: '0.005', tx: '0x' + 'cd'.repeat(32),
  result: { kind: 'news', count: 1, articles: [{ title: 'Base hits record activity', url: 'https://example.com/a', source: 'Decrypt', publishedAt: new Date().toISOString() }] } }];

const ALLOW = /\b(Agent Quest|AGENT QUEST|Agent Dispatch|AGENT DISPATCH|x402|USDC|ETH|Base|Basescan|Blockscout|MetaMask|Rabby|kibble(\.world)?|technocore(\.chat)?|ERC-\d+|EIP-\d+|Builder|Code|did:key|DID|ATTEST|JOB|CLAIM|DELIVER|RESULT|v\d|CoinGecko|CDP|HTTP|URL|ID|AI|JSON|Ed25519|Polygon|Ethereum|Decrypt|EN|Pixel|onrender\.com|example\.com|pro-api\.coingecko\.com|data|base64|bc_[a-z0-9]+|PAYMENT-\w+|eip155|IPFS|mb-p-|https?)\b/g;
function englishIn(s) {
  const t = s.replace(/https?:\/\/\S+/g, ' ').replace(/0x[0-9a-fA-F…\.]+/g, ' ').replace(/z6Mk\S*/g, ' ').replace(/[a-z0-9]{6,}…[a-z0-9]+/gi, ' ').replace(ALLOW, ' ');
  const m = t.match(/[A-Za-z][A-Za-z'’-]+(?:[\s,]+[A-Za-z][A-Za-z'’-]+)+/g);
  return m ? m.filter(x => x.split(/\s+/).filter(w => w.length > 1).length >= 2) : [];
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
withAutoConfirm(browser);   // ウォレットに頼む前の確認は自動で押す（tools/auto-confirm.mjs）
let bad = 0;
async function collect(lang) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((o) => {
    localStorage.clear();
    localStorage.setItem('aq.lang', o.lang);
    localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
    localStorage.setItem('aq.myAgent.key', JSON.stringify({ d: 'x', x: 'y', did: o.did }));
    localStorage.setItem('aq.myAgent.jobs', JSON.stringify(o.jobs));
    localStorage.setItem('aq.myAgent.posts', JSON.stringify(o.posts));
    localStorage.setItem('aq.myAgent.errands', JSON.stringify(o.errands));
    window.ethereum = { on: () => {}, request: async ({ method }) => (method === 'eth_accounts' || method === 'eth_requestAccounts') ? [o.owner] : (method === 'eth_chainId' ? '0x2105' : null) };
  }, { lang, agent: AGENT, did: DID, jobs: JOBS, posts: POSTS, errands: ERRANDS, owner: OWNER });
  await page.route(/^https:\/\//, r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"items":[],"messages":[]}' }));
  await page.goto(URL0); await page.waitForFunction(() => window.AQ && window.AQ.quest);
  const out = [];
  const grab = async (where, sel) => {
    const texts = await page.evaluate((sel) => {
      const res = [];
      const walk = (n) => {
        if (n.nodeType === 1) {
          if (n.closest('[data-foreign], [data-user], .robot-job-text, .errand-news, .fb-list b, .fb-name, .card-preview, .lang-pill')) return;
          const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return;
          if (n.tagName === 'INPUT' && n.placeholder) res.push(n.placeholder);
          if (n.title) res.push(n.title);
          for (const c of n.childNodes) walk(c);
        } else if (n.nodeType === 3 && n.textContent.trim()) res.push(n.textContent.trim());
      };
      const roots = [...document.querySelectorAll(sel || '#birthScreen:not([hidden]), #questWin:not([hidden]), #startScreen:not([hidden])')];
      roots.forEach(walk);
      return res;
    }, sel);
    for (const s of texts) out.push({ where, s });
  };
  await grab('start');
  await page.click('#startBirth'); await page.waitForTimeout(300);
  await grab('book');
  const ids = await page.evaluate(() => AQ.quest.QUESTS.map(q => q.id));
  for (const id of ids) {
    await page.click('#questList .quest[data-q="' + id + '"]'); await page.waitForTimeout(500);
    await grab('quest:' + id);
    if (await page.evaluate(() => !!document.getElementById('questWin') && !document.getElementById('questWin').hidden)) {
      await page.click('#questWinClose'); await page.waitForTimeout(150);
    }
  }
  /* 窓を開いたまま言語を切り替えても、窓の中が古い言語のまま残らないか */
  await page.click('#questList .quest[data-q="judge"]'); await page.waitForTimeout(600);
  const other = lang === 'ja' ? 'en' : 'ja';
  await page.click('#langPill button[data-l="' + other + '"]'); await page.waitForTimeout(500);
  await grab('toggled-' + other + ':judge');
  await page.click('#langPill button[data-l="' + lang + '"]'); await page.waitForTimeout(400);
  await page.click('#questWinClose'); await page.waitForTimeout(150);
  /* アプリ本体（街・HUD） */
  await page.evaluate(() => { document.getElementById('birthScreen').hidden = true; });
  await page.waitForTimeout(300);
  await grab('main', 'body > :not(#birthScreen):not(#startScreen):not(script)');
  await page.close();
  return { out, errs };
}

for (const lang of ['ja', 'en']) {
  const { out, errs } = await collect(lang);
  const seen = new Set(); const hits = [];
  for (const { where, s } of out) {
    const k = where.split(':')[0] + '|' + s; if (seen.has(s)) continue; seen.add(s);
    const L = where.startsWith('toggled-') ? where.slice(8, 10) : lang;
    if (L === 'ja') { const e = englishIn(s); if (e.length) hits.push(where + ' :: ' + s.slice(0, 110) + '  ← ' + e.join(' / ')); }
    else if (/[ぁ-んァ-ヶ一-龠]/.test(s)) hits.push(where + ' :: ' + s.slice(0, 110));
  }
  console.log('\n[' + lang + '] 切り替え後 ' + out.filter(o => o.where.startsWith('toggled')).length + ' / 文字の数 ' + out.length + ' / 混ざり ' + hits.length);
  hits.forEach(h => console.log('  ✗ ' + h));
  if (errs.length) console.log('  ✗ JS エラー: ' + errs[0]);
  bad += hits.length + errs.length;
}
await browser.close(); server.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
