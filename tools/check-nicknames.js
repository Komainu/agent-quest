/* tools/check-nicknames.js — src/nicknames.js（呼び名）の検証
   使い方:  node tools/check-nicknames.js

   何を守りたいか（nicknames.js の「同じIDは同じ呼び名」「衝突しない」
   「エージェントと依頼は別腹」「言語ごとに閉じている」という約束）を
   検査する。bootstrap は check-jobs-index.js と同じく fs.readFileSync
   + eval（DOM が無い Node の上で、window.AQ を素の AQ に読み替える）。 */
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

let bad = 0;
function ok(label, cond) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) bad++;
}

function isAscii(s) { return /^[\x00-\x7f]+$/.test(s); }
function hasLatinLetter(s) { return /[A-Za-z]/.test(s); }

/* ---- 1) 同じIDは何度呼んでも同じ呼び名 --------------------------- */
console.log('--- 1) 同じIDは何度呼んでも同じ呼び名 ---');
{
  AQ.nick.reset();
  AQ.i18n.set('ja');
  const first = AQ.nick.forActor('agent-det-1');
  let allSame = true;
  for (let i = 0; i < 100; i++) {
    if (AQ.nick.forActor('agent-det-1') !== first) allSame = false;
  }
  ok('100回呼んでも同じ（' + first + '）', allSame && !!first);

  const firstJob = AQ.nick.forJob('job-det-1');
  let allSameJob = true;
  for (let i = 0; i < 100; i++) {
    if (AQ.nick.forJob('job-det-1') !== firstJob) allSameJob = false;
  }
  ok('依頼側も100回呼んで同じ（' + firstJob + '）', allSameJob && !!firstJob);
}

/* ---- 2) 300個の別々のIDで呼び名が重複しない ---------------------- */
console.log('\n--- 2) 300個の別々のIDで重複しない ---');
function checkNoDupes(kind, lang, n) {
  AQ.nick.reset();
  AQ.i18n.set(lang);
  const fn = (kind === 'actor') ? AQ.nick.forActor : AQ.nick.forJob;
  const seen = {};
  let dupes = 0;
  for (let i = 0; i < n; i++) {
    const name = fn.call(AQ.nick, kind + '-bulk-' + i);
    if (Object.prototype.hasOwnProperty.call(seen, name)) dupes++;
    seen[name] = true;
  }
  ok(kind + '/' + lang + ': ' + n + '件で重複' + dupes + '件', dupes === 0);
}
checkNoDupes('actor', 'ja', 300);
checkNoDupes('job', 'ja', 300);
checkNoDupes('actor', 'en', 300);
checkNoDupes('job', 'en', 300);

/* ---- 3) エージェントと依頼のレジストリが別 ------------------------- */
console.log('\n--- 3) エージェントと依頼のレジストリは別 ---');
{
  AQ.nick.reset();
  AQ.i18n.set('ja');
  const idA = AQ.nick.forActor('shared-777');
  const idJ = AQ.nick.forJob('shared-777');
  const idA2 = AQ.nick.forActor('shared-777'); // job を呼んだ後でも変わらないはず
  ok('同じIDでもactor呼び名とjob呼び名は別に決まる（' + idA + ' / ' + idJ + '）', idA !== idJ);
  ok('job を呼んでも actor 側は変わらない', idA === idA2);

  // 片方だけを大量に呼んでも、もう片方の統計・単語消費に影響しない
  AQ.nick.reset();
  for (let i = 0; i < 50; i++) AQ.nick.forActor('only-actor-' + i);
  const stats = AQ.nick.stats();
  ok('actorだけ呼んだ後、jobsの登録は0のまま', stats.jobs === 0 && stats.actors === 50);
}

