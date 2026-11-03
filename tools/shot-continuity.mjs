/* tools/shot-continuity.mjs — 札が「ワープ」していないかを自動で探す検査（2026-10-07）
   使い方: node tools/shot-continuity.mjs   （dist/agent-quest.html を先に build）

   報告「掲示板から札を取って引き受けた、とあるのに、札は初めから納品口に
   置いてある。同様の修正箇所を自動で見つけて改善してほしい」。
   場面を1つずつ目で探すのではなく、ありがちな kibble のログ（同じ依頼を
   何体も引き受ける・引き受けていない子が納品する・不合格のあと出しなおす・
   判定が2回つく…）を乱数でたくさん作り、エージェントごとに全コマを細かく
   再生して、毎フレーム「どの札（key）がどこに描かれているか」を記録する。
     場所 = 板 / 納品口 / 検品台 / 手:だれ / 腕:だれ（手を伸ばして持っている）
   そのうえで、動き方の約束を破っているところを全部書き出す。
     ・家具→家具へ直接移る（板→納品口、納品口→板、納品口→検品台 など）
     ・手の中の札が、いつのまにか別の子の手に移る
     ・何も無いところから、手の中に札が現れる（依頼を出した本人を除く）
     ・家具の上の札が、手を伸ばさずに誰かの手に移る
     ・コマの途中で、家具の上に札が急に現れる／急に消える
   どれも「ある場所から、腕・手を通らずに別の場所へ移った」＝ワープ。 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const FRAMES = Number(process.env.FRAMES || 28);
const SCENARIOS = Number(process.env.SCENARIOS || 10);

/* 再現できる乱数 */
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* ありがちな流れを混ぜたログを作る */
function scenario(seed) {
  const r = rng(seed);
  const agents = ['A', 'B', 'C', 'D', 'E'].map(n => 'did:key:z6Mk' + n + 'xxxxxxxxxxxxxxxxxxxx' + n + seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const msgs = []; let seq = 1, t = 0;
  /* 半分のシナリオは間隔を詰める（数秒おき）＝束（まとめて記録）になる流れも見る */
  const tight = seed % 2 === 0;
  const say = (from, text) => msgs.push({ seq: seq++, from, text, ts: iso(t += tight ? 600 + Math.floor(r() * 2500) : 15000 + Math.floor(r() * 20000)) });
  const jobs = [];
  for (let j = 0; j < 4; j++) {
    const id = 'k' + seed + 'j' + j; jobs.push(id);
    if (r() < 0.85) say(pick(agents), `JOB v1 | ${id} | build | Thing ${j} | d`);   // ときどき JOB がログの外
  }
  for (let n = 0; n < 22; n++) {
    const job = pick(jobs), who = pick(agents), x = r();
    if (x < 0.34) say(who, `CLAIM v1 | ${job} | builder`);
    else if (x < 0.62) say(who, `DELIVER v1 | ${job} | done`);
    else if (x < 0.80) say(who, `ATTEST v1 | ${job} | useful | ok`);
    else if (x < 0.92) say(who, `ATTEST v1 | ${job} | not | redo`);
    else say(who, 'just chatting ' + n);
  }
  /* 同じ子が同じ依頼を立て続けに（引き受け→納品→引き受け→納品）＝1つの束になる流れ */
  if (seed % 3 === 0) {
    const w = agents[1], j = jobs[0];
    t += 30000;
    for (const txt of [`CLAIM v1 | ${j} | builder`, `DELIVER v1 | ${j} | a`, `CLAIM v1 | ${j} | builder`, `DELIVER v1 | ${j} | b`]) {
      msgs.push({ seq: seq++, from: w, text: txt, ts: iso(t += 500) });
    }
  }
  return { msgs, agents };
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let jsErr = 0;
page.on('pageerror', e => { console.log('  ✗ JS error: ' + e.message); jsErr++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);

const found = [];
let framesSeen = 0, beatsSeen = 0;
for (let sc = 1; sc <= SCENARIOS; sc++) {
  const { msgs, agents } = scenario(1000 + sc);
  const res = await page.evaluate(({ msgs, agents, FRAMES, sc }) => {
    AQ.adapters.kibbleForget('cont' + sc);
    AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'cont' + sc, observedAt: Date.now() }));
    const out = [], R = AQ.room;
    let snap = null;
    const real = AQ.stage.render;
    AQ.stage.render = function (beat, pp, st, now, beats, index2, focus) {
      const ret = real.apply(this, arguments);
      try {
        const where = {};
        const put = (k, v) => { if (k != null && !(k in where)) where[k] = v; };
        const rch = R.lastReach(); if (rch && rch.key && rch.card) put(rch.key, 'arm:' + beat.actor);
        const dr = R.lastDrop(); if (dr && dr.key && dr.card) put(dr.key, 'arm:' + beat.actor);
        R.lastHeldCards().forEach(h => put(h.key, (h.reach ? 'arm:' : 'hand:') + h.holder));
        [['board', R.computeBoardLayout], ['dropoff', R.computeDropoffLayout], ['inspect', R.computeInspectLayout]].forEach(([n, f]) => {
          f(index2, focus).shown.forEach(it => { if (it.card && it.card.key) put(it.card.key, n); });
        });
        snap = { i: index2, p: pp, actor: String(beat.actor), kind: beat.kind, where };
      } catch (e) { snap = { err: String(e) }; }
      return ret;
    };
    let frames = 0, beatsN = 0;
    /* エージェントから追う／依頼から追う、の両方で全部見る */
    const jobs = [...new Set(msgs.map(m => (m.text.match(/^\w+ v1 \| (\S+)/) || [])[1]).filter(Boolean))];
    const targets = agents.map(a => ({ a })).concat(jobs.map(j => ({ j })));
    for (const tg of targets) {
      const a = tg.a || tg.j;
      if (tg.a) { AQ.app.setListMode('agents'); AQ.app.focusOnAgent(tg.a); }
      else { AQ.app.setListMode('jobs'); AQ.app.focusOnJob(tg.j); }
      const c = AQ.app.clock; c.pause();
      for (let bi = 0; bi < c.beats.length; bi++) {
        beatsN++;
        let prev = null;
        for (let k = 0; k <= FRAMES; k++) {
          c.seek(bi); c.elapsed = c.durationOf(bi) * (k / FRAMES); c.onFrame();
          frames++;
          if (!snap || snap.err) { out.push({ sc, agent: a, beat: bi, err: snap && snap.err }); continue; }
          if (prev && prev.i === snap.i) {
            const keys = new Set([...Object.keys(prev.where), ...Object.keys(snap.where)]);
            keys.forEach(key => {
              const A = prev.where[key] || 'none', B = snap.where[key] || 'none';
              if (A !== B) out.push({ sc, agent: a, i: snap.i, kind: snap.kind, actor: snap.actor, key, from: A, to: B, p: snap.p });
            });
          }
          prev = snap;
        }
      }
    }
    AQ.stage.render = real;
    return { moves: out, frames, beatsN };
  }, { msgs, agents, FRAMES, sc });
  framesSeen += res.frames; beatsSeen += res.beatsN;

  /* 動き方の約束 */
  const FURN = new Set(['board', 'dropoff', 'inspect']);
  const who = (s) => s.split(':').slice(1).join(':');
  res.moves.forEach(m => {
    if (m.err) { found.push({ ...m, why: '描画の記録が取れない: ' + m.err }); return; }
    const a = m.from, b = m.to;
    const aT = a.split(':')[0], bT = b.split(':')[0];
    let why = null;
    if (m.kind === 'travel' && FURN.has(a) && a !== 'board' && bT === 'arm') why = `引き受けなのに板以外から取っている（${a}→${b}）`;
    else if (FURN.has(a) && FURN.has(b)) why = `家具から家具へ直接（${a}→${b}）`;
    else if ((aT === 'hand' || aT === 'arm') && (bT === 'hand' || bT === 'arm') && who(a) !== who(b)) why = `手の中の札が別の子へ（${a}→${b}）`;
    else if (a === 'none' && (bT === 'hand') && !(m.kind === 'plan' || m.kind === 'planbatch')) why = `何も無いところから手の中へ（→${b}）`;
    else if (FURN.has(a) && bT === 'hand') why = `手を伸ばさずに家具から手へ（${a}→${b}）`;
    else if (aT === 'hand' && FURN.has(b) && b !== 'dropoff') why = `腕を使わずに手から家具へ（${a}→${b}）`;
    else if (a === 'none' && FURN.has(b) && m.p > 0.04) why = `コマの途中で家具の上に急に現れる（→${b}）`;
    else if (FURN.has(a) && b === 'none' && m.p > 0.04) {
      /* ★ 2026-10-21 仕事札は依頼ごとに1枚（利用者の要望）：同じコマで、同じ依頼の新しい札を納品口へ置くなら
         「古い札を片づけて、新しい札を置いた」のであって、急に消えたのではない */
      const job = m.key.split('#')[0];
      const swapped = res.moves.some(o => o !== m && o.agent === m.agent && o.i === m.i && o.p >= m.p && o.key.split('#')[0] === job && o.to === 'dropoff');
      if (!swapped) { why = `コマの途中で家具の上から急に消える（${a}→）`; }
    }
    if (why) found.push({ ...m, why });
  });
}

await browser.close();
console.log(`\n${SCENARIOS} 通りのログ × 全エージェント × 全コマ（${beatsSeen} コマ・${framesSeen} フレーム）を見た`);
const byWhy = {};
found.forEach(f => { (byWhy[f.why.replace(/（.*$/, '')] ||= []).push(f); });
Object.keys(byWhy).forEach(k => {
  console.log(`  ✗ ${k}: ${byWhy[k].length} 件`);
  byWhy[k].slice(0, 4).forEach(f => console.log(`      シナリオ${f.sc} コマ${f.i}(${f.kind}) ${f.key}: ${f.from} → ${f.to}  p=${(f.p || 0).toFixed(2)}`));
});
const bad = found.length + jsErr;
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ ワープは見つからなかった'));
process.exit(bad ? 1 : 0);
