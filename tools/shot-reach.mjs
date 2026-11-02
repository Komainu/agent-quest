/* tools/shot-reach.mjs — 「手を伸ばして取る・貼る」動作の検査（2026-10-07）
   使い方: node tools/shot-reach.mjs   （dist/agent-quest.html を先に build）

   報告「掲示板にあった仕事を引き受けたとあるが、掲示板に手を伸ばして
   仕事が書かれた紙を取るという行動のアニメーションが欲しい。同様の問題は
   すべて探し出して実装して」への対応を、絵の側の記録（AQ.room.lastReach）
   と札の置き場所（板・納品口の件数／手に持った札）で確かめる。
     ②引き受けた … 板の前で止まり、腕を伸ばし、つかみ、持ち帰る
     ①出した     … 板に着いてから、持ってきた札を腕で板に貼る
     書き込み     … 板の前で止まり、メモを腕で貼る
     ④判定       … 納品口で止まって品物を拾い、検品台へ運んで置く
   どれも「つかむ／貼る瞬間」まで札は元の場所にあり、その瞬間に移ること。 */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const OUT = '/tmp/aq-reach';
const iso = (ms) => new Date(1758300000000 + ms).toISOString();
const A = 'did:key:zPoster', W1 = 'did:key:zClaimA', C = 'did:key:zJudge', TK = 'did:key:zTalker';
const msgs = [
  { seq: 1, from: A,  text: 'JOB v1 | kR1 | build | Build the pier | d', ts: iso(0) },
  { seq: 2, from: W1, text: 'CLAIM v1 | kR1 | builder', ts: iso(40000) },
  { seq: 3, from: W1, text: 'DELIVER v1 | kR1 | done', ts: iso(90000) },
  { seq: 4, from: C,  text: 'ATTEST v1 | kR1 | useful | ok', ts: iso(120000) },
  { seq: 5, from: TK, text: 'just chatting here', ts: iso(160000) } ];

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => { console.log('  ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate(({ msgs }) => {
  AQ.adapters.kibbleForget('reach');
  AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'reach', observedAt: Date.now() }));
}, { msgs });
await page.waitForTimeout(800);

/* コマ i を p の細かい刻みでなめて、毎フレームの記録を取る */
async function sweep(match, n = 120) {
  await page.evaluate((a) => { AQ.app.setListMode('agents'); AQ.app.focusOnAgent(a); }, match.actor);
  await page.waitForTimeout(300);
  return page.evaluate(({ match, n }) => {
    const c = AQ.app.clock; c.pause();
    const i = c.beats.findIndex(b => b.kind === match.kind && String(b.actor) === match.actor &&
      (match.job == null || (b.lead && b.lead.meta && b.lead.meta.job) === match.job));
    if (i < 0) return { i: -1, rows: [] };
    const rows = [];
    for (let k = 0; k <= n; k++) {
      const p = k / n;
      c.seek(i); c.elapsed = c.durationOf(i) * p; c.onFrame();
            rows.push({ p, walk: AQ.room.lastWalk(), reach: AQ.room.lastReach(),
        /* 看板に実際に描いた件数（画面に見えている数） */
        board: (AQ.room.lastSigns().find(g => g.kind === 'board') || {}).n,
        drop: (AQ.room.lastSigns().find(g => g.kind === 'dropoff') || {}).n,
        insp: (AQ.room.lastSigns().find(g => g.kind === 'inspect') || {}).n,
        held: AQ.room.lastHeldCards().map(h => h.id + '@' + h.holder),
        fx: AQ.room.lastFx ? AQ.room.lastFx() : [] });
    }
    return { i, rows, dur: c.durationOf(i) };
  }, { match, n });
}
const stagesOf = (rows, kind) => {
  const seq = [];
  rows.forEach(r => { const s = r.reach && r.reach.kind === kind ? r.reach.stage : null; if (s && seq[seq.length - 1] !== s) seq.push(s); });
  return seq;
};
/* 腕の先が札（または貼る場所）のすぐそばにあるか */
const near = (rch) => {
  const t = rch.card || rch.to || rch.from; if (!t) return false;
  const a = rch.arm; const cx = Math.max(t.x, Math.min(t.x + t.w, a.tx)), cy = Math.max(t.y, Math.min(t.y + t.h, a.ty));
  return Math.hypot(a.tx - cx, a.ty - cy) <= 3;
};

async function shot(match, p, name) {
  await page.evaluate((a) => { AQ.app.setListMode('agents'); AQ.app.focusOnAgent(a); }, match.actor);
  await page.waitForTimeout(300);
  await page.evaluate(({ match, p }) => {
    const c = AQ.app.clock; c.pause();
    const i = c.beats.findIndex(b => b.kind === match.kind && String(b.actor) === match.actor);
    c.seek(i); c.elapsed = c.durationOf(i) * p; c.onFrame();
  }, { match, p });
  const cv = await page.$('canvas');
  await cv.screenshot({ path: `${OUT}-${name}.png` });
}

