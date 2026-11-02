/* =============================================================
   sprites.js — 主役の絵（ベクター版）
   -------------------------------------------------------------
   主役は「自律配送ロボット」。現実にある宅配ロボットの姿です。
   （エージェント＝実体がなくて何をしているか見えない、という問題に
     わざと実体を与えている、というのがこの絵の意味です）

   ★ 2026-09-06: ドット絵（1文字=1ピクセルのグリッド）を廃止し、
     パス（角丸矩形・弧）で描くベクター図形に置き換えた。
     きっかけは「ドット絵が荒い」という繰り返しの報告 — 実は原因は
     絵そのものではなく低解像度キャンバスの拡大表示だった（render/*.js
     の解像度対応 task 参照）が、ユーザーは解像度対応とあわせて
     「滑らかな絵にしてほしい」を選んだ。ここではその選択に従い、
     ピクセルグリッドを完全に捨てて、パス描画に作り直す。

   ★ 変わらないもの（意味の継続）
     6つの特徴（アンテナ・頭部形状・車体プロポーション・走行部・
     背負い荷物・アクセサリ）が actor 文字列から決定的に選ばれ、
     見た目のシルエットを変える、という仕組み自体は変えていない。
     AQ.sprites.traitsFor(actor) は既存のテスト（tools/check-features.js
     など）が使っているので、そのまま残す。

   ★ 新しい公開API
     AQ.sprites.traitsFor(actor)   … 6つの特徴インデックス（0〜3）の配列（既存のまま）
     AQ.sprites.figureFor(actor)   … 上の配列を名前つきオブジェクトにしたもの
     AQ.sprites.drawFigure(ctx, fig, x, y, w, h, dir, palette)
       … (x,y) を左上とする w×h の箱の中にロボットを描く。dir は
         'down'（正面）/'up'（背面）/'left'/'right'（横向き）。
         palette は config.palette と同じキー（'1'〜'9','a'〜'g'）を
         持つオブジェクト（scene.js / room.js の paletteFor() が今までどおり
         actor ごとに '2'/'3' をティントしたものをそのまま渡せる＝
         呼び出し側の「actorごとに色を変える」しくみは変更不要）。
   ============================================================= */
