/* tools/check-jobs-index.js — engine/jobs.js（依頼ごとの索引）の検証
   使い方:  node tools/check-jobs-index.js

   何を守りたいか（jobs.js の「分からないことは描かない」「数は必ず
   正確」「イベントを落とさない」という約束）を、fromKibble.js が
   実際に出す形そのままのフィクスチャで検査する。bootstrap は
   check-job-grouping.js と同じく fs.readFileSync + eval。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const AQ = {};

function load(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  eval(src.replace('window.AQ = window.AQ || {}', 'AQ'));
}
load('src/config.js');
load('src/i18n.js');
load('src/engine/questlog.js');
load('src/engine/jobs.js');
load('src/adapters/fromKibble.js');

let bad = 0;
function ok(label, cond) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) bad++;
}

const BASE_T = 1758300000000;
function iso(msOffset) { return new Date(BASE_T + msOffset).toISOString(); }

/** [from, text, tOffsetMs] の配列 → kibbleFetch が返す形の messages 配列 */
function buildMessages(lines) {
  return lines.map(function (l, i) {
    return { seq: i + 1, from: l[0], text: l[1], ts: iso(l[2]) };
  });
}

/** room を忘れさせてから fromKibble→questlog.load→jobs.index まで通す */
function runFixture(room, lines) {
  AQ.adapters.kibbleForget(room);
  const messages = buildMessages(lines);
  const events = AQ.questlog.load(
    AQ.adapters.fromKibble(messages, { room: room, observedAt: BASE_T + 100000 }));
  return { events: events, idx: AQ.jobs.index(events) };
}

/* ---- 1) 4段階そろった依頼 ------------------------------------- */
console.log('--- 1) 4段階そろった依頼 ---');
{
  const r = runFixture('t1', [
    ['poster1', 'JOB v1 | jFull | build | フル依頼 | 詳細', 0],
    ['claimer1', 'CLAIM v1 | jFull | builder', 200],
    ['claimer1', 'DELIVER v1 | jFull | 成果物です', 400],
    ['judge1', 'ATTEST v1 | jFull | useful | 良い出来', 600]
  ]);
  const rec = r.idx.byId.jFull;
  ok('依頼が索引に載っている', !!rec);
  if (rec) {
    ok('known===4', rec.known === 4);
    ok('steps[1] は JOB(agent.plan)', rec.steps[1] && rec.steps[1].type === 'agent.plan');
    ok('steps[2] は CLAIM(tool.call)', rec.steps[2] && rec.steps[2].type === 'tool.call');
    ok('steps[3] は DELIVER(result.ok・verdict無し)',
      rec.steps[3] && rec.steps[3].type === 'result.ok' && !rec.steps[3].meta.verdict);
    ok('steps[4] は ATTEST useful(result.ok・verdict=useful)',
      rec.steps[4] && rec.steps[4].type === 'result.ok' && rec.steps[4].meta.verdict === 'useful');
    ok('verdict===useful', rec.verdict === 'useful');
    ok('title はJOB行のtitle', rec.title === 'フル依頼');
    ok('kind はJOB行のkind', rec.kind === 'build');
    ok('cast.poster===poster1', rec.cast.poster === 'poster1');
    ok('cast.claimers===[claimer1]', rec.cast.claimers.length === 1 && rec.cast.claimers[0] === 'claimer1');
    ok('cast.deliverers===[claimer1]', rec.cast.deliverers.length === 1 && rec.cast.deliverers[0] === 'claimer1');
    ok('cast.judges===[judge1]', rec.cast.judges.length === 1 && rec.cast.judges[0] === 'judge1');
    ok("stateOf==='judged'", AQ.jobs.stateOf(rec) === 'judged');
    const cast = AQ.jobs.castOf(rec);
    ok('castOf は poster→claimer→judge の順',
      cast.join(',') === 'poster1,claimer1,judge1');
  }
}

/* ---- 2) JOB行が無い依頼（CLAIMから始まる） --------------------- */
console.log('\n--- 2) JOB行が無い依頼 ---');
{
  const r = runFixture('t2', [
    ['claimer2', 'CLAIM v1 | jNoJob | builder', 0],
    ['claimer2', 'DELIVER v1 | jNoJob | 成果', 200],
    ['judge2', 'ATTEST v1 | jNoJob | useful | ok', 400]
  ]);
  const rec = r.idx.byId.jNoJob;
  ok('依頼が索引に載っている', !!rec);
  if (rec) {
    ok('steps[1]===null（JOB行が無い）', rec.steps[1] === null);
    ok('cast.poster===null', rec.cast.poster === null);
    ok('known===3', rec.known === 3);
    ok('title は捏造されずnull（fromKibbleがJOBを見ていない）', rec.title === null);
    ok('kind も捏造されずnull', rec.kind === null);
  }
}

/* ---- 3) 2つの依頼が混ざらない ---------------------------------- */
console.log('\n--- 3) 2つの依頼が混ざらない ---');
let fixture3 = null;
{
  fixture3 = runFixture('t3', [
    ['a1', 'JOB v1 | jA | build | Aの依頼 | d', 0],
    ['b1', 'JOB v1 | jB | research | Bの依頼 | d', 100],
    ['a2', 'CLAIM v1 | jA | builder', 200],
    ['b2', 'CLAIM v1 | jB | researcher', 300],
    ['a2', 'DELIVER v1 | jA | Aの成果', 400],
    ['b2', 'DELIVER v1 | jB | Bの成果', 500],
    ['j1', 'ATTEST v1 | jA | useful | 良い', 600],
    ['j2', 'ATTEST v1 | jB | not | 悪い', 700]
  ]);
  const recA = fixture3.idx.byId.jA;
  const recB = fixture3.idx.byId.jB;
  ok('jA・jB とも索引に載っている', !!recA && !!recB);
  if (recA && recB) {
    const aAllA = recA.events.every(function (e) { return e.meta.job === 'jA'; });
    const bAllB = recB.events.every(function (e) { return e.meta.job === 'jB'; });
    ok('jA の events は jA のイベントだけ', aAllA);
    ok('jB の events は jB のイベントだけ', bAllB);
    ok('jA の events は4件（JOB/CLAIM/DELIVER/ATTEST）', recA.events.length === 4);
    ok('jB の events は4件（JOB/CLAIM/DELIVER/ATTEST）', recB.events.length === 4);
  }
}

