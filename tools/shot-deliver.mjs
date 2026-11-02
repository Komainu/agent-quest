/* tools/shot-deliver.mjs — 納品は「品物を投入口へ落とし入れる」絵にする（2026-09-28）
   使い方: node tools/shot-deliver.mjs [--shots]

   ★ 報告
     納品している感じが出ていない。品物はもう納品口に置かれていて、
     足もとの黒い楕円から粒が上へ噴き出しているだけ。
       1. 品物が本人の手元から離れ、重さで投入口へ落ちていく
       2. 床の染みに見える楕円をやめ、家具としての投入口（ふた付き）にする
       3. 粒は上へ噴き出さない。入った瞬間に横へ弾ける
       4. 本人が「手放す」動き（腕を伸ばす）

   ★ 見るもの（納品のコマを、納品口に着いたあとの 4 つの時点で止めて調べる）
     運んでいる（q=0.15）: 腕が出ている・品物は本人の近く・まだ納品口に並んでいない
                           看板の数もまだ増えていない・ふたが開きかけ・本人は台を向く
     落ちている（q=0.5）: 品物は投入口の真上にあって、下へ向かって口に隠れはじめている
                           腕は品物をつかんでいない
     入った直後（q=0.7）: 砂ぼこりが出ていて、どの粒も横向き（|dx| > |dy|）・上へ噴き出さない
                           品物が納品口に並び、看板の数が増えている
     コマの終わり（q=1）: ふたは閉じ、砂ぼこり・腕・落ちる品物は無い
     ほかに: 投入口は納品のコマ以外でも（閉じた状態で）いつも描かれている
             足もとの楕円・上向きの粒（suction）はもう出ない
*/
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const SHOTS = process.argv.includes('--shots');
const SCR = '/tmp/claude-0/-home-claude/771479e9-d120-5f80-8905-16d478e5aced/scratchpad';
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 3; i++) {
    const id = 'dv' + i;
    MSGS.push({ seq: s++, from: 'did:key:zP', text: `JOB v1 | ${id} | ${['build', 'review', 'weird'][i]} | T ${i} | d`, ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zW' + i, text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zW' + i, text: `DELIVER v1 | ${id} | done`,  ts: iso(t += 900) });
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
await page.evaluate((m) => {
  AQ.adapters.kibbleForget('dv');
  AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'dv', observedAt: Date.now() }));
}, MSGS);
await page.waitForTimeout(300);

async function at(i, q) {
  return page.evaluate(({ i, q }) => {
    const c = AQ.app.clock;
    c.pause(); c.seek(i);
    const b = c.beats[i], d = c.durationOf(i);
    const pA = Math.min(1, AQ.stage.walkMsFor(b) / d);
    c.elapsed = (pA + q * (1 - pA)) * d;
    c.onFrame();
  }, { i, q });
}
async function read() {
  await page.waitForTimeout(140);
  return page.evaluate(() => ({
    fx: AQ.room.lastFx(), hatch: AQ.room.lastHatch(), dust: AQ.room.lastDust(), drop: AQ.room.lastDrop(),
    act: AQ.room.lastActive(), trayIds: AQ.room.lastTray(), signs: AQ.room.lastSigns(), badges: AQ.room.lastBadges(),
    tray: (() => { const L = AQ.room.computeDropoffLayout(AQ.app.clock.beats[AQ.app.clock.index].index); return L; })()
  }));
}

