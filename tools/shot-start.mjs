/* tools/shot-start.mjs — はじめの画面「どのエージェントを見ますか？」（2026-10-02）
   使い方: node tools/shot-start.mjs [--shots]

   ★ 提案（利用者）
     「スタートがいきなり x402 の作り話の途中から始まる。エージェントが識別できる
       番号などを入れるところから始まるのが良いのでは」
     → 開いたらまず3つの入口：① ID を入れる ② いま動いているエージェントから選ぶ
       ③ はじめての人：x402 の流れ（作り話のデモ）

   ★ 見るもの（外部のサービスはこの検査の中で偽物に差し替える）
     ・開いた直後：はじめの画面が出ていて、後ろは何も再生していない（誰も選んでいない）
     ・③ を押す → 入門が再生される（「作り話です」の断りつき）・画面が閉じる
     ・⌂ を押す → はじめの画面に戻る・再生は止まる
     ・① 形の違う ID → 画面のまま、形が違うと出る
     ・① 0x… のウォレット → Base の送金の記録を読み、そのウォレットを選んで再生。画面が閉じる
     ・① 送金の記録が読めない → 画面のまま、読めなかったと出る
     ・① did:key → kibble に LIVE でつなぎ、その子を選んだ状態で始まる
     ・① いない did:key → 画面のまま、いなかったと出る（LIVE はつながったまま）
     ・② → kibble に LIVE でつながり、エージェントの一覧（選ぶ前）から始まる
     ・プログラムからログを読んだとき（他の検査の入り方）は、画面は自動で閉じる
*/
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE ? 'file://' + process.env.AQ_FILE : 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const SCR = process.env.SHOT_DIR || (await import('node:os')).tmpdir();
const SHOTS = process.argv.includes('--shots');

const WALLET = '0x1234567890abcdef1234567890abcdef12345678';
const EMPTY_WALLET = '0x00000000000000000000000000000000000000aa';
const FAIL_WALLET = '0x00000000000000000000000000000000000000bb';
const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const now = Date.now();
const iso = (ms) => new Date(now - 120000 + ms).toISOString();
const KIBBLE = [];
{
  let s = 1;
  for (let i = 0; i < 4; i++) {
    KIBBLE.push({ seq: s++, from: 'did:key:zPoster111111111', text: `JOB v1 | st${i} | build | Task ${i} | d`, ts: iso(s * 500) });
    KIBBLE.push({ seq: s++, from: DID, text: `CLAIM v1 | st${i} | builder`, ts: iso(s * 500) });
    KIBBLE.push({ seq: s++, from: DID, text: `DELIVER v1 | st${i} | done`, ts: iso(s * 500) });
  }
}
const TRANSFERS = { items: [0, 1, 2].map(i => ({
  from: { hash: WALLET }, to: { hash: '0x' + 'cd'.repeat(20) },
  total: { value: String((i + 1) * 1000), decimals: '6' }, token: { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  timestamp: iso(i * 60000), tx_hash: '0x' + String(i).repeat(64), method: 'transferWithAuthorization', type: 'token_transfer'
})) };

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
async function fresh(lang) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.route('https://technocore.chat/**', async (route) => {
    const u = new URL(route.request().url()), h = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (u.pathname === '/rooms') return route.fulfill({ status: 200, headers: { ...h, 'content-type': 'text/plain' }, body: '# x\n/r/kibble  seq 9  1M  0s ago\n' });
    if (u.searchParams.has('since')) { await new Promise(r => setTimeout(r, 300)); return route.fulfill({ status: 200, headers: h, body: '[]' }); }
    return route.fulfill({ status: 200, headers: h, body: JSON.stringify(KIBBLE) });
  });
  await page.route('https://base.blockscout.com/**', async (route) => {
    const u = route.request().url(), h = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (u.indexOf(FAIL_WALLET) !== -1) return route.fulfill({ status: 502, headers: h, body: '{}' });
    if (u.indexOf(EMPTY_WALLET) !== -1) return route.fulfill({ status: 200, headers: h, body: '{"items":[]}' });
    return route.fulfill({ status: 200, headers: h, body: JSON.stringify(TRANSFERS) });
  });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  if (lang === 'en') await page.evaluate(() => document.getElementById('lang').click());
  await page.waitForTimeout(200);
  return page;
}
const S = (page) => page.evaluate(() => ({
  open: !document.getElementById('startScreen').hidden,
  err: document.getElementById('startErr').hidden ? '' : document.getElementById('startErr').textContent,
  title: document.getElementById('startTitle').textContent,
  playing: AQ.app.clock.playing, chosen: AQ.app.hasChosen, live: AQ.live.running, room: AQ.live.room,
  fa: AQ.app.focusActor, af: AQ.app.agentFilter, fj: AQ.app.focusJob, mode: AQ.app.listMode,
  hint: (document.getElementById('hint') || {}).textContent || '', n: AQ.app.events.length
}));
async function waitFor(page, pred, ms = 3000) {
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < ms) { s = await S(page); if (pred(s)) return s; await page.waitForTimeout(100); }
  return s;
}

