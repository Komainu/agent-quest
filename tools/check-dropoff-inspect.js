/* tools/check-dropoff-inspect.js — task 2 の検証ハーネス
   使い方:  node tools/check-dropoff-inspect.js

   「納品する場所が無い。判定する場所も無い」という報告への対応で、
   従来の bench（検品台1つ）を dropoff（納品口）と inspect（検品台）に
   分けた（data/room.js・src/render/room.js・src/config.js・src/i18n.js）。
   このハーネスは、その分割が実際に機能しているかを検査する:

     1) JOB→CLAIM→DELIVER→ATTEST の1件の依頼について、
        DELIVER 直後の札の位置が dropoff オブジェクトの矩形の内側、
        ATTEST 直後の札の位置が inspect オブジェクトの矩形の内側に
        なっていること（名前ではなく、data/room.js の実際の矩形と
        比べて検査する＝タイトルバーの文言が偶然合っているだけ、
        という誤魔化しを防ぐ）。
     2) board・dropoff・inspect それぞれについて、表示枚数(shown)＋
        overflow が、本当の件数(count)と正確に一致すること
        （README の「表示数＋overflow＝本当の件数」という約束）。
     3) inspect の ok/ng 内訳が、実際の ATTEST useful/not の件数と
        一致すること。
     4) hitTestCard() が、DELIVER 直後は dropoff 側の矩形で・ATTEST
        直後は inspect 側の矩形でその依頼の jobId を返すこと（＝絵と
        当たり判定が一致している）。 */
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

function iso(msOffset) { return new Date(1758300000000 + msOffset).toISOString(); }

/** rect a が rect b の内側にすっぽり収まっているか（枠のパディング分
    小さいスロットが、家具の矩形の内側にあることを確認するのに使う）。 */
