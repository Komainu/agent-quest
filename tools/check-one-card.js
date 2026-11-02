/* tools/check-one-card.js — 仕事札は依頼ごとに1枚（2026-10-21 利用者の要望）
   使い方:  node tools/check-one-card.js
   「同じ仕事の内容の札がたくさん出てくるのは混乱のもと。仕事札は一つにして」
   1件の依頼を4体が引き受けて納品し、検品役が判定する流れで、
   板・納品口・検品台に置かれる札が、どのコマでもその依頼について1枚以下であることを確かめる。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const AQ = {};
function load(rel) { eval(fs.readFileSync(path.join(ROOT, rel), 'utf8').replace('window.AQ = window.AQ || {}', 'AQ')); }
['src/config.js', 'src/i18n.js', 'src/engine/path.js', 'data/room.js', 'src/render/room.js', 'src/engine/questlog.js', 'src/engine/aggregate.js', 'src/adapters/fromKibble.js'].forEach(load);
let bad = 0;
function ok(label, cond) { console.log((cond ? '✓ ' : '✗ ') + label); if (!cond) bad++; }
const messages = []; let seq = 1, t = 0;
function push(from, text) { messages.push({ seq: seq++, from, text, ts: new Date(1758300000000 + t).toISOString() }); t += 200; }
const J = 'kOneJob01';
push('agent-boss', 'JOB v1 | ' + J + ' | explain | What is ERC-8004? | detail');
['w1', 'w2', 'w3', 'w4'].forEach(function (w) { push('agent-' + w, 'CLAIM v1 | ' + J + ' | builder'); });
['w1', 'w2', 'w3', 'w4'].forEach(function (w, i) { push('agent-' + w, 'DELIVER v1 | ' + J + ' | answer ' + i); });
push('agent-judge', 'ATTEST v1 | ' + J + ' | useful | good');
const beats = AQ.aggregate.toBeats(AQ.questlog.load(AQ.adapters.fromKibble(messages, { room: 'kibble', observedAt: t + 1000 }))).beats;
AQ.room.init({ getContext: function () { return {}; }, width: 0, height: 0 });
AQ.room.prepare(beats);
let worst = 0, worstAt = -1;
for (let i = 0; i < beats.length; i++) {
  const n = AQ.room.computeBoardLayout(i, null).count + AQ.room.computeDropoffLayout(i, null).count + AQ.room.computeInspectLayout(i, null).count;
  if (n > worst) { worst = n; worstAt = i; }
}
ok('4体が納品しても、板・納品口・検品台にあるこの依頼の札は、どのコマでも1枚まで（最大 ' + worst + ' 枚・コマ ' + worstAt + '）', worst === 1);
const last = beats.length - 1;
ok('判定のあとは、検品台に1枚だけ（納品口は 0）', AQ.room.computeInspectLayout(last, null).count === 1 && AQ.room.computeDropoffLayout(last, null).count === 0);
console.log(bad ? '✗ ' + bad + ' 件' : '✓ すべて OK');
process.exit(bad ? 1 : 0);
