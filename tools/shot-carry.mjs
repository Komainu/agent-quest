/* tools/shot-carry.mjs — 「札を手に持って運ぶ」動きの検査（2026-09-12(5) 全面改訂）
   使い方: node tools/shot-carry.mjs   （dist/agent-quest.html を先に build）

   ★ 前の版の反省
     以前ここでは AQ.stage.render() を検査側から直接呼び、板・納品口・
     検品台の「枚数」だけを見ていた。ところが枚数は「札が手の中にある」
     ことしか言わず、その手の持ち主が画面に描かれているかは見ていない。
     実データでは同じ依頼を何体も引き受けるため、札の持ち主（ログ上は
     最後に引き受けた子）と、実際に納品した子が食い違うことがある。
     すると運搬中の札はどこにも描かれず、「歩いているのに手ぶら、着いた
     瞬間に札が納品口に現れる」という絵になっていた——それを検査は
     ✓ と報告していた。利用者の指摘どおり、検査が甘かった。

   ★ この版でやること
     ・アプリ自身の再生（clock）を実時間で回し、描かれたフレームだけを見る
     ・毎フレーム「札がどこにあるか」に加えて、
       AQ.room.lastHeldCards()（実際に手に持った札として描いたもの）を見る
     ・運搬中は「いま動いている本人の手に、実際に描かれている」ことを要求
     ・引き受けた子と納品した子が違う形（実データでよく起きる）も試す
     ・依頼モードとエージェントモードの両方で試す */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

const iso = (ms) => new Date(1758300000000 + ms).toISOString();
const A = 'did:key:zPoster', W1 = 'did:key:zClaimA', W2 = 'did:key:zClaimB', C = 'did:key:zJudge';

/* 形1: 素直な流れ（1体が引き受けて納品）
   形2: 2体が引き受け、納品したのは先に引き受けた子（＝札の持ち主と
        納品した子が食い違う。利用者の画面で起きていた形） */
const CASES = [
  { name: '素直な流れ', job: 'kC1', msgs: [
      { seq: 1, from: A,  text: 'JOB v1 | kC1 | build | Build the pier | d', ts: iso(0) },
      { seq: 2, from: W1, text: 'CLAIM v1 | kC1 | builder', ts: iso(40000) },
      { seq: 3, from: W1, text: 'DELIVER v1 | kC1 | done', ts: iso(90000) },
      { seq: 4, from: C,  text: 'ATTEST v1 | kC1 | useful | ok', ts: iso(120000) } ] },
  { name: '引き受けた子と納品した子が違う', job: 'kC2', msgs: [
      { seq: 1, from: A,  text: 'JOB v1 | kC2 | build | Build the pier | d', ts: iso(0) },
      { seq: 2, from: W1, text: 'CLAIM v1 | kC2 | builder', ts: iso(40000) },
      { seq: 3, from: W2, text: 'CLAIM v1 | kC2 | builder', ts: iso(60000) },
      { seq: 4, from: W1, text: 'DELIVER v1 | kC2 | done', ts: iso(90000) },
      { seq: 5, from: C,  text: 'ATTEST v1 | kC2 | useful | ok', ts: iso(120000) } ] }
];

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const cs of CASES) {
  for (const mode of ['job', 'agent']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
    await page.goto(FILE);
    await page.waitForFunction(() => window.AQ && window.AQ.app);

    /* アプリが1フレーム描くたびに、そのとき画面に何があったかを控える。
       検査側から render() を呼ぶのではなく、アプリが描いた結果だけを見る。 */
    await page.evaluate(({ msgs, job, mode, W1 }) => {
      AQ.adapters.kibbleForget('carry');
      AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'carry', observedAt: Date.now() }));
      window.__obs = [];
      const real = AQ.stage.render;
      AQ.stage.render = function (beat, pp, st, now, beats, index2, focus) {
        const r = real.apply(this, arguments);
        try {
          const board = AQ.room.computeBoardLayout(index2, focus).count;
          const drop  = AQ.room.computeDropoffLayout(index2, focus).count;
          const insp  = AQ.room.computeInspectLayout(index2, focus).count;
          const held  = AQ.room.lastHeldCards();
          window.__obs.push({
            i: index2, p: pp, kind: beat.kind, actor: String(beat.actor),
            at: board ? 'board' : drop ? 'dropoff' : insp ? 'inspect' : 'hand',
            heldBy: held.map(h => h.holder)
          });
        } catch (e) {}
        return r;
      };
      if (mode === 'agent') { AQ.app.setListMode('agents'); AQ.app.focusOnAgent(W1); }
      else { AQ.app.focusOnJob(job); }
    }, { msgs: cs.msgs, job: cs.job, mode, W1 });

    await page.waitForTimeout(22000);        // 既定 0.5× で4コマぶん（最後まで見る）
    const obs = await page.evaluate(() => window.__obs);
    await page.close();

    console.log(`\n[${cs.name} / ${mode === 'agent' ? 'エージェントから' : '依頼から'}]  描画 ${obs.length} フレーム`);

    /* コマごとにまとめる */
    const beats = [];
    obs.forEach(o => {
      /* index2 < 0 は「まだ誰も選んでいない」ときの1枚（家具だけの画面）。
         札もロボットも無いので運搬の検査対象ではない。 */
      if (o.i < 0) return;
      let b = beats[beats.length - 1];
      if (!b || b.i !== o.i) { b = { i: o.i, kind: o.kind, actor: o.actor, frames: [] }; beats.push(b); }
      b.frames.push(o);
    });

    beats.forEach(b => {
      const moving = b.frames.filter(f => f.p < 0.7);     // 歩いている間
      const ended  = b.frames.filter(f => f.p >= 0.99);   // 歩き終わり
      const seq = [];
      b.frames.forEach(f => { if (seq[seq.length - 1] !== f.at) seq.push(f.at); });
      /* 運搬中に「本人の手」に描かれていたフレーム数 */
      const carried = moving.filter(f => f.at === 'hand' && f.heldBy.indexOf(f.actor) !== -1).length;
      const ghost   = moving.filter(f => f.at === 'hand' && f.heldBy.length === 0).length;
      console.log(`  コマ${b.i} ${b.kind}: ${seq.join(' → ')}` +
                  `（${b.frames.length}フレーム / 本人の手に描かれた ${carried} / どこにも描かれなかった ${ghost}）`);

      if (ghost > 0) {
        fail('運搬中に札がどこにも描かれていないフレームが ' + ghost + ' ある（＝札が消えて、着いた瞬間に現れる）');
      }
      /* ①出された・③納品は「持って歩く」場面が必ずあること。
         観測が途中で終わったコマ（歩き終わりのフレームが無い）は、
         次の実行で見ればよいので判定しない。 */
      const carryStep = ended.length &&
        ((b.kind === 'plan') || (b.kind === 'receive' && seq[seq.length - 1] === 'dropoff'));
      if (carryStep) {
        if (carried < 5) fail('運んでいる絵が短すぎる（本人の手に描かれたフレーム ' + carried + '）');
        if (!ended.length) fail('歩き終わりのフレームが無い');
        else if (ended[ended.length - 1].at === 'hand') fail('歩き終わっても札が置かれない');
      }
    });
    if (!beats.length) fail('1コマも描かれなかった');
  }
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
