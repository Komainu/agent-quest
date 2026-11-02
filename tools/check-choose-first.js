/* tools/check-choose-first.js — task 1 の検証ハーネス（フェイクDOM）
   使い方:  node tools/check-choose-first.js

   「接続するといきなりロボットが動いている」「一連の挙動が終わると
   いきなり次のロボットが動きはじめる」という報告への対応を、
   src/main.js の実際の起動経路（boot → AQ.app.tryLoad → applyFocus →
   clock.play）に沿って検査する。ブラウザが無いので、この場に必要な
   最小限だけを備えた「フェイクDOM」を用意し、requestAnimationFrame は
   自分でコールバックを握っておいて、任意の経過時間で1回だけ呼び出す
   ことで「1体ぶんの再生を最後まで早送りする」を実現する
   （clock.js の loop() は1回の呼び出しで elapsed が尽きるまで
   何コマでも一気に進める作りなので、じゅうぶん大きな dt を1回
   与えれば「そのエージェントの最後のコマ」まで到達し、そこで
   自動的に pause() される）。

   検査すること:
     1) 読み込み直後（tryLoad 直後）: focusActor は null、hasChosen は
        false、clock.playing は false、clock.beats はログ全体
       （focus されていない状態）。
     2) 名簿から1体を選ぶのと同じ経路（AQ.app.focusOn）を呼んだ瞬間:
        focusActor がその1体になり、hasChosen が true になり、
        clock.beats がその1体のコマだけになり、再生が始まる
       （clock.playing === true）。
     3) その1体の最後のコマまで早送りすると、そこで自動的に止まり
       （clock.playing === false）、他のエージェントへは絶対に
        移らない（clock.beats は絞り込んだ後のままの長さ・中身）。
        実況欄（el.win）にも「#N の記録はここまでです」の文言が
        出ていることを確認する（内部状態だけでなく、実際に画面に
        出る文言まで確認する）。
     4) 「すべて表示」（AQ.app.focusClear）を呼べば、focusActor が
        null に戻り、clock.beats がログ全体に戻ることを確認する
       （逃げ道が塞がれていないか）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ---------------- フェイクDOM ---------------- */

function makeClassList() {
  const set = new Set();
  return {
    add: function () { for (const c of arguments) set.add(c); },
    remove: function () { for (const c of arguments) set.delete(c); },
    toggle: function (c, force) {
      if (force === undefined) { if (set.has(c)) set.delete(c); else set.add(c); }
      else if (force) set.add(c); else set.delete(c);
    },
    contains: function (c) { return set.has(c); }
  };
}

/* canvas の 2D コンテキストのフェイク。呼ばれたら何でも黙って受け取る
   （描画の正しさはここでは検査しない。純粋な計算関数は各 tools/check-*.js
   が別途、canvas に触れずに検査している）。 */
function makeFakeGradient() {
  return { addColorStop: function () {} };
}

function makeFakeCtx() {
  const store = {};
  return new Proxy(store, {
    get: function (target, prop) {
      if (prop === 'measureText') {
        return function (text) { return { width: String(text == null ? '' : text).length * 6 }; };
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return function () { return makeFakeGradient(); };
      }
      if (prop === 'getImageData') {
        return function () { return { data: [] }; };
      }
      if (prop === 'canvas') return { width: 0, height: 0 };
      if (prop in target) return target[prop];
      return function () { return makeFakeCtx.NOOP; };
    },
    set: function (target, prop, value) { target[prop] = value; return true; }
  });
}
makeFakeCtx.NOOP = undefined;

