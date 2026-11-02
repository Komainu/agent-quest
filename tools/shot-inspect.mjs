/* tools/shot-inspect.mjs — 検品は「本人が品物を調べる」絵にする（2026-09-28）
   使い方: node tools/shot-inspect.mjs [--shots]

   ★ 報告
     検品台から上へ青い光が出て本人に当たっていて、本人が身体検査を
     受けているように見える。本人が品物を調べているように見せたい。
       ・光の向きを逆に：本人の目 → 台の上の品物
       ・調べている品物を動かす（浮く・白く明滅）
       ・検品中は虫めがねを持つ
       ・✓ は頭上ではなく、品物そのものから弾け出る

   ★ 見るもの（判定のコマを、台に着いたあとの 2 つの時点で止めて調べる）
     調べている最中（q=0.25）
       ・光の起点（目）が本人の絵の中、的は検品台の上の品物、目が品物より上
       ・本人は台のほう（down）を向いている
       ・品物が浮いて明滅（float）、虫めがね（lens）が出ている
       ・その品物にはまだ合否の印が無い／看板の ✓・✗ の数にもまだ入っていない
     結果が出たあと（q=0.85）
       ・品物から弾けた印の合否がログと一致、印は品物の真上
       ・光と虫めがねは消えている
       ・頭上に印が浮いていない（印はすべて家具の中か、弾けた印だけ）
       ・看板の ✓・✗ の数が本当の数に戻っている
*/
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const SHOTS = process.argv.includes('--shots');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 4; i++) {
    const id = 'in' + i;
    MSGS.push({ seq: s++, from: 'did:key:zP', text: `JOB v1 | ${id} | ${['build', 'review'][i % 2]} | T ${i} | d`, ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zW', text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zW', text: `DELIVER v1 | ${id} | done`,  ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zJ', text: `ATTEST v1 | ${id} | ${i % 2 ? 'useful | ok' : 'not | thin'}`, ts: iso(t += 900) });
  }
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);
const inR = (r, x, y, pad = 0) => r && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate((m) => {
  AQ.adapters.kibbleForget('in');
  AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'in', observedAt: Date.now() }));
}, MSGS);
await page.waitForTimeout(300);
/* 依頼を1件ずつ選んで、その依頼の判定のコマを調べる（合格・不合格の両方） */
const verdictBeats = [];
async function pickJob(job) {
  await page.evaluate((j) => AQ.app.focusOnJob(j), job);
  await page.waitForTimeout(250);
  return page.evaluate(() => AQ.app.clock.beats
    .map((b, i) => ({ i, v: (b.lead && b.lead.meta && b.lead.meta.verdict) || null }))
    .filter(x => x.v));
}
for (const job of ['in0', 'in1', 'in2', 'in3']) verdictBeats.push({ job });
async function at(i, q) {
  return page.evaluate(({ i, q }) => {
    const c = AQ.app.clock;
    c.pause(); c.seek(i);
    const b = c.beats[i];
    const d = c.durationOf(i);
    const pA = Math.min(1, AQ.stage.walkMsFor(b) / d);
    c.elapsed = (pA + q * (1 - pA)) * d;
    c.onFrame();                        // 止めている間は自動では描き直さない
    return { d, pA };
  }, { i, q });
}
async function read() {
  await page.waitForTimeout(160);
  return page.evaluate(() => {
    const L = (f) => AQ.room[f](AQ.app.clock.beats[AQ.app.clock.index].index);
    return {
      fx: AQ.room.lastFx(), beam: AQ.room.lastBeam(), burst: AQ.room.lastBurst(),
      target: AQ.room.lastInspectTarget(), act: AQ.room.lastActive(), marks: AQ.room.lastMarks(),
      signs: AQ.room.lastSigns(), insp: L('computeInspectLayout'),
      board: L('computeBoardLayout'), drop: L('computeDropoffLayout'), held: AQ.room.lastHeldCards()
    };
  });
}

