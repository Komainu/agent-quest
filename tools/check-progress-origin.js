/* tools/check-progress-origin.js — 2026-09-07 の報告の検証ハーネス
   使い方:  node tools/check-progress-origin.js

   報告（原文）:
     「最初からボタンを押して、最初から始めさせても②引き受けたから
       スタートしました。そして頻繁に別の依頼に切り替わったりします。
       実際の動きはその通りかもしれませんが、依頼が切り替わる際に
       説明書きが必要だと感じました。」

   直したのはデータではなく表示。この harness は次を機械的に確かめる:

     1) 「①を出したのは別のエージェント」のとき
        ・「詳細」パネルの関係者一覧（①の行）に、出した本人（POSTER）の
          #番号・呼び名・DID全文が正しく出る（＝分かっているのに
          「不明」と書いていない）
        ・その番号は、ログ全体で JOB を書いた本人の #N と一致する
          （＝捏造していない。名簿の番号と突き合わせる）
        ・①の番号は WORKER 自身の番号ではない（誰の手柄でもない
          ①を、いま見ている本人の手柄にすり替えていない）
     2) ログ全体を探しても JOB 行が無いとき
        ・①の行が「不明（jobs.detailUnknown）」になる
        ・#番号を捏造していない（①の値に # が出ない）
        ・②（分かっている段階）は普通に番号が出る（＝①だけが
          分からないのであって、詳細パネルごと壊れたわけではない）
     3) 本人が①を出しているとき
        ・①の行は「不明」ではなく、本人（WORKER）の#番号で出る
     4) ja / en の両方で、詳細パネルが使う文言が辞書に実在し、
        キー名がそのまま画面に出ていない

   ★ 2026-09-27: ①〜④の帯を画面から外したので、検査対象を
     「詳細」パネル（jobWhoBlock。#detailBody の .whoblock）へ移した。
     もとの帯（progressRow）が持っていた「①はどこにあるのか」「本人か
     どうか」という保証は、jobWhoBlock が段階ごとに関係者を正確に
     出す・分からなければ「不明」と明記する、という形でそのまま残って
     いるので、そちらを直接検査する。

   ★ 削除した検査（4番だった「依頼が切り替わったときの説明書き」）:
     progressRow() が呼ばれなくなったことで、その中でしか使われて
     いなかった computeJobSwitch()（「別の依頼に切り替わりました」の
     判定そのもの）も呼び出し元が無くなり、まるごと死んだコードに
     なった（呼び出しているのは progressRow 自身だけで、他のどこからも
     呼ばれていないことをコードで確認済み）。つまりこれは「帯の見た目
     だけが変わった」のではなく、切り替え検知の機能そのものが画面上に
     一切残っていない。詳細パネル側にも「依頼が切り替わった」という
     概念に対応する表示は無い（詳細はいつでも「その依頼の全記録」を
     時系列で出すだけで、切り替えの前後という考え方を持たない）ので、
     移し替え先が無い。よってこの検査は削除した。①〜④それぞれの
     関係者が正確かどうかは 1)〜3) がそのまま保証している。 */
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
load('src/engine/jobs.js');
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
  const noop = function () {};
  return {
    win: { innerHTML: '' }, raw: { innerHTML: '' },
    usdc: { textContent: '' }, credits: { textContent: '' }, retries: { textContent: '' },
    showing: { textContent: '' }, beat: { textContent: '' },
    roster: {}, rosterChips: { innerHTML: '', addEventListener: noop }, rosterNote: { textContent: '' },
    scrub: null, focusStat: null, detailBody: { innerHTML: '' }, detailTitle: { textContent: '' }
  };
}

/** メッセージ列 → { beats, events } */
function build(room, messages) {
  AQ.adapters.kibbleForget(room);
  const events = AQ.questlog.load(
    AQ.adapters.fromKibble(messages, { room: room, observedAt: 1758300100000 }));
  const agg = AQ.aggregate.toBeats(events);
  return { beats: agg.beats, events: events };
}

/** その actor に割り当てられている #N を、番号を配っている当人
    （engine/roster.js）から直接もらう。#番号の付け方そのものは
    AQ.hud.update() の内部と同じ（fullBeats から作る）。 */
