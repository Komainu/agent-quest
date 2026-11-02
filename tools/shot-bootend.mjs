/* tools/shot-bootend.mjs — 始動と終了の動作・種類の印の説明（2026-09-30）
   使い方: node tools/shot-bootend.mjs

   ★ 要望
     ① エージェントの名前をクリックして動き出すとき、初めて動きだすときは始動の
        動作を。タスクを終了するときも終了する動作を。
     ② 星印やハンマーのマークは何を意味しているのか（→ マウスを乗せると
        「依頼の種類：作る」のように出す。一覧の印にも、絵の中の札にも）

   ★ 見るもの
     始動: 選んだ直後、コマは1つも進まず（コマ0・経過0）、ロボットはその場。
           暗い体 → 光の輪 → 一跳ね → きらきら、が全部出る。頭上の絵は出ない。
           長さは実時間で約1.3秒（再生速度 1× でも 0.25× でも同じ）。
     終了: 最後のコマのあと、すぐには止まらず、跳ねる（星）→ 暗くなって休む（Z）。
           約1.7秒後に止まる。止まったあとの絵は「休んでいる」まま。コマは最後のまま。
     巻き戻す（コマを選ぶ）と終了の状態は消える。▶ で頭からもう一度始動する。
     全員表示（誰も選んでいない）では始動も終了も入れない。
     説明: 一覧の種類の印の説明が「依頼の種類：…」。絵の中の札にマウスを乗せても同じ。
*/
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE ? 'file://' + process.env.AQ_FILE : 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 3; i++) {
    const id = 'be' + i;
    MSGS.push({ seq: s++, from: 'did:key:zP', text: `JOB v1 | ${id} | ${['build', 'review', 'research'][i]} | Task ${i} | d`, ts: iso(t += 700) });
    MSGS.push({ seq: s++, from: 'did:key:zW', text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 700) });
    MSGS.push({ seq: s++, from: 'did:key:zW', text: `DELIVER v1 | ${id} | done`, ts: iso(t += 700) });
  }
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate((m) => { AQ.adapters.kibbleForget('be'); AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'be', observedAt: Date.now() })); }, MSGS);
await page.waitForTimeout(300);

/* 選んで、フレームごとに記録（ms だけ） */
async function recordFromClick(speed, ms) {
  return page.evaluate(({ speed, ms }) => new Promise((res) => {
    const spd = document.getElementById('speed'); spd.value = String(speed); spd.dispatchEvent(new Event('change'));
    AQ.app.focusClear();
    AQ.app.setListMode('agents');
    const t0 = performance.now();
    document.querySelector('.agentrow[data-agent="did:key:zW"]').click();
    const rec = [];
    (function tick() {
      const c = AQ.app.clock, w = AQ.room.lastWalk();
      rec.push({ t: performance.now() - t0, i: c.index, e: c.elapsed, ph: c.phase(), look: AQ.room.lastPhase(),
                 w: w ? [w.x, w.y] : null, badges: AQ.room.lastBadges().length, playing: c.playing });
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(rec);
    })();
  }), { speed, ms });
}

for (const speed of [1, 0.25]) {
  const rec = await recordFromClick(speed, 2200);
  const boot = rec.filter(r => r.ph.boot != null);
  const tag = `始動（${speed}×）`;
  if (boot.length < 10) { fail(`${tag}: 始動の間のフレームが ${boot.length} しか無い（始動していない）`); continue; }
  const dur = boot[boot.length - 1].t;
  if (dur < 1500 || dur > 2200) fail(`${tag}: 始動の長さ ${dur.toFixed(0)}ms（約1800ms のはず。再生速度で変わってはいけない）`);   // 2026-10-04: 1.3秒→1.8秒
  if (boot.some(r => r.i !== 0 || r.e !== 0)) fail(`${tag}: 始動の間にコマが進んでいる`);
  const w0 = boot.find(r => r.w);
  if (w0 && boot.some(r => r.w && Math.hypot(r.w[0] - w0.w[0], r.w[1] - w0.w[1]) > 1e-6)) fail(`${tag}: 始動の間にロボットが歩いている`);
  const fx = new Set(); let minB = 9, maxHop = 0, noLook = 0;
  boot.forEach(r => { if (!r.look) { noLook++; return; } r.look.fx.forEach(f => fx.add(f)); minB = Math.min(minB, r.look.bright); maxHop = Math.max(maxHop, r.look.hop); });
  if (noLook > 2) fail(`${tag}: 始動中なのに始動の絵が描かれていないフレームが ${noLook}`);
  if (!(minB < 0.5)) fail(`${tag}: 電源が入る前の暗い体が出ていない（最小の明るさ ${minB}）`);
  if (!fx.has('ring')) fail(`${tag}: アンテナの光の輪が出ていない`);
  if (!fx.has('spark')) fail(`${tag}: きらきらが出ていない`);
  if (!(maxHop > 0)) fail(`${tag}: 一跳ねしていない`);
  if (boot.some(r => r.badges)) fail(`${tag}: 始動中に頭上の絵が出ている`);
  const after = rec.filter(r => r.ph.boot == null && r.t > dur);
  if (!after.some(r => r.e > 0 || r.i > 0)) fail(`${tag}: 始動のあと、再生が始まっていない`);
  ok(`${tag}: ${dur.toFixed(0)}ms / 暗さ ${minB.toFixed(2)} / 跳ね ${maxHop}px / ${[...fx].join(',')}`);
}

