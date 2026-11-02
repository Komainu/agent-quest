/* tools/shot-beginner.mjs — 初心者向けの見せ方（2026-10-03）
   使い方: node tools/shot-beginner.mjs [--shots]

   ★ 利用者「このアプリは初心者向け。文字だけでなく、デザイン性・アニメ的な表現で」。
     改善案のうち、入口の扉の並び以外をすべて入れた。ここでそれぞれを確かめる。

   ★ 見るもの
     ① やさしい表示：英語の数字・生のログ・右の説明・コマ数は画面に出ていない。
        ⓘ を開くと「いまの場面」にそれらが全部写っている（消してはいない）。
        「文字を全部出す」で元の表示に戻る。入門の「作り話です」は必ず出ている
     ② お金：ロボットの財布に残高。署名で硬貨が財布から飛び、許可証と扉へ。
        許可証が手を離れると財布の数字がログどおり減る。チェーンに載ると硬貨が店へ。
        見せ場（402・署名・判・受け取り）ではカメラが寄り、歩いている間は寄らない
     ③ 表情：402 で困り顔、署名できりっ、受け取りでうれしい。部屋の検品で ✓ うれしい／✗ しょんぼり
     ④ 音：最初は鳴らない。♪ を押すと、絵に出た演出の順に音が鳴る（402 → 署名 → 硬貨 → 判 …）
     ⑤ 振り返り：最後まで再生すると、したことが記号で並ぶ。402 は ✗（失敗）ではなく値札。
        数字はログの合計だけ。記号を押すとその場面へ戻る
     ⑥ スマホ幅では街のマス数が減る（カメラが寄る）。①〜⑤は「いま」だけ名前が出る
     ⑦ 部屋の一覧が読めないとき、赤い英語は出ない。街 ⇔ 部屋の切り替えで場面転換が出る。
        ?demo=1 で入門から始まり、⤴ で URL をコピーできる
*/
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE ? 'file://' + process.env.AQ_FILE : 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const SHOTS = process.argv.includes('--shots');
const SCR = path.join(ROOT, 'tools', 'screens'); if (SHOTS) fs.mkdirSync(SCR, { recursive: true });

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function open(url, vp) {
  const page = await browser.newPage({ viewport: vp || { width: 1600, height: 950 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.route(/^https?:/, r => r.abort());
  await page.goto(url);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  return page;
}
/* q は「着いてからの動作の進み」（0..1）。歩くコマなら、歩き終わり（70%）から先に割り当てる
   （scene.js の actP と同じ）。歩かないコマならそのまま。 */
const seek = (page, i, q) => page.evaluate(([i, q]) => {
  const c = AQ.app.clock; c.pause(); c.seek(i);
  const b = c.beats[i], walk = (b._route && b._route.length > 1) ? 0.7 : 0;
  c.elapsed = c.durationOf(i) * (walk + (1 - walk) * q); c.onFrame();
  return { kind: c.beats[i].kind, fx: AQ.scene.lastFx(), purse: AQ.scene.lastPurse(), zoom: AQ.scene.lastZoom(), mood: AQ.scene.lastMood() };
}, [i, q]);
const shown = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return false;
  const cs = getComputedStyle(n); const r = n.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);

/* ---------- ① やさしい表示 ---------- */
console.log('① やさしい表示');
let page = await open(FILE);
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload(); await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.click('#startDemo'); await page.waitForTimeout(200);
const kinds = await page.evaluate(() => AQ.app.clock.beats.map(b => b.kind + ':' + ((b.lead && b.lead.status) || '')));
const iPay = kinds.indexOf('pay:'), iReq = kinds.findIndex(k => k.startsWith('require')), iSet = kinds.indexOf('settle:'),
      iRecv = kinds.indexOf('receive:'), iErr = kinds.indexOf('error:402');
if ([iPay, iReq, iSet, iRecv, iErr].some(i => i < 0)) fail('入門に必要なコマが無い（' + kinds.join(',') + '）');
await seek(page, iPay, 0.5);
if (!(await page.evaluate(() => document.body.classList.contains('easy')))) fail('最初から「やさしい表示」になっていない');
for (const sel of ['#hud-usdc', '#hud-credits', '.rawrow', '#sideNote', '#beat']) if (await shown(page, sel)) fail(`やさしい表示なのに ${sel} が画面に出ている`);
if (!(await shown(page, '#win'))) fail('見出しが出ていない');
if (!(await shown(page, '.progress.x402'))) fail('①〜⑤の段階が出ていない');
if (!(await shown(page, '#hint'))) fail('入門の「作り話です」の1行が出ていない（やさしい表示でも必ず出す）');
if (await shown(page, '#room')) fail('入門なのに LIVE の欄が出ている');
const rawTxt = await page.evaluate(() => document.getElementById('raw').textContent.trim());
const winTitle = await page.evaluate(() => document.getElementById('win').title);
if (!rawTxt || winTitle !== rawTxt) fail('見出しにマウスを乗せても生のログが出ない');
await page.click('#detail'); await page.waitForTimeout(150);
const now = await page.evaluate(() => { const n = document.getElementById('detailNow'); return n.hidden ? null : n.textContent; });
if (!now) fail('ⓘ を開いても「いまの場面」が無い');
else {
  for (const w of ['USDC', 'CREDITS', 'RETRIES', rawTxt.slice(0, 20), 'EIP-3009']) if (now.indexOf(w) < 0) fail(`「いまの場面」に ${w} が無い（画面から外した文字が消えている）`);
  ok('いまの場面: ' + now.replace(/\s+/g, ' ').slice(0, 90) + '…');
}
await page.click('#moreText'); await page.waitForTimeout(150);
if (!(await shown(page, '.rawrow')) || !(await shown(page, '#hud-usdc'))) fail('「文字を全部出す」で元の表示に戻らない');
if (await page.evaluate(() => !document.getElementById('detailNow').hidden)) fail('全部出しているのに「いまの場面」が重ねて出ている');
await page.click('#moreText'); await page.click('#detailClose');

/* ---------- ② お金・カメラ ---------- */
console.log('② お金・カメラ');
const rSign = await seek(page, iPay, 0.3);
const rGo = await seek(page, iPay, 0.85);
if (!rSign.fx.includes('purse')) fail('財布が描かれていない');
if (!rGo.fx.includes('coin')) fail('署名のあと、硬貨が許可証と一緒に飛んでいない');
/* ★ 2026-10-06: ③ ではお金はまだ動かない。財布の数字はそのままで、横に「払うと約束した額」 */
if (!(rSign.purse && rGo.purse && rSign.purse.value === rGo.purse.value)) fail(`③ の署名で財布の数字が変わった（${rSign.purse && rSign.purse.value} → ${rGo.purse && rGo.purse.value}）＝まだ動いていないはず`);
if (!(rGo.purse && rGo.purse.pending > 0)) fail('③ で硬貨を取り出したあと、払うと約束した額が出ていない');
if (!(rSign.zoom && rSign.zoom.z > 1.05)) fail('署名の場面でカメラが寄っていない');
const walking = await page.evaluate((i) => { const c = AQ.app.clock; c.pause(); c.seek(i); c.elapsed = c.durationOf(i) * 0.1; c.onFrame();
  return { z: AQ.scene.lastZoom().z, moving: AQ.scene.lastDrawnRobots().some(r => r.isActive) }; }, iSet);
if (walking.z > 1.001) fail('歩いている間にカメラが寄っている');
const rSet0 = await seek(page, iSet, 0.5);
const rSet = await seek(page, iSet, 0.9);
if (!rSet.fx.includes('coin-to-shop')) fail('チェーンに載ったあと、硬貨が店へ飛んでいない（描いたもの: ' + rSet.fx.join(',') + '）');
if (!(rSet0.purse && rSet.purse && rSet0.purse.value > rSet.purse.value)) fail(`④ でチェーンに載っても財布の数字が減らない（${rSet0.purse && rSet0.purse.value} → ${rSet.purse && rSet.purse.value}）`);
const usdcAfter = await page.evaluate(() => document.getElementById('usdc').textContent.trim());
if (rSet.purse && Number(usdcAfter) !== Number(rSet.purse.value.toFixed(3))) fail(`財布の数字（${rSet.purse.value}）がログの残高（${usdcAfter}）と違う`);
const rReq = await seek(page, iReq, 0.5);
if (!(rReq.zoom.z > 1.05)) fail('402 の値札の場面でカメラが寄っていない');
ok(`財布 ③ ${rSign.purse && rSign.purse.value}（約束 ${rGo.purse && rGo.purse.pending}）→ ④ ${rSet.purse && rSet.purse.value} / 寄り 署名 ${rSign.zoom.z.toFixed(2)}・402 ${rReq.zoom.z.toFixed(2)}・歩行中 ${walking.z}`);
if (SHOTS) { await seek(page, iPay, 0.6); await page.screenshot({ path: `${SCR}/beginner-pay.png` }); }

/* ---------- ③ 表情（街） ---------- */
console.log('③ 表情');
const mReq = (await seek(page, iReq, 0.6)).mood;
const mErr = (await seek(page, iErr, 0.5)).mood;
const mPay = (await seek(page, iPay, 0.4)).mood;
const mRecv = (await seek(page, iRecv, 0.9)).mood;
if (mReq !== 'worried') fail(`402 の値札で困り顔になっていない（${mReq}）`);
if (mErr !== 'worried') fail(`402 で断られて困り顔になっていない（${mErr}）`);
if (mPay !== 'determined') fail(`署名できりっとしていない（${mPay}）`);
if (mRecv !== 'happy') fail(`受け取りでうれしくなっていない（${mRecv}）`);
ok(`402 ${mReq} / 断られた ${mErr} / 署名 ${mPay} / 受け取り ${mRecv}`);

/* ---------- ④ 音 ---------- */
console.log('④ 音');
if (await page.evaluate(() => AQ.sfx.enabled)) fail('最初から音が鳴る設定になっている');
await page.evaluate(() => { AQ.sfx.log.length = 0; const c = AQ.app.clock; c.pause(); c.seek(0); });
await page.click('#soundBtn');
if (!(await page.evaluate(() => AQ.sfx.enabled))) fail('♪ を押しても音が鳴る設定にならない');
await page.evaluate(() => { AQ.sfx.log.length = 0; const s = document.getElementById('speed'); s.value = '4'; s.dispatchEvent(new Event('change')); AQ.app.clock.restart(); });
await page.waitForFunction(() => !document.getElementById('recap').hidden, null, { timeout: 60000 }).catch(() => fail('最後まで再生しても振り返りが出ない'));
const snd = await page.evaluate(() => AQ.sfx.log.slice());
/* ★ 2026-10-04: ノック → 402 → 錠前 → がま口が開く → 硬貨 → 署名 → 判 → ブロック → 扉 → うれしい */
const order = ['bootUp', 'knock', 'buzz', 'lock', 'clasp', 'coin', 'sign', 'tick', 'stamp', 'gas', 'block', 'door', 'happy'];
let k = 0; for (const s of snd) if (s === order[k]) k++;
if (k < order.length) fail(`音の順番が絵と合わない（鳴った順: ${snd.join(' ')}）`);
ok('鳴った順: ' + snd.join(' '));

/* ---------- ⑤ 振り返り ---------- */
console.log('⑤ 振り返り');
await page.waitForTimeout(500);
const rc = await page.evaluate(() => ({
  steps: [...document.querySelectorAll('#recapSteps .recap-step')].map(b => b.getAttribute('aria-label')),
  facts: document.getElementById('recapFacts').textContent.replace(/\s+/g, ' ').trim(),
  html: document.getElementById('recapSteps').innerHTML }));
if (rc.steps.length < 6) fail('振り返りの記号が少ない（' + rc.steps.join(' / ') + '）');
if (rc.facts.indexOf('0.001') < 0) fail('振り返りに払った額（ログの合計 0.001）が無い: ' + rc.facts);
if (!rc.steps.some(s => /402/.test(s))) fail('402 で断られたことが「値札」として並んでいない');
if (rc.steps.some(s => /うまくいかなかった/.test(s))) fail('402 を「失敗」として並べている');
if (/×1\s*$/.test(rc.facts) && /✗|うまくいかなかった/.test(rc.facts)) fail('402 を失敗の回数に数えている');
ok('並び: ' + rc.steps.join(' › ') + ' / 数字: ' + rc.facts);
if (SHOTS) await page.screenshot({ path: `${SCR}/beginner-recap.png` });
await page.click('#recapSteps .recap-step[data-i="' + iPay + '"]').catch(() => {});
await page.waitForTimeout(150);
const back = await page.evaluate(() => ({ i: AQ.app.clock.index, hidden: document.getElementById('recap').hidden }));
if (back.i !== iPay || !back.hidden) fail(`振り返りの記号を押しても、その場面へ戻らない（${back.i}）`);
/* 止めたまま最後の絵へ動かしただけ（再生して終わったのではない）なら、絵を覆わない */
await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(c.beats.length - 1); c.elapsed = c.durationOf(c.index); c.onFrame(); });
await page.waitForTimeout(100);
if (!(await page.evaluate(() => document.getElementById('recap').hidden))) fail('止めて最後の絵へ動かしただけで振り返りが絵を覆った');
await page.close();