/* ---- 4) ja=2〜5文字・英字なし／en=3〜8文字・ASCIIのみ --------------- */
console.log('\n--- 4) 文字数と言語の混ざりが無い ---');
{
  function checkShape(kind, lang, n) {
    AQ.nick.reset();
    AQ.i18n.set(lang);
    const fn = (kind === 'actor') ? AQ.nick.forActor : AQ.nick.forJob;
    let good = true;
    let sampleBad = null;
    for (let i = 0; i < n; i++) {
      const name = fn.call(AQ.nick, kind + '-shape-' + i);
      /* ★ 2026-09-14: 呼び名の作り方が2種類になった。
           エージェント … 言葉（ja=カナ2〜5字 / en=英語3〜8字）
           依頼         … ギリシャ文字1字＋衝突時の数字＝1〜3字。
                          日本語・英語で同じ表記（訳さない）。
         実測で、依頼は40件で28%・200件で73%が数字付きになっていた。
         数字が付くのを前提にした体系にしたので、規則もそれに合わせる。 */
      if (kind === 'job') {
        if (!/^[\u03b1-\u03c9][0-9]{0,2}$/.test(name)) { good = false; sampleBad = name; }
      } else {
        /* ★ 2026-10-07: エージェントは動物の呼び名をやめ、ID を短く縮めたもの（ID の一部が残る・12字以内） */
        const id = kind + '-shape-' + i;
        const parts = name.split('…');
        if (name.length > 12 || !parts.every(pp => id.indexOf(pp) !== -1)) { good = false; sampleBad = name; }
      }
    }
    ok(kind + '/' + lang + ' は形の規則を守っている（' + n + '件）' + (good ? '' : '（違反例: ' + sampleBad + '）'), good);
  }
  checkShape('actor', 'ja', 300);
  checkShape('job', 'ja', 300);
  checkShape('actor', 'en', 300);
  checkShape('job', 'en', 300);
}

/* ---- 5) 言語を切り替えて戻すと元の呼び名に戻る --------------------- */
console.log('\n--- 5) 言語を切り替えて戻すと元に戻る ---');
{
  AQ.nick.reset();
  AQ.i18n.set('ja');
  const jaBefore = AQ.nick.forActor('roundtrip-1');
  const jaJobBefore = AQ.nick.forJob('roundtrip-1');
  AQ.i18n.set('en');
  const en1 = AQ.nick.forActor('roundtrip-1');
  const enJob1 = AQ.nick.forJob('roundtrip-1');
  AQ.i18n.set('ja');
  const jaAfter = AQ.nick.forActor('roundtrip-1');
  const jaJobAfter = AQ.nick.forJob('roundtrip-1');
  ok('actor: ja→en→ja で元の呼び名に戻る（' + jaBefore + '）', jaBefore === jaAfter && !!jaBefore);
  ok('job: ja→en→ja で元の呼び名に戻る（' + jaJobBefore + '）', jaJobBefore === jaJobAfter && !!jaJobBefore);
  /* ★ 2026-09-14: 依頼はギリシャ文字になり、訳さないので ja と en で
     同じ表記になる（それが取り柄）。「別物であること」を求めるのは
     エージェントだけ。依頼側は下の 8) で「同じであること」を見る。 */
  ok('actor は ja と en で同じ（ID を縮めたもの・2026-10-07）（' + jaBefore + ' / ' + en1 + '）', jaBefore === en1);
  ok('job は ja と en で同じ表記（' + jaJobBefore + ' / ' + enJob1 + '）', jaJobBefore === enJob1);
}

/* ---- 6) reset() の後は登録が空になる ------------------------------ */
console.log('\n--- 6) reset() で登録が空になる ---');
{
  AQ.nick.reset();
  AQ.nick.forActor('x1');
  AQ.nick.forActor('x2');
  AQ.nick.forJob('y1');
  const before = AQ.nick.stats();
  ok('reset前は空でない', before.actors === 2 && before.jobs === 1);
  AQ.nick.reset();
  const after = AQ.nick.stats();
  ok('reset後はactors===0・jobs===0', after.actors === 0 && after.jobs === 0);
}

