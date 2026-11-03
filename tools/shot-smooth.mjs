/* tools/shot-smooth.mjs — 動きのなめらかさ（2026-09-28）
   使い方: node tools/shot-smooth.mjs

   ★ 報告
     ・多数の依頼を請け負っているエージェントだと、動きがかくかくする
     ・エージェントをクリックして選んだ直後などは、動きが暴走気味になる

   ★ 調べて分かった原因
     1. LIVE で行が届くたびの作り直しが、数千件のログで 1 回数秒かかっていた
        （札の状態を「コマ数 × 札の数」ぶん写していた／同じ道を何千回も探していた）
     2. 毎フレーム（1秒に60回）、中身が変わっていなくても一覧・欄の DOM を書き直し、
        そのうえ絵の高さを測っていた（そのたびにブラウザがレイアウトをやり直す）
     3. エージェントを選ぶと、その子の依頼それぞれについてログ全体をなめていた
        （選んだ直後に画面が固まる）
     4. 固まったあとの最初のフレームで、遅れた時間を一気に進めていた
        （＝選んだ直後の瞬間移動・暴走）

   ★ 見るもの（どれも「数」で測る。速い・遅いを目で見て決めない）
     A. LIVE の作り直し 1 回が 400ms 未満（以前は約 2600ms）
     B. 同じコマを再生しているあいだ、DOM の書き換えが 0 回
     C. 同じコマを再生しているあいだ、絵の高さを 1 回も測らない
     D. 3 万回のループで固まらせても、次のフレームで時計が進むのは 1 フレームぶん
        （50ms × 再生速度）まで。ロボットも瞬間移動しない
     E. エージェントを選んだ直後から 3 秒、フレームごとのロボットの移動が
        「1 フレームぶん」を大きく超えない
*/
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bigLog } from './perf-big.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE ? 'file://' + process.env.AQ_FILE : 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const M = bigLog(2600, 215);
const head = M.slice(0, M.length - 200), tail = M.slice(M.length - 200);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate((m) => { AQ.adapters.kibbleForget('bg'); AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'bg', observedAt: Date.now() })); }, head);
await page.waitForTimeout(300);

/* ---------- E. 選んだ直後の動き ---------- */
{
  const r = await page.evaluate(() => new Promise((res) => {
    const spd = document.getElementById('speed'); spd.value = '1'; spd.dispatchEvent(new Event('change'));
    const t0 = performance.now();
    document.querySelector('.agentrow[data-agent="did:key:zStar"]').click();
    const clickMs = performance.now() - t0;
    const pos = [];
    const stop = performance.now() + 3000;
    (function tick() {
      const w = AQ.room.lastWalk();
      pos.push(w ? { x: w.x, y: w.y, i: AQ.app.clock.index } : null);
      if (performance.now() < stop) requestAnimationFrame(tick); else res({ clickMs, pos, mpt: AQ.room.MS_PER_TILE, speed: AQ.app.clock.speed, playing: AQ.app.clock.playing });
    })();
  }));
  const lim = 50 * r.speed / r.mpt * 1.3 + 0.01;
  let maxStep = 0, over = 0, n = 0;
  for (let i = 1; i < r.pos.length; i++) {
    const a = r.pos[i - 1], b = r.pos[i];
    if (!a || !b || a.i !== b.i) continue;
    const d = Math.hypot(a.x - b.x, a.y - b.y); n++;
    if (d > maxStep) maxStep = d;
    if (d > lim) over++;
  }
  if (!r.playing) fail('選んだあと再生が始まっていない＝この検査は空回り');
  if (n < 30) fail(`ロボットの位置を ${n} フレームしか測れなかった＝空回り`);
  if (over) fail(`選んだ直後に、1フレームで ${maxStep.toFixed(2)} マス動いた（上限 ${lim.toFixed(2)}）＝瞬間移動・暴走 ${over} 回`);
  ok(`E 選んだ直後: クリック処理 ${r.clickMs.toFixed(0)}ms / 1フレームの最大移動 ${maxStep.toFixed(3)} マス（上限 ${lim.toFixed(3)}）/ ${n} フレーム`);
}