/* ---------- ⑩ 画面の下に大きな余白を残さない（2026-10-05） ---------- */
console.log('⑩ 余白');
for (const vp of [{ width: 1474, height: 757 }, { width: 1920, height: 1000 }]) {
  const pg = await open(FILE, vp);
  await pg.click('#startDemo'); await pg.waitForTimeout(900);
  const m = await pg.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(); const mb = document.querySelector('main').getBoundingClientRect().bottom;
    c.width; const cv = document.querySelector('canvas'); const prev = cv.style.width; cv.style.width = '100%'; const full = cv.getBoundingClientRect().width; cv.style.width = prev;
    return { free: innerHeight - mb, cw: c.width, full, over: document.documentElement.scrollHeight - innerHeight, px: cv.width }; });
  if (m.over > 0) fail(`${vp.width}×${vp.height}: 画面からはみ出している（${m.over}px）`);
  if (m.free > 130 && m.cw < m.full - 4) fail(`${vp.width}×${vp.height}: 下が ${m.free}px 空いているのに絵が大きくならない（幅 ${m.cw}/${m.full}）`);
  if (m.px < m.cw * 0.98) fail(`${vp.width}×${vp.height}: 絵を大きくしたのに描き直していない（ぼやける：内部 ${m.px}px / 表示 ${m.cw}px）`);
  ok(`${vp.width}×${vp.height}: 下の余白 ${Math.round(m.free)}px / 絵の幅 ${Math.round(m.cw)}（入る幅 ${Math.round(m.full)}）`);
  await pg.close();
}

