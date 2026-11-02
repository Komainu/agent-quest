/* tools/shot-pace.mjs — 歩く速さは一定（2026-09-28）
   使い方: node tools/shot-pace.mjs

   ★ 報告
     「エージェント名をクリックすると、再生速度が 0.25 なのに、エージェントが
       猛然としたスピードで動き出し、その後 0.25倍の動きになる」

   ★ 原因（作りの問題として2つ）
     1. 件数の多い場面では、1コマの間に何度も往復させていた（往復のぶん速く歩く）
     2. どのコマも「決まった時間内に目的地まで歩き切る」作りで、遠い場所へ行く
        コマほど速く歩いていた
     どちらも「同じ再生速度なのに、場面によって歩く速さが違う」。

   ★ 直したこと
     歩く速さそのものを固定した（render/room.js の MS_PER_TILE＝1マス 350ms・1倍）。
     遠い場所へ行くコマは、歩き切れるだけコマ自体を長くする（engine/clock.js）。
     往復の加速はやめた。

   ★ 見るもの
     実際にブラウザで再生し、40ms ごとにロボットの位置（ワールド座標・マス）を
     取って、「歩いているあいだの速さ（マス/秒）」をコマごとに測る。
       ・どのコマも、期待値（1000 × 再生速度 ÷ MS_PER_TILE）の ±20% に収まる
       ・一瞬で大きく飛ぶ（ワープ）ことがない
     エージェントを選んだ「まとめ」と、全員表示（書き込みがまとまったコマを含む）の
     両方で測る。
*/
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* 件数が多い（以前なら何往復もした）＋ 書き込みの連投（まとめたコマ）を含むログ */
const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 120; i++) {
    const id = 'pc' + i;
    MSGS.push({ seq: s++, from: 'did:key:zP' + (i % 4), text: `JOB v1 | ${id} | build | T ${i} | d`, ts: iso(t += 200) });
    MSGS.push({ seq: s++, from: 'did:key:zToki', text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 200) });
    MSGS.push({ seq: s++, from: 'did:key:zToki', text: `DELIVER v1 | ${id} | done`,  ts: iso(t += 200) });
    if (i < 4) MSGS.push({ seq: s++, from: 'did:key:zToki', text: `ATTEST v1 | pc${i + 60} | useful | ok`, ts: iso(t += 200) });
    if (i % 20 === 0) {
      for (let k = 0; k < 40; k++) MSGS.push({ seq: s++, from: 'did:key:zToki', text: `note ${i}-${k}`, ts: iso(t += 20) });
    }
  }
}

const SPEED = 0.25;
let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function measure(label, setup, seconds) {
  const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  const msPerTile = await page.evaluate(({ m, sp }) => {
    AQ.adapters.kibbleForget('pc');
    AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'pc', observedAt: Date.now() }));
    const sel = document.getElementById('speed');
    sel.value = String(sp); sel.dispatchEvent(new Event('change'));
    return AQ.room.MS_PER_TILE;
  }, { m: MSGS, sp: SPEED });
  await setup(page);
  const want = 1000 * SPEED / msPerTile;         // マス/秒

  const perBeat = {};
  let prev = null, prevT = 0, maxJump = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const r = await page.evaluate(() => ({ i: AQ.app.clock.index, w: AQ.room.lastWalk(), playing: AQ.app.clock.playing }));
    const now = Date.now();
    if (r.w && prev && prev.i === r.i) {
      const d = Math.hypot(r.w.x - prev.w.x, r.w.y - prev.w.y);
      const dt = (now - prevT) / 1000;
      if (d > maxJump) maxJump = d;
      if (d > 0.005 && dt > 0) {                  // 歩いているサンプルだけ
        const e = perBeat[r.i] || (perBeat[r.i] = { d: 0, t: 0 });
        e.d += d; e.t += dt;
      }
    }
    prev = r.w ? { i: r.i, w: r.w } : null; prevT = now;
    if (!r.playing && Object.keys(perBeat).length) break;
    await page.waitForTimeout(40);
  }
  const rows = Object.keys(perBeat).map(k => ({ i: k, v: perBeat[k].d / perBeat[k].t, d: perBeat[k].d }))
                                   .filter(x => x.d > 0.5);   // ほとんど歩かないコマは測らない
  if (!rows.length) fail(`${label}: 歩いたコマを1つも測れなかった＝この検査は空回り`);
  for (const x of rows) {
    if (x.v > want * 1.2 || x.v < want * 0.8) {
      fail(`${label} コマ${x.i}: 歩く速さ ${x.v.toFixed(2)}マス/秒（期待 ${want.toFixed(2)}±20%）＝場面で速さが変わっている`);
    }
  }
  /* 40ms ごとの移動が、期待の速さの 3 倍を超えたらワープ */
  const jumpLimit = want * 0.04 * 3 + 0.05;
  if (maxJump > jumpLimit) fail(`${label}: 40ms で ${maxJump.toFixed(2)} マス動いた（ワープ）`);
  ok(`${label}: 期待 ${want.toFixed(2)}マス/秒 / ` + rows.map(x => `コマ${x.i}=${x.v.toFixed(2)}（${x.d.toFixed(1)}マス）`).join(' '));
  await page.close();
}

/* 1) エージェントを選んだ「まとめ」（報告の場面そのもの） */
await measure('まとめ', async (page) => {
  await page.evaluate(() => document.querySelector('.agentrow[data-agent="did:key:zToki"]').click());
}, 40);

/* 2) 全員表示。書き込みをまとめたコマ（以前は件数に応じて何往復もした）を含む */
await measure('全員表示', async (page) => {
  await page.evaluate(() => {
    AQ.app.focusClear();
    const bs = AQ.app.clock.beats;
    let k = bs.findIndex(b => b.kind === 'actbatch');
    if (k < 0) k = 0;
    AQ.app.clock.seek(Math.max(0, k - 1));
    AQ.app.clock.play();
  });
}, 30);

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
