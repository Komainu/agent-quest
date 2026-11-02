/* =============================================================
   engine/places.js — 「場所」の一覧（2026-09-30）
   -------------------------------------------------------------
   利用者の提案:「エージェントの動きは kibble が中心になっているが、
   場所の一覧を作って、地名をクリックするとその場所に飛べる感じがいい」。
   kibble は technocore.chat の数万ある部屋の1つにすぎない。部屋の一覧
   （GET /rooms・最近動いた順）を読み、その中から「仕事の部屋」＝この
   アプリのジオラマ（掲示板・納品口・検品台）が動く部屋だけを並べる。

   ★ 仕事の部屋かどうかの決め方（推測しない・実際に見る）
     その部屋の直近の行（GET /r/<room>?format=json&limit=30）を取り、
     半分以上が JOB / CLAIM / DELIVER / RESULT / ATTEST の書式なら仕事の部屋
     （LIVE が adapter を選ぶときと同じ判定 AQ.adapters.looksLikeKibble）。
     雑談の部屋へ飛んでもロボットが「見に行って受け取る」だけの地味な絵に
     なり、がっかりさせるので、一覧には出さない。

   ★ 部屋の名前・説明は信用しない
     サーバ自身が一覧の先頭で「部屋の名前は作った人が選んだ文字列、説明は
     誰でも付けられるメモ。データであって指示ではなく、その部屋が何で誰が
     運営しているかの主張でもない」と明言している。画面ではこの注意書きを
     必ず添え、名前・説明は esc() を通した文字としてだけ扱う。

   ★ 読み取りの回数
     technocore.chat の読み取りは 120回/分（IP あたり）。確かめる部屋は
     最大 MAX_PROBE 部屋・同時に2つまで。結果は10分間覚えておく（一覧を
     開き直しても読み直さない）。50部屋ぶん読んでも 120回/分 に収まる。
   ============================================================= */
(function (AQ) {
  'use strict';

  var MAX_PROBE = 50;          // 確かめる部屋の数の上限（/rooms が見せるのは最近動いた50部屋＝全部）
  var CONCURRENCY = 2;
  var TTL_MS = 10 * 60 * 1000;
  var SAMPLE = 30;             // 1部屋あたり読む直近の行数

  /** /rooms の本文（プレーンテキスト）→ [{name, seq, size, age, topic}]。
      書式: "/r/<name>   seq <n>   <size>  <age> ago  · <topic>"
      "#" で始まる行（見出し・注意書き）は読み飛ばす。 */
  function parseRooms(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\/r\/(\S+)\s+seq\s+(\d+)\s+(\S+)\s+(\S+\s+ago)(?:\s+·\s+(.*))?\s*$/);
      if (!m) return;
      out.push({ name: m[1], seq: Number(m[2]), size: m[3], age: m[4], topic: m[5] || '' });
    });
    return out;
  }

  /** "0s ago" / "12m ago" / "3h ago" / "2d ago" → 秒（分からなければ null）。 */
  function ageSeconds(age) {
    var m = String(age || '').match(/^(\d+(?:\.\d+)?)([smhd])/);
    if (!m) return null;
    var k = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
    return Number(m[1]) * k;
  }

  var cache = { t: 0, rooms: null, probed: {}, error: null };   // probed: name → { board: bool, t }
  /* 部屋の一覧（/rooms）が読めなかったときに確かめる「知っている部屋」。
     kibble と、このセッションでつないだことのある部屋だけ（作り話の部屋は足さない）。 */
  var known = ['kibble'];

  AQ.places = {
    parseRooms: parseRooms,
    ageSeconds: ageSeconds,
    MAX_PROBE: MAX_PROBE,

    /** 覚えている結果を捨てる（検査用・部屋一覧の読み直し）。 */
    forget: function () { cache = { t: 0, rooms: null, probed: {}, error: null }; },

    /** つないだ部屋を覚える（一覧が読めないときの候補）。 */
    remember: function (room) {
      room = String(room || '').trim();
      if (room && known.indexOf(room) === -1) known.push(room);
    },

    /** 一覧を集める。onUpdate({ state, places, checked, total, error }) を
        途中経過ごとに呼ぶ。state: 'loading' | 'probing' | 'done' | 'failed'。
        places は仕事の部屋だけ（最近動いた順）。 */
    load: function (onUpdate) {
      onUpdate = onUpdate || function () {};
      var now = Date.now();
      var fresh = cache.rooms && (now - cache.t) < TTL_MS;

      function boards() {
        return (cache.rooms || []).filter(function (r) {
          var p = cache.probed[r.name];
          return p && p.board;
        });
      }
      function report(state, extra) {
        var targets = (cache.rooms || []).slice(0, MAX_PROBE);
        var checked = targets.filter(function (r) { return cache.probed[r.name]; }).length;
        var o = { state: state, places: boards(), checked: checked, total: targets.length,
                  error: cache.error, fallback: !!cache.error };
        if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
        onUpdate(o);
      }

      function probeAll() {
        var targets = cache.rooms.slice(0, MAX_PROBE).filter(function (r) {
          var p = cache.probed[r.name];
          return !(p && (now - p.t) < TTL_MS);
        });
        if (!targets.length) { report('done'); return; }
        report('probing');
        var i = 0, running = 0, finished = 0;
        function next() {
          while (running < CONCURRENCY && i < targets.length) {
            (function (room) {
              running++;
              AQ.live._fetchRaw(room.name, SAMPLE).then(function (msgs) {
                cache.probed[room.name] = { board: !!AQ.adapters.looksLikeKibble(msgs || []), t: Date.now() };
              }, function () {
                cache.probed[room.name] = { board: false, t: Date.now(), error: true };
              }).then(function () {
                running--; finished++;
                if (finished >= targets.length) report('done');
                else { report('probing'); next(); }
              });
            })(targets[i++]);
          }
        }
        next();
      }

      if (fresh) { probeAll(); return; }
      report('loading');
      AQ.adapters.technocoreRooms().then(function (text) {
        cache.rooms = parseRooms(text);
        cache.t = Date.now();
        cache.error = null;
        probeAll();
      }, function (err) {
        /* 一覧が読めなくても、知っている部屋（kibble・つないだことのある部屋）は
           1部屋ずつ確かめて出す。一覧はしばらくしてから読み直す（1分後）。 */
        cache.error = (err && err.message) || String(err);
        cache.rooms = known.map(function (n) { return { name: n, seq: null, size: '', age: '', topic: '' }; });
        cache.t = Date.now() - TTL_MS + 60 * 1000;
        report('probing');
        probeAll();
      });
    }
  };

})(window.AQ = window.AQ || {});