/* ---- ②引き受けた ---- */
console.log('\n[②引き受けた：板から札を取る]');
{
  const m = { kind: 'travel', actor: W1, job: 'kR1' };
  const { i, rows } = await sweep(m);
  ok(i >= 0, '引き受けのコマがある');
  const stops = rows.filter(r => r.walk && r.walk.stopQ != null);
  ok(stops.length >= 10, '板の前で立ち止まる時間がある（' + stops.length + ' フレーム）');
  ok(stops.every(r => r.walk.stopKind === 'claim'), '立ち止まる用事は「取る」');
  const seq = stagesOf(rows, 'claim');
  ok(seq.join('>') === 'reach>grip>lift>back', '腕の動き：伸ばす→つかむ→外す→持ち帰る（' + seq.join('→') + '）');
  const reachRows = rows.filter(r => r.reach && r.reach.kind === 'claim');
  ok(reachRows.every(r => r.reach.stage === 'reach' || near(r.reach)), 'つかんでからは腕の先が札に触れている');
  if (process.env.DBG) console.log(rows.map(r => r.board + (r.reach ? r.reach.stage[0] : "-")).join(" "));
  const grabbedIdx = rows.findIndex(r => r.reach && r.reach.kind === 'claim' && r.reach.stage === 'lift');
  ok(grabbedIdx > 0 && rows.slice(0, grabbedIdx).every(r => r.board === 1), 'つかむまで札は板にある（板の件数 1）');
  ok(rows.slice(grabbedIdx).every(r => r.board === 0), 'つかんだ瞬間から板の件数は 0');
  ok(rows.slice(0, grabbedIdx).every(r => r.held.length === 0), 'つかむ前に手に札が現れない');
  const afterBack = rows.filter(r => r.walk && r.walk.past);
  ok(afterBack.length > 0 && afterBack.every(r => r.held.indexOf('kR1@' + W1) !== -1), '腕を戻したあとは、手に持って机へ帰る');
  ok(rows.some(r => r.fx.indexOf('take') !== -1), '札を外す音の合図（fx:take）が出る');
  await shot(m, 0.24 + 0.226 * 0.3, 'claim-reach');
  await shot(m, 0.24 + 0.226 * 0.5, 'claim-take');
}

/* ---- ①出した ---- */
console.log('\n[①出した：持ってきた札を板に貼る]');
{
  const m = { kind: 'plan', actor: A, job: 'kR1' };
  const { i, rows } = await sweep(m);
  ok(i >= 0, '依頼を出すコマがある');
  const seq = stagesOf(rows, 'post');
  ok(seq.join('>') === 'reach>press>back', '腕の動き：伸ばす→押し当てる→戻す（' + seq.join('→') + '）');
  const pin = rows.findIndex(r => r.reach && r.reach.kind === 'post' && r.reach.stage === 'back');
  ok(pin > 0 && rows.slice(0, pin).every(r => r.board === 0), '貼るまで板の件数は 0');
  ok(rows.slice(pin).every(r => r.board === 1), '貼った瞬間に板の件数が 1');
  ok(rows.filter(r => r.reach && r.reach.kind === 'post' && r.reach.stage !== 'back').every(r => near(r.reach)), '運んでいる間、腕の先が札を持っている');
  ok(rows.some(r => r.fx.indexOf('pin') !== -1), '貼る音の合図（fx:pin）が出る');
  await shot(m, rows[Math.max(0, pin - 3)].p, 'post');
}

/* ---- 書き込み ---- */
console.log('\n[書き込み：メモを板に貼る]');
{
  const m = { kind: 'travel', actor: TK };
  const { i, rows } = await sweep(m);
  ok(i >= 0, '書き込みのコマがある');
  const seq = stagesOf(rows, 'memo');
  ok(seq.join('>') === 'reach>press>back', '腕の動き：伸ばす→押し当てる→戻す（' + seq.join('→') + '）');
  ok(rows.filter(r => r.walk && r.walk.stopQ != null).every(r => r.walk.stopKind === 'memo'), '立ち止まる用事は「貼る」');
  await shot(m, 0.24 + 0.2 * 0.3, 'memo');
}

/* ---- ④判定 ---- */
console.log('\n[④判定：納品口で拾って検品台へ]');
{
  const m = { kind: 'receive', actor: C, job: 'kR1' };
  const { i, rows } = await sweep(m, 200);
  ok(i >= 0, '判定のコマがある');
  const seq = stagesOf(rows, 'pickup');
  ok(seq.join('>') === 'reach>grip>lift>back', '腕の動き：伸ばす→つかむ→持ち上げる→引き寄せる（' + seq.join('→') + '）');
  const grab = rows.findIndex(r => r.reach && r.reach.kind === 'pickup' && r.reach.stage === 'lift');
  ok(grab > 0 && rows.slice(0, grab).every(r => r.drop === 1), '拾うまで品物は納品口にある');
  const arrive = rows.findIndex(r => r.walk && r.walk.w >= 1);
  ok(arrive > grab && rows.slice(grab, arrive).every(r => r.drop === 0 && r.insp === 0), '拾ってから検品台に着くまでは、納品口にも検品台にも無い');
  const carried = rows.slice(grab, arrive).filter(r => r.walk.past && r.held.indexOf('kR1@' + C) !== -1).length;
  ok(carried >= 5, '運んでいる間は本人の手に描かれる（' + carried + ' フレーム）');
  /* 着いたら腕で台に置く（置くまでは腕の先＝手の中、置いたら台の件数 1） */
  const placing = rows.slice(arrive).filter(r => r.reach && r.reach.kind === 'place' && r.reach.stage === 'reach');
  const placedAt = rows.findIndex((r, k) => k >= arrive && r.reach && r.reach.kind === 'place' && r.reach.stage === 'back');
  ok(placing.length > 0 && placing.every(r => r.insp === 0 && r.held.indexOf('kR1@' + C) !== -1), '着いたら、腕で品物を台へ運ぶ（置くまでは手の中）');
  ok(placedAt > 0 && rows.slice(placedAt).every(r => r.insp === 1), '置いたら検品台に載る');
  ok(placedAt > 0, '置いたあと腕を戻す');
  await shot(m, rows[grab].p, 'pickup');
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