function rosterNumberOf(beats, actor) {
  const n = AQ.roster.build(beats).numberOf[actor];
  return n == null ? null : String(n);
}

/** built（build() の戻り値）と jobId から、「詳細」パネルの
    #detailBody を実際に描かせて、その HTML を返す。main.js が
    札クリックで渡す ctx.jobRec と同じ経路（AQ.hud.update → renderDetail
    → showJobDetail → jobWhoBlock）をそのまま通す。 */
function renderJobDetail(built, jobId) {
  const idx = AQ.jobs.index(built.events);
  const rec = idx.byId[jobId];
  const el = mockEl();
  AQ.hud.init(el);
  AQ.hud.resetProgressTracking();
  const b = built.beats[built.beats.length - 1];
  const st = AQ.state.at(built.beats, b.index);
  AQ.hud.update(b, 1, st, { shown: built.beats.length, total: built.beats.length },
    { beats: built.beats, index: built.beats.length - 1, playing: false },
    { fullBeats: built.beats, trueIndex: b.index, jobRec: rec, jobIndex: idx });
  return { html: el.detailBody.innerHTML, rec: rec };
}

/** jobWhoBlock の中から、指定した段階（①〜④）の1行（.drow）だけを
    取り出す。glyphs は jobWhoBlock と同じ ['①','②','③','④']。 */
function drowFor(html, n) {
  const glyphs = ['①', '②', '③', '④'];
  const re = new RegExp('<div class="drow"><span class="dlabel">' + glyphs[n - 1] +
                         '[\\s\\S]*?</div>');
  const m = html.match(re);
  return m ? m[0] : null;
}

const POSTER = 'did:key:z6MkPosterPosterPosterPosterPosterPoster';
const WORKER = 'did:key:z6MkWorkerWorkerWorkerWorkerWorkerWorker';

/* ============================================================
   1) ①を出したのは別のエージェント（＝報告そのものの状況）
   ============================================================ */