function makeEl(tag, id) {
  const listeners = {};
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: id || '',
    children: [],
    options: [],
    style: {},
    dataset: {},
    attrs: {},
    hidden: false,
    disabled: false,
    value: '',
    _innerHTML: ''
  };
  el.classList = makeClassList();
  el.appendChild = function (child) {
    el.children.push(child);
    child.parentNode = el;
    if (child.tagName === 'OPTION') el.options.push(child);
    return child;
  };
  el.setAttribute = function (name, v) { el.attrs[name] = String(v); };
  el.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
  };
  el.addEventListener = function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); };
  el.removeEventListener = function (type, fn) {
    if (listeners[type]) listeners[type] = listeners[type].filter(function (f) { return f !== fn; });
  };
  el._fire = function (type, ev) {
    (listeners[type] || []).forEach(function (fn) { fn(ev || { type: type, target: el, preventDefault: function () {} }); });
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._innerHTML; },
    set: function (v) { el._innerHTML = String(v); }
  });
  el.getContext = function () { if (!el._ctx) el._ctx = makeFakeCtx(); return el._ctx; };
  el.toDataURL = function () { return ''; };
  el.focus = function () {};
  el.blur = function () {};
  el.closest = function () { return null; };
  el.querySelectorAll = function () { return []; };
  el.remove = function () {};
  return el;
}

const elCache = {};
const docListeners = {};
global.document = {
  documentElement: makeEl('html'),
  activeElement: null,
  getElementById: function (id) {
    if (!elCache[id]) elCache[id] = makeEl('div', id);
    return elCache[id];
  },
  createElement: function (tag) { return makeEl(tag); },
  addEventListener: function (type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener: function () {}
};
global.window = global;
global.addEventListener = function () {};
global.devicePixelRatio = 1;

let pendingRAF = null;
global.requestAnimationFrame = function (cb) { pendingRAF = cb; return 1; };
global.cancelAnimationFrame = function () { pendingRAF = null; };
/* Node には既定で performance.now() がある（シム不要）。 */

/* ---------------- AQ を組み立てる（index.html と同じ順番） ---------------- */
const AQ = {};
function load(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  eval(src.replace('window.AQ = window.AQ || {}', 'AQ'));
}
[
  'src/config.js', 'src/i18n.js', 'src/sprites.js',
  'data/world.js', 'data/room.js', 'data/chains.js',
  'src/engine/roster.js', 'src/engine/questlog.js', 'src/engine/aggregate.js',
  'src/engine/state.js', 'src/engine/clock.js', 'src/engine/path.js', 'src/engine/live.js',
  'src/render/tiles.js', 'src/render/props.js', 'src/render/scene.js', 'src/render/room.js',
  'src/render/stage.js', 'src/render/hud.js',
  'src/adapters/fromX402.js', 'src/adapters/fromTransfers.js', 'src/adapters/fromTechnocore.js',
  'src/adapters/fromKibble.js', 'src/adapters/fromChain.js', 'src/adapters/detect.js',
  'data/runs/basic.js', 'data/runs/failure.js', 'data/runs/burst.js', 'data/runs/team.js',
  'src/main.js'
].forEach(load);

let bad = 0;
function ok(label, cond) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) bad++;
}

/* ---------------- 起動する（index.html の DOMContentLoaded と同じ） ---------------- */
(docListeners['DOMContentLoaded'] || []).forEach(function (fn) { fn(); });

/* ---------------- フィクスチャ：2体のエージェント ---------------- */
function iso(msOffset) { return new Date(1758300000000 + msOffset).toISOString(); }
const messages = [];
let seq = 1, t = 0;
function push(from, text) {
  messages.push({ seq: seq++, from: from, text: text, ts: iso(t) });
  t += 200;
}
// agent-A: 2件を自分で出して・引き受けて・納品する。
push('agent-A', 'JOB v1 | jA1 | build | A の依頼1 | detail');
push('agent-A', 'CLAIM v1 | jA1 | builder');
push('agent-A', 'DELIVER v1 | jA1 | 納品物1');
push('agent-A', 'JOB v1 | jA2 | build | A の依頼2 | detail');
push('agent-A', 'CLAIM v1 | jA2 | builder');
push('agent-A', 'DELIVER v1 | jA2 | 納品物2');
// agent-B: 同様に1件。
push('agent-B', 'JOB v1 | jB1 | research | B の依頼1 | detail');
push('agent-B', 'CLAIM v1 | jB1 | builder');
push('agent-B', 'DELIVER v1 | jB1 | 納品物B1');

const raw = JSON.stringify({ room: 'kibble', messages: messages });

/* ---------------- 1) 読み込み直後：何も選ばれていない・何も動いていない ---------------- */
console.log('\n--- 1) 読み込み直後（tryLoad 直後）は何も選ばれていない ---');
AQ.app.tryLoad(raw);

