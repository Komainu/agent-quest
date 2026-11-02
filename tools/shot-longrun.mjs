/* tools/shot-longrun.mjs — 最初から最後まで通しで動かす検査（2026-09-12(4)）
   使い方: node tools/shot-longrun.mjs   （dist/agent-quest.html を先に build）

   要望:「最初から最後までテストで動かして、おかしなところがないか
        チェックしてください。」

   ここでやること（人の目ではなく、数で見る）:
     A) それらしい規模のログ（30体・60依頼・約400行）を読み込む
     B) 依頼モード：先頭 12 件を1件ずつ、最初のコマから最後のコマまで
        全部描いて、次を確かめる
          ・コマ番号が必ず進む（戻らない・飛ばない）
          ・①→②→③→④の段階が後戻りしない
          ・実況の主語が、そのコマの本人と一致している
          ・同じ子が続けて動くとき、前のコマの終わりと次のコマの
            始まりの位置が一致している（＝ワープしていない）
          ・見ている依頼が途中で変わらない
     C) エージェントモード：先頭 12 体を1体ずつ選び、次を確かめる
          ・再生するコマの actor が全部その子
          ・画面に出るロボットがその子だけ
          ・実況の主語がその子
          ・ワープしていない
     D) LIVE のふり：エージェントを選んだまま新しい行を3回足して、
        選んだ相手・依頼・主語が勝手に変わらないことを確かめる
     E) 実時計での再生：既定速度のまま数秒回して、例外が出ないこと
     F) JS エラーが1件も出ていないこと・画面からはみ出していないこと */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

let bad = 0;
const fail = (m) => { console.log('  ✗ ' + m); bad++; };

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => fail('JS error: ' + e.message));
/* 外部フォント（Google Fonts）はこの検査環境から取りに行けないので、
   その読み込み失敗だけは無視する（アプリの不具合ではない）。 */
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource/.test(t)) return;
  fail('console error: ' + t);
});
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);

/* ---- A) それらしい規模のログ ---------------------------------------- */
const built = await page.evaluate(() => {
  const who = i => 'did:key:z6Mk' + String(i).padStart(3, '0') + 'AgentAgentAgentAgent';
  const msgs = []; let seq = 1, n = 0;
  const t0 = Date.now() - 3600e3;
  const push = (from, text) => msgs.push({ seq: seq++, from, text,
                                           ts: new Date(t0 + (n++) * 1500).toISOString() });
  for (let j = 0; j < 60; j++) {
    const id = 'k' + (200000 + j);
    const poster = who(j % 30), w1 = who((j * 7 + 3) % 30), w2 = who((j * 11 + 5) % 30);
    const judge = who((j * 13 + 9) % 30);
    if (j % 6 !== 0) push(poster, 'JOB v1 | ' + id + ' | build | Job ' + j + ' about something long enough to wrap | detail');
    push(w1, 'CLAIM v1 | ' + id + ' | builder');
    if (j % 3 === 0) push(w2, 'CLAIM v1 | ' + id + ' | builder');      // 同じ段階を複数
    if (j % 4 !== 0) push(w1, 'DELIVER v1 | ' + id + ' | delivered ' + j);
    if (j % 5 === 0) push(judge, 'ATTEST v1 | ' + id + ' | useful | fine');
    if (j % 7 === 0) push(judge, 'ATTEST v1 | ' + id + ' | not | missing tests');
  }
  AQ.adapters.kibbleForget('long');
  AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'long', observedAt: Date.now() }));
  return { msgs: msgs.length, beats: AQ.app.beats.length, jobs: AQ.app.jobIndex.list.length,
           agents: AQ.app.agentIndex.list.length, speed: AQ.app.clock.speed };
});
console.log(`A) ログ ${built.msgs} 行 → ${built.beats} コマ / 依頼 ${built.jobs} 件 / エージェント ${built.agents} 体`);
console.log(`   既定の速度: ${built.speed}×`);
if (built.speed !== 1) fail('既定の速度が 1× ではない（' + built.speed + '）');   // 2026-10-24 既定を 1× に