let seen = { ok: 0, ng: 0 };
for (const vj of verdictBeats) {
  const vs = await pickJob(vj.job);
  if (vs.length !== 1) { fail(`${vj.job}: 判定のコマが ${vs.length} 個（1個のはず）`); continue; }
  const vb = vs[0];
  const want = vb.v === 'useful';
  /* ---- 調べている最中 ---- */
  await at(vb.i, 0.25);
  const a = await read();
  if (SHOTS) await page.screenshot({ path: `/tmp/claude-0/-home-claude/771479e9-d120-5f80-8905-16d478e5aced/scratchpad/insp-${vj.job}-a.png` });
  const tag = `${vj.job} コマ${vb.i}（${vb.v}）`;
  for (const f of ['scan', 'lens', 'float']) if (a.fx.indexOf(f) === -1) fail(`${tag} 調べている最中に「${f}」が出ていない`);
  if (!a.beam) fail(`${tag} 光の起点・的が取れない`);
  else {
    if (!a.act || !inR(a.act.rect, a.beam.eye.x, a.beam.eye.y)) fail(`${tag} 光の起点が本人の絵の中に無い`);
    if (!(a.beam.eye.y < a.beam.target.y)) fail(`${tag} 光が本人から品物へ向いていない（目 y=${a.beam.eye.y} 品物 y=${a.beam.target.y}）`);
    if (!inR(a.insp.rect, a.beam.target.x + a.beam.target.w / 2, a.beam.target.y + a.beam.target.h / 2, 8)) fail(`${tag} 光の的が検品台の上に無い`);
  }
  if (a.beam && a.act) {
    const tcx = a.beam.target.x + a.beam.target.w / 2, rcx = a.act.rect.x + a.act.rect.w / 2;
    const side = await page.evaluate(() => AQ.room.lastLensSide());
    if (side !== (tcx < rcx ? -1 : 1)) fail(`${tag} 虫めがねを品物と反対の手に持っている`);
  }
  if (!a.act || a.act.dir !== 'down') fail(`${tag} 検品中の本人が台のほうを向いていない（${a.act && a.act.dir}）`);
  if (a.burst) fail(`${tag} 調べている最中なのに、もう印が弾けている`);
  if (a.target && a.marks.some(m => inR(a.target, m.x, m.y))) fail(`${tag} 調べている最中の品物に、もう合否の印が付いている`);
  /* ---- 結果が出たあと ---- */
  await at(vb.i, 0.85);
  const r = await read();
  if (SHOTS) await page.screenshot({ path: `/tmp/claude-0/-home-claude/771479e9-d120-5f80-8905-16d478e5aced/scratchpad/insp-${vj.job}-b.png` });
  if (!r.burst) fail(`${tag} 結果が出たのに品物から印が弾けていない`);
  else {
    if (r.burst.ok !== want) fail(`${tag} 弾けた印の合否がログと違う（${r.burst.ok ? '✓' : '✗'}）`);
    const f = r.burst.from;
    if (!(r.burst.y < f.y && Math.abs(r.burst.x - (f.x + f.w / 2)) < 2)) fail(`${tag} 印が品物の真上から出ていない`);
    if (!inR(r.insp.rect, f.x + f.w / 2, f.y + f.h / 2, 8)) fail(`${tag} 印の出どころが検品台の品物ではない`);
    seen[want ? 'ok' : 'ng']++;
  }
  if (r.fx.indexOf('scan') !== -1 || r.fx.indexOf('lens') !== -1) fail(`${tag} 結果が出たあとも光・虫めがねが残っている`);
  const rooms = [r.insp.rect, r.board.rect, r.drop.rect];
  const stray = r.marks.filter(m => !rooms.some(rc => inR(rc, m.x, m.y)) &&
                                    !(r.burst && Math.abs(m.x - r.burst.x) < 2 && Math.abs(m.y - r.burst.y) < 2));
  if (stray.length && !r.held.length) fail(`${tag} 家具の外（頭上など）に印が ${stray.length} 個浮いている`);
  /* 看板の数：結果が出たあとは印の付いた品物の数そのもの。調べている最中は
     その品物のぶんだけ少ない（品物に印が付いた瞬間に増える）。 */
  const sa = a.signs.find(s => s.kind === 'inspect'), sb = r.signs.find(s => s.kind === 'inspect');
  if (!sa || !sb) fail(`${tag} 検品台の看板が描かれていない`);
  else {
    if (sb.ok + sb.ng < 1) fail(`${tag} 結果が出たのに看板の ✓/✗ が 0`);
    const wOk = sb.ok - (want ? 1 : 0), wNg = sb.ng - (want ? 0 : 1);
    if (sa.ok !== wOk || sa.ng !== wNg) fail(`${tag} 調べている最中に看板の数が先に増えている（最中 ✓${sa.ok} ✗${sa.ng} ／ 結果 ✓${sb.ok} ✗${sb.ng}）`);
  }

  /* ---- コマの終わり（最後のコマで止まったときの絵）：弾けた印は消え、品物の印は残る ---- */
  await at(vb.i, 1);
  const e = await read();
  if (e.burst) fail(`${tag} コマの終わりでも弾けた印が看板の上に残っている`);
  if (!e.target || !e.marks.some(m => inR(e.target, m.x, m.y) && m.ok === want)) fail(`${tag} コマの終わりに品物の上の合否の印が無い`);
}
if (!seen.ok || !seen.ng) fail(`合格・不合格の両方を見られていない（✓${seen.ok} ✗${seen.ng}）＝空回り`);
ok(`判定のコマ ${verdictBeats.length} 個 / 弾けた印 ✓${seen.ok} ✗${seen.ng}`);

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