/* ---------- ⑥ スマホ ---------- */
console.log('⑥ スマホ');
page = await open(FILE, { width: 390, height: 844 });
await page.click('#startDemo'); await page.waitForTimeout(200);
await seek(page, iPay, 0.8);
const camN = await page.evaluate(() => AQ.scene.lastCamera());
if (!camN || camN.cols >= 17) fail(`スマホ幅でも街のマス数が減らない（${camN && camN.cols}）`);
const tx = await page.evaluate(() => [...document.querySelectorAll('.progress.x402 .step')].map(s => getComputedStyle(s.querySelector('.tx')).display));
if (tx.filter(d => d !== 'none').length !== 1) fail('スマホ幅で①〜⑤の名前が「いま」の1つだけになっていない（' + tx.join(',') + '）');
const robW = await page.evaluate(() => { const c = document.querySelector('canvas'); return c.getBoundingClientRect().width / (AQ.world.view.cols * AQ.world.tile) * 35; });
ok(`街 ${camN.cols} マス / ロボットの幅 ${robW.toFixed(0)}px`);
if (SHOTS) await page.screenshot({ path: `${SCR}/beginner-phone.png`, fullPage: true });
await page.close();

/* ---------- ⑦ 一覧が読めないとき・場面転換・URL・共有 ---------- */
console.log('⑦ エラー表示・場面転換・URL');
page = await open(FILE + '?demo=1');
await page.waitForTimeout(1500);
if (!(await page.evaluate(() => document.getElementById('startScreen').hidden))) fail('?demo=1 で開いても入口の画面が出ている');
if (!(await page.evaluate(() => AQ.app.clock.playing))) fail('?demo=1 で開いても入門が再生されない');
const pl = await page.evaluate(() => { const b = document.getElementById('placesList'); return { txt: b.textContent, bad: b.querySelectorAll('.bad').length }; });
if (/Failed to fetch/.test(pl.txt) || pl.bad) fail('部屋の一覧が読めないとき、赤い英語のエラーが出ている: ' + pl.txt);
else ok('一覧が読めないとき: ' + pl.txt.trim());
const MSGS = [];
{ let s = 1, t = 0; const iso = (ms) => new Date(1758300000000 + ms).toISOString();
  for (let i = 0; i < 2; i++) { const id = 'bg' + i;
    MSGS.push({ seq: s++, from: 'did:key:zP', text: `JOB v1 | ${id} | build | T ${i} | d`, ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zW', text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zW', text: `DELIVER v1 | ${id} | done`, ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zJ', text: `ATTEST v1 | ${id} | ${i % 2 ? 'useful | ok' : 'not | thin'}`, ts: iso(t += 900) }); } }
await page.evaluate((m) => { AQ.adapters.kibbleForget('bg'); AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'bg', observedAt: Date.now() })); }, MSGS);
await page.waitForTimeout(80);
const wipe = await page.evaluate(() => ({ on: !document.getElementById('stageWipe').hidden, to: document.getElementById('stageWipe').dataset.to, stage: AQ.stage.current }));
if (!wipe.on || wipe.to !== 'room') fail(`街から部屋に切り替わっても場面転換が出ない（${JSON.stringify(wipe)}）`);
await page.waitForTimeout(1300);
if (!(await page.evaluate(() => document.getElementById('stageWipe').hidden))) fail('場面転換が消えない');
/* 部屋の表情：✓ うれしい／✗ しょんぼり */
const roomMood = await page.evaluate(() => {
  const out = {};
  for (const job of ['bg0', 'bg1']) {
    AQ.app.focusOnJob(job);
    const c = AQ.app.clock; c.pause();
    const i = c.beats.findIndex(b => b.lead && b.lead.meta && b.lead.meta.verdict);
    if (i < 0) continue;
    c.seek(i); c.elapsed = c.durationOf(i) * 0.98; c.onFrame();
    out[c.beats[i].lead.meta.verdict] = AQ.room.lastMood();
  }
  return out;
});
if (roomMood.useful !== 'happy') fail(`部屋の検品で ✓ を付けてもうれしい顔にならない（${roomMood.useful}）`);
if (roomMood.not !== 'sad') fail(`部屋の検品で ✗ を付けてもしょんぼりしない（${roomMood.not}）`);
ok(`部屋の表情: ✓ ${roomMood.useful} / ✗ ${roomMood.not}`);
await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = (s) => { window.__copied = s; return Promise.resolve(); }; });
await page.evaluate(() => AQ.app.startIntro());
await page.click('#shareBtn'); await page.waitForTimeout(150);
const copied = await page.evaluate(() => window.__copied);
if (!copied || !/\?demo=1$/.test(copied)) fail('入門で ⤴ を押しても ?demo=1 の URL にならない（' + copied + '）');
else ok('共有 URL: …' + copied.slice(-30));
await page.close();

