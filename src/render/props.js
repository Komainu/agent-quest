/* =============================================================
   render/props.js — 街に建っているもの
   -------------------------------------------------------------
   建物・看板・充電スタンド・街路樹・自販機・信号・車。
   すべて data/world.js の objects から呼ばれます。

   新しい物を足すとき:
     1) ここに描画関数を書いて DRAW に1行足す
     2) world.js の objects に { type:'名前', x,y,w,h } を足す
   ============================================================= */
(function (AQ) {
  'use strict';

  var ctx, T;

  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w, h); }

  function label(s, x, y, color, size) {
    ctx.fillStyle = color;
    ctx.font = (size || 6) + 'px "Press Start 2P", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(s, x, y);
  }

  var C = {
    wallHi:  '#8f96a6',
    wall:    '#787f8f',
    wallLo:  '#5f6675',
    roof:    '#4a5060',
    roofHi:  '#5b6273',
    roofLo:  '#3a3f4d',
    glass:   '#2b4c6b',
    glassOn: '#7fd4ff',
    glassHi: '#a9e6ff',
    trim:    '#2a2e3a',
    door:    '#22262f',
    signBg:  '#161a24',
    signInk: '#9fe8ff',
    red:     '#e8483a',
    green:   '#57d08a',
    amber:   '#ffb648',
    metal:   '#9aa1b0',
    metalLo: '#6f7684',
    trunk:   '#5a4630',
    leaf:    '#2f7a3f',
    leafHi:  '#43a055',
    leafLo:  '#1f5b2c',
    carA:    '#c2453a',
    carB:    '#3f6fd8',
    tire:    '#22252d'
  };

  /* 建物の共通部分（屋根・壁・窓） */
  function box(x, y, w, h, roofColor) {
    var top = 8;                                   // 屋根の見えている厚み
    px(x, y, w, h, C.wall);
    px(x, y, w, top, roofColor || C.roof);
    px(x, y, w, 1, C.roofHi);
    px(x, y + top, w, 1, C.roofLo);
    px(x, y, 1, h, C.wallHi);
    px(x + w - 1, y, 1, h, C.wallLo);
    px(x, y + h - 1, w, 1, C.trim);
  }

  function windows(x, y, w, h, cols, rows, lit) {
    var gw = 9, gh = 7;
    var ox = x + Math.floor((w - (cols * gw + (cols - 1) * 5)) / 2);
    var oy = y + 14;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var gx = ox + c * (gw + 5), gy = oy + r * (gh + 5);
        var on = lit && ((r * 3 + c * 5 + 1) % 4 !== 0);
        px(gx - 1, gy - 1, gw + 2, gh + 2, C.trim);
        px(gx, gy, gw, gh, on ? C.glassOn : C.glass);
        px(gx, gy, gw, 1, on ? C.glassHi : '#38607f');
      }
    }
  }

  var DRAW = {

    /* 事務所（拠点） */
    office: function (o, x, y, w, h) {
      box(x, y, w, h, '#3f4756');
      windows(x, y, w, h - 22, 3, 2, true);
      // 入口
      var dx = x + Math.floor(w / 2) - 8;
      px(dx, y + h - 18, 16, 18, C.door);
      px(dx, y + h - 18, 16, 1, C.metal);
      px(dx + 7, y + h - 10, 2, 4, C.metal);
      // 屋上のパラボラ
      px(x + w - 16, y - 7, 2, 8, C.metalLo);
      px(x + w - 20, y - 11, 10, 5, C.metal);
      px(x + w - 19, y - 10, 8, 3, '#c8cedb');
      // 看板
      px(x + 4, y + 9, w - 8, 8, C.signBg);
      label(o.liveLabel || o.label || '', x + 6, y + 11, C.signInk, 6);
    },

    /* サービス提供者の建物（＝エンドポイント） */
    service: function (o, x, y, w, h, st) {
      box(x, y, w, h, '#454c5c');
      windows(x, y, w, h - 24, 4, 2, true);

      // 入口と決済端末
      var dx = x + Math.floor(w / 2) - 9;
      var dy = y + h - 20;
      px(dx, dy, 18, 20, C.door);
      px(dx, dy, 18, 1, C.metal);
      px(dx + 8, dy + 10, 2, 5, C.metal);

      // 端末（右脇）: 402=赤 / 支払い済み=緑 / 通常=消灯
      var tx = dx + 22, ty = dy + 3;
      px(tx, ty, 8, 12, '#2b303c');
      px(tx, ty, 8, 1, C.metal);
      var lamp = st === 'require' ? C.red : (st === 'paid' ? C.green : '#3a4150');
      px(tx + 2, ty + 3, 4, 3, lamp);
      px(tx + 2, ty + 8, 4, 1, '#4a5162');

      // 看板（URL）
      px(x + 3, y + 9, w - 6, 9, C.signBg);
      px(x + 3, y + 9, w - 6, 1, '#2b3243');
      label(o.liveLabel || o.label || '', x + 5, y + 11, C.signInk, 6);
    },

    /* 街頭ビジョン（決済の確定を映す） */
    signage: function (o, x, y, w, h, st) {
      var bw = w - 8, bh = 26, bx = x + 4, by = y - 16;
      px(x + 7, y + 2, 3, h + 4, C.metalLo);           // 支柱
      px(x + w - 10, y + 2, 3, h + 4, C.metalLo);
      px(x + 7, y + 2, 1, h + 4, C.metal);
      px(bx - 2, by - 2, bw + 4, bh + 4, '#2a2e3a');   // 筐体
      px(bx - 2, by - 2, bw + 4, 1, '#454b5a');
      var on = st === 'lit';
      px(bx, by, bw, bh, on ? '#08221a' : '#0d1119');  // 画面
      if (on) {
        /* ★ 2026-10-02: 「SETTLED」の文字をやめ、チェーンのブロック（つながった
           四角）を映す。立会所の上に積まれるブロックと同じ絵＝同じことを言う。 */
        var nb = 3, sz = 7, gp = 4, x0 = bx + Math.round((bw - (nb * sz + (nb - 1) * gp)) / 2);
        for (var i = 0; i < nb; i++) {
          if (i > 0) px(x0 + i * (sz + gp) - gp, by + 9, gp, 1, '#3ddc84');
          px(x0 + i * (sz + gp), by + 6, sz, sz, i === nb - 1 ? '#3ddc84' : '#1e6b45');
          px(x0 + i * (sz + gp), by + 6, sz, 1, '#b6ffd6');
        }
        px(bx + 3, by + 18, bw - 6, 1, '#1e6b45');
      } else {
        px(bx + 3, by + 8, bw - 6, 1, '#1c2230');
        px(bx + 3, by + 12, Math.floor((bw - 6) * 0.6), 1, '#1c2230');
      }
    },

    /* 立会所＝ファシリテータの窓口（2026-09-14 追加）
       x402 では、署名された許可証を実際にチェーンへ載せてガス代を払うのは
       支払人ではなくこの人。街に居ないと、そこが絵で伝わらない。
       ・カウンターの奥に人が1人ずっと立っている（エージェントのロボットとは
         別の見た目にして、取り違えないようにする）
       ・確定のコマだけランプが緑に光り、手元の端末が動く */
    facilitator: function (o, x, y, w, h, st) {
      var bw = w, bh = h;
      /* 小屋 */
      px(x, y - 22, bw, bh + 22, '#5f6675');
      px(x, y - 22, bw, 2, '#8f96a6');
      px(x, y - 22, 1, bh + 22, '#787f8f');
      px(x + bw - 1, y - 22, 1, bh + 22, '#4a5060');
      /* 屋根のひさし */
      px(x - 2, y - 26, bw + 4, 4, '#3c4250');
      px(x - 2, y - 26, bw + 4, 1, '#565d6d');
      /* 看板（言語に合わせる。文言は i18n が持つ） */
      var name = (AQ.i18n && AQ.i18n.t) ? AQ.i18n.t('scene.facilitator') : '';
      px(x + 2, y - 21, bw - 4, 10, '#161a24');
      label(name, x + 4, y - 19, '#9fe8ff', 6);
      /* カウンター */
      px(x + 2, y + bh - 8, bw - 4, 6, '#6f7684');
      px(x + 2, y + bh - 8, bw - 4, 1, '#8f96a6');
      /* 立会人（カウンターの奥に立っている人。エージェントのロボットと
         取り違えないよう、丸い頭＋緑の制服の「人」の形にする）。
         小さすぎると点にしか見えないので、ロボット並みの大きさにする。 */
      var hx2 = x + Math.floor(bw / 2) - 7;
      var hy2 = y + bh - 30;
      px(hx2 + 2, hy2 + 2, 10, 9, '#e8c9a0');     // 顔
      px(hx2 + 1, hy2, 12, 4, '#2f3646');         // 帽子
      px(hx2, hy2 + 2, 14, 2, '#3c4454');         // つば
      px(hx2 + 4, hy2 + 6, 2, 2, '#14161f');      // 目
      px(hx2 + 8, hy2 + 6, 2, 2, '#14161f');
      px(hx2 + 1, hy2 + 11, 12, 13, '#2f7f6a');   // 体（緑の制服）
      px(hx2 + 1, hy2 + 11, 12, 2, '#49a98d');
      px(hx2 + 5, hy2 + 13, 4, 8, '#1f5e4e');     // 前立て
      px(hx2 - 2, hy2 + 13, 3, 9, '#2f7f6a');     // 腕
      px(hx2 + 13, hy2 + 13, 3, 9, '#2f7f6a');
      /* 手元の端末（確定中は緑に光る） */
      var on = st === 'lit';
      px(x + bw - 8, y + bh - 12, 5, 4, on ? '#3fd08a' : '#1d2330');
      if (on) px(x + bw - 7, y + bh - 11, 3, 1, '#bdfbe0');
      /* ランプ */
      px(x + 2, y - 25, 3, 3, on ? '#3fd08a' : '#2a3340');
      px(x, y + bh - 2, bw, 2, '#4a5060');
    },

    /* 充電スタンド */
    charger: function (o, x, y, w, h, st) {
      px(x + 2, y - 6, 10, h + 6, '#3a4150');
      px(x + 2, y - 6, 10, 1, C.metal);
      px(x + 4, y - 3, 6, 5, st === 'lit' ? C.green : '#1d2330');
      px(x + 13, y - 2, 2, 8, C.metalLo);              // ケーブル
      px(x + 15, y + 4, 4, 2, C.metalLo);
      px(x, y + h - 2, w * 1, 2, '#6f7684');
    },

    /* 街路樹 */
    tree: function (o, x, y, w, h) {
      px(x + 8, y + 10, 4, 10, C.trunk);
      px(x + 8, y + 10, 1, 10, '#6f573c');
      px(x + 5, y + 1, 10, 4, C.leaf);
      px(x + 2, y + 4, 16, 7, C.leaf);
      px(x + 4, y + 11, 12, 4, C.leaf);
      px(x + 4, y + 2, 6, 4, C.leafHi);
      px(x + 3, y + 6, 4, 3, C.leafHi);
      px(x + 11, y + 10, 6, 3, C.leafLo);
      px(x + 6, y + 17, 8, 2, 'rgba(0,0,0,.22)');
    },

    /* 自動販売機 */
    vending: function (o, x, y, w, h) {
      px(x + 3, y + 2, 14, 18, '#b8352c');
      px(x + 3, y + 2, 14, 1, '#e05a4a');
      px(x + 16, y + 2, 1, 18, '#7d221c');
      px(x + 5, y + 5, 8, 8, '#22303f');
      px(x + 5, y + 5, 8, 1, '#4a6a86');
      px(x + 6, y + 6, 2, 3, '#ffd35c');
      px(x + 9, y + 6, 2, 3, '#7fd4ff');
      px(x + 5, y + 15, 9, 3, '#2a2e3a');
      px(x + 3, y + 19, 14, 1, 'rgba(0,0,0,.3)');
    },

    /* 歩行者信号 */
    signal: function (o, x, y, w, h, st) {
      px(x + 9, y + 4, 2, 16, C.metalLo);
      px(x + 5, y - 4, 10, 12, '#2a2e3a');
      px(x + 5, y - 4, 10, 1, '#454b5a');
      px(x + 7, y - 2, 6, 3, st === 'go' ? C.green : '#1c3226');
      px(x + 7, y + 3, 6, 3, st === 'go' ? '#3a1e1c' : C.red);
    },

    /* 路上駐車 */
    car: function (o, x, y, w, h) {
      var col = (o.x % 2) ? C.carB : C.carA;
      var W = w - 6, H = 14;              // w はすでにピクセル
      var bx = x + 3, by = y + 3;
      px(bx, by, W, H, col);
      px(bx, by, W, 1, '#ffffff22');
      px(bx, by + H - 1, W, 1, '#00000055');
      px(bx + 6, by + 2, W - 22, H - 5, '#2c3d52');
      px(bx + 6, by + 2, W - 22, 1, '#6d90b3');
      px(bx + W - 5, by + 4, 4, 3, '#ffe9a8');
      px(bx + 1, by + 4, 3, 3, '#ff7a6a');
      px(bx + 4, by + H - 1, 6, 3, C.tire);
      px(bx + W - 12, by + H - 1, 6, 3, C.tire);
    }
  };

  AQ.props = {
    use: function (context, tile) { ctx = context; T = tile; },

    /** 1つ描く。sx,sy は画面上の左上。state は点灯などの状態 */
    draw: function (o, sx, sy, state) {
      var fn = DRAW[o.type];
      if (!fn) return;
      fn(o, sx, sy, o.w * T, o.h * T, state);
    },

    /** 影（建物の足元） */
    shadow: function (o, sx, sy) {
      if (o.type === 'tree' || o.type === 'signal') return;
      px(sx + 2, sy + o.h * T, o.w * T - 2, 3, 'rgba(0,0,0,.25)');
    },

    has: function (type) { return !!DRAW[type]; }
  };

})(window.AQ = window.AQ || {});
