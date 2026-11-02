/* =============================================================
   render/tiles.js — 地面1マスの絵（20px）
   -------------------------------------------------------------
   現代の市街地の路面だけを描きます。建物や設備は props.js。

   質を上げるための決まりごと:
     ・光は左上から。右下ほど暗くする
     ・1つの素材につき明・中・暗の3色以上を使う
     ・同じマスは毎回同じ模様（noise() を使う。乱数は使わない）
   ============================================================= */
(function (AQ) {
  'use strict';

  var T = 20;

  var COL = {
    /* 車道 */
    road:    '#3b3e48',
    roadHi:  '#464a56',
    roadLo:  '#32353e',
    line:    '#d8d3bd',      // センターライン（黄白）
    zebra:   '#e8e9ee',

    /* 歩道 */
    walk:    '#b3b7c2',
    walkHi:  '#c2c6d0',
    walkLo:  '#9ca1ad',
    joint:   '#8f95a2',
    curb:    '#8b909d',
    curbHi:  '#cfd3db',

    /* 敷地 */
    plaza:   '#9aa0ad',
    plazaHi: '#a8aeba',
    plazaLo: '#878d9a',

    /* 植え込み */
    green:   '#3c6b3f',
    greenHi: '#4c8150',
    greenLo: '#2e5432'
  };

  var ctx;
  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w, h); }
  function noise(cx, cy, n) { return ((cx * 73856093) ^ (cy * 19349663) ^ (n * 83492791)) >>> 0; }

  /* 市松の点描（面をのっぺりさせないため） */
  function speckle(x, y, cx, cy, color, count) {
    for (var i = 0; i < count; i++) {
      var n = noise(cx, cy, i);
      px(x + (n % T), y + ((n >> 5) % T), 1, 1, color);
    }
  }

  var TILES = {

    /* 歩道 */
    's': function (x, y, cx, cy, near) {
      px(x, y, T, T, COL.walk);
      px(x, y, T, 1, COL.walkHi);
      px(x, y, 1, T, COL.walkHi);
      px(x, y + T - 1, T, 1, COL.walkLo);
      px(x + T - 1, y, 1, T, COL.walkLo);
      // 平板ブロックの目地（10px 間隔）
      px(x + 10, y, 1, T, COL.joint);
      px(x, y + 10, T, 1, COL.joint);
      speckle(x, y, cx, cy, COL.walkHi, 5);
      // 車道に面していれば縁石
      if (near && near.south) { px(x, y + T - 3, T, 3, COL.curb); px(x, y + T - 3, T, 1, COL.curbHi); }
      if (near && near.north) { px(x, y, T, 3, COL.curb); px(x, y, T, 1, COL.curbHi); }
    },

    /* 敷地・タイル舗装 */
    'p': function (x, y, cx, cy) {
      px(x, y, T, T, COL.plaza);
      px(x, y, T, 1, COL.plazaHi);
      px(x, y + T - 1, T, 1, COL.plazaLo);
      px(x + T - 1, y, 1, T, COL.plazaLo);
      px(x, y + 10, T, 1, COL.plazaLo);
      px(x + 10, y, 1, T, COL.plazaLo);
      speckle(x, y, cx, cy, COL.plazaHi, 4);
    },

    /* 車道 */
    'a': function (x, y, cx, cy) {
      px(x, y, T, T, COL.road);
      speckle(x, y, cx, cy, COL.roadHi, 6);
      speckle(x, y, cx, cy + 99, COL.roadLo, 6);
    },

    /* 車道（センターライン） */
    'l': function (x, y, cx, cy) {
      TILES['a'](x, y, cx, cy);
      // 破線: 2マスに1回だけ引く
      if (cx % 2 === 0) {
        px(x + 2, y + 9, 14, 2, COL.line);
        px(x + 2, y + 9, 14, 1, '#f0ecd8');
      }
    },

    /* 横断歩道 */
    'x': function (x, y, cx, cy) {
      TILES['a'](x, y, cx, cy);
      for (var i = 2; i < T - 2; i += 7) {
        px(x + i, y, 4, T, COL.zebra);
        px(x + i, y, 1, T, '#ffffff');
      }
    },

    /* 植え込み */
    'g': function (x, y, cx, cy) {
      px(x, y, T, T, COL.green);
      for (var i = 0; i < 10; i++) {
        var n = noise(cx, cy, i);
        px(x + (n % T), y + ((n >> 4) % T), 2, 1, (n & 1) ? COL.greenHi : COL.greenLo);
      }
    }
  };

  AQ.tiles = {
    size: T,
    colors: COL,
    use: function (context) { ctx = context; },
    draw: function (ch, x, y, cx, cy, near) {
      (TILES[ch] || TILES['p'])(x, y, cx, cy, near);
    }
  };

})(window.AQ = window.AQ || {});
