/* まとめたコマに、別々の依頼のイベントが混ざっていないことを検査する。
   混ざると、見出しには代表イベント1件ぶんの題名しか出せず（他の依頼の
   話が消える）、①〜④の進み具合も「どの依頼か」決められず消えてしまう。
   利用者から「フローが消える」「急に別の依頼に変わる」と報告された症状の
   再発防止。 */
const fs = require('fs');
global.window = {};
['src/config.js','src/i18n.js','src/engine/questlog.js','src/engine/aggregate.js']
  .forEach(f => eval(fs.readFileSync(__dirname + '/../' + f, 'utf8')));
const AQ = window.AQ;

let bad = 0;
function ok(msg, cond) { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) bad++; }

/* 同じ依頼の連続した書き込み（＝まとまる）を、依頼を変えながら
   何ブロックか並べる。実際の kibble もこう来る。
   1コマの中に2つ以上の依頼が入っていたら失敗。 */
const ev = [];
for (let i = 0; i < 30; i++) {
  ev.push({ v:1, run:'r', t: 1.7e12 + i*100, actor:'a',
            type: (i % 2) ? 'result.ok' : 'tool.call',
            target:'https://technocore.chat/r/kibble',
            meta: { job: 'job' + Math.floor(i / 5), kind: 'research' } });
}
const agg = AQ.aggregate.toBeats(AQ.questlog.load(ev));

let mixed = 0, batches = 0;
agg.beats.forEach(function (b) {
  const jobs = {};
  (b.events || []).forEach(function (e) { jobs[(e.meta || {}).job] = 1; });
  if ((b.events || []).length > 1) batches++;
  if (Object.keys(jobs).length > 1) mixed++;
});
/* ★ 2026-10-08: 依頼の出来事（CLAIM・DELIVER など）は束ねない形にした
   （1件ずつが札を動かす別々の動作なので）。束ねてはいけない。 */
ok('依頼の出来事は1件ずつのコマ（束ねたコマ=' + batches + '）', batches === 0);

/* 依頼の無い書き込みは、今までどおり束ねる */
const ev2 = [];
for (let i = 0; i < 12; i++) ev2.push({ v:1, run:'r', t: 1.7e12 + i*100, actor:'a', type: (i % 2) ? 'result.ok' : 'tool.call',
  target:'https://technocore.chat/r/kibble', meta: {} });
const agg2 = AQ.aggregate.toBeats(AQ.questlog.load(ev2));
ok('依頼の無い書き込みは束ねる（' + agg2.beats.filter(b => (b.events || []).length > 1).length + ' 束）',
   agg2.beats.some(b => (b.events || []).length > 1));
ok('どのコマにも複数の依頼が混ざっていない（mixed=' + mixed + '）', mixed === 0);

/* イベントは1件も落ちていないこと（間引くのは描画だけ、が原則） */
let total = 0;
agg.beats.forEach(function (b) { total += (b.events || []).length; });
ok('イベントを1件も落としていない（' + total + ' / ' + ev.length + '）', total === ev.length);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