/* ---------- ⑨ がま口の支払い・ノック・錠前・街の始動・コマンド（2026-10-04） ---------- */
console.log('⑨ がま口・始動・コマンド');
page = await open(FILE);
await page.click('#startDemo');
/* 街の始動：選んだ直後、体が暗い → 電源の印 → 光の輪 → 跳ねる */
const bootSeen = new Set();
for (let k = 0; k < 14; k++) { await page.waitForTimeout(120); const ph = await page.evaluate(() => AQ.scene.lastPhase()); if (ph) { bootSeen.add(ph.stage); ph.fx.forEach(f => bootSeen.add(f)); if (ph.hop > 0) bootSeen.add('hop'); if (ph.bright < 0.5) bootSeen.add('dark'); } }
for (const w of ['boot', 'dark', 'power', 'ring', 'hop']) if (!bootSeen.has(w)) fail(`街の始動に「${w}」が無い（見えたもの: ${[...bootSeen].join(',')}）`);
ok('街の始動: ' + [...bootSeen].join(' '));
const pay = await page.evaluate(() => {
  const c = AQ.app.clock; c.pause();
  const i = c.beats.findIndex(b => b.kind === 'pay');
  const b = c.beats[i], walk = (b._route && b._route.length > 1) ? 0.7 : 0;
  const out = [];
  for (let a = 0; a <= 1.0001; a += 0.02) {
    c.seek(i); c.elapsed = c.durationOf(i) * (walk + (1 - walk) * Math.min(1, a)); c.onFrame();
    out.push({ a: +a.toFixed(2), fx: AQ.scene.lastFx(), purse: AQ.scene.lastPurse(), coin: AQ.scene.lastCoinPx() });
  }
  const pix = (() => { const f = out.find(o => o.coin && o.a > 0.3 && o.a < 0.45); if (!f) return null;
    c.seek(i); c.elapsed = c.durationOf(i) * (walk + (1 - walk) * f.a); c.onFrame();
    const q = AQ.scene.lastCoinPx(); const d = document.querySelector('canvas').getContext('2d').getImageData(q.x, q.y, 1, 1).data; return [d[0], d[1], d[2]]; })();
  const ms = c.durationOf(i);
  return { out, pix, ms };
});
const first = (name) => { const f = pay.out.find(o => o.fx.includes(name)); return f ? f.a : null; };
const aOpen = first('purse-open'), aCoin = first('coin'), aSign = first('sign'), aPermit = first('permit');
if (aOpen == null || aCoin == null || aSign == null || aPermit == null) fail(`支払いの動きが欠けている（開く ${aOpen} / 硬貨 ${aCoin} / 署名 ${aSign} / 渡す ${aPermit}）`);
else if (!(aOpen <= aCoin && aCoin < aSign && aSign < aPermit)) fail(`支払いの順番が違う（開く ${aOpen} → 硬貨 ${aCoin} → 署名 ${aSign} → 渡す ${aPermit}）`);
const held = pay.out.filter(o => o.purse && o.purse.held > 0.9).map(o => o.a);
if (!held.length) fail('がま口を手に持って前に出していない');
const drop = pay.out.find(o => o.purse && o.purse.pending > 0);   // 約束した額が出る＝硬貨を取り出したあと
if (!drop || drop.a < aCoin) fail(`払うと約束した額が、硬貨を取り出す前に出ている（${drop && drop.a}）`);
if (pay.ms < 7000) fail(`支払いの場面が短い（${pay.ms}ms）`);
if (!pay.pix || !(pay.pix[2] > 150 && pay.pix[0] < 90)) fail(`硬貨が USDC の青で塗られていない（画素 ${JSON.stringify(pay.pix)}）`);
ok(`支払い: 開く ${aOpen} → 硬貨 ${aCoin} → 署名 ${aSign} → 渡す ${aPermit} / 手に持つ ${held[0]}〜${held[held.length - 1]} / 約束した額 ${drop && drop.a} / ${pay.ms}ms / 硬貨の色 ${pay.pix}`);
const kl = await page.evaluate(() => {
  const c = AQ.app.clock, res = {};
  c.beats.forEach((b, i) => {
    const walk = (b._route && b._route.length > 1) ? 0.7 : 0;
    for (const a of [0.08, 0.2, 0.4]) { c.seek(i); c.elapsed = c.durationOf(i) * (walk + (1 - walk) * a); c.onFrame();
      AQ.scene.lastFx().forEach(f => { if (f === 'knock' || f === 'lock') (res[f] = res[f] || new Set()).add(b.kind); }); }
  });
  return { knock: res.knock ? [...res.knock] : [], lock: res.lock ? [...res.lock] : [] };
});
if (!kl.knock.includes('travel')) fail('お店に頼むとき、扉をノックしていない');
if (!kl.lock.includes('error')) fail('402 で断られたとき、扉に錠前が出ていない');
ok(`ノック: ${kl.knock.join(',')} / 錠前: ${kl.lock.join(',')}`);
/* ★ 2026-10-05: ⑤ 受け取り：箱が開いて中身（データの紙）が出る。しらべるに中身の名前と「これが対価」 */
const recv = await page.evaluate(() => {
  const c = AQ.app.clock; c.pause();
  const i = c.beats.findIndex(b => b.kind === 'receive');
  const b = c.beats[i], walk = (b._route && b._route.length > 1) ? 0.7 : 0;
  c.seek(i); c.elapsed = c.durationOf(i) * (walk + (1 - walk) * 0.97); c.onFrame();
  return { i, fx: AQ.scene.lastFx() };
});
if (!recv.fx.includes('item')) fail('受け取りで、箱から中身が出てこない（' + recv.fx.join(',') + '）');
/* ★ 2026-10-09: 「しらべる」ははじめから開いている（押すと閉じる）ので、閉じているときだけ押す */
await page.evaluate(() => { const w = document.getElementById('cmdWin'); if (w.dataset.cmd !== 'inspect' || w.classList.contains('idle')) document.querySelector('#cmdMenu [data-cmd="inspect"]').click(); }); await page.waitForTimeout(100);
const rtxt = await page.evaluate(() => document.getElementById('cmdWinBody').textContent);
if (!/price\.json/.test(rtxt) || !/代わりに/.test(rtxt)) fail('受け取りの「しらべる」に、中身の名前と「払ったお金の代わり」が無い: ' + rtxt);
await page.click('#cmdWinClose');
const facTag = await page.evaluate(() => AQ.i18n.t('scene.facilitator'));
if (!/^[A-Z]+$/.test(facTag)) fail(`立会所の看板だけ英字でない（${facTag}）`);
ok(`受け取り: ${recv.fx.join('+')} / 立会所の看板 ${facTag}`);
/* コマンド */
const iPay2 = await page.evaluate(() => { const c = AQ.app.clock; const i = c.beats.findIndex(b => b.kind === 'pay'); c.pause(); c.seek(i); c.elapsed = c.durationOf(i) * 0.5; c.onFrame(); return i; });
const items = await page.evaluate(() => [...document.querySelectorAll('#cmdMenu .cmd-item')].map(b => b.textContent));
if (items.join(',') !== 'しらべる,さいふ,きろく,つぎへ,ほかのエージェント') fail('コマンドの並びが違う: ' + items.join(','));
/* ★ 2026-10-09: 「しらべる」ははじめから開いている（押すと閉じる）ので、閉じているときだけ押す */
await page.evaluate(() => { const w = document.getElementById('cmdWin'); if (w.dataset.cmd !== 'inspect' || w.classList.contains('idle')) document.querySelector('#cmdMenu [data-cmd="inspect"]').click(); }); await page.waitForTimeout(100);
const ins = await page.evaluate(() => ({ open: !document.getElementById('cmdWin').hidden, txt: document.getElementById('cmdWinBody').textContent, svg: !!document.querySelector('#cmdWinBody .cmd-icon svg') }));
if (!/払います/.test(ins.txt) || !/0\.001 USDC/.test(ins.txt) || !ins.svg) fail('「しらべる」で、支払いの場面の説明（絵と1行）が出ない: ' + ins.txt);
await page.click('#cmdMenu [data-cmd="wallet"]'); await page.waitForTimeout(100);
const wl = await page.evaluate(() => document.getElementById('cmdWinBody').textContent);
if (!/のこり/.test(wl) || !/0\.001 USDC → api\.example\.dev/.test(wl)) fail('「さいふ」に残りと支払いの行が無い: ' + wl);
await page.click('#cmdMenu [data-cmd="log"]'); await page.waitForTimeout(100);
const lg = await page.evaluate(() => document.querySelectorAll('#cmdWinBody .recap-step').length);
if (lg < 4) fail('「きろく」に、ここまでにしたことが並んでいない（' + lg + '）');
await page.click('#cmdMenu [data-cmd="next"]'); await page.waitForTimeout(100);
const nx = await page.evaluate(() => AQ.app.clock.index);
if (nx !== iPay2 + 1) fail(`「つぎへ」で次の行動へ進まない（${iPay2} → ${nx}）`);
await page.click('#cmdWinClose');
/* ★ 2026-10-06: 結果の窓は画面の下の欄に常にある。× で「きろく」（記号だけ）に戻る */
const idleNow = await page.evaluate(() => ({ idle: document.getElementById('cmdWin').classList.contains('idle'), steps: document.querySelectorAll('#cmdWinBody .recap-step').length }));
if (!idleNow.idle || !idleNow.steps) fail('× で「きろく」の表示に戻らない: ' + JSON.stringify(idleNow));
await page.click('#cmdMenu [data-cmd="others"]'); await page.waitForTimeout(100);
if (await page.evaluate(() => document.getElementById('startScreen').hidden)) fail('「ほかのエージェント」で入口の画面が出ない');
ok(`コマンド: ${items.join(' / ')} / しらべる「${ins.txt.slice(0, 24)}…」`);
await page.close();