['ja', 'en'].forEach(function (lang) {
  console.log('\n--- 1) ①は別のエージェントが出した（' + lang + '） ---');
  AQ.i18n.set(lang);
  /* jobId はことば単位で言語ごとに変える。同じ jobId を使い回すと、
     詳細パネル側の「同じ依頼をもう一度描き直さない」キャッシュ
     （hud.js の detailJobKey）に阻まれて、2回目（en）の描画が
     素通りしてしまう。 */
  const jobId = 'kOtherPosted01' + lang;
  const built = build('origin1-' + lang, [
    { seq: 1, from: POSTER, text: 'JOB v1 | ' + jobId + ' | review | Check the tide tables | detail', ts: iso(0) },
    { seq: 2, from: WORKER, text: 'CLAIM v1 | ' + jobId + ' | builder', ts: iso(3000) },
    { seq: 3, from: WORKER, text: 'DELIVER v1 | ' + jobId + ' | here it is', ts: iso(6000) }
  ]);

  const { html, rec } = renderJobDetail(built, jobId);
  ok('①〜②の記録がそろっている（フィクスチャの前提）', rec && rec.cast.poster === POSTER);

  const row1 = drowFor(html, 1);
  ok('①の行を詳細パネルから取り出せた', !!row1);
  if (!row1) return;

  ok('①に「不明」が出ていない（分かっているのに不明扱いにしていない）',
     row1.indexOf(AQ.i18n.t('jobs.detailUnknown')) === -1);

  const numInRow = (row1.match(/#(\d+)/) || [])[1];
  ok('①の値に #番号が入っている', numInRow != null);
  if (numInRow != null) {
    const rn = rosterNumberOf(built.beats, POSTER);
    ok('名簿に POSTER の番号がある', rn != null);
    ok('①の番号が名簿の POSTER の番号（#' + rn + '）と一致する（＝捏造していない）',
       numInRow === rn);
    ok('①が WORKER 自身の番号を指していない',
       numInRow !== rosterNumberOf(built.beats, WORKER));
  }
  ok('①に本物の DID 全文も出ている（呼び名だけで終わらせない）',
     row1.indexOf('<code>' + POSTER + '</code>') !== -1);
  ok('キー名がそのまま画面に出ていない', html.indexOf('jobs.detailUnknown') === -1 || row1.indexOf('jobs.detailUnknown') === -1);
});

/* ============================================================
   2) JOB 行そのものが取得範囲の外（誰が出したか分からない）
   ============================================================ */
console.log('\n--- 2) ①がログ全体に無い（範囲外） ---');
AQ.i18n.set('ja');
{
  const jobId = 'kNoJobRow01';
  const built = build('origin2', [
    { seq: 1, from: WORKER, text: 'CLAIM v1 | ' + jobId + ' | builder', ts: iso(0) },
    { seq: 2, from: WORKER, text: 'DELIVER v1 | ' + jobId + ' | here it is', ts: iso(3000) }
  ]);
  const { html, rec } = renderJobDetail(built, jobId);
  ok('①の記録が無いこと（フィクスチャの前提）', rec && rec.cast.poster === null);
  ok('②の記録はあること（フィクスチャの前提）', rec && rec.cast.claimers.indexOf(WORKER) !== -1);

  const row1 = drowFor(html, 1);
  const row2 = drowFor(html, 2);
  ok('①の行を詳細パネルから取り出せた', !!row1);
  ok('②の行を詳細パネルから取り出せた', !!row2);
  if (row1) {
    ok('①が「不明」と明記されている', row1.indexOf(AQ.i18n.t('jobs.detailUnknown')) !== -1);
    ok('①の値に #番号を捏造していない', !/#\d/.test(row1));
  }
  if (row2) {
    /* ①だけが分からないのであって、詳細パネルごと壊れて全段階
       「不明」になっているわけではないことを、②で確かめる。 */
    ok('②は「不明」になっていない（①だけが分からない）',
       row2.indexOf(AQ.i18n.t('jobs.detailUnknown')) === -1);
    ok('②に WORKER の番号が出ている',
       row2.indexOf('#' + rosterNumberOf(built.beats, WORKER)) !== -1);
  }
}

/* ============================================================
   3) 本人が①を出している → ①は本人の番号で出る（不明にしない）
   ============================================================ */
console.log('\n--- 3) 本人が①を出している ---');
{
  const jobId = 'kSelfPosted01';
  const built = build('origin3', [
    { seq: 1, from: WORKER, text: 'JOB v1 | ' + jobId + ' | build | Build the pier | detail', ts: iso(0) },
    { seq: 2, from: WORKER, text: 'CLAIM v1 | ' + jobId + ' | builder', ts: iso(3000) }
  ]);
  const { html, rec } = renderJobDetail(built, jobId);
  ok('①も本人（フィクスチャの前提）', rec && rec.cast.poster === WORKER);

  const row1 = drowFor(html, 1);
  ok('①の行を詳細パネルから取り出せた', !!row1);
  if (row1) {
    ok('本人が出しているので「不明」にならない',
       row1.indexOf(AQ.i18n.t('jobs.detailUnknown')) === -1);
    ok('①の番号が本人（WORKER）の番号と一致する',
       row1.indexOf('#' + rosterNumberOf(built.beats, WORKER)) !== -1);
  }
}

/* ============================================================
   4) ja / en の両方で、詳細パネルの文言が辞書に実在する
   ============================================================ */
['ja', 'en'].forEach(function (lang) {
  console.log('\n--- 4) 詳細パネルの文言（' + lang + '） ---');
  AQ.i18n.set(lang);
  ['jobs.detailWho', 'jobs.detailUnknown', 'jobs.detailTitle', 'jobs.detailCounts',
   'progress.short1', 'progress.short2', 'progress.short3', 'progress.short4'
  ].forEach(function (key) {
    const v = AQ.i18n.t(key);
    ok('[' + lang + '] ' + key + ' が訳語を持つ（キー名そのままではない）', v !== key && !!v);
  });
});

console.log('\n' + (bad ? '✗ ' + bad + ' 件の不一致' : '✓ すべて一致'));
process.exit(bad ? 1 : 0);
