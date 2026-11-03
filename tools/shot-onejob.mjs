/* tools/shot-onejob.mjs — 再生ボタン・1件の仕事・ID を画面から外す（2026-09-28）
   使い方: node tools/shot-onejob.mjs

   ★ 報告と要望
     ① 再生ボタンを押しても停止ボタンに切り替わらない（ずっと ▶ のまま）
        → 最後まで再生し終わったあとに ▶ を押すと、時計が最後のコマで止まった
          まま何も起きなかった。終わっていたら頭から再生する。
     ② エージェント目線だと、取り組んでいる仕事がころころ変わって分かりづらい。
        表示上は1件の仕事をずっと表示しておいてほしい
        → エージェントを選んだら、その子の代表の依頼1件だけを再生する。
     ・「η10」「γ2」のような ID は画面から消し、絵だけにする（ID は詳細で見る）
     ・不合格の品物は「壊れた」見た目に（黒ずみ＋ひび）
     ・いま扱っている依頼の行を右の一覧で光らせる
     ・①〜④のランプを「評価の星」ではなく「工程」に見せる（線でつなぐ・中空の輪）

   ★ ついでに見つけて直した不具合
     エージェントを選んだあとに「すべて表示（◎）」を押すと、絞り込みだけが
     残って、ステータス欄に「書き込み 0」という事実と違う数が出ていた。
*/
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

const K = ['build', 'research', 'explain', 'review', 'weird-kind'];
const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 10; i++) {
    const id = 'oj' + i;
    MSGS.push({ seq: s++, from: 'did:key:zP', text: `JOB v1 | ${id} | ${K[i % 5]} | Task ${i} | d`, ts: iso(t += 600) });
    MSGS.push({ seq: s++, from: 'did:key:zToki', text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 600) });
    MSGS.push({ seq: s++, from: 'did:key:zToki', text: `DELIVER v1 | ${id} | done`,  ts: iso(t += 600) });
    if (i < 7) MSGS.push({ seq: s++, from: 'did:key:zJ', text: `ATTEST v1 | ${id} | ${i % 2 ? 'useful | ok' : 'not | thin'}`, ts: iso(t += 600) });
    MSGS.push({ seq: s++, from: 'did:key:zToki', text: `note about ${id}`, ts: iso(t += 100) });
  }
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate((m) => {
  AQ.adapters.kibbleForget('oj');
  AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'oj', observedAt: Date.now() }));
}, MSGS);
await page.waitForTimeout(300);

/* ---------- ② エージェントを選ぶ → 1件の仕事だけ ---------- */
await page.evaluate(() => document.querySelector('.agentrow[data-agent="did:key:zToki"]').click());
await page.waitForTimeout(400);
{
  const r = await page.evaluate(() => ({
    focusJob: AQ.app.focusJob,
    jobs: Array.from(new Set(AQ.app.clock.beats.map(b => (b.lead && b.lead.meta && b.lead.meta.job) || '-'))),
    n: AQ.app.clock.beats.length,
    focusedRow: (document.querySelector('.roster-chips .jrow.focused') || {}).dataset
  }));
  if (r.focusJob == null) fail('エージェントを選んでも依頼が1件に決まっていない');
  if (r.jobs.length !== 1) fail(`再生中に仕事が入れ替わる（${r.jobs.join(', ')}）`);
  if (r.jobs[0] !== r.focusJob) fail(`再生している仕事（${r.jobs[0]}）と選ばれた依頼（${r.focusJob}）が違う`);
  if (!r.focusedRow || r.focusedRow.job !== r.focusJob) fail('右の一覧で、再生している依頼の行が光っていない');
  ok(`1件の仕事: ${r.focusJob} / ${r.n} コマ / 出てくる仕事 ${r.jobs.join(', ')}`);
}

/* ---------- ① 最後まで再生したあと ▶ で頭から ---------- */
{
  await page.evaluate(() => {
    const c = AQ.app.clock;
    c.pause(); c.index = c.beats.length - 1; c.elapsed = c.durationOf(c.index);
  });
  await page.click('#play');
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => ({
    playing: AQ.app.clock.playing, index: AQ.app.clock.index,
    btn: document.getElementById('play').textContent, aria: document.getElementById('play').getAttribute('aria-label')
  }));
  if (!r.playing) fail('終わったあとに ▶ を押しても再生が始まらない');
  if (r.index !== 0) fail(`終わったあとに ▶ を押しても頭に戻らない（コマ ${r.index}）`);
  if (r.btn !== '❚❚') fail(`再生中なのにボタンが「❚❚」になっていない（"${r.btn}"）`);
  await page.click('#play');
  await page.waitForTimeout(150);
  const r2 = await page.evaluate(() => ({ playing: AQ.app.clock.playing, btn: document.getElementById('play').textContent }));
  if (r2.playing || r2.btn !== '▶') fail(`止めたのにボタンが ▶ に戻らない（playing=${r2.playing} "${r2.btn}"）`);
  ok(`再生ボタン: 終了後に押す → 再生=${r.playing} コマ=${r.index} ボタン="${r.btn}" / もう一度押す → "${r2.btn}"`);
}