/* 1件ぶんを最初から最後まで描いて、異常があれば理由を返す共通ルーチン。 */
const playThrough = async (mode) => page.evaluate((mode) => {
  const problems = [];
  const beats = AQ.app.clock.beats;
  if (!beats.length) return ['再生するコマが0件'];
  const star = AQ.app.agentFilter;
  const F = { job: AQ.app.focusJob, actors: (function () {
    const m = {};
    if (star) m[String(star)] = true;
    else beats.forEach(b => { m[String(b.actor)] = true; });
    return m; })() };

  /* ★ 2026-09-13: エージェントから入ったときは「まとめ」（①〜④の例を
     段階の順に並べる）なので、コマ番号は時刻順とは限らず、依頼も場面
     ごとに違う。その2つだけ判定を変える。 */
  const summary = !!(star && AQ.app.agentStory);
  let prevIndex = -1, prevStep = 0, prevEnd = null, prevActor = null, firstJobNick = null;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (!summary && b.index <= prevIndex) problems.push('コマ番号が戻った: ' + b.index + ' ≦ ' + prevIndex);
    prevIndex = b.index;

    AQ.app.clock.pause(); AQ.app.clock.seek(i);
    const st = AQ.state.at(AQ.app.beats, b.index);

    /* 位置を p=0 と p=1 で測る（同じ子が続くときの継ぎ目を見る） */
    const Fb = summary
      ? { job: (AQ.app.agentStory.sceneJob || {})[b.index] || null, actors: F.actors }
      : F;
    const posAt = (pp) => {
      AQ.stage.render(b, pp, st, performance.now(), AQ.app.beats, b.index, Fb);
      const rs = AQ.stage.computeRobotScreenPositions(b, pp, AQ.app.beats, b.index, Fb);
      const me = rs.filter(r => String(r.actor) === String(b.actor))[0];
      /* ★ 2026-09-12(5): 札が「手の中」なのに、その手の持ち主が画面に
         居ないと、運搬中の札はどこにも描かれない（＝着いた瞬間に
         現れる）。枚数だけでなく、実際に描いたかを見る。 */
      const trays = AQ.room.computeBoardLayout(b.index, Fb).count +
                    AQ.room.computeDropoffLayout(b.index, Fb).count +
                    AQ.room.computeInspectLayout(b.index, Fb).count;
      const held = AQ.room.lastHeldCards().map(h => h.holder);
      return { pos: me ? [Math.round(me.hx), Math.round(me.hy)] : null,
               robots: rs.map(r => String(r.actor)),
               ghost: (trays === 0 && held.length === 0) };
    };
    const a0 = posAt(0), amid = posAt(0.4), a1 = posAt(1);
    [a0, amid].forEach(a => {
      if (a.ghost) problems.push('運搬中の札がどこにも描かれていない（コマ' + b.index + '）');
    });
    if (prevEnd && prevActor === String(b.actor) && a0.pos) {
      const d = Math.abs(prevEnd[0] - a0.pos[0]) + Math.abs(prevEnd[1] - a0.pos[1]);
      if (d > 4) problems.push('ワープ: コマ' + b.index + ' の開始が前のコマの終わりと ' + d + 'px ずれている');
    }
    prevEnd = a1.pos; prevActor = String(b.actor);

    if (mode === 'agent') {
      if (String(b.actor) !== String(star)) problems.push('選んだ子以外のコマ: ' + b.actor);
      if (a1.robots.length !== 1 || a1.robots[0] !== String(star)) {
        problems.push('選んだ子以外のロボットが出ている: ' + a1.robots.join(','));
      }
    }

    /* 実況を描かせて、主語と段階を読む */
    AQ.app.clock.seek(i);
    const winEl = document.querySelector('.win');
    const subj = (winEl.querySelector('.subject .who') || {}).textContent || '';
    const nick = (winEl.querySelector('.subject .nick') || {}).textContent || '';
    const cur  = (winEl.querySelector('.progress .step.current') || {}).textContent || '';
    /* 2026-09-13: 見出しから原文の題名を外したので、依頼の呼び名は
       .jobtitle そのもの（旧 .job-nick は無い＝ここが空のままだと
       「別の依頼に変わった」検査が死ぬ）。 */
    const jobNick = (winEl.querySelector('.headline .jobtitle') || {}).textContent || '';
    if (!jobNick && !summary) problems.push('見出しに依頼の呼び名が無い（コマ' + b.index + '）');
    /* 見出しに原文の題名（読めない英文）が戻っていないこと。呼び名は
       日本語なので、英字が6文字以上つながっていたら題名の混入。 */
    if (AQ.i18n.lang === 'ja' && /[A-Za-z]{6,}/.test(jobNick)) {
      problems.push('見出しに英文が出ている: ' + jobNick.slice(0, 40));
    }

    const expected = '#' + (AQ.roster.build(AQ.app.beats).numberOf[
      mode === 'agent' ? String(star) : String(b.actor)] || '?');
    if (subj && subj !== expected) {
      problems.push('主語が違う: 画面 ' + subj + ' / 期待 ' + expected + '（コマ' + b.index + '）');
    }
    if (mode === 'agent' && !nick) problems.push('主語に呼び名が無い');

    const stepNow = ['①', '②', '③', '④'].findIndex(g => cur.indexOf(g) === 0) + 1;
    if (summary && stepNow) {
      /* まとめは①→②→③→④の順に並ぶ。逆行したら並べ方が壊れている。 */
      if (stepNow <= prevStep) problems.push('まとめの並びが①②③④になっていない');
      prevStep = stepNow;
    } else if (stepNow && stepNow < prevStep) {
      problems.push('段階が後戻りした: ' + prevStep + ' → ' + stepNow);
    }
    if (stepNow) prevStep = stepNow;

    if (!summary) {
      if (firstJobNick === null) firstJobNick = jobNick;
      else if (jobNick && jobNick !== firstJobNick) {
        problems.push('途中で別の依頼に変わった: ' + firstJobNick + ' → ' + jobNick);
      }
    }
  }
  return problems;
}, mode);