/* ---- 終了 ---- */
{
  const rec = await page.evaluate(() => new Promise((res) => {
    const c = AQ.app.clock;
    const spd = document.getElementById('speed'); spd.value = '1'; spd.dispatchEvent(new Event('change'));
    c.pause(); c.seek(c.beats.length - 1); c.elapsed = Math.max(0, c.durationOf(c.index) - 60); c.play();
    const t0 = performance.now(), out = [];
    (function tick() {
      out.push({ t: performance.now() - t0, i: c.index, n: c.beats.length, ph: c.phase(), look: AQ.room.lastPhase(), playing: c.playing });
      if (c.playing && performance.now() - t0 < 4000) requestAnimationFrame(tick);
      else setTimeout(() => { out.push({ t: performance.now() - t0, i: c.index, n: c.beats.length, ph: c.phase(), look: AQ.room.lastPhase(), playing: c.playing, final: true }); res(out); }, 150);
    })();
  }));
  const end = rec.filter(r => r.ph.end > 0);
  const fin = rec[rec.length - 1];
  if (end.length < 10) fail(`終了: 終了の間のフレームが ${end.length} しか無い（すぐ止まっている）`);
  else {
    const dur = end[end.length - 1].t - end[0].t;
    if (dur < 1300 || dur > 2200) fail(`終了: 終了の動作の長さ ${dur.toFixed(0)}ms（約1700ms のはず）`);
    const fx = new Set(); let maxHop = 0;
    end.forEach(r => { if (r.look) { r.look.fx.forEach(f => fx.add(f)); maxHop = Math.max(maxHop, r.look.hop); } });
    if (!fx.has('stars')) fail('終了: 星が散っていない');
    if (!fx.has('zz')) fail('終了: 休む（Z）が出ていない');
    if (!(maxHop > 0)) fail('終了: 跳ねていない');
    if (end.some(r => r.i !== r.n - 1)) fail('終了: 終了の間にコマが動いた');
    ok(`終了: ${dur.toFixed(0)}ms / 跳ね ${maxHop}px / ${[...fx].join(',')}`);
  }
  if (fin.playing) fail('終了: 終了の動作のあとも止まらない');
  if (!fin.look || fin.look.stage !== 'end' || fin.look.bright > 0.5 || fin.look.fx.indexOf('zz') === -1) fail('終了: 止まったあとの絵が「休んでいる」になっていない');
  if (fin.i !== fin.n - 1) fail('終了: 止まったコマが最後のコマではない');
}

/* ---- 終わったあとで別の依頼を選ぶ → 終了の状態を引きずらず、始動から ----
   （以前、終了の記憶が残ったまま別の子を選ぶと、いきなり「終わった」絵に
    飛んでいた。検査で見つけた不具合） */
{
  const r = await page.evaluate(() => new Promise(res => {
    AQ.app.focusOnJob('be1');
    requestAnimationFrame(() => requestAnimationFrame(() => res({ i: AQ.app.clock.index, ph: AQ.app.clock.phase(), playing: AQ.app.clock.playing })));
  }));
  if (!r.playing || r.ph.end > 0 || r.ph.boot == null || r.i !== 0) fail(`終わったあと別の依頼を選んでも始動から始まらない（${JSON.stringify(r)}）`);
  ok(`終わったあと別の依頼: 始動 ${r.ph.boot != null} / 終了 ${r.ph.end} / コマ ${r.i}`);
}

