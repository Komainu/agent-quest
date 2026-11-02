/* tools/check-no-fabricated-payment.js — task A の検証ハーネス
   -------------------------------------------------------------
   使い方:  node tools/check-no-fabricated-payment.js

   kibble には payment.* が1件も無い（fromKibble.js は仕様として作らない）。
   このハーネスは、kibble のフィクスチャ（複数actor・複数の書式・
   Tier2 の集約が実際に起きる密度）を本物の
     adapters/fromKibble.js → engine/questlog.js → engine/aggregate.js
     → render/hud.js（story()/raw()＝実況・生ログ）
   というパイプラインにそのまま通し、生成された**すべてのコマ**の
   実況・生ログの文字列に「支払い」「payment」「authorizations」
   「total <数字>」のどれかが1文字でも出てこないかを検査する。

   1件でも見つかれば、そのコマの中身と一緒に失敗として報告する。
   ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AQ = {};

function load(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // 各ファイルの IIFE の引数を window.AQ でなく、この1つの AQ に固定する
  // （tools/check-world.js と同じ手口）。direct eval でないと、この
  // 関数のローカル変数 AQ が見えない。
  const rewritten = src.replace('window.AQ = window.AQ || {}', 'AQ');
  // eslint-disable-next-line no-eval
  eval(rewritten);
}

load('src/config.js');
load('src/i18n.js');
load('src/sprites.js');
load('src/engine/roster.js');
load('src/engine/questlog.js');
load('src/engine/aggregate.js');
load('src/engine/state.js');
load('src/render/hud.js');
load('src/adapters/fromKibble.js');

/* ---------------------------------------------------------------
   フィクスチャ: kibble 部屋の生メッセージ。
   ・6体の actor（DID っぽい文字列）
   ・JOB を6件、短時間に投稿（→ agent.plan が集約されるか試す）
   ・CLAIM/DELIVER/ATTEST を高密度に混ぜる（→ tool.call/result.ok の
     Tier2 が 'actbatch' に集約されるかどうかの本丸）
   ・書式に合わない行（自由な雑談）も混ぜる（→ フォールバックの
     tool.call+result.ok ペアも束に混ざる）
   ------------------------------------------------------------- */
function iso(msOffset) {
  return new Date(1758300000000 + msOffset).toISOString();
}

const actors = [
  'did:key:z6MkAliceAliceAliceAliceAliceAliceAliceAl',
  'did:key:z6MkBobBobBobBobBobBobBobBobBobBobBobBobBo',
  'did:key:z6MkCarolCarolCarolCarolCarolCarolCarolCa',
  'did:key:z6MkDaveDaveDaveDaveDaveDaveDaveDaveDaveDa',
  'did:key:z6MkErinErinErinErinErinErinErinErinErinEr',
  'did:key:z6MkFayFayFayFayFayFayFayFayFayFayFayFayFa'
];

const messages = [];
let seq = 1, t = 0;

function push(from, text) {
  messages.push({ seq: seq++, from, text, ts: iso(t) });
  t += 300;
}

// 6件の JOB（依頼の投稿）。すべて4000msの集約窓に収まる密度で投稿する。
actors.forEach(function (a, i) {
  push(a, 'JOB v1 | job' + i + ' | build | Widget number ' + i + ' | make it shiny');
});

// CLAIM/DELIVER/ATTEST を高密度に混ぜる（tool.call / result.ok の束）。
for (let round = 0; round < 4; round++) {
  actors.forEach(function (a, i) {
    push(a, 'CLAIM v1 | job' + i + ' | builder');
  });
  actors.forEach(function (a, i) {
    push(a, 'DELIVER v1 | job' + i + ' | here is my widget, fully built and tested');
  });
}

// ATTEST（合格・不合格）
actors.forEach(function (a, i) {
  push(a, 'ATTEST v1 | job' + i + ' | ' + (i % 2 === 0 ? 'useful | nice work' : 'not | missing tests'));
});

// 書式に合わない自由な雑談（フォールバックの tool.call+result.ok ペア）
for (let k = 0; k < 8; k++) {
  push(actors[k % actors.length], 'just chatting, no particular format here #' + k);
}

const events = AQ.adapters.fromKibble(messages, { room: 'kibble', observedAt: 1758300100000 });
const normalized = AQ.questlog.load(events);
const agg = AQ.aggregate.toBeats(normalized);
const beats = agg.beats;

console.log('events (normalized):', normalized.length);
console.log('beats (aggregated):', beats.length, '  stats:', JSON.stringify(agg.stats));

// beat kind の内訳（actbatch が実際に生成されているかの確認）
const kindCount = {};
beats.forEach(function (b) { kindCount[b.kind] = (kindCount[b.kind] || 0) + 1; });
console.log('beat kinds:', JSON.stringify(kindCount));

/* ---- hud.js を DOM 無しで駆動する ---- */
function mockEl() {
  var noop = function () {};
  return {
    win: { innerHTML: '' }, raw: { innerHTML: '' },
    usdc: { textContent: '' }, credits: { textContent: '' }, retries: { textContent: '' },
    showing: { textContent: '' }, beat: { textContent: '' },
    roster: {}, rosterChips: { innerHTML: '', addEventListener: noop }, rosterNote: { textContent: '' },
    scrub: null, focusStat: null, detailBody: null, detailTitle: null
  };
}

const el = mockEl();
AQ.hud.init(el);

const FORBIDDEN = [
  { name: '支払い', re: /支払い/ },
  { name: 'payment', re: /payment/i },
  { name: 'authorizations', re: /authorizations/i },
  { name: 'total <amount>', re: /total\s+[0-9]/i }
];

let checked = 0;
const failures = [];

beats.forEach(function (b, i) {
  const st = AQ.state.at(beats, i);
  const clock = { beats: beats, index: i, playing: false };
  AQ.hud.update(b, 0.5, st, agg.stats, clock);
  checked++;

  const hay = [el.win.innerHTML, el.raw.innerHTML, el.showing.textContent, el.beat.textContent].join(' \n ');
  FORBIDDEN.forEach(function (f) {
    if (f.re.test(hay)) {
      failures.push({
        index: i, kind: b.kind, token: f.name,
        win: el.win.innerHTML, raw: el.raw.innerHTML
      });
    }
  });
});

console.log('\nbeats checked for forbidden payment vocabulary:', checked);

if (failures.length) {
  console.log('\n✗ FAILED — forbidden payment vocabulary reached the screen for a kibble (no payment.*) log:');
  failures.forEach(function (f) {
    console.log('  beat #' + f.index + ' kind=' + f.kind + ' token="' + f.token + '"');
    console.log('    win: ' + f.win);
    console.log('    raw: ' + f.raw);
  });
  process.exit(1);
} else {
  console.log('\n✓ PASSED — no beat rendered "支払い"/"payment"/"authorizations"/"total <amount>" for this payment-free kibble log.');
  process.exit(0);
}