/* ---------- ID（呼び名）は画面に出ない・詳細には出る ---------- */
{
  await page.evaluate(() => { AQ.app.clock.speed = 2; AQ.app.clock.seek(0); AQ.app.clock.play(); });
  const nicks = await page.evaluate(() => AQ.app.jobIndex.list.map(r => AQ.nick.forJob(String(r.id))).filter(Boolean));
  let onCanvas = [], badges = 0;
  for (let f = 0; f < 30; f++) {
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => ({ l: AQ.room.lastLabels(), b: AQ.room.lastBadges() }));
    r.l.forEach(w => { if (nicks.indexOf(w.trim()) !== -1) onCanvas.push(w.trim()); });
    r.b.forEach(x => { if (x.nick) badges++; });
  }
  const dom = await page.evaluate((ns) => {
    const rows = Array.from(document.querySelectorAll('.roster-chips .jrow')).map(r => r.innerText).join(' ');
    const stat = (document.getElementById('focus-stat') || {}).innerText || '';
    return { inRows: ns.filter(n => rows.indexOf(n) !== -1), inStat: ns.filter(n => stat.indexOf(n) !== -1) };
  }, nicks);
  if (onCanvas.length) fail(`絵の中に ID が描かれている: ${Array.from(new Set(onCanvas)).join(', ')}`);
  if (badges) fail(`頭上に ID が出ている（${badges} 回）`);
  /* 2026-09-30: 右の一覧には呼び名（α, β, … 出てきた順）を戻した（利用者の要望）。
     一覧の呼び名の検査は tools/shot-jobnames.mjs。ここでは「一覧に1つも出ていない」
     ことだけを失敗にする（戻したはずの呼び名が消えていないか）。 */
  if (!dom.inRows.length) fail('右の一覧に依頼の呼び名が1つも出ていない');
  if (dom.inStat.length) fail(`ステータス欄に ID が出ている: ${dom.inStat.join(', ')}`);
  await page.click('#detail');
  await page.waitForTimeout(250);
  const det = await page.evaluate(() => ({
    text: (document.getElementById('detailBody') || {}).textContent || '',
    job: AQ.app.focusJob, nick: AQ.nick.forJob(String(AQ.app.focusJob))
  }));
  if (det.text.indexOf(det.job) === -1) fail(`詳細に本物の依頼 ID（${det.job}）が無い`);
  if (det.text.indexOf(det.nick) === -1) fail(`詳細に呼び名（${det.nick}）が無い`);
  await page.click('#detail');
  ok(`ID: 絵 ${onCanvas.length} / 頭上 ${badges} / 一覧（出てよい）${dom.inRows.length} / 欄 ${dom.inStat.length} ・ 詳細には ${det.nick}・${det.job}`);
}

/* ---------- 「すべて表示」で絞り込みが残らない ---------- */
{
  await page.evaluate(() => AQ.app.focusClear());
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    filter: AQ.app.agentFilter,
    stat: (() => { const e = document.getElementById('focus-stat'); return (e && !e.hidden) ? e.innerText : ''; })()
  }));
  if (r.filter != null) fail(`「すべて表示」を押してもエージェントの絞り込みが残っている（${r.filter}）`);
  if (/✒?\s*0\b/.test(r.stat) && /\d/.test(r.stat)) fail(`「すべて表示」のあとに事実と違う数が出ている: "${r.stat}"`);
  ok(`すべて表示: 絞り込み=${r.filter} / ステータス欄="${r.stat}"`);
}

/* ---------- 不合格は壊れた品物・いまの行・工程のランプ ---------- */
{
  await page.evaluate(() => { AQ.app.clock.speed = 4; AQ.app.clock.seek(Math.floor(AQ.app.clock.beats.length * 0.3)); AQ.app.clock.play(); });
  let cracked = 0, nowOk = 0, nowBad = 0;
  for (let f = 0; f < 80; f++) {
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => {
      const b = AQ.app.clock.beats[AQ.app.clock.index] || {};
      const job = b.lead && b.lead.meta && b.lead.meta.job;
      const nowRow = document.querySelector('.roster-chips .jrow.now');
      return { c: AQ.room.lastCracked(), job: job || null, now: nowRow ? nowRow.dataset.job : null };
    });
    cracked = Math.max(cracked, r.c);
    if (r.job && r.now) { if (r.now === r.job) nowOk++; else nowBad++; }
  }
  if (!cracked) fail('不合格の札が「壊れた」見た目で1度も描かれていない');
  if (!nowOk) fail('いま扱っている依頼の行が光っていない');
  if (nowBad) fail(`光っている行が、いま扱っている依頼と違う（${nowBad} 回）`);
  const lamps = await page.evaluate(() => ({
    stepper: document.querySelectorAll('.roster-chips .jdots.stepper').length,
    links: document.querySelectorAll('.roster-chips .jdots.stepper .jlink').length,
    hollow: document.querySelectorAll('.roster-chips .jdots.stepper .jd.lamp:not(.has)').length
  }));
  if (!lamps.stepper) fail('ランプが工程（.stepper）になっていない');
  if (!lamps.links) fail('ランプが線でつながっていない');
  if (!lamps.hollow) fail('記録の無い段階の中空の輪が1つも無い（題名の無い依頼などで出るはず）');
  ok(`壊れた札 ${cracked} 枚 / いまの行 一致 ${nowOk}・不一致 ${nowBad} / 工程 ${lamps.stepper} 行・線 ${lamps.links}・中空 ${lamps.hollow}`);
}

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