(function (AQ) {
  'use strict';

  /* =============================================================
     0. actor → 特徴（決定的）。ここは以前とまったく同じ式のまま。
     ============================================================= */

  /* FNV-1a（32bit）＋ Murmur3 風の最終混ぜ。乗算ハッシュだけだと
     2のべき乗で mod したときの下位ビットが弱いので、最後にしっかり混ぜる。 */
  function hash32(str, salt) {
    var h = (0x811c9dc5 ^ salt) >>> 0;
    var s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;   // FNV prime（32bit）
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }

  var TRAITS = ['antenna', 'head', 'body', 'tread', 'cargo', 'accent'];
  var VARIANTS = 4;   // 特徴1つあたりの選択肢（4^6 = 4096 通り）

  function pickVariant(actor, trait) {
    return hash32(actor, (TRAITS.indexOf(trait) + 1) * 2654435761) % VARIANTS;
  }

  /** テスト用・既存API: actor → 6つの特徴インデックス（0〜3）の配列。
      同じ actor なら常に同じ配列になる（純粋関数）。
      順序は TRAITS のとおり: antenna, head, body, tread, cargo, accent */
  AQ.sprites = AQ.sprites || {};
  AQ.sprites.traitsFor = function (actor) {
    var a = String(actor || 'agent');
    return TRAITS.map(function (tr) { return pickVariant(a, tr); });
  };

  /** actor → 描画パラメータ（名前つき）。traitsFor と中身は同じだが、
      呼び出し側（drawFigure・テスト）が番号の順序を覚えなくて済むように
      名前つきオブジェクトにしてある。純粋関数・決定的。 */
  AQ.sprites.figureFor = function (actor) {
    var t = AQ.sprites.traitsFor(actor);
    return { antenna: t[0], head: t[1], body: t[2], tread: t[3], cargo: t[4], accent: t[5] };
  };

  /* =============================================================
     1. 小さな描画部品
     ============================================================= */

  /** 角丸矩形のパスを ctx に積む（描画はしない。fill/stroke は呼び出し側）。
      古いブラウザでも動くよう ctx.roundRect() には頼らず自前で組み立てる。 */
  function roundRectPath(ctx, x, y, w, h, r) {
    if (w <= 0 || h <= 0) return;
    r = Math.max(0, Math.min(r == null ? Math.min(w, h) * 0.2 : r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function fillRound(ctx, x, y, w, h, r, color) {
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function circle(ctx, cx, cy, r, color) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /* =============================================================
     2. 車体プロポーション（body。0〜3）。
        wf=幅（箱の幅に対する比）／top,bot=上端・下端（箱の高さに対する
        比）／r=角丸の強さ。 0=標準 1=細身 2=ワイド 3=縦長 */
  var BODY = [
    { wf: 0.58, top: 0.40, bot: 0.82, r: 0.16 },   // 標準
    { wf: 0.44, top: 0.40, bot: 0.82, r: 0.18 },   // 細身
    { wf: 0.76, top: 0.44, bot: 0.82, r: 0.13 },   // ワイド
    { wf: 0.50, top: 0.30, bot: 0.86, r: 0.11 }    // 縦長（背が高い）
  ];

  function bodyMetrics(x, y, w, h, variant) {
    var bv = BODY[variant] || BODY[0];
    var bw = w * bv.wf;
    var bx = x + (w - bw) / 2;
    var byTop = y + h * bv.top;
    var byBot = y + h * bv.bot;
    var bh = byBot - byTop;
    return { bx: bx, by: byTop, bw: bw, bh: bh, r: Math.min(bw, bh) * bv.r };
  }

  function paintBody(ctx, body, pal) {
    var grad = ctx.createLinearGradient(body.bx, body.by, body.bx + body.bw, body.by + body.bh);
    grad.addColorStop(0, pal['2']);   // 明（actorごとにティントされた色）
    grad.addColorStop(1, pal['3']);   // 中（同じくティント）— 2段階のグラデーション
    roundRectPath(ctx, body.bx, body.by, body.bw, body.bh, body.r);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(1, body.bw * 0.035);
    ctx.strokeStyle = pal['1'];
    ctx.stroke();

    // 前面パネル（既存デザインの継続: 小さな表示パネル）
    var pw = body.bw * 0.34, ph = body.bh * 0.20;
    var px0 = body.bx + body.bw / 2 - pw / 2, py0 = body.by + body.bh * 0.20;
    fillRound(ctx, px0, py0, pw, ph, ph * 0.3, pal['5']);
    ctx.fillStyle = pal['6'];
    ctx.fillRect(px0 + pw * 0.12, py0 + ph * 0.30, pw * 0.5, ph * 0.24);

    // 下端の縁取り帯（スカートの名残り。土台をひとつの見た目に統一する）
    ctx.fillStyle = pal['4'];
    ctx.fillRect(body.bx + body.bw * 0.06, body.by + body.bh * 0.86, body.bw * 0.88, body.bh * 0.08);
  }

  /* =============================================================
     3. 頭部（head。0〜3）。 0=ドーム 1=箱型 2=箱型＋額のバー
        3=ツインセンサー（両側に耳のような丸い出っ張り）           */
  function headMetrics(x, y, w, h, body) {
    var headW = body.bw * 0.82;
    var headH = h * 0.24;
    var hx = x + w / 2 - headW / 2;
    var hy = body.by - headH * 0.58;   // 車体の上端に少し食い込ませて継ぎ目を作らない
    return { hx: hx, hy: hy, w: headW, h: headH };
  }

  function paintHead(ctx, head, shape, pal) {
    var r = (shape === 0) ? Math.min(head.w, head.h) * 0.5 : head.h * 0.22;
    var grad = ctx.createLinearGradient(head.hx, head.hy, head.hx, head.hy + head.h);
    grad.addColorStop(0, pal['3']);
    grad.addColorStop(1, pal['4']);
    roundRectPath(ctx, head.hx, head.hy, head.w, head.h, r);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(1, head.w * 0.035);
    ctx.strokeStyle = pal['1'];
    ctx.stroke();

    if (shape === 2) {   // 額のバー
      ctx.fillStyle = pal['b'];
      var barH = head.h * 0.12;
      ctx.fillRect(head.hx + head.w * 0.12, head.hy + head.h * 0.10, head.w * 0.76, barH);
    }
    if (shape === 3) {   // ツインセンサー（両耳）
      var er = head.h * 0.24;
      [head.hx, head.hx + head.w].forEach(function (ex) {
        circle(ctx, ex, head.hy + head.h * 0.5, er, pal['9']);
        ctx.lineWidth = Math.max(1, head.w * 0.03);
        ctx.strokeStyle = pal['1'];
        ctx.beginPath(); ctx.arc(ex, head.hy + head.h * 0.5, er, 0, Math.PI * 2); ctx.stroke();
      });
    }
  }

  /** 顔（バイザー／背面ハッチ／横顔センサー）。facing は 'down'|'up'|'right' の3つだけ
      （'left' は呼び出し側で水平反転してから 'right' として渡す）。 */
  /* ★ 2026-10-03: 表情（mood）。文字を読まなくても「困った・きりっ・うれしい・
     しょんぼり」が顔で分かるように（利用者「初心者向け。アニメ的な表現で」）。
       'happy'      … 目が「^ ^」に細くなる
       'worried'    … 目が小さくなり、眉が八の字、頭の横に汗
       'determined' … 目が横一文字、眉が内向きに下がる（きりっ）
       'sad'        … 目が半分閉じて下がり、眉が八の字
     mood が無ければ今までどおりの顔。 */
  function brow(ctx, x0, y0, x1, y1, lw, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }
  function sweat(ctx, x, y, r) {
    ctx.save();
    ctx.fillStyle = '#7fc8ff'; ctx.strokeStyle = '#1d4f7a'; ctx.lineWidth = Math.max(0.6, r * 0.25);
    ctx.beginPath(); ctx.moveTo(x, y - r * 1.6);
    ctx.quadraticCurveTo(x + r, y - r * 0.2, x, y + r * 0.6);
    ctx.quadraticCurveTo(x - r, y - r * 0.2, x, y - r * 1.6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e6f6ff'; ctx.fillRect(x - r * 0.35, y - r * 0.4, r * 0.3, r * 0.3);
    ctx.restore();
  }
  function moodEye(ctx, ex, ey, r, mood, col) {
    if (mood === 'happy') {
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, r * 0.8); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(ex, ey + r * 0.6, r * 1.05, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.restore();
    } else if (mood === 'determined') {
      ctx.fillStyle = col; ctx.fillRect(ex - r * 1.15, ey - r * 0.4, r * 2.3, r * 0.85);
    } else if (mood === 'sad') {
      ctx.save(); ctx.fillStyle = col; ctx.beginPath();
      ctx.arc(ex, ey + r * 0.15, r * 0.95, 0, Math.PI); ctx.fill(); ctx.restore();
    } else if (mood === 'worried') {
      circle(ctx, ex, ey + r * 0.15, r * 0.72, col);
    } else {
      circle(ctx, ex, ey, r, col);
    }
  }
  function paintFace(ctx, head, facing, pal, mood) {
    var lw = Math.max(1, head.h * 0.075);
    if (facing === 'up') {
      // 背面: 荷室のふた＋取っ手（弧）
      var lw = head.w * 0.34, lh = head.h * 0.30;
      var lx = head.hx + head.w / 2 - lw / 2, ly = head.hy + head.h * 0.32;
      fillRound(ctx, lx, ly, lw, lh, lh * 0.2, pal['9']);
      ctx.strokeStyle = pal['9'];
      ctx.lineWidth = Math.max(1, head.w * 0.05);
      ctx.beginPath();
      ctx.arc(head.hx + head.w / 2, ly, lw * 0.5, Math.PI, 0);
      ctx.stroke();
      return;
    }
    if (facing === 'down') {
      // 正面: バイザー（暗い帯）＋2つの目（発光ドット）
      var vx = head.hx + head.w * 0.13, vy = head.hy + head.h * 0.36, vw = head.w * 0.74, vh = head.h * 0.34;
      fillRound(ctx, vx, vy, vw, vh, vh * 0.42, pal['e']);
      var eyeR = vh * 0.26;
      [vx + vw * 0.28, vx + vw * 0.72].forEach(function (ex, k) {
        moodEye(ctx, ex, vy + vh * 0.5, eyeR, mood, pal['6']);
        /* 眉（バイザーの上）。k=0 が左目：内側＝右端 */
        var inner = k === 0 ? 1 : -1, by = vy - vh * 0.18, half = eyeR * 1.4;
        if (mood === 'worried' || mood === 'sad') brow(ctx, ex - inner * half, by, ex + inner * half * 0.8, by - vh * 0.32, lw, pal['1']);
        else if (mood === 'determined') brow(ctx, ex - inner * half, by - vh * 0.3, ex + inner * half * 0.8, by + vh * 0.04, lw, pal['1']);
      });
      return;
    }
    // 横顔: 片目センサー（進行方向側に寄せる）
    var sx = head.hx + head.w * 0.78, sy = head.hy + head.h * 0.5;
    circle(ctx, sx, sy, head.h * 0.17, pal['e']);
    moodEye(ctx, sx + head.h * 0.03, sy, head.h * 0.09, mood, pal['6']);
  }

  /* =============================================================
     4. アンテナ（0〜3）。頭部の上に乗る飾り。
     ============================================================= */
  function paintAntenna(ctx, head, variant, pal) {
    var cx = head.hx + head.w * 0.5;
    var topY = head.hy;
    ctx.strokeStyle = pal['9'];
    ctx.lineWidth = Math.max(1, head.w * 0.06);
    switch (variant) {
      case 0:   // 丸いランプ球
        ctx.beginPath(); ctx.moveTo(cx, topY); ctx.lineTo(cx, topY - head.h * 0.5); ctx.stroke();
        circle(ctx, cx, topY - head.h * 0.62, head.h * 0.17, pal['7']);
        circle(ctx, cx - head.h * 0.05, topY - head.h * 0.68, head.h * 0.05, pal['c']);
        break;
      case 1:   // 皿型（幅広の受信部）
        ctx.beginPath();
        ctx.fillStyle = pal['9'];
        ctx.ellipse(cx, topY - head.h * 0.06, head.w * 0.34, head.h * 0.16, 0, Math.PI, 0);
        ctx.fill();
        ctx.strokeStyle = pal['1']; ctx.lineWidth = Math.max(1, head.w * 0.025); ctx.stroke();
        break;
      case 2:   // 背の高いムチ型アンテナ＋先端のビーズ
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.quadraticCurveTo(cx + head.w * 0.18, topY - head.h * 0.6, cx + head.w * 0.06, topY - head.h * 0.95);
        ctx.stroke();
        circle(ctx, cx + head.w * 0.06, topY - head.h * 0.95, head.h * 0.11, pal['f']);
        break;
      case 3:   // 2本立て
        [-1, 1].forEach(function (s) {
          var px = cx + s * head.w * 0.32;
          ctx.beginPath(); ctx.moveTo(px, topY); ctx.lineTo(px, topY - head.h * 0.42); ctx.stroke();
          circle(ctx, px, topY - head.h * 0.48, head.h * 0.11, pal['7']);
        });
        break;
    }
  }

  /* =============================================================
     5. 走行部（tread。0〜3）。車体の下端に接する。
     ============================================================= */
  function paintTread(ctx, x, y, w, h, body, variant, pal) {
    var baseY = body.by + body.bh;
    var treadH = h * 0.15;
    switch (variant) {
      case 0: {   // 標準の4輪（左右2対）
        var ww = body.bw * 0.22;
        [body.bx + body.bw * 0.04, body.bx + body.bw - ww - body.bw * 0.04].forEach(function (wx) {
          fillRound(ctx, wx, baseY - treadH * 0.25, ww, treadH, treadH * 0.3, pal['8']);
        });
        break;
      }
      case 1: {   // 大径2輪
        var r = treadH * 0.95;
        [body.bx + body.bw * 0.16, body.bx + body.bw * 0.84].forEach(function (wx) {
          circle(ctx, wx, baseY, r, pal['8']);
          circle(ctx, wx, baseY, r * 0.42, pal['9']);
        });
        break;
      }
      case 2: {   // 無限軌道（キャタピラ、全幅の帯）
        fillRound(ctx, body.bx, baseY - treadH * 0.2, body.bw, treadH, treadH * 0.3, pal['8']);
        ctx.strokeStyle = pal['1'];
        ctx.lineWidth = Math.max(1, w * 0.012);
        for (var i = 0; i < 6; i++) {
          var lx = body.bx + body.bw * (i + 0.5) / 6;
          ctx.beginPath(); ctx.moveTo(lx, baseY - treadH * 0.1); ctx.lineTo(lx, baseY + treadH * 0.7); ctx.stroke();
        }
        break;
      }
      case 3: {   // 3輪（左右の小輪＋中央キャスター）
        var ww2 = body.bw * 0.18;
        [body.bx + body.bw * 0.02, body.bx + body.bw - ww2 - body.bw * 0.02].forEach(function (wx) {
          fillRound(ctx, wx, baseY - treadH * 0.2, ww2, treadH * 0.75, treadH * 0.25, pal['8']);
        });
        circle(ctx, x + w / 2, baseY + treadH * 0.35, treadH * 0.38, pal['9']);
        break;
      }
    }
  }

  /* =============================================================
     6. 背負い荷物（cargo。0〜3）。'down'（正面）以外は肩の後ろに
        フルに描き、'down' は肩口の留め具だけの控えめなヒントにする
        （既存デザインの継続：正面からでも違いがいくらか分かるように）。
     ============================================================= */
  function paintCargo(ctx, x, y, w, h, body, variant, facing, pal) {
    if (variant === 0) return;
    if (facing === 'down') {
      var col = (variant === 1) ? pal['9'] : (variant === 2 ? pal['7'] : pal['f']);
      ctx.fillStyle = col;
      ctx.fillRect(body.bx - w * 0.015, body.by + body.bh * 0.06, w * 0.05, body.bh * 0.2);
      ctx.fillRect(body.bx + body.bw - w * 0.035, body.by + body.bh * 0.06, w * 0.05, body.bh * 0.2);
      return;
    }
    var cw = body.bw * 0.86, ch = body.bh * 0.46;
    var cx0 = x + w / 2 - cw / 2, cy0 = body.by - ch * 0.52;
    if (variant === 1) {   // 木箱（クレート）
      fillRound(ctx, cx0, cy0, cw, ch, ch * 0.1, pal['d']);
      ctx.strokeStyle = pal['1']; ctx.lineWidth = Math.max(1, w * 0.02); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx0, cy0 + ch / 2); ctx.lineTo(cx0 + cw, cy0 + ch / 2);
      ctx.strokeStyle = pal['9']; ctx.stroke();
    } else if (variant === 2) {   // ラック（枠＋中の小荷物2つ）
      ctx.strokeStyle = pal['9']; ctx.lineWidth = Math.max(1, w * 0.02);
      ctx.strokeRect(cx0, cy0, cw, ch);
      ctx.fillStyle = pal['7']; ctx.fillRect(cx0 + cw * 0.12, cy0 + ch * 0.25, cw * 0.32, ch * 0.5);
      ctx.fillStyle = pal['f']; ctx.fillRect(cx0 + cw * 0.56, cy0 + ch * 0.25, cw * 0.32, ch * 0.5);
    } else {   // タンク（丸い筒）
      fillRound(ctx, cx0 + cw * 0.16, cy0, cw * 0.68, ch, cw * 0.2, pal['d']);
      ctx.strokeStyle = pal['1']; ctx.lineWidth = Math.max(1, w * 0.02); ctx.stroke();
    }
  }

  /* =============================================================
     7. アクセサリ（accent。0〜3）。1点だけの飾り、車体の上に重ねる。
     ============================================================= */
  function paintAccent(ctx, x, y, w, h, body, variant, pal) {
    if (variant === 0) return;
    if (variant === 1) {   // ライトバー（肩の上端に光る帯）
      var lw = body.bw * 0.9, lh = body.bh * 0.07;
      fillRound(ctx, body.bx + body.bw * 0.05, body.by + body.bh * 0.02, lw, lh, lh * 0.5, pal['b']);
    } else if (variant === 2) {   // 小さな旗
      var px0 = body.bx + body.bw * 0.92, py0 = body.by - body.bh * 0.08;
      ctx.strokeStyle = pal['9']; ctx.lineWidth = Math.max(1, w * 0.02);
      ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px0, py0 + body.bh * 0.42); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px0, py0); ctx.lineTo(px0 + body.bw * 0.18, py0 + body.bh * 0.09); ctx.lineTo(px0, py0 + body.bh * 0.18);
      ctx.closePath();
      ctx.fillStyle = pal['7']; ctx.fill();
    } else {   // デカール（胴体側面の色つきパネル）
      var dw = body.bw * 0.22, dh = body.bh * 0.34;
      fillRound(ctx, body.bx + body.bw * 0.12, body.by + body.bh * 0.30, dw, dh, dh * 0.2, pal['f']);
    }
  }

  /* =============================================================
     8. 地面の影（ソフトシャドウ）
     ============================================================= */
  function paintShadow(ctx, x, y, w, h) {
    var cx = x + w * 0.5, cy = y + h * 0.96;
    var rx = w * 0.40, ry = h * 0.05;
    if (rx <= 0 || ry <= 0) return;
    var g;
    try { g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx); }
    catch (e) { g = null; }
    if (g) {
      g.addColorStop(0, 'rgba(0,0,0,.32)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.22)';
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* =============================================================
     9. 組み立て（drawFigure）— 公開API
     ============================================================= */

  /** (x,y) を左上とする w×h の箱の中にロボットを描く。
      fig   … AQ.sprites.figureFor(actor) の戻り値（6特徴）
      dir   … 'down'|'up'|'left'|'right'（'left' は水平反転で描く）
      palette … config.palette と同じキー構成のオブジェクト（省略時は既定色）
      純粋な描画関数（状態を持たない）。同じ引数なら常に同じ絵になる。 */
  AQ.sprites.drawFigure = function (ctx, fig, x, y, w, h, dir, palette, mood) {
    if (!ctx || !fig) return;
    var pal = palette || (AQ.config && AQ.config.palette) || {};
    var facing = (dir === 'up') ? 'up' : (dir === 'left' || dir === 'right') ? 'right' : 'down';

    ctx.save();
    if (dir === 'left') {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      x = 0; y = 0;
    }

    paintShadow(ctx, x, y, w, h);
    var body = bodyMetrics(x, y, w, h, fig.body);
    paintCargo(ctx, x, y, w, h, body, fig.cargo, facing, pal);
    paintTread(ctx, x, y, w, h, body, fig.tread, pal);
    paintBody(ctx, body, pal);
    var head = headMetrics(x, y, w, h, body);
    paintHead(ctx, head, fig.head, pal);
    paintFace(ctx, head, facing, pal, mood || null);
    paintAntenna(ctx, head, fig.antenna, pal);
    paintAccent(ctx, x, y, w, h, body, fig.accent, pal);

    ctx.restore();
  };

  /** 正面向き（down）のときの目（バイザーの中央）の位置。
      検品で「目から品物へ光を当てる」演出の起点に使う。
      paintFace の 'down' と同じ計算（絵と起点が食い違わない）。 */
  /** 胴体の矩形（正面向き）。腕の付け根を胴体のふちに付けるために使う。 */
  AQ.sprites.bodyRect = function (fig, x, y, w, h) {
    if (!fig) return null;
    var b = bodyMetrics(x, y, w, h, fig.body);
    return { x: b.bx, y: b.by, w: b.bw, h: b.bh };
  };

  AQ.sprites.MOODS = ['happy', 'worried', 'determined', 'sad'];

  /** 漫符（顔の横・頭の上に出す記号）。文字ではなく記号で気持ちを足す。
      x,y,w,h は drawFigure に渡したのと同じ枠。now は揺れ用（無くてもよい）。
        happy      … 音符とキラキラ
        worried    … 大きな汗のしずく
        determined … 頭の横に強調の3本線
        sad        … 頭の上に縦線（どんより） */
  AQ.sprites.drawEmote = function (ctx, mood, x, y, w, h, now) {
    if (!ctx || !mood) return;
    var u = w / 35;                                      // 街のロボット（35px）を1とした大きさ
    var t = (now || 0) / 1000;
    ctx.save();
    if (mood === 'worried') {
      var wob = Math.sin(t * 6) * u;
      sweat(ctx, x + w * 0.98, y + h * 0.12 + wob, 3.2 * u);
      sweat(ctx, x + w * 1.1, y + h * 0.3 + wob * 0.5, 2 * u);
    } else if (mood === 'happy') {
      var lift = (Math.sin(t * 5) + 1) * u;
      var nx = x + w * 1.0, ny = y + h * 0.02 - lift;
      ctx.fillStyle = '#ffd35c'; ctx.strokeStyle = '#0d1017'; ctx.lineWidth = Math.max(1, 0.7 * u);
      ctx.beginPath(); ctx.ellipse(nx, ny + 5 * u, 2.2 * u, 1.7 * u, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillRect(nx + 1.4 * u, ny - 2 * u, 1.2 * u, 7 * u);
      ctx.fillRect(nx + 1.4 * u, ny - 2 * u, 3.6 * u, 1.4 * u);
      [[-0.12, 0.08, 1], [0.08, -0.08, 0.7]].forEach(function (k) {
        var sx = x + w * (0.5 + k[0]) + (k[0] < 0 ? -w * 0.45 : 0), sy = y + h * k[1];
        var r = 2.4 * u * k[2] * (0.6 + 0.4 * Math.abs(Math.sin(t * 7 + k[0] * 9)));
        ctx.fillStyle = '#fff6c9';
        ctx.fillRect(sx - r, sy - 0.5 * u, r * 2, u); ctx.fillRect(sx - 0.5 * u, sy - r, u, r * 2);
      });
    } else if (mood === 'determined') {
      ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = Math.max(1, 1.2 * u); ctx.lineCap = 'round';
      var cx = x + w * 0.95, cy = y + h * 0.16;
      [[-0.9, -0.5], [0, -1], [0.9, -0.5]].forEach(function (d) {
        ctx.beginPath(); ctx.moveTo(cx + d[0] * 2.5 * u, cy + d[1] * 2.5 * u); ctx.lineTo(cx + d[0] * 6 * u, cy + d[1] * 6 * u); ctx.stroke();
      });
    } else if (mood === 'sad') {
      ctx.strokeStyle = 'rgba(70,80,120,.85)'; ctx.lineWidth = Math.max(1, u);
      for (var i = 0; i < 4; i++) {
        var gx = x + w * (0.25 + i * 0.17), gy = y - 2 * u;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + (i % 2 ? 6 : 9) * u); ctx.stroke();
      }
    }
    ctx.restore();
  };

  AQ.sprites.eyePoint = function (fig, x, y, w, h) {
    if (!fig) return null;
    var body = bodyMetrics(x, y, w, h, fig.body);
    var head = headMetrics(x, y, w, h, body);
    return { x: head.hx + head.w * 0.5, y: head.hy + head.h * 0.53 };
  };

})(window.AQ = window.AQ || {});