/* ---- B) 依頼モードで通し ------------------------------------------- */
console.log('\nB) 依頼モード（先頭12件を1件ずつ最後まで）');
const jobIds = await page.evaluate(() => AQ.app.jobIndex.list.slice(0, 12).map(r => r.id));
for (const id of jobIds) {
  await page.evaluate((jid) => { AQ.app.setListMode('jobs'); AQ.app.focusOnJob(jid); }, id);
  const problems = await playThrough('job');
  if (problems.length) { console.log('  依頼 ' + id + ':'); problems.forEach(fail); }
}
console.log('  検査した依頼: ' + jobIds.length + ' 件');

/* ---- C) エージェントモードで通し ------------------------------------ */
console.log('\nC) エージェントモード（先頭12体を1体ずつ最後まで）');
const agents = await page.evaluate(() => AQ.app.agentIndex.list.slice(0, 12).map(a => a.actor));
for (const a of agents) {
  await page.evaluate((ac) => { AQ.app.setListMode('agents'); AQ.app.focusOnAgent(ac); }, a);
  const problems = await playThrough('agent');
  if (problems.length) { console.log('  ' + a.slice(-8) + ':'); problems.forEach(fail); }
}
console.log('  検査したエージェント: ' + agents.length + ' 体');

/* ---- D) LIVE のふり（選んだまま新しい行が届く） --------------------- */
console.log('\nD) LIVE のふり（選んだまま3回追加）');
const live = await page.evaluate(() => {
  const star = AQ.app.agentFilter, job = AQ.app.focusJob;
  const before = { star: String(star), job: String(job) };
  const who = i => 'did:key:z6Mk' + String(i).padStart(3, '0') + 'AgentAgentAgentAgent';
  let n = 0;
  for (let round = 0; round < 3; round++) {
    const msgs = [];
    for (let k = 0; k < 8; k++) {
      msgs.push({ seq: 90000 + (n++), from: who((k * 3 + round) % 30),
                  text: 'CLAIM v1 | k30000' + k + ' | builder',
                  ts: new Date(Date.now() + n * 100).toISOString() });
    }
    AQ.app.appendEvents(AQ.adapters.fromKibble(msgs, { room: 'long', observedAt: Date.now() }));
  }
  const b = AQ.app.clock.beats[AQ.app.clock.index];
  return {
    before: before,
    after: { star: String(AQ.app.agentFilter), job: String(AQ.app.focusJob) },
    actorsStillMine: AQ.app.clock.beats.every(x => String(x.actor) === String(AQ.app.agentFilter)),
    subject: (document.querySelector('.win .subject .who') || {}).textContent || '',
    expected: '#' + (AQ.roster.build(AQ.app.beats).numberOf[String(AQ.app.agentFilter)] || '?')
  };
});
console.log('  選んだ相手: ' + live.before.star.slice(-8) + ' → ' + live.after.star.slice(-8));
console.log('  再生中の依頼: ' + live.before.job + ' → ' + live.after.job);
if (live.before.star !== live.after.star) fail('LIVE 中に選んだ相手が変わった');
if (live.before.job !== live.after.job) fail('LIVE 中に再生中の依頼が変わった');
if (!live.actorsStillMine) fail('LIVE 中に他人のコマが混ざった');
if (live.subject && live.subject !== live.expected) fail('LIVE 中に主語が変わった: ' + live.subject);