/* ---- 7) null / undefined / '' でも空文字を返さない ----------------- */
console.log('\n--- 7) null/undefined/空文字でも空文字を返さない ---');
{
  AQ.nick.reset();
  AQ.i18n.set('ja');
  const vals = [
    ['actor null', AQ.nick.forActor(null)],
    ['actor undefined', AQ.nick.forActor(undefined)],
    ['actor 空文字', AQ.nick.forActor('')],
    ['job null', AQ.nick.forJob(null)],
    ['job undefined', AQ.nick.forJob(undefined)],
    ['job 空文字', AQ.nick.forJob('')]
  ];
  vals.forEach(function (pair) {
    ok(pair[0] + ' → 空文字ではない（"' + pair[1] + '"）', typeof pair[1] === 'string' && pair[1].length > 0);
  });
  // 呼び出しても登録は消費しない
  const stats = AQ.nick.stats();
  ok('null/undefined/空文字は登録を消費していない', stats.actors === 0 && stats.jobs === 0);
}

/* ---- 8) 単語リストが4つとも48語以上・重複無し ----------------------- */
console.log('\n--- 8) 単語リストの語数と重複 ---');
{
  // nicknames.js 内部のクロージャは覗けないので、生成される呼び名の
  // 「素の単語（数字が付く前の形）」を大量のIDから逆に集めて検証する。
  function collectBaseWords(kind, lang, n) {
    AQ.nick.reset();
    AQ.i18n.set(lang);
    const fn = (kind === 'actor') ? AQ.nick.forActor : AQ.nick.forJob;
    const bases = {};
    for (let i = 0; i < n; i++) {
      const name = fn.call(AQ.nick, kind + '-vocab-' + i + '-' + lang);
      const base = name.replace(/[0-9]+$/, '');
      bases[base] = true;
    }
    return Object.keys(bases);
  }
  ['ja', 'en'].forEach(function (lang) {
    ['job'].forEach(function (kind) {   // エージェントは単語リストを使わなくなった（2026-10-07）
      const bases = collectBaseWords(kind, lang, 2000);
      const uniq = {};
      let dup = false;
      bases.forEach(function (w) { if (uniq[w]) dup = true; uniq[w] = true; });
      /* 依頼はギリシャ文字（ο と ι を除いた22字）なので、語数の下限は別。 */
      var least = (kind === 'job') ? 20 : 48;
      ok(kind + '/' + lang + ' の見出し語は' + least + '以上見つかる（実測 ' + bases.length + '）',
         bases.length >= least);
      ok(kind + '/' + lang + ' の単語リストに重複が無い', !dup);
    });
  });
}

/* ---- 8) 依頼の呼び名は言語で変わらない（2026-09-14）-----------------
   ギリシャ文字は訳さないので、日本語と英語で同じ表記になる。
   言語を切り替えても「さっき見ていた依頼」を見失わない、という取り柄。 */
console.log('\n--- 8) 依頼の呼び名は言語で変わらない ---');
{
  AQ.nick.reset();
  AQ.i18n.set('ja');
  const ja = [];
  for (let i = 0; i < 30; i++) ja.push(AQ.nick.forJob('same-lang-' + i));
  AQ.i18n.set('en');
  const en = [];
  for (let i = 0; i < 30; i++) en.push(AQ.nick.forJob('same-lang-' + i));
  const allSame = ja.every((v, i) => v === en[i]);
  ok('30件すべて ja と en で同じ呼び名（例 ' + ja[0] + '）', allSame);
  /* ★ 2026-10-07: エージェントは ID を縮めたもの＝言語で変わらない */
  AQ.nick.reset();
  AQ.i18n.set('ja');
  const aJa = AQ.nick.forActor('lang-actor-1');
  AQ.i18n.set('en');
  const aEn = AQ.nick.forActor('lang-actor-1');
  ok('エージェントは言語で変わらない（' + aJa + ' / ' + aEn + '）', aJa === aEn);
  ok('did:key は先頭6文字…末尾4文字に縮める', AQ.nick.forActor('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK') === 'z6Mkha…2doK');
  ok('動物の名前を付けない', !/[\u30a0-\u30ff]/.test(AQ.nick.forActor('did:key:zAbcdef123456')));
  AQ.i18n.set('ja');
}

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
