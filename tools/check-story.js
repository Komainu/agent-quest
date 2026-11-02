/* tools/check-story.js — task D の検証ハーネス
   使い方:  node tools/check-story.js

   AQ.story.forJob(events, jobId)（engine/story.js）が、
     1) JOB → CLAIM → DELIVER → ATTEST(not) の4件をこの順で・
        それぞれ正しい actor で返すこと
     2) JOB 行が取得範囲の外（＝そもそもログに無い）場合でも、
        実際にある最初の行（CLAIM）から始まり、無い題名を
        捏造しないこと（meta.title が付かない）
   を検査する。実際のパイプライン
     adapters/fromKibble.js → engine/questlog.js → (flatten)
   にそのまま通した本物のイベントで検証する（手作りの偽イベントではない）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const AQ = {};

function load(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  eval(src.replace('window.AQ = window.AQ || {}', 'AQ'));
}
load('src/engine/questlog.js');
load('src/engine/story.js');
load('src/adapters/fromKibble.js');

let bad = 0;
function ok(label, cond) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) bad++;
}

function iso(msOffset) { return new Date(1758300000000 + msOffset).toISOString(); }

/* ------------------------------------------------------------ *
 * 1) JOB → CLAIM → DELIVER → ATTEST(not) の一件分
 * ------------------------------------------------------------ */
console.log('\n--- 1) JOB→CLAIM→DELIVER→ATTEST(not) ---');

const jobId = 'k4147614196';
const messages1 = [
  { seq: 1, from: 'agent-5', text: 'JOB v1 | ' + jobId + ' | build | ストレスを減らす3つの手順を挙げる | detail', ts: iso(0) },
  { seq: 2, from: 'agent-2', text: 'CLAIM v1 | ' + jobId + ' | builder', ts: iso(3000) },
  { seq: 3, from: 'agent-2', text: 'DELIVER v1 | ' + jobId + ' | Build deliverable: use standard library tools for stress relief', ts: iso(6000) },
  { seq: 4, from: 'agent-7', text: 'ATTEST v1 | ' + jobId + ' | not | 三つの手順を実際には述べていない。', ts: iso(20000) }
];
const events1 = AQ.questlog.load(AQ.adapters.fromKibble(messages1, { room: 'kibble', observedAt: 1758300100000 }));
const steps1 = AQ.story.forJob(events1, jobId);

ok('4件ちょうど返る（' + steps1.length + '件）', steps1.length === 4);
if (steps1.length === 4) {
  ok('1件目: JOB＝agent.plan・actor=agent-5', steps1[0].type === 'agent.plan' && steps1[0].actor === 'agent-5');
  ok('2件目: CLAIM＝tool.call・actor=agent-2', steps1[1].type === 'tool.call' && steps1[1].actor === 'agent-2');
  ok('3件目: DELIVER＝result.ok（verdictなし）・actor=agent-2',
    steps1[2].type === 'result.ok' && !steps1[2].meta.verdict && steps1[2].actor === 'agent-2');
  ok('4件目: ATTEST not＝result.error・verdict=not・actor=agent-7',
    steps1[3].type === 'result.error' && steps1[3].meta.verdict === 'not' && steps1[3].actor === 'agent-7');
  ok('時系列順（t が単調増加）', steps1[0].t < steps1[1].t && steps1[1].t < steps1[2].t && steps1[2].t < steps1[3].t);
  ok('題名（say）は JOB 行を実際に見ているので分かる', steps1[0].say === 'ストレスを減らす3つの手順を挙げる');
  ok('却下理由（reason）が4件目に付いている', steps1[3].meta.reason === '三つの手順を実際には述べていない。');
}

/* ------------------------------------------------------------ *
 * 2) JOB が取得範囲の外（そもそもログに無い）
 * ------------------------------------------------------------ */
console.log('\n--- 2) JOB 行が取得範囲の外（CLAIM から始まる） ---');

const jobId2 = 'kOutOfRange01';
// JOB v1 行を意図的に含めない＝このアダプタ呼び出しの中では
// kindByJob[jobId2] / titleByJob[jobId2] を一度も学習していない状態。
AQ.adapters.kibbleForget('kibble2');
const messages2 = [
  { seq: 1, from: 'agent-9', text: 'CLAIM v1 | ' + jobId2 + ' | builder', ts: iso(0) },
  { seq: 2, from: 'agent-9', text: 'DELIVER v1 | ' + jobId2 + ' | some deliverable text here', ts: iso(3000) }
];
const events2 = AQ.questlog.load(AQ.adapters.fromKibble(messages2, { room: 'kibble2', observedAt: 1758300100000 }));
const steps2 = AQ.story.forJob(events2, jobId2);

ok('取得できた分（2件）だけが返る', steps2.length === 2);
if (steps2.length === 2) {
  ok('先頭は JOB ではなく、実際にある最初の行（CLAIM）', steps2[0].type === 'tool.call');
  ok('CLAIM 行に kind が付かない（学習していないので分からない＝捏造しない）', !steps2[0].meta.kind);
  ok('CLAIM 行に title が付かない（学習していないので分からない＝捏造しない）', !steps2[0].meta.title);
  ok('DELIVER 行にも title が付かない', !steps2[1].meta.title);
}

/* forJob() 自体が何も捏造していないこと（見つからない jobId は空配列） */
console.log('\n--- 3) 存在しない jobId は空配列（何も捏造しない） ---');
ok('存在しない jobId → 空配列', AQ.story.forJob(events1, 'no-such-job').length === 0);
ok('events が空でも例外を投げない', AQ.story.forJob([], jobId).length === 0);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
