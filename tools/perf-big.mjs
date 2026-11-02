/* 計測用（検査ではない）: 大きなログでの1フレームの重さと、ロボットの動きの跳び */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();
export function bigLog(nJobs = 1400, star = 215) {
  const M = []; let s = 1, t = 0;
  const K = ['build', 'research', 'explain', 'review', 'other'];
  for (let i = 0; i < nJobs; i++) {
    const id = 'bg' + i;
    const who = i < star ? 'did:key:zStar' : 'did:key:zA' + (i % 30);
    M.push({ seq: s++, from: 'did:key:zP' + (i % 12), text: `JOB v1 | ${id} | ${K[i % 5]} | Task ${i} | d`, ts: iso(t += 300) });
    M.push({ seq: s++, from: who, text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 300) });
    if (i % 3) M.push({ seq: s++, from: who, text: `DELIVER v1 | ${id} | done`, ts: iso(t += 300) });
    if (i % 3 === 1) M.push({ seq: s++, from: 'did:key:zJ' + (i % 4), text: `ATTEST v1 | ${id} | ${i % 2 ? 'useful | ok' : 'not | thin'}`, ts: iso(t += 300) });
    if (i < star) { M.push({ seq: s++, from: who, text: `note a ${i}`, ts: iso(t += 50) }); M.push({ seq: s++, from: who, text: `note b ${i}`, ts: iso(t += 50) }); }
  }
  return M;
}
const isMain = process.argv[1] && process.argv[1].endsWith('perf-big.mjs');
if (isMain) {
  const M = bigLog();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  const THR = Number(process.env.THR || 1);
  if (THR > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR }); }
  console.log('messages', M.length, 'throttle', THR);
  await page.evaluate((m) => { AQ.adapters.kibbleForget('bg'); AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'bg', observedAt: Date.now() })); }, M);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__P = { stage: [], hud: [], gaps: [], walk: [], idx: [] };
    const wrap = (obj, name, key) => { const f = obj[name]; obj[name] = function () { const t0 = performance.now(); const r = f.apply(this, arguments); __P[key].push(performance.now() - t0); return r; }; };
    wrap(AQ.stage, 'render', 'stage'); wrap(AQ.hud, 'update', 'hud');
    let last = performance.now();
    let li = -1;
    (function tick(now) { const bi = AQ.app.clock.index; __P.gaps.push([now - last, bi !== li]); li = bi; last = now; const w = AQ.room.lastWalk && AQ.room.lastWalk(); __P.walk.push(w ? [w.x, w.y, AQ.app.clock.index] : null); requestAnimationFrame(tick); })(last);
  });
  const t0 = Date.now();
  await page.evaluate(() => { const r = document.querySelector('.agentrow[data-agent="did:key:zStar"]'); r.click(); });
  const clickMs = Date.now() - t0;
  await page.evaluate(() => { const s = document.getElementById('speed'); s.value = '1'; s.dispatchEvent(new Event('change')); AQ.app.clock.play(); });
  await page.waitForTimeout(8000);
  const P = await page.evaluate(() => __P);
  const st = (a) => { a = a.slice().sort((x, y) => x - y); const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0; return `n=${a.length} p50=${q(.5).toFixed(1)} p90=${q(.9).toFixed(1)} max=${(a[a.length - 1] || 0).toFixed(1)}`; };
  console.log('click handler (roundtrip ms)', clickMs);
  console.log('stage.render ms', st(P.stage));
  console.log('hud.update ms ', st(P.hud));
  const G = P.gaps.slice(2);
  console.log('frame gaps ms ', st(G.map(g => g[0])));
  console.log('  at beat change', st(G.filter(g => g[1]).map(g => g[0])));
  console.log('  otherwise     ', st(G.filter(g => !g[1]).map(g => g[0])));
  let jumps = 0, maxJ = 0;
  for (let i = 1; i < P.walk.length; i++) { const a = P.walk[i - 1], b = P.walk[i]; if (a && b && a[2] === b[2]) { const d = Math.hypot(a[0] - b[0], a[1] - b[1]); maxJ = Math.max(maxJ, d); if (d > 0.2) jumps++; } }
  console.log('walk max step per frame (tiles)', maxJ.toFixed(3), 'jumps>0.2', jumps);
  await browser.close();
}
