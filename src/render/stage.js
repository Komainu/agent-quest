/* =============================================================
   render/stage.js — 街と部屋のどちらを描くかを決める
   -------------------------------------------------------------
   なぜ画面が2つあるのか
     x402 は「別のサービスに払いに行く」仕組みなので、移動が
     本当に起きる。だから街（scene.js）が正しい絵になる。
     いっぽう掲示板型のログ（technocore.chat の kibble など）は
     全員が同じ1つの部屋にいて、どこにも移動していない。
     それを街で描くと、起きていない移動を描くことになる。
     ＝「分からないことは描かない」に反する。だから部屋（room.js）。

   選び方（下の pick() がすべて）
     ・支払い（payment.*）が1件でもある        → 街
     ・target のホストが2種類以上ある            → 街
     ・それ以外（＝1か所で完結している）        → 部屋
     ・判断材料が無い（空のログ）                → 街（従来どおり）

   手で切り替えたいときは AQ.stage.use('city') / use('room')。
   このファイルは振り分けるだけで、絵は一切描きません。
   ============================================================= */
(function (AQ) {
  'use strict';

  var CITY = 'city', ROOM = 'room';

  var current = CITY;   // いま選ばれている画面
  var forced  = null;   // use() で手動指定されたら、それを優先する
  var canvas  = null;   // init() で受け取ったもの（切り替え時に貼り直す）
  var ready   = {};     // 画面ごとに init() 済みかどうか

  function backend() { return current === ROOM ? AQ.room : AQ.scene; }

  function host(u) {
    try { return String(u).replace(/^[a-z]+:\/\//i, '').split('/')[0]; }
    catch (e) { return ''; }
  }

  /** イベント列（またはコマ列）→ 'city' | 'room' */
  function pick(events) {
    var list = events || [];
    if (!list.length) return CITY;

    var hosts = {}, n = 0;
    for (var i = 0; i < list.length; i++) {
      var e = list[i] || {};
      /* コマ（beat）を渡された場合は代表イベントを見る */
      if (e.lead) e = e.lead;

      if (typeof e.type === 'string' && e.type.indexOf('payment.') === 0) return CITY;
      /* ★ 2026-10-11: 自分のロボットの「一日」は、掲示板だけの日でも街で見せる（activity.js） */
      if (e.meta && e.meta.stage === 'city') return CITY;

      if (e.target) {
        var h = host(e.target);
        if (h && !Object.prototype.hasOwnProperty.call(hosts, h)) {
          hosts[h] = 1;
          if (++n > 1) return CITY;
        }
      }
    }
    return ROOM;
  }

  /* 街と部屋は縦横比が違う（task B で横幅を拡張してからは特に：街 34:16、
     部屋 20:8）。canvas の実サイズは各バックエンドの init() が決めるが、
     CSS 側で「同じ縦の予算でも比率に応じた最大幅まで広げる」を pure CSS
     でやりたいので、いまどちらを描いているかを canvas の data-stage
     属性に反映しておく（css/style.css の #scene[data-stage=...] 参照）。 */
  function syncStageAttr() {
    if (canvas) canvas.dataset.stage = current;
  }

  function ensureInit() {
    if (!canvas) return;
    if (ready[current]) return;
    backend().init(canvas);
    ready[current] = true;
  }

  AQ.stage = {
    CITY: CITY,
    ROOM: ROOM,

    /** いまの画面名。読み取り専用のつもりで使うこと。 */
    get current() { return current; },

    init: function (c) {
      canvas = c;
      ready = {};
      syncStageAttr();
      ensureInit();
    },

    /** 手動で固定する。null を渡すと自動判定に戻る。 */
    use: function (which) {
      forced = (which === CITY || which === ROOM) ? which : null;
      if (forced && forced !== current) { current = forced; syncStageAttr(); ensureInit(); }
      return current;
    },

    /** イベント列から画面を選び直す。main.js が読み込みのたびに呼ぶ。 */
    select: function (events) {
      var next = forced || pick(events);
      if (next !== current) {
        current = next;
        syncStageAttr();
        ensureInit();
      }
      return current;
    },

    /* --- 以下は選ばれた側へそのまま渡すだけ --- */
    prepare: function (beats) { ensureInit(); return backend().prepare(beats); },
    /* ★ 2026-09-28: そのコマで歩くのに要る時間（再生速度1倍のミリ秒）。
       時計（engine/clock.js）がコマの長さを決めるときに使う。部屋だけが持つ。 */
    walkMsFor: function (beat) {
      var be = backend();
      return (be && be.walkMsFor) ? be.walkMsFor(beat) : 0;
    },
    /** 実際に再生するコマ列（絞り込み後）。街には無いので黙って無視する。 */
    setFocusPlan: function (playBeats) {
      var b = backend();
      if (b.setFocusPlan) b.setFocusPlan(playBeats);
    },
    /* ★ focusActor を最後まで渡すこと。ここで落としていたため、
       「1体だけ再生」を選んでもコマ列だけが絞られ、絵には他人が
       並んだままだった（2026-09-04 の報告）。 */
    render: function (beat, p, st, now, beats, index2, focusActor) {
      ensureInit();
      return backend().render(beat, p, st, now, beats, index2, focusActor);
    },
    computeRobotScreenPositions: function (beat, p, beats, index2, focusActor) {
      ensureInit();
      var b = backend();
      return b.computeRobotScreenPositions
           ? b.computeRobotScreenPositions(beat, p, beats, index2, focusActor) : [];
    },
    /** 札クリックの当たり判定。街には札が無いので常に null
        （＝クリックは今までどおり再生の一時停止に使われる）。 */
    hitTestCard: function (x, y, index, focusActor) {
      var b = backend();
      return b.hitTestCard ? b.hitTestCard(x, y, index, focusActor) : null;
    },

    computeCardState: function (index) {
      var b = backend();
      return b.computeCardState ? b.computeCardState(index) : null;
    },

    /* テスト用：描画せずに判定だけしたいとき */
    pick: pick
  };

})(window.AQ = window.AQ || {});