/* ---------- ⑪ ④ 確定：立会人が確かめる → 判 → ガス代 → ブロック → 硬貨が店へ（2026-10-06） ---------- */
console.log('⑪ 立会人');
page = await open(FILE);
await page.click('#startDemo'); await page.waitForTimeout(200);
const fac = await page.evaluate(() => {
  const c = AQ.app.clock; c.pause();
  const i = c.beats.findIndex(b => b.kind === 'settle'), iPay = c.beats.findIndex(b => b.kind === 'pay');
  const b = c.beats[i], walk = (b._route && b._route.length > 1) ? 0.7 : 0;
  const out = [];
  /* 街の絵の動き＋画面の下の寄り絵（立会所の窓口）の動き */
  for (let a = 0; a <= 1.0001; a += 0.01) { c.seek(i); c.elapsed = c.durationOf(i) * (walk + (1 - walk) * Math.min(1, a)); c.onFrame(); out.push({ a: +a.toFixed(2), fx: AQ.scene.lastFx().concat(AQ.scene.lastCloseup().fx), panel: AQ.scene.lastPanel() }); }
  const end = b._route[b._route.length - 1], payEnd = c.beats[iPay]._route[c.beats[iPay]._route.length - 1];
  return { out, end, payEnd, ms: c.durationOf(i) };
});
const firstA = (n) => { const f = fac.out.find(o => o.fx.includes(n)); return f ? f.a : null; };
const seq = ['permit', 'check-sig', 'check-amount', 'check-balance', 'check-expiry', 'stamp', 'gas', 'block-land', 'coin-to-shop'].map(n => [n, firstA(n)]);
const missing = seq.filter(x => x[1] == null).map(x => x[0]);
if (missing.length) fail('④ の動きが欠けている: ' + missing.join(', '));
else for (let k = 1; k < seq.length; k++) if (seq[k][1] < seq[k - 1][1]) fail(`④ の順番が違う: ${seq[k - 1][0]}(${seq[k - 1][1]}) → ${seq[k][0]}(${seq[k][1]})`);
if (!fac.out.some(o => o.panel)) fail('立会所の窓口の寄り絵が出ていない');
if (JSON.stringify(fac.end) !== JSON.stringify(fac.payEnd)) fail(`確定のあいだロボットが店の前で待っていない（${fac.end} / 店 ${fac.payEnd}）`);
if (fac.ms < 8000) fail(`④ の場面が短い（${fac.ms}ms）`);
ok('④: ' + seq.map(x => x[0] + ' ' + x[1]).join(' → ') + ` / ${fac.ms}ms`);
/* ウォレット：送金のしかたが分からないときは確かめる窓を出さない／transferWithAuthorization なら出す */
const wpan = await page.evaluate(() => {
  const ME = '0xe0f8000000000000000000000000000000000038', USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const iso = (ms) => new Date(Date.now() - 600000 + ms).toISOString();
  const run = (method) => {
    const items = [{ from: { hash: ME }, to: { hash: '0x' + 'ab'.repeat(20) }, total: { value: '1000', decimals: '6' }, token: { symbol: 'USDC', address: USDC }, timestamp: iso(0), transaction_hash: '0x' + '1'.repeat(64), method }];
    const ev = AQ.adapters.fromChain(items, { address: ME, chain: 'base', usdc: USDC });
    AQ.app.loadEvents(ev); AQ.app.focusOn(ev[0].actor);
    const c = AQ.app.clock; c.pause(); const i = c.beats.findIndex(b => b.kind === 'settle');
    c.seek(i); c.elapsed = c.durationOf(i) * 0.4; c.onFrame();
    return !!AQ.scene.lastPanel();
  };
  return { none: run(undefined), plain: run('transfer'), twa: run('transferWithAuthorization') };
});
if (wpan.none || wpan.plain) fail(`ウォレットで送金のしかたが x402 と分からないのに、立会人が確かめる窓が出ている（${JSON.stringify(wpan)}）`);
if (!wpan.twa) fail('ウォレットで transferWithAuthorization の送金なのに、立会人が確かめる窓が出ない');
ok('ウォレットの確かめる窓: ' + JSON.stringify(wpan));
await page.close();

