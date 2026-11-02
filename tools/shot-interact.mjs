/* tools/shot-interact.mjs — 操作の総点検（2026-10-08）
   使い方: node tools/shot-interact.mjs   （dist/agent-quest.html を先に build）

   画面の「見た目」ではなく「操作」を順に試して、JS のエラーと、操作のあとの
   食い違いを探す（実際に人が押す順番で、ボタン・一覧・キーを触る）。
     ・依頼を開いたまま、エージェントで絞る → ◀ 戻る → 依頼／エージェントの切り替え
       （以前ここで ReferenceError が出て、画面と再生が食い違った）
     ・再生中に言語を切り替える（辞書の鍵がそのまま出ないか）
     ・コマンド（しらべる・さいふ・きろく・つぎへ・ほかのエージェント）を全部押す
     ・検索欄で空白を打っても再生が切り替わらない
     ・詳細（ⓘ）を開いて閉じる
     ・街（入門）と部屋（kibble）の両方で */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();
const K = (n) => 'did:key:z6Mk' + n + 'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww' + n;
const MSGS = [
  { seq: 1, from: K('A'), text: 'JOB v1 | kI1 | build | Build the pier | d', ts: iso(0) },
  { seq: 2, from: K('A'), text: 'JOB v1 | kI2 | review | Check the tides | d', ts: iso(5000) },
  { seq: 3, from: K('B'), text: 'CLAIM v1 | kI1 | builder', ts: iso(40000) },
  { seq: 4, from: K('C'), text: 'CLAIM v1 | kI1 | builder', ts: iso(50000) },
  { seq: 5, from: K('B'), text: 'DELIVER v1 | kI1 | done', ts: iso(90000) },
  { seq: 6, from: K('D'), text: 'ATTEST v1 | kI1 | useful | ok', ts: iso(120000) },
  { seq: 7, from: K('C'), text: 'CLAIM v1 | kI2 | builder', ts: iso(130000) },
  { seq: 8, from: K('C'), text: 'DELIVER v1 | kI2 | done', ts: iso(160000) } ];

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load|CORS|ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
const wait = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => {
  const c = AQ.app.clock, b = c.beats[c.index];
  const txt = document.body.innerText;
  return { n: c.beats.length, i: c.index, playing: c.playing, actor: b && String(b.actor), job: b && b.lead && b.lead.meta && b.lead.meta.job,
           keys: (txt.match(/\b(cmd|ui|act|jobs|roster|x402|detail|recap|places|agents|start|load|chain)\.[a-zA-Z.]+\b/g) || []).slice(0, 5),
           bad: /undefined|NaN|\[object /.test(txt) };
});

console.log('\n[部屋：依頼とエージェントの行き来]');
await page.evaluate((msgs) => {
  AQ.adapters.kibbleForget('inter');
  AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'inter', observedAt: Date.now() }));
}, MSGS);
await wait(500);
await page.evaluate(() => { AQ.app.setListMode('jobs'); AQ.app.focusOnJob('kI1'); });
await wait(600);
let s = await state();
ok(s.job === 'kI1' || s.n > 0, '依頼 kI1 を開ける（コマ ' + s.n + '）');
await page.evaluate((a) => { AQ.app.setListMode('agents'); AQ.app.focusOnAgent(a); }, K('B'));
await wait(600);
s = await state();
ok(s.actor === K('B'), 'エージェント B に絞ると、再生しているのは B のコマ（' + (s.actor || '').slice(-4) + '）');
/* ◀ 戻る（一覧の上の戻る行） */
const back = await page.$('.roster-chips .backrow');
ok(!!back, '◀ 戻る の行がある');
if (back) { await back.click(); await wait(500); }
s = await state();
ok(errs.length === 0, '◀ 戻る でエラーが出ない' + (errs.length ? '（' + errs[0] + '）' : ''));
ok(s.n > 0, '戻ったあとも再生が続けられる（コマ ' + s.n + '）');
/* 依頼／エージェントの切り替えボタン */
await page.evaluate((a) => { AQ.app.setListMode('agents'); AQ.app.focusOnAgent(a); }, K('C'));
await wait(400);
await page.click('#modeJobs'); await wait(400);
await page.click('#modeAgents'); await wait(400);
ok(errs.length === 0, '依頼／エージェントの切り替えでエラーが出ない' + (errs.length ? '（' + errs[0] + '）' : ''));
s = await state();
ok(s.n > 0 && s.i < s.n, '切り替えたあとも、いまのコマの番号が範囲内（' + s.i + '/' + s.n + '）');

