/* tools/check-focus-cards.js — task C の検証ハーネス
   使い方:  node tools/check-focus-cards.js

   1体に絞ったとき、掲示板・納品口に「表示している枚数＋overflow」が
   その1体が本当に触れた（投稿／引受／納品／判定した）依頼の件数と
   ぴったり一致することを検査する（README の「表示数＋overflow＝本当の
   件数」という約束を、task C のフィルタでも崩していないかの確認）。
   このフィクスチャは ATTEST を1件も含まない＝ DELIVER された札は
   すべて検品台（inspect）ではなく納品口（dropoff）に留まる
   （2026-09-06 (2) で bench を dropoff/inspect に分割したときの前提）。

   フィクスチャ: 14体・20件の依頼。
     - focus 対象 a0 は8件の依頼を自分で board に出し、誰にも取られない
       まま残す（＝掲示板側で a0 が「関わった」件数がちょうど8件になる）。
     - a1 は7件の依頼を出し、a0 がそれを全部 CLAIM → DELIVER する
       （＝納品口側で a0 が「関わった」件数がちょうど7件になる。
       a0 自身は誰の判定も行わない＝二重にカウントされる経路が無い）。
     - a2〜a6 はそれぞれ自分の依頼を1件ずつ、自分で出して・引き受けて・
       納品する（a0 には一切関係しない、ノイズ）。
     - a7〜a13 は依頼の書式に合わない雑談だけ（＝ログに出てくる実在の
       actor ではあるが、依頼には一切触れない）。
   合計 actor = 14（a0〜a13）、合計 JOB = 8 + 7 + 5 = 20。 */
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

/* ---- フィクスチャを組み立てる ---- */
const actors = [];
for (let i = 0; i < 14; i++) actors.push('a' + i);
const [a0, a1, a2, a3, a4, a5, a6] = actors;

const messages = [];
let seq = 1, t = 0;
function push(from, text) {
  messages.push({ seq: seq++, from, text, ts: new Date(1758300000000 + t).toISOString() });
  t += 200;
}

// a0: 8件を出す。誰にも CLAIM されない＝ずっと board に残る。
const a0Jobs = [];
for (let i = 0; i < 8; i++) {
  const id = 'j-a0-' + i;
  a0Jobs.push(id);
  push(a0, 'JOB v1 | ' + id + ' | build | a0 job ' + i + ' | detail');
}

// a1: 7件を出す。全部 a0 が CLAIM → DELIVER する。
const a1Jobs = [];
for (let i = 0; i < 7; i++) {
  const id = 'j-a1-' + i;
  a1Jobs.push(id);
  push(a1, 'JOB v1 | ' + id + ' | research | a1 job ' + i + ' | detail');
}
a1Jobs.forEach(function (id) { push(a0, 'CLAIM v1 | ' + id + ' | builder'); });
a1Jobs.forEach(function (id) { push(a0, 'DELIVER v1 | ' + id + ' | delivered by a0'); });

// a2〜a6: 自分の依頼を自分で完結させる（a0 とは無関係のノイズ）。
// ただし a6 だけは投稿したまま誰も取らない＝board に残る「a0 とは無関係の
// もう1件」を作る（focus無しの母数が a0 単体の件数とたまたま一致してしまう
// のを避け、絞り込みが本当に効いていることをちゃんと検査できるようにする）。
[a2, a3, a4, a5, a6].forEach(function (a, i) {
  const id = 'j-noise-' + i;
  push(a, 'JOB v1 | ' + id + ' | explain | noise job ' + i + ' | detail');
  if (a === a6) return;   // 未消化のまま残す
  push(a, 'CLAIM v1 | ' + id + ' | builder');
  push(a, 'DELIVER v1 | ' + id + ' | delivered by ' + a);
});

// a7〜a13: 依頼の書式に合わない雑談だけ（actor としては登場する）。
for (let i = 7; i < 14; i++) push(actors[i], 'just chatting, no format here #' + i);

