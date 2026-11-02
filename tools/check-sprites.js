/* tools/check-sprites.js — ベクター図形（sprites.js）の検証ハーネス
   使い方:  node tools/check-sprites.js

   2026-09-06: ドット絵グリッドのパス検証から、ベクター図形（パスで
   描く drawFigure）の検証に作り直した。実物の <canvas> が無い Node
   から検証するため、canvas 2D コンテキストのメソッド呼び出し・
   プロパティ代入をすべて記録するだけのモック（Proxy）を使い、
   「同じ actor なら毎回まったく同じ描画命令列になるか（決定的）」
   「別の actor なら描画命令列が十分に違うか（多様性）」を検査する。

   1) AQ.sprites.traitsFor(actor) が6個・各0〜3の範囲の配列を返す。
   2) AQ.sprites.figureFor(actor) が traitsFor と矛盾しない名前つき
      オブジェクトを返す（antenna/head/body/tread/cargo/accent）。
   3) AQ.sprites.drawFigure(ctx, fig, x, y, w, h, dir, palette) が
      24体×4方向のどれでも例外を投げない。
   4) 同じ actor に2回 drawFigure しても、描画命令列が完全に一致する
      （決定的）。
   5) 24体のうち、見た目（down方向の描画命令列）が重複しないものが
      少なくとも20種類ある。
   6) 先頭8体は、どの2体を選んでも描画命令列が十分に違う
     （「1か所だけ違う」を多様性と呼ばない、という基準）。 */
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

let bad = 0;
function ok(label, cond) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) bad++;
}

/* 「実在のDIDらしい」24個（check-features.js / 旧 check-sprites.js と同じ発想）。 */
const DIDS = [
  'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  'did:key:z6MkfriQ1MnmXbcmTMFqhWNAiSJKS3yZjTBB8ZoK4gg8y2N7',
  'did:key:z6MkuKENirsRt6z3D5S2FLNZSCTfW3jY5PjHVBHzuJPZ2Kt3',
  'did:key:z6MktvqCyLxffV6rgjJ38h9dS9dNa9tQzeaWobkeCe1RVWvz',
  'did:key:z6MkjkT1YZuBB92wKzc7CisdCPZ7XQSY1yjBaTQFGGxpsCFH',
  'did:key:z6MkpTHR8VNsBjYAX9fCsCiuek77VYVpz3Q99sBpvJcQnCsG',
  'did:key:z6MkvVGjhbYPqUhVaJgxKS6xhqhX8XVK7EVzXvzZzhqYQwce',
  'did:key:z6MkqzHRuGxHqZ8gN4jvQP7c8zQ8kzKfWSy5v2NuKq3zvGYd',
  'scout-01', 'sage-02', 'smith-03', 'kibble-agent-nova',
  'kibble-agent-lyra', 'kibble-agent-orin', 'kibble-agent-vela',
  'kibble-agent-juno', 'kibble-agent-atlas', 'kibble-agent-echo',
  'kibble-agent-flint', 'kibble-agent-marlow', 'kibble-agent-pike',
  '0x8f3c2e91aa77bb6601', '0x21ff004488cc33aa02', 'operator-bot-7'
];
if (DIDS.length !== 24) throw new Error('テストの前提が崩れています（DIDは24個のはず）');

/* ---- canvas 2D コンテキストの記録モック（Proxy） ----
   drawFigure はプロパティの代入（fillStyle= など）とメソッド呼び出し
   （fillRect() など）しかしない（読み出しはしない）ので、
   「呼ばれたら記録して返すだけ」の Proxy で十分。 */
function round(n) { return Math.round(n * 1000) / 1000; }
function makeMockCtx() {
  const log = [];
  const gradientHandler = {
    addColorStop: function (offset, color) { log.push(['stop', round(offset), color]); }
  };
  const target = {};
  return new Proxy(target, {
    get: function (_t, prop) {
      if (prop === '__log') return log;
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return function () {
          log.push([String(prop), Array.prototype.slice.call(arguments).map(function (a) {
            return typeof a === 'number' ? round(a) : a;
          })]);
          return gradientHandler;
        };
      }
      return function () {
        const args = Array.prototype.slice.call(arguments).map(function (a) {
          return typeof a === 'number' ? round(a) : a;
        });
        log.push([String(prop), args]);
      };
    },
    set: function (t, prop, value) {
      log.push(['set:' + String(prop), typeof value === 'number' ? round(value) : value]);
      t[prop] = value;
      return true;
    }
  });
}