ok('focusActor は null（誰も選んでいない）', AQ.app.focusActor === null);
ok('hasChosen は false（まだ選んでいないことを示すフラグ）', AQ.app.hasChosen === false);
ok('clock.playing は false（何も動いていない）', AQ.app.clock.playing === false);
ok('clock.beats はログ全体（フィルタされていない）',
  AQ.app.clock.beats.length === AQ.app.beats.length && AQ.app.clock.beats.length > 0);

const distinctActors = Array.from(new Set(AQ.app.beats.map(function (b) { return String(b.actor); })));
ok('フィクスチャに agent-A と agent-B の両方が含まれている（本題の前提）',
  distinctActors.indexOf('agent-A') !== -1 && distinctActors.indexOf('agent-B') !== -1);

/* ---------------- 2) 名簿から1体を選ぶ（実クリックと同じ経路） ---------------- */
console.log('\n--- 2) agent-A を選ぶと、その瞬間に絞り込まれ・再生が始まる ---');
AQ.app.focusOn('agent-A');

ok('focusActor が agent-A になった', AQ.app.focusActor === 'agent-A');
ok('hasChosen が true になった', AQ.app.hasChosen === true);
const beatsAfterFocus = AQ.app.clock.beats;
ok('clock.beats が agent-A のコマだけになった（' + beatsAfterFocus.length + '件）',
  beatsAfterFocus.length > 0 && beatsAfterFocus.every(function (b) { return String(b.actor) === 'agent-A'; }));
ok('clock.beats はログ全体より少ない（本当に絞られている）',
  beatsAfterFocus.length < AQ.app.beats.length);
ok('選んだ瞬間に再生が始まっている（clock.playing === true）', AQ.app.clock.playing === true);

/* ---------------- 3) 早送りして、agent-A の最後のコマで止まることを確認 ---------------- */
console.log('\n--- 3) agent-A のコマが尽きたらそこで止まる（他エージェントへは移らない） ---');
ok('requestAnimationFrame にコールバックが積まれている（早送りの準備ができている）', !!pendingRAF);
/* 2026-09-28: 時計は1フレームで進める時間に上限がある（固まったあとに
   一気に進めて暴走しないように）。以前の「巨大な dt を1回だけ」では
   最後まで進まないので、フレームを何度も回して早送りする。 */
{
  let t = performance.now(), guard = 0;
  while (pendingRAF && guard++ < 200000) {
    const cb = pendingRAF;
    pendingRAF = null;
    t += 50;
    cb(t);
  }
}
ok('clock.playing が false に戻った（最後のコマで自動的に止まった）', AQ.app.clock.playing === false);
ok('clock.index が agent-A の最後のコマを指している',
  AQ.app.clock.index === AQ.app.clock.beats.length - 1);
ok('止まったあとも clock.beats は agent-A だけのまま（他人のコマが混ざっていない）',
  AQ.app.clock.beats.every(function (b) { return String(b.actor) === 'agent-A'; }));
ok('止まったあとも requestAnimationFrame は積まれていない（次の誰かへ勝手に進む仕組みが無い）',
  pendingRAF === null);

const winHtml = document.getElementById('win').innerHTML;
ok('実況欄に「記録はここまで」の文言が出ている（内部状態だけでなく画面表示でも確認）',
  winHtml.indexOf(AQ.i18n.t('ui.actorEnded', { n: ' MARK ' }).split(' MARK ')[0]) !== -1
  || /記録はここまで|end of #.*recorded actions/i.test(winHtml));

/* ---------------- 4)「すべて表示」で全員ぶんに戻せる ---------------- */
console.log('\n--- 4) 「すべて表示」は今までどおり効く ---');
AQ.app.focusClear();
ok('focusActor が null に戻った（すべて表示）', AQ.app.focusActor === null);
ok('clock.beats がログ全体に戻った', AQ.app.clock.beats.length === AQ.app.beats.length);

console.log(bad ? ('\n✗ ' + bad + ' 件の問題') : '\n✓ すべて合格');
process.exit(bad ? 1 : 0);
