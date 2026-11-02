/* =============================================================
   render/room.js — 部屋（室内）の絵
   -------------------------------------------------------------
   kibble のような「1つの掲示板部屋」だけで完結するログ用の描画。
   scene.js（街）と公開APIをそろえてあります: init / prepare / render /
   computeRobotScreenPositions。main.js は stage.js 経由でどちらかを呼ぶだけで、
   呼び出し側からは街と部屋の違いが見えません。

   ★ なぜ街と別ファイルにしたか（README「街と部屋（どちらの画面になるか）」参照）
     kibble には「複数の建物のあいだを移動する」という事実が無い。
     ぜんぶ同じ1部屋の中で起きている。街の絵をそのまま使うと、
     存在しない移動を描いてしまう＝分からないことを描かない、に反する。
     scene.js は触らず（動いていて検証済みなので）、室内専用の
     描画をこちらに独立して書く、というのがこのファイルの役目です。

   ★ 依頼札（カード）はモノとして扱う
     JOB は板に貼られ、CLAIM で手に持たれ、DELIVER でベンチに置かれ、
     ATTEST でスタンプが押される（合格＝緑✓／不合格＝赤✗）。この状態は
     prepare() で全コマぶん先に計算しておくので、seek() でどのコマへ
     飛んでも板の様子は必ず同じになる（scene.js が経路を先に計算して
     おくのと同じ考え方）。

   ★ 2026-09-01 全面リサイズ（下記いずれも「以前は小さすぎて読めなかった」
     というユーザー報告への対応）
     1) data/room.js の tile を 20→40 に上げた（部屋も12×8マスに縮小）。
        このファイルの数値リテラルはすべて T（=W.tile）か、それを元にした
        SCALE（=T/20。スプライトは20px設計のドット絵なので、その原寸に
        対する倍率）から計算する。**20px を前提にしたピクセル直書きは
        禁止**（README の表にある通り、tile を変えたら絵も自動で追随する
        べきなので）。
     2) 板と台を「枠→タイトル帯→中の札」という1つの箱として描く。
        以前は「暗い帯（板）」と「JOB BOARDという別の帯」が離れて
        並んでいて、ユーザーいわく「まず掲示板がどれなのかもわからない」
        状態だった。
     3) 板・納品口・検品台に並べる札の枚数に上限を設け（config.maxBoardCards /
        maxDropoffCards / maxInspectCards）、超えた分は "+N" と正直に出す
        （枚数を隠さない）。
     4) 同時に描くロボットの上限（config.maxRobots）を設け、超えた分は
        「他 N 体」と件数で出す。名札は「今フレームに描いた名札の矩形」
        同士がぶつからないように、ぶつかったら上へずらす（それでも
        入らなければ諦めて描かない＝それでも件数は嘘をつかない）。
     5) 札はもう ID を描かない（大きく kind だけを出す）。ID は実況欄
        （hud.js）と生ログ行に残っているので、情報としては消えていない。

   ★ テスト用のフックについて
     このファイルの「どこに何を描くか」の計算（板・台の枠の位置、
     札の矩形、ロボットの位置、名札の矩形）は、canvas に実際に描く
     処理からできる限り分離してある（computeBoardLayout / computeDropoffLayout /
     computeInspectLayout / computeRobotScreenPositions）。文字幅は ctx.measureText を使わず
     textWidth()（フォントサイズからの概算・等幅フォント前提）で
     計算しているので、これらの関数は本物の <canvas> が無い Node.js
     からでも（AQ.room.init に最低限のスタブを渡せば）呼べる。
     tools/ 以下や CI で「板の枚数＋overflow＝正しい件数」のような
     数え間違いを機械的に検査できるようにするための設計。
   ============================================================= */
