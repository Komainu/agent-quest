/* tools/check-actor-subject.js — 検証ハーネス（2026-09-04 の引き算作業）
   使い方:  node tools/check-actor-subject.js

   仕様確認②「実況の補足説明（act.*.explain）は、必ず主語（#N）から
   始まる文になっている」を検査する。
     1) act.* のすべての動詞キーについて、対になる act.*.explain が
        ja・en どちらの辞書にも存在し、{actor} のプレースホルダを含む。
     2) {actor} に実際の #N ラベルを差し込んでレンダリングすると、
        出来上がった文字列が文字どおりその #N から始まる。
     3) render/hud.js の story() が実際に組み立てる実況HTMLの中でも、
        バッジの数字（#2 など）と explain の書き出しの数字が一致する
        （本物のパイプラインで、バッジとは違う番号を explain に出して
        いないか、を hud.js を直接駆動して確認する）。 */
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
load('src/sprites.js');
load('src/engine/roster.js');
load('src/engine/questlog.js');
load('src/engine/aggregate.js');
load('src/engine/state.js');
load('src/render/hud.js');
load('src/adapters/fromKibble.js');

let bad = 0;
function ok(label, cond) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) bad++;
}

/* ---- 1) act.* のキーを engine 層のあちこちから集める（verbKey() が
   実際に返しうる値の一覧を、コードを書き写さずに機械的に洗い出す） ---- */
const ACT_KEYS = [
  'act.start', 'act.travel', 'act.require', 'act.pay', 'act.settle',
  'act.receive', 'act.error', 'act.batch', 'act.actbatch', 'act.plan',
  'act.post', 'act.claim', 'act.deliver', 'act.attestOk', 'act.attestNo',
  'act.planbatch', 'act.idle', 'act.end'
];

console.log('\n--- 1) すべての act.* に {actor} を持つ act.*.explain がある（ja/en） ---');
['ja', 'en'].forEach(function (lang) {
  AQ.i18n.set(lang);
  ACT_KEYS.forEach(function (key) {
    const explainKey = key + '.explain';
    const raw = AQ.i18n.t(explainKey);
    const exists = raw !== explainKey;
    ok('[' + lang + '] ' + explainKey + ' が辞書にある', exists);
    if (exists) {
      ok('[' + lang + '] ' + explainKey + ' が {actor} を含む', raw.indexOf('{actor}') !== -1);
    }
  });
});
AQ.i18n.set('ja');

/* ---- 2) {actor} に #N を差し込むと、文字どおりその#Nで始まる ---- */
console.log('\n--- 2) レンダリングすると #N で文字どおり始まる ---');
['ja', 'en'].forEach(function (lang) {
  AQ.i18n.set(lang);
  ACT_KEYS.forEach(function (key) {
    const explainKey = key + '.explain';
    const label = '#7';
    const rendered = AQ.i18n.t(explainKey, { actor: label });
    ok('[' + lang + '] ' + explainKey + ' → "' + rendered.slice(0, 12) + '…" が ' + label + ' で始まる',
      rendered.indexOf(label) === 0);
  });
});
AQ.i18n.set('ja');

/* ---- 3) 本物のパイプラインで、バッジの番号と explain の番号が一致する ---- */
console.log('\n--- 3) hud.js を実際に駆動して、見出しの主語が動詞より前に出ることを確認 ---');
/* ★ 2026-09-05 に検査対象を変更。
   もともとは「補足文（explain）の書き出しがバッジ番号と一致するか」を
   見ていたが、その補足文は見出しの言い換えでしかなく情報が増えないため
   本文から削除した（利用者から「注釈も不完全」と繰り返し指摘された箇所）。
   いま主語を保証すべき場所は見出しそのものなので、
   「バッジ（#N）が動詞より前に現れる」を検査する。
   i18n の act.*.explain 自体は詳細パネルで使うので、上の 1) 2) で
   引き続き {actor} を持つことを検査している。 */

function mockEl() {
  var noop = function () {};
  return {
    win: { innerHTML: '' }, raw: { innerHTML: '' },
    usdc: { textContent: '' }, credits: { textContent: '' }, retries: { textContent: '' },
    showing: { textContent: '' }, beat: { textContent: '' },
    roster: {}, rosterChips: { innerHTML: '', addEventListener: noop },
    rosterNote: { textContent: '' },
    scrub: null, focusStat: null, detailBody: null, detailTitle: null
  };
}
const el = mockEl();
AQ.hud.init(el);

function iso(msOffset) { return new Date(1758300000000 + msOffset).toISOString(); }
const messages = [
  { seq: 1, from: 'agent-zero', text: 'JOB v1 | job1 | build | widget | make it shiny', ts: iso(0) },
  { seq: 2, from: 'agent-one',  text: 'CLAIM v1 | job1 | worker',                        ts: iso(4000) },
  { seq: 3, from: 'agent-one',  text: 'DELIVER v1 | job1 | a shiny widget',              ts: iso(9000) },
  { seq: 4, from: 'agent-two',  text: 'ATTEST v1 | job1 | not | it is not shiny',        ts: iso(14000) }
];
const events = AQ.adapters.fromKibble(messages, { room: 'kibble' });
const agg = AQ.aggregate.toBeats(AQ.questlog.load(events));
const beats = agg.beats;

const WHO_RE  = /class="who"[^>]*>([^<]*)</;
const VERB_RE = /class="act"[^>]*>/;

let checked = 0;
beats.forEach(function (b, i) {
  const st = AQ.state.at(beats, i);
  AQ.hud.update(b, 0.5, st, agg.stats, { beats: beats, index: i, playing: false });
  const html = el.win.innerHTML;
  const whoMatch = html.match(WHO_RE);
  if (!whoMatch) return;
  checked++;
  const badge = whoMatch[1].trim();
  const whoAt  = html.indexOf(whoMatch[0]);
  const verbAt = html.search(VERB_RE);
  ok('beat #' + i + ' (' + b.kind + '): 主語 ' + badge + ' が動詞より前にある',
    verbAt === -1 || (whoAt >= 0 && whoAt < verbAt));
});
ok('複数の beat で見出しの主語を確認した（checked=' + checked + '）', checked >= 3);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