/* 1) 開いた直後 ＋ ③ ＋ ⌂ */
{
  const page = await fresh('ja');
  const s0 = await S(page);
  if (!s0.open) fail('開いた直後に、はじめの画面が出ていない');
  if (s0.title !== 'どのエージェントを見ますか？') fail(`見出しが違う（"${s0.title}"）`);
  if (s0.playing || s0.chosen) fail('はじめの画面の後ろで、もう再生が始まっている');
  await page.keyboard.press('Escape');
  if (!(await S(page)).open) fail('まだ何も選んでいないのに、Esc で閉じた（選ぶものの無い画面になる）');
  if (SHOTS) await page.screenshot({ path: `${SCR}/start-ja.png` });
  await page.click('#startDemo');
  const s1 = await waitFor(page, s => s.playing);
  if (s1.open) fail('③ を押しても、はじめの画面が閉じない');
  if (!s1.playing || !s1.chosen) fail('③ を押しても、入門が再生されない');
  if (!/作り話/.test(s1.hint)) fail('入門なのに「作り話です」の断りが出ていない');
  await page.click('#homeBtn');
  const s2 = await S(page);
  if (!s2.open) fail('⌂ を押しても、はじめの画面に戻らない');
  if (s2.playing) fail('はじめの画面に戻っても、後ろで再生が続いている');
  await page.keyboard.press('Escape');
  const s2b = await S(page);
  if (s2b.open) fail('入門を見たあとの ⌂ のあと、Esc で閉じない');
  await page.click('#homeBtn');
  ok(`開いた直後: 画面 ${s0.open} / 再生 ${s0.playing} → ③ 入門の再生 ${s1.playing} → ⌂ 画面 ${s2.open}・再生 ${s2.playing}`);

  /* ① 形の違う ID */
  await page.fill('#startId', 'hello');
  await page.click('#startGo');
  const s3 = await S(page);
  if (!s3.open || !/形が違います/.test(s3.err)) fail(`形の違う ID で、画面のまま「形が違う」と出ない（"${s3.err}"）`);
  /* ① ウォレット */
  await page.fill('#startId', WALLET);
  await page.press('#startId', 'Enter');
  const s4 = await waitFor(page, s => !s.open && s.playing);
  if (s4.open) fail(`ウォレットを入れても画面が閉じない（"${s4.err}"）`);
  if (!s4.chosen || !s4.fa || !s4.playing) fail(`ウォレットを入れても、そのウォレットを選んで再生していない（${JSON.stringify(s4)}）`);
  const sent = await page.evaluate(() => AQ.app.events.filter(e => e.type === 'payment.sent').length);
  if (sent !== 3) fail(`送金の記録が ${sent} 件（3件のはず）`);
  ok(`① 形の違う ID → "${s3.err.slice(0, 14)}…" / ウォレット → 送金 ${sent} 件・${s4.fa} を再生`);

  /* ウォレットを追う画面：文字の説明は出さず、名前は短いアドレスそのもの（動物の名前を付けない）
     （2026-10-02 報告「文字での説明になる」「勝手にコアラという名前が割り振られる」） */
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.offsetParent !== null; };
    const card = document.querySelector('#focus-stat .paycard');
    return {
      win: vis('win'), raw: vis('raw'), side: vis('sideNote'),
      nick: AQ.nick.forActor(AQ.app.focusActor), actor: AQ.app.focusActor,
      card: !!card, cardNick: card ? (card.querySelector('.nick') || {}).textContent : null,
      lamps: card ? Array.from(card.querySelectorAll('.jd.lamp')).map(l => l.classList.contains('has') ? 1 : 0).join('') : '',
      stepsTitle: card ? (card.querySelector('.x402steps') || {}).title || '' : '',
      coin: card ? (card.querySelector('.stat b') || {}).textContent : null,
      text: document.getElementById('focus-stat').textContent
    };
  });
  if (w.win || w.raw || w.side) fail(`ウォレットの画面に文字の説明が出ている（実況 ${w.win} / 生ログ ${w.raw} / 右の説明 ${w.side}）`);
  if (w.nick !== w.actor || !/^0x[0-9a-f]{4}…[0-9a-f]{2}$/i.test(w.nick)) fail(`ウォレットに動物の呼び名が付いている（${w.nick}）`);
  if (!w.card || w.cardNick !== w.actor) fail(`ステータス欄に短いアドレスが出ていない（${w.cardNick}）`);
  if (w.lamps !== '00110') fail(`x402 のランプが記録どおりでない（${w.lamps}・送金と確定だけが点くはず）`);
  if (!/x402 による支払いだったかどうかまでは/.test(w.stepsTitle)) fail('チェーンの記録だけでは x402 か分からない、という断りがランプの説明に無い');
  if (w.coin !== '3') fail(`支払いの件数が違う（${w.coin}）`);
  if (/のみ表示/.test(w.text)) fail(`ステータス欄に文の説明が残っている（"${w.text}"）`);
  ok(`ウォレットの画面: 文字の説明なし / 名前 ${w.nick} / ランプ ${w.lamps} / 支払い ${w.coin}`);
  if (SHOTS) await page.screenshot({ path: `${SCR}/start-wallet.png` });

  /* ① 読めないウォレット・送金の無いウォレット */
  await page.click('#homeBtn');
  await page.fill('#startId', FAIL_WALLET);
  await page.click('#startGo');
  const s5 = await waitFor(page, s => /読めませんでした/.test(s.err));
  if (!s5.open || !/読めませんでした/.test(s5.err)) fail(`読めないウォレットで「読めなかった」と出ない（"${s5.err}"）`);
  await page.fill('#startId', EMPTY_WALLET);
  await page.click('#startGo');
  const s6 = await waitFor(page, s => /見つかりませんでした/.test(s.err));
  if (!s6.open || !/見つかりませんでした/.test(s6.err)) fail(`送金の無いウォレットで「見つからなかった」と出ない（"${s6.err}"）`);
  ok(`① 読めない → "${s5.err.slice(0, 16)}…" / 送金なし → "${s6.err.slice(0, 16)}…"`);
  await page.close();
}