/* ---- パイプラインへ通す ---- */
const events = AQ.adapters.fromKibble(messages, { room: 'kibble', observedAt: 1758300100000 });
const normalized = AQ.questlog.load(events);
const agg = AQ.aggregate.toBeats(normalized);
const beats = agg.beats;
console.log('actors:', actors.length, ' jobs:', 20, ' events:', normalized.length, ' beats:', beats.length);

const fakeCanvas = { getContext: function () { return {}; }, width: 0, height: 0 };
AQ.room.init(fakeCanvas);
AQ.room.prepare(beats);

const lastIndex = beats.length - 1;

/* ---- board: a0 が投稿して、誰にも取られていない件数（=8） ---- */
const boardLay = AQ.room.computeBoardLayout(lastIndex, a0);
const boardShownPlusOverflow = boardLay.shown.filter(function (it) { return !it.overflow; }).length +
                                boardLay.overflow;
ok('board: focused=true フラグが立っている', boardLay.focused === true);
ok('board: count（絞り込み後の本当の件数）が a0 の未消化の依頼数と一致（' + boardLay.count + ' === 8）',
  boardLay.count === 8);
ok('board: shown+overflow が count と一致（' + boardShownPlusOverflow + ' === ' + boardLay.count + '）',
  boardShownPlusOverflow === boardLay.count);
// 実際に描画されるはずの overflow が起きている設定（8 > maxBoardCards=6）ことも確認
ok('board: この設定では実際に overflow が発生している（0件だと検査が弱くなるため）',
  boardLay.overflow > 0);

/* ---- dropoff: a0 が CLAIM→DELIVER した件数（=7）。ATTEST が1件も
   無いフィクスチャなので、これらは全部 dropoff（納品口）に留まる
   （inspect＝検品台にはまだ移っていない）。 ---- */
const dropoffLay = AQ.room.computeDropoffLayout(lastIndex, a0);
const dropoffShownPlusOverflow = dropoffLay.shown.filter(function (it) { return !it.overflow; }).length +
                                dropoffLay.overflow;
ok('dropoff: focused=true フラグが立っている', dropoffLay.focused === true);
ok('dropoff: count（絞り込み後の本当の件数）が a0 の納品数と一致（' + dropoffLay.count + ' === 7）',
  dropoffLay.count === 7);
ok('dropoff: shown+overflow が count と一致（' + dropoffShownPlusOverflow + ' === ' + dropoffLay.count + '）',
  dropoffShownPlusOverflow === dropoffLay.count);
ok('dropoff: この設定では実際に overflow が発生している（0件だと検査が弱くなるため）',
  dropoffLay.overflow > 0);

/* ---- focus していないときは今までどおり全件（挙動を変えていない） ---- */
const boardAll = AQ.room.computeBoardLayout(lastIndex);
const dropoffAll = AQ.room.computeDropoffLayout(lastIndex);
ok('board: focus無しでは focused=false のまま', boardAll.focused === false);
// a6 の未消化ぶんが1件混ざっているので、focus無しの母数(9)は a0 単体(8)
// より大きい＝絞り込みが「たまたま一致した」のではなく本当に効いている。
ok('board: focus無しの count(9) は a0 に絞ったときの count(8) より大きい',
  boardAll.count === 9 && boardAll.count > boardLay.count);
ok('dropoff: focus無しでは focused=false のまま', dropoffAll.focused === false);
ok('dropoff: focus無しの count は a0(7) 単体より大きい（全員ぶん出ている）', dropoffAll.count > 7);

/* ---- ノイズ actor（a2）に絞った場合も、自分の分（1件）だけが出る ---- */
const boardA2 = AQ.room.computeBoardLayout(lastIndex, a2);
const dropoffA2 = AQ.room.computeDropoffLayout(lastIndex, a2);
ok('board: a2 に絞ると a2 自身の依頼は既に CLAIM 済みなので0件', boardA2.count === 0);
ok('dropoff: a2 に絞ると a2 が納品した1件だけ', dropoffA2.count === 1);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