/* ---- 4) イベントを1件も落としていない --------------------------- */
console.log('\n--- 4) イベントを1件も落としていない ---');
{
  const events = fixture3.events;
  const idx = fixture3.idx;
  const totalWithJob = events.filter(function (e) { return e.meta && e.meta.job; }).length;
  const totalInIndex = idx.list.reduce(function (s, r) { return s + r.events.length; }, 0);
  ok('meta.jobを持つ全イベント数(' + totalWithJob + ')と索引側の合計(' + totalInIndex + ')が一致',
    totalWithJob === totalInIndex && totalWithJob > 0);
}

/* ---- 5) counts: 同じ依頼にDELIVERが2回 --------------------------- */
console.log('\n--- 5) counts: DELIVER2回 ---');
{
  const r = runFixture('t5', [
    ['p5', 'JOB v1 | jDup | build | 二重納品 | d', 0],
    ['c5', 'CLAIM v1 | jDup | builder', 100],
    ['c5', 'DELIVER v1 | jDup | 一回目', 200],
    ['c5', 'DELIVER v1 | jDup | 二回目（やり直し）', 300],
    ['j5', 'ATTEST v1 | jDup | useful | ok', 400]
  ]);
  const rec = r.idx.byId.jDup;
  ok('依頼が索引に載っている', !!rec);
  if (rec) {
    ok('counts[3]===2', rec.counts[3] === 2);
    ok('steps[3] は最初のDELIVER（一回目）', rec.steps[3] && rec.steps[3].item === '一回目');
  }
}

/* ---- 6) ATTEST not ------------------------------------------------ */
console.log('\n--- 6) ATTEST not ---');
{
  const r = runFixture('t6', [
    ['p6', 'JOB v1 | jNot | build | 不合格になる依頼 | d', 0],
    ['c6', 'CLAIM v1 | jNot | builder', 100],
    ['c6', 'DELIVER v1 | jNot | 成果', 200],
    ['j6', 'ATTEST v1 | jNot | not | 理由', 300]
  ]);
  const rec = r.idx.byId.jNot;
  ok('依頼が索引に載っている', !!rec);
  if (rec) {
    ok("verdict==='not'", rec.verdict === 'not');
    ok("steps[4]はresult.error", rec.steps[4] && rec.steps[4].type === 'result.error');
    ok("stateOf==='judged'（不合格でも判定済み）", AQ.jobs.stateOf(rec) === 'judged');
  }
}

/* ---- 7) 並び順: knownが多い順→同数ならlastT新しい順 ---------------- */
console.log('\n--- 7) 並び順 ---');
{
  const r = runFixture('t7', [
    ['hp', 'JOB v1 | jHigh | build | High | d', 0],
    ['hc', 'CLAIM v1 | jHigh | builder', 100],
    ['hc', 'DELIVER v1 | jHigh | out', 200],
    ['hj', 'ATTEST v1 | jHigh | useful | ok', 300],
    ['lop', 'JOB v1 | jLowOld | research | LowOld | d', 400],
    ['loc', 'CLAIM v1 | jLowOld | researcher', 500],
    ['lnp', 'JOB v1 | jLowNew | explain | LowNew | d', 600],
    ['lnc', 'CLAIM v1 | jLowNew | explainer', 700]
  ]);
  const ids = r.idx.list.map(function (rec) { return rec.id; });
  ok('known最大(jHigh)が先頭', ids[0] === 'jHigh');
  ok('known同数(2)のうちlastTが新しいjLowNewが先',
    ids[1] === 'jLowNew' && ids[2] === 'jLowOld');
}

/* ---- 8) events が t 昇順（同 t は元の順序を保つ安定ソート） ---------- */
console.log('\n--- 8) events は t 昇順・安定ソート ---');
{
  // fromKibble を介さず、jobs.index 自体の並べ替えを直接検査する。
  const raw = [
    { v: 1, run: 'r', t: 100, actor: 'x1', type: 'tool.call', target: 'u', meta: { job: 'jTie' } },
    { v: 1, run: 'r', t: 100, actor: 'x2', type: 'tool.call', target: 'u', meta: { job: 'jTie' } },
    { v: 1, run: 'r', t: 50, actor: 'x0', type: 'agent.plan', target: 'u', meta: { job: 'jTie', title: 't', kind: 'k' } }
  ];
  const idx = AQ.jobs.index(raw);
  const rec = idx.byId.jTie;
  ok('依頼が索引に載っている', !!rec);
  if (rec) {
    const ts = rec.events.map(function (e) { return e.t; });
    let ascending = true;
    for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1]) ascending = false;
    ok('t が昇順（' + ts.join(',') + '）', ascending);
    ok('t=50 の行が先頭', rec.events[0].actor === 'x0');
    ok('同じ t=100 は元の順序（x1→x2）を保つ',
      rec.events[1].actor === 'x1' && rec.events[2].actor === 'x2');
  }
}

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
