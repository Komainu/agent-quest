/* tools/check-focus-exclusive.js — 検証ハーネス（2026-09-04 の引き算作業）
   使い方:  node tools/check-focus-exclusive.js

   仕様確認①「1体に絞ったら、その1体の世界しか見えない」を、
   件数の一致（tools/check-focus-cards.js が既にやっている）よりも
   踏み込んで、**IDの集合そのもの**で検査する。件数さえ合っていれば
   OKにしてしまうテストだと、「たまたま数は合っているが、実は
   関係ない人の札が紛れ込んでいる」というバグを見逃す。

   フィクスチャ（14体・20件）は、絞り込み対象 a0 の board/dropoff の
   件数を意図的に上限（maxBoardCards=6 / maxDropoffCards=5）未満に
   収めてある。表示に overflow が起きない設定にすることで、
   「表示されている札のID集合」＝「a0が本当に触れた仕事のID集合」の
   完全一致を検査できる（overflow が起きる設定だと、隠れた分のIDは
   画面から読み取れないため、この強い検査ができない）。
   ATTEST を1件も含まないので、DELIVER された札は dropoff（納品口）に
   留まる（inspect＝検品台にはまだ移らない）。

     - a0（focus対象）: 自分で3件を board に出し、誰にも取られないまま
       残す（board 側で a0 が触れた件数＝ちょうど3）。
     - a1: 4件を出し、a0 が全部 CLAIM → DELIVER する
       （dropoff 側で a0 が触れた件数＝ちょうど4）。
     - a5: 1件を出し、誰にも取られない（board のノイズ＝a0は無関係）。
     - a6: 1件を自分で出して・引き受けて・納品する（dropoff のノイズ）。
     - a2〜a4, a7〜a13（10体）: それぞれ自分の依頼を1件ずつ完結させる
       （a0とは無関係の追加ノイズ）。
     - a0 に絞ったとき、部屋に描かれるロボットもちょうど1体・
       overflow は0（他N体バッジが出る理由が無い）ことも検査する。
   合計 actor = 14（a0〜a13）、合計 JOB = 3+4+1+1+10 = 19
   （およそ「14体・20件」規模。件数そのものより ID の一致が本題）。 */
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
load('src/engine/roster.js');
load('src/engine/path.js');
load('data/room.js');
load('src/render/room.js');
load('src/engine/questlog.js');
load('src/engine/aggregate.js');
load('src/adapters/fromKibble.js');

let bad = 0;
function ok(label, cond) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) bad++;
}
function sameSet(actual, expected) {
  const a = Array.from(actual).sort();
  const e = Array.from(expected).sort();
  return JSON.stringify(a) === JSON.stringify(e);
}

/* ---- フィクスチャを組み立てる ---- */
const actors = [];
for (let i = 0; i < 14; i++) actors.push('a' + i);
const [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13] = actors;

const messages = [];
let seq = 1, t = 0;
function push(from, text) {
  messages.push({ seq: seq++, from, text, ts: new Date(1758300000000 + t).toISOString() });
  t += 200;
}

// a0: 3件を出す。誰にも CLAIM されない＝ずっと board に残る。
const a0BoardJobs = ['j-a0-0', 'j-a0-1', 'j-a0-2'];
a0BoardJobs.forEach(function (id, i) { push(a0, 'JOB v1 | ' + id + ' | build | a0 job ' + i + ' | detail'); });

// a1: 4件を出す。全部 a0 が CLAIM → DELIVER する（a0 の dropoff 側）。
const a1DropoffJobs = ['j-a1-0', 'j-a1-1', 'j-a1-2', 'j-a1-3'];
a1DropoffJobs.forEach(function (id, i) { push(a1, 'JOB v1 | ' + id + ' | research | a1 job ' + i + ' | detail'); });
a1DropoffJobs.forEach(function (id) { push(a0, 'CLAIM v1 | ' + id + ' | builder'); });
a1DropoffJobs.forEach(function (id) { push(a0, 'DELIVER v1 | ' + id + ' | delivered by a0'); });

// a5: board のノイズ（a0とは無関係、誰にも取られない）
push(a5, 'JOB v1 | j-a5-0 | build | noise on board | detail');

// a6: dropoff のノイズ（a0とは無関係、自己完結）
push(a6, 'JOB v1 | j-a6-0 | build | noise on dropoff | detail');
push(a6, 'CLAIM v1 | j-a6-0 | builder');
push(a6, 'DELIVER v1 | j-a6-0 | delivered by a6');

