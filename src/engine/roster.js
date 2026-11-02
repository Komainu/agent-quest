/* =============================================================
   engine/roster.js — 表示用の通し番号（#1 #2 …）
   -------------------------------------------------------------
   エージェントの本当の名前（DID など、64文字あって画面では読めない
   ことが多い文字列）の代わりに、このアプリが勝手に振った番号を
   ロボットの頭上や名簿チップに出す。

   ★ 名前を作らない
     DID から発音できそうな名前をでっち上げたりはしない。エージェント
     本人はそんな名前を名乗っていないので、それを画面に出すのは
     「知らないことを描く」のと同じ嘘になる。番号は「このアプリが
     表示のために振った」ものだと常に明示する（i18n の roster.disclaimer）。

   ★ 街と部屋で同じ番号になる
     どちらの画面も、この1か所から番号をもらう。beats（再生順）から
     初登場順に振るだけの純粋関数なので、同じログなら常に同じ番号になる。
   ============================================================= */
(function (AQ) {
  'use strict';

  /* 名前 → 決定的なハッシュ値。scene.js の車体色ぶんと全く同じ式を、
     こちらにも独立して持たせてある（お互いに読み込み順を気にしなくて済むように）。
     同じ actor 名なら、街のロボットも・部屋のロボットも・名簿のチップも
     必ず同じ色になる（式と表が両方とも一致しているため）。 */
  function hashStr(s) {
    var name = String(s || 'agent');
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h;
  }

  var TINTS = [
    ['#ffd35c', '#d9a02c'],  // 黄
    ['#7fe6c4', '#3fae8a'],  // 緑
    ['#8fd0ff', '#4f96e0'],  // 青
    ['#ffa3c8', '#e0679e'],  // 桃
    ['#c6b3ff', '#8f74e0'],  // 紫
    ['#ffb27a', '#dd7d3f']   // 橙
  ];

  AQ.roster = {
    /** actor名 → スウォッチ色（明るい方の1色）。街のロボット車体・部屋の
        ロボット車体・名簿チップの色玉、すべてこの1つの式から。 */
    colorFor: function (actor) {
      return TINTS[hashStr(actor || 'agent') % TINTS.length][0];
    },
    /** beats（aggregate.js の再生順コマ列）→ { order, numberOf }
        order    … 初登場順の actor 名の配列
        numberOf … actor 名 → 番号（1始まり） */
    build: function (beats) {
      var order = [];
      var numberOf = {};
      (beats || []).forEach(function (b) {
        var actor = (b && b.actor) || 'agent';
        if (!Object.prototype.hasOwnProperty.call(numberOf, actor)) {
          numberOf[actor] = order.length + 1;
          order.push(actor);
        }
      });
      return { order: order, numberOf: numberOf };
    },

    /** 番号だけの表示文字列（ロボットの頭上用） */
    label: function (numberOf, actor) {
      var n = numberOf && numberOf[actor || 'agent'];
      return n ? ('#' + n) : '#?';
    }
  };

})(window.AQ = window.AQ || {});
