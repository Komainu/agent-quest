/* tools/check-detail-fields.js — task 2 の検証ハーネス（2026-09-06）
   使い方:  node tools/check-detail-fields.js

   「job id・kind・URL・seq・DID の全文は main view から消したが、
   詳細パネルには全部残っている」ことを検査する。
     1) job が分かっている beat（CLAIM）で、main view（.win + .raw）
        から job id・kind・完全な URL（technocore.chat）・DID の全文が
        消えていること。
     2) 同じ beat の詳細パネル（AQ.hud のテスト用フックが無いので、
        detailBody へ書き込まれる HTML を直接検査する）に、job id・
        kind（訳語）・seq・完全な URL・DID の全文がすべて含まれること。
   kind の値には、i18n の kind.* 辞書に**無い**スラッグ（'ops'）を
   あえて使い、main view チェックが「訳された結果たまたま見えなくなった」
   のではなく「本当に出していない」ことを確認できるようにする。 */
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

function iso(msOffset) { return new Date(1758300000000 + msOffset).toISOString(); }

function mockEl() {
  var noop = function () {};
  var body = { innerHTML: '' };
  return {
    win: { innerHTML: '' }, raw: { innerHTML: '' },
    usdc: { textContent: '' }, credits: { textContent: '' }, retries: { textContent: '' },
    showing: { textContent: '' }, beat: { textContent: '' },
    roster: {}, rosterChips: { innerHTML: '', addEventListener: noop }, rosterNote: { textContent: '' },
    scrub: null, focusStat: null, detailBody: body, detailTitle: { textContent: '' }
  };
}

const actorDid = 'did:key:z6MkFullActorDidFullActorDidFullActorDi';
const jobId = 'kDetailFieldsCheck01';

['ja', 'en'].forEach(function (lang) {
  console.log('\n--- ' + lang + ' ---');
  AQ.i18n.set(lang);
  AQ.adapters.kibbleForget('detailcheck-' + lang);
  const messages = [
    { seq: 1, from: actorDid, text: 'JOB v1 | ' + jobId + ' | ops | a title for this job | detail text', ts: iso(0) },
    { seq: 42, from: actorDid, text: 'CLAIM v1 | ' + jobId + ' | builder', ts: iso(3000) }
  ];
  const events = AQ.questlog.load(AQ.adapters.fromKibble(messages, { room: 'detailcheck-' + lang, observedAt: 1758300100000 }));
  const agg = AQ.aggregate.toBeats(events);
  const beats = agg.beats;
  const claimIdx = beats.findIndex(function (b) { return b.kind === 'travel'; });
  ok('CLAIM の beat（job あり）が見つかる', claimIdx !== -1);
  if (claimIdx === -1) return;

  const claimBeat = beats[claimIdx];
  const m = claimBeat.lead.meta;
  ok('フィクスチャの前提: meta.job/kind/seq/target/actor が揃っている',
    m.job === jobId && m.kind === 'ops' && m.seq === 42 &&
    typeof claimBeat.lead.target === 'string' && claimBeat.lead.actor === actorDid);

  const el = mockEl();
  AQ.hud.init(el);
  const st = AQ.state.at(beats, claimIdx);
  AQ.hud.update(claimBeat, 0.5, st, agg.stats, { beats: beats, index: claimIdx, playing: false });

  const mainView = el.win.innerHTML + ' \n ' + el.raw.innerHTML;
  const detail = el.detailBody.innerHTML;
  const target = claimBeat.lead.target;

  console.log('  main view length=' + mainView.length + '  detail length=' + detail.length);

  /* ---- main view から消えていること ---- */
  ok('main view に job id が出ない', mainView.indexOf(jobId) === -1);
  ok('main view に kind（"ops"）が出ない', mainView.indexOf('ops') === -1);
  ok('main view に seq（42）が数値として出ない', !/(^|[^0-9])42([^0-9]|$)/.test(mainView));
  ok('main view に完全な URL（technocore.chat）が出ない', mainView.indexOf('technocore.chat') === -1);
  ok('main view に DID の全文が出ない', mainView.indexOf(actorDid) === -1);

  /* ---- 詳細パネルには全部残っていること ---- */
  ok('詳細パネルに job id がある', detail.indexOf(jobId) !== -1);
  ok('詳細パネルに kind（訳語 or 生スラッグ）がある',
    detail.indexOf('ops') !== -1);   // 'ops' は kind.* 辞書に無いので訳されずそのまま出るはず
  ok('詳細パネルに seq（42）がある', detail.indexOf('>42<') !== -1);
  ok('詳細パネルに完全な URL がある', detail.indexOf(target) !== -1 && target.indexOf('technocore.chat') !== -1);
  ok('詳細パネルに DID の全文がある', detail.indexOf(actorDid) !== -1);
});

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
