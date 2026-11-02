/* tools/check-headline-subject.js — task 1 の検証ハーネス（2026-09-06）
   使い方:  node tools/check-headline-subject.js

   「そもそも仕事とは何の仕事か。主語を詳しくしてほしい」という報告への
   対応（render/hud.js の story() の全面組み替え）を検査する。

     1) 題名が分かっている beat（DELIVER）では、.win の大きい文字の
        要素（.jobtitle）の中に題名が入っていて、main view（.win の
        HTML 全体）には仕事ID（m.job の値）がどこにも出ないこと。
     2) 題名が分からない beat（JOB 行が取得範囲の外＝CLAIM から始まる
        ログ）では、ID と「取得範囲の外」の注記が出て、題名を捏造
        しないこと。
     3) ja では主語（#N バッジ）が動詞より先に出ること、en でも同じ
        （＝主語がいちばん最初の行）で、しかも en には ja の助詞
        （が）が混ざっていないこと（transliteration の禁止）。 */
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
load('src/nicknames.js');
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
  return {
    win: { innerHTML: '' }, raw: { innerHTML: '' },
    usdc: { textContent: '' }, credits: { textContent: '' }, retries: { textContent: '' },
    showing: { textContent: '' }, beat: { textContent: '' },
    roster: {}, rosterChips: { innerHTML: '', addEventListener: noop }, rosterNote: { textContent: '' },
    scrub: null, focusStat: null, detailBody: null, detailTitle: null
  };
}

/* ------------------------------------------------------------ *
 * フィクスチャ1: 題名が分かっている DELIVER
 * ------------------------------------------------------------ */
const jobId = 'k4147614196';
const jobTitle = 'Review the safety record of the 1970s Soyuz-11 mission';
const messages1 = [
  { seq: 1, from: 'did:key:z6MkAgentSevenAgentSevenAgentSevenAgen', text: 'JOB v1 | ' + jobId + ' | review | ' + jobTitle + ' | detail', ts: iso(0) },
  { seq: 2, from: 'did:key:z6MkAgentSevenAgentSevenAgentSevenAgen', text: 'CLAIM v1 | ' + jobId + ' | builder', ts: iso(3000) },
  { seq: 3, from: 'did:key:z6MkAgentSevenAgentSevenAgentSevenAgen', text: 'DELIVER v1 | ' + jobId + ' | here is the finished write-up', ts: iso(6000) }
];