/* ---- 巻き戻すと消える・▶ で頭からもう一度始動 ---- */
{
  const r = await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(1); return { end: c.phase().end, look: AQ.room.lastPhase() }; });
  if (r.end !== 0 || (r.look && r.look.stage === 'end')) fail('コマを選び直しても終了の状態が残っている');
  await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(c.beats.length - 1); c.elapsed = c.durationOf(c.index); });
  await page.click('#play');
  const r2 = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => res({ i: AQ.app.clock.index, boot: AQ.app.clock.phase().boot }))));
  if (r2.i !== 0 || r2.boot == null) fail(`▶ で頭から再生したとき始動していない（コマ ${r2.i} / 始動 ${r2.boot}）`);
  ok(`巻き戻し: 終了の状態 ${r.end} / ▶ で頭から: コマ ${r2.i}・始動 ${r2.boot != null}`);
}

/* ---- 全員表示では入れない ---- */
{
  const r = await page.evaluate(() => new Promise((res) => {
    AQ.app.focusClear();
    const c = AQ.app.clock; c.pause(); c.seek(0); c.play();
    requestAnimationFrame(() => requestAnimationFrame(() => res({ boot: c.phase().boot, bootMs: c.bootMs, tailMs: c.tailMs, chosen: AQ.app.hasChosen, fa: AQ.app.focusActor, fj: AQ.app.focusJob })));
  }));
  if (r.boot != null || r.bootMs || r.tailMs) fail(`全員表示なのに始動・終了が入っている（${JSON.stringify(r)}）`);
  ok(`全員表示: 始動 ${r.bootMs}ms / 終了 ${r.tailMs}ms`);
}

/* ---- ② 種類の印の説明 ---- */
{
  await page.evaluate(() => { AQ.app.setListMode('jobs'); });
  await page.waitForTimeout(200);
  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('.roster-chips .kchip')).map(k => k.getAttribute('title')));
  if (!chips.length) fail('一覧に種類の印が1つも無い＝空回り');
  const badChip = chips.filter(t => !/^依頼の種類：/.test(t || ''));
  if (badChip.length) fail(`一覧の種類の印の説明が「依頼の種類：…」になっていない: ${badChip.join(' / ')}`);
  /* 絵の中の札（依頼を1件選び、板の札の上にマウスを置く） */
  const pos = await page.evaluate(() => {
    AQ.app.focusOnJob('be0'); const c = AQ.app.clock; c.pause(); c.seek(c.beats.length - 1);
    c.elapsed = c.durationOf(c.index); c.onFrame();     // 運び終えて、札が納品口に置かれた絵
    const b = c.beats[c.beats.length - 1];
    const all = [AQ.room.computeBoardLayout(b.index), AQ.room.computeDropoffLayout(b.index), AQ.room.computeInspectLayout(b.index)]
      .map(L => ({ shown: (L.shown || []).filter(s => s.card && String(s.card.id) === 'be0') }));
    let r = null; all.forEach(L => (L.shown || []).forEach(s => { if (!r && s.card && s.rect) r = s.rect; }));
    if (!r) return null;
    const cv = document.querySelector('canvas'), cr = cv.getBoundingClientRect();
    const W = AQ.roomWorld, ww = W.view.cols * W.tile, wh = W.view.rows * W.tile;
    return { x: cr.left + (r.x + r.w / 2) / ww * cr.width, y: cr.top + (r.y + r.h / 2) / wh * cr.height };
  });
  if (!pos) fail('絵の中に札が見つからない＝空回り');
  else {
    await page.mouse.move(pos.x, pos.y);
    await page.waitForTimeout(100);
    const tip = await page.evaluate(() => document.querySelector('canvas').title);
    if (!/^依頼の種類：作る/.test(tip)) fail(`絵の中の札にマウスを乗せても種類が出ない（"${tip}"）`);
    await page.mouse.move(5, 5);
    const tip2 = await page.evaluate(() => document.querySelector('canvas').title);
    ok(`説明: 一覧 ${chips.length} 個（例「${chips[0]}」）/ 絵の札 "${tip}" / 外すと "${tip2}"`);
  }
}

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