/* 2) ① did:key → kibble の LIVE、その子を選んだ状態 */
{
  const page = await fresh('ja');
  await page.fill('#startId', DID);
  await page.click('#startGo');
  const s = await waitFor(page, s => !s.open && s.af);
  if (!s.live || s.room !== 'kibble') fail(`did:key を入れても kibble に LIVE でつながらない（${s.live} ${s.room}）`);
  if (s.open) fail(`did:key を入れても画面が閉じない（"${s.err}"）`);
  if (s.af !== DID) fail(`did:key を入れても、その子を選んだ状態にならない（${s.af}）`);
  ok(`① did:key → LIVE ${s.room} / 選んだエージェント ${String(s.af).slice(0, 18)}… / 依頼 ${s.fj}`);
  await page.close();
}
/* ① いない did:key */
{
  const page = await fresh('ja');
  await page.fill('#startId', 'did:key:z6MkNotHere111111111111111111');
  await page.click('#startGo');
  const s = await waitFor(page, s => /いませんでした/.test(s.err));
  if (!s.open || !/いませんでした/.test(s.err)) fail(`いない did:key で、画面のまま「いなかった」と出ない（"${s.err}"）`);
  if (!s.live) fail('いない did:key でも、LIVE はつながったままのはず（閉じれば一覧から選べる）');
  if (s.af) fail('いない did:key なのに、誰かを選んでいる');
  ok(`① いない did:key → "${s.err.slice(0, 20)}…" / LIVE ${s.live}`);
  await page.keyboard.press('Escape');
  const s2 = await S(page);
  if (s2.open) fail('Esc で、はじめの画面が閉じない');
  await page.close();
}

/* 3) ② いま動いているエージェントから */
{
  const page = await fresh('en');
  const t = await S(page);
  if (t.title !== 'Which agent do you want to watch?') fail(`英語の見出しが違う（"${t.title}"）`);
  if (SHOTS) await page.screenshot({ path: `${SCR}/start-en.png` });
  await page.click('#startLive');
  const s = await waitFor(page, s => s.live && s.n > 0);
  if (s.open) fail('② を押しても画面が閉じない');
  if (!s.live || s.room !== 'kibble') fail('② を押しても kibble に LIVE でつながらない');
  if (s.mode !== 'agents' || s.chosen) fail(`② のあと、エージェントの一覧（選ぶ前）から始まっていない（${s.mode} chosen=${s.chosen}）`);
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => document.querySelectorAll('.roster-chips .agentrow').length);
  if (!rows) fail('② のあと、エージェントの一覧に行が無い');
  ok(`② → LIVE ${s.room} / 一覧 ${s.mode} ${rows} 行 / まだ選んでいない ${!s.chosen}`);
  await page.close();
}

/* 4) プログラムからログを読んだら、画面は自動で閉じる（ほかの検査の入り方） */
{
  const page = await fresh('ja');
  await page.evaluate((m) => { AQ.adapters.kibbleForget('x'); AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'x', observedAt: Date.now() })); }, KIBBLE);
  const s = await S(page);
  if (s.open) fail('ログを読んでも、はじめの画面が開いたまま（ほかの操作ができない）');
  ok(`ログを読む → 画面 ${s.open}`);
  await page.close();
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