console.log('\n[部屋：コマンド・言語・キー]');
await page.evaluate(() => { AQ.app.setListMode('jobs'); AQ.app.focusOnJob('kI1'); });
await wait(500);
for (const id of ['cmdInspect', 'cmdWallet', 'cmdLog']) {
  await page.click('#' + id); await wait(300);
  const body = await page.evaluate(() => { const e = document.getElementById('cmdWinBody'); return { t: e.innerText.trim(), h: e.innerHTML.length }; });
  ok(body.h > 20, `「${id}」を押すと窓に中身が出る（${body.t.slice(0, 30).replace(/\n/g, ' ') || '記号'}）`);
}
/* つぎへ：次のコマへ進む */
const iBefore = (await state()).i;
await page.click('#cmdNext'); await wait(300);
ok((await state()).i !== iBefore || (await state()).n === 1, '「つぎへ」で次のコマへ進む');
/* ほかのエージェント：選ぶ画面が開き、Esc で閉じる */
await page.click('#cmdOthers'); await wait(300);
const opened = await page.evaluate(() => !document.getElementById('startScreen').hidden);
await page.keyboard.press('Escape'); await wait(300);
const closed = await page.evaluate(() => document.getElementById('startScreen').hidden);
ok(opened && closed, '「ほかのエージェント」で選ぶ画面が開き、Esc で閉じる');
await page.click('#langPill button:not(.on)'); await wait(400);
s = await state();
ok(!s.keys.length && !s.bad, '英語に切り替えても辞書の鍵や undefined が出ない' + (s.keys.length ? '（' + s.keys.join(',') + '）' : ''));
await page.click('#langPill button:not(.on)'); await wait(300);
/* 検索欄で空白を打っても、再生は切り替わらない */
await page.evaluate(() => { const c = AQ.app.clock; c.pause(); });
const before = (await state()).playing;
const filter = await page.$('#roster-filter');
if (filter) { await filter.click(); await page.keyboard.type('a b'); await wait(200); }
const after = (await state()).playing;
ok(before === after, '検索欄で空白を打っても再生／停止が切り替わらない');
const typed = filter ? await filter.inputValue() : '';
ok(typed === 'a b', '検索欄に空白が入る（' + JSON.stringify(typed) + '）');
if (filter) { await filter.fill(''); }
/* 詳細を開いて閉じる */
await page.click('#detail'); await wait(300);
const dOpen = await page.evaluate(() => !document.getElementById('detailPanel').hidden);
await page.click('#detailClose'); await wait(200);
const dClosed = await page.evaluate(() => document.getElementById('detailPanel').hidden);
ok(dOpen && dClosed, '詳細（ⓘ）を開いて閉じられる');

console.log('\n[街：入門]');
await page.evaluate(() => AQ.app.startIntro());
await wait(800);
for (const id of ['cmdInspect', 'cmdWallet', 'cmdLog']) { await page.click('#' + id); await wait(250); }
await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(c.beats.length - 1); c.onFrame(); });
await wait(300);
await page.click('#langPill button:not(.on)'); await wait(400);
s = await state();
ok(!s.keys.length && !s.bad, '入門の最後で英語にしても鍵や undefined が出ない' + (s.keys.length ? '（' + s.keys.join(',') + '）' : ''));
await page.click('#langPill button:not(.on)'); await wait(200);
/* キーの操作（→ で次のコマ） */
const i0 = (await state()).i;
await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(1); c.onFrame(); });
await page.keyboard.press('ArrowRight'); await wait(200);
const i1 = (await state()).i;
ok(i1 === 2, '→ キーで次のコマへ進む（' + i1 + '）');

ok(errs.length === 0, 'ここまでの操作で JS のエラーが1件も無い' + (errs.length ? '：' + errs.slice(0, 3).join(' / ') : ''));
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