const PAL = AQ.config.palette;
const W = 100, H = 125;   // 任意の箱サイズ（見た目のスケールは呼び出し側の自由）

console.log('--- 1) traitsFor: 6個・各0〜3の範囲 ---');
let rangeBad = false;
DIDS.forEach(function (d) {
  const t = AQ.sprites.traitsFor(d);
  if (!Array.isArray(t) || t.length !== 6) rangeBad = true;
  t.forEach(function (v) { if (!(v >= 0 && v <= 3 && Number.isInteger(v))) rangeBad = true; });
});
ok('24体すべて traitsFor が6個・整数0〜3の配列', !rangeBad);

console.log('\n--- 2) figureFor が traitsFor と矛盾しない ---');
const TRAIT_KEYS = ['antenna', 'head', 'body', 'tread', 'cargo', 'accent'];
let figureBad = false;
DIDS.forEach(function (d) {
  const t = AQ.sprites.traitsFor(d);
  const f = AQ.sprites.figureFor(d);
  TRAIT_KEYS.forEach(function (k, i) { if (f[k] !== t[i]) figureBad = true; });
});
ok('24体すべて figureFor(actor) の6フィールドが traitsFor(actor) と同じ値', !figureBad);

console.log('\n--- 3) drawFigure が24体×4方向で例外を投げない ---');
let threw = null;
const DIRS = ['down', 'up', 'left', 'right'];
DIDS.forEach(function (d) {
  const fig = AQ.sprites.figureFor(d);
  DIRS.forEach(function (dir) {
    try {
      AQ.sprites.drawFigure(makeMockCtx(), fig, 0, 0, W, H, dir, PAL);
    } catch (e) { threw = threw || (d + '/' + dir + ': ' + e.message); }
  });
});
ok('例外なし' + (threw ? '（最初の例外: ' + threw + '）' : ''), !threw);

console.log('\n--- 4) 決定性：同じ actor に2回描いても命令列が完全一致 ---');
let deterministic = true;
DIDS.forEach(function (d) {
  const fig = AQ.sprites.figureFor(d);
  const c1 = makeMockCtx(); AQ.sprites.drawFigure(c1, fig, 3, 4, W, H, 'down', PAL);
  const c2 = makeMockCtx(); AQ.sprites.drawFigure(c2, fig, 3, 4, W, H, 'down', PAL);
  if (JSON.stringify(c1.__log) !== JSON.stringify(c2.__log)) deterministic = false;
});
ok('同じ actor に2回 drawFigure しても同じ命令列（決定的）', deterministic);

console.log('\n--- 5)〜6) 多様性 ---');
const fingerprints = DIDS.map(function (d) {
  const fig = AQ.sprites.figureFor(d);
  const c = makeMockCtx();
  AQ.sprites.drawFigure(c, fig, 0, 0, W, H, 'down', PAL);
  return JSON.stringify(c.__log);
});
const distinct = new Set(fingerprints).size;
console.log('  24個中、見た目（down の描画命令列）が異なるもの: ' + distinct + '種類');
ok('見た目が異なるものが20種類以上ある', distinct >= 20);

/* 「視覚的に別物」の基準: 先頭8体は、どの2体を選んでも描画命令列の
   要素が十分に違う（配列を要素ごとに比べ、異なる要素の数を数える）。 */
function logDiff(a, b) {
  const la = JSON.parse(a), lb = JSON.parse(b);
  const n = Math.max(la.length, lb.length);
  let d = Math.abs(la.length - lb.length);
  for (let i = 0; i < Math.min(la.length, lb.length); i++) {
    if (JSON.stringify(la[i]) !== JSON.stringify(lb[i])) d++;
  }
  return d;
}
let minDiff = Infinity, minPair = null;
for (let i = 0; i < 8; i++) {
  for (let j = i + 1; j < 8; j++) {
    const d = logDiff(fingerprints[i], fingerprints[j]);
    if (d < minDiff) { minDiff = d; minPair = [i, j]; }
  }
}
console.log('  先頭8体の中で最も似ている組: ' + DIDS[minPair[0]] + ' / ' + DIDS[minPair[1]] + '（差 ' + minDiff + ' 命令）');
ok('先頭8体は、どの2体も描画命令列が10命令以上違う', minDiff >= 10);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