/* 追加分が届いたあと、実際に再生しながら主語が変わらないことも見る
   （報告「エージェントがいきなり入れ替わる」は再生中に起きている）。 */
await page.evaluate(() => { AQ.app.clock.restart(); AQ.app.clock.play(); });
const watch = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  watch.push(await page.evaluate(() => ({
    subj: (document.querySelector('.win .subject .who') || {}).textContent || '',
    job: String(AQ.app.focusJob), star: String(AQ.app.agentFilter),
    robots: (function () {
      const b = AQ.app.clock.beats[AQ.app.clock.index];
      if (!b) return [];
      return AQ.stage.computeRobotScreenPositions(b, 0.5, AQ.app.beats, b.index,
        { job: AQ.app.focusJob, actors: (function () {
            const m = {}; m[String(AQ.app.agentFilter)] = true; return m; })() })
        .map(r => String(r.actor));
    })()
  })));
}
const uniqSubj = Array.from(new Set(watch.map(w => w.subj).filter(Boolean)));
const uniqJob  = Array.from(new Set(watch.map(w => w.job)));
const badRobot = watch.some(w => w.robots.some(r => r !== w.star));
console.log('  再生中3秒の主語: ' + uniqSubj.join(', ') + ' / 依頼: ' + uniqJob.join(', '));
if (uniqSubj.length > 1) fail('再生中に主語が入れ替わった: ' + uniqSubj.join(' → '));
if (uniqJob.length > 1) fail('再生中に依頼が入れ替わった: ' + uniqJob.join(' → '));
if (badRobot) fail('再生中に他人のロボットが出た');

/* ---- E) 実時計で数秒回す -------------------------------------------- */
console.log('\nE) 実時計で 4 秒再生（既定の速度のまま）');
await page.evaluate(() => { AQ.app.clock.restart(); AQ.app.clock.play(); });
await page.waitForTimeout(4000);
const ran = await page.evaluate(() => ({
  index: AQ.app.clock.index, len: AQ.app.clock.beats.length, playing: AQ.app.clock.playing
}));
console.log('  コマ ' + (ran.index + 1) + '/' + ran.len + '（再生中=' + ran.playing + '）');

/* ---- F) 画面からはみ出していないか ---------------------------------- */
const over = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
console.log('\nF) はみ出し: ' + over + 'px');
if (over > 0) fail('画面からはみ出している');

/* 英文の混入ぐあいも数で見ておく。
   ★ 2026-09-13: 見出しから原文の題名を外した（「読めない英文は消して
   ほしい」への対応）ので、見出しも検査の対象に入れる。本人が書いた文
   （.say）だけはログそのものなので除く。 */
const eng = await page.evaluate(() => {
  const win = document.querySelector('.win');
  const parts = [];
  win.querySelectorAll(':scope > *').forEach(el => {
    if (el.querySelector && el.querySelector('.say')) return;
    const txt = el.innerText || '';
    /* ★ 2026-10-07: エージェントの呼び名は動物の名前をやめ、IDを短くしたもの
       （…tAgent／0x1234…abcd）になった。これは英文ではなくIDそのものなので除く。 */
    const t2 = txt.replace(/#\d+/g, '').replace(/…[0-9A-Za-z]+/g, '').replace(/[0-9A-Za-z]+…[0-9A-Za-z]*/g, '');
    if (/[A-Za-z]{6,}/.test(t2)) parts.push(el.className + ': ' + txt.slice(0, 60));
  });
  return parts;
});
if (eng.length) { console.log('\n英文が残っている場所:'); eng.forEach(fail); }
else console.log('英文は題名と④の講評だけ（ほかの行はすべて日本語）');

await page.screenshot({ path: '/tmp/longrun.png' });
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
