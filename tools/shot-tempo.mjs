/* tools/shot-tempo.mjs — エージェントの動きの速さ（2026-10-03）
   使い方: node tools/shot-tempo.mjs
   ★ 要望「エージェントの動きが速い。今のスピードの半分ぐらいに」
     直す前（再生速度 1×）: 街 約 11.7 マス/秒・部屋 約 2.86 マス/秒（実測）
   ★ 見るもの（1× で実際に再生して、歩いているロボットの速さを測る）
     ・街 7 マス/秒以下（直す前の約半分）・部屋 1.6 マス/秒以下
     ・どちらも、ちゃんと歩いている（0.5 マス/秒より速い＝検査の空回りでない）
*/
import { chromium } from 'playwright';
import { bigLog } from './perf-big.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE || path.join(ROOT, 'dist', 'agent-quest.html');
const b=await chromium.launch({...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
async function measure(file){
  const p=await b.newPage({viewport:{width:1700,height:950}});
  await p.goto('file://'+file); await p.waitForFunction(()=>window.AQ&&AQ.app);
  // city: intro, measure robot world speed during walking via scene computeRobotScreenPositions? use lastDrawnRobots + lastCamera
  await p.click('#startDemo');
  const city=await p.evaluate(()=>new Promise(res=>{const s=document.getElementById('speed');s.value='1';s.dispatchEvent(new Event('change'));
    const T=AQ.world.tile; let prev=null, dist=0, time=0; const t0=performance.now();
    (function tick(){const cam=AQ.scene.lastCamera&&AQ.scene.lastCamera(); const a=AQ.scene.lastDrawnRobots().filter(r=>r.isActive)[0]; const now=performance.now();
      if(cam&&a){const wx=a.hx/T+cam.x, wy=a.hy/T+cam.y; if(prev){const d=Math.hypot(wx-prev.x,wy-prev.y); if(d>0.002&&d<1){dist+=d; time+=(now-prev.t)/1000;}} prev={x:wx,y:wy,t:now};}
      if(now-t0<20000) requestAnimationFrame(tick); else res({tps: dist/time, dist});})();}));
  // room
  await p.evaluate(m=>{AQ.adapters.kibbleForget('bg');AQ.app.loadEvents(AQ.adapters.fromKibble(m,{room:'bg',observedAt:Date.now()}));document.querySelector('.agentrow[data-agent="did:key:zStar"]').click();const s=document.getElementById('speed');s.value='1';s.dispatchEvent(new Event('change'));},bigLog(40,10));
  const room=await p.evaluate(()=>new Promise(res=>{let prev=null,dist=0,time=0;const t0=performance.now();
    (function tick(){const w=AQ.room.lastWalk();const now=performance.now(); if(w){ if(prev){const d=Math.hypot(w.x-prev.x,w.y-prev.y); if(d>0.002&&d<1){dist+=d;time+=(now-prev.t)/1000;}} prev={x:w.x,y:w.y,t:now};}
      if(now-t0<10000) requestAnimationFrame(tick); else res({tps:dist/time,dist});})();}));
  await p.close(); return {city, room};
}
let bad = 0;
const r = await measure(FILE);
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
if (!(r.city.tps > 0.5) || r.city.dist < 2) fail(`街でロボットが歩くところを測れなかった（${r.city.tps.toFixed(2)} マス/秒・${r.city.dist.toFixed(1)} マス）`);
if (!(r.room.tps > 0.5) || r.room.dist < 2) fail(`部屋でロボットが歩くところを測れなかった（${r.room.tps.toFixed(2)} マス/秒・${r.room.dist.toFixed(1)} マス）`);
if (r.city.tps > 7) fail(`街の歩く速さが速すぎる（${r.city.tps.toFixed(2)} マス/秒・上限 7）`);
if (r.room.tps > 1.6) fail(`部屋の歩く速さが速すぎる（${r.room.tps.toFixed(2)} マス/秒・上限 1.6）`);
console.log(`    · 1× の歩く速さ: 街 ${r.city.tps.toFixed(2)} マス/秒（直す前 約 11.7）/ 部屋 ${r.room.tps.toFixed(2)} マス/秒（直す前 約 2.86）`);
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