/* ---------- D. 固まったあとの1フレーム ---------- */
{
  const r = await page.evaluate(() => new Promise((res) => {
    const c = AQ.app.clock;
    c.speed = 1;
    if (!c.playing) c.play();
    requestAnimationFrame(() => {
      const before = { i: c.index, e: c.elapsed, w: AQ.room.lastWalk() };
      const t0 = performance.now(); while (performance.now() - t0 < 600) { /* 固まる */ }
      requestAnimationFrame(() => {
        const after = { i: c.index, e: c.elapsed, w: AQ.room.lastWalk() };
        res({ before, after, mpt: AQ.room.MS_PER_TILE });
      });
    });
  }));
  if (r.before.i === r.after.i) {
    const adv = r.after.e - r.before.e;
    if (adv > 50 * 1 + 1) fail(`600ms 固まったあと、時計が 1 フレームで ${adv.toFixed(0)}ms 進んだ（上限 50ms）`);
    if (r.before.w && r.after.w) {
      const d = Math.hypot(r.after.w.x - r.before.w.x, r.after.w.y - r.before.w.y);
      if (d > 50 / r.mpt * 1.3 + 0.01) fail(`600ms 固まったあと、ロボットが ${d.toFixed(2)} マス瞬間移動した`);
    }
    ok(`D 600ms 固まったあとの1フレーム: 時計 +${adv.toFixed(1)}ms`);
  } else {
    fail(`固まっている間にコマが ${r.after.i - r.before.i} 個進んだ（遅れを一気に取り返している）`);
  }
}

/* ---------- B・C. 同じコマの間は DOM を書かない・高さを測らない ---------- */
{
  const r = await page.evaluate(() => new Promise((res) => {
    const c = AQ.app.clock;
    const spd = document.getElementById('speed'); spd.value = '0.25'; spd.dispatchEvent(new Event('change'));
    c.pause(); c.seek(Math.max(0, c.beats.length - 1) >> 1); c.play();
    const canvas = document.querySelector('canvas');
    let reads = 0;
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
    let muts = 0;
    /* 2026-09-30: 頭のコマから再生すると、まず「始動」の演出（約1.3秒）が入り、
       その終わりに一覧の行の印（booting）が1回外れる。それは「状態が変わった
       ときの1回」で、毎フレームの書き直しではない。始動が終わってから測る。 */
    const whenSteady = (fn) => { (function w() { if (c.phase().boot != null) setTimeout(w, 50); else setTimeout(fn, 200); })(); };
    whenSteady(() => {
      const idx0 = c.index;
      Object.defineProperty(canvas, 'clientHeight', { configurable: true, get() { reads++; return desc.get.call(this); } });
      const mo = new MutationObserver((list) => { muts += list.length; });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      let frames = 0;
      const stop = performance.now() + 1200;
      (function tick() {
        frames++;
        if (performance.now() < stop) { requestAnimationFrame(tick); return; }
        mo.disconnect();
        delete canvas.clientHeight;
        res({ same: c.index === idx0, playing: c.playing, muts, reads, frames, dur: c.durationOf(c.index) });
      })();
    });
  }));
  if (!r.same) fail('測っている間にコマが変わった＝この検査は空回り（遅い再生速度で測り直す必要あり）');
  if (!r.playing) fail('測っている間、再生が止まっていた＝空回り');
  if (r.frames < 30) fail(`フレームが ${r.frames} 回しか来なかった＝空回り`);
  if (r.muts) fail(`同じコマの再生中に DOM を ${r.muts} 回書き換えた（毎フレームの書き直しが残っている）`);
  if (r.reads) fail(`同じコマの再生中に絵の高さを ${r.reads} 回測った（毎フレームのレイアウトが残っている）`);
  ok(`B/C 同じコマ ${r.frames} フレーム: DOM 書き換え ${r.muts} 回 / 高さの計測 ${r.reads} 回`);
}

/* ---------- A. LIVE の作り直し ---------- */
{
  const ts = await page.evaluate((t) => {
    const out = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      AQ.app.appendEvents(AQ.adapters.fromKibble(t.slice(i * 40, i * 40 + 40), { room: 'bg', observedAt: Date.now() }));
      out.push(performance.now() - t0);
    }
    return out;
  }, tail);
  const worst = Math.max(...ts);
  if (worst > 400) fail(`LIVE の作り直し 1 回に ${worst.toFixed(0)}ms かかっている（上限 400ms）＝そのあいだ画面が止まる`);
  const n = await page.evaluate(() => AQ.app.events.length);
  ok(`A LIVE の作り直し（${n} 件のログ）: ${ts.map(x => x.toFixed(0)).join(' / ')} ms`);
}

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