(function (AQ) {
  'use strict';

  var C, ctx, cfg, S, W, T;

  /* スプライト・フォント・演出の座標はもともと tile:20 を前提に
     ピクセル直書きされていた。SCALE はその設計原寸に対する倍率。
     tile が40なら SCALE=2、将来また変えても比率はそのまま保たれる。 */
  var SCALE = 1;
  function U(n) { return Math.round(n * SCALE); }   // 「20px設計の絵」用の換算

  var WALK_UNTIL = 0.7;
  /* ★ 2026-09-28: 1マス歩くのにかかる時間（再生速度1倍のミリ秒）。
     どのコマでも、道の長さや件数にかかわらずこの速さで歩く。
     0.25倍なら 1マス 1.4秒＝毎秒 0.7マスほど（以前の「ふつうの速さ」と同じくらい）。 */
  var MS_PER_TILE = 700;   // ★ 2026-10-03: 350→700（歩く速さを半分に。利用者の要望）

  function routeLen(route) {
    if (!route || route.length < 2) return 0;
    var d = 0;
    for (var i = 1; i < route.length; i++) {
      d += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    }
    return d;
  }
  /* ★ 2026-10-07: 家具の前で「立ち止まって手を伸ばす」時間。
     報告「掲示板にあった仕事を引き受けたとあるが、掲示板に手を伸ばして
     仕事が書かれた紙を取るという行動のアニメーションが欲しい。同様の
     問題はすべて探し出して」。往復の途中（板の前・納品口の前）で
     この時間だけ止まり、腕を伸ばして札を取る／メモを貼る／品物を拾う。
     歩く速さ（MS_PER_TILE）は変えず、そのぶんコマを長くする
     （engine/clock.js が walkMsFor() を見る）。 */
  var STOP_MS = 2000;
  /* ★ 2026-10-19: 働き手が引き受けてから納品するまでの「作業」。利用者の報告
     「札を受け取ったあと、納品するまでぼーっと立っているだけ」への対応。
     納品のコマの最初に、自分の机で札に書き込む作業をこの時間だけ見せる。
     作業の中身（どのAIを使ったか等）は掲示板に書かれないので描かない。
     絵は「机で札に字が増えていく」だけ。かかった実時間は記録から分かるときだけ添える。 */
  var WORK_MS = 3600;
  /* 立ち止まっている間（0..1）の時間割。どの「取る」も同じ区切り。 */
  var REACH_END = 0.36,   // ここまでに腕が札に届く
      GRAB_AT   = 0.46,   // ここで札をつかむ（つかんだ瞬間に板・台から離れる）
      LIFT_END  = 0.54,   // 画鋲が外れて、札が少し持ち上がる
      BACK_END  = 0.86;   // ここまでに腕が戻り、札は手の位置に収まる
  /* 依頼を板に貼る（①出した）／メモを貼る（書き込み）の時間割。 */
  var PIN_AT = 0.42, PIN_REACH = 0.34, PIN_BACK = 0.74;
  /* ★ 2026-10-17 書き込み（ただの発言）は「板に書く」動作（利用者の要望：掲示板に行く＝札を貼る／書き込む＝書く）。
     ペンを板に当てて、字が左から少しずつ増えていく時間を長めにとる。 */
  var WRITE_REACH = 0.14, WRITE_DONE = 0.62, WRITE_BACK = 0.78;

  /** 経路のうち、立ち止まる点（route.stopIdx）までの距離の割合。 */
  function stopFrac(route) {
    if (!route || route.stopIdx == null) return null;
    var tot = routeLen(route);
    if (tot <= 0) return 0;
    return routeLen(route.slice(0, route.stopIdx + 1)) / tot;
  }
  /** 歩く時間＋立ち止まる時間（1倍のミリ秒）。 */
  function actionMsOf(route) {
    var wm = Math.round(routeLen(route) * MS_PER_TILE);
    var st = (route && route.stopIdx != null) ? (route.stopMs || STOP_MS) : 0;
    return { wm: wm, st: st, total: wm + st };
  }
  function beatDurFor(beat, total) {
    var base = (cfg.beatMs && cfg.beatMs[beat.kind]) || 1200;
    return total > 0 ? Math.max(base, Math.round(total / WALK_UNTIL)) : base;
  }
  /** このコマで本人が歩く道。絞り込み中の組み直した道が優先。 */
  function routeOfBeat(beat) {
    if (!beat) return null;
    return (focusPlan && focusPlan.routes && focusPlan.routes[beat.index]) || beat._route || null;
  }
  /** 歩く（＋立ち止まる）のに要る時間（1倍のミリ秒）。0 なら歩かない。 */
  function walkMsFor(beat) {
    return actionMsOf(routeOfBeat(beat)).total;
  }
  /** コマの中の進み具合 p（0..1）→ 道のどこまで歩いたか（w 0..1）と、
      立ち止まっている間ならその進み具合（stopQ 0..1、それ以外は null）。
      速さは一定。p だけで決まる＝どこへ seek しても同じ絵。 */
  function tripAt(beat, p, route) {
    var a = actionMsOf(route);
    if (a.total <= 0) return { w: 1, stopQ: null, past: true };
    var t = Math.max(0, Math.min(1, p || 0)) * beatDurFor(beat, a.total);
    if (!a.st) { var r = a.wm > 0 ? Math.min(1, t / a.wm) : 1; return { w: r, stopQ: null, past: r >= 1 }; }
    var f = stopFrac(route), t1 = a.wm * f, t2 = t1 + a.st;
    if (t < t1) return { w: t / a.wm, stopQ: null, past: false };
    if (t < t2) return { w: f, stopQ: (t - t1) / a.st, past: false, stopping: true };
    var w = a.wm > 0 ? Math.min(1, (t - a.st) / a.wm) : 1;
    return { w: w, stopQ: null, past: true };
  }
  function walkRaw(p, beat, route) { return tripAt(beat, p, route).w; }

  /* ★ 2026-09-28: 検品（判定のコマ）の演出の時間割。
     報告:「青い光が台から本人へ当たっていて、本人が身体検査を受けている
     ように見える。本人が品物を調べているように見せたい」。
     検品台に着いてからコマの終わりまでを 0..1（q）として、
       q < VERDICT_AT … 調べている：目から品物へ光、品物が浮いて明滅、
                          手に虫めがね。品物にはまだ合否の印を出さない
       q ≥ VERDICT_AT … 結果：品物に印が付き、品物から ✓/✗ が弾ける
     p（コマの中の位置）だけで決まる＝どこへ seek しても同じ絵になる。
     着く前（歩いている間）は null。 */
  var VERDICT_AT = 0.55;
  /** 目的地に着いてからコマの終わりまでを 0..1 にした値。着く前は -1。 */
  function arrivedQ(beat, p) {
    var a = actionMsOf(routeOfBeat(beat));
    var pA = 0;
    if (a.total > 0) pA = Math.min(1, a.total / beatDurFor(beat, a.total));
    var pp = Math.max(0, Math.min(1, p || 0));
    if (pp < pA) return -1;
    return pA >= 1 ? 1 : (pp - pA) / (1 - pA);
  }

  /* ★ 2026-09-28: 納品の演出の時間割。
     報告:「納品している感じが出ていない。品物はもう納品口に置かれていて、
     足もとの黒い楕円から粒が上へ噴き出しているだけ」。
     納品口に着いてからコマの終わりまでを 0..1（q）として、
       q < DROP_REACH    … 腕を伸ばし、品物を投入口の真上へ運ぶ（ふたが開く）
       q < DROP_RELEASE  … 手を放す
       q < DROP_LAND     … 品物が重さで投入口へ落ちていき、口の中へ消える
       q ≥ DROP_LAND     … 入った瞬間、口のふちで砂ぼこりが横へ弾ける。
                            品物が納品口の中に並び、看板の数が1つ増える。ふたが閉まる
     p だけで決まる（どこへ seek しても同じ絵）。着く前は null。 */
  var DROP_REACH = 0.28, DROP_RELEASE = 0.36, DROP_LAND = 0.62;
  function deliverPhase(beat, p, index) {
    var m = (beat && beat.lead && beat.lead.meta) || {};
    if (!beat || beat.kind !== 'receive' || m.verdict || m.job == null || isWriteBeat(beat)) return null;
    var q = arrivedQ(beat, p);
    if (q < 0) return null;
    var ac = (index != null) ? actOfBeat(beat, index) : null;
    return { q: q, landed: q >= DROP_LAND, job: String(m.job), key: (ac && ac.key) || String(m.job) };
  }

  function inspectPhase(beat, p, index) {
    var m = (beat && beat.lead && beat.lead.meta) || {};
    if (!m.verdict) return null;
    var q = arrivedQ(beat, p);
    if (q < 0) return null;
    var ac = (index != null) ? actOfBeat(beat, index) : null;
    return { q: q, done: q >= VERDICT_AT, t: q >= VERDICT_AT ? (q - VERDICT_AT) / (1 - VERDICT_AT) : 0,
             job: m.job != null ? String(m.job) : null, ok: m.verdict === 'useful',
             key: (ac && ac.key) || (m.job != null ? String(m.job) : null) };
  }

  /* ---------- 汎用の描画部品（scene.js / props.js と同じ流儀。
     ファイルをまたいだ共有はしない＝1ファイルで完結させる） ---------- */
  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w, h); }

  /* 検査用：この1フレームで描いた文字と、合否の印。
     「OK」という英単語をやめて✓にした、といった約束は、絵を目で見ても
     証明にならない。描いた側に数えさせる（2026-09-27）。 */
  var lastLabelsDrawn = [];
  var lastMarksDrawn = [];
  var lastMoodDrawn = null;   // 検査用：主役の表情（2026-10-03）
  /* 検査用：家具の看板に何を出したか（絵の種類と、そこに刻んだ件数）。
     「日本語の見出しを消した」「件数は残した」を数字で確かめるため。 */
  var lastSignsDrawn = [];

  function label(s, x, y, color, size) {
    lastLabelsDrawn.push(String(s == null ? '' : s));
    ctx.fillStyle = color;
    ctx.font = (size || 6) + 'px "Press Start 2P", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(s, x, y);
  }

  /* ctx.measureText には頼らない（ヘッドレス環境・テストからも同じ
     結果で呼べるようにするため）。Press Start 2P はほぼ等幅なので、
     フォントサイズに対する比率で幅を見積もる。実寸より少し広めに
     見積もっておけば、はみ出す方向の事故は起きない。 */
  function textWidth(s, size) {
    s = String(s == null ? '' : s);
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      // ASCIIより幅の広い文字（日本語など）は広めに見積もる。実測（ctx.measureText）
      // に頼らないのは、canvas の無いテスト環境からも同じ計算を呼べるようにするため。
      //
      // 2026-09-02: 実データで「BUIL」「XPL」「RSRC」のように札の最後の
      // 1文字が切れる報告があった。原因はこの係数が Press Start 2P
      // （フォントが読み込めない環境ではフォールバックの等幅フォント）の
      // 実際の字幅より狭く見積もっていたこと＝ fitSize() が「収まる」と
      // 判断したサイズが、実際には収まっていなかった。安全側（広め）に
      // 寄せて、はみ出す方向の事故を防ぐ。
      w += (s.charCodeAt(i) > 127) ? size * 1.15 : size * 0.75;
    }
    return w;
  }

  /** maxW に収まるフォントサイズを探す（大きい方から縮める）。
      どれだけ縮めても収まらない場合は minSize で打ち切る（切り詰めない＝
      文字は最後まで全部描く。読みにくくても、勝手に文字を消して
      「情報を隠す」よりまし、という判断）。 */
  function fitSize(s, maxW, maxSize, minSize) {
    var size = maxSize;
    while (size > minSize && textWidth(s, size) > maxW) size--;
    return size;
  }

  function centered(s, cx, cy, color, size) {
    var w = textWidth(s, size);
    label(s, Math.round(cx - w / 2), Math.round(cy - size / 2), color, size);
  }

  /** fn() の描画を rect の内側だけに強制的に閉じ込める（保険）。
      textWidth() の見積もりが実際のフォント幅より狭かった場合でも
      （＝2026-09-02 の「札の最後の1文字が切れる」原因）、隣の札の
      上に文字がはみ出して重ね描きされる事故だけは、これで必ず防げる。
      文字そのものが見切れる可能性は残るが、隣の情報を壊すよりまし
      （分からないことを描かない＝他人の枠を侵さない、の徹底）。 */
  function clipped(rect, fn) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    fn();
    ctx.restore();
  }

  function bubble(x, y, w, h) {
    px(x - 1, y - 1, w + 2, h + 2, '#0d1017');
    px(x, y, w, h, '#f2f5fa');
    px(x, y, w, 1, '#ffffff');
    px(x, y + h - 1, w, 1, '#b9bfcc');
  }

  /* 2026-09-04: sprites.js が16×20→32×40に倍精細化された。SPRITE_W/H は
     その新しい原寸そのもの。画面上の見かけの大きさ（footprint）は
     今までと寸分たがわず変えたくないので、SCALE（=T/20。フロア柄や
     枠の太さなど、スプライト以外の「20px設計」の絵ぜんぶが使っている
     一般の換算率）はそのまま触らず、スプライトの原寸換算だけ別に
     SPRITE_SCALE（=T/40）を持つ。T=40なら SPRITE_SCALE=1 になり、
     「新しい32×40の絵を等倍そのまま描く」＝以前の
     SPRITE_W(16)×SCALE(2)=32px という footprint と完全に一致する
     （倍精細化ぶんがそのまま画面の精細さに乗る＝ダウンサンプル無し）。 */
  /* ロボットの footprint（ワールド単位）。実解像度で描くようになったので
     大きくしても荒くならない。「41px 幅は指の爪ほど」という報告への対応で
     約2.2倍にした（画面上でおよそ90〜100px幅になる）。 */
  var SPRITE_W = 70, SPRITE_H = 88;
  var SPRITE_SCALE = 1;               // init() で T/40 から計算

  function sprite(map, ox, oy, flip, pal) {
    pal = pal || cfg.palette;
    for (var y = 0; y < map.length; y++) {
      var row = map[y];
      for (var x = 0; x < row.length; x++) {
        var ch = row[flip ? (row.length - 1 - x) : x];
        if (ch === '.') continue;
        var col = pal[ch];
        if (col) px(ox + x * SPRITE_SCALE, oy + y * SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE, col);
      }
    }
  }

  /* actor名 → 専用パレット。
     ★ 2026-09-06: 以前は車体色（'2'と'3'）をエージェント色でまるごと
     塗り替えていたため、body 全体が濃い単色グラデーションになり、
     せっかくのベクター描画が「黄色い塊」に見えていた。
     車体は白〜灰のまま少しだけ色味を寄せ、はっきりした色は
     アクセント（ライトバー '7' / 差し色 'b' / 目 '6'）に載せる。 */
  function mix(hex, other, t) {
    function toRgb(c) {
      c = String(c).replace('#', '');
      if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
      return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
    }
    var a = toRgb(hex), b2 = toRgb(other);
    return '#' + [0,1,2].map(function (i) {
      var v = Math.round(a[i] + (b2[i] - a[i]) * t);
      return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
    }).join('');
  }
  var tintCache = {};
  function paletteFor(actor) {
    var name = actor || 'agent';
    if (tintCache[name]) return tintCache[name];
    /* room.js には scene.js の ACTOR_TINTS が無い。名簿（roster.js）と
       同じ色を使えば、一覧のチップ・実況のバッジ・ロボットが必ず揃う。 */
    var base = (AQ.roster && AQ.roster.colorFor) ? AQ.roster.colorFor(name) : '#8fd0ff';
    var pair = [base, base];
    var pal = {};
    Object.keys(cfg.palette).forEach(function (k) { pal[k] = cfg.palette[k]; });
    pal['2'] = mix(cfg.palette['2'], pair[0], 0.18);   // 車体（明）にほんのり
    pal['3'] = mix(cfg.palette['3'], pair[1], 0.22);   // 車体（中）にほんのり
    pal['7'] = pair[0];                                 // ライトバー等ははっきり
    if (pal['b'] != null) pal['b'] = pair[0];           // 差し色も
    pal['6'] = pair[0];                                 // 目・表示
    tintCache[name] = pal;
    return pal;
  }

  /* actor名 → その人専用のドット絵（task D）。AQ.sprites.build が無い
     （古いビルド・テスト環境）場合は共通の S にフォールバックする。 */
  var spriteCache = {};
  function spriteFor(actor) {
    var name = actor || 'agent';
    if (spriteCache[name]) return spriteCache[name];
    var sm = AQ.sprites.figureFor(name);
    spriteCache[name] = sm;
    return sm;
  }

  /* ---------- 名札（衝突回避つき） ----------
     同じマスに複数ロボットが集まる（板の前・台の前など）と、以前は
     名札どうしが完全に重なって「#6#4#9」のような判読不能な文字の
     山になっていた。1フレームぶんの「もう描いた名札の矩形」を
     tagRects に積んでおき、重なるなら上へずらし、それでも入らなければ
     描かない（件数はロボットの数として別に描いているので、名札を
     1つ諦めても「何体いるか」自体は嘘にならない）。 */
  var TAG_FONT = 0, TAG_PAD = 0;   // init() で T から計算

  function rectsOverlap(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }

  /** 横方向にだけ等間隔でずらした候補点を作る。stepX 刻みの候補どうしは
      矩形の幅ぶん以上離れているので、どの2つを選んでも絶対に重ならない
      （＝この配列から重複なしに何点選んでも安全、という性質を後で使う）。 */
  function hFan(stepX, maxK) {
    var out = [[0, 0]];
    for (var k = 1; k <= maxK; k++) { out.push([k * stepX, 0]); out.push([-k * stepX, 0]); }
    return out;
  }

  /** forbidden（矩形の配列。省略時は「禁止区域なし」）のどれかと重なるか。
      板・台の枠の上には名札を置かない（2026-09-02 の「#14 #2 … が
      掲示板の枠に重なっている」報告への対応）に使う。 */
  function forbiddenHit(rect, forbidden) {
    if (!forbidden) return false;
    for (var i = 0; i < forbidden.length; i++) {
      if (rectsOverlap(forbidden[i], rect)) return true;
    }
    return false;
  }

  /** placedRects（このフレームで既に確定した矩形の配列。呼び出し側が
      フレームの最初に空配列を渡し、以後の呼び出しへ使い回す）に対して、
      candidates（[dx,dy] の配列。baseX,baseY からの相対オフセット）を
      順に試し、重ならない位置が見つかったら積んで返す。見つからなければ
      null。部屋の内側へ必ずクランプする（壁の外に出ることは絶対にない）。
      forbidden を渡すと、その矩形（板・台の枠など）に重なる候補は
      衝突判定と同じ扱いで飛ばす。 */
  function tryPlace(placedRects, baseX, baseY, w, h, candidates, forbidden) {
    var bounds = roomBounds();
    for (var i = 0; i < candidates.length; i++) {
      var x = Math.round(baseX + candidates[i][0]);
      var y = Math.round(baseY + candidates[i][1]);
      x = Math.max(bounds.x, Math.min(bounds.x + bounds.w - w, x));
      y = Math.max(bounds.y, Math.min(bounds.y + bounds.h - h, y));
      var rect = { x: x, y: y, w: w, h: h };
      if (forbiddenHit(rect, forbidden)) continue;
      var hit = false;
      for (var j = 0; j < placedRects.length; j++) {
        if (rectsOverlap(placedRects[j], rect)) { hit = true; break; }
      }
      if (!hit) return rect;
    }
    return null;
  }

  /** ロボット本体（スプライト）の衝突回避。同じマスに複数体が集まると
      （板の前・台の前など）、以前は名札だけ離して本体は完全に重ねて
      描いていた＝「ロボットが数体のブロブに融合して見える」という
      報告への対応。名札と同じ「横方向に stepX 刻みでずらす」方式を使う
      （stepX ≧ 幅 なので、選んだ候補どうしは常に非交差＝maxRobots(8) が
      守られている限り、必ずどこかに置き場所が見つかる）。 */
  /** ★ 2026-09-06: ロボットが検品台（と掲示板）に食い込む、という報告への
      対応。ロボットを2.2倍に拡大したぶん、机の位置から下に伸びて台の枠に
      重なるようになっていた。床の帯（板の下端〜台の上端、左右の壁の内側）に
      収まるよう最後に押し戻す。押し戻しても他と重ならないかは
      tryPlace 側の候補探索で担保する。 */
  function floorBand() {
    var b = roomBounds();
    var top = b.y, bot = b.y + b.h, left = b.x, right = b.x + b.w;
    var bo = findObj('board'), doff = findObj('dropoff'), insp = findObj('inspect');
    if (bo) top = Math.max(top, objRect(bo).y + objRect(bo).h);
    /* 納品口・検品台は横に並ぶ2つの家具。どちらの上端が高くても
       （＝どちらか片方でも）床の帯はそこまでしか使えないので、
       小さい方（画面上でより上）を使う。 */
    [doff, insp].forEach(function (o) {
      if (o) bot = Math.min(bot, objRect(o).y);
    });
    /* 左右の壁（歩けないマス）は ground の端。1マスぶん内側に寄せる。 */
    return { x: left + T, y: top, w: (right - T) - (left + T), h: bot - top };
  }

  function clampToFloor(rect) {
    var f = floorBand();
    rect.x = Math.max(f.x, Math.min(f.x + f.w - rect.w, rect.x));
    rect.y = Math.max(f.y, Math.min(f.y + f.h - rect.h, rect.y));
    return rect;
  }

  function placeSpriteRect(placedRects, baseX, baseY, w, h) {
    var stepX = w + U(3);
    var rect = tryPlace(placedRects, baseX, baseY, w, h, hFan(stepX, 8));
    if (rect) rect = clampToFloor(rect);
    if (!rect) {
      // 保険（maxRobots を守っている限りここには来ないはず）。
      var bounds = roomBounds();
      rect = {
        x: Math.max(bounds.x, Math.min(bounds.x + bounds.w - w, baseX)),
        y: Math.max(bounds.y, Math.min(bounds.y + bounds.h - h, baseY)),
        w: w, h: h
      };
      rect = clampToFloor(rect);
    }
    placedRects.push(rect);
    return rect;
  }

  /** 名札の衝突回避。ただし「自分のスプライトから離れすぎた名札は、
      もう誰の名札か分からず、名札が無いより悪い」という報告があったため、
      まず自分のスプライトの真上・半径 T/2（半マス）以内だけを候補にする。
      それでも置き場所が無いくらい混み合っている場合だけ、もっと遠くまで
      探しにいく代わりに leader:true を返す（drawTag が引き出し線を描き、
      「離れてはいるが確かにこのロボットの名札だ」と分かるようにする）。

      forbidden（板・台の枠の矩形の配列）に重なる候補は、衝突判定と
      同じ扱いで最初から除外する。2026-09-02: 板の「at」タイル（板の
      すぐ下の行）に立つロボットは、真上に名札を置こうとすると板の
      枠そのものに重なってしまう（床の余白が半マスも無いため）という
      報告があった＝これまでは「上」しか候補が無かったのが原因。
      「上」が禁止区域や衝突でふさがっていれば「下」を試す、という
      2方向探索にする（近距離→遠距離、それぞれ上→下の順）。 */
  function placeTagRect(tagRects, spriteRect, w, h, forbidden) {
    var cx0 = spriteRect.x + spriteRect.w / 2;
    var aboveY0 = spriteRect.y - h - U(2);
    var belowY0 = spriteRect.y + spriteRect.h + U(2);
    var anchor = { x: cx0, y: spriteRect.y };
    var R = T / 2;
    var stepX = w + U(3), stepY = h + U(2);
    var baseX = cx0 - w / 2;

    var nearX = hFan(stepX, Math.max(0, Math.floor(R / stepX)));

    var nearAbove = nearX.slice();
    for (var v = 1; v * stepY <= R; v++) nearAbove.push([0, -v * stepY]);
    var rect = tryPlace(tagRects, baseX, aboveY0, w, h, nearAbove, forbidden);
    if (rect) { tagRects.push(rect); return { rect: rect, leader: false, anchor: anchor }; }

    var nearBelow = nearX.slice();
    for (var v2 = 1; v2 * stepY <= R; v2++) nearBelow.push([0, v2 * stepY]);
    rect = tryPlace(tagRects, baseX, belowY0, w, h, nearBelow, forbidden);
    if (rect) { tagRects.push(rect); return { rect: rect, leader: false, anchor: anchor }; }

    var startK = Math.floor(R / stepX) + 1;
    var far = [];
    for (var k2 = startK; k2 <= startK + 8; k2++) { far.push([k2 * stepX, 0]); far.push([-k2 * stepX, 0]); }
    var startV = Math.floor(R / stepY) + 1;

    var farAbove = far.slice();
    for (var v3 = startV; v3 <= startV + 4; v3++) farAbove.push([0, -v3 * stepY]);
    rect = tryPlace(tagRects, baseX, aboveY0, w, h, farAbove, forbidden);
    if (rect) { tagRects.push(rect); return { rect: rect, leader: true, anchor: anchor }; }

    var farBelow = far.slice();
    for (var v4 = startV; v4 <= startV + 4; v4++) farBelow.push([0, v4 * stepY]);
    rect = tryPlace(tagRects, baseX, belowY0, w, h, farBelow, forbidden);
    if (rect) { tagRects.push(rect); return { rect: rect, leader: true, anchor: anchor }; }

    // 最後の保険：重なってもいいので基準位置に置く（描かない、より良い）。
    // ただし上下のどちらに置くかは、板・台にだけは絶対に重ねないほうを選ぶ
    // （衝突は許しても、家具の上に名札が乗って見える事故だけは避ける）。
    var bounds = roomBounds();
    function clamp(y0) {
      return {
        x: Math.max(bounds.x, Math.min(bounds.x + bounds.w - w, Math.round(baseX))),
        y: Math.max(bounds.y, Math.min(bounds.y + bounds.h - h, y0)),
        w: w, h: h
      };
    }
    var aboveClamp = clamp(aboveY0);
    rect = forbiddenHit(aboveClamp, forbidden) ? clamp(belowY0) : aboveClamp;
    tagRects.push(rect);
    return { rect: rect, leader: true, anchor: anchor };
  }

  function drawTag(text, tag) {
    if (!tag || !tag.rect) return;   // 置き場所が無かった＝諦めて描かない（衝突を描くよりまし）
    var rect = tag.rect;
    if (tag.leader) {
      // 自分のスプライトから離れた場所に置いた名札だと分かるように、
      // スプライトへ細い引き出し線を1本引く。
      ctx.strokeStyle = 'rgba(242,245,250,.55)';
      ctx.lineWidth = Math.max(1, U(1));
      ctx.beginPath();
      ctx.moveTo(rect.x + rect.w / 2, rect.y + rect.h);
      ctx.lineTo(tag.anchor.x, tag.anchor.y);
      ctx.stroke();
    }
    var x = rect.x, y = rect.y;
    // 2026-09-02: 名札は Press Start 2P だと、この小ささでは '6' が
    // 'G' に見えるという報告があった（ドット絵フォントは小サイズでの
    // 数字の判別を優先して設計されていないため）。数字を最優先で読み
    // 違えてはいけない場所なので、名札だけ IBM Plex Mono（本文と同じ、
    // 数字がはっきり分かれている等幅フォント）に変える。板・台の見た目
    // （Press Start 2P のまま）には影響しない。
    ctx.font = TAG_FONT + 'px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'top';
    var o = Math.max(1, U(1));
    ctx.fillStyle = '#14161f';
    ctx.fillText(text, x - o, y);
    ctx.fillText(text, x + o, y);
    ctx.fillText(text, x, y - o);
    ctx.fillText(text, x, y + o);
    ctx.fillStyle = '#f2f5fa';
    ctx.fillText(text, x, y);
  }

  /* ---------- 自分の机（複数エージェント同時表示の要） ----------
     data/room.js の places.desks から、名前のハッシュで1つ選ぶ。
     scene.js の homeFor/idleFor と同じ考え方（AQ.roster.colorFor と
     同じハッシュ表を使っているわけではないが、式は同じ・pool が違うだけ）。 */
  function hashStr(s) {
    var name = String(s || 'agent');
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h;
  }

  function pickFromPool(name, pool, assigned) {
    if (!pool || !pool.length) return null;
    var h = hashStr(name), n = pool.length;
    for (var k = 0; k < n; k++) {
      var idx = (h + k) % n;
      var key = pool[idx].join(',');
      if (!assigned[key]) { assigned[key] = name; return pool[idx]; }
    }
    return pool[h % n];
  }

  var actorDesk = {};
  function deskFor(actor) {
    var name = actor || 'agent';
    return actorDesk[name] || (W.places.desks && W.places.desks[0]) || [1, 1];
  }

  /* ---------- どのコマがどこで起きるか ----------
     街の PLACE_OF と同じ役目。部屋には建物が無いので、行き先は
     「自分の机」「依頼板」「納品口」「検品台」の4か所だけ。

     ★ 2026-09-06 (2): 以前は 'receive'/'error' を両方まとめて検品台
     （bench）へ送っていた。しかし 'receive' は DELIVER（納品＝まだ
     判定されていない）と ATTEST useful（判定＝合格）の両方をまとめた
     コマ種別で、'error' は ATTEST not（判定＝不合格）を表す。
     「納品する場所が無い、判定する場所も無い」という報告は、この
     2つの別々の出来事が同じ場所に描かれていたことが原因だったので、
     ここで meta.verdict / meta.job を見て行き先を分ける。 */
  /** ★ 2026-09-18: 「書き込み」のコマ。kibble の大半はこれ——JOB/CLAIM/
      DELIVER/ATTEST のどれでもないただの発言で、アダプタが
      tool.call + result.ok の対にしている（meta.job は付かない）。
      これまでは行き先が「掲示板」だけだったので、最初の1コマで板の前へ
      行ったきり、そのあとは何十コマも棒立ちのまま「書き込みをまとめて
      記録した」と出ていた（利用者の報告「何の面白みもありません」）。
      書き込みは「机で書いて、板に貼りに行って、机に戻る」——往復にする。
      こうすると必ず机で始まり机で終わるので、コマが飛んでも位置が
      食い違わない＝ワープも同時に消える。 */
  function isWriteBeat(b) {
    if (!b) return false;
    var m = (b.lead && b.lead.meta) || {};
    if (b.kind === 'actbatch') return true;
    if (m.job) return false;
    return b.kind === 'travel' || b.kind === 'receive' || b.kind === 'plan';
  }

  /** そのコマが表している「書き込みの回数」。
      発言1件につきアダプタが tool.call と result.ok を1つずつ作るので、
      イベント数を数えると倍になる。同じ発言は同じ seq を持つので、
      seq の種類数＝本当の書き込み回数（推定ではなく実数）。 */
  function writeCountOf(b) {
    var evs = (b && b.events) || (b && b.lead ? [b.lead] : []);
    var seen = {}, n = 0;
    evs.forEach(function (e) {
      var k = (e && e.meta && e.meta.seq != null) ? String(e.meta.seq) : null;
      if (k == null) { n++; return; }
      if (!seen[k]) { seen[k] = true; n++; }
    });
    return n || 1;
  }

  function placeOf(b) {
    var m = (b.lead && b.lead.meta) || {};
    switch (b.kind) {
      case 'start': case 'end': case 'idle':
        return deskFor(b.actor);
      case 'receive':
        if (m.verdict === 'useful') return W.places.inspect;   // ATTEST useful＝判定
        if (m.job) return W.places.dropoff;                    // DELIVER＝納品（判定待ち）
        return W.places.board;                                 // job の無い雑談返信は既定の場所へ
      case 'error':
        if (m.verdict === 'not') return W.places.inspect;      // ATTEST not＝判定
        return W.places.board;
      case 'plan': case 'planbatch':
      case 'travel': case 'batch': case 'actbatch':
      case 'require': case 'pay': case 'settle':
        // require/pay/settle は kibble では起こらない想定（payment.* が無いログしか
        // 部屋には来ない＝ stage.js の選び方）。来ても板の前で待つだけにしておく。
        return W.places.board;
      default:
        return W.places.board;
    }
  }

  /** actor名 → そのエージェントが登場するコマ番号の並び（時系列順） */
  var actorBeats = null;

  /** すべてのコマの道すじを先に決める。scene.js の prepare() と同じ考え方だが、
      CLAIM（tool.call かつ meta.job あり）だけは特別扱い:
      板へ行って、そのまま自分の机まで持ち帰る往復にする
      （依頼をやります、とだけ言って板の前に立ち尽くすのは絵として変なので）。 */
  function prepare(beats) {
    workLabelMemo = {};
    actorBeats = {};
    actorDesk = {};
    beats.forEach(function (b, i) {
      var actor = b.actor || 'agent';
      (actorBeats[actor] || (actorBeats[actor] = [])).push(i);
    });

    var deskAssigned = {};
    Object.keys(actorBeats).sort().forEach(function (actor) {
      actorDesk[actor] = pickFromPool(actor, W.places.desks, deskAssigned) || (W.places.desks && W.places.desks[0]) || [1, 1];
    });

    /* 札の動き（誰がいつ取ったか）を先に作る。検品の道すじ（納品口に
       品物があるなら、まずそこへ拾いに行く）がこれを見るため。 */
    buildCardTimeline(beats);

    Object.keys(actorBeats).forEach(function (actor) {
      var at = deskFor(actor);
      actorBeats[actor].forEach(function (i) {
        var b = beats[i];
        var route = routeFor(at, b, actor, i);
        b._route = route;
        at = route[route.length - 1];
      });
    });
  }

  /** CLAIM（tool.call かつ meta.job あり）か。 */
  function isClaimBeat(b) {
    var m = (b && b.lead && b.lead.meta) || {};
    return !!(b && b.kind === 'travel' && m.job);
  }
  /** そのコマの道すじ。立ち止まる用事がある道には stopIdx（立ち止まる点の
      番号）・stopKind・stopFrom（どの家具の前か）を付ける（AQ.path.find の
      戻り値は使い回されることがあるので、印は必ず concat で作った新しい
      配列にだけ付ける）。
        claim  … 机 → 板（手を伸ばして札を取る）→ 机
        memo   … 机 → 板（メモを貼る）→ 机
        pickup … → 納品口（品物を拾う）→ 検品台
        fetch  … → 板／検品台（自分の札・品物を取る）→ 納品口（納品する） */
  function viaRoute(at, stopAt, goal, kind, from) {
    var a1 = AQ.path.find(at, stopAt, W);
    var a2 = AQ.path.find(stopAt, goal, W);
    var r = a1.concat(a2.slice(1));
    r.stopIdx = a1.length - 1; r.stopKind = kind; r.stopFrom = from;
    return r;
  }
  function routeFor(at, b, actor, i) {
    var route;
    var ac = actOfBeat(b, i);
    if (isClaimBeat(b) || isWriteBeat(b)) {
      /* 引き受けで立ち止まるのは、このコマで板から札を取ったときだけ
         （もう自分の札を持っている子が引き受けなおした、などでは取る札が無い）。 */
      if (isClaimBeat(b) && !(ac && ac.kind === 'claim')) {
        return AQ.path.find(at, W.places.board, W).concat(AQ.path.find(W.places.board, deskFor(actor), W).slice(1));
      }
      return viaRoute(at, W.places.board, deskFor(actor), isClaimBeat(b) ? 'claim' : 'memo', 'board');
    }
    if (ac && ac.kind === 'attest' && (ac.from === 'dropoff' || ac.from === 'board')) {
      /* 納品口の品物（納品の記録が無ければ板の札）を取ってから検品台へ */
      return viaRoute(at, W.places[ac.from], W.places.inspect, 'pickup', ac.from);
    }
    if (ac && ac.kind === 'deliver' && ac.from === 'hand') {
      /* 引き受けて持ち帰った札：机で作業してから納品口へ */
      var wr = viaRoute(at, deskFor(actor), W.places.dropoff, 'work', 'desk');
      wr.stopMs = WORK_MS;
      return wr;
    }
    if (ac && ac.kind === 'deliver' && (ac.from === 'board' || ac.from === 'inspect')) {
      return viaRoute(at, W.places[ac.from], W.places.dropoff, 'fetch', ac.from);
    }
    var goal = placeOf(b);
    route = AQ.path.find(at, goal, W);
    if (route.length === 1 && (at[0] !== goal[0] || at[1] !== goal[1])) {
      console.warn('[room] 経路なし:', at, '→', goal,
                   '— data/room.js の objects が歩道を塞いでいないか確認してください');
    }
    return route;
  }

  /* ---- 実際に再生するコマだけで経路を組み直す（2026-09-12(3)）--------
     報告:「エージェントがワープして移動しています」。
     原因: prepare() は「間引く前の全コマ」を1本につないで経路を作る
     （前のコマの終点＝次のコマの出発点）。ところがいまは①〜④の代表
     コマだけ、エージェントを選んだときはさらにその子のコマだけを
     再生する。すると、描いていないコマの終点から次の経路が始まるので、
     画面では前に描いた位置と食い違って「瞬間移動」して見えた。
     直し方: 実際に再生するコマ列（playBeats）だけを、その子の机から
     順につなぎ直した経路をここで持つ。全体用の b._route はそのまま
     （絞り込みを解除したら元の見え方に戻る）。 */
  var focusPlan = null;   // { byActor: {actor:[beatIndex…]}, routes: {beatIndex: route} }

  function setFocusPlan(playBeats) {
    if (!playBeats || !playBeats.length) { focusPlan = null; return; }
    if (!actorBeats) return;              // prepare() 前は何もしない
    var byActor = {}, routes = {};
    playBeats.forEach(function (b) {
      var a = String(b.actor || 'agent');
      (byActor[a] || (byActor[a] = [])).push(b.index);
    });
    Object.keys(byActor).forEach(function (a) {
      /* ★ 2026-09-13: コマ番号で並べ直さない。エージェントの「まとめ」は
         ①②③④の順に場面を並べるので、時刻順とは限らない。渡された
         再生順のまま経路をつなぐ＝画面の動きと経路が食い違わない。 */
      var at = deskFor(a);
      byActor[a].forEach(function (bi) {
        var b = null;
        for (var i = 0; i < playBeats.length; i++) if (playBeats[i].index === bi) { b = playBeats[i]; break; }
        if (!b) return;
        var route = routeFor(at, b, a, bi);
        routes[bi] = route;
        at = route[route.length - 1];
      });
    });
    focusPlan = { byActor: byActor, routes: routes };
  }

  function lastBeatOf(actor, upto) {
    /* 絞り込み中は「実際に再生するコマ」だけを見る。描いていないコマの
       終点にロボットを立たせない＝ワープの原因を断つ。 */
    if (focusPlan) {
      var f = focusPlan.byActor[actor];
      if (!f) return -1;
      /* いま描こうとしているコマ自身が再生対象なら、それがその子の
         「いまいるコマ」（まとめのように再生順とコマ番号が一致しない
         ことがあるので、番号の大小で探さない）。 */
      if (f.indexOf(upto) !== -1) return upto;
      var jf = -1;
      for (var q = 0; q < f.length; q++) { if (f[q] > upto) break; jf = f[q]; }
      return jf;
    }
    var idxs = actorBeats && actorBeats[actor];
    if (!idxs) return -1;
    var j = -1;
    for (var k = 0; k < idxs.length; k++) {
      if (idxs[k] > upto) break;
      j = idxs[k];
    }
    return j;
  }

  /* ---------- カメラ ----------
     data/room.js の view を ground と完全に同じ大きさにしてあるので、
     maxX=maxY=0 に確定する＝部屋はどのコマでも常に画面いっぱい・
     ノーパンで全体が見える。式だけは街と揃えてあるので、万一
     どちらかのサイズを変えても壊れない。 */
  function camera(hx, hy) {
    var cols = W.view.cols, rows = W.view.rows;
    var maxX = Math.max(0, W.ground[0].length - cols);
    var maxY = Math.max(0, W.ground.length - rows);
    return {
      x: Math.max(0, Math.min(maxX, hx - (cols - 1) / 2)),
      y: Math.max(0, Math.min(maxY, hy - (rows - 1) / 2))
    };
  }

  /* ---------- 床 ---------- */
  var FLOOR = {
    walk: '#2f3542', walkHi: '#3a4150', walkLo: '#262b36',
    wall: '#454c5c', wallHi: '#575f70', wallLo: '#2f3540'
  };

  function noise(cx, cy, n) { return ((cx * 73856093) ^ (cy * 19349663) ^ (n * 83492791)) >>> 0; }

  function groundAt(x, y) {
    var row = W.ground[y];
    return (row && row[x]) || 'w';
  }

  function drawFloor(cam) {
    var cols = W.view.cols, rows = W.view.rows;
    for (var ry = -1; ry <= rows; ry++) {
      for (var rx = -1; rx <= cols; rx++) {
        var mx = Math.floor(cam.x) + rx, my = Math.floor(cam.y) + ry;
        var sx = (rx - (cam.x - Math.floor(cam.x))) * T;
        var sy = (ry - (cam.y - Math.floor(cam.y))) * T;
        var ch = groundAt(mx, my);
        if (ch === 'w') {
          px(sx, sy, T, T, FLOOR.wall);
          px(sx, sy, T, U(3), FLOOR.wallHi);
          px(sx, sy + T - U(2), T, U(2), FLOOR.wallLo);
        } else {
          px(sx, sy, T, T, FLOOR.walk);
          px(sx, sy, T, U(1), FLOOR.walkHi);
          px(sx, sy + Math.round(T / 2), T, U(1), FLOOR.walkLo);
          px(sx + Math.round(T / 2), sy, U(1), T, FLOOR.walkLo);
          var n = noise(mx, my, 0);
          px(sx + (n % T), sy + ((n >> 4) % T), U(1), U(1), FLOOR.walkHi);
        }
      }
    }
  }

  /** 机は places.desks の座標そのもの（objects には入れていない＝歩ける）。
      誰も座っていない机も含めて全部描く（部屋の賑わい・家具として）。 */
  function drawDesks(cam) {
    (W.places.desks || []).forEach(function (p) {
      var sx = (p[0] - cam.x) * T, sy = (p[1] - cam.y) * T;
      if (sx < -T || sy < -T || sx > C.width || sy > C.height) return;
      var dx = sx + U(2), dy = sy + U(10), dw = T - U(4), dh = U(7);
      px(dx, dy, dw, dh, '#333846');
      px(dx, dy, dw, U(1), '#454c5c');
      px(sx + U(4), sy + U(4), U(5), U(6), '#22303f');
      px(sx + U(4), sy + U(4), U(5), U(1), '#7fd4ff33');
    });
  }

  function findObj(id) {
    for (var i = 0; i < W.objects.length; i++) if (W.objects[i].id === id) return W.objects[i];
    return null;
  }

  /* ---------- 板・納品口・検品台の枠（テスト可能な純粋計算） ----------
     枠のピクセル矩形・タイトル帯・その中に置く札のスロットは、
     canvas に触れずに計算できるようにしてある（下記の computeBoardLayout /
     computeDropoffLayout / computeInspectLayout がこれをそのまま使う）。
     カメラは常に (0,0) なので、ワールド座標＝画面座標として扱ってよい
     （camera() のコメント参照）。 */
  function objRect(o) { return { x: o.x * T, y: o.y * T, w: o.w * T, h: o.h * T }; }

  function roomBounds() { return { x: 0, y: 0, w: W.view.cols * T, h: W.view.rows * T }; }

  var FRAME_PAD, TITLE_H, CARD_W, CARD_H, CARD_GAP;

  function frameMetrics() {
    return { pad: FRAME_PAD, titleH: TITLE_H };
  }

  /** 枠(rect)の内側に、最大 max 枚ぶんの札スロット（固定サイズ）を
      並べる。スロットは必ず枠の内側に収まる（frame の内側の余白＝pad
      より内側にしか置かないので、はみ出しようがない）。
      ★ 2026-10-07: 以前は左詰めだった。そのため板の前（真ん中）に立った
      ロボットから札まで5マスも離れていて、「手を伸ばして札を取る」絵が
      描けなかった。いまは家具の前に立つ位置（cx）の真上を1枚目にして、
      右・左・右…と外へ並べる（どの枚数でも位置は固定＝増減で跳ねない）。
      cx を渡さなければ従来どおり左詰め。 */
  function cardSlots(rect, max, cx) {
    var m = frameMetrics();
    var areaX = rect.x + m.pad;
    var areaY = rect.y + m.pad + m.titleH + U(3);
    var areaR = rect.x + rect.w - m.pad - CARD_W;
    var step = CARD_W + CARD_GAP;
    var slots = [];
    if (cx == null) {
      for (var i = 0; i < max; i++) {
        slots.push({ x: areaX + i * step, y: areaY, w: CARD_W, h: CARD_H });
      }
    } else {
      var j0 = Math.floor((max - 1) / 2);
      var x0 = Math.round(cx - CARD_W / 2 - j0 * step);
      if (x0 + (max - 1) * step > areaR) x0 = areaR - (max - 1) * step;
      if (x0 < areaX) x0 = areaX;
      var pos = [];
      for (var j = 0; j < max; j++) pos.push(x0 + j * step);
      pos.sort(function (a, b) {
        var da = Math.abs(a + CARD_W / 2 - cx), db = Math.abs(b + CARD_W / 2 - cx);
        if (Math.abs(da - db) > 0.5) return da - db;
        return b - a;                                   // 同じ近さなら右を先に
      });
      pos.forEach(function (x) { slots.push({ x: x, y: areaY, w: CARD_W, h: CARD_H }); });
    }
    return {
      titleBar: { x: rect.x + m.pad, y: rect.y + m.pad, w: rect.w - m.pad * 2, h: m.titleH },
      slots: slots
    };
  }
  /** 家具の前（o.at）に立ったロボットの体の真ん中の x（hatchRect と同じ計算）。 */
  function standCx(o) {
    if (!o || !o.at) return null;
    return Math.round(o.at[0] * T + U(2) + SPRITE_W * SPRITE_SCALE / 2);
  }

  /** count 件のうち、先頭から (max-1) 件を表示し、残りは "+N" の
      最後の1枠にまとめる、という割り付け。表示数＋overflow は常に
      count と一致する（＝件数を絶対に取りこぼさない）。 */
  function pickForDisplay(list, max) {
    if (list.length <= max) return { shown: list, overflow: 0 };
    return { shown: list.slice(list.length - (max - 1)), overflow: list.length - (max - 1) };
  }

  /* ---------- 部屋の備品（板・納品口・検品台） ----------
     2026-09-06 全面描き直し。「掲示板が床とほぼ同じ暗さで、家具に
     見えない。掲示板がどれか分からない」という報告への対応。
       ・厚みのあるベベル（frameHi＝光の当たる左上／frameLo＝影の右下）
         で「板」であること自体に立体感を出す。
       ・内側の面（surface）は床（room.js の FLOOR、寒色の暗い灰）と
         はっきり区別できる色にする（board＝暖色のコルク、
         dropoff＝注意を引く琥珀色、inspect＝寒色の金属、という具合に
         3つとも互いに区別できる色にする）。
     2026-09-06 (2): 「納品する場所が無い、判定する場所も無い」という
     報告への対応で、以前の bench（検品台1つ）を dropoff（納品口）と
     inspect（検品台）に分けた。dropoff は theme.hatch を持つ（drawHatch
     が「投入口」の見た目を足す）。
     theme は config.js の roomColors.board / roomColors.dropoff /
     roomColors.inspect。渡さない（held card の描画など）ときは、
     以前と同じ地味な灰色にフォールバックする＝挙動を変えない。 */
  var DEFAULT_THEME = {
    frame: '#20242e', frameHi: '#575f70', frameLo: '#14161f',
    surface: '#20242e', surfaceLo: '#181c24',
    plateBg: '#161a24', plateBorder: '#454c5c99', plateText: '#9fe8ff'
  };

  function frameBox(x, y, w, h, theme) {
    theme = theme || DEFAULT_THEME;
    /* ベベルの太さ＝ pad と同じにする（surface の書き出し位置と揃えて、
       ハイライト／影が surface に上書きされて細く見えてしまうのを防ぐ）。 */
    var bevel = FRAME_PAD;
    px(x, y, w, h, theme.frame);
    px(x, y, w, bevel, theme.frameHi);                          // 上の面取り（明）
    px(x, y, bevel, h, theme.frameHi);                          // 左の面取り（明）
    px(x + w - bevel, y, bevel, h, theme.frameLo);              // 右の面取り（暗）
    px(x, y + h - bevel, w, bevel, theme.frameLo);              // 下の面取り（暗）
    // 内側の面（コルク／鋼板）。cardSlots() の pad と同じ余白ぶん内側。
    var pad = FRAME_PAD;
    var ix = x + pad, iy = y + pad, iw = Math.max(0, w - pad * 2), ih = Math.max(0, h - pad * 2);
    px(ix, iy, iw, ih, theme.surface);
    // ざらつき（コルクの粒・鋼板のヘアライン）を数点だけ、決定的に置く
    // （毎フレーム同じ絵になるよう Math.random は使わない＝ noise() 流用）。
    if (theme.surfaceLo && iw > 0 && ih > 0) {
      for (var i = 0; i < 14; i++) {
        var nx = ix + (noise(i, 1, 7) % iw);
        var ny = iy + (noise(3, i, 11) % ih);
        px(nx, ny, U(1), U(1), theme.surfaceLo);
      }
    }
  }

  /* ---- 家具の看板（2026-09-28 作り替え）------------------------------
     以前はここで、家具の上に暗い帯を敷き「掲示板 ／ この依頼の札 0」と
     日本語を書いていた。ドット絵の上に HTML の見出しが浮いて見える、
     世界観を壊している最大の異物、という指摘。

     作り替えの方針：
       ・帯そのものを「家具の一部（同じ材質の縁）」として描く。
         別部品に見せない＝UIではなく家具になる。
       ・何の家具かは絵で言う（紙＝掲示板／投入口＝納品口／
         虫めがね＝検品台）。文字は使わない。
       ・ただし件数だけは絵で表せない。画面に入る札は数枚で、残りは
         「+N」にまとめている以上、枚数を黙って落とすと嘘になる。
         そこで数字は「家具に打ち込まれた小さなプレート」として残す。
         数字は言語に依らないので、文字を排する方針とも矛盾しない。 */

  function chevronDown(cx, y, w, color) {
    var h = Math.round(w * 0.42), t = Math.max(2, U(1));
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = t; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, y);
    ctx.lineTo(cx, y + h);
    ctx.lineTo(cx + w / 2, y);
    ctx.stroke();
    ctx.restore();
  }

  /** 掲示板：画鋲で留めた紙。 */
  function pictoPaper(x, y, s, theme) {
    var pw = Math.round(s * 0.44), ph = Math.round(s * 0.58);
    px(x + Math.round(s * 0.04), y + Math.round(s * 0.30), pw, ph, '#d9cdb0');
    px(x + Math.round(s * 0.38), y + Math.round(s * 0.20), pw, ph, '#f6efdc');
    px(x + Math.round(s * 0.38), y + Math.round(s * 0.20), pw, Math.max(1, U(0.8)), '#ffffff');
    var pin = (theme && theme.pin) || '#d23c3c';
    px(x + Math.round(s * 0.55), y + Math.round(s * 0.14), U(2), U(2), pin);
  }

  /** 納品口：下向きの矢印が開口部に吸い込まれる。 */
  function pictoChute(x, y, s, theme) {
    var slotW = Math.round(s * 0.74), slotH = Math.max(2, U(2));
    var sx = x + Math.round((s - slotW) / 2), sy = y + Math.round(s * 0.70);
    px(sx, sy, slotW, slotH, (theme && theme.hatch) || '#181c24');
    px(sx, sy, slotW, Math.max(1, U(0.8)), (theme && theme.hatchHi) || '#3a4150');
    var cx = x + s / 2, cw = Math.round(s * 0.46);
    chevronDown(cx, y + Math.round(s * 0.14), cw, (theme && theme.surface) || '#d9a441');
    chevronDown(cx, y + Math.round(s * 0.40), cw, (theme && theme.surfaceLo) || '#b8862f');
  }

  /** 検品台：虫めがね。 */
  function pictoLens(x, y, s, theme) {
    var r = Math.round(s * 0.24);
    var cx = x + Math.round(s * 0.40), cy = y + Math.round(s * 0.40);
    ctx.save();
    ctx.strokeStyle = (theme && theme.surface) || '#aab4c4';
    ctx.lineWidth = Math.max(2, U(1.2));
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.72, cy + r * 0.72);
    ctx.lineTo(x + s * 0.88, y + s * 0.88);
    ctx.stroke();
    ctx.restore();
  }

  /** 家具に打ち込んだ数字プレート。x は左端。幅を返す。
      mark に true/false を渡すと、札のスタンプと同じ ✓ / ✗ を先頭に置く。
      ★ 右端ではなく絵のすぐ隣に並べる：離して置くと、結局「左に見出し・
        右に数字」という表組みに見えて、UIの帯に逆戻りするため。 */
  function plateAt(x, y, h, text, theme, ink, mark) {
    var size = Math.max(6, Math.round(h * 0.62));
    var ms = Math.round(h * 0.62);
    var mw = (mark == null) ? 0 : ms + U(1);
    var w = textWidth(text, size) + U(5) + mw;
    x = Math.round(x);
    px(x, y, w, h, '#12151d');
    px(x, y, w, Math.max(1, U(0.8)), (theme && theme.frameHi) || '#575f70');
    px(x, y + h - Math.max(1, U(0.8)), w, Math.max(1, U(0.8)), 'rgba(0,0,0,.45)');
    if (mark != null) {
      drawMark(x + U(2), y + Math.round((h - ms) / 2), ms, mark,
               mark ? MARK_ON_DARK.ok : MARK_ON_DARK.ng, U(1));
    }
    label(text, x + U(2.5) + mw, Math.round(y + (h - size) / 2),
          ink || (theme && theme.plateText) || '#eaf2ff', size);
    return w;
  }

  function signBar(bar, kind, info, theme) {
    theme = theme || DEFAULT_THEME;
    lastSignsDrawn.push({ kind: kind, n: info.n,
                          ok: (info.ok == null ? null : info.ok),
                          ng: (info.ng == null ? null : info.ng) });
    /* 家具と同じ材質で、上の縁として描く（独立したUIの帯に見せない）。 */
    px(bar.x, bar.y, bar.w, bar.h, theme.frame);
    px(bar.x, bar.y, bar.w, Math.max(1, U(0.8)), theme.frameHi);
    px(bar.x, bar.y + bar.h - Math.max(1, U(0.8)), bar.w, Math.max(1, U(0.8)), theme.frameLo);

    var s = Math.max(U(7), bar.h + U(1));
    var ix = bar.x + U(2), iy = bar.y + Math.round((bar.h - s) / 2);
    if (kind === 'board')        pictoPaper(ix, iy, s, theme);
    else if (kind === 'dropoff') pictoChute(ix, iy, s, theme);
    else                         pictoLens(ix, iy, s, theme);

    var ph = Math.max(U(5), bar.h - U(3));
    var py = bar.y + Math.round((bar.h - ph) / 2);
    var x = ix + s + U(2);
    x += plateAt(x, py, ph, String(info.n), theme, null, null) + U(2);
    if (kind === 'inspect') {
      x += plateAt(x, py, ph, String(info.ok), theme, '#a8f0c6', true)  + U(2);
      x += plateAt(x, py, ph, String(info.ng), theme, '#ffb3a8', false) + U(2);
    }
  }

  /* 板に留めた画鋲（card が「板の上に乗っている」と分かるように）。 */
  function drawPin(rect, theme) {
    var cx = rect.x + rect.w / 2, cy = rect.y;
    var r = Math.max(2, U(2));
    ctx.beginPath();
    ctx.fillStyle = theme.pin;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = theme.pinHi;
    ctx.arc(cx - r * 0.3, cy - r * 0.3, Math.max(1, r * 0.35), 0, Math.PI * 2);
    ctx.fill();
  }

  /* 台に留めたクリップ（card が「置かれている」＝板の画鋲とは違う
     留め方だと分かるように。板＝画鋲／台＝クリップ、で見分けやすくする）。 */
  function drawClip(rect, theme) {
    var w = Math.max(U(6), Math.round(rect.w * 0.4)), h = U(3);
    var x = rect.x + rect.w / 2 - w / 2, y = rect.y - Math.round(h * 0.6);
    px(x, y, w, h, theme.clipBody);
    px(x, y, w, U(1), theme.clipHi);
  }

  /* 納品口に置かれた札の上に、投入口（ハッチ）の暗い開口部を描く
     （card が「口から落ちてきた・まだ判定されていない」と分かるように。
     板＝画鋲／検品台＝クリップ／納品口＝ハッチ、の3通りで留め方を分ける）。 */
  function drawHatch(rect, theme) {
    var w = Math.max(U(8), Math.round(rect.w * 0.55)), h = U(3);
    var x = rect.x + rect.w / 2 - w / 2, y = rect.y - Math.round(h * 0.5);
    px(x, y, w, h, theme.hatch);
    px(x, y, w, U(1), theme.hatchHi);
  }

  /* ---- 頭上の状態表示（2026-09-28）-----------------------------------
     画面下の黒いテロップ枠（「#3 カモ が ξ を 納品中」）を撤廃した代わり。
     何をしているかは、向かう先の家具の看板と**同じ絵**で頭上に出す：
       掲示板へ（依頼を出す／引き受けて札を取る／書き込む） … 紙
       納品口へ（納品）                                    … 投入口
       検品台へ（判定）                                    … 虫めがね
     絵が看板と同じなので、ロボットが紙の絵を頭に乗せて紙の看板の家具へ
     歩いていけば、文字が無くても「掲示板の仕事をしている」と読める。
     下の細いゲージは、その動作の進み具合（このコマの中での位置 p）。
     何をしたかの正確なところ（誰が・どの依頼・ログの原文）は「詳細」に
     全部残っている＝画面からは消しても、事実は消していない。 */
  function stepKindOf(beat) {
    if (!beat) return null;
    var m = (beat.lead && beat.lead.meta) || {};
    if (isWriteBeat(beat)) return 'board';
    if (beat.kind === 'plan') return 'board';
    if (beat.kind === 'travel' && m.job) return 'board';
    if ((beat.kind === 'receive' || beat.kind === 'error') && m.verdict) return 'inspect';
    if (beat.kind === 'receive' && m.job) return 'dropoff';
    return null;
  }

  function isVerdictBeat(beat) {
    var m = (beat && beat.lead && beat.lead.meta) || {};
    return !!m.verdict;
  }

  var lastBadgesDrawn = [];   // 検査用：頭上に何の絵を・どこまでのゲージで出したか
  var lastTagsDrawn = [];     // 検査用：このフレームで描いた名札
  var lastKindIconsDrawn = [];// 検査用：このフレームで描いた仕事の種類の絵
  var hoverPt = null;         // マウスが乗っている位置（ワールド座標）。無ければ null
  function inRect(r, pt) {
    return !!(r && pt && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h);
  }

  function drawStatusBadge(cx, bottomY, kind, p, nick, pen) {
    var theme = ((cfg.roomColors || {})[kind]) || DEFAULT_THEME;
    var s = U(9);
    var gh = Math.max(2, U(1.4));
    /* ★ 2026-09-28: 運んでいる札の呼び名（ξ・π …）を絵の右に添える。
       札の下・右の一覧・頭上で同じ呼び名が出る＝3か所が1本につながる。
       書き込み（依頼に属さない）のときは呼び名が無いので添えない。 */
    var nsz = Math.max(6, Math.round(s * 0.78));
    var nw = nick ? Math.ceil(textWidth(nick, nsz)) + U(2) : 0;
    var bw = s + U(4) + nw, bh = s + U(4) + gh + U(1);
    var x = Math.round(cx - bw / 2), y = Math.round(bottomY - bh - U(1));
    /* 看板のプレートと同じ暗い地にする（同じ絵が同じ地の上に乗る）。 */
    px(x - 1, y - 1, bw + 2, bh + 2, '#0a0c12');
    px(x, y, bw, bh, '#12151d');
    px(x, y, bw, Math.max(1, U(0.8)), theme.frameHi || '#575f70');
    var ix = x + U(2), iy = y + U(1.5);
    if (kind === 'board' && pen) pictoPen(ix, iy, s);
    else if (kind === 'board')   pictoPaper(ix, iy, s, theme);
    else if (kind === 'dropoff') pictoChute(ix, iy, s, theme);
    else                         pictoLens(ix, iy, s, theme);
    if (nick) label(nick, ix + s + U(1.5), iy + Math.round((s - nsz) / 2), '#ffd35c', nsz);
    var gx = x + U(1.5), gy = y + bh - gh - U(1), gw = bw - U(3);
    var q = Math.max(0, Math.min(1, p || 0));
    px(gx, gy, gw, gh, '#2a2f3d');
    px(gx, gy, Math.max(1, Math.round(gw * q)), gh, '#3ddc84');
    lastBadgesDrawn.push({ kind: kind, p: q, nick: nick || null });
  }

  /** 不合格の札：黒ずみ＋ひび。 */
  var lastCrackedDrawn = 0;
  function drawCracked(rect) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,10,8,.42)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = 'rgba(10,6,4,.9)';
    ctx.lineWidth = Math.max(1.5, U(0.9));
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(rect.x + rect.w * 0.30, rect.y);
    ctx.lineTo(rect.x + rect.w * 0.42, rect.y + rect.h * 0.30);
    ctx.lineTo(rect.x + rect.w * 0.28, rect.y + rect.h * 0.52);
    ctx.lineTo(rect.x + rect.w * 0.46, rect.y + rect.h * 0.78);
    ctx.lineTo(rect.x + rect.w * 0.38, rect.y + rect.h);
    ctx.moveTo(rect.x + rect.w * 0.42, rect.y + rect.h * 0.30);
    ctx.lineTo(rect.x + rect.w * 0.70, rect.y + rect.h * 0.40);
    ctx.stroke();
    ctx.restore();
    lastCrackedDrawn++;
  }

  /* ---- 家具の演出（2026-09-28）---------------------------------------
     検品台：判定しているあいだ、虫めがねの位置から本人へ青い光を当てる。
             光の中を明るい線が上下に走る（調べている）。
     納品口：納品しているあいだ、本人の足もとの受け口へ小さな粒が渦を巻いて
             吸い込まれる。
     どちらも「どこで何をしているか」を文字なしで伝えるための見た目。 */
  var lastFxDrawn = [];   // 検査用：このフレームで出した演出の種類
  var lastBeamDrawn = null; // 検査用：検品の光の起点（目）と的（品物）
  var lastBurstDrawn = null; // 検査用：品物から弾けた印の位置と合否
  var lastActiveDrawn = null; // 検査用：いま動いている本人の向きと矩形
  var lastLensSide = 0;       // 検査用：虫めがねを持った側（-1 左 / 1 右）

  /* ★ 2026-09-28: 検品の演出を「本人が品物を調べる」向きに作り直した。
     以前は台の虫めがねの位置から本人へ光を当てていて、本人が検査を
     受けているように見えた（報告）。光の向きを逆にして、本人の目から
     台の上の品物へ当てる。品物の上を明るい線が往復する（読み取っている）。 */
  function drawEyeBeam(eye, rect, now) {
    if (!eye || !rect) return;
    var pulse = 0.16 + 0.08 * (0.5 + 0.5 * Math.sin(now / 240));
    var pad = U(2);
    var x0 = rect.x - pad, x1 = rect.x + rect.w + pad;
    var yb = rect.y + rect.h + pad;
    ctx.save();
    ctx.fillStyle = 'rgba(120,210,255,' + pulse.toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(eye.x, eye.y);
    ctx.lineTo(x0, rect.y - pad);
    ctx.lineTo(x0, yb);
    ctx.lineTo(x1, yb);
    ctx.lineTo(x1, rect.y - pad);
    ctx.closePath();
    ctx.fill();
    /* 光の縁（目から出ているのが分かるように細い線で） */
    ctx.strokeStyle = 'rgba(150,225,255,.55)';
    ctx.lineWidth = Math.max(1, U(0.6));
    ctx.beginPath();
    ctx.moveTo(eye.x, eye.y); ctx.lineTo(x0, rect.y - pad);
    ctx.moveTo(eye.x, eye.y); ctx.lineTo(x1, rect.y - pad);
    ctx.stroke();
    /* 目が光る */
    ctx.fillStyle = 'rgba(200,245,255,.95)';
    var er = Math.max(2, U(1.6));
    ctx.fillRect(Math.round(eye.x - er), Math.round(eye.y - er), er * 2, er * 2);
    /* 品物の上を往復する読み取り線 */
    var ph = (now % 900) / 900;
    var k = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
    var ly = Math.round(rect.y + rect.h * k);
    ctx.fillStyle = 'rgba(190,240,255,.9)';
    ctx.fillRect(Math.round(x0), ly, Math.round(x1 - x0), Math.max(1, Math.round(U(1))));
    ctx.restore();
    lastFxDrawn.push('scan');
    lastBeamDrawn = { eye: { x: eye.x, y: eye.y }, target: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
  }

  /** 検品しているあいだ本人が手に持つ虫めがね（品物のほうへ向ける）。 */
  function drawLensProp(sr, rect, now) {
    if (!sr) return;
    var r = Math.max(4, Math.round(sr.w * 0.17));
    /* 品物のある側の手に持つ（品物が左なら左手）。 */
    var side = (rect && rect.x + rect.w / 2 < sr.x + sr.w / 2) ? -1 : 1;
    var cx = Math.round(sr.x + sr.w * (0.5 + side * 0.36));
    var cy = Math.round(sr.y + sr.h * 0.70);
    /* 品物へ少しずつにじり寄るように小さく揺れる */
    cx += Math.round(Math.sin(now / 200) * U(1.2));
    cy += Math.round(Math.cos(now / 260) * U(0.8));
    ctx.save();
    /* 柄（本体側へ伸びる） */
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = Math.max(2, Math.round(r * 0.42));
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(cx - side * r * 0.7, cy - r * 0.7);
    ctx.lineTo(cx - side * r * 1.7, cy - r * 1.7);
    ctx.stroke();
    /* レンズ */
    ctx.fillStyle = 'rgba(170,225,255,.55)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#14161f';
    ctx.lineWidth = Math.max(2, Math.round(r * 0.34)) + 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#d9dde6';
    ctx.lineWidth = Math.max(2, Math.round(r * 0.34));
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    /* きらり */
    var on = (now % 800) < 500;
    ctx.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,.5)';
    var g = Math.max(1, Math.round(r * 0.3));
    ctx.fillRect(Math.round(cx - r * 0.45), Math.round(cy - r * 0.45), g, g);
    ctx.restore();
    lastFxDrawn.push('lens');
    lastLensSide = side;
  }

  /** 検品が終わった瞬間、品物そのものから ✓ / ✗ が弾け出る。
      t は結果が出てからの進み（0..1）。印は吹き出しに乗せて品物の上へ
      跳ね上がり、そのまま品物の上に残る（最後のコマで止めても読める）。
      印の形と色は画面全体で1種類（drawMark）。 */
  function drawVerdictBurst(rect, ok, t) {
    if (!rect || t >= 1) return;
    /* 最後の 1/4 で薄れて消える（品物の上の印＝結果はそのまま残る。
       弾けた印が台の看板の数字に重なったまま止まらないように）。 */
    var fade = t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var e = Math.min(1, t / 0.35);                       // 跳ね上がり
    var ease = 1 - Math.pow(1 - e, 3);
    var over = e < 1 ? Math.sin(e * Math.PI) * 0.25 : 0; // ぽんと膨らむ
    var s = Math.round(U(11) * (0.55 + 0.45 * ease + over));
    var by = Math.round(cy - rect.h * 0.2 - U(16) * ease);
    ctx.save();
    /* 飛び散る粒（合格は緑の光、不合格は黒い破片） */
    if (t < 0.6) {
      var f = t / 0.6;
      for (var i = 0; i < 10; i++) {
        var ang = i * (Math.PI * 2 / 10) + 0.3;
        var d = U(4) + U(18) * f;
        var sz = Math.max(2, Math.round(U(2.4) * (1 - f * 0.6)));
        ctx.globalAlpha = 1 - f;
        ctx.fillStyle = ok ? (i % 2 ? '#3ddc84' : '#e9fff2') : (i % 2 ? '#1a120e' : '#ff6b57');
        ctx.fillRect(Math.round(cx + Math.cos(ang) * d - sz / 2), Math.round(cy + Math.sin(ang) * d * 0.7 - sz / 2), sz, sz);
      }
      ctx.globalAlpha = 1;
    }
    /* 品物から印までの細い軌跡（どこから出た印かをつなぐ） */
    ctx.fillStyle = ok ? 'rgba(61,220,132,.55)' : 'rgba(255,107,87,.55)';
    ctx.fillRect(Math.round(cx - U(0.5)), by + s, Math.max(1, U(1)), Math.max(0, Math.round(rect.y - by - s)));
    ctx.restore();
    var bw = s + U(4);
    ctx.save();
    ctx.globalAlpha = fade;
    bubble(Math.round(cx - bw / 2), by - U(2), bw, bw);
    drawMark(Math.round(cx - s / 2), by, s, ok, ok ? MARK_ON_LIGHT.ok : MARK_ON_LIGHT.ng, U(1.4));
    ctx.restore();
    lastFxDrawn.push(ok ? 'burst-ok' : 'burst-ng');
    lastBurstDrawn = { ok: ok, x: cx, y: by + s / 2, from: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
  }

  /* ---- 納品口の投入口（2026-09-28）----------------------------------
     以前は納品のときだけ、本人の足もとに黒い楕円と、そこから上へ噴き出す
     粒を出していた。楕円は「床の染み」に見え、上向きの粒は「中から何かが
     漏れている」ように見えた（報告）。
     納品口の上の縁に、ふた付きの投入口を常に据えておく（家具の一部）。
     納品のときだけ、ふたが開き、腕で運んだ品物がそこへ落ちていく。 */
  function hatchRect(lay) {
    var o = findObj('dropoff');
    var bar = lay && lay.titleBar;
    if (!o || !bar) return null;
    var at = o.at || [o.x + Math.floor(o.w / 2), o.y - 1];
    var fw = SPRITE_W * SPRITE_SCALE;
    var cx = Math.round(at[0] * T + U(2) + fw / 2);       // そこに立つロボットの真ん中
    var w = CARD_W + U(6), h = Math.max(U(4), bar.h - U(2));
    var x = Math.max(bar.x + U(2), Math.min(bar.x + bar.w - w - U(2), Math.round(cx - w / 2)));
    return { x: x, y: Math.round(bar.y + (bar.h - h) / 2), w: w, h: h };
  }

  /** 投入口。open は 0（閉）..1（全開）。 */
  var lastHatchDrawn = null;
  function drawChuteHatch(r, open, theme) {
    if (!r) return;
    theme = theme || DEFAULT_THEME;
    var o = Math.max(0, Math.min(1, open || 0));
    /* 金属のふち */
    px(r.x - U(1.5), r.y - U(1.5), r.w + U(3), r.h + U(3), '#14161f');
    px(r.x - U(1), r.y - U(1), r.w + U(2), r.h + U(2), '#8d96a8');
    px(r.x - U(1), r.y - U(1), r.w + U(2), Math.max(1, U(0.8)), '#c9d0dc');
    /* 口の中（奥が暗い＝深さがある） */
    px(r.x, r.y, r.w, r.h, '#07080c');
    px(r.x, r.y, r.w, Math.max(1, Math.round(r.h * 0.35)), '#1c2029');  // 奥の壁
    px(r.x, r.y + r.h - Math.max(1, U(0.8)), r.w, Math.max(1, U(0.8)), '#5b6374'); // 手前のふち
    /* ふた：閉じているときは口をふさぐ板。開くと奥へ跳ね上がる（上に短く見える） */
    var lidH = Math.round(r.h * (1 - o));
    if (lidH > 0) {
      px(r.x, r.y + r.h - lidH, r.w, lidH, '#6f7788');
      px(r.x, r.y + r.h - lidH, r.w, Math.max(1, U(0.8)), '#a3abbb');
      if (lidH > U(2)) px(r.x + Math.round(r.w * 0.35), r.y + r.h - Math.round(lidH / 2) - Math.max(1, Math.round(U(0.5))),
                          Math.round(r.w * 0.3), Math.max(1, U(1)), '#3a4150');   // 取っ手
    }
    if (o > 0) {
      var up = Math.round(U(5) * o);                     // 跳ね上がったふた
      px(r.x, r.y - up - U(1), r.w, up, '#8d96a8');
      px(r.x, r.y - up - U(1), r.w, Math.max(1, U(0.8)), '#c9d0dc');
      px(r.x, r.y - U(1), r.w, Math.max(1, U(0.6)), '#3a4150');           // ちょうつがい
    }
    lastHatchDrawn = { x: r.x, y: r.y, w: r.w, h: r.h, open: o };
  }

  /** 本人の腕（肩から品物をつかむ先まで）。grip=false で指を開く。
      ★ 2026-09-28: 報告「手と胴体が離れている。二の腕を足しては」。
      以前は肩の位置を絵の枠（spriteRect）から割り出していて、胴体の細い
      ロボットでは肩が体の外に浮き、ひじから先だけが宙にあるように見えた。
      肩は胴体のふち（sprites.bodyRect）に付け、そこから
        二の腕（肩 → ひじ）… 太め
        前腕  （ひじ → 手）… 細め
      の2本でつなぐ。ひじは体の外側へ曲げる（2関節の逆運動学）。 */
  function armJoints(sx, sy, tx, ty, side) {
    var dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy) || 1;
    var L = Math.max(U(7), d * 0.5 * 1.08);              // 二の腕・前腕の長さ（同じ）
    var hh = Math.sqrt(Math.max(0, L * L - (d / 2) * (d / 2)));
    /* 肩→手の向きに直交する2方向のうち、体の外側（side 側）へひじを出す */
    var nx = -dy / d, ny = dx / d;
    if (nx * side < 0 || (nx === 0 && ny > 0)) { nx = -nx; ny = -ny; }
    var ex = sx + dx / 2 + nx * hh, ey = sy + dy / 2 + ny * hh;
    /* 手が胴体の前（内側）にあるときも、ひじは必ず体の外へ張り出す
       （二の腕が胴体の絵に埋もれて、また「離れて」見えないように）。 */
    if ((ex - sx) * side < U(4)) ex = sx + side * U(4);
    return { ex: ex, ey: ey };
  }
  function limb(x0, y0, x1, y1, w, fill) {
    ctx.strokeStyle = '#14161f'; ctx.lineWidth = w + Math.max(2, U(1.6));
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = fill; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  function drawArm(sx, sy, tx, ty, grip, side) {
    side = side || 1;
    var j = armJoints(sx, sy, tx, ty, side);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    limb(sx, sy, j.ex, j.ey, Math.max(3, U(2.6)), '#8d96a8');   // 二の腕
    limb(j.ex, j.ey, tx, ty, Math.max(2, U(1.8)), '#a3abbb');   // 前腕
    /* 肩の付け根（胴体のふちに半分めり込んだ丸い関節） */
    var rs = Math.max(3, U(2.4));
    ctx.fillStyle = '#14161f'; ctx.beginPath(); ctx.arc(sx, sy, rs + 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6f7788'; ctx.beginPath(); ctx.arc(sx, sy, rs, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c9d0dc'; ctx.fillRect(Math.round(sx - rs * 0.5), Math.round(sy - rs * 0.6), Math.max(1, Math.round(rs * 0.5)), Math.max(1, Math.round(rs * 0.5)));
    /* ひじの関節 */
    var re = Math.max(2, U(1.6));
    ctx.fillStyle = '#14161f'; ctx.beginPath(); ctx.arc(j.ex, j.ey, re + 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e3e7ee'; ctx.beginPath(); ctx.arc(j.ex, j.ey, re, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    /* 指（2本）。つかんでいる間は閉じ、放すと開く */
    var sp = grip ? U(1.5) : U(3.5);
    px(Math.round(tx - sp - U(1)), Math.round(ty - U(0.5)), U(1.2), U(3), '#e3e7ee');
    px(Math.round(tx + sp), Math.round(ty - U(0.5)), U(1.2), U(3), '#e3e7ee');
    lastFxDrawn.push('arm');
    return j;
  }

  /** 品物が口に入った瞬間、口のふちから左右へ砂ぼこりが弾ける。t: 0..1 */
  var lastDustDrawn = [];
  function drawDust(r, t) {
    if (!r || t <= 0 || t >= 1) return;
    var e = 1 - Math.pow(1 - t, 2);                       // すぐ広がって、ゆっくり止まる
    var cy = r.y + r.h / 2;
    ctx.save();
    for (var i = 0; i < 12; i++) {
      var side = (i % 2) ? 1 : -1;
      var k = Math.floor(i / 2);                         // 0..5
      var sx = side > 0 ? r.x + r.w : r.x;
      var dx = side * (U(3) + U(5.5) * k) * e;
      var dy = -U(1.2 + (k % 3)) * Math.sin(Math.PI * e) + U(0.6) * k * e * 0.3;
      var sz = Math.max(2, Math.round(U(3.4 - k * 0.3) * (1 - t * 0.4)));
      ctx.globalAlpha = Math.min(1, (1 - t) * (1.15 - k * 0.08));
      ctx.fillStyle = (k % 2) ? '#fff1c9' : '#e2c98f';
      ctx.fillRect(Math.round(sx + dx - sz / 2), Math.round(cy + dy - sz / 2), sz, sz);
      lastDustDrawn.push({ dx: dx, dy: dy });
    }
    /* 口の中がぽっと光る（入った） */
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.fillStyle = '#ffd35c';
    ctx.fillRect(r.x + U(1), r.y + Math.round(r.h * 0.35), r.w - U(2), Math.max(1, U(1)));
    ctx.restore();
    lastFxDrawn.push('dust');
  }

  /** 納品の一連（腕で運ぶ → 放す → 落ちて口に消える → 砂ぼこり）。 */
  var lastDropDrawn = null;
  var lastTrayDrawn = [];   // 検査用：納品口の中に並べて描いた品物（ID）
  function drawDelivery(dv, card, hatch, sr, hx, hy, now, fig) {
    if (!dv || !hatch || !sr) return;
    var q = dv.q;
    /* 手に持っていたときの位置（drawHeldCard と同じ計算）＝歩いてきた絵とつながる */
    var fw = SPRITE_W * SPRITE_SCALE, fh = SPRITE_H * SPRITE_SCALE;
    var fb = floorBand();
    var x0 = Math.max(fb.x, Math.min(fb.x + fb.w - CARD_W, hx + Math.round(fw * 0.62)));
    var y0 = Math.max(fb.y, Math.min(fb.y + fb.h - CARD_H, hy + Math.round(fh * 0.52)));
    var x1 = Math.round(hatch.x + hatch.w / 2 - CARD_W / 2);
    var y1 = Math.round(hatch.y - CARD_H - U(2));
    var yEnd = hatch.y + hatch.h + U(1);                 // 口の中へ（手前のふちの下まで）
    var cx, cy, stage;
    if (q < DROP_REACH) {
      var e = q / DROP_REACH; e = e * e * (3 - 2 * e);
      cx = x0 + (x1 - x0) * e; cy = y0 + (y1 - y0) * e; stage = 'reach';
    } else if (q < DROP_RELEASE) {
      cx = x1; cy = y1; stage = 'release';
    } else if (q < DROP_LAND) {
      var f = (q - DROP_RELEASE) / (DROP_LAND - DROP_RELEASE);
      cx = x1; cy = y1 + (yEnd - y1) * f * f; stage = 'fall';          // 重さで加速して落ちる
    } else {
      stage = 'landed';
    }
    /* 肩（品物のある側）→ 品物の上端。放したあとは縮めて戻す */
    var side = (hatch.x + hatch.w / 2 >= sr.x + sr.w / 2) ? 1 : -1;
    /* 肩は胴体のふち（絵の枠ではなく、実際に描いた胴体）に付ける */
    var body = AQ.sprites.bodyRect ? AQ.sprites.bodyRect(fig, sr.x, sr.y, sr.w, sr.h) : null;
    if (!body) body = { x: sr.x + sr.w * 0.15, y: sr.y + sr.h * 0.35, w: sr.w * 0.7, h: sr.h * 0.5 };
    var shx = Math.round(side > 0 ? body.x + body.w - U(1) : body.x + U(1));
    var shy = Math.round(body.y + body.h * 0.34);
    var armTip = null;
    if (stage === 'reach' || stage === 'release') {
      armTip = { x: cx + CARD_W / 2, y: cy + U(1) };
    } else if (stage === 'fall') {
      var g = (q - DROP_RELEASE) / (DROP_LAND - DROP_RELEASE);
      armTip = { x: x1 + CARD_W / 2 + (shx - x1 - CARD_W / 2) * g, y: y1 + U(1) + (shy - y1 - U(1)) * g };
    }
    var clipped = false;
    if (stage !== 'landed' && card) {
      var r = { x: Math.round(cx), y: Math.round(cy), w: CARD_W, h: CARD_H };
      ctx.save();
      if (stage === 'fall') {
        /* 口より下は見せない＝口の中へ消えていく */
        ctx.beginPath();
        ctx.rect(r.x - U(4), -1e4, r.w + U(8), 1e4 + hatch.y + Math.round(hatch.h * 0.5));
        ctx.clip();
        clipped = r.y + r.h > hatch.y + hatch.h * 0.5;
      }
      drawCard(r, card);
      ctx.restore();
      lastFxDrawn.push('fall');
    }
    var joints = null;
    if (armTip && q < DROP_LAND - 0.04) joints = drawArm(shx, shy, Math.round(armTip.x), Math.round(armTip.y), stage === 'reach', side);
    if (stage === 'landed') drawDust(hatch, (q - DROP_LAND) / 0.25);
    lastFxDrawn.push('deliver');
    lastDropDrawn = { stage: stage, q: q, card: (stage !== 'landed' && card) ? { x: Math.round(cx), y: Math.round(cy), w: CARD_W, h: CARD_H } : null,
                      arm: armTip ? { sx: shx, sy: shy, tx: armTip.x, ty: armTip.y,
                                      ex: joints ? joints.ex : null, ey: joints ? joints.ey : null } : null,
                      body: { x: body.x, y: body.y, w: body.w, h: body.h }, side: side, clipped: clipped };
  }

  /** ふたの開き具合（q から）。運ぶ途中で開き、入ったあと閉まる。 */
  function hatchOpenAt(dv) {
    if (!dv) return 0;
    var q = dv.q;
    if (q < 0.06) return 0;
    if (q < 0.24) return (q - 0.06) / 0.18;
    if (q < 0.78) return 1;
    if (q < 0.92) return 1 - (q - 0.78) / 0.14;
    return 0;
  }

  /* ---- 始動と終了（2026-09-30）----------------------------------------
     報告「エージェントの名前をクリックすると動き出すが、初めて動きだすときは
     始動の動作が、タスクを終了するときも終了する動作が欲しい」。
     時計（engine/clock.js）が、頭から再生を始めるときに「始動」の時間を、
     最後のコマのあとに「終了」の時間を置く。ここはその間の絵だけを描く。
       始動: 電源が入っていない暗い体 → 目がちらつく → アンテナから光の輪 →
             明るくなって、ぴょんと一跳ね → きらきら → 歩き出す
       終了: ぴょんぴょんと二跳ね（星が散る）→ だんだん暗くなり、休む（Z）
     見た目だけ。ログの何が起きたか（件数・順番・合否）には一切触れない。 */
  var phaseNow = { boot: null, end: 0 };
  var dimCanvas = null;        // 暗い体を描くための小さな画用紙
  var lastPhaseDrawn = null;   // 検査用：このフレームの始動・終了の絵
  function phaseLook(ph) {
    var out = { bright: 1, hop: 0, fx: [] };
    if (ph.boot != null) {
      var b = ph.boot;
      if (b < 0.36) out.bright = (b > 0.20 && b < 0.24) || (b > 0.28 && b < 0.31) ? 0.8 : 0.32;  // 目がちらつく
      else if (b < 0.60) out.bright = 0.32 + 0.68 * (b - 0.36) / 0.24;
      if (b >= 0.60 && b < 0.86) out.hop = Math.sin(Math.PI * (b - 0.60) / 0.26);
      if (b >= 0.34 && b < 0.78) out.fx.push({ k: 'ring', t: (b - 0.34) / 0.44 });
      if (b >= 0.76) out.fx.push({ k: 'spark', t: (b - 0.76) / 0.24 });
      out.stage = 'boot';
    } else if (ph.end > 0) {
      var e = ph.end;
      if (e < 0.46) {
        var h = (e / 0.46) * 2;                 // 0..2 で二跳ね
        out.hop = Math.abs(Math.sin(Math.PI * h)) * (h < 1 ? 1 : 0.7);
        out.fx.push({ k: 'stars', t: e / 0.46 });
      } else {
        out.bright = e < 0.82 ? 1 - 0.55 * (e - 0.46) / 0.36 : 0.45;
        if (e >= 0.62) out.fx.push({ k: 'zz', t: (e - 0.62) / 0.38 });
      }
      out.stage = 'end';
    }
    return out;
  }

  /** 4つ角のきらめき（十字）。 */
  function sparkle(x, y, r, col) {
    var w = Math.max(1, Math.round(r * 0.35));
    px(Math.round(x - w / 2), Math.round(y - r), w, r * 2, col);
    px(Math.round(x - r), Math.round(y - w / 2), r * 2, w, col);
  }
  /** 小さな Z（ドット絵）。 */
  function pixelZ(x, y, s, col) {
    var t = Math.max(1, Math.round(s / 4));
    px(x, y, s, t, col);
    for (var i = 1; i < 4; i++) px(Math.round(x + s - (s * i) / 4 - t / 2), Math.round(y + (s * i) / 4 - t / 2), t, t, col);
    px(x, y + s - t, s, t, col);
  }

  function drawPhaseFx(look, sr, now) {
    if (!sr || !look.fx.length) return;
    var cx = sr.x + sr.w / 2, top = sr.y + sr.h * 0.08;
    look.fx.forEach(function (f) {
      if (f.k === 'ring') {
        /* アンテナの先から広がる光の輪（電源が入る） */
        var r = U(2) + U(16) * f.t;
        ctx.save();
        ctx.globalAlpha = 1 - f.t;
        ctx.strokeStyle = '#7fe3ff';
        ctx.lineWidth = Math.max(2, U(1.4));
        ctx.beginPath(); ctx.arc(cx, top, r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      } else if (f.k === 'spark') {
        ctx.save();
        ctx.globalAlpha = 1 - f.t * 0.8;
        [[-0.62, 0.25], [0.66, 0.18], [-0.5, 0.72], [0.58, 0.66]].forEach(function (o, i) {
          var rr = Math.max(2, Math.round(U(2.2) * (1 - Math.abs(f.t - 0.3 - i * 0.1))));
          sparkle(cx + o[0] * sr.w, sr.y + o[1] * sr.h, rr, '#fff6c9');
        });
        ctx.restore();
      } else if (f.k === 'stars') {
        /* 仕事を終えて、星がぱっと散る */
        ctx.save();
        ctx.globalAlpha = 1 - Math.max(0, f.t - 0.6) / 0.4;
        for (var i = 0; i < 6; i++) {
          var ang = -Math.PI / 2 + (i - 2.5) * 0.5;
          var d = sr.w * (0.35 + 0.45 * f.t);
          sparkle(cx + Math.cos(ang) * d, top + sr.h * 0.1 + Math.sin(ang) * d * 0.7,
                  Math.max(2, Math.round(U(2.4))), (i % 2) ? '#ffd35c' : '#fff6c9');
        }
        ctx.restore();
      } else if (f.k === 'zz') {
        /* 休む：頭の横から Z がふわりと昇る */
        var zs = Math.max(4, Math.round(U(4)));
        ctx.save();
        ctx.globalAlpha = Math.min(1, f.t * 3);
        pixelZ(Math.round(sr.x + sr.w * 0.78), Math.round(top - U(2) - U(6) * f.t), zs, '#cfd6e6');
        if (f.t > 0.45) pixelZ(Math.round(sr.x + sr.w * 0.92), Math.round(top - U(8) - U(6) * (f.t - 0.45)), Math.round(zs * 0.75), '#9aa4b8');
        ctx.restore();
      }
    });
  }

  /* ---------- ロボット ---------- */
  function drawRobot(hx, hy, dir, moving, now, pal, sm, bright, mood) {
    sm = sm || S;
    var bob = moving ? U((Math.floor(now / 120) % 2)) : 0;
    /* ★ 2026-10-03 表情：うれしいときは小さく跳ねる／しょんぼりは少し沈む */
    if (!moving && mood === 'happy') bob = U(Math.abs(Math.sin(now / 140)) * 3);
    if (!moving && mood === 'sad') bob = -U(1);
    var y = hy - bob;
    var dim = (bright != null && bright < 0.999);
    if (dim) {
      /* 暗い体（電源が入っていない／休んでいる）。ctx.filter は遅い環境がある
         ので使わない。別の小さな画用紙に描いて、描いたところだけを暗く塗って
         から貼る（背景は暗くならない）。 */
      var fw0 = SPRITE_W * SPRITE_SCALE, fh0 = SPRITE_H * SPRITE_SCALE;
      var pad0 = Math.ceil(U(4));
      var oc = dimCanvas || (dimCanvas = (typeof document !== 'undefined' && document.createElement) ? document.createElement('canvas') : null);
      var ocx = oc && oc.getContext ? oc.getContext('2d') : null;
      if (!ocx || !ctx.drawImage) {        // 画用紙が作れない環境（検査用の偽物など）では暗くせずに描く
        AQ.sprites.drawFigure(ctx, sm, hx, y, fw0, fh0, dir, pal);
        return;
      }
      /* 本体の画用紙と同じ細かさで描く（高解像度の画面でぼやけないように） */
      var tf = ctx.getTransform ? ctx.getTransform() : null;
      var sc = (tf && tf.a) || 1;
      var bw0 = fw0 + pad0 * 2, bh0 = fh0 + pad0 * 2;
      var need = { w: Math.ceil(bw0 * sc), h: Math.ceil(bh0 * sc) };
      if (oc.width !== need.w || oc.height !== need.h) { oc.width = need.w; oc.height = need.h; }
      var oc2 = oc.getContext('2d');
      oc2.setTransform(1, 0, 0, 1, 0, 0);
      oc2.globalCompositeOperation = 'source-over';
      oc2.clearRect(0, 0, oc.width, oc.height);
      oc2.setTransform(sc, 0, 0, sc, 0, 0);
      AQ.sprites.drawFigure(oc2, sm, pad0, pad0, fw0, fh0, dir, pal);
      oc2.setTransform(1, 0, 0, 1, 0, 0);
      oc2.globalCompositeOperation = 'source-atop';
      oc2.fillStyle = 'rgba(8,10,18,' + (1 - bright).toFixed(3) + ')';
      oc2.fillRect(0, 0, oc.width, oc.height);
      oc2.globalCompositeOperation = 'source-over';
      ctx.drawImage(oc, Math.round(hx - pad0), Math.round(y - pad0), bw0, bh0);
      return;
    }
    /* ★ 描画の大きさは layoutRobots が使う footprint と必ず同じにする。
       U() は T/20 倍、SPRITE_SCALE は T/40 倍で2倍ずれており、
       焦点の枠・名札・持っている札だけが本体と噛み合っていなかった。 */
    AQ.sprites.drawFigure(ctx, sm, hx, y,
      SPRITE_W * SPRITE_SCALE, SPRITE_H * SPRITE_SCALE, dir, pal, mood);
    if (mood && !moving && AQ.sprites.drawEmote) AQ.sprites.drawEmote(ctx, mood, hx, y, SPRITE_W * SPRITE_SCALE, SPRITE_H * SPRITE_SCALE, now);
    if (moving) {
      var t = Math.floor(now / 90) % 4;
      var pts = [[1, 17], [2, 16], [3, 17], [2, 18]];
      var p1 = pts[t];
      px(hx + U(p1[0]), y + U(p1[1]), U(1), U(1), '#9aa1b0');
      px(hx + U(14 - p1[0]), y + U(p1[1]), U(1), U(1), '#9aa1b0');
    }
  }

  /* ================================================================
     依頼札（カード）— この画面の見どころ
     ----------------------------------------------------------------
     板 → 手 → ベンチ（合格✓／不合格✗）という状態を、prepare() で
     全コマぶん先に計算しておく（scene.js の _route と同じ発想）。
     どのコマへ seek() しても、この配列を読むだけで正しい板の様子になる。

     ★ カードは「ID」ではなく「kind」を大きく出す。IDはこの画面から
       消えるわけではなく、実況欄（hud.js）と生ログ行に残り続ける。
     ================================================================ */

  /* 札に大きく出す短縮ラベル。ja/en それぞれの語は src/i18n.js の
     'card.<kind>' に持たせてある（2026-09-06、config.js から移動。
     「英語のままで分かりにくい」という報告で ja は漢字1文字にするため、
     言語ごとに変わる文言は i18n.js が持つのが正しい置き場所になった）。
     ここに無い kind（自由文字列なので何でも出てくる）は null を返し、
     呼び出し側が room.card.otherKind（「その他」/「OTHER」）にフォールバック
     する（＝知らない kind の見た目を捏造しない）。 */
  function kindAbbrev(kind) {
    if (!kind) return null;
    var key = 'card.' + kind, v = AQ.i18n.t(key);
    return (v !== key) ? v : null;
  }

  function colorForKind(kind) {
    var known = cfg.cardColors && cfg.cardColors[kind];
    if (known) return known;
    return (cfg.cardColors && cfg.cardColors.other) || { fill: '#c6b3ff', ink: '#14161f' };
  }

  /* ★ 2026-09-28: 以前はコマごとに「全部の札の写し」を配列で持っていた
     （コマ数 × 札の数）。数千コマ・数千件のログでは数千万個の写しになり、
     LIVE で行が届くたびの作り直しに数秒かかって、そのあいだ画面が止まり
     「かくかく」していた。いまは札ごとに「変わったコマと、そのときの状態」
     だけを持ち、あるコマの状態はそこから組み立てる（答えは以前と同じ）。 */
  var cardTimeline = null;   // { len: コマ数, list: [札（作られた順）] }。札は { id, kind, order, first, hist:[{i,state,holder,verdict}] }
  var cardStateMemo = {};    // index → 組み立てた配列（同じコマを何度も聞かれるので）
  var cardStateMemoN = 0;

  /* jobId → { actorName: 最初にそのactorがこの仕事に触れたコマ番号 }。
     「触れた」＝JOB を出した／CLAIM した／DELIVER した／ATTEST で判定した、
     の4つ（＝meta.job を持つイベントは必ずこのどれか1つ）。task C の
     「1体に絞ったら、その人が関わった依頼の札だけを見せる」の判定に使う。
     時系列で見て「まだその人が触れていない時点」では触れた扱いにしない
     （分からないことは描かない＝先の出来事を先取りして関連付けない）。 */
  var touchedFirstIndex = null;

  function markTouched(jobId, actor, index) {
    if (!jobId || !actor) return;
    var m = touchedFirstIndex[jobId] || (touchedFirstIndex[jobId] = {});
    if (!(actor in m)) m[actor] = index;
  }

  /** actor が index コマ時点までに jobId に触れているか。 */
  function isTouchedBy(jobId, actor, index) {
    if (actor == null) return true;   // focus していないときは常に「対象」
    var m = touchedFirstIndex && touchedFirstIndex[jobId];
    var t = m && m[actor];
    return t != null && t <= index;
  }

  /* 札の state は「いま画面のどこにあるか」をそのまま表す:
       board    … 依頼板（JOB＝agent.plan）
       hand     … 誰かが持ち歩いている（CLAIM＝tool.call）
       dropoff  … 納品口（DELIVER＝result.ok・verdict無し。まだ未判定）
       inspect  … 検品台（ATTEST useful/not＝result.ok(verdict=useful) /
                  result.error(verdict=not)。合格・不合格どちらもここ）
     2026-09-06 (2): 以前は dropoff/inspect をまとめて 'bench' 1つの
     state にしていた（不合格だけ別に 'rejected'）。納品と判定を画面の
     別の場所にする以上、状態も別にしないと「どちらの場所に描くか」が
     決められない。 */
  /* ★ 2026-10-07: 1つの依頼に札が何枚もありうる形にした。
     報告「掲示板から札を取って引き受けた、とあるのに、札は初めから納品口に
     置いてある」。kibble では同じ依頼を何体も引き受ける。以前は依頼1件に
     札1枚だったので、2体目が引き受けると、1体目が納品口に入れた品物が
     納品口から消えて2体目の手に移っていた（＝納品口の件数まで減っていた）。
     いまは「依頼の貼り紙は板にある。引き受けた子はそれぞれ自分の札を板から
     取る」と描く。札（実体）ごとに key を持ち、id はどれも依頼ID のまま。
       ・引き受け … その子がまだ札を持っていなければ、板の札を取る。板に
                    無ければ、板に貼り紙が出て（その依頼はまだ受け付けている）、
                    それを取る（from:'board'）
       ・納品     … その子が持っている札を納品口へ。持っていなければ、
                    不合格で返ってきた自分の品物を検品台から（from:'inspect'）、
                    または板から（from:'board'）取ってから納品口へ
       ・判定     … 納品口の品物（いちばん新しく入ったもの）を検品台へ
                    （from:'dropoff'）。もう台の上なら、その場で判定しなおし
     どの札がどこからどこへ動いたかは acts[コマ番号] に控え、道すじ（どこに
     寄って何を取るか）と、手を伸ばす絵がそれを読む。 */
  function buildCardTimeline(beats) {
    var cards = {};       // jobId → [札の実体…]（作られた順）
    var nextOrder = 0, nextKey = 0;
    var list = [];
    var acts = {};        // コマ番号 → [{ key, job, actor, kind, from, to }]
    cardTimeline = { len: beats.length, list: list, acts: acts };
    cardStateMemo = {}; cardStateMemoN = 0;
    touchedFirstIndex = {};
    var curIndex = 0;

    function make(jobId, kind, state, holder, bornFrom) {
      var c = { id: jobId, key: jobId + '#' + (nextKey++), kind: kind || 'other', state: state, holder: holder || null,
                verdict: null, order: nextOrder++, first: curIndex, hist: [], owner: holder || null,
                born: curIndex, bornFrom: bornFrom, at: curIndex };
      (cards[jobId] || (cards[jobId] = [])).push(c);
      list.push(c);
      return c;
    }
    function find(jobId, pred) {
      var L = cards[jobId] || [];
      for (var k = L.length - 1; k >= 0; k--) if (pred(L[k])) return L[k];
      return null;
    }
    var touchedNow = [];
    function act(c, e, kind, from) {
      if (touchedNow.indexOf(c) === -1) touchedNow.push(c);
      (acts[curIndex] || (acts[curIndex] = [])).push({ key: c.key, job: String(c.id), actor: e.actor, kind: kind,
                                                       from: from, to: c.state });
    }

    beats.forEach(function (b, i) {
      curIndex = i;
      touchedNow = [];
      (b.events || []).forEach(function (e) {
        var m = e.meta || {};
        var job = m.job;
        if (job == null || job === '') return;   // 仕事IDの無いイベントは札に関係しない
        job = String(job);                        // 数字の依頼ID（0 も）も文字にそろえる
        markTouched(job, e.actor, i);   // 4種のどれであっても「触れた」
        var c, from;

        /* ★ 2026-10-21 仕事札は依頼ごとに1枚（利用者「同じ仕事の内容の札がたくさん出てくるのは混乱のもと」）。
           kibble では同じ依頼を何体も引き受けて納品するが、札は1枚だけを動かす：
             ・依頼 … 札が無ければ板に貼る
             ・引き受け … 札が板にあれば、その子が取る。ほかの子が持っている・もう納品口にあるなら、札は動かさない
             ・納品 … 自分が持っていれば納品口へ。板にあれば取ってから納品口へ。
                       判定ずみ（検品台）なら、納品しなおし＝納品口へ戻す。ほかの子が持っている・もう納品口にあるなら動かさない
             ・判定 … 納品口の札を検品台へ（もう台の上ならその場で判定しなおし） */
        var L1 = cards[job] || [];
        function pick(pred) { for (var k = L1.length - 1; k >= 0; k--) if (pred(L1[k])) return L1[k]; return null; }
        var one = pick(function (x) { return x.state === 'hand' && x.holder === e.actor; }) || pick(function (x) { return x.state === 'dropoff'; }) ||
                  pick(function (x) { return x.state === 'board'; }) || pick(function (x) { return x.state === 'inspect'; }) || pick(function (x) { return x.state === 'hand'; });
        if (e.type === 'agent.plan') {
          if (!one) { c = make(job, m.kind, 'board', null, 'post'); act(c, e, 'post', 'new'); }
        } else if (e.type === 'tool.call') {
          if (one && one.state === 'board') { c = one; c.state = 'hand'; c.holder = e.actor; c.owner = e.actor; c.at = i; act(c, e, 'claim', 'board'); }
          else if (!one || one.state === 'hand' && one.holder !== e.actor) {
            /* 札が無い、またはほかの子が持っている：自分の作業用に、板の貼り紙から札を取る（手に持つ札は置いた札に数えない。
               納品口・検品台に置かれるときに、同じ依頼の古い札は片づける＝置いてある札は1枚のまま） */
            c = make(job, m.kind, 'hand', e.actor, 'board'); act(c, e, 'claim', 'board');
          }
        } else if (e.type === 'result.ok' && m.verdict === 'useful' || e.type === 'result.error' && m.verdict === 'not') {
          var v = m.verdict;
          c = one; from = null;
          if (c && c.state === 'dropoff') from = 'dropoff';
          else if (c && c.state === 'inspect') from = 'inspect';
          else if (c && c.state === 'hand' && c.holder === e.actor) from = 'hand';
          else if (c && c.state === 'hand') { c = make(job, m.kind, 'inspect', null, 'dropoff'); from = 'dropoff'; }   // 札はほかの子が持ったまま（その子からは取らない）
          else if (c && c.state === 'board') from = 'board';
          else { c = make(job, m.kind, 'inspect', null, 'dropoff'); from = 'dropoff'; }
          c.verdict = v; c.state = 'inspect'; c.holder = null; c.at = i;
          act(c, e, 'attest', from);
        } else if (e.type === 'result.ok') {
          c = null;
          if (!one) { c = make(job, m.kind, 'dropoff', e.actor, 'board'); from = 'board'; }
          else if (one.state === 'hand' && one.holder === e.actor) { c = one; from = 'hand'; }
          else if (one.state === 'board') { c = one; from = 'board'; }
          else if (one.state === 'inspect') { c = one; from = 'inspect'; }
          else if (one.state === 'hand') { c = make(job, m.kind, 'dropoff', e.actor, 'board'); from = 'board'; }   // 札はほかの子が持ったまま：自分の品物は板の貼り紙から（その子の手からは取らない）
          if (c) {
            c.state = 'dropoff'; c.holder = null; c.verdict = null; c.owner = e.actor; c.at = i;
            act(c, e, 'deliver', from);
            /* 置いてある札は依頼ごとに1枚：ほかに検品台に残っている同じ依頼の札があれば片づける */
            L1.forEach(function (x) { if (x !== c && (x.state === 'inspect' || x.state === 'dropoff')) { x.state = 'gone'; x.holder = null; x.at = i; if (touchedNow.indexOf(x) === -1) touchedNow.push(x); } });
          }
        }
      });

      /* このコマで状態が変わった札だけ、変わったあとの状態を記録する。 */
      touchedNow.forEach(function (c) {
        var h = c.hist[c.hist.length - 1];
        if (h && h.i === i) { h.state = c.state; h.holder = c.holder; h.verdict = c.verdict; return; }
        if (h && h.state === c.state && h.holder === c.holder && h.verdict === c.verdict) return;
        c.hist.push({ i: i, state: c.state, holder: c.holder, verdict: c.verdict });
      });
    });
  }

  /** そのコマで、本人（beat.actor）が札を動かした記録（無ければ null）。 */
  function actOfBeat(b, i) {
    var L = cardTimeline && cardTimeline.acts && cardTimeline.acts[i];
    if (!L || !L.length) return null;
    var who = b && b.actor;
    for (var k = 0; k < L.length; k++) if (L[k].actor === who) return L[k];
    return null;
  }

  /** index コマ時点での札の状態（配列）。prepare() 済みでないと空配列。
      この関数は cardTimeline を読むだけの純粋な参照なので、どんな順番で
      呼んでも（前から・後ろから・飛び飛びに seek しても）同じ index には
      常に同じ結果を返す＝リプレイの scrub 安全性はここで保証している。 */
  function cardStateAt(index) {
    if (!cardTimeline || !cardTimeline.len) return [];
    /* index < 0 は「まだどのコマも起きていない」という明示的な意味
       （task 1: 選ぶ前の画面）。0 に丸めてコマ0の状態を見せてしまうと
       「もう何か起きた」ことになってしまうので、負の index だけは
       特別に「何も無い」を返す。0以上は今までどおり末尾でクランプする。 */
    if (index < 0) return [];
    var i = Math.min(cardTimeline.len - 1, index);
    if (Object.prototype.hasOwnProperty.call(cardStateMemo, i)) return cardStateMemo[i];
    var out = [], L = cardTimeline.list;
    for (var k = 0; k < L.length; k++) {
      var c = L[k];
      if (c.first > i) break;                 // 札は作られた順＝最初のコマの順に並んでいる
      /* c.hist の中で i 以前の最後の記録（二分探索） */
      var H = c.hist, lo = 0, hi = H.length - 1, at = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (H[mid].i <= i) { at = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (at < 0) continue;                   // まだ何も起きていない（起こりえないが念のため）
      var h = H[at];
      out.push({ id: c.id, key: c.key, kind: c.kind, state: h.state, holder: h.holder, verdict: h.verdict, order: c.order,
                 born: c.born, bornFrom: c.bornFrom, t: h.i });
    }
    if (++cardStateMemoN > 16) { cardStateMemo = {}; cardStateMemoN = 1; }
    cardStateMemo[i] = out;
    return out;
  }

  /* ---- 絞り込みの説明書き（2026-09-08 に意味が変わった）------------
     以前は「エージェント1体」を表す文字列だった。いまは依頼1件を追うので、
     main.js からは次のどれかが渡ってくる:
       { job:'k123', actors:{did:true,…} }  依頼1件を追う（既定の使い方）
       { actor:'did:…' } または 'did:…'      1体を追う（依頼の無いログ用に残す）
       null                                   絞っていない
     渡された形をここで1回だけ正規化して、以降は下の2つの述語だけを使う。
     ＝板・納品口・検品台・ロボットの絞り方が1か所に集まる。 */
  function normFocus(f) {
    if (f == null) return null;
    if (typeof f === 'string') return { actor: f, job: null, actors: null };
    return {
      actor:  (f.actor == null) ? null : String(f.actor),
      job:    (f.job == null)   ? null : String(f.job),
      actors: f.actors || null,
      trips:  tripsClamp(f.trips)
    };
  }

  /* ---------------------------------------------------------------
     往復（2026-09-13）
     -----------------------------------------------------------------
     「まとめ」の画面では、②引き受けた 231件・③納品 232件のように
     件数が3桁になることがある。ところが動く絵は常に片道1回で、
     1件のときと232件のときがまったく同じ絵だった（利用者の指摘）。

     そこで、件数の多い段階では同じ道を何度も速く往復させる。
     ・往復の回数は「件数の桁数」（1〜9件=1／10〜99件=2／100〜999件=3／…）
       上限5。件数そのものを絵にする（232回歩かせる）のは無理なので
       間引くが、間引くのは絵だけで、正確な件数は文字で必ず横に出る。
     ・コマの長さは変えない＝往復が増えるほど1本が速くなる
       （利用者の希望「速く流す」）。
     ・片道の本数は 2n-1（行き・帰り・行き…最後は必ず「行き」）なので、
       コマの終わりでは必ず目的地に着く＝札は必ず置かれる。
     --------------------------------------------------------------- */
  var TRIPS_MAX = 5;
  var FLIP_DIR = { right: 'left', left: 'right', up: 'down', down: 'up' };
  function tripsClamp(n) {
    n = (n == null) ? 1 : (n | 0);
    return Math.max(1, Math.min(TRIPS_MAX, n));
  }
  /** 件数 → 往復の回数（桁数、上限 TRIPS_MAX）。0件・1件は1往復。 */
  function tripsForCount(count) {
    var c = (count == null) ? 0 : (count | 0);
    if (c <= 9) return 1;
    return tripsClamp(String(c).length);
  }
  /** 0..1 の歩き具合を、往復 n 回ぶんに畳む。
      戻り値 { w: この片道の進み具合 0..1, back: 帰り道か }。 */
  function legOf(w0, n) {
    if (n <= 1) return { w: w0, back: false };
    if (w0 >= 1) return { w: 1, back: false };
    var legs = 2 * n - 1;                       // 行き・帰り…最後は行き（奇数本）
    var x = w0 * legs;
    var leg = Math.min(legs - 1, Math.floor(x));
    var frac = x - leg;
    var back = (leg % 2 === 1);
    return { w: back ? (1 - frac) : frac, back: back };
  }

  /** そのロボットを描くか。依頼を追っているときは「その依頼に出てくる面々」
      だけ（誰が出てくるかは jobs.js の cast＝ログに実際にある行から作る）。 */
  function focusHasActor(F, actor) {
    if (!F) return true;
    if (F.actors) return !!F.actors[String(actor)];
    if (F.actor != null) return String(actor) === F.actor;
    return true;
  }

  /** その札を描くか。依頼を追っているときは、その依頼の札1枚だけ。 */
  function focusHasCard(F, cardId, index) {
    if (!F) return true;
    if (F.job != null) return String(cardId) === F.job;
    if (F.actor != null) return isTouchedBy(cardId, F.actor, index);
    return true;
  }

  /* ---- 「札を持って運ぶ」ための表示用の札の状態（2026-09-12）--------
     報告: 納品のコマで、札が最初から納品口に置かれていて、エージェントが
     手に持って運ぶ場面が無い。
     原因: cardStateAt(index) は「そのコマが終わった時点」の状態なので、
     コマの頭からもう納品口に置いてある。いっぽうロボットのほうは
     route を p（コマ内の進み具合）に沿って歩いている＝札だけが先に
     ワープしていた。
     直し方: 歩き終わる（p >= WALK_UNTIL）までは「ひとつ前の状態」を
     描く。ただし手から離れる札（納品）と、このコマで生まれた札
     （依頼が出された）は、歩いている本人の手の中に置く＝運んでいる絵。
     ★ データは1件も変えていない。同じ index の最終状態は今までどおりで、
     変えたのは「コマの途中でどこに描くか」だけ（scrub しても、コマの
     終わりでは必ず本来の状態に落ち着く）。 */
  var anim = null;   // { index, p, actor, back, trips } — render が毎フレーム更新する
  var lastWalkInfo = null;  // 検査用：いま動いている本人の歩き具合（下の lastWalk()）
  /* 検査用：直近の1フレームで実際に描いたロボットの体数。
     2026-09-27 の不具合「なぜか急にエージェントがわらわらと現れました」
     を機械的に測るための覗き穴。選んでいないのに何体も描かれていないか
     を、絵を見ずに数字で確かめられるようにする。 */
  var lastRobotsDrawn = 0;
  var lastHeldDrawn = [];   // 直前のフレームで「手に持った札」として描いたもの（テスト用）
  /* 直前のフレームで描いた「書き込み」の絵の数（テスト用）。
     メモを持って歩いた／板に貼った、をそれぞれ数える。 */
  var lastMemoDrawn = 0, lastPinnedDrawn = 0;

  function sameSpot(a, b2) {
    return !!a && !!b2 && a.state === b2.state && a.holder === b2.holder && a.verdict === b2.verdict;
  }

  /** ★ 2026-10-07: このコマで本人が家具に手を伸ばす動作（無ければ null）。
        claim  … 板の前で立ち止まり、札をつかんで取る（q: 立ち止まり 0..1）
        memo   … 板の前で立ち止まり、メモを貼る
        pickup … 納品口の前で立ち止まり、品物を拾う → 検品台へ運ぶ
        post   … 板に着いてから、持ってきた札を板に貼る（q: 着いてから 0..1）
      hold: 札をまだ「ひとつ前の状態」で描くか（cardsForDisplay が見る）
      carry: 本人の手の中に描く札（検品の品物を運んでいる間）
      p だけで決まる（どこへ seek しても同じ）。 */
  function actionOf(beat, p, route, trip, index) {
    if (!beat || index == null || index < 0) return null;
    var m = (beat.lead && beat.lead.meta) || {};
    var kind = route && route.stopKind;
    var job = m.job != null ? String(m.job) : null;
    var ac = actOfBeat(beat, index);
    var key = ac ? ac.key : null;
    if (ac) job = ac.job;
    if (kind === 'work') {
      /* 札は納品口に着くまで手の中（hold は既定＝歩き終わるまで前の状態） */
      return { kind: 'work', from: 'desk', q: trip.stopQ, past: !!trip.past,
               before: false, job: job, key: key, hold: null, carry: null };
    }
    if (kind === 'claim' || kind === 'memo' || kind === 'pickup' || kind === 'fetch') {
      var q = trip.stopQ;
      var grabbed = trip.past || (q != null && q >= (kind === 'memo' ? WRITE_DONE : GRAB_AT));
      var a = { kind: kind, from: route.stopFrom || 'board', q: q, past: !!trip.past,
                before: (q == null && !trip.past), job: job, key: key, hold: !grabbed, carry: null };
      if ((kind === 'pickup' || kind === 'fetch') && grabbed && trip.w < 1) a.carry = key;
      if (kind === 'memo') a.hold = null;            // メモは札ではない（札の状態は変えない）
      /* 検品台に着いたら、運んできた品物を腕で台に置く（置くまでは手の中） */
      if (kind === 'pickup' && trip.w >= 1) {
        var pq = arrivedQ(beat, p);
        if (pq >= 0 && pq < PLACE_END) { a.place = pq; if (pq < PLACE_AT) a.carry = key; }
      }
      return a;
    }
    /* 自分の手に持っている札を判定する（納品の記録が無い）：持って行って台に置く */
    if (ac && ac.kind === 'attest' && ac.from === 'hand') {
      var hq = arrivedQ(beat, p);
      return { kind: 'place', from: 'hand', q: hq < 0 ? null : hq, place: (hq >= 0 && hq < PLACE_END) ? hq : null,
               past: hq >= PLACE_END, before: hq < 0, job: job, key: key,
               hold: trip.w < 1 || hq < PLACE_AT, carry: null };
    }
    if ((beat.kind === 'plan' && m.job) || beat.kind === 'planbatch') {
      var aq = arrivedQ(beat, p);
      return { kind: 'post', q: aq < 0 ? null : aq, past: aq >= PIN_BACK, before: aq < 0, job: job, key: key,
               hold: trip.w < 1 || aq < PIN_AT, carry: null };
    }
    return null;
  }

  /** cardsForDisplay の「まだ前の状態か」を一時的に決め打ちして fn() を呼ぶ。 */
  function withHold(h, fn) {
    if (!anim) return fn();
    var h0 = anim.hold, c0 = anim.carry;
    anim.hold = h; anim.carry = null;
    try { return fn(); } finally { anim.hold = h0; anim.carry = c0; }
  }
  /** 並びの中から、その依頼の札の枠（と札）を探す。無ければ null。 */
  function slotItem(lay, key) {
    if (!lay || key == null) return null;
    for (var i = 0; i < lay.shown.length; i++) {
      var it = lay.shown[i];
      if (it.card && String(it.card.key || it.card.id) === String(key)) return { rect: it.rect, card: it.card };
    }
    return null;
  }

  function animatedCards(index, activeActor) {
    var cur = cardStateAt(index), prev = cardStateAt(index - 1);
    var prevByKey = {};
    prev.forEach(function (c) { prevByKey[c.key] = c; });
    return cur.map(function (c) {
      var q = prevByKey[c.key];
      if (sameSpot(q, c)) return c;                       // このコマでは動いていない
      if (!q) {
        /* このコマで初めて現れた札。
           ・依頼を出した（post）… 出した本人が板まで運んでいる途中＝手の中
           ・板から取った（引き受け・納品の前に板の貼り紙を取る）… まだ板にある */
        if (c.bornFrom === 'board' || c.bornFrom === 'dropoff') {
          return { id: c.id, key: c.key, kind: c.kind, state: c.bornFrom, holder: null, verdict: null, order: c.order };
        }
        return { id: c.id, key: c.key, kind: c.kind, state: 'hand', holder: activeActor, verdict: null, order: c.order };
      }
      return q;                                           // まだ前の場所（手の中を含む）
    });
  }

  /** 描画・当たり判定が見る札の状態。アニメーション中のコマだけ上の
      「運んでいる途中」を返し、それ以外は今までどおり最終状態。 */
  function cardsForDisplay(index) {
    /* ★ 2026-09-13: 往復しているときの「帰り道」は、札はもう置いた後
       （＝この段階の最終状態）。行きだけ「ひとつ前の状態＝手の中」を
       返す。そうしないと、同じ1枚が行ったり来たりして見える。 */
    /* ★ 2026-10-07: 「まだ前の状態のまま」の区切りは、ふつうは歩き終わる
       まで。手を伸ばして取る／貼る動作のあるコマは、render() がその動作の
       区切り（つかんだ瞬間・貼った瞬間）で anim.hold を決める。 */
    var A = !!(anim && anim.index === index);
    var hold = A && !anim.back &&
      (anim.hold != null ? anim.hold : (anim.walk != null ? anim.walk < 1 : anim.p < WALK_UNTIL));
    var list = hold ? animatedCards(index, anim.actor) : cardStateAt(index);
    /* 品物・札を家具から取ってから、行き先に置くまでは本人の手の中。 */
    if (A && anim.carry != null) {
      list = list.map(function (c) {
        if (String(c.key) !== anim.carry) return c;
        return { id: c.id, key: c.key, kind: c.kind, state: 'hand', holder: anim.actor, verdict: null, order: c.order };
      });
    }
    /* ★ 2026-10-07: 以前ここで「手に持っている札の持ち主を、いま動いている
       本人に付け替える」ことをしていた（札が依頼1件に1枚だったので、引き受けた
       子と納品した子が違うと、運ぶ子の手に札が無かった）。いまは引き受けた子
       それぞれが自分の札を持ち、持っていない子は板から取ってから納品する
       （buildCardTimeline）ので、付け替えはもう要らない。 */
    return list;
  }

  /** テスト・render 共通：index コマ時点の掲示板の状態を計算する（描画しない）。
      count は「板に残っている未消化の仕事」の本当の件数（表示枚数を絞る前）。
      shown+overflow は必ず count と一致する。

      focusActor（task C）を渡すと、そのエージェントが「その時点までに
      触れた」仕事（投稿／引受／納品／判定のどれか）だけに絞る。count・
      overflow はその絞り込んだあとの本当の件数から計算するので、
      「表示枚数＋overflow＝本当の件数」という約束は focus 中も崩れない
      （絞る前の全件数を分母にして overflow を水増ししたりしない）。
      focusActor を渡さなければ今までどおり全件が対象（挙動は変えない）。 */
  function computeBoardLayout(index, focus) {
    var F = normFocus(focus);
    var o = findObj('board');
    var rect = objRect(o);
    var cards = cardsForDisplay(index).filter(function (c) { return c.state === 'board'; });
    if (F) cards = cards.filter(function (c) { return focusHasCard(F, c.id, index); });
    var max = cfg.maxBoardCards || 6;
    var picked = pickForDisplay(cards, max);
    var lay = cardSlots(rect, max, standCx(o));
    var out = [];
    picked.shown.forEach(function (c, i) { out.push({ card: c, rect: lay.slots[i], overflow: false }); });
    if (picked.overflow > 0) out.push({ card: null, rect: lay.slots[picked.shown.length], overflow: true, n: picked.overflow });
    return {
      rect: rect, titleBar: lay.titleBar, count: cards.length, shown: out, overflow: picked.overflow,
      focused: F != null
    };
  }

  /** 納品口。delivered = 口に置かれている札の件数（DELIVER されたが、
      まだ ATTEST で判定されていないもの＝ state 'dropoff' だけ）。
      判定が付いた瞬間に検品台（computeInspectLayout）へ移る。
      focusActor の意味は computeBoardLayout と同じ。 */
  function computeDropoffLayout(index, focus) {
    var F = normFocus(focus);
    var o = findObj('dropoff');
    var rect = objRect(o);
    var cards = cardsForDisplay(index).filter(function (c) { return c.state === 'dropoff'; });
    if (F) cards = cards.filter(function (c) { return focusHasCard(F, c.id, index); });
    var max = cfg.maxDropoffCards || 5;
    var picked = pickForDisplay(cards, max);
    var lay = cardSlots(rect, max, standCx(o));
    var out = [];
    picked.shown.forEach(function (c, i) { out.push({ card: c, rect: lay.slots[i], overflow: false }); });
    if (picked.overflow > 0) out.push({ card: null, rect: lay.slots[picked.shown.length], overflow: true, n: picked.overflow });
    return {
      rect: rect, titleBar: lay.titleBar, count: cards.length, shown: out, overflow: picked.overflow,
      focused: F != null
    };
  }

  /** 検品台。judged = 台に乗っている札の総数（合格・不合格の両方＝
      state 'inspect'）。ok/ng はその内訳。
      focusActor の意味は computeBoardLayout と同じ。 */
  function computeInspectLayout(index, focus) {
    var F = normFocus(focus);
    var o = findObj('inspect');
    var rect = objRect(o);
    var all = cardsForDisplay(index).filter(function (c) { return c.state === 'inspect'; });
    if (F) all = all.filter(function (c) { return focusHasCard(F, c.id, index); });
    var ok = all.filter(function (c) { return c.verdict === 'useful'; }).length;
    var ng = all.filter(function (c) { return c.verdict === 'not'; }).length;
    var max = cfg.maxInspectCards || 5;
    var picked = pickForDisplay(all, max);
    var lay = cardSlots(rect, max, standCx(o));
    var out = [];
    picked.shown.forEach(function (c, i) { out.push({ card: c, rect: lay.slots[i], overflow: false }); });
    if (picked.overflow > 0) out.push({ card: null, rect: lay.slots[picked.shown.length], overflow: true, n: picked.overflow });
    return {
      rect: rect, titleBar: lay.titleBar, count: all.length, ok: ok, ng: ng, shown: out, overflow: picked.overflow,
      focused: F != null
    };
  }

  /** カードの中の「kind ラベル」の矩形と「判定バッジ」の矩形を、
      canvas に触れずに計算する（drawCard もテスト用フックも、この
      同じ関数を読むだけ＝見た目と検査した数字が食い違わない）。
      判定スタンプは kind ラベルの上に重ねない設計。以前はカード全面に
      対角線でスタンプを描いていて、"その他" や "BUILD" の文字が完全に
      隠れてしまっていた（＝スタンプと kind、どちらも情報なので片方が
      片方を消してはいけない、という報告への対応）。ラベルは上寄せ、
      バッジは右下すみ固定なので、幾何学的に重なる余地が無い。 */
  function cardVisual(rect, card) {
    var abbr = kindAbbrev(card.kind);
    var text = abbr || AQ.i18n.t('room.card.otherKind');
    var size = fitSize(text, rect.w - U(6), Math.round(T * 0.26), 5);
    var lw = Math.ceil(textWidth(text, size));
    var labelRect = {
      x: Math.round(rect.x + rect.w / 2 - lw / 2),
      y: Math.round(rect.y + rect.h * 0.34 - size / 2),
      w: lw, h: size
    };

    var badgeSize = Math.max(6, Math.round(Math.min(rect.w, rect.h) * 0.46));
    var badgeRect = card.verdict
      ? { x: rect.x + rect.w - badgeSize - U(1), y: rect.y + rect.h - badgeSize - U(1), w: badgeSize, h: badgeSize }
      : null;

    return { text: text, size: size, labelRect: labelRect, badgeRect: badgeRect };
  }

  /* ★ 2026-09-27: 合否の印は「形も色も1種類だけ」にする。
     以前は同じ合否が、札の上ではスタンプ（✓/✗）、ロボットの吹き出しでは
     英単語（OK / REJECTED）と、場所ごとに別の見た目で出ていた。
     形が違うと、同じことを言っているのだと分からない。
     ここに1つだけ描き方を置いて、札もロボットもこれを呼ぶ。
     白い吹き出しの上では明るい緑・赤は読めないので、地の明暗で
     2組の色を持つ（形はまったく同じ）。 */
  var MARK_ON_DARK  = { ok: '#3ddc84', ng: '#ff6b57' };
  var MARK_ON_LIGHT = { ok: '#1a7a4a', ng: '#c02b1c' };

  /** 合否の印（✓ / ✗）を、与えられた正方形いっぱいに描く。 */
  function drawMark(x, y, size, ok, color, weight) {
    lastMarksDrawn.push({ ok: !!ok, color: color, x: x + size / 2, y: y + size / 2 });
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, weight || U(1));
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (ok) {
      ctx.moveTo(x + size * 0.18, y + size * 0.55);
      ctx.lineTo(x + size * 0.42, y + size * 0.82);
      ctx.lineTo(x + size * 0.85, y + size * 0.20);
    } else {
      ctx.moveTo(x + size * 0.20, y + size * 0.20);
      ctx.lineTo(x + size * 0.80, y + size * 0.80);
      ctx.moveTo(x + size * 0.80, y + size * 0.20);
      ctx.lineTo(x + size * 0.20, y + size * 0.80);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawVerdictBadge(rect, verdict) {
    if (!verdict) return;
    var v = cardVisual(rect, { kind: null, verdict: verdict });
    var b = v.badgeRect, ok = verdict === 'useful';
    px(b.x - U(1), b.y - U(1), b.w + U(2), b.h + U(2), '#14161f');
    px(b.x, b.y, b.w, b.h, ok ? '#173423' : '#3a1512');
    drawMark(b.x, b.y, b.w, ok, ok ? MARK_ON_DARK.ok : MARK_ON_DARK.ng, U(1));
  }

  /* theme を渡すと、板・納品口・検品台に「乗っている」ように見せる
     装飾を足す（板＝画鋲／検品台＝クリップ／納品口＝ハッチ。手に
     持っているとき（drawHeldCard）は theme を渡さない＝どの装飾も
     出ない、今までどおりの見た目）。 */
  /** 仕事の種類の絵を (x,y) から一辺 s の正方形に描く。形は config.kindIcons
      （一覧の小さな札も同じ表を読む＝札と一覧で必ず同じ形になる）。
      表に無い kind（自由文字列）は other のひし形。 */
  function drawKindIcon(kind, x, y, s, ink, bg) {
    var table = (cfg && cfg.kindIcons) || null;
    if (!table) return false;
    var shapes = table[kind] || table.other;
    if (!shapes) return false;
    var k = s / 12;
    ctx.save();
    ctx.fillStyle = ink; ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1.5, 1.4 * k); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    shapes.forEach(function (sh) {
      if (sh.r) {
        /* c:1 は札の地の色で塗る（小包の帯のように、絵に切れ目を入れる）。 */
        ctx.fillStyle = (sh.c && bg) ? bg : ink;
        ctx.fillRect(Math.round(x + sh.r[0] * k), Math.round(y + sh.r[1] * k),
                     Math.max(1, Math.round(sh.r[2] * k)), Math.max(1, Math.round(sh.r[3] * k)));
        ctx.fillStyle = ink;
      } else if (sh.p) {
        ctx.beginPath();
        sh.p.forEach(function (pt, i) {
          var X = x + pt[0] * k, Y = y + pt[1] * k;
          if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        });
        ctx.closePath();
        if (sh.s) ctx.stroke(); else ctx.fill();
      } else if (sh.l) {
        ctx.beginPath();
        ctx.moveTo(x + sh.l[0] * k, y + sh.l[1] * k);
        ctx.lineTo(x + sh.l[2] * k, y + sh.l[3] * k);
        ctx.stroke();
      }
    });
    ctx.restore();
    lastKindIconsDrawn.push(kind);
    return true;
  }

  function drawCard(rect, card, theme) {
    var col = colorForKind(card.kind);
    if (theme) {
      // 落ち影（本体より少し右下にずらして先に置く＝浮いて見える）
      px(rect.x + U(2), rect.y + U(2), rect.w, rect.h, 'rgba(0,0,0,.35)');
    }
    px(rect.x - U(1), rect.y - U(1), rect.w + U(2), rect.h + U(2), '#14161f');
    px(rect.x, rect.y, rect.w, rect.h, col.fill);
    px(rect.x, rect.y, rect.w, U(2), 'rgba(255,255,255,.35)');

    /* ★ 2026-09-28: 札の上の「作」「調」…の文字をやめ、種類の絵にする。 */
    var v = cardVisual(rect, card);
    /* 判定済みの札は右下に✓/✗のスタンプが乗るので、絵は左上に寄せて
       小さくし、スタンプと重ならないようにする。 */
    var ks, kx, ky;
    if (card.verdict) {
      ks = Math.round(Math.min(rect.w, rect.h) * 0.42);
      kx = Math.round(rect.x + U(2)); ky = Math.round(rect.y + U(2.5));
    } else {
      ks = Math.round(Math.min(rect.w, rect.h) * 0.52);
      kx = Math.round(rect.x + rect.w / 2 - ks / 2); ky = Math.round(rect.y + rect.h * 0.36 - ks / 2);
    }
    var drew = drawKindIcon(card.kind, kx, ky, ks, col.ink, col.fill);
    if (!drew) {
      clipped(rect, function () {
        centered(v.text, rect.x + rect.w / 2, rect.y + rect.h * 0.34, col.ink, v.size);
      });
    }
    /* ★ 2026-09-28: 不合格（verdict: not）の札は「壊れた品物」に見せる。
       黒ずませて、ひびを入れる。✗ のスタンプは今までどおり（合否の印は
       画面全体で1種類）。「不良品だった」が、印を読まなくても形で伝わる。 */
    if (card.verdict === 'not') drawCracked(rect);

    drawVerdictBadge(rect, card.verdict);

    if (theme && theme.pin) drawPin(rect, theme);
    else if (theme && theme.clipBody) drawClip(rect, theme);
    else if (theme && theme.hatch) drawHatch(rect, theme);
  }

  function drawOverflowSlot(rect, n) {
    px(rect.x - U(1), rect.y - U(1), rect.w + U(2), rect.h + U(2), '#14161f');
    px(rect.x, rect.y, rect.w, rect.h, '#3a404d');
    var text = AQ.i18n.t('room.card.more', { n: n });
    var size = fitSize(text, rect.w - U(4), Math.round(T * 0.3), 5);
    clipped(rect, function () {
      centered(text, rect.x + rect.w / 2, rect.y + rect.h / 2, '#f2f5fa', size);
    });
  }

  /** 「他 N 体」バッジの矩形を、描画せずに計算する（テスト用フックと
      drawOverflowBadge の両方がこれを使う）。
      2026-09-02: 以前は画面の右上固定（by=U(4)）だったため、板の枠
      （板は部屋の一番上にある）と重なるという報告があった。板のすぐ下
      （床のいちばん上の行）まで下げ、板・納品口・検品台のどれにも
      重ならないことを assert できるようにする。 */
  function computeOverflowBadgeRect(text, boardRect, dropoffRect, inspectRect) {
    var size = Math.max(6, Math.round(T * 0.22));
    var w = Math.ceil(textWidth(text, size)) + U(8);
    var h = size + U(6);
    var bounds = roomBounds();
    var bx = bounds.x + bounds.w - w - U(4);
    var by = (boardRect ? boardRect.y + boardRect.h : bounds.y) + U(4);
    [dropoffRect, inspectRect].forEach(function (r) {
      if (r) by = Math.min(by, r.y - h - U(4));
    });
    bx = Math.max(bounds.x, Math.min(bounds.x + bounds.w - w, bx));
    by = Math.max(bounds.y, Math.min(bounds.y + bounds.h - h, by));
    return { x: bx, y: by, w: w, h: h, size: size };
  }

  function drawOverflowBadge(n, boardRect, dropoffRect, inspectRect) {
    /* ★ 2026-09-28: 「他 5 体」の文をやめ、小さなロボットの顔＋「+5」にする。
       画面に入りきらないロボットの数は事実なので、数そのものは必ず出す。 */
    var text = AQ.i18n.t('room.robots.more', { n: n });
    var r = computeOverflowBadgeRect('☻ ' + text, boardRect, dropoffRect, inspectRect);
    px(r.x - U(1), r.y - U(1), r.w + U(2), r.h + U(2), '#14161f');
    px(r.x, r.y, r.w, r.h, '#20242e');
    var hs = Math.round(r.h * 0.62);
    var hx = r.x + U(3), hy = Math.round(r.y + (r.h - hs) / 2);
    px(hx, hy + Math.round(hs * 0.18), hs, Math.round(hs * 0.72), '#9aa4b8');   // 顔
    px(hx + Math.round(hs * 0.2), hy + Math.round(hs * 0.42), Math.max(1, Math.round(hs * 0.18)),
       Math.max(1, Math.round(hs * 0.18)), '#14161f');                            // 目
    px(hx + Math.round(hs * 0.62), hy + Math.round(hs * 0.42), Math.max(1, Math.round(hs * 0.18)),
       Math.max(1, Math.round(hs * 0.18)), '#14161f');
    px(hx + Math.round(hs * 0.45), hy, Math.max(1, Math.round(hs * 0.12)), Math.round(hs * 0.2), '#9aa4b8'); // アンテナ
    clipped(r, function () {
      label(text, hx + hs + U(3), r.y + U(3), '#ffd35c', r.size);
    });
  }

  /** 板・納品口・検品台の見出し文言。focus 中は「#Nに関わる依頼／納品」
      という、フィルタが掛かっていること自体が伝わる文言にする（task C）。
      黙って母数の小さい件数だけ出すと、絞り込み前の総数と見分けが
      付かず「表示が壊れた」ように見えてしまうため。 */
  function boardTitleText(lay, focus, numberOf) {
    var t = AQ.i18n.t, F = normFocus(focus);
    if (F && F.job != null) return t('room.board.titleJob', { n: lay.count });
    if (lay.focused) {
      var n = (numberOf && F && F.actor != null && numberOf[F.actor]) || '?';
      return t('room.board.titleFocused', { a: n, n: lay.count });
    }
    return t('room.board.title', { n: lay.count });
  }

  function dropoffTitleText(lay, focus, numberOf) {
    var t = AQ.i18n.t, F = normFocus(focus);
    if (F && F.job != null) return t('room.dropoff.titleJob', { n: lay.count });
    if (lay.focused) {
      var n = (numberOf && F && F.actor != null && numberOf[F.actor]) || '?';
      return t('room.dropoff.titleFocused', { a: n, n: lay.count });
    }
    return t('room.dropoff.title', { n: lay.count });
  }

  function inspectTitleText(lay, focus, numberOf) {
    var t = AQ.i18n.t, F = normFocus(focus);
    if (F && F.job != null) return t('room.inspect.titleJob', { n: lay.count, ok: lay.ok, ng: lay.ng });
    if (lay.focused) {
      var n = (numberOf && F && F.actor != null && numberOf[F.actor]) || '?';
      return t('room.inspect.titleFocused', { a: n, n: lay.count, ok: lay.ok, ng: lay.ng });
    }
    return t('room.inspect.title', { n: lay.count, ok: lay.ok, ng: lay.ng });
  }

  /** 札のすぐ下に、その依頼の呼び名（仮）を出す。
      ★ 2026-09-11: 札は 20px 角ほどしかないので、中に呼び名まで入れると
      読めない大きさになる。札の中は仕事の種類（作／評／調）のまま、
      呼び名は下に添える。呼び名はこのアプリが付けたラベルなので
      （src/nicknames.js）、正確な依頼IDは「詳細」に必ず出している。
      依頼1件に絞っているとき（lay.focused）だけ出す＝札が何枚も並ぶ
      画面で全部に名札を付けると、それこそ読めなくなる。 */
  function drawCardNick(rect, card) {
    /* ★ 2026-09-28: 札の下の呼び名（γ2・η10 …）は絵に出さない。
       「解読不能なエラーコードに見える」という指摘。どの札がどの依頼かは、
       札を押して「詳細」を開けば出る（呼び名も本物の依頼 ID も）。 */
    return;
    if (!AQ.nick || !card || card.id == null) return;
    var name = AQ.nick.forJob(String(card.id));
    if (!name) return;
    var size = fitSize(name, rect.w + U(10), Math.round(T * 0.22), 5);
    var tw = Math.ceil(textWidth(name, size)) + U(3);
    var bx = Math.round(rect.x + rect.w / 2 - tw / 2);
    var by = rect.y + rect.h + U(1);
    /* 札の下は板（山吹色）や検品台（灰色）の上なので、白文字だけだと
       背景に負ける。暗い下敷きを1枚敷いてから書く。 */
    px(bx, by, tw, size + U(2), 'rgba(10,11,20,.78)');
    clipped({ x: bx, y: by, w: tw, h: size + U(2) }, function () {
      centered(name, rect.x + rect.w / 2, by + (size + U(2)) / 2, '#f2f5fa', size);
    });
  }

  /* 検品の演出の的：このフレームで「いま検品している品物」を描いた矩形。
     見つからない（表示枠からあふれた等）ときは台の中央を的にする。 */
  var inspectTarget = null;

  function drawLayout(lay, kind, info, theme, opts) {
    frameBox(lay.rect.x, lay.rect.y, lay.rect.w, lay.rect.h, theme);
    signBar(lay.titleBar, kind, info, theme);
    var pendingId = opts && opts.pendingId, resultId = opts && opts.resultId, now = (opts && opts.now) || 0;
    var hideId = opts && opts.hideId, dropId = opts && opts.dropId;
    if (kind === 'dropoff') { drawChuteHatch(hatchRect(lay), (opts && opts.hatchOpen) || 0, theme); lastTrayDrawn = []; }
    lay.shown.forEach(function (it) {
      if (it.overflow) { drawOverflowSlot(it.rect, it.n); return; }
      var id = String(it.card.id);
      /* ★ 2026-10-07: 同じ依頼の札が何枚もありうるので、どの1枚かは key で見分ける
         （渡されたのが依頼IDなら、その依頼の札ぜんぶに当てはまる）。 */
      var kk = String(it.card.key || it.card.id);
      var is = function (x) { return x != null && (String(x) === kk || String(x) === id); };
      /* 投入口へ落ちている最中の品物は、まだ納品口の中に並べない。 */
      if (is(hideId)) return;
      if (kind === 'dropoff') lastTrayDrawn.push(id);
      if (is(dropId) && opts.dropBounce > 0) {
        /* 口から入って、中の列にとんと収まる（少し上から落ちてくる） */
        var rb = { x: it.rect.x, y: it.rect.y - Math.round(U(4) * opts.dropBounce), w: it.rect.w, h: it.rect.h };
        drawCard(rb, it.card, theme);
        return;
      }
      if (is(pendingId)) {
        /* 調べている最中の品物：台から少し浮いて、白く明滅する。
           合否はまだ出ない（印・ひびは結果が出てから）。 */
        var lift = Math.round(U(2.5) + U(1.5) * Math.sin(now / 210));
        px(it.rect.x + U(1), it.rect.y + it.rect.h - U(1), it.rect.w - U(2), U(2), 'rgba(0,0,0,.30)');
        var r2 = { x: it.rect.x, y: it.rect.y - lift, w: it.rect.w, h: it.rect.h };
        drawCard(r2, { id: it.card.id, kind: it.card.kind, state: it.card.state, holder: it.card.holder, verdict: null });
        var fl = 0.10 + 0.30 * (0.5 + 0.5 * Math.sin(now / 130));
        px(r2.x, r2.y, r2.w, r2.h, 'rgba(255,255,255,' + fl.toFixed(3) + ')');
        inspectTarget = r2;
        lastFxDrawn.push('float');
        return;
      }
      drawCard(it.rect, it.card, theme);
      if (is(resultId)) inspectTarget = it.rect;
      if (lay.focused) drawCardNick(it.rect, it.card);
    });
  }

  /** ★ 2026-09-18:「記録しているなら記録している動作を入れてください」。
      書き込みのコマで、行きは手にメモを持ち、板に着いたら貼って、
      帰りは手ぶらで戻る。依頼の札（drawCard）とは別の、小さな
      走り書きの形にしてある（仕事の札と取り違えないため）。 */
  var MEMO_W = 7, MEMO_H = 9;   // 20px設計の単位（U() で換算）
  function drawMemoAt(x, y) {
    var w = U(MEMO_W), h = U(MEMO_H);
    x = Math.round(x); y = Math.round(y);
    px(x + U(1), y + U(1), w, h, 'rgba(0,0,0,.35)');      // 影
    px(x, y, w, h, '#f4f1e4');                            // 紙
    px(x, y, w, U(1), '#ffffff');
    px(x, y + h - U(1), w, U(1), '#cdc7b4');
    for (var i = 2; i < 8; i += 2) {                      // 走り書きの線
      px(x + U(1), y + U(i), w - U(2), Math.max(1, U(0.6)), '#9aa0ae');
    }
  }
  /** 手に持ったメモの位置（drawHeldCard と同じく体の右下）。 */
  function memoHandRect(hx, hy) {
    var fw = SPRITE_W * SPRITE_SCALE, fh = SPRITE_H * SPRITE_SCALE;
    return { x: Math.round(hx + fw * 0.60), y: Math.round(hy + fh * 0.48), w: U(MEMO_W), h: U(MEMO_H) };
  }
  function drawMemo(hx, hy) {
    var r = memoHandRect(hx, hy);
    drawMemoAt(r.x, r.y);
  }
  /** ★ 2026-10-07: メモを貼る場所。板の前に立ったロボットの真上、
      札の列のすぐ下（札と重ならない）。以前は板の右上の隅で、
      立っている場所から遠く、手を伸ばして貼る絵が描けなかった。 */
  function memoSpot(r) {
    if (!r) return null;
    var m = frameMetrics();
    var cx = standCx(findObj('board'));
    if (cx == null) cx = r.x + r.w / 2;
    var w = U(MEMO_W), h = U(MEMO_H);
    var y = r.y + m.pad + m.titleH + U(3) + CARD_H + U(3);
    y = Math.min(y, r.y + r.h - m.pad - h);
    return { x: Math.round(cx - w / 2), y: Math.round(y), w: w, h: h };
  }

  /** 板に貼られたばかりのメモ（画鋲がきらりと光る）。 */
  function drawPinnedMemo(r, now) {
    var sp = memoSpot(r);
    if (!sp) return;
    drawMemoAt(sp.x, sp.y);
    var on = (now % 700) < 420;                           // 画鋲がきらり
    px(sp.x + Math.round(sp.w / 2) - U(1), sp.y - U(1), U(2), U(2), on ? '#ffd35c' : '#c9962c');
  }

  /* ---- 板に書く（2026-10-17）----------------------------------------
     ただの発言（あいさつなど）は、メモを貼るのではなく、ペンで板に字を書く。
     書く場所は、板の前に立ったロボットの真上（札の列のすぐ下）。 */
  function writeSpot(r) {
    var m = memoSpot(r); if (!m) return null;
    var w = U(30), h = U(12);
    var cx = m.x + m.w / 2;
    var x = Math.max(r.x + U(2), Math.min(r.x + r.w - w - U(2), cx - w / 2));
    var y = Math.max(r.y + U(4), Math.min(m.y, r.y + r.h - U(3) - h));   // 板の下の縁からはみ出さない
    return { x: Math.round(x), y: Math.round(y), w: w, h: h };
  }
  var WRITE_LINES = 3;
  /** 書いた字の線（frac: 0..1 まで書いたところ）。手書きらしい波線を白いチョークで。 */
  function writePos(sp, frac) {
    var total = WRITE_LINES, f = Math.max(0, Math.min(1, frac)) * total;
    var li = Math.min(total - 1, Math.floor(f)), along = f - li;
    var lw = sp.w - U(2) - (li === total - 1 ? U(5) : 0);
    return { x: sp.x + U(1) + lw * along, y: sp.y + U(2) + li * U(3.8) + Math.sin(along * 22) * U(0.8) };
  }
  /* ★ 2026-10-18 利用者の提案：掲示板に白紙が貼ってあり、その白紙に書き込む。
       紙（画鋲で留めた白紙）を先に描き、字はその上に濃いインクで書く。 */
  function paperOf(sp) { return { x: sp.x - U(1.5), y: sp.y - U(1), w: sp.w + U(3), h: sp.h + U(1) }; }
  function drawBlankPaper(sp) {
    var r = paperOf(sp);
    px(r.x + U(1), r.y + U(1), r.w, r.h, 'rgba(0,0,0,.35)');           // 影
    px(r.x, r.y, r.w, r.h, '#f6f1e2');                                    // 白紙
    px(r.x, r.y, r.w, Math.max(1, U(0.8)), '#ffffff');
    px(r.x, r.y + r.h - Math.max(1, U(0.8)), r.w, Math.max(1, U(0.8)), '#d8cfb6');
    px(r.x + r.w - U(3), r.y + r.h - U(3), U(3), U(3), '#e4dcc4');      // めくれた角
    var pc = r.x + Math.round(r.w / 2);
    px(pc - U(1), r.y - U(1), U(2), U(2), '#d23c3c');                     // 画鋲
    px(pc - Math.max(1, U(0.5)), r.y - U(1), Math.max(1, U(0.8)), Math.max(1, U(0.8)), '#ff8a7a');
  }
  function drawWrittenLines(sp, frac, now, settled) {
    if (!sp) return;
    drawBlankPaper(sp);
    var f = Math.max(0, Math.min(1, frac)) * WRITE_LINES;
    var th = Math.max(2, Math.round(U(1.2)));
    for (var li = 0; li < WRITE_LINES; li++) {
      var part = Math.max(0, Math.min(1, f - li));
      if (part <= 0) break;
      var lw = sp.w - U(2) - (li === WRITE_LINES - 1 ? U(5) : 0);
      var n = Math.max(1, Math.round(lw * part / Math.max(1, U(1))));
      var y0 = sp.y + U(2) + li * U(3.8);
      for (var k = 0; k < n; k++) {
        var a = (k / Math.max(1, Math.round(lw / Math.max(1, U(1)))));
        var dy = Math.round(Math.sin(a * 22 + li) * U(0.8) + (k % 3 === 0 ? -U(0.6) : 0));
        px(sp.x + U(1) + k * Math.max(1, U(1)), y0 + dy, Math.max(1, U(1)), th, '#2b3446');   // 濃いインク
      }
    }
    if (settled) {                                     // 書きおえた字：下に小さく下線（書いた印）
      px(sp.x + U(1), sp.y + sp.h - Math.max(1, U(0.6)), Math.round(sp.w * 0.4), Math.max(1, U(0.5)), 'rgba(43,52,70,.55)');
    }
  }
  /** 手に持ったペン（体の右下）。 */
  function drawPenAt(x, y) {
    x = Math.round(x); y = Math.round(y);
    var w = Math.max(3, U(2.4)), h = U(8);
    px(x + 1, y + 1, w, h, 'rgba(0,0,0,.35)');
    px(x, y, w, h, '#3b6fe0');                         // 軸
    px(x, y, w, Math.max(1, U(1.2)), '#1f3f8f');       // キャップ
    px(x + Math.round(w / 2) - Math.max(1, Math.round(U(0.6))), y + h, Math.max(2, U(1.2)), Math.max(2, U(1.4)), '#1d2433');   // ペン先（インク）
  }
  function drawPen(hx, hy) {
    var r = memoHandRect(hx, hy);
    drawPenAt(r.x + U(2), r.y + U(1));
  }
  /** 板の前で、腕を伸ばしてペンで字を書き、腕を戻す。q: 立ち止まり 0..1。段階名は貼る動作と同じ（reach→press→back）。 */
  function drawWriteOn(q, sp, sr, fig, hx, hy, now) {
    if (!sp || !sr || q >= WRITE_BACK) return;
    var side = (sp.x + sp.w / 2 >= sr.x + sr.w / 2) ? 1 : -1;
    var sh = shoulderFor(sr, fig, side);
    var hr = memoHandRect(hx, hy), hand = { x: hr.x + U(2), y: hr.y + U(6) };
    var tip, stage, frac;
    if (q < WRITE_REACH) {
      frac = 0; tip = lerpPt(hand, writePos(sp, 0), easeIO(q / WRITE_REACH)); stage = 'reach';
    } else if (q < WRITE_DONE) {
      frac = (q - WRITE_REACH) / (WRITE_DONE - WRITE_REACH); tip = writePos(sp, frac); stage = 'press';
      lastFxDrawn.push('write');
    } else {
      frac = 1; stage = 'back';
      tip = lerpPt(writePos(sp, 1), sh, easeIO((q - WRITE_DONE) / (WRITE_BACK - WRITE_DONE)));
      drawSparkle(sp.x + sp.w - U(4), sp.y + U(1), (q - WRITE_DONE) / 0.16);
    }
    drawWrittenLines(sp, frac, now, stage === 'back');
    var j = drawArm(sh.x, sh.y, Math.round(tip.x), Math.round(tip.y), stage !== 'back', side);
    if (stage !== 'back') drawPenAt(tip.x - U(1.2), tip.y - U(9.2));   // ペン先が腕の先（字の書きはじめ）に来るように
    lastReachDrawn = { kind: 'memo', stage: stage, q: q, to: sp, card: null, grip: stage !== 'back', write: frac,
                       arm: { sx: sh.x, sy: sh.y, tx: tip.x, ty: tip.y, ex: j.ex, ey: j.ey } };
  }
  /** 頭上の絵：ペン（書き込みに行くところ） */
  function pictoPen(x, y, s) {
    px(x + Math.round(s * 0.10), y + Math.round(s * 0.62), Math.round(s * 0.80), Math.max(1, U(0.8)), '#fbf7ea');   // 書いた線
    px(x + Math.round(s * 0.18), y + Math.round(s * 0.80), Math.round(s * 0.50), Math.max(1, U(0.8)), '#fbf7ea');
    var bx = x + Math.round(s * 0.58), by = y + Math.round(s * 0.04);
    px(bx, by, Math.max(2, Math.round(s * 0.20)), Math.round(s * 0.46), '#3b6fe0');
    px(bx, by, Math.max(2, Math.round(s * 0.20)), Math.max(1, Math.round(s * 0.12)), '#1f3f8f');
    px(bx + Math.round(s * 0.06), by + Math.round(s * 0.46), Math.max(1, Math.round(s * 0.08)), Math.max(1, Math.round(s * 0.10)), '#fbf7ea');
  }

  /* ---- 手を伸ばして取る・貼る（2026-10-07）--------------------------
     報告「掲示板にあった仕事を引き受けたとあるが、掲示板に手を伸ばして
     仕事が書かれた紙を取るという行動のアニメーションが欲しい。同様の
     問題は他にも多くあると思うので、すべて探し出して実装して」。
     探した結果、手の動きが無かったのは次の4つ（納品だけは腕があった）:
       ②引き受けた … 板の前を素通りして、机に戻った瞬間に札が手に現れた
       ①出した     … 持ってきた札が、着いた瞬間に板へワープした
       書き込み     … 道の真ん中でメモが手から板へ瞬間移動した
       ④判定       … 納品口の品物が、検品台に着いた瞬間にワープした
     どれも「立ち止まる → 腕を伸ばす → つかむ／貼る → 腕を戻す」を描く。
     見た目だけ。何が起きたか（件数・順番・合否）には触れない。 */
  function easeIO(e) { e = Math.max(0, Math.min(1, e)); return e * e * (3 - 2 * e); }
  function lerpPt(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function lerpRect(a, b, t) { return { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t), w: a.w, h: a.h }; }
  function shoulderFor(sr, fig, side) {
    var body = AQ.sprites.bodyRect ? AQ.sprites.bodyRect(fig, sr.x, sr.y, sr.w, sr.h) : null;
    if (!body) body = { x: sr.x + sr.w * 0.15, y: sr.y + sr.h * 0.35, w: sr.w * 0.7, h: sr.h * 0.5 };
    return { x: Math.round(side > 0 ? body.x + body.w - U(1) : body.x + U(1)),
             y: Math.round(body.y + body.h * 0.34), body: body };
  }
  /** 手に持った札の位置（drawHeldCard と同じ計算）。 */
  function heldRect(hx, hy, slot) {
    var fw = SPRITE_W * SPRITE_SCALE, fh = SPRITE_H * SPRITE_SCALE;
    var x = hx + Math.round(fw * 0.62) + (slot || 0) * U(3);
    var y = hy + Math.round(fh * 0.52) + (slot || 0) * U(2);
    var fb = floorBand();
    x = Math.max(fb.x, Math.min(fb.x + fb.w - CARD_W, x));
    y = Math.max(fb.y, Math.min(fb.y + fb.h - CARD_H, y));
    return { x: x, y: y, w: CARD_W, h: CARD_H };
  }
  /** 札のどこをつかむか。上にある家具（板）へは下から、下にある家具
      （納品口）へは上から手を伸ばす。 */
  function gripPt(r, fromBelow) {
    return { x: r.x + r.w / 2, y: fromBelow ? r.y + r.h - U(2) : r.y + U(2) };
  }
  /** 画鋲（取るときは抜けて飛び、貼るときはきらりと光る）。 */
  function drawPinPop(x, y, t) {
    if (t <= 0 || t >= 1) return;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    var py = y - U(7) * Math.sin(Math.PI * Math.min(1, t * 1.2));
    px(Math.round(x + U(4) * t - U(1)), Math.round(py), U(2), U(2), '#d94a4a');
    px(Math.round(x + U(4) * t - U(1)), Math.round(py), U(1), U(1), '#ffd0c8');
    ctx.restore();
  }
  function drawSparkle(x, y, t) {
    if (t <= 0 || t >= 1) return;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    var d = Math.round(U(2) + U(5) * t), s = Math.max(1, U(1.2));
    ctx.fillStyle = '#ffd35c';
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (v) {
      ctx.fillRect(Math.round(x + v[0] * d - s / 2), Math.round(y + v[1] * d - s / 2), s, s);
    });
    ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    ctx.restore();
  }

  var lastReachDrawn = null;   // 検査用：直前のフレームで描いた「手を伸ばす」動作
  /** 家具から札を取る（claim＝板から／pickup＝納品口から）。q: 立ち止まり 0..1。 */
  function drawTake(kind, q, from, card, sr, fig, hx, hy, where) {
    if (!from || !sr || q >= BACK_END) return;
    where = where || (kind === 'claim' ? 'board' : 'dropoff');
    var fromBelow = (where === 'board');
    var side = (from.x + from.w / 2 >= sr.x + sr.w / 2) ? 1 : -1;
    var sh = shoulderFor(sr, fig, side);
    var to = heldRect(hx, hy, 0);
    var g0 = gripPt(from, fromBelow);
    var tip, cardR = null, grip = false, stage;
    if (q < REACH_END) {
      tip = lerpPt(sh, g0, easeIO(q / REACH_END)); stage = 'reach';
    } else if (q < GRAB_AT) {
      tip = g0; grip = q > (REACH_END + GRAB_AT) / 2; stage = 'grip';
    } else if (q < LIFT_END) {
      var l = (q - GRAB_AT) / (LIFT_END - GRAB_AT);
      cardR = { x: from.x, y: Math.round(from.y + (fromBelow ? U(4) : -U(5)) * easeIO(l)), w: from.w, h: from.h };
      tip = gripPt(cardR, fromBelow); grip = true; stage = 'lift';
      if (where === 'board') drawPinPop(from.x + from.w / 2, from.y, l);
      lastFxDrawn.push(where === 'board' ? 'take' : 'pickup');
    } else {
      var lifted = { x: from.x, y: from.y + (fromBelow ? U(4) : -U(5)), w: from.w, h: from.h };
      cardR = lerpRect(lifted, to, easeIO((q - LIFT_END) / (BACK_END - LIFT_END)));
      tip = gripPt(cardR, fromBelow); grip = true; stage = 'back';
    }
    if (cardR && card) { drawCard(cardR, card); drawCardNick(cardR, card); }
    var j = drawArm(sh.x, sh.y, Math.round(tip.x), Math.round(tip.y), grip, side);
    lastReachDrawn = { kind: kind, stage: stage, q: q, from: from, card: cardR, grip: grip,
                       arm: { sx: sh.x, sy: sh.y, tx: tip.x, ty: tip.y, ex: j.ex, ey: j.ey } };
  }
  /** 持ってきたものを家具に貼る（post＝依頼の札／memo＝書き込みのメモ）。
      q: post は着いてから 0..1、memo は立ち止まり 0..1。 */
  function drawPinTo(kind, q, to, card, sr, fig, hx, hy, now) {
    if (!to || !sr || q >= PIN_BACK) return;
    var side = (to.x + to.w / 2 >= sr.x + sr.w / 2) ? 1 : -1;
    var sh = shoulderFor(sr, fig, side);
    var from = (kind === 'memo') ? memoHandRect(hx, hy) : heldRect(hx, hy, 0);
    var tip, thing = null, grip = true, stage;
    if (q < PIN_REACH) {
      thing = lerpRect(from, to, easeIO(q / PIN_REACH)); stage = 'reach';
    } else if (q < PIN_AT) {
      var k = (q - PIN_REACH) / (PIN_AT - PIN_REACH);
      thing = { x: to.x, y: to.y - Math.round(U(1.5) * Math.sin(Math.PI * k)), w: to.w, h: to.h }; stage = 'press';
    }
    if (thing) {
      tip = gripPt(thing, true);
      if (kind === 'memo') drawMemoAt(thing.x, thing.y);
      else if (card) { drawCard(thing, card); drawCardNick(thing, card); }
    } else {
      /* 貼ったあと：腕を戻す。画鋲がきらりと光る。 */
      var b = easeIO((q - PIN_AT) / (PIN_BACK - PIN_AT));
      tip = lerpPt(gripPt(to, true), sh, b); grip = false; stage = 'back';
      drawSparkle(to.x + to.w / 2, to.y, (q - PIN_AT) / 0.16);
      if (q < PIN_AT + 0.12) lastFxDrawn.push('pin');
    }
    var j = drawArm(sh.x, sh.y, Math.round(tip.x), Math.round(tip.y), grip, side);
    lastReachDrawn = { kind: kind, stage: stage, q: q, to: to, card: thing, grip: grip,
                       arm: { sx: sh.x, sy: sh.y, tx: tip.x, ty: tip.y, ex: j.ex, ey: j.ey } };
  }
  /** ★ 2026-10-19 机で作業する（q: 0..1）。札を手元に置き、両手でキーボードを打つように
      札に触れ、札に字の線が左から増えていく。頭上には進み具合と、分かるときは実時間。 */
  var lastWorkDrawn = null;   // 検査用
  function drawWork(q, card, sr, fig, hx, hy, now, elapsed) {
    if (q == null || !sr) return;
    var r = heldRect(hx, hy, 0);
    if (card) drawCard(r, card); else px(r.x, r.y, r.w, r.h, '#f2f5fa');
    /* 字の線：3行。順に左から伸びる */
    var lines = 3, lx = r.x + U(2), lw = r.w - U(4), lh = Math.max(1, U(1.2));
    var fill = Math.min(1, q / 0.85) * lines;
    for (var i = 0; i < lines; i++) {
      var f = Math.max(0, Math.min(1, fill - i));
      if (f <= 0) break;
      var ly = r.y + Math.round(r.h * (0.52 + i * 0.15));
      px(lx, ly, Math.max(1, Math.round(lw * f * (i === lines - 1 ? 0.6 : 1))), lh, 'rgba(20,22,31,.75)');
    }
    /* 両手でカタカタ（作業が終わったら手を止める） */
    var typing = q < 0.85;
    var side = (r.x + r.w / 2 >= sr.x + sr.w / 2) ? 1 : -1;
    var sh = shoulderFor(sr, fig, side);
    var tap = typing ? Math.round(U(2) * Math.abs(Math.sin(now / 70))) : 0;
    var tx = r.x + U(2) + (r.w - U(4)) * ((fill % 1) || (typing ? 0 : 1)),
        ty = r.y + r.h * (0.5 + Math.min(lines - 1, Math.floor(fill)) * 0.15) - tap;
    if (!typing) { tx = r.x + r.w * 0.6; ty = r.y + r.h * 0.4; }
    drawArm(sh.x, sh.y, Math.round(tx), Math.round(ty), false, side);
    if (typing && Math.floor(now / 140) % 2 === 0) {
      px(r.x + r.w + U(1), r.y - U(1), Math.max(1, U(1)), Math.max(1, U(1)), '#ffd35c');
      px(r.x - U(2), r.y + U(1), Math.max(1, U(1)), Math.max(1, U(1)), '#ffd35c');
    }
    if (!typing) drawSparkle(r.x + r.w / 2, r.y, (q - 0.85) / 0.15);
    /* 進み具合のゲージ（頭上）と実時間 */
    /* 名札は頭の上にあるので、ゲージと時間は足もと（重ならないように） */
    var gw = Math.round(sr.w * 0.8), gh = Math.max(2, U(2));
    var gx = Math.round(sr.x + (sr.w - gw) / 2), gy = Math.round(sr.y + sr.h + U(2));
    px(gx - 1, gy - 1, gw + 2, gh + 2, '#0d1017');
    px(gx, gy, gw, gh, '#2a3040');
    px(gx, gy, Math.round(gw * Math.min(1, q / 0.85)), gh, '#5ad1a8');
    if (elapsed) {
      var sz = Math.max(6, Math.round(TAG_FONT || U(6)));
      var tw = Math.ceil(textWidth(elapsed, sz));
      var ex = Math.round(gx + gw / 2 - tw / 2), ey = gy + gh + U(2);
      px(ex - U(1), ey - U(1), tw + U(2), sz + U(2), 'rgba(13,16,23,.85)');
      label(elapsed, ex, ey, '#ffd35c', sz);
    }
    lastWorkDrawn = { q: q, card: r, elapsed: elapsed || null };
  }

  /** 引き受け（CLAIM）から納品（DELIVER/RESULT）までの実時間の表示。
      どちらもサーバーの実時刻（tSource='server'）があるときだけ。推測では出さない。 */
  var workLabelMemo = {};
  function workElapsedLabel(beat, beats) {
    if (!beat) return null;
    var mk = String(beat.index);
    if (Object.prototype.hasOwnProperty.call(workLabelMemo, mk)) return workLabelMemo[mk];
    var out = null, who = String(beat.actor), dEv = null;
    ((beat.events) || (beat.lead ? [beat.lead] : [])).forEach(function (e) {
      if (!dEv && e && String(e.actor) === who && e.type === 'result.ok' && e.meta && e.meta.job != null && !e.meta.verdict) dEv = e;
    });
    if (dEv && dEv.meta.tSource === 'server') {
      var job = String(dEv.meta.job), cT = null;
      (beats || []).forEach(function (b) {
        ((b && b.events) || (b && b.lead ? [b.lead] : [])).forEach(function (e) {
          if (e && String(e.actor) === who && e.meta && String(e.meta.job) === job && e.meta.role != null &&
              e.meta.tSource === 'server' && e.t <= dEv.t && (cT == null || e.t > cT)) cT = e.t;
        });
      });
      if (cT != null) {
        var sec = Math.max(1, Math.round((dEv.t - cT) / 1000));
        var t = AQ.i18n.t;
        out = sec < 60 ? t('room.work.sec', { n: sec })
            : sec < 3600 ? t('room.work.min', { n: Math.round(sec / 60) })
            : t('room.work.hr', { n: Math.round(sec / 360) / 10 });
      }
    }
    workLabelMemo[mk] = out;
    return out;
  }
  /** 検品台に着いた直後、運んできた品物を腕で台に置き、腕を戻す。q: 着いてから 0..1。 */
  var PLACE_AT = 0.10, PLACE_END = 0.18;
  function drawPlace(q, target, card, sr, fig, hx, hy) {
    if (!target || !sr || q >= PLACE_END) return;
    var side = (target.x + target.w / 2 >= sr.x + sr.w / 2) ? 1 : -1;
    var sh = shoulderFor(sr, fig, side);
    var tip, cardR = null, grip, stage;
    if (q < PLACE_AT) {
      cardR = lerpRect(heldRect(hx, hy, 0), target, easeIO(q / PLACE_AT));
      tip = gripPt(cardR, false); grip = true; stage = 'reach';
      if (card) { drawCard(cardR, card); drawCardNick(cardR, card); }
    } else {
      tip = lerpPt(gripPt(target, false), sh, easeIO((q - PLACE_AT) / (PLACE_END - PLACE_AT))); grip = false; stage = 'back';
    }
    var j = drawArm(sh.x, sh.y, Math.round(tip.x), Math.round(tip.y), grip, side);
    lastReachDrawn = { kind: 'place', stage: stage, q: q, to: target, card: cardR, grip: grip,
                       arm: { sx: sh.x, sy: sh.y, tx: tip.x, ty: tip.y, ex: j.ex, ey: j.ey } };
  }
  /** このコマで新しく板に出た札（①出した）。古い順。 */
  function postedIds(index) {
    var prev = {}, out = [];
    cardStateAt(index - 1).forEach(function (c) { prev[c.key] = c; });
    cardStateAt(index).forEach(function (c) {
      if (c.state === 'board' && (!prev[c.key] || prev[c.key].state !== 'board')) out.push(String(c.key));
    });
    return out;
  }
  function jobOfKey(key) { var k = String(key == null ? '' : key); var h = k.lastIndexOf('#'); return h > 0 ? k.slice(0, h) : k; }

  function drawHeldCard(card, hx, hy, slot) {
    /* ★ 本体の真上に重ねると、せっかく大きくしたロボットが札で隠れる。
       体の右下に、少しはみ出す位置で添える（壁や台を突き抜けないよう、
       札も床の帯に収める＝ heldRect）。
       手に持っている札は板にも台にも乗っていないので、pin/clip は付けない。 */
    var r = heldRect(hx, hy, slot);
    drawCard(r, card);
    drawCardNick(r, card);
  }

  /* ---------- コマごとの演出 ----------
     ★ plan / planbatch にはもう演出を出さない（2026-09-01 撤去）。
     依頼が板に出たことは、その場でカードが板の枠の中に現れることで
     もう見えている（buildCardTimeline / computeBoardLayout）。以前は
     ここでさらに「PINNED」と書いた白い吹き出しを板の前に重ねて出して
     いたが、板はもう小さな枠いっぱいにカードが並ぶ密な絵になったので、
     吹き出しがカードの上に浮かんで「3枚目の、壊れたカード」に見える
     という報告があった。同じ情報をもう一度、しかも劣化した見た目で
     繰り返すだけなので、素直に削除する（情報は減っていない＝板の
     カード・実況欄・生ログの3か所にちゃんと残っている）。 */
  var OVERLAY = {
    /* ★ 2026-09-27: 「OK」「REJECTED」という英単語をやめ、札のスタンプと
       まったく同じ ✓ / ✗ を出す（同じことは同じ形で言う）。
       ただし数字のステータス（402 など）は文字のまま残す。402 は
       このアプリが伝えたい事実そのもので、印に置き換えると消えてしまう。 */
    receive: function (hx, hy, b, p, now) {
      /* ★ 2026-09-28 修正: 前回、合否の印を札のスタンプと同じ✓に揃えた
         とき、この吹き出しは「納品した」（③・まだ誰も判定していない）でも
         「HTTP 200」でも出ていた。✓は画面全体で「合格」の意味なので、
         判定前の納品に✓を出すと、合格したように見えてしまう（誤り）。
         ✓を出すのは、判定が合格（verdict: useful）だったときだけ。
         それ以外の到着は、頭上の状態表示（ゲージが満ちた絵）が伝える。 */
      /* ★ 2026-09-28: 合格の ✓ も頭上には出さない。検品の結果は、
         調べていた品物そのものから弾け出る（drawVerdictBurst）。
         頭上にぽつんと浮かぶと、何に対する ✓ なのかが切れて見えた（報告）。 */
      return;
    },
    error: function (hx, hy, b, p, now) {
      var m = (b.lead && b.lead.meta) || {};
      if ((now % 700) > 480) return;
      var code = String((b.lead && b.lead.status) || '');
      /* 不合格の ✗ は品物から弾け出る（drawVerdictBurst）ので頭上には出さない。 */
      if (m.verdict === 'not') return;
      if (!code) {
        var s2 = U(9);
        bubble(hx - U(4), hy - U(16), U(13), U(13));
        drawMark(hx - U(2), hy - U(14), s2, false, MARK_ON_LIGHT.ng, U(1.4));
        return;
      }
      var size = Math.max(6, U(6));
      var w = textWidth(code, size) + U(6);
      bubble(hx - U(2) - w / 2, hy - U(17), w, U(11));
      label(code, hx + U(1) - w / 2, hy - U(15), MARK_ON_LIGHT.ng, size);
    },
    idle: function (hx, hy, b, p, now) {
      if ((now % 900) > 600) return;
      bubble(hx - U(8), hy - U(16), U(20), U(11));
      label('…', hx - U(4), hy - U(15), '#5a6070', Math.max(7, U(7)));
    },
    batch: function (hx, hy, b, p, now) {
      var n = Math.min(14, Math.ceil(b.count * Math.min(1, p * 1.2)));
      var w = U(40), h = U(12) + n * U(2);
      var x = hx - U(12), y = hy - U(8) - h;
      px(x - U(1), y - U(1), w + U(2), h + U(2), '#0d1017');
      px(x, y, w, h, '#f4f4ef');
      px(x, y, w, U(1), '#ffffff');
      label(String(b.count), x + U(2), y + U(2), '#14161f', Math.max(6, U(6)));
      for (var i = 0; i < n; i++) px(x + U(3), y + U(11) + i * U(2), w - U(6) - (i % 3) * U(4), U(1), '#8b8f99');
    }
  };
  /* 'actbatch'（payment.* を含まない束）も見た目は同じ「積み上がる紙」の
     演出でよい（この絵自体、金額もドル記号も出していない＝ここは
     使い回しても嘘にならない）。 */
  OVERLAY.actbatch = OVERLAY.batch;

  /** 今アクティブな actor に加えて、直近に動いていた actor を全部候補に
      挙げたうえで、config.maxRobots 体だけを「直近に動いた順」で選ぶ。
      アクティブな actor は必ずこのコマの beats[index2] を持つので、
      lastBeatOf の値が index2 と一致し、他のどの候補より必ず新しい
      （＝上限に切られて消える、ということが起きない）。
      残りは配列に .overflow として件数だけ添えて返す（描画しない分も
      数としては絶対に取りこぼさない）。 */
  /* focusActor が指定されているときは、その1体だけを描く。
     コマ列（clock.beats）は main.js 側で既に絞られているが、絵のほうは
     「最近動いた8体」を出し続けていたので、1体だけ選んだのに画面には
     他人が並んだままだった。絞ったなら絵も1体にする。 */
  function activeRobots(beat, beats, index2, p, focus) {
    if (!actorBeats) prepare(beats);
    var F = normFocus(focus);
    var activeActor = beat.actor || 'agent';

    var candidates = [];
    Object.keys(actorBeats).forEach(function (actor) {
      if (!focusHasActor(F, actor)) return;
      var j = lastBeatOf(actor, index2);
      if (j !== -1) candidates.push({ actor: actor, j: j });
    });
    candidates.sort(function (a, b2) {
      if (b2.j !== a.j) return b2.j - a.j;               // 直近に動いた方を先に
      return a.actor < b2.actor ? -1 : (a.actor > b2.actor ? 1 : 0);
    });

    var max = cfg.maxRobots || 8;
    var overflow = Math.max(0, candidates.length - max);
    var chosen = candidates.slice(0, max);
    // 選ばれた中では actor名順に固定（フレームごとに並び順が暴れないように）
    chosen.sort(function (a, b2) { return a.actor < b2.actor ? -1 : (a.actor > b2.actor ? 1 : 0); });

    var robots = chosen.map(function (c) {
      var b = beats[c.j];
      var route = (focusPlan && focusPlan.routes[c.j]) || b._route || [deskFor(c.actor)];
      var isActive = (c.j === index2 && c.actor === activeActor);
      /* ★ 2026-09-28: 歩く速さを一定にした（walkRaw）。
         報告「0.25倍なのに、エージェントを選ぶと猛然としたスピードで動き出し、
         その後 0.25倍の動きになる」。原因は2つあった：
           ・どのコマも決まった時間内に歩き切る作りで、遠い場所へ行くコマほど
             速く歩いた（実測：同じまとめの中で 1.49 と 0.36 マス/秒、約4倍）
           ・件数の多い場面では1コマの間に何度も往復させていた（往復のぶん速い）
         往復はやめ、遠い場所へ行くコマは歩き切れるだけコマを長くする
         （engine/clock.js）。件数の多さはステータス欄の数字が正確に伝える。 */
      var trip = isActive ? tripAt(b, p, route) : { w: 1, stopQ: null, past: true };
      var raw = trip.w;
      var lg = isActive ? legOf(raw, 1) : { w: 1, back: false };
      var walked = lg.w;
      var pos = AQ.path.posOn(route, walked);
      /* 帰り道は道を逆向きに歩く。posOn は経路の向き（＝行き）で
         向きを返すので、そのままだと後ろ歩きに見える。 */
      if (lg.back) pos.dir = FLIP_DIR[pos.dir] || pos.dir;
      if (!isActive) pos.dir = 'down';
      /* ★ 2026-10-07: 家具の前で立ち止まっている間は、その家具のほうを向く
         （板は上、納品口は下）。足は止める。 */
      var stop = (isActive && trip.stopQ != null) ? { q: trip.stopQ, kind: route.stopKind } : null;
      if (stop) pos.dir = ((route.stopFrom || 'board') === 'board') ? 'up' : 'down';
      var moving = isActive && route.length > 1 && raw < 1 && !stop;
      /* 検査用の覗き穴。いま動いている本人が、経路のどこを・行きか
         帰りかで歩いているか（世界座標。画面座標はカメラが本人を
         追うので、往復しても数字がほとんど動かず測れない）。 */
      if (isActive) lastWalkInfo = { w: walked, raw: raw, back: lg.back, x: pos.x, y: pos.y,
        /* 経路が「行って戻る」形か（②引き受けたは desk→板→desk で
           1本の経路が既に往復になっている）。山の数から往復回数を
           逆算するとき、この形かどうかで期待値が変わる。 */
        roundTrip: !!(route.length > 1 &&
                      route[0][0] === route[route.length - 1][0] &&
                      route[0][1] === route[route.length - 1][1]),
        stopQ: stop ? stop.q : null, stopKind: route.stopKind || null, past: !!trip.past };
      return { actor: c.actor, beat: b, pos: pos, moving: moving, isActive: isActive, stop: stop };
    });
    robots.overflow = overflow;
    return robots;
  }

  /* ★ 2026-10-19: 名札に役割（依頼主・働き手・検品役）を添える。
     「知らないロボットが2体出てきて、どれが自分か・何をしているのか分からない」
     という利用者の指摘への対応。kibble の決まりでは3者は別々のエージェント。
     役割は実際に掲示板へ書いた行（JOB / CLAIM・DELIVER / ATTEST）からだけ決める
     （推測では付けない）。依頼主が自分で判定（ATTEST）した場合は依頼主のまま。 */
  var VERB_RE = /^\s*(JOB|CLAIM|DELIVER|RESULT|ATTEST)\b/i;
  var roleCache = null;
  function roleOfFor(beats) {
    if (roleCache && roleCache.beats === beats) return roleCache.roleOf;
    var roleOf = {};
    (beats || []).forEach(function (b) {
      var evs = (b && b.events) || (b && b.lead ? [b.lead] : []);
      evs.forEach(function (e) {
        if (!e || e.actor == null) return;
        var m = e.meta || {}, mt = VERB_RE.exec(String(m.raw || ''));
        if (!mt) return;
        var v = mt[1].toUpperCase(), a = String(e.actor);
        if (v === 'JOB') roleOf[a] = 'poster';
        else if (roleOf[a] === 'poster') return;
        else if (v === 'ATTEST') { if (!roleOf[a]) roleOf[a] = 'inspector'; }
        else if (!roleOf[a] || roleOf[a] === 'inspector') roleOf[a] = 'worker';
      });
    });
    roleCache = { beats: beats, roleOf: roleOf };
    return roleOf;
  }

  var numberOfCache = null;
  function numberOfFor(beats) {
    if (!numberOfCache || numberOfCache.beats !== beats) {
      numberOfCache = { beats: beats, numberOf: AQ.roster.build(beats).numberOf };
    }
    return numberOfCache.numberOf;
  }

  /** ロボットの画面位置（スプライトどうしが重ならない）と、この1フレーム
      ぶんの名札（スプライトから離れすぎない）を計算する（render() と
      テスト用フックの両方がこれを使う）。

      ★ アクティブな（今まさに動いている）ロボットを最優先で本来の
        位置に置き、残りはその周りで空いている場所を探して埋める。
        そうしないと、歩いている最中のロボットが衝突回避で急に
        横へずれて見えることがある。 */
  function layoutRobots(robots, cam, numberOf, roleOf) {
    var spriteW = Math.round(SPRITE_W * SPRITE_SCALE), spriteH = Math.round(SPRITE_H * SPRITE_SCALE);
    var placedSprites = [];
    var tagRects = [];
    // 名札は板・納品口・検品台の枠の上には絶対に置かない（2026-09-02 の報告）。
    var boardObj = findObj('board'), dropoffObj = findObj('dropoff'), inspectObj = findObj('inspect');
    var forbidden = [];
    if (boardObj) forbidden.push(objRect(boardObj));
    if (dropoffObj) forbidden.push(objRect(dropoffObj));
    if (inspectObj) forbidden.push(objRect(inspectObj));

    var priority = robots.slice().sort(function (a, b2) {
      if (a.isActive !== b2.isActive) return a.isActive ? -1 : 1;
      return a.actor < b2.actor ? -1 : (a.actor > b2.actor ? 1 : 0);
    });

    var byActor = {};
    priority.forEach(function (r) {
      var baseX = Math.round((r.pos.x - cam.x) * T) + U(2);
      var baseY = Math.round((r.pos.y - cam.y) * T);
      var spriteRect = placeSpriteRect(placedSprites, baseX, baseY, spriteW, spriteH);

      /* ★ 2026-09-11: 名札を「#9」だけから「#9 カワウソ」に。番号だけでは
         どのロボットが誰なのか覚えられない、という報告への対応。
         呼び名はこのアプリが付けたラベル（src/nicknames.js）。画面が
         狭いので（仮）は名札には付けず、実況・一覧・詳細の側で必ず
         （仮）と本物のIDを出す。 */
      var text = numberOf ? AQ.roster.label(numberOf, r.actor) : '#?';
      if (AQ.nick && r.actor != null) {
        var nk = AQ.nick.forActor(String(r.actor));
        if (nk) text += ' ' + nk;
      }
      var role = roleOf && r.actor != null && roleOf[String(r.actor)];
      if (role) text += AQ.i18n.t('room.role.sep') + AQ.i18n.t('room.role.' + role);
      var tw = Math.ceil(textWidth(text, TAG_FONT)) + TAG_PAD * 2;
      var th = TAG_FONT + TAG_PAD * 2;
      var tag = placeTagRect(tagRects, spriteRect, tw, th, forbidden);

      byActor[r.actor] = {
        actor: r.actor,
        r: r,
        tileKey: Math.round(r.pos.x) + ',' + Math.round(r.pos.y),
        hx: spriteRect.x,
        hy: spriteRect.y,
        spriteRect: spriteRect,
        tagText: text,
        tagRect: tag.rect,
        tagLeader: tag.leader,
        tagAnchor: tag.anchor
      };
    });

    var list = robots.map(function (r) { return byActor[r.actor]; });
    list.overflow = robots.overflow || 0;
    return list;
  }

  /* ---------- 公開API（scene.js と同じ形） ---------- */
  AQ.room = {
    init: function (canvas) {
      C = canvas; ctx = canvas.getContext('2d');
      cfg = AQ.config; S = AQ.sprites; W = AQ.roomWorld; T = W.tile;
      SCALE = T / 20;
      SPRITE_SCALE = T / 40;
      /* ★ 2026-09-06: 実解像度で描く。
         それまでは canvas の内部解像度を「マス数 × tile」に固定し、
         CSS で引き伸ばしていた。実測すると 800px の絵を 2028 実ピクセルに
         拡大していて（2.5倍）、どれだけ細かく描いても表示時点で潰れていた。
         「なぜドット絵が荒いのが直らないのか」の正体はこれ。
         内部解像度を「実際の表示サイズ × devicePixelRatio」に合わせ、
         描画側は今までどおりワールド座標（マス×tile）で描けるように
         setTransform で倍率を1回かける。 */
      /* 内部解像度を CSS サイズから決めるので、CSS 側にワールドの
         縦横比を教えておく（height:auto だけだと、直前の内部解像度の
         比率が残ってしまう）。 */
      if (C.style) C.style.aspectRatio = (W.view.cols * T) + ' / ' + (W.view.rows * T);
      var cssW = C.clientWidth  || (W.view.cols * T);
      var cssH = C.clientHeight || (W.view.rows * T);
      var dpr  = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      C.width  = Math.max(1, Math.round(cssW * dpr));
      C.height = Math.max(1, Math.round(cssH * dpr));
      /* ワールド1マス = 画面上の何実ピクセルか */
      var k = C.width / (W.view.cols * T);
      /* Node のテスト用スタブには setTransform が無いことがある。
         その場合は等倍のままでよい（描画結果ではなく座標を検査する用途）。 */
      if (typeof ctx.setTransform === 'function') ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.imageSmoothingEnabled = true;   // もう拡大していないので滑らかで良い

      /* 2026-09-06: 0.1 → 0.15 に。「掲示板が床とほぼ同じ暗さで、家具に
         見えない」報告への対応で frameBox() に厚みのあるベベル（枠の
         立体感）を足した。ベベルの太さは pad と同じにする（frameBox
         参照）ので、pad が細いとベベルも細くなり効果が薄い。 */
      FRAME_PAD = Math.max(3, Math.round(T * 0.15));
      TITLE_H   = Math.max(8, Math.round(T * 0.38));
      /* ★ 2026-09-06: 「仕事の札が大きい」報告に対応して約0.6倍に。
         札はクリックで詳細が開くので、大きさで情報量を稼ぐ必要はない。 */
      CARD_W    = Math.max(10, Math.round(T * 0.52));
      CARD_H    = Math.max(12, Math.round(T * 0.60));
      CARD_GAP  = Math.max(2, Math.round(T * 0.16));
      TAG_FONT  = Math.max(6, Math.round(T * 0.24));
      TAG_PAD   = Math.max(1, Math.round(T * 0.05));

      actorBeats = null;
      actorDesk = {};
      tintCache = {};
      spriteCache = {};
      cardTimeline = null;
      touchedFirstIndex = null;
      numberOfCache = null;
      AQ.path.reset();
    },

    prepare: function (beats) { prepare(beats || []); },

    /** 実際に再生するコマ列を渡すと、そのぶんだけ経路を組み直す
        （null で解除＝全体の経路に戻す）。main.js が絞り込みのたびに呼ぶ。 */
    setFocusPlan: function (playBeats) { setFocusPlan(playBeats); },

    /** focusActor（task E）: 指定すると、その actor のロボットだけ通常の
        濃さ＋縁取りで、それ以外は薄く（0.25）描く。板・納品口・検品台・
        机など部屋そのものは今までどおり全部描く（＝文脈は消さない）。
        beats/index2 は常にログ全体（main.js が focus 中でも fullBeats/
        その真の位置を渡す）＝ board/dropoff/inspect の集計や他ロボットの
        最終位置は、focus の有無に関わらず本当の状態のまま。render() は
        座標を計算するだけの純粋関数のままなので、焦点を当てても
        「そのコマ番号の絵」は変わらない（scrub 安全性はそのまま）。

        ★ task 1: index2 に負の数（-1）を渡すと「まだどのコマも起きて
        いない」ことになる（main.js が、ユーザーがまだ誰も選んでいない
        画面でこれを渡す）。activeRobots は lastBeatOf(actor,-1) が
        必ず -1 を返す性質上ロボットを1体も選ばず、cardStateAt(-1) も
        空配列を返すので、家具（板・納品口・検品台・机）だけが描かれ、
        ロボットも札も一切描かれない＝「選ぶまで何も動かない」が
        render() の外から新しい引数を増やさずに実現できる。 */
    render: function (beat, p, st, now, beats, index2, focus) {
      if (!ctx || !beat) return;
      beats = beats || [beat];
      index2 = (index2 == null) ? 0 : index2;
      var focusActor = focus;                 // 以下、絞り込みの説明書きをそのまま渡す
      var F = normFocus(focus);
      if (!actorBeats) prepare(beats);
      /* 「運んでいる途中」を描くための状態。板・納品口・検品台の
         レイアウトより先に更新すること（それらが cardsForDisplay を読む）。 */
      var animP = (p == null ? 1 : p);
      /* 札を「手に持っている」あいだ＝本人が歩いているあいだ（速さ一定の歩き）。
         歩き終わったら置く。以前はコマの 70% で一律に置いていた。 */
      var routeNow = routeOfBeat(beat);
      var tripNow = tripAt(beat, animP, routeNow);
      var walkP = tripNow.w;
      anim = { index: index2, p: animP, walk: walkP, actor: (beat.actor || 'agent'),
               focused: (F != null), back: false, trips: 1, hold: null, carry: null };
      /* ★ 2026-10-07: 手を伸ばす動作の区切りで、札がいつ動くかを決める。 */
      var act = actionOf(beat, animP, routeNow, tripNow, index2);
      if (act) { anim.hold = act.hold; anim.carry = act.carry; }

      var robots = activeRobots(beat, beats, index2, p, focus);
      var activePos = null;
      robots.forEach(function (r) { if (r.isActive) activePos = r.pos; });
      if (!activePos) activePos = { x: deskFor(beat.actor)[0], y: deskFor(beat.actor)[1], dir: 'down' };

      var cam = camera(activePos.x, activePos.y);
      var numberOf = numberOfFor(beats);
      var placed = layoutRobots(robots, cam, numberOf, roleOfFor(beats));

      drawFloor(cam);
      drawDesks(cam);

      /* ★ 2026-10-07: 板・納品口から札を取っている最中は、取る札が元あった
         場所（ひとつ前の状態の並び）のまま描き、つかんだあとはそこを空けて
         おく（ほかの札が詰めてきて、取っている札と重ならないように）。 */
      var takeLay = null, takeHide = null;
      var isTake = !!(act && (act.kind === 'claim' || act.kind === 'pickup' || act.kind === 'fetch') && act.q != null);
      var takeFrom = isTake ? act.from : null;     // 'board' | 'dropoff' | 'inspect'
      function layOf(where) {
        return where === 'board' ? computeBoardLayout(index2, focusActor)
             : where === 'dropoff' ? computeDropoffLayout(index2, focusActor)
             : computeInspectLayout(index2, focusActor);
      }
      if (isTake) {
        takeLay = withHold(true, function () { return layOf(takeFrom); });
        if (act.q >= GRAB_AT && slotItem(takeLay, act.key)) takeHide = act.key;
      }
      var boardLay = (takeLay && takeFrom === 'board') ? takeLay : computeBoardLayout(index2, focusActor);
      var dropoffLay = (takeLay && takeFrom === 'dropoff') ? takeLay : computeDropoffLayout(index2, focusActor);
      var inspectLay = (takeLay && takeFrom === 'inspect') ? takeLay : computeInspectLayout(index2, focusActor);
      /* 手を伸ばす動作が手元に描く札（その間は「手に持った札」として描かない）。 */
      var reachSkip = {};
      if (act && act.q != null) {
        if (isTake && takeHide != null && act.q < BACK_END) reachSkip[takeHide] = true;
        if (act.kind === 'post' && act.q < PIN_AT) postedIds(index2).slice(0, 1).forEach(function (k) { reachSkip[k] = true; });
      }
      if (act && act.place != null && act.place < PLACE_AT && act.key) reachSkip[act.key] = true;
      if (act && act.kind === 'work' && act.q != null && act.key) reachSkip[String(act.key)] = true;
      lastReachDrawn = null;

      var roomColors = cfg.roomColors || {};
      /* 検品のコマで、台に着いたあとの時間割（着く前は null）。 */
      var look = phaseLook(phaseNow);
      var booting = look.stage === 'boot', ending = look.stage === 'end';
      var insp = (index2 >= 0 && !booting) ? inspectPhase(beat, p, index2) : null;
      /* 納品のコマで、納品口に着いたあとの時間割（着く前は null）。 */
      var dv = (index2 >= 0 && !booting) ? deliverPhase(beat, p, index2) : null;
      lastPhaseDrawn = null;
      inspectTarget = null;
      var list = [
        { bottom: boardLay.rect.y + boardLay.rect.h, go: function () {
            var nB = boardLay.count;
            if (takeHide != null && takeFrom === 'board') nB = Math.max(0, nB - 1);
            drawLayout(boardLay, 'board', { n: nB }, roomColors.board,
                       { hideId: (takeFrom === 'board') ? takeHide : null, now: now });
          } },
        { bottom: dropoffLay.rect.y + dropoffLay.rect.h, go: function () {
            /* 落ちている最中の品物は、看板の数にもまだ入れない（入った瞬間に増える）。 */
            var nD = dropoffLay.count;
            var inTray = dv && !!slotItem(dropoffLay, dv.key);
            if (dv && !dv.landed && inTray) nD = Math.max(0, nD - 1);
            if (takeHide != null && takeFrom === 'dropoff') nD = Math.max(0, nD - 1);
            var bounce = (dv && dv.landed) ? Math.max(0, 1 - (dv.q - DROP_LAND) / 0.10) : 0;
            drawLayout(dropoffLay, 'dropoff', { n: nD }, roomColors.dropoff,
                       { hatchOpen: hatchOpenAt(dv),
                         hideId: (dv && !dv.landed) ? dv.key : ((takeFrom === 'dropoff') ? takeHide : null),
                         dropId: dv ? dv.key : null, dropBounce: bounce, now: now });
          } },
        { bottom: inspectLay.rect.y + inspectLay.rect.h, go: function () {
            /* 調べている最中の品物は、看板の ✓/✗ の数にもまだ数えない
               （品物に印が付いた瞬間に数が増える＝絵と数が食い違わない）。 */
            var okN = inspectLay.ok, ngN = inspectLay.ng, nI = inspectLay.count;
            if (insp && !insp.done && insp.key != null && slotItem(inspectLay, insp.key)) {
              if (insp.ok) okN = Math.max(0, okN - 1); else ngN = Math.max(0, ngN - 1);
            }
            /* 検品台から（不合格で戻った）自分の品物を取ったら、その1つぶん減らす */
            if (takeHide != null && takeFrom === 'inspect') {
              nI = Math.max(0, nI - 1);
              var tk = slotItem(inspectLay, takeHide);
              if (tk && tk.card.verdict === 'useful') okN = Math.max(0, okN - 1);
              else if (tk && tk.card.verdict === 'not') ngN = Math.max(0, ngN - 1);
            }
            drawLayout(inspectLay, 'inspect',
                       { n: nI, ok: okN, ng: ngN },
                       roomColors.inspect,
                       { pendingId: (insp && !insp.done) ? insp.key : null,
                         resultId: (insp && insp.done) ? insp.key : null,
                         hideId: (takeFrom === 'inspect') ? takeHide : null, now: now });
          } }
      ];

      /* ★ 2026-09-08: 手に持っている札も絞り込みに従わせる。板・納品口・
         検品台だけ絞って手持ちを素通ししていたので、依頼1件を選んでいる
         のに、その子が同時に抱えている別の依頼の札まで持って歩いていた
         （＝「1件だけ追っている」という約束と画面が食い違う）。 */
      lastRobotsDrawn = 0;
      lastLabelsDrawn = [];
      lastMarksDrawn = [];
      lastSignsDrawn = [];
      lastBadgesDrawn = [];
      lastTagsDrawn = [];
      lastKindIconsDrawn = [];
      lastFxDrawn = [];
      lastBeamDrawn = null; lastBurstDrawn = null; lastActiveDrawn = null;
      lastHatchDrawn = null; lastDustDrawn = []; lastDropDrawn = null;
      lastCrackedDrawn = 0;
      lastMoodDrawn = null;
      lastHeldDrawn = [];
      lastMemoDrawn = 0; lastPinnedDrawn = 0;
      var cards = cardsForDisplay(index2).filter(function (c) {
        return focusHasCard(F, c.id, index2);
      });
      var activeHx = 0, activeHy = 0, activeSprite = null;
      placed.forEach(function (pl) {
        var r = pl.r;
        if (r.isActive) { activeHx = pl.hx; activeHy = pl.hy; activeSprite = pl.spriteRect; }
        list.push({
          bottom: (r.pos.y + 1) * T,
          go: function () {
            var pal = paletteFor(pl.actor);
            var sm = spriteFor(pl.actor);
            /* activeRobots() が既に focusActor 以外を候補から外しているので、
               ここに来る時点で「他のロボット」は存在しない。焦点の輪は
               「これが選ばれた1体だ」という印として残す。 */
            if (F !== null) {
              var sr = pl.spriteRect;
              ctx.save();
              ctx.strokeStyle = '#ffd35c';
              ctx.lineWidth = Math.max(1, U(1));
              ctx.strokeRect(sr.x - U(1), sr.y - U(1), sr.w + U(2), sr.h + U(2));
              ctx.restore();
            }
            ctx.globalAlpha = r.isActive ? 1 : 0.7;
            lastRobotsDrawn++;   // 検査用：この1フレームで実際に描いた体数
            /* 検品中は台（品物）のほうを向く＝目から品物へ光が届く。 */
            var phased = r.isActive && (booting || ending);
            var dirNow = (r.isActive && (insp || dv || phased)) ? 'down' : r.pos.dir;
            /* 依頼の札を板に貼っている間は板（上）を向く。 */
            if (r.isActive && !phased && act && act.kind === 'post' && act.q != null && act.q < PIN_BACK + 0.1) dirNow = 'up';
            var reaching = r.isActive && !phased && act && act.q != null &&
                           (r.stop != null || (act.kind === 'post' && act.q < PIN_BACK + 0.1));
            if (r.isActive) { lastActiveDrawn = { dir: dirNow, rect: pl.spriteRect }; }
            var hopPx = phased ? Math.round(U(6) * look.hop) : 0;
            /* ★ 2026-10-03 表情：検品で ✓ を付けたら うれしい／✗ なら しょんぼり、
               検品中は きりっ、納品口に品物が落ちたら うれしい。 */
            var mood = null;
            if (r.isActive && !phased) {
              if (insp) mood = insp.done ? (insp.ok ? 'happy' : 'sad') : 'determined';
              else if (dv && dv.landed) mood = 'happy';
              /* 板から仕事の札を取れたら うれしい、納品口の品物を拾うときは きりっ。 */
              else if (r.stop && r.stop.kind === 'claim' && r.stop.q >= GRAB_AT) mood = 'happy';
              else if (r.stop && (r.stop.kind === 'pickup' || r.stop.kind === 'fetch')) mood = 'determined';
              lastMoodDrawn = mood;
            }
            drawRobot(pl.hx, pl.hy - hopPx, dirNow, phased ? false : r.moving, now, pal, sm,
                      phased ? look.bright : 1, mood);
            if (phased) {
              var srp = pl.spriteRect ? { x: pl.spriteRect.x, y: pl.spriteRect.y - hopPx, w: pl.spriteRect.w, h: pl.spriteRect.h } : null;
              drawPhaseFx(look, srp, now);
              lastPhaseDrawn = { stage: look.stage, bright: look.bright, hop: hopPx,
                                 fx: look.fx.map(function (f) { return f.k; }), moving: false,
                                 boot: phaseNow.boot, end: phaseNow.end };
            }
            /* ★ 2026-09-28: 名札（#6 トキ）はマウスを乗せたロボットにだけ出す。
               常に出していると、ジオラマの上に文字の札が並んで世界観を壊す。
               誰が誰かは、右の一覧の顔（同じ姿・同じ色）でも分かる。 */
            /* ★ 2026-10-09: いま動いている本人の名札は、はじめから出す（利用者「文字が
               あるほうが分かりやすい」。街の絵と同じ）。ほかの子はマウスを乗せたときだけ。 */
            var hovered = hoverPt && (inRect(pl.spriteRect, hoverPt) || inRect(pl.tagRect, hoverPt));
            if ((r.isActive && !phased) || hovered) {
              drawTag(pl.tagText, { rect: pl.tagRect, leader: pl.tagLeader, anchor: pl.tagAnchor });
              lastTagsDrawn.push(pl.tagText);
            }
            /* 頭上の状態表示（名札のさらに上）。判定のコマで到着したあとは
               ✓ / ✗ の吹き出しが出るので、重ねないようにそこでは引っ込める。 */
            if (r.isActive) {
              var sk = stepKindOf(beat);
              /* 着いたあとは、動作そのもの（腕・光）が何をしているかを見せるので
                 頭上の絵は引っ込める。 */
              if (sk && !booting && !ending && !reaching && !((isVerdictBeat(beat) || sk === 'dropoff') && !r.moving)) {
                /* 名札は本体の上に付くことも下に付くこともある（重なりを
                   避けて置き場所が変わる）。名札が下にあるときに「名札の上」
                   に置くと本体に重なるので、本体と名札のうち上にあるほうの
                   さらに上に置く。 */
                var tr = pl.tagRect, sr2 = pl.spriteRect;
                var topY = sr2 ? sr2.y : (pl.hy - U(4));
                if (tr && tr.y < topY) topY = tr.y;
                var bcx = sr2 ? (sr2.x + sr2.w / 2) : pl.hx;
                var bby = topY;
                var bm = (beat.lead && beat.lead.meta) || {};
                /* ★ 2026-09-28: 頭上にも呼び名（ID）は出さない。絵とゲージだけ。 */
                var bNick = null;
                drawStatusBadge(bcx, bby, sk, r.moving ? (lastWalkInfo ? lastWalkInfo.raw : p) : 1, bNick, isWriteBeat(beat));
              }
            }
            /* 書き込みのコマ：行き（板へ向かう脚）だけメモを持つ。
               帰りは貼ってきたので手ぶら。 */
            if (r.isActive && isWriteBeat(beat) && act && act.kind === 'memo') {
              /* この経路は 机→板→机 の往復1本。板へ向かう間はメモを持ち、
                 板の前で立ち止まって手を伸ばして貼る（drawPinTo）。貼った
                 あとは手ぶらで戻り、板にメモが1枚増えて見える。 */
              if (act.before) { drawWrittenLines(writeSpot(boardLay && boardLay.rect), 0, now, false); drawPen(pl.hx, pl.hy); lastMemoDrawn++; }   // 行き：板には白紙、ペンを持って板へ
              else if (act.past || act.q >= WRITE_DONE) { drawWrittenLines(writeSpot(boardLay && boardLay.rect), 1, now, true); lastPinnedDrawn++; }   // 書きおえた字が板に残る
            }
            var held = cards.filter(function (c) {
              return c.state === 'hand' && c.holder === pl.actor && !(r.isActive && reachSkip[String(c.key)]);
            });
            held.forEach(function (c, hi) {
              drawHeldCard(c, pl.hx, pl.hy, hi);
              /* テスト用: 実際に「手に持った札」として描いたものを控える
                 （枚数を数えるだけでは、持ち主が画面に居なくて1枚も
                 描かれていない、という失敗を見逃す）。 */
              lastHeldDrawn.push({ id: c.id, key: c.key, holder: String(pl.actor) });
            });
            ctx.globalAlpha = 1;
          }
        });
      });

      list.sort(function (a, b2) { return a.bottom - b2.bottom; });
      list.forEach(function (it) { it.go(); });

      if (placed.overflow > 0) {
        drawOverflowBadge(placed.overflow, boardLay.rect, dropoffLay.rect, inspectLay.rect);
      }

      /* index2 < 0（task 1: まだ何も選んでいない）のときは、描いている
         ロボットが1体も無い＝ここで演出を出すと (0,0) に浮いた演出だけが
         残ってしまう。ロボットが実在するときだけ演出を出す。 */
      var activeMoving = robots.some(function (r) { return r.isActive && r.moving; });
      /* ★ 2026-09-28: 本人が家具で「いま何をしているか」を見せる演出。
         どれも家具に着いてから出す（歩いている間は頭上の絵が行き先を示す）。 */
      if (index2 >= 0 && activeSprite) {
        var skNow = stepKindOf(beat);
        /* 検品：台に着いてから。調べている間は目→品物の光と虫めがね、
           結果が出たら品物から ✓/✗ が弾ける。 */
        if (insp && skNow === 'inspect') {
          var tgt = inspectTarget || {
            x: inspectLay.rect.x + inspectLay.rect.w / 2 - CARD_W / 2,
            y: inspectLay.rect.y + inspectLay.rect.h / 2 - CARD_H / 2, w: CARD_W, h: CARD_H };
          var activeActor = null;
          placed.forEach(function (pl) { if (pl.r.isActive) activeActor = pl.actor; });
          if (!insp.done) {
            var eye = AQ.sprites.eyePoint && AQ.sprites.eyePoint(spriteFor(activeActor),
                        activeSprite.x, activeSprite.y, activeSprite.w, activeSprite.h);
            drawEyeBeam(eye || { x: activeSprite.x + activeSprite.w / 2, y: activeSprite.y + activeSprite.h * 0.3 }, tgt, now);
            drawLensProp(activeSprite, tgt, now);
          } else {
            drawVerdictBurst(tgt, insp.ok, insp.t);
          }
        }
        /* 納品：着いてから。腕で投入口の上へ運び、放すと落ちて口に消える。 */
        if (dv && skNow === 'dropoff') {
          var dcard = null;
          var dit = slotItem(dropoffLay, dv.key);
          if (dit) dcard = dit.card;
          if (!dcard) cardStateAt(index2).forEach(function (c) { if (String(c.key) === dv.key) dcard = c; });
          var dActor = null;
          placed.forEach(function (pl) { if (pl.r.isActive) dActor = pl.actor; });
          drawDelivery(dv, dcard, hatchRect(dropoffLay), activeSprite, activeHx, activeHy, now, spriteFor(dActor));
          if (lastDropDrawn) lastDropDrawn.key = dv.key;
        }
        /* ★ 2026-10-07: 手を伸ばして取る・貼る・置く。 */
        if (act && !booting && !ending && act.q != null) {
          var aName = null;
          placed.forEach(function (pl) { if (pl.r.isActive) aName = pl.actor; });
          var aFig = spriteFor(aName);
          if (act.kind === 'work') {
            var wcard = null;
            cardsForDisplay(index2).forEach(function (c) { if (String(c.key) === String(act.key)) wcard = c; });
            drawWork(act.q, wcard, activeSprite, aFig, activeHx, activeHy, now, workElapsedLabel(beat, beats));
            /* 机で書き込んでいるあいだ、札は本人の前（机の上）に描かれている＝検査用の控えにも「本人の札」として入れる */
            if (wcard && aName != null) lastHeldDrawn.push({ id: wcard.id, key: wcard.key, holder: String(aName), desk: true });
          } else if (isTake && takeLay) {
            var ti = slotItem(takeLay, act.key);
            if (ti) drawTake(act.kind, act.q, ti.rect, ti.card, activeSprite, aFig, activeHx, activeHy, takeFrom);
          } else if (act.kind === 'memo') {
            drawWriteOn(act.q, writeSpot(boardLay.rect), activeSprite, aFig, activeHx, activeHy, now);
          } else if (act.kind === 'post' && act.q < PIN_BACK) {
            var pid = postedIds(index2)[0];
            if (pid != null) {
              var finalLay = withHold(false, function () { return computeBoardLayout(index2, focusActor); });
              var pi = slotItem(finalLay, pid);
              if (pi) drawPinTo('post', act.q, pi.rect, pi.card, activeSprite, aFig, activeHx, activeHy, now);
            }
          }
          /* 腕の先に持っている札も「手に持った札」（検査用の控え）。 */
          if (lastReachDrawn && lastReachDrawn.card && lastReachDrawn.kind !== 'memo') {
            var rkey = (act.kind === 'post') ? postedIds(index2)[0] : act.key;
            var rid = (act.kind === 'post') ? jobOfKey(rkey) : act.job;
            lastReachDrawn.key = rkey;
            if (rid != null) lastHeldDrawn.push({ id: rid, key: rkey, holder: String(aName), reach: true });
          }
        }
        if (act && act.place != null && !booting && !ending) {
          var pFig = null, pName = null;
          placed.forEach(function (pl) { if (pl.r.isActive) { pFig = spriteFor(pl.actor); pName = pl.actor; } });
          var finIn = withHold(false, function () { return computeInspectLayout(index2, focusActor); });
          var pit = slotItem(finIn, act.key);
          if (pit) {
            drawPlace(act.place, pit.rect, pit.card, activeSprite, pFig, activeHx, activeHy);
            if (lastReachDrawn && lastReachDrawn.card) {
              lastReachDrawn.key = act.key;
              lastHeldDrawn.push({ id: act.job, key: act.key, holder: String(pName), reach: true });
            }
          }
        }
      }
      var ov = OVERLAY[beat.kind];
      var ovQuiet = !!(act && ((act.q != null && act.kind !== 'place') || act.place != null));
      if (ov && !activeMoving && index2 >= 0 && !ovQuiet) ov(activeHx, activeHy, beat, p, now);
    },

    computeRobotScreenPositions: function (beat, p, beats, index2, focusActor) {
      if (!beat) return [];
      beats = beats || [beat];
      index2 = (index2 == null) ? 0 : index2;
      if (!actorBeats) prepare(beats);
      var robots = activeRobots(beat, beats, index2, p, focusActor);
      var activePos = null;
      robots.forEach(function (r) { if (r.isActive) activePos = r.pos; });
      if (!activePos) activePos = { x: deskFor(beat.actor)[0], y: deskFor(beat.actor)[1] };
      var cam = camera(activePos.x, activePos.y);
      var numberOf = numberOfFor(beats);
      var placed = layoutRobots(robots, cam, numberOf, roleOfFor(beats));
      var out = placed.map(function (pl) {
        return {
          actor: pl.actor, hx: pl.hx, hy: pl.hy, tileKey: pl.tileKey,
          isActive: pl.r.isActive, spriteRect: pl.spriteRect,
          tagRect: pl.tagRect, tagText: pl.tagText,
          tagLeader: pl.tagLeader, tagAnchor: pl.tagAnchor
        };
      });
      out.overflow = placed.overflow;
      return out;
    },

    /** テスト用: index コマ時点の札の状態をそのまま返す（描画しない）。
        prepare() で全コマぶん先に計算した配列を読むだけなので、
        どんな順で呼んでも（前から／後ろから seek しても）同じ index には
        同じ結果を返すはず、というのが scrub 安全性のテストの前提。 */
    computeCardState: function (index) { return cardStateAt(index); },

    /** テスト用: 掲示板・納品口・検品台それぞれの「枠の矩形・タイトル帯・
        表示する札の矩形・overflow件数」を、描画せずに計算する。
        render() 内の drawLayout もこの同じ関数の戻り値を描いているだけ
        なので、ここで検査した数字と画面の絵が食い違うことはない。 */
    /** 札の当たり判定。canvas 内のワールド座標 (x,y) を受け取り、
        そこにある札の jobId を返す（無ければ null）。
        描画に使っているのと同じ computeBoardLayout / computeDropoffLayout /
        computeInspectLayout の矩形をそのまま使うので、絵と判定がずれる
        ことはない。 */
    hitTestCard: function (x, y, index, focus) {
      function hit(lay) {
        var found = null;
        (lay.shown || []).forEach(function (sl) {
          if (!sl.card || sl.overflow || !sl.rect) return;
          var r = sl.rect;
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) found = String(sl.card.id);
        });
        return found;
      }
      return hit(computeBoardLayout(index, focus)) ||
             hit(computeDropoffLayout(index, focus)) ||
             hit(computeInspectLayout(index, focus));
    },

    /** テスト用: 直前のフレームで実際に手に持った札として描いたもの。 */
    lastHeldCards: function () { return lastHeldDrawn.slice(); },
    lastRobotsDrawn: function () { return lastRobotsDrawn; },
    lastLabels: function () { return lastLabelsDrawn.slice(); },
    lastMarks: function () { return lastMarksDrawn.slice(); },
    lastSigns: function () { return lastSignsDrawn.slice(); },
    lastBadges: function () { return lastBadgesDrawn.slice(); },
    lastTags: function () { return lastTagsDrawn.slice(); },
    lastFx: function () { return lastFxDrawn.slice(); },
    lastMood: function () { return lastMoodDrawn; },
    lastBeam: function () { return lastBeamDrawn; },
    lastBurst: function () { return lastBurstDrawn; },
    lastInspectTarget: function () { return inspectTarget; },
    lastActive: function () { return lastActiveDrawn; },
    setPhase: function (ph) { phaseNow = ph || { boot: null, end: 0 }; },
    lastPhase: function () { return lastPhaseDrawn; },
    lastLensSide: function () { return lastLensSide; },
    lastHatch: function () { return lastHatchDrawn; },
    lastDust: function () { return lastDustDrawn.slice(); },
    lastDrop: function () { return lastDropDrawn; },
    lastTray: function () { return lastTrayDrawn.slice(); },
    DROP: { REACH: DROP_REACH, RELEASE: DROP_RELEASE, LAND: DROP_LAND },
    VERDICT_AT: VERDICT_AT,
    lastCracked: function () { return lastCrackedDrawn; },
    walkMsFor: walkMsFor,
    MS_PER_TILE: MS_PER_TILE,
    lastKindIcons: function () { return lastKindIconsDrawn.slice(); },
    setHover: function (pt) { hoverPt = pt || null; },
    /* 一覧の顔（hud.js の spriteThumb）を、ロボット本体と同じ色で描くため。 */
    paletteFor: function (actor) { try { return paletteFor(actor); } catch (e) { return null; } },
    /* 「書き込み」の絵を実際に描いたか（テスト用）。棒立ちに戻ったら 0 になる。 */
    lastWriteDraw: function () { return { memo: lastMemoDrawn, pinned: lastPinnedDrawn }; },
    /* 往復（2026-09-13）の検査用。件数→往復回数、歩き具合→片道の進み具合。 */
    tripsForCount: tripsForCount,
    legOf: legOf,
    lastAnim: function () { return anim ? { index: anim.index, p: anim.p, back: anim.back, trips: anim.trips } : null; },
    /** 検査用：直前のフレームで描いた「手を伸ばす」動作（無ければ null）。 */
    lastReach: function () { return lastReachDrawn ? JSON.parse(JSON.stringify(lastReachDrawn)) : null; },
    lastWalk: function () { return lastWalkInfo ? {
      w: lastWalkInfo.w, raw: lastWalkInfo.raw, back: lastWalkInfo.back,
      x: lastWalkInfo.x, y: lastWalkInfo.y, roundTrip: lastWalkInfo.roundTrip,
      stopQ: lastWalkInfo.stopQ, stopKind: lastWalkInfo.stopKind, past: lastWalkInfo.past } : null; },

    computeBoardLayout: computeBoardLayout,
    computeDropoffLayout: computeDropoffLayout,
    computeInspectLayout: computeInspectLayout,

    /** テスト用: 部屋の壁の内側（＝これより外に何かが描かれていたら
        バグ）のピクセル矩形。 */
    computeRoomBounds: roomBounds,

    /** テスト用: 床の帯（板の下端〜納品口・検品台の上端、左右の壁の
        内側）のピクセル矩形。tools/check-world.js が、ロボットの
        footprint（下記 spriteFootprint）より低くなっていないかを
        assert するのに使う（task 2: 目視ではなく機械的に検査する）。 */
    computeFloorBand: floorBand,

    /** テスト用: いまの tile サイズでロボット1体が占める footprint
        （ワールド px）。init() 済みでないと SPRITE_SCALE が未確定な
        ので {w:0,h:0} を返す。 */
    spriteFootprint: function () {
      return { w: SPRITE_W * SPRITE_SCALE, h: SPRITE_H * SPRITE_SCALE };
    },

    /** テスト用: 1枚のカードについて「kind ラベルの矩形」と「判定バッジの
        矩形」を、描画せずに計算する（drawCard が描く内容と完全に同じ
        計算式）。verdict の有無にかかわらず呼べる（badgeRect は
        verdict が無ければ null）。 */
    computeCardVisual: cardVisual,

    /** テスト用: 「他 N 体」バッジの矩形を、描画せずに計算する（drawOverflowBadge
        と完全に同じ計算式）。板・納品口・検品台の矩形と重ならないことを
        検査するのに使う。 */
    computeOverflowBadgeRect: computeOverflowBadgeRect
  };

})(window.AQ = window.AQ || {});