/* ---------- ⑫ 画面の下の欄：コマンド｜寄り絵（建物の中）｜結果（2026-10-06） ---------- */
console.log('⑫ 寄り絵');
page = await open(FILE, { width: 1474, height: 757 });
await page.click('#startDemo'); await page.waitForTimeout(600);
const lay = await page.evaluate(() => {
  const r = (s) => { const n = document.querySelector(s); if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  return { lower: r('#lower'), menu: r('#lower #cmdMenu'), cu: r('#closeup'), win: r('#lower #cmdWin'), canvas: r('canvas#scene'),
           inSide: !!document.querySelector('#sideCol #cmdMenu'), over: document.documentElement.scrollHeight - innerHeight };
});
if (!lay.lower || !lay.menu || !lay.cu || !lay.win) fail('画面の下の欄（コマンド・寄り絵・結果）が無い');
else {
  if (lay.inSide) fail('コマンドが右の列に残っている');
  if (lay.cu.w < 300 || lay.cu.h < 80) fail(`寄り絵が小さい（${Math.round(lay.cu.w)}×${Math.round(lay.cu.h)}）`);
  if (lay.lower.y < lay.canvas.y + lay.canvas.h) fail('下の欄が街の絵に重なっている');
}
if (lay.over > 0) fail(`下の欄を足したら画面からはみ出した（${lay.over}px）`);
const cus = await page.evaluate(() => {
  const c = AQ.app.clock, out = [];
  c.beats.forEach((b, i) => {
    const walk = (b._route && b._route.length > 1) ? 0.7 : 0, fx = new Set(); let sc = null;
    for (const q of [0.05, 0.1, 0.15, 0.2, 0.3, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95]) { c.pause(); c.seek(i); c.elapsed = c.durationOf(i) * (walk + (1 - walk) * q); c.onFrame(); const cu = AQ.scene.lastCloseup(); sc = cu.scene; cu.fx.forEach(f => fx.add(f)); }
    out.push({ i, kind: b.kind + ':' + ((b.lead && b.lead.status) || ''), scene: sc, fx: [...fx] });
  });
  return out;
});
const WANTCU = { 'plan:': ['mind', 'cu-think'], 'travel:': ['shop', 'cu-order'], 'require:': ['shop', 'cu-tag'], 'require:402': ['shop', 'cu-tag'], 'error:402': ['shop', 'cu-refuse'],
                 'pay:': ['shop', 'cu-permit'], 'settle:': ['facilitator', 'check-expiry'], 'receive:': ['shop', 'cu-box'], 'start:': ['operator', 'cu-start'], 'end:': ['operator', 'cu-end'] };
const seenCu = new Set();
cus.forEach(r => {
  const w = WANTCU[r.kind] || WANTCU[r.kind.replace(/:.*$/, ':')];
  if (!w) return;
  seenCu.add(r.kind.replace(/:.*$/, ''));
  if (r.scene !== w[0]) fail(`コマ${r.i}（${r.kind}）の寄り絵が「${w[0]}」でない（${r.scene}）`);
  else if (!r.fx.includes(w[1])) fail(`コマ${r.i}（${r.kind}）の寄り絵に「${w[1]}」の動きが無い（${r.fx.join(',')}）`);
});
['plan', 'travel', 'require', 'pay', 'settle', 'receive', 'start', 'end'].forEach(k => { if (!seenCu.has(k)) fail(`入門に ${k} の寄り絵を見るコマが無い＝空回り`); });
ok('寄り絵: ' + cus.map(r => `${r.kind.replace(/:$/, '')}=${r.scene}`).join(' '));
/* ④ の始め：お店の中で、店主が許可証を管で立会所へ送る（街の絵で許可証が店から飛ぶのと同じ時） */
const sendCu = await page.evaluate(() => { const c = AQ.app.clock; const i = c.beats.findIndex(b => b.kind === 'settle'); const b = c.beats[i], walk = (b._route && b._route.length > 1) ? 0.7 : 0;
  c.pause(); c.seek(i); c.elapsed = c.durationOf(i) * (walk + (1 - walk) * 0.06); c.onFrame(); return AQ.scene.lastCloseup(); });
if (sendCu.scene !== 'shop' || !sendCu.fx.includes('cu-tube')) fail('④ の始めに、お店の中で許可証を管で立会所へ送る動きが無い: ' + JSON.stringify(sendCu));
const recvFx = (cus.find(r => r.kind === 'receive:') || {}).fx || [];
['cu-confirm', 'cu-item', 'cu-box'].forEach(f => { if (!recvFx.includes(f)) fail(`お店の中の受け取りに「${f}」が無い`); });
/* ウォレットではお店の中を描かない（注文・値札・中身は記録に無い）＋建物の裏で隠れたら透かす */
const wcu = await page.evaluate(() => {
  const ME = '0xe0f8000000000000000000000000000000000038', USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const iso = (ms) => new Date(Date.now() - 600000 + ms).toISOString();
  const items = []; for (let i = 0; i < 8; i++) items.push({ from: { hash: ME }, to: { hash: '0x' + ((i * 7919 + 13) % 255).toString(16).padStart(2, '0').repeat(19) + 'a' + i }, total: { value: String(1000 * (i + 1)), decimals: '6' }, token: { symbol: 'USDC', address: USDC }, timestamp: iso(i * 60000), transaction_hash: '0x' + String(i).repeat(64) });
  const ev = AQ.adapters.fromChain(items, { address: ME, chain: 'base', usdc: USDC });
  AQ.app.loadEvents(ev); AQ.app.focusOn(ev[0].actor);
  const c = AQ.app.clock; c.pause(); const scenes = new Set(); let ghost = 0, hiddenNoGhost = 0;
  for (let i = 0; i < c.beats.length; i++) for (let q = 0; q <= 1; q += 0.1) {
    c.seek(i); c.elapsed = c.durationOf(i) * q; c.onFrame();
    scenes.add(c.beats[i].kind + '=' + AQ.scene.lastCloseup().scene);
    if (AQ.scene.lastFx().includes('ghost')) ghost++;
  }
  return { scenes: [...scenes], ghost };
});
if (wcu.scenes.some(x => /=shop/.test(x))) fail('ウォレットなのにお店の中（注文・値札・中身）を描いている: ' + wcu.scenes.join(','));
if (!wcu.ghost) fail('建物の裏を歩くとき、隠れたロボットを透かして見せていない');
ok(`ウォレットの寄り絵: ${wcu.scenes.join(' ')} / 透かし ${wcu.ghost} フレーム`);
await page.close();

/* ---------- ⑧ ウォレット：USDC 以外は描かない・南側の建物でロボットが隠れない（2026-10-03） ---------- */
console.log('⑧ ウォレットの額・南側の建物');
page = await open(FILE);
const wal = await page.evaluate(() => {
  const ME = '0xe0f8000000000000000000000000000000000038';
  const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const iso = (ms) => new Date(Date.now() - 600000 + ms).toISOString();
  const items = [];
  for (let i = 0; i < 8; i++) items.push({ from: { hash: ME }, to: { hash: '0x' + ((i * 7919 + 13) % 255).toString(16).padStart(2, '0').repeat(19) + 'a' + i },
    total: { value: String(1000 * (i + 1)), decimals: '6' }, token: { symbol: 'USDC', address: USDC }, timestamp: iso(i * 60000), transaction_hash: '0x' + String(i).repeat(64) });
  /* 名前は USDC だが別のコントラクト（詐欺トークンが作る「あなたから送った」記録）・別のトークン */
  items.push({ from: { hash: ME }, to: { hash: '0x' + '9'.repeat(40) }, total: { value: '912100005019000000000000000', decimals: '18' },
    token: { symbol: 'USDC', address: '0x' + 'fa'.repeat(20) }, timestamp: iso(30000), transaction_hash: '0x' + 'f'.repeat(64) });
  items.push({ from: { hash: ME }, to: { hash: '0x' + '8'.repeat(40) }, total: { value: '5000000000000000000000', decimals: '18' },
    token: { symbol: 'DEGEN', address: '0x' + 'de'.repeat(20) }, timestamp: iso(90000), transaction_hash: '0x' + 'e'.repeat(64) });
  const ev = AQ.adapters.fromChain(items, { address: ME, chain: 'base', usdc: USDC });
  document.getElementById('startScreen').hidden = true;
  AQ.app.loadEvents(ev); AQ.app.focusOn(ev[0].actor);
  const c = AQ.app.clock; c.pause();
  const W = AQ.world, out = { skipped: AQ.adapters.fromChain.skipped, n: ev.filter(e => e.type === 'payment.sent').length, maxAbs: 0, south: [] };
  for (let i = 0; i < c.beats.length; i++) {
    c.seek(i); c.elapsed = c.durationOf(i); c.onFrame();
    const pu = AQ.scene.lastPurse(); if (pu) out.maxAbs = Math.max(out.maxAbs, Math.abs(pu.value));
    if (c.beats[i].kind !== 'pay') continue;
    const r = AQ.scene.lastDrawnRobots().filter(x => x.isActive)[0], cam = AQ.scene.lastCamera();
    const t = c.beats[i].lead.target;
    /* 相手の建物が通りの南側（y=11〜）なら、扉の前（建物の下）に立ち、名札まで画面に入っている */
    const wy = r ? cam.y + r.hy / W.tile : null;
    if (cam.y > 5) out.south.push({ i, wy, bottom: r ? r.hy + 44 + 14 : null, vh: cam.rows * W.tile });
  }
  out.usdc = document.getElementById('usdc').textContent.trim();
  return out;
});
if (wal.skipped !== 2) fail(`USDC 以外（偽の USDC・別のトークン）の送金を捨てていない（捨てた ${wal.skipped} 件）`);
if (wal.n !== 8) fail(`USDC の送金 8 件のはずが ${wal.n} 件`);
if (wal.maxAbs > 0.05) fail(`財布に USDC 以外の額が混ざっている（最大 ${wal.maxAbs}）`);
if (Number(wal.usdc) !== -0.036) fail(`使った額が USDC の合計（-0.036）でない: ${wal.usdc}`);
if (!wal.south.length) fail('南側の建物へ払うコマが無い＝空回り');
wal.south.forEach(s => {
  if (!(s.wy >= 13.5)) fail(`コマ${s.i}: 南側の建物の扉の前（建物の下）に立っていない（${s.wy && s.wy.toFixed(1)} 行目）＝建物の陰に隠れる`);
  if (s.bottom > s.vh + 1) fail(`コマ${s.i}: ロボットか名札が画面の下に切れている（${s.bottom} > ${s.vh}）`);
});
/* ★ 2026-10-05: ウォレットでは、受け取った物は記録に無い＝「？」の箱と、しらべるの断り書き */
const unk = await page.evaluate(() => {
  const c = AQ.app.clock; c.pause();
  const i = c.beats.findIndex(b => b.kind === 'settle');
  c.seek(i); c.elapsed = c.durationOf(i) * 0.99; c.onFrame();
  return { fx: AQ.scene.lastFx(), win: getComputedStyle(document.getElementById('win')).display, winTxt: document.getElementById('win').textContent };
});
if (!unk.fx.includes('unknown-item')) fail('ウォレットの確定のあと、受け取った物が分からないことを示す「？」の箱が出ない: ' + unk.fx.join(','));
/* ★ 2026-10-09: 「しらべる」ははじめから開いている（押すと閉じる）ので、閉じているときだけ押す */
await page.evaluate(() => { const w = document.getElementById('cmdWin'); if (w.dataset.cmd !== 'inspect' || w.classList.contains('idle')) document.querySelector('#cmdMenu [data-cmd="inspect"]').click(); }); await page.waitForTimeout(100);
const note = await page.evaluate(() => document.getElementById('cmdWinBody').textContent);
if (!/何を受け取ったか/.test(note)) fail('ウォレットで「しらべる」を選んでも、受け取った物は記録に無いと書いていない: ' + note);
ok(`捨てた ${wal.skipped} 件 / USDC ${wal.n} 件 / 使った額 ${wal.usdc} / 南側の扉: ${wal.south.map(s => s.wy.toFixed(1) + '行目').join(', ')}`);
await page.close();

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