function within(a, b) {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

function objRectOf(id) {
  const o = AQ.roomWorld.objects.find(function (x) { return x.id === id; });
  return { x: o.x * AQ.roomWorld.tile, y: o.y * AQ.roomWorld.tile, w: o.w * AQ.roomWorld.tile, h: o.h * AQ.roomWorld.tile };
}

/* ---- フィクスチャを組み立てる ------------------------------------
   時系列の前半に「本題の1件（kMain）」を通し、後半で dropoff・inspect
   それぞれに overflow を起こすだけのノイズ件数を積む。本題の件は
   ノイズが積み上がる前のコマ番号で検査するので、overflow に飲まれて
   shown から消える心配が無い。 */
const messages = [];
let seq = 1, t = 0;
function push(from, text) {
  messages.push({ seq: seq++, from, text, ts: iso(t) });
  t += 200;
}

const mainJob = 'kMainJob01';
push('agent-1', 'JOB v1 | ' + mainJob + ' | build | 本題の依頼 | detail');
push('agent-2', 'CLAIM v1 | ' + mainJob + ' | builder');
push('agent-2', 'DELIVER v1 | ' + mainJob + ' | 本題の成果物');
push('agent-3', 'ATTEST v1 | ' + mainJob + ' | useful | 良い出来');

/* board のノイズ: maxBoardCards(6) を超える 8 件を投稿だけして残す。 */
const boardNoiseIds = [];
for (let i = 0; i < 8; i++) {
  const id = 'kBoard' + i;
  boardNoiseIds.push(id);
  push('agent-board', 'JOB v1 | ' + id + ' | research | board noise ' + i + ' | detail');
}

/* dropoff のノイズ: maxDropoffCards(5) を超える 8 件を納品だけして残す
   （ATTEST はしない＝判定待ちのまま dropoff に留まる）。 */
const dropoffNoiseIds = [];
for (let i = 0; i < 8; i++) {
  const id = 'kDrop' + i;
  dropoffNoiseIds.push(id);
  push('agent-drop', 'JOB v1 | ' + id + ' | explain | dropoff noise ' + i + ' | detail');
  push('agent-drop', 'CLAIM v1 | ' + id + ' | builder');
  push('agent-drop', 'DELIVER v1 | ' + id + ' | delivered ' + i);
}

/* inspect のノイズ: maxInspectCards(5) を超える 8 件を判定まで進める。
   内訳を検査できるよう、合格5件・不合格3件にする。 */
const inspectNoiseIds = [];
for (let i = 0; i < 8; i++) {
  const id = 'kInsp' + i;
  inspectNoiseIds.push(id);
  push('agent-insp', 'JOB v1 | ' + id + ' | review | inspect noise ' + i + ' | detail');
  push('agent-insp', 'CLAIM v1 | ' + id + ' | builder');
  push('agent-insp', 'DELIVER v1 | ' + id + ' | delivered ' + i);
  const verdict = (i < 5) ? 'useful | 合格' : 'not | 不合格';
  push('agent-judge', 'ATTEST v1 | ' + id + ' | ' + verdict);
}

/* ---- パイプラインへ通す ---- */
const events = AQ.adapters.fromKibble(messages, { room: 'kibble', observedAt: t + 1000 });
const normalized = AQ.questlog.load(events);
const agg = AQ.aggregate.toBeats(normalized);
const beats = agg.beats;
console.log('events:', normalized.length, ' beats:', beats.length);

const fakeCanvas = { getContext: function () { return {}; }, width: 0, height: 0 };
AQ.room.init(fakeCanvas);
AQ.room.prepare(beats);

/* beats[].events はコマにまとめられた元イベントの配列。「本題の
   DELIVER（ATTEST）に対応する元イベントを含む最初のコマ」を、
   件数の勘定ではなく中身（meta.job / type / meta.verdict）で
   直接探す。run.start が集計に含まれない・tier2 の束ね方に依存する
   といった「件数を数えるだけの検査」が陥る食い違いを避けるため。 */
function findBeatIndex(predicate) {
  for (let i = 0; i < beats.length; i++) {
    if ((beats[i].events || []).some(predicate)) return i;
  }
  return -1;
}
const idxAfterDeliver = findBeatIndex(function (e) {
  return e.meta && e.meta.job === mainJob && e.type === 'result.ok' && !e.meta.verdict;
});
const idxAfterAttest = findBeatIndex(function (e) {
  return e.meta && e.meta.job === mainJob && e.type === 'result.ok' && e.meta.verdict === 'useful';
});
ok('DELIVER に対応するコマが見つかった', idxAfterDeliver >= 0);
ok('ATTEST(useful) に対応するコマが見つかった', idxAfterAttest >= 0);

/* ---- 1) DELIVER 直後は dropoff、ATTEST 直後は inspect ---- */
console.log('\n--- 1) 札の位置：DELIVER→dropoff矩形の内側／ATTEST→inspect矩形の内側 ---');

const dropoffRect = objRectOf('dropoff');
const inspectRect = objRectOf('inspect');
ok('dropoff と inspect は別の矩形（分割できている）',
  JSON.stringify(dropoffRect) !== JSON.stringify(inspectRect));

const dLay1 = AQ.room.computeDropoffLayout(idxAfterDeliver, null);
const iLay1 = AQ.room.computeInspectLayout(idxAfterDeliver, null);
const dCard1 = dLay1.shown.find(function (s) { return s.card && s.card.id === mainJob; });
const iCard1 = iLay1.shown.find(function (s) { return s.card && s.card.id === mainJob; });
ok('DELIVER直後: 本題の札が dropoff の shown にある', !!dCard1);
ok('DELIVER直後: 本題の札が inspect の shown には無い（まだ判定されていない）', !iCard1);
if (dCard1) {
  ok('DELIVER直後: 札の矩形が dropoff オブジェクトの矩形の内側にある', within(dCard1.rect, dropoffRect));
  ok('DELIVER直後: 札の矩形は inspect オブジェクトの矩形とは重ならない',
    !(dCard1.rect.x < inspectRect.x + inspectRect.w && dCard1.rect.x + dCard1.rect.w > inspectRect.x &&
      dCard1.rect.y < inspectRect.y + inspectRect.h && dCard1.rect.y + dCard1.rect.h > inspectRect.y));
}

const dLay2 = AQ.room.computeDropoffLayout(idxAfterAttest, null);
const iLay2 = AQ.room.computeInspectLayout(idxAfterAttest, null);
const dCard2 = dLay2.shown.find(function (s) { return s.card && s.card.id === mainJob; });
const iCard2 = iLay2.shown.find(function (s) { return s.card && s.card.id === mainJob; });
ok('ATTEST直後: 本題の札が dropoff の shown からは消えている', !dCard2);
ok('ATTEST直後: 本題の札が inspect の shown にある', !!iCard2);
if (iCard2) {
  ok('ATTEST直後: 札の矩形が inspect オブジェクトの矩形の内側にある', within(iCard2.rect, inspectRect));
  ok('ATTEST直後: 判定は useful（合格）', iCard2.card.verdict === 'useful');
}

/* ---- 2) hitTestCard が絵と一致した場所を返す ---- */
console.log('\n--- 2) hitTestCard: 当たり判定が絵の位置と一致する ---');
if (dCard1) {
  const c = dCard1.rect;
  const hit = AQ.room.hitTestCard(c.x + c.w / 2, c.y + c.h / 2, idxAfterDeliver, null);
  ok('DELIVER直後: 札の中心をクリックすると本題の jobId が返る', hit === mainJob);
}
if (iCard2) {
  const c = iCard2.rect;
  const hit = AQ.room.hitTestCard(c.x + c.w / 2, c.y + c.h / 2, idxAfterAttest, null);
  ok('ATTEST直後: 札の中心をクリックすると本題の jobId が返る', hit === mainJob);
}

/* ---- 3) 表示数＋overflow＝本当の件数（board / dropoff / inspect） ---- */
console.log('\n--- 3) 表示数＋overflow＝本当の件数 ---');
const lastIndex = beats.length - 1;
const boardLay = AQ.room.computeBoardLayout(lastIndex, null);
const dropoffLay = AQ.room.computeDropoffLayout(lastIndex, null);
const inspectLay = AQ.room.computeInspectLayout(lastIndex, null);

function shownPlusOverflow(lay) {
  return lay.shown.filter(function (it) { return !it.overflow; }).length + lay.overflow;
}

ok('board: count(' + boardLay.count + ') が実件数(8)と一致', boardLay.count === 8);
ok('board: shown+overflow(' + shownPlusOverflow(boardLay) + ') が count と一致', shownPlusOverflow(boardLay) === boardLay.count);
ok('board: overflow が実際に起きている（maxBoardCards=6 < 8）', boardLay.overflow > 0);

ok('dropoff: count(' + dropoffLay.count + ') が実件数(8)と一致', dropoffLay.count === 8);
ok('dropoff: shown+overflow(' + shownPlusOverflow(dropoffLay) + ') が count と一致', shownPlusOverflow(dropoffLay) === dropoffLay.count);
ok('dropoff: overflow が実際に起きている（maxDropoffCards=5 < 8）', dropoffLay.overflow > 0);

/* inspect の本当の件数: 本題1件（useful）＋ノイズ8件（useful5・not3）＝9件 */
ok('inspect: count(' + inspectLay.count + ') が実件数(9)と一致', inspectLay.count === 9);
ok('inspect: shown+overflow(' + shownPlusOverflow(inspectLay) + ') が count と一致', shownPlusOverflow(inspectLay) === inspectLay.count);
ok('inspect: overflow が実際に起きている（maxInspectCards=5 < 9）', inspectLay.overflow > 0);
ok('inspect: ok内訳(' + inspectLay.ok + ') が実件数(6=本題1+ノイズ5)と一致', inspectLay.ok === 6);
ok('inspect: ng内訳(' + inspectLay.ng + ') が実件数(3)と一致', inspectLay.ng === 3);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