// 残り10体（a2,a3,a4,a7..a13）: それぞれ自分の依頼を1件、自己完結（a0とは無関係）
[a2, a3, a4, a7, a8, a9, a10, a11, a12, a13].forEach(function (a, i) {
  const id = 'j-noise-' + i;
  push(a, 'JOB v1 | ' + id + ' | explain | noise job ' + i + ' | detail');
  push(a, 'CLAIM v1 | ' + id + ' | builder');
  push(a, 'DELIVER v1 | ' + id + ' | delivered by ' + a);
});

/* ---- パイプラインへ通す ---- */
const events = AQ.adapters.fromKibble(messages, { room: 'kibble', observedAt: 1758300100000 });
const normalized = AQ.questlog.load(events);
const agg = AQ.aggregate.toBeats(normalized);
const beats = agg.beats;
const totalJobs = a0BoardJobs.length + a1DropoffJobs.length + 1 + 1 + 10;
console.log('actors:', actors.length, ' jobs:', totalJobs, ' events:', normalized.length, ' beats:', beats.length);

const fakeCanvas = { getContext: function () { return {}; }, width: 0, height: 0 };
AQ.room.init(fakeCanvas);
AQ.room.prepare(beats);
const lastIndex = beats.length - 1;

/* ---- board: shown ID集合が「a0が出して誰にも取られていない3件」と完全一致 ---- */
const boardLay = AQ.room.computeBoardLayout(lastIndex, a0);
ok('board: overflow が起きない設定（0件のはず、実測 ' + boardLay.overflow + '）', boardLay.overflow === 0);
const boardShownIds = boardLay.shown.filter(function (it) { return !it.overflow; }).map(function (it) { return it.card.id; });
ok('board: 表示されている札のID集合が a0BoardJobs と完全一致（境界値だけでなく中身も検査）\n    表示=' + JSON.stringify(boardShownIds.sort()) + '\n    期待=' + JSON.stringify(a0BoardJobs.slice().sort()),
  sameSet(boardShownIds, a0BoardJobs));
ok('board: a5 のノイズ（j-a5-0）が紛れ込んでいない', boardShownIds.indexOf('j-a5-0') === -1);

/* ---- dropoff: shown ID集合が「a0が CLAIM→DELIVER した4件」と完全一致 ---- */
const dropoffLay = AQ.room.computeDropoffLayout(lastIndex, a0);
ok('dropoff: overflow が起きない設定（0件のはず、実測 ' + dropoffLay.overflow + '）', dropoffLay.overflow === 0);
const dropoffShownIds = dropoffLay.shown.filter(function (it) { return !it.overflow; }).map(function (it) { return it.card.id; });
ok('dropoff: 表示されている札のID集合が a1DropoffJobs と完全一致（境界値だけでなく中身も検査）\n    表示=' + JSON.stringify(dropoffShownIds.sort()) + '\n    期待=' + JSON.stringify(a1DropoffJobs.slice().sort()),
  sameSet(dropoffShownIds, a1DropoffJobs));
ok('dropoff: a6 のノイズ（j-a6-0）が紛れ込んでいない', dropoffShownIds.indexOf('j-a6-0') === -1);

/* ---- ロボット: 1体に絞ったら、描かれるのはちょうど1体・overflowは0 ---- */
const lastBeat = beats[lastIndex];
const positions = AQ.room.computeRobotScreenPositions(lastBeat, 1, beats, lastIndex, a0);
ok('robots: 絞り込み中に描かれるロボットはちょうど1体（実測 ' + positions.length + '体）', positions.length === 1);
ok('robots: 絞り込み中は「他 N 体」の overflow が0（実測 ' + positions.overflow + '）', positions.overflow === 0);
if (positions.length === 1) {
  ok('robots: 描かれている1体は本当に a0（実測 actor=' + positions[0].actor + '）', positions[0].actor === a0);
}

/* ---- 絞り込み無しでは、今までどおり全員ぶん出ることの確認（挙動を変えていない） ---- */
const positionsAll = AQ.room.computeRobotScreenPositions(lastBeat, 1, beats, lastIndex, null);
ok('robots: focus無しでは複数体が描かれる（比較用。実測 ' + positionsAll.length + '体）', positionsAll.length > 1);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