let checked = 0, closedElsewhere = 0, otherBeats = 0;
for (const job of ['dv0', 'dv1', 'dv2']) {
  await page.evaluate((j) => AQ.app.focusOnJob(j), job);
  await page.waitForTimeout(250);
  const beats = await page.evaluate(() => AQ.app.clock.beats.map((b, i) => ({
    i, kind: b.kind, job: b.lead && b.lead.meta && b.lead.meta.job, v: b.lead && b.lead.meta && b.lead.meta.verdict })));
  const dvb = beats.filter(b => b.kind === 'receive' && b.job && !b.v);
  if (dvb.length !== 1) { fail(`${job}: 納品のコマが ${dvb.length} 個（1個のはず）`); continue; }
  const i = dvb[0].i, tag = `${job} コマ${i}`;

  /* 納品以外のコマ：投入口は閉じて据えてある */
  for (const b of beats.filter(b => b.i !== i)) {
    await at(b.i, 0.5); const r = await read(); otherBeats++;
    if (r.hatch && r.hatch.open === 0) closedElsewhere++;
    if (r.fx.indexOf('suction') !== -1) fail(`${job} コマ${b.i}: 昔の上向きの粒（suction）が出ている`);
  }

  /* 運んでいる */
  await at(i, 0.15); const a = await read();
  if (SHOTS) await page.screenshot({ path: `${SCR}/dv-${job}-a.png` });
  if (!a.drop || a.drop.stage !== 'reach') fail(`${tag} q=0.15 で「運んでいる」になっていない（${a.drop && a.drop.stage}）`);
  if (a.trayIds.indexOf(job) !== -1) fail(`${tag} 運んでいる最中なのに、品物がもう納品口の中に並んでいる`);
  if (a.fx.indexOf('arm') === -1) fail(`${tag} 運んでいるのに腕が出ていない`);
  if (!a.hatch || !(a.hatch.open > 0 && a.hatch.open < 1)) fail(`${tag} ふたが開きかけていない（${a.hatch && a.hatch.open}）`);
  if (!a.act || a.act.dir !== 'down') fail(`${tag} 納品中の本人が台のほうを向いていない`);
  if (a.badges.length) fail(`${tag} 着いたあとも頭上の絵が出ている`);
  if (a.drop && a.drop.arm) {
    const d = Math.hypot(a.drop.arm.tx - (a.drop.card.x + a.drop.card.w / 2), a.drop.arm.ty - a.drop.card.y);
    if (d > 6) fail(`${tag} 腕の先が品物をつかんでいない（${d.toFixed(1)}px 離れている）`);
    /* 2026-09-28「手と胴体が離れている。二の腕を足しては」:
       肩は胴体のふちに付いている／肩→ひじ（二の腕）とひじ→手（前腕）の2本がある／
       ひじは体の外側に出ている（二の腕が胴体に隠れない） */
    const A = a.drop.arm, B = a.drop.body, sd = a.drop.side;
    const edge = sd > 0 ? B.x + B.w : B.x;
    if (!(Math.abs(A.sx - edge) <= 4 && A.sy >= B.y && A.sy <= B.y + B.h)) fail(`${tag} 肩が胴体のふちに付いていない（肩 x=${A.sx} ふち x=${edge.toFixed(1)}）`);
    if (A.ex == null) fail(`${tag} ひじ（二の腕と前腕のつなぎ目）が無い`);
    else {
      const up = Math.hypot(A.ex - A.sx, A.ey - A.sy), fore = Math.hypot(A.tx - A.ex, A.ty - A.ey);
      if (up < 6 || fore < 6) fail(`${tag} 二の腕（${up.toFixed(1)}px）か前腕（${fore.toFixed(1)}px）が短すぎて見えない`);
      if ((A.ex - edge) * sd < 2) fail(`${tag} ひじが体の外に出ていない（二の腕が胴体に隠れる）`);
    }
  }

  /* 落ちている */
  await at(i, 0.5); const f = await read();
  if (SHOTS) await page.screenshot({ path: `${SCR}/dv-${job}-b.png` });
  if (!f.drop || f.drop.stage !== 'fall' || !f.drop.card) fail(`${tag} q=0.5 で品物が落ちていない（${f.drop && f.drop.stage}）`);
  else {
    const h = f.hatch, c = f.drop.card;
    if (Math.abs((c.x + c.w / 2) - (h.x + h.w / 2)) > 2) fail(`${tag} 落ちる品物が投入口の真上に無い`);
    if (!(c.y > a.drop.card.y)) fail(`${tag} 品物が下へ向かっていない`);
    if (!f.drop.clipped) fail(`${tag} 品物が口の中へ隠れていかない`);
    if (f.hatch.open !== 1) fail(`${tag} 落ちているのにふたが全開でない`);
    if (f.drop.arm && Math.hypot(f.drop.arm.tx - (c.x + c.w / 2), f.drop.arm.ty - c.y) < 6) fail(`${tag} 手を放したはずなのに腕が品物についていっている`);
  }
  const sa = a.signs.find(s => s.kind === 'dropoff');

  /* 入った直後 */
  await at(i, 0.7); const l = await read();
  if (SHOTS) await page.screenshot({ path: `${SCR}/dv-${job}-c.png` });
  if (f.trayIds.indexOf(job) !== -1) fail(`${tag} 落ちている最中なのに、品物がもう納品口の中に並んでいる`);
  if (l.trayIds.indexOf(job) === -1) fail(`${tag} 入ったあとなのに、品物が納品口の中に並んでいない`);
  if (!l.dust.length) fail(`${tag} 入った直後に砂ぼこりが出ていない`);
  const vertical = l.dust.filter(d => Math.abs(d.dx) <= Math.abs(d.dy));
  if (vertical.length) fail(`${tag} 横ではなく縦に飛んでいる粒が ${vertical.length} 個`);
  if (l.dust.some(d => d.dy < -Math.abs(d.dx))) fail(`${tag} 上へ噴き出す粒がある`);
  if (l.drop && l.drop.card) fail(`${tag} 入ったあとも落ちる品物が描かれている`);
  const sl = l.signs.find(s => s.kind === 'dropoff');
  if (!sa || !sl || sl.n !== sa.n + 1) fail(`${tag} 入った瞬間に看板の数が1つ増えていない（運搬中 ${sa && sa.n} → 入った後 ${sl && sl.n}）`);

  /* コマの終わり */
  await at(i, 1); const e = await read();
  if (!e.hatch || e.hatch.open !== 0) fail(`${tag} コマの終わりにふたが閉じていない`);
  if (e.dust.length || e.fx.indexOf('arm') !== -1 || (e.drop && e.drop.card)) fail(`${tag} コマの終わりに演出が残っている`);
  checked++;
}
if (checked < 3) fail(`納品のコマを ${checked} 個しか調べられなかった＝空回り`);
if (!otherBeats || closedElsewhere !== otherBeats) fail(`納品以外のコマで投入口が閉じて描かれていない（${closedElsewhere}/${otherBeats}）`);
ok(`納品 ${checked} 件 / 納品以外のコマで閉じた投入口 ${closedElsewhere}/${otherBeats}`);

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
