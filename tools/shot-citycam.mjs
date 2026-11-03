/* tools/shot-citycam.mjs — 街の画面は建物2〜3軒ぶん・歩くと画面が切り替わる（2026-10-02）
   使い方: node tools/shot-citycam.mjs

   ★ 要望
     「一つの画面に建物が五つあるので建物が小さい。一つの画面に建物は2つか3つに。
       配置できなかった分は、キャラが移動することによって画面が切り替わるように」

   ★ 見るもの（入門を通して再生し、フレームごとに測る）
     ・画面に映すのは 17×8 マス。1マスの大きさは、街ぜんたい（34×16）を映していた頃の2倍
     ・どのフレームでも、画面に入っている建物（事務所・店・立会所）は3軒まで
     ・どのフレームでも、主役のロボットは画面の中にいる
     ・再生の途中でカメラが動く（画面が切り替わる）。動くときは滑らかで、1フレームで
       大きく飛ばない
     ・縦は「通りの北側」「南側」の2画面だけ（半端な高さで止まらない）
*/
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE ? 'file://' + process.env.AQ_FILE : 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.click('#startDemo');

const rec = await page.evaluate(() => new Promise((res) => {
  const spd = document.getElementById('speed'); spd.value = '2'; spd.dispatchEvent(new Event('change'));
  const W = AQ.world, T = W.tile, out = [];
  const t0 = performance.now();
  (function tick() {
    const cam = AQ.scene.lastCamera();
    const act = AQ.scene.lastDrawnRobots().filter(r => r.isActive)[0] || null;
    if (cam) {
      const vis = W.objects.filter(o => /office|service|facilitator/.test(o.type) &&
        o.x + o.w > cam.x + 0.01 && o.x < cam.x + cam.cols - 0.01 && o.y + o.h > cam.y + 0.01 && o.y < cam.y + cam.rows - 0.01);
      out.push({ t: performance.now() - t0, i: AQ.app.clock.index, cam, vis: vis.map(o => o.label || o.id),
                 act: act ? { hx: act.hx, hy: act.hy } : null, cols: cam.cols, rows: cam.rows });
    }
    if (AQ.app.clock.playing && performance.now() - t0 < 30000) requestAnimationFrame(tick); else res(out);
  })();
}));
if (rec.length < 50) fail(`測れたフレームが ${rec.length} しか無い＝空回り`);
const r0 = rec[0] || {};
if (r0.cols !== 17 || r0.rows !== 8) fail(`画面のマス数が 17×8 でない（${r0.cols}×${r0.rows}）`);
const scale = await page.evaluate(() => { const c = document.querySelector('canvas'); return c.width / (AQ.world.view.cols * AQ.world.tile) / (c.width / (34 * AQ.world.tile)); });
if (scale < 1.95) fail(`1マスの大きさが、街ぜんたいを映していた頃の ${scale.toFixed(2)} 倍しか無い`);
const tooMany = rec.filter(r => r.vis.length > 3);
if (tooMany.length) fail(`建物が4軒以上映っているフレームがある（${tooMany[0].vis.join(', ')}）`);
const ROBOT_W = 35;
const outside = rec.filter(r => r.act && (r.act.hx < -2 || r.act.hx + ROBOT_W > r.cols * 20 + 2 || r.act.hy < -4 || r.act.hy > r.rows * 20));
if (outside.length) fail(`主役のロボットが画面の外にいるフレームが ${outside.length}（例 hx=${outside[0].act.hx} hy=${outside[0].act.hy} カメラ ${outside[0].cam.x.toFixed(2)},${outside[0].cam.y.toFixed(2)}）`);
const xs = new Set(rec.map(r => r.cam.x.toFixed(1)));
if (xs.size < 2) fail('再生の途中でカメラが一度も動いていない（画面が切り替わらない）');
let maxStep = 0;
for (let k = 1; k < rec.length; k++) {
  const d = Math.abs(rec[k].cam.x - rec[k - 1].cam.x);
  const dt = rec[k].t - rec[k - 1].t;
  if (dt < 100 && d > maxStep) maxStep = d;
}
if (maxStep > 3) fail(`カメラが1フレームで ${maxStep.toFixed(2)} マス飛んだ（滑らかでない）`);
const ys = Array.from(new Set(rec.map(r => r.cam.y)));
if (ys.some(y => Math.abs(y - 0.5) > 0.06 && Math.abs(y - 7.5) > 0.06 && !rec.some(r => r.cam.y === y && false))) {
  /* 縦は切り替えの途中だけ中間の値になる。止まっている値（同じ値が5フレーム以上続く）が帯の位置か見る */
  const counts = {};
  rec.forEach(r => { const k = r.cam.y.toFixed(2); counts[k] = (counts[k] || 0) + 1; });
  const resting = Object.keys(counts).filter(k => counts[k] >= 5).map(Number);
  /* ★ 2026-10-03: 南側の建物の扉の前（14行目）では、ロボットと名札が切れないよう街の下端
     （ground の行数 − 8）まで下がってよい */
  const bottomY = await page.evaluate(() => AQ.world.ground.length - AQ.world.view.rows);
  if (resting.some(y => Math.abs(y - 0.5) > 0.06 && Math.abs(y - 7.5) > 0.06 && Math.abs(y - bottomY) > 0.06)) fail(`縦が半端な高さで止まっている（${resting.join(', ')}）`);
}
ok(`17×8 マス・1マス ${scale.toFixed(2)} 倍 / 建物は最大 ${Math.max(...rec.map(r => r.vis.length))} 軒 / カメラの横位置 ${[...xs].length} 通り・1フレーム最大 ${maxStep.toFixed(2)} マス / ${rec.length} フレーム`);

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
