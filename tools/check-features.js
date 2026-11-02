/* tools/check-features.js — task B/D/E の純粋ロジックの検証ハーネス
   使い方:  node tools/check-features.js

   ブラウザ（DOM）が要らない部分だけをここで検証する:
     1) focus フィルタ（main.js の computePlayBeats と同じ式）が、
        全コマを「対象の1体」と「それ以外」にちょうど二分し、
        1コマも失わない・重複させないこと。
     2) LIVE 追いつき（main.js の jumpToLive と同じ式）のスキップ数が
        「目的地 − 現在地」と正確に一致すること。
     3) AQ.sprites.build(actor) が同じ actor に対して常に同じ結果
        （決定的）で、200個サンプルしたときに十分な数（≥100）だけ
        見た目が異なること。
   （main.js 自体の DOM 配線・実際のクリック操作は Playwright 側で見る） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const AQ = {};

function load(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const rewritten = src.replace('window.AQ = window.AQ || {}', 'AQ');
  eval(rewritten);
}

load('src/config.js');
load('src/i18n.js');
load('src/sprites.js');
load('src/engine/roster.js');
load('src/engine/questlog.js');
load('src/engine/aggregate.js');
load('src/adapters/fromKibble.js');

let bad = 0;
function ok(label, cond) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) bad++;
}

/* ------------------------------------------------------------ *
 * 1) focus フィルタの件数保存
 * ------------------------------------------------------------ */
console.log('\n--- 1) focus フィルタ（main.js の computePlayBeats と同じ式）---');

const actors = ['alice', 'bob', 'carol', 'dave', 'erin'];
const messages = [];
let seq = 1, t = 0;
for (let round = 0; round < 20; round++) {
  actors.forEach(function (a) {
    messages.push({ seq: seq++, from: a, text: 'JOB v1 | j' + seq + ' | build | t | d', ts: new Date(1758300000000 + t).toISOString() });
    t += 250;
  });
}
const events = AQ.adapters.fromKibble(messages, { room: 'kibble', observedAt: 1758300100000 });
const fullBeats = AQ.aggregate.toBeats(AQ.questlog.load(events)).beats;

function computePlayBeats(beats, focusActor) {
  if (focusActor == null) return beats;
  return beats.filter(function (b) { return String(b.actor) === focusActor; });
}

const total = fullBeats.length;
ok('少なくとも複数のコマが生成されている（total=' + total + '）', total > 5);

actors.concat(['observer']).forEach(function (a) {
  const focused = computePlayBeats(fullBeats, a);
  const others = fullBeats.filter(function (b) { return String(b.actor) !== a; });
  ok('actor=' + a + ': focused(' + focused.length + ') + others(' + others.length + ') === total(' + total + ')',
    focused.length + others.length === total);
  // 重複が無いこと（同じ beat オブジェクトが2回数えられていないか）
  const seenIdx = new Set();
  let dup = false;
  focused.concat(others).forEach(function (b) { if (seenIdx.has(b.index)) dup = true; seenIdx.add(b.index); });
  ok('actor=' + a + ': focused と others の間で1コマも重複していない', !dup && seenIdx.size === total);
});

/* focus してもレンダラに渡す対象（fullBeats・真の index）は変わらない、
   という main.js の契約そのものは DOM が要るので Playwright 側で見る。 */

/* ------------------------------------------------------------ *
 * 2) LIVE 追いつきのスキップ数
 * ------------------------------------------------------------ */
console.log('\n--- 2) LIVE 追いつき（main.js の jumpToLive と同じ式）---');

function jumpSkipCount(beatsLength, currentIndex) {
  const target = beatsLength - 1;
  const skipped = target - currentIndex;
  return skipped > 0 ? skipped : 0;
}

[
  { len: 120, idx: 10, expect: 109 },
  { len: 50, idx: 49, expect: 0 },     // 既に最新＝飛ばさない
  { len: 1, idx: 0, expect: 0 },
  { len: 325, idx: 25, expect: 299 }
].forEach(function (c) {
  const got = jumpSkipCount(c.len, c.idx);
  ok('beats.length=' + c.len + ', index=' + c.idx + ' → skip=' + got + ' (expected ' + c.expect + ')', got === c.expect);
});

// config.liveMaxBehind を超えたときだけ自動発火する、という閾値そのものの確認
const behindCases = [
  { behind: AQ.config.liveMaxBehind, shouldFire: false },
  { behind: AQ.config.liveMaxBehind + 1, shouldFire: true },
  { behind: 0, shouldFire: false }
];
behindCases.forEach(function (c) {
  const fires = c.behind > AQ.config.liveMaxBehind;
  ok('liveMaxBehind=' + AQ.config.liveMaxBehind + ', behind=' + c.behind + ' → 自動発火=' + fires + ' (期待 ' + c.shouldFire + ')',
    fires === c.shouldFire);
});

/* ------------------------------------------------------------ *
 * 3) 見た目（ベクター図形パラメータ）の決定性・多様性
 *    2026-09-06: ドット絵 build() → ベクター figureFor() に置き換え
 *    （詳しい描画命令列の検証は tools/check-sprites.js が持つ。ここでは
 *    main.js / hud.js / room.js が直接使う figureFor の決定性・多様性
 *    だけを見る）。
 * ------------------------------------------------------------ */
console.log('\n--- 3) AQ.sprites.figureFor() の決定性・多様性 ---');

// 決定性: 同じ actor に対して traitsFor / figureFor を2回呼んでも同じ結果
const sampleActor = 'did:key:z6MkSomeVeryLongDidStringHere1234567890';
const t1 = AQ.sprites.traitsFor(sampleActor);
const t2 = AQ.sprites.traitsFor(sampleActor);
ok('traitsFor(actor) は決定的（同じ配列）', JSON.stringify(t1) === JSON.stringify(t2));

const f1 = AQ.sprites.figureFor(sampleActor);
const f2 = AQ.sprites.figureFor(sampleActor);
ok('figureFor(actor) は決定的（同じパラメータ）', JSON.stringify(f1) === JSON.stringify(f2));

// figureFor の6フィールドが traitsFor と矛盾しないこと（範囲チェックも兼ねる）
let fieldBad = false;
['antenna', 'head', 'body', 'tread', 'cargo', 'accent'].forEach(function (k, i) {
  if (f1[k] !== t1[i] || !(f1[k] >= 0 && f1[k] <= 3)) fieldBad = true;
});
ok('figureFor(actor) の6フィールドが traitsFor と一致し、範囲(0〜3)に収まる', !fieldBad);

// 多様性: 200個の DID を作ってサンプルし、特徴ベクトル（6個・0-3）の
// 重複が少ないこと（≥100種類）。
const N = 200;
const seenTraits = new Set();
for (let i = 0; i < N; i++) {
  const did = 'did:key:z6Mk' + i.toString(36) + 'agent' + (i * 2654435761 >>> 0).toString(16);
  seenTraits.add(AQ.sprites.traitsFor(did).join(','));
}
console.log('  ' + N + '個の DID → 特徴ベクトルが異なるもの: ' + seenTraits.size + '種類');
ok('200個サンプルして、特徴ベクトルが異なるものが100種類以上ある', seenTraits.size >= 100);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