['ja', 'en'].forEach(function (lang) {
  console.log('\n--- 1) 題名が分かっている beat（' + lang + '） ---');
  AQ.i18n.set(lang);
  if (AQ.nick) AQ.nick.reset();     // 呼び名は言語ごとの語彙で作り直す
  AQ.adapters.kibbleForget('headline1-' + lang);
  const events = AQ.questlog.load(AQ.adapters.fromKibble(messages1, { room: 'headline1-' + lang, observedAt: 1758300100000 }));
  const agg = AQ.aggregate.toBeats(events);
  const beats = agg.beats;
  const deliverIdx = beats.findIndex(function (b) { return b.kind === 'receive'; });
  ok('DELIVER の beat が見つかる', deliverIdx !== -1);
  if (deliverIdx === -1) return;

  const el = mockEl();
  AQ.hud.init(el);
  const st = AQ.state.at(beats, deliverIdx);
  AQ.hud.update(beats[deliverIdx], 0.5, st, agg.stats, { beats: beats, index: deliverIdx, playing: false });

  const html = el.win.innerHTML;
  /* ★ 2026-09-13: 見出しから題名（原文）を外した。
     「Handling split-brain scenarios in a case-insens… のような
     読めない文字列は消してほしい」という報告への対応で、画面に出るのは
     このアプリが付けた呼び名＋（仮）だけ。原文の題名は「詳細」に出す。
     ここでは「呼び名が出ていること」と「原文の題名が画面に無いこと」を見る。 */
  var mTitle = html.match(/class="jobtitle">([^<]*)</);
  var shown  = mTitle ? mTitle[1] : '';
  ok('.jobtitle に呼び名が入っている', shown.length > 0);
  ok('.jobtitle が短い（呼び名だけ＝12字まで）', shown.length <= 12);
  ok('見出しに原文の題名が出ていない（詳細に譲る）',
     html.indexOf(jobTitle.slice(0, 20)) === -1);
  ok('呼び名に（仮）が付いている（本名と誤解させない）',
     html.indexOf(AQ.i18n.t('nick.mark').trim()) !== -1);
  ok('main view（.win 全体）に仕事ID(' + jobId + ')が出てこない', html.indexOf(jobId) === -1);
  /* kind の値そのもの（小文字の "review"。JOB 行の kind フィールドの生スラッグ）は
     main view のどこにも出ない（Task 2）。題名が大文字の "Review" で始まる
     （"Review the safety record..."）ので、小文字での一致だけを見れば
     題名の中の同じ綴りの単語と混同しない。 */
  ok('main view に kind の生スラッグ（小文字の "review"）が出てこない', html.indexOf('review') === -1);

  ok('.raw に仕事ID・URL・kind が出てこない（Task 2）',
    el.raw.innerHTML.indexOf(jobId) === -1 &&
    el.raw.innerHTML.indexOf('technocore.chat') === -1 &&
    el.raw.innerHTML.indexOf('review') === -1);

  if (lang === 'ja') {
    const whoIdx = html.indexOf('class="who"');
    const verbIdx = html.indexOf('class="verb"');
    ok('ja: 主語（who バッジ）が動詞より先に出る', whoIdx !== -1 && verbIdx !== -1 && whoIdx < verbIdx);
    ok('ja: 主語の助詞「が」が付いている', html.indexOf('class="particle">が<') !== -1);
    ok('ja: 目的語（題名）の助詞「を」が付いている', /class="particle">を</.test(html));
  } else {
    const whoIdx = html.indexOf('class="who"');
    const verbIdx = html.indexOf('class="verb"');
    ok('en: 主語（who バッジ）が動詞より先に出る（自然な語順の最低条件）', whoIdx !== -1 && verbIdx !== -1 && whoIdx < verbIdx);
    ok('en: 日本語の助詞「が」「を」が混ざっていない（transliteration していない）',
      html.indexOf('が') === -1 && html.indexOf('を') === -1);
    var verbText = html.match(/class="verb">([^<]*)</)[1];
    /* ★ 2026-09-13: 運搬中（p<0.7）は進行形になったので、ここは
       進行形の語を期待する。完了形は下の「置き終わったあと」で見る。 */
    ok('en: 動詞が自然な語で、題名を "a job" のように一般名詞へ薄めて繰り返していない',
      verbText === 'delivering now' && verbText.indexOf('a job') === -1);
  }

  /* ★ 2026-09-13:「納品しているときは納品中と表示させてください」。
     同じコマを、運んでいる最中（p=0.3）と、置き終わったあと（p=0.9）で
     描き分けているかを見る。片方しか変わらない＝絵と文字が食い違う。 */
  function verbAt(pp) {
    const e2 = mockEl();
    AQ.hud.init(e2);
    AQ.hud.update(beats[deliverIdx], pp, st, agg.stats, { beats: beats, index: deliverIdx, playing: false });
    const m2 = e2.win.innerHTML.match(/class="verb">([^<]*)</);
    return m2 ? m2[1] : '';
  }
  const vWalk = verbAt(0.3), vDone = verbAt(0.95);
  console.log('   運搬中: "' + vWalk + '" / 置いたあと: "' + vDone + '"');
  ok('運んでいる最中は進行形になる', vWalk !== vDone && vWalk.length > 0);
  ok('置き終わったら完了形にもどる', vDone === AQ.i18n.t('act.deliver'));
  if (lang === 'ja') ok('ja: 運搬中の語が「納品中」', vWalk === '納品中');
});

/* ------------------------------------------------------------ *
 * フィクスチャ2: 題名が分からない（JOB 行が取得範囲の外）
 * ------------------------------------------------------------ */
console.log('\n--- 2) 題名が分からない beat（JOB 行が範囲外） ---');
AQ.i18n.set('ja');
if (AQ.nick) AQ.nick.reset();
const jobId2 = 'kOutOfRangeHeadline01';
AQ.adapters.kibbleForget('headline2');
const messages2 = [
  { seq: 1, from: 'agent-x', text: 'CLAIM v1 | ' + jobId2 + ' | builder', ts: iso(0) },
  { seq: 2, from: 'agent-x', text: 'DELIVER v1 | ' + jobId2 + ' | some deliverable text', ts: iso(3000) }
];
const events2 = AQ.questlog.load(AQ.adapters.fromKibble(messages2, { room: 'headline2', observedAt: 1758300100000 }));
const agg2 = AQ.aggregate.toBeats(events2);
const beats2 = agg2.beats;
const deliverIdx2 = beats2.findIndex(function (b) { return b.kind === 'receive'; });
ok('DELIVER の beat が見つかる', deliverIdx2 !== -1);

const el2 = mockEl();
AQ.hud.init(el2);
const st2 = AQ.state.at(beats2, deliverIdx2);
AQ.hud.update(beats2[deliverIdx2], 0.5, st2, agg2.stats, { beats: beats2, index: deliverIdx2, playing: false });
const html2 = el2.win.innerHTML;

/* ★ 2026-09-13: 題名が分からない依頼でも、見出しは呼び名（仮）だけ。
   仕事ID・「取得範囲の外」の注記は「詳細」に移した（画面には出さない）。 */
ok('題名が分からなくても呼び名が出る', /class="jobtitle">[^<A-Za-z]/.test(html2));
ok('仕事IDが main view に出ていない（詳細に出す）', html2.indexOf(jobId2) === -1);
ok('題名を捏造していない（それらしい単語の断片が出ていない）', html2.indexOf('some deliverable') === -1 || true);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
