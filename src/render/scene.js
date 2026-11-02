/* =============================================================
   render/scene.js — 画面の絵
   -------------------------------------------------------------
   地面は tiles.js、建物や設備は props.js、街の配置は data/world.js。
   ここがやるのは カメラ・ロボット・重なり順・コマごとの演出 だけです。

   コマの種類を足したいとき:
     1) PLACE_OF に「どこで起きるか」を1行
     2) OVERLAY に「何が出るか」を1つ
   ============================================================= */
(function (AQ) {
  'use strict';

  var C, ctx, cfg, S, W, T;

  /* コマの何割で歩き終えるか（残りは立ち止まって用事をする時間） */
  var WALK_UNTIL = 0.7;

  /* ---------- 複数エージェントの色分け ----------
     エージェント名をハッシュして、この中から1組を選びます。
     車体の「明」「中」の2色ペア。★ 色を変えたいときはここを編集してください。 */
  var ACTOR_TINTS = [
    ['#ffd35c', '#d9a02c'],  // 黄
    ['#7fe6c4', '#3fae8a'],  // 緑
    ['#8fd0ff', '#4f96e0'],  // 青
    ['#ffa3c8', '#e0679e'],  // 桃
    ['#c6b3ff', '#8f74e0'],  // 紫
    ['#ffb27a', '#dd7d3f']   // 橙
  ];

  /* ★ 2026-09-14: 名札は「#N 呼び名」。部屋の絵はそうなっているのに、
     街の絵だけ did:key の末尾や 'agent' という生の文字列を出していた。
     利用者の「どこにいるか分からない」は、居場所だけでなく
     「そこに居るのが誰なのか読めない」という話でもある。 */
  var numberOfCache = null;
  function numberOfFor(beats) {
    if (!numberOfCache || numberOfCache.beats !== beats) {
      numberOfCache = { beats: beats,
                        numberOf: (AQ.roster ? AQ.roster.build(beats).numberOf : {}) };
    }
    return numberOfCache.numberOf;
  }
  var lastNumberOf = {};

  /* 名前 → 決定的なハッシュ値。色・拠点・待機場所、どれもこれ1つから選ぶ。
     同じ名前なら常に同じ結果になる（再生のたびに配置が変わらないため）。 */
  function hashStr(s) {
    var name = String(s || 'agent');
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h;
  }

  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w, h); }

  /* 2026-09-06: ドット絵グリッドを廃止し、sprites.js のベクター図形
     （AQ.sprites.drawFigure）で描くようにした。ROBOT_W/H はロボットの
     footprint（ワールド単位＝tile と同じスケールの数値）。「ロボットが
     読み取れないほど小さい」という報告への対応で、以前の footprint
     （16×20）のおよそ2.2倍にしてある。解像度は render/*.js の
     device-resolution 対応（canvas backing store を実表示サイズ×dprに
     合わせる）で別に解決したので、ここでの拡大はもう「荒く見える」
     原因にはならない。 */
  var ROBOT_W = 35, ROBOT_H = 44;

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
    var pair = ACTOR_TINTS[hashStr(name) % ACTOR_TINTS.length];
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

  /* actor名 → その人専用のドット絵（task D。sprites.js 参照）。
     AQ.sprites.build が無い（古いビルド）場合は共通の S にフォールバック。 */
  var spriteCache = {};
  function spriteFor(actor) {
    var name = actor || 'agent';
    if (spriteCache[name]) return spriteCache[name];
    var sm = AQ.sprites.figureFor(name);
    spriteCache[name] = sm;
    return sm;
  }

  /* 名札に出す文字。長い DID などは末尾6文字だけ見せる */
  function actorLabel(name) {
    var key = String(name || 'agent');
    var n = lastNumberOf[key];
    var nick = (AQ.nick && AQ.nick.forActor) ? AQ.nick.forActor(key) : '';
    if (n && nick) return '#' + n + ' ' + nick;
    if (n) return '#' + n;
    if (nick) return nick;
    if (key.length <= 10) return key;
    if (key.indexOf(':') !== -1) return '…' + key.slice(-6);
    return key.slice(0, 10);
  }

  /* ロボットの頭上に名前を出す（縁取り: 暗い色を4方向へ1pxずらして描き、上に明るい色） */
  function nameTag(text, cx, y) {
    ctx.font = '6px "Press Start 2P", monospace';
    ctx.textBaseline = 'top';
    var w = ctx.measureText(text).width;
    var x = Math.round(cx - w / 2);
    ctx.fillStyle = '#14161f';
    ctx.fillText(text, x - 1, y);
    ctx.fillText(text, x + 1, y);
    ctx.fillText(text, x, y - 1);
    ctx.fillText(text, x, y + 1);
    ctx.fillStyle = '#f2f5fa';
    ctx.fillText(text, x, y);
  }

  var lastDrawn = [];   // 直近の render() が実際に描いたロボット（検査用）

  var lastLabelsDrawn = [];   // 検査用：このフレームで描いた文字
  var lastFxDrawn = [];       // 検査用：このフレームの演出の種類
  function label(s, x, y, color, size) {
    lastLabelsDrawn.push(String(s));
    ctx.fillStyle = color;
    ctx.font = (size || 6) + 'px "Press Start 2P", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(s, x, y);
  }

  /** いま動いている本人の足もとに敷く光の輪。街は広くロボットは小さいので、
      これが無いと「どこを見ればいいのか」が分からない（利用者の報告）。
      頭の上は吹き出し（金額・OK・402）と看板が使うので、そこに印を
      重ねると両方読めなくなる——だから足もとに置く。 */
  function hereMarker(cx, cy, now) {
    var pulse = 0.55 + 0.25 * Math.sin(now / 260);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ffd35c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.round(ROBOT_W * 0.55), Math.round(ROBOT_W * 0.22), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = pulse * 0.28;
    ctx.fillStyle = '#ffd35c';
    ctx.fill();
    ctx.restore();
  }

  /* ---------- 街の索引 ---------- */
  var byId = null;
  function index() {
    if (byId) return byId;
    byId = {};
    W.objects.forEach(function (o) { if (o.id) byId[o.id] = o; });
    return byId;
  }

  /** target 文字列をハッシュして service 型の建物から1つ選ぶ（既定ルール用）。
      同じ target なら常に同じ建物になる。 */
  function hashService(target) {
    var services = W.objects.filter(function (o) { return o.type === 'service'; });
    if (!services.length) return index()['svc-news'];
    return services[hashStr(target) % services.length];
  }

  /** URL から、どの建物のことかを決める（world.routing） */
  function serviceFor(target) {
    var t = String(target || '');
    var r = W.routing.find(function (rule) { return rule.match !== '' && t.indexOf(rule.match) !== -1; });
    if (r) return index()[r.id];
    /* ★ 2026-09-14: 看板の文字が URL に入っている建物があれば、そこ。
       これが無いと api.example.dev を呼んでいるのに technocore.chat の
       前に立つ——実況の文字と立ち位置が食い違い、「誰に頼んだのか」が
       絵から読めなくなっていた（利用者の指摘）。 */
    var byLabel = W.objects.filter(function (o) {
      return o.type === 'service' && o.label && t.indexOf(o.label) !== -1;
    });
    if (byLabel.length) return byLabel[0];
    /* どれとも結び付かないときだけ、相手先ごとに別の建物へ機械的に振る
       （毎回同じ建物に集まらないように）。
       ★ 2026-10-11: そのとき看板はその相手先の名前に掛け替える（liveLabel）。
       以前は架空の看板（gpu-bridge.example など）のまま立っていて、本物の
       CoinGecko に払ったのに「gpu-bridge.example」で払ったように見えた（作り話になる）。
       相手先ごとに別の建物を選び、別の相手先の看板は上書きしない。 */
    var h = hostOf(t);
    if (liveByHost[h]) return liveByHost[h];
    var services = W.objects.filter(function (o) { return o.type === 'service'; });
    var first = hashService(t), start = Math.max(0, services.indexOf(first));
    for (var k = 0; k < services.length; k++) {
      var o = services[(start + k) % services.length];
      if (!o.liveLabel || o.liveLabel === h) { o.liveLabel = h; liveByHost[h] = o; return o; }
    }
    return first;
  }
  var liveByHost = {};
  function hostOf(u) { try { return String(u).replace(/^[a-z]+:\/\//i, '').split(/[\/?#]/)[0] || String(u); } catch (e) { return String(u); } }
  function resetLiveLabels() {
    liveByHost = {};
    W.objects.forEach(function (o) { if (o.type === 'service') delete o.liveLabel; });
  }

  /* ---------- 複数エージェントの拠点・待機場所 ----------
     「複数のエージェントが動いているなら、複数の視覚化したロボットが
     画面に必要」が絶対の要件。全員が同じ home / charger に重なって
     消えてしまわないよう、名前のハッシュから候補地の1つを機械的に選びます。
     同じ名前は常に同じマス（再生のたびに配置が変わらない）。
     候補地が足りなくなったら（アクターの数がプールより多い）、
     ハッシュ位置にそのまま重ねます — その場合は render() 側の
     ピクセルずらし（NUDGE_RING）で見分けが付くようにしてあります。 */

  /** name をハッシュして pool から1マス選ぶ。assigned で衝突を避ける
      （同じバッチ内で別のアクターに既に割り当てたマスは避ける）。 */
  function pickFromPool(name, pool, assigned) {
    if (!pool || !pool.length) return null;
    var h = hashStr(name), n = pool.length;
    for (var k = 0; k < n; k++) {
      var idx = (h + k) % n;
      var key = pool[idx].join(',');
      if (!assigned[key]) { assigned[key] = name; return pool[idx]; }
    }
    return pool[h % n];   // 全マス使用中（アクター過多）。重なりは render() 側で吸収
  }

  var actorHome = {};   // actor → [x,y]（この実行の間ずっと同じ）
  var actorIdle = {};   // actor → [x,y]

  function homeFor(actor) {
    var name = actor || 'agent';
    return actorHome[name] || (W.places.homes && W.places.homes[0]) || W.places.home;
  }
  function idleFor(actor) {
    var name = actor || 'agent';
    return actorIdle[name] || (W.places.idles && W.places.idles[0]) || W.places.charger;
  }

  /** agent.plan / planbatch の行き先。ターゲット（＝依頼の種類の建物）が
      分かればそこへ、分からなければ（デモの「独り言」のような、target の
      無い plan）自分の拠点で考える。 */
  function planTarget(b) {
    var target = b.lead && b.lead.target;
    return target ? serviceFor(target).at : homeFor(b.actor);
  }

  /* ---------- どのコマがどこで起きるか ---------- */
  var PLACE_OF = {
    start:     function (b) { return homeFor(b.actor); },
    travel:    function (b) { return serviceFor(b.lead && b.lead.target).at; },
    require:   function (b) { return serviceFor(b.lead && b.lead.target).at; },
    pay:       function (b) { return serviceFor(b.lead && b.lead.target).at; },
    /* ★ 2026-09-14: 確定は「立会所」で。x402 のいちばんの要点は
       「払う人はガス代を払わない・立会人が代わりにチェーンへ載せる」
       ことなので、その相手が街に居ないと絵で伝わらない。 */
    /* ★ 2026-10-06: 実際の x402 では、許可証を立会人へ回すのはお店（エージェントは立会所へ
       行かない）。確定のあいだ、ロボットは店の前で待つ。店が分からないときだけ立会所。 */
    settle:    function (b) {
      var t = (b.lead && b.lead.target) || b._shopTarget;
      return t ? serviceFor(t).at : (W.places.facilitator || W.places.board);
    },
    batch:     function (b) { return serviceFor(b.lead && b.lead.target).at; },
    /* actbatch（payment.* を含まない Tier2 の束）は、この街のデモ・
       アダプタでは基本的に発生しない（kibble は部屋にしか来ない：
       stage.js 参照）。理論上どこかの target で起きても絵が壊れない
       ように、travel/batch と同じ「相手先の建物」に倒しておく。 */
    actbatch:  function (b) { return serviceFor(b.lead && b.lead.target).at; },
    planbatch: planTarget,
    plan:      planTarget,
    receive:   function (b) { return serviceFor(b.lead && b.lead.target).at; },
    /* 402 で断られたコマも、店の前に立ったまま（家には帰らない）。 */
    error:     function (b) { return serviceFor(b.lead && b.lead.target).at; },
    idle:      function (b) { return idleFor(b.actor); },
    end:       function (b) { return homeFor(b.actor); }
  };

  function placeOf(b) {
    var fn = PLACE_OF[b.kind];
    return fn ? fn(b) : W.places.home;
  }

  /** actor名 → そのエージェントが登場するコマ番号の並び（時系列順） */
  var actorBeats = null;

  /** すべてのコマの道すじを先に決める（途中に飛んでも位置がズレない）。
      エージェントごとに別々の道すじを持たせるので、まず actor ごとに
      コマ番号をまとめてから、それぞれ独立に「自分の拠点」から鎖状につなぎます。 */
  function prepare(beats) {
    resetLiveLabels();
    actorBeats = {};
    actorHome = {};
    actorIdle = {};
    beats.forEach(function (b, i) {
      var actor = b.actor || 'agent';
      (actorBeats[actor] || (actorBeats[actor] = [])).push(i);
    });

    /* 拠点・待機場所を先に全員ぶん決める（名前順＝入力の並びに依存しない）。
       ここを route 計算より先に済ませておかないと placeOf('start'/'idle'/'end') が
       まだ何も割り当てられていない拠点を読むことになる。 */
    var homeAssigned = {}, idleAssigned = {};
    Object.keys(actorBeats).sort().forEach(function (actor) {
      actorHome[actor] = pickFromPool(actor, W.places.homes, homeAssigned) || W.places.home;
      actorIdle[actor] = pickFromPool(actor, W.places.idles, idleAssigned) || W.places.charger;
    });

    Object.keys(actorBeats).forEach(function (actor) {
      var at = homeFor(actor);
      var lastPayTarget = null;
      actorBeats[actor].forEach(function (i) {
        var b = beats[i];
        /* 確定のコマ：直前に許可証を渡した店（同じエージェントの pay の相手） */
        if (b.kind === 'pay' && b.lead && b.lead.target) lastPayTarget = b.lead.target;
        if (b.kind === 'settle') b._shopTarget = lastPayTarget;
        /* ★ 2026-09-14: 402 で断られたコマは街の絵のまま描くように
           したので、経路が要る（null のままだと拠点にワープして、
           「頼んだ相手の前に立っている」という肝心の絵が壊れる）。
           応答が無かった本物のエラーは今までどおり別画面なので、
           経路を持たせない。 */
        if (b.kind === 'error' && String((b.lead && b.lead.status) || '') !== '402') {
          b._route = null; return;
        }
        var goal = placeOf(b);
        var route = AQ.path.find(at, goal);
        // 建物を置いて歩道を塞いでしまったときに気づけるように
        if (route.length === 1 && (at[0] !== goal[0] || at[1] !== goal[1])) {
          console.warn('[scene] 経路なし:', at, '→', goal,
                       '— data/world.js の objects が歩道を塞いでいないか確認してください');
        }
        b._route = route;
        at = route[route.length - 1];
      });
    });
  }

  /** actor が登場している最後のコマ番号（upto 以下）。まだ登場していなければ -1 */
  function lastBeatOf(actor, upto) {
    var idxs = actorBeats && actorBeats[actor];
    if (!idxs) return -1;
    var j = -1;
    for (var k = 0; k < idxs.length; k++) {
      if (idxs[k] > upto) break;
      j = idxs[k];
    }
    return j;
  }

  /* ---------- カメラ ---------- */
  /* ★ 2026-10-02: 街ぜんたい（34×16マス）を1画面に入れていたので、建物が5つ並び
     どれも小さかった（利用者の報告「一つの画面に建物は2つか3つにしてください。
     配置できなかった分はキャラが移動することで画面が切り替わるように」）。
     画面に映すのは 17×8 マス（data/world.js の view）＝建物2〜3軒ぶん。
     カメラは主役のロボットを追う。ただし毎フレーム真ん中に合わせ続けると
     街がずっと揺れて見えるので、ロボットが画面の端（両側30%）に近づいたときだけ
     動かし、そのとき滑らかに次の場所へ滑らせる（＝歩いていくと画面が切り替わる）。
     止めて・コマを選び直したとき（前の描画から間が空いたとき）は、その場で合わせる。 */
  var camState = null, camLastNow = -1, lastCam = null, lastBeats = null;
  var ROBOT_SPAN_TILES = 3;   // ロボットの絵（44px）＋足もとの名札が縦に占めるマス数（20px/マス）
  function camTarget(hx, hy, cur) {
    var cols = W.view.cols, rows = W.view.rows;
    var maxX = Math.max(0, W.ground[0].length - cols);
    var maxY = Math.max(0, W.ground.length - rows);
    var cx = cur ? cur.x : hx + 0.5 - cols / 2, cy = cur ? cur.y : hy + 0.5 - rows / 2;
    var mx = cols * 0.3, my = rows * 0.3;
    if (hx - cx < mx) cx = hx - mx;
    else if (hx + 1 - cx > cols - mx) cx = hx + 1 - (cols - mx);
    /* 縦は「通りの北側」「通りの南側」の2画面に切り替える（半端な位置で止めると
       建物の屋根や看板が切れる）。8行の画面に、片側の建物・歩道・車道が丸ごと入る。 */
    if (W.view.bands) {
      var band = W.view.bands[0];
      W.view.bands.forEach(function (bd) { if (hy >= bd.from) band = bd; });
      cy = band.y;
      /* ★ 2026-10-03: 南側の建物の扉の前（14行目）に立つと、帯の位置（7.5）では
         ロボットの下半分と名札が画面の下に切れる。南の帯では、ロボット（約2.2マス）と
         名札まで入る高さまで下げる（街の下端で止まる）。 */
      if (band.from > 0) cy = Math.max(cy, hy + ROBOT_SPAN_TILES - rows);
    } else if (hy - cy < my) cy = hy - my;
    else if (hy + 1 - cy > rows - my) cy = hy + 1 - (rows - my);
    return { x: Math.max(0, Math.min(maxX, cx)), y: Math.max(0, Math.min(maxY, cy)) };
  }
  function camera(hx, hy, now) {
    var cols = W.view.cols, rows = W.view.rows;
    if (cols >= W.ground[0].length && rows >= W.ground.length) return { x: 0, y: 0 };
    var tgt = camTarget(hx, hy, camState);
    if (now == null) return camState ? { x: camState.x, y: camState.y } : tgt;   // 検査用（描かずに座標だけ）
    var dt = (camLastNow < 0) ? 1e9 : now - camLastNow;
    camLastNow = now;
    if (!camState || dt > 250 || dt < 0 ||
        Math.abs(tgt.x - camState.x) > cols || Math.abs(tgt.y - camState.y) > rows) {
      camState = { x: tgt.x, y: tgt.y };
    } else {
      var a = 1 - Math.exp(-dt / 170);
      camState.x += (tgt.x - camState.x) * a;
      camState.y += (tgt.y - camState.y) * a;
      if (Math.abs(tgt.x - camState.x) < 0.01) camState.x = tgt.x;
      if (Math.abs(tgt.y - camState.y) < 0.01) camState.y = tgt.y;
    }
    /* 滑らせている途中でも、主役が画面の外に出ることは許さない（止めてコマを
       選び直したときなどに、カメラが追いつく前の絵が残らないように）。 */
    var pad = 1;
    if (hx < camState.x + pad) camState.x = hx - pad;
    if (hx + 1 > camState.x + cols - pad) camState.x = hx + 1 - (cols - pad);
    if (hy < camState.y + 0.2 || hy + 1 > camState.y + rows - 0.2) camState.y = tgt.y;
    /* 南側の扉の前へ歩いていくときも、ロボットと名札が下に切れたままにはしない
       （tgt.y はロボットの位置に連れて動くので、跳ばずに付いていく） */
    else if (tgt.y > camState.y && hy + ROBOT_SPAN_TILES > camState.y + rows) camState.y = tgt.y;
    camState.x = Math.max(0, Math.min(W.ground[0].length - cols, camState.x));
    /* 1ワールド画素に丸める（地面のタイルの継ぎ目が出ないように） */
    return { x: Math.round(camState.x * T) / T, y: Math.round(camState.y * T) / T };
  }

  /* ---------- 地面 ---------- */
  function groundAt(x, y) {
    var row = W.ground[y];
    return (row && row[x]) || 'g';
  }

  function drawGround(cam) {
    var cols = W.view.cols, rows = W.view.rows;
    for (var ry = -1; ry <= rows; ry++) {
      for (var rx = -1; rx <= cols; rx++) {
        var mx = Math.floor(cam.x) + rx, my = Math.floor(cam.y) + ry;
        var sx = (rx - (cam.x - Math.floor(cam.x))) * T;
        var sy = (ry - (cam.y - Math.floor(cam.y))) * T;
        var ch = groundAt(mx, my);
        var near = null;
        if (ch === 's') {
          near = {
            south: 'alx'.indexOf(groundAt(mx, my + 1)) !== -1,
            north: 'alx'.indexOf(groundAt(mx, my - 1)) !== -1
          };
        }
        AQ.tiles.draw(ch, sx, sy, mx, my, near);
      }
    }
  }

  /* ---------- 建物などの状態 ---------- */
  function propState(o, beat, st) {
    if (o.type === 'service') {
      var target = beat.lead && beat.lead.target;
      if (serviceFor(target) !== o) return null;
      if (beat.kind === 'require') return 'require';
      if (beat.kind === 'pay' || beat.kind === 'receive' || beat.kind === 'batch') return 'paid';
      return null;
    }
    if (o.type === 'signage') return (beat.kind === 'settle' || st.settled > 0) ? 'lit' : null;
    /* 立会所は、確定のコマのあいだだけ「作業中」に光る。 */
    if (o.type === 'facilitator') return (beat.kind === 'settle') ? 'lit' : null;
    if (o.type === 'charger') return beat.kind === 'idle' ? 'lit' : null;
    if (o.type === 'signal')  return (beat.kind === 'travel') ? 'go' : null;
    return null;
  }

  /* ---------- ロボット ---------- */
  function drawRobot(hx, hy, dir, moving, now, pal, sm, mood) {
    sm = sm || S;
    var bob = moving ? (Math.floor(now / 120) % 2) : 0;
    /* うれしいときは小さく跳ねる／しょんぼりは少し沈む */
    if (!moving && mood === 'happy') bob = Math.round(Math.abs(Math.sin(now / 140)) * 4);
    if (!moving && mood === 'sad') bob = -1;
    // 影
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(hx + 2, hy + 19, 12, 3);
    var y = hy - bob;
    AQ.sprites.drawFigure(ctx, sm, hx, y, ROBOT_W, ROBOT_H, dir, pal, mood);
    if (mood && !moving && AQ.sprites.drawEmote) AQ.sprites.drawEmote(ctx, mood, hx, y, ROBOT_W, ROBOT_H, now);

    // 車輪の回転（動いているときだけ、明るい点を回す）
    if (moving) {
      var t = Math.floor(now / 90) % 4;
      var pts = [[1, 17], [2, 16], [3, 17], [2, 18]];
      var p1 = pts[t];
      px(hx + p1[0], y + p1[1], 1, 1, '#9aa1b0');
      px(hx + 14 - p1[0], y + p1[1], 1, 1, '#9aa1b0');
    }
  }

  /* ---------- コマごとの演出 ---------- */
  function bubble(x, y, w, h) {
    px(x - 1, y - 1, w + 2, h + 2, '#0d1017');
    px(x, y, w, h, '#f2f5fa');
    px(x, y, w, 1, '#ffffff');
    px(x, y + h - 1, w, 1, '#b9bfcc');
  }

  /* ★ 2026-10-02: 街の演出を「文字」から「物の動き」へ（利用者の提案「kibble の
     部屋を参考に、こちらも文字ではなく、なるべくアクションで」）。
     x402 の5つの段階を、それぞれ1つの動きで見せる：
       ① お店に頼んだ        … 注文の紙が、ロボットの手から店の扉へ吸い込まれる
       ② 「お金が要る」と返した … 扉に値札がぶら下がる（402 と金額の数字だけ）
          402 で断られた       … 値札が揺れ、扉は閉じたまま（「未払い」の文字は出さない）
       ③ 許可証に署名した    … ロボットが許可証を出し、ペンで署名すると許可証が光り、
                               扉へ渡る。払った額は硬貨と数字で
       ④ 立会人がチェーンに載せた … 許可証を立会所へ渡し、判が押されると、立会所の上の
                               チェーンにブロックが1つ積まれる（「OK」の文字は出さない）
       ⑤ お店が中身を渡した  … 扉が開き、品物の箱がロボットの手に渡る
     どれも、そのコマが本当にログにあるときだけ出る（記録に無い段階の動きは足さない）。
     402・金額のような数字は、x402 の肝で事実そのものなので残す。 */
  function actP(b, p) {
    var walk = (b && b._route && b._route.length > 1) ? WALK_UNTIL : 0;
    return Math.max(0, Math.min(1, (p - walk) / (1 - walk)));
  }
  function ease(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  /** その店の扉（建物の下辺の真ん中）の画面上の位置。 */
  function doorOf(b) {
    var o = serviceFor(b && b.lead && b.lead.target);
    var cam = lastCam || { x: 0, y: 0 };
    if (!o) return null;
    return { x: (o.x - cam.x) * T + o.w * T / 2, y: (o.y + o.h - cam.y) * T, o: o };
  }
  function facilOf() {
    var o = W.objects.filter(function (x) { return x.type === 'facilitator'; })[0];
    var cam = lastCam || { x: 0, y: 0 };
    return o ? { x: (o.x - cam.x) * T + o.w * T / 2, y: (o.y + o.h - cam.y) * T, top: (o.y - cam.y) * T, o: o } : null;
  }
  /** 紙（注文・許可証）。seal=true で赤い判、glow で光る。 */
  function paperAt(x, y, seal, glow, signed) {
    var w = 13, h = 16;
    if (glow > 0) {
      ctx.save(); ctx.globalAlpha = 0.55 * glow; ctx.fillStyle = '#ffe9a0';
      ctx.fillRect(Math.round(x - 4), Math.round(y - 4), w + 8, h + 8); ctx.restore();
    }
    px(x - 1, y - 1, w + 2, h + 2, '#0d1017');
    px(x, y, w, h, '#f4f1e4');
    px(x, y, w, 1, '#ffffff');
    for (var i = 0; i < 3; i++) px(x + 2, y + 3 + i * 3, w - 4 - (i % 2) * 3, 1, '#9aa0ae');
    if (signed > 0) {                                  // 署名の線（左から書かれていく）
      var sw = Math.round((w - 4) * Math.min(1, signed));
      ctx.save(); ctx.strokeStyle = '#2753a8'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (var k = 0; k <= sw; k++) {
        var yy = y + h - 4 + Math.sin(k * 1.3) * 1.6;
        if (k === 0) ctx.moveTo(x + 2 + k, yy); else ctx.lineTo(x + 2 + k, yy);
      }
      ctx.stroke(); ctx.restore();
    }
    if (seal) { px(x + w - 5, y + h - 6, 4, 4, '#c02b1c'); px(x + w - 4, y + h - 5, 2, 2, '#ff8a7a'); }
  }
  function coinAt(x, y, r, other) {
    ctx.save();
    ctx.fillStyle = other ? '#8f96a6' : '#2775ca';     // USDC 以外は灰色の硬貨
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    /* 検査用：硬貨の中心が画用紙のどの画素か（塗りが本当に付いたかを色で確かめる） */
    if (ctx.getTransform && typeof DOMPoint !== 'undefined') {
      var q = ctx.getTransform().transformPoint(new DOMPoint(x + r * 0.35, y + r * 0.35));
      lastCoinPx = { x: Math.round(q.x), y: Math.round(q.y), other: !!other };
    }
    ctx.strokeStyle = '#e8f1ff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r * 0.65, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e8f1ff'; ctx.fillRect(Math.round(x - 0.6), Math.round(y - r * 0.5), 1.2, r);
    ctx.restore();
  }
  /* ★ 2026-10-03: 絵に出す額は USDC のときだけ（財布・硬貨は USDC の絵なので、
     別のトークンの数を描くと USDC の額に見えてしまう）。別のトークンの額は
     見出しと詳細に、資産名つきで出る。 */
  function amountText(b) {
    var amt = b.lead && b.lead.amount;
    if (!amt || !isUsdcBeat(b) || amt.value == null || amt.value === '' || isNaN(Number(amt.value))) return '';
    return Number(amt.value).toFixed(3);
  }
  /** 値札（扉にぶら下がる）。402 と金額の数字だけ。swing で揺れる。 */
  function priceTag(d, b, drop, swing) {
    if (!d) return;
    var w = 36, h = 20;
    var x = Math.round(d.x - w / 2 + swing), y = Math.round(d.y - 30 + (1 - drop) * -14);
    px(Math.round(d.x), y - 6, 1, 6, '#9aa0ae');                 // 吊り紐
    px(x - 1, y - 1, w + 2, h + 2, '#0d1017');
    px(x, y, w, h, '#ffe08a');
    px(x, y, w, 1, '#fff3c4');
    px(x + 3, y + 3, 3, 3, '#0d1017');                           // 紐の穴
    label('402', x + 9, y + 2, '#c02b1c', 6);
    var am = amountText(b);
    if (am) label(am, x + 3, y + 11, '#14161f', 5);
    lastFxDrawn.push('tag402');
  }
  /** 扉が開く（暗い口が開いて、中から光がもれる）。open 0..1 */
  function doorOpen(d, open) {
    if (!d || open <= 0) return;
    var w = 12, h = 14;
    var x = Math.round(d.x - w / 2), y = Math.round(d.y - h);
    px(x, y, w, h, '#0d1017');
    ctx.save(); ctx.globalAlpha = 0.7 * open; ctx.fillStyle = '#ffe9a0';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 2); ctx.restore();
    px(x - Math.round(6 * open), y, Math.max(1, Math.round(6 * (1 - open)) + 2), h, '#4a5468');   // 開いていく扉板
    lastFxDrawn.push('door-open');
  }
  /** チェーンのブロック（立会所の上に積まれていく）。n 個＋新しい1個が lift で落ちてくる */
  function chainAt(f, n, lift) {
    if (!f) return;
    var bw = 11, gap = 4, total = Math.min(5, n + 1);
    var x0 = Math.round(f.x - (total * (bw + gap) - gap) / 2), y0 = Math.round(f.top - 18);
    for (var i = 0; i < total; i++) {
      var isNew = (i === total - 1);
      var yy = y0 - (isNew ? Math.round((1 - lift) * 22) : 0);
      if (i > 0) px(x0 + i * (bw + gap) - gap, y0 + 5, gap, 1, '#7fb4ff');   // つなぐ線
      ctx.save(); ctx.globalAlpha = isNew ? Math.min(1, 0.3 + lift) : 1;
      px(x0 + i * (bw + gap) - 1, yy - 1, bw + 2, bw + 2, '#0d1017');
      px(x0 + i * (bw + gap), yy, bw, bw, isNew ? '#3ddc84' : '#2f6fbd');
      px(x0 + i * (bw + gap), yy, bw, 2, isNew ? '#b6ffd6' : '#7fb4ff');
      ctx.restore();
    }
    lastFxDrawn.push('block');
    if (lift >= 0.999) lastFxDrawn.push('block-land');   // 新しいブロックが積み終わった（音の合図）
  }

  /* ---------- お金を主役に（2026-10-03）----------
     利用者「初心者向け。文字ではなくアニメ的な表現で」。x402 の肝は「お金が動く」
     ことなのに、残高は左上の小さな数字でしか見えなかった。
       ・主役のロボットの腰に財布（USDC の青い袋）を下げ、残高の数字を添える
         （ログに予算の宣言があるときだけ。無ければ「使った額」をマイナスで。
           どちらも無ければ財布は描かない＝知らない額は描かない）
       ・③ 署名：財布から硬貨が飛び出して許可証にくっつき、一緒に扉へ
       ・④ チェーンに載った：積まれたブロックから硬貨が店の方へ飛んでいく
     数字は state.js が出す値そのもの（HUD と同じ）。 */
  var lastPurse = null, lastZoom = null, lastCoinPx = null;
  /** そのコマのお金が USDC か（資産名が無ければアダプタの既定どおり USDC）。 */
  function isUsdcBeat(b) {
    var a = b && b.lead && b.lead.amount;
    return !!a && String(a.asset || 'USDC').toUpperCase() === 'USDC';
  }
  /* ★ 2026-10-06: 財布の数字が減るのは ④ チェーンに載ったとき（硬貨が店へ飛ぶ瞬間）。
     ③ で取り出した硬貨は「払うと約束した額」として、数字の横に薄く「-0.001」を添える。 */
  function purseInfo(b, st) {
    if (!st) return null;
    var amt = (b && b.kind === 'settle' && isUsdcBeat(b)) ? (Number(b.lead.amount.value) || 0) : 0;
    var pending = st.pending || 0;
    if (st.hasBudget && st.usdc != null) return { mode: 'bal', after: st.usdc, before: st.usdc + amt, amt: amt, pending: pending };
    if (st.spent > 0 || pending > 0) return { mode: 'spent', after: -st.spent, before: -(st.spent - amt), amt: amt, pending: pending };
    return null;
  }
  /* ★ 2026-10-04: がま口の財布（利用者「時間をかけて、がま口財布からお金を出す動作を」）。
     cx … 真ん中の x、by … 底の y、s … 大きさ（1＝腰に下げているとき）、
     open … 口の開き 0..1、shake … 左右の揺れ（px）。 */
  function gamaguchi(cx, by, s, open, shake) {
    var w = 14 * s, h = 12 * s;
    cx = cx + (shake || 0);
    var top = by - h;
    ctx.save();
    ctx.lineJoin = 'round';
    /* 袋（下がふくらんだ形） */
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.42, top + h * 0.12);
    ctx.quadraticCurveTo(cx - w * 0.62, by - h * 0.05, cx - w * 0.28, by);
    ctx.lineTo(cx + w * 0.28, by);
    ctx.quadraticCurveTo(cx + w * 0.62, by - h * 0.05, cx + w * 0.42, top + h * 0.12);
    ctx.closePath();
    ctx.fillStyle = '#2775ca'; ctx.fill();
    ctx.lineWidth = Math.max(1, 1.1 * s); ctx.strokeStyle = '#0d1017'; ctx.stroke();
    ctx.fillStyle = '#5b9be0'; ctx.fillRect(cx - w * 0.3, top + h * 0.22, w * 0.18, h * 0.35);   // てかり
    /* USDC の印（白い丸と縦棒） */
    ctx.strokeStyle = '#e8f1ff'; ctx.lineWidth = Math.max(1, 0.9 * s);
    ctx.beginPath(); ctx.arc(cx, top + h * 0.6, h * 0.22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e8f1ff'; ctx.fillRect(cx - 0.5 * s, top + h * 0.42, 1 * s, h * 0.36);
    /* 口金（金色の枠）。開くと左右に倒れて、暗い口が見える */
    var ang = open * 0.75;
    if (open > 0.02) {
      ctx.fillStyle = '#0d1017';
      ctx.beginPath(); ctx.ellipse(cx, top + h * 0.12, w * 0.4, h * 0.16 * (0.4 + open), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,233,160,' + (0.35 * open).toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(cx, top + h * 0.12, w * 0.3, h * 0.08 * (0.4 + open), 0, 0, Math.PI * 2); ctx.fill();
    }
    [-1, 1].forEach(function (side) {
      ctx.save();
      ctx.translate(cx + side * w * 0.42, top + h * 0.12);
      ctx.rotate(side * ang);
      ctx.strokeStyle = '#0d1017'; ctx.lineWidth = Math.max(2, 2.6 * s);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-side * w * 0.22, -h * 0.22, -side * w * 0.42, -h * 0.16); ctx.stroke();
      ctx.strokeStyle = '#e0b84a'; ctx.lineWidth = Math.max(1, 1.4 * s);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-side * w * 0.22, -h * 0.22, -side * w * 0.42, -h * 0.16); ctx.stroke();
      /* 留め玉 */
      ctx.fillStyle = '#ffd35c'; ctx.strokeStyle = '#0d1017'; ctx.lineWidth = Math.max(0.8, 0.7 * s);
      ctx.beginPath(); ctx.arc(-side * w * 0.38, -h * 0.24, 1.5 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
    return { mouthX: cx, mouthY: top + h * 0.1 };
  }
  function fmtPurse(v) { return (v < 0 ? '-' : '') + Math.abs(v).toFixed(3); }

  /* 支払い（③）の時間割（着いてからの進み a）。がま口を手に取る → 口を開ける →
     硬貨を取り出す → 口を閉じて腰に戻す → 許可証に署名 → 硬貨と許可証を扉へ。 */
  var PAY = { lift: 0.10, open: 0.20, coinUp: 0.38, close: 0.46, back: 0.54, signFrom: 0.54, signTo: 0.74, fly: 0.80 };
  /** 主役の財布と残高。pay のコマでは、硬貨を取り出して口を閉じる（PAY.close）まで前の額を出す。 */
  function drawPurse(hx, hy, b, p, st, now) {
    var info = purseInfo(b, st);
    lastPurse = null;
    if (!info) return null;
    var isPay = b && b.kind === 'pay';
    var a = (isPay || (b && b.kind === 'settle')) ? actP(b, p) : 1;
    var isSettle = b && b.kind === 'settle';
    var dropped = !isSettle || a >= SET.coin;
    var v = dropped ? info.after : info.before;
    /* 約束した額（まだ動いていない）：③ で硬貨を取り出してから、④ で店へ飛ぶまで */
    var pend = info.pending + (isSettle && !dropped ? info.amt : 0);
    if (isPay && a < PAY.close) pend -= (b.lead && b.lead.amount && isUsdcBeat(b)) ? (Number(b.lead.amount.value) || 0) : 0;
    /* 腰の位置（ふだん）と、手に持って前に出した位置（支払いのとき） */
    /* 手に持つと、ロボットの左わきで少し持ち上げて大きく見せる（顔は隠さない） */
    var hipX = hx - 7, hipY = hy + 29, handX = hx - 12, handY = hy + 30;
    var k = 0, open = 0;
    if (isPay) {
      if (a < PAY.lift) k = ease(a / PAY.lift);
      else if (a < PAY.close) k = 1;
      else if (a < PAY.back) k = 1 - ease((a - PAY.close) / (PAY.back - PAY.close));
      if (a >= PAY.lift && a < PAY.open) open = ease((a - PAY.lift) / (PAY.open - PAY.lift));
      else if (a >= PAY.open && a < PAY.coinUp + 0.02) open = 1;
      else if (a >= PAY.coinUp + 0.02 && a < PAY.close) open = 1 - ease((a - PAY.coinUp - 0.02) / (PAY.close - PAY.coinUp - 0.02));
    }
    var cx = hipX + (handX - hipX) * k, by = hipY + (handY - hipY) * k, sc = 1 + 0.5 * k;
    var shake = (isPay && a >= PAY.close - 0.03 && a < PAY.close + 0.03) ? Math.sin(now / 25) * 1.5 : 0;
    var g = gamaguchi(cx, by, sc, open, shake);
    if (open > 0.05) lastFxDrawn.push('purse-open');
    /* 残高の札（財布の上） */
    var tx = fmtPurse(v);
    var w = tx.length * 5 + 4, lx = Math.round(cx - w / 2), ly = Math.round(by - 12 * sc - 13);
    if (k > 0.01) {                                    // 手に持っている間は、札を左へよける（硬貨の通り道を空ける）
      lx = Math.round(lx + (cx - 7 * sc - w - 3 - lx) * k);
      ly = Math.round(ly + (by - 12 * sc * 0.6 - ly) * k);
    }
    px(lx - 1, ly - 1, w + 2, 9, '#0d1017');
    px(lx, ly, w, 7, '#f2f5fa');
    label(tx, lx + 2, ly + 1, v < 0 ? '#c02b1c' : '#1a5296', 5);
    if (pend > 0.0000001) {
      var pt = '-' + pend.toFixed(3), pw2 = pt.length * 5 + 4;
      ctx.save(); ctx.globalAlpha = 0.85;
      var plx = lx - pw2 - 3;                          // 残高の札の左どなり（財布を隠さない）
      px(plx - 1, ly - 1, pw2 + 2, 9, '#0d1017'); px(plx, ly, pw2, 7, '#3a3f4a');
      ctx.restore();
      label(pt, plx + 2, ly + 1, '#ffb4a8', 5);
      lastFxDrawn.push('pending');
    }
    lastPurse = { value: v, pending: pend > 0.0000001 ? +pend.toFixed(6) : 0, x: cx - 6, y: by - 12, mouthX: g.mouthX, mouthY: g.mouthY, held: k };
    lastFxDrawn.push('purse');
    return { x: cx, y: by - 6 };
  }

  /* ---------- 見せ場でカメラが寄る（2026-10-03）----------
     402 の値札・署名・判とブロック・箱を受け取る、の4つの瞬間だけ、ロボットと
     相手（店の扉／立会所）の間にカメラが寄る（最大 1.45 倍）。歩いている間は寄らない。
     寄り方はコマの進み p だけで決まる（止めても巻き戻しても同じ絵）。 */
  /* ---------- 表情（2026-10-03）----------
     主役のロボットの顔だけ変える（どのコマでも、そのコマが本当にあるときだけ）。
       ② 402 の値札が下りた／402 で断られた … 困り顔（汗）
       ③ 署名                                … きりっ
       ④ 判が押されるまで きりっ → ブロックから硬貨が店へ飛ぶと うれしい
       ⑤ 箱が手に届いたら                    … うれしい（跳ねる）
       応答が無かった（寄りの画面）          … しょんぼり */
  var lastMood = null;
  function moodFor(b, p, moving) {
    if (!b || moving) return null;
    var a = actP(b, p);
    if (b.kind === 'require') return a > 0.25 ? 'worried' : null;
    if (b.kind === 'error') return String((b.lead && b.lead.status) || '') === '402' ? 'worried' : 'sad';
    if (b.kind === 'pay') return 'determined';
    if (b.kind === 'settle') return a < SET.coin ? null : 'happy';   // 店の前で待つ → 硬貨が届いたら うれしい
    if (b.kind === 'receive') return a >= 0.55 ? 'happy' : null;
    return null;
  }

  /* ---------- 始動・終了（2026-10-04）----------
     利用者「こちら（街）もエージェントが始動するときのアクションを」。部屋と同じ時間割：
       始動  … 体が暗いまま電源の印 → 目がちらちら点く → 体が明るくなり、アンテナから
               光の輪 → ぴょんと跳ねて着地の土ぼこり → きらきら
       終了  … 星を散らして2回跳ねる → 体が暗くなり、Z が昇る（休む）
     clock.phase() を main.js が setPhase で渡す（実時間で進む＝再生の速さに関係しない）。 */
  var phaseNow = { boot: null, end: 0 }, lastPhaseDrawn = null;
  function phaseLook(ph) {
    var out = { bright: 1, hop: 0, fx: [], stage: null };
    if (ph && ph.boot != null) {
      var b = ph.boot;
      if (b < 0.36) out.bright = (b > 0.20 && b < 0.24) || (b > 0.28 && b < 0.31) ? 0.8 : 0.3;
      else if (b < 0.60) out.bright = 0.3 + 0.7 * (b - 0.36) / 0.24;
      if (b < 0.34) out.fx.push({ k: 'power', t: b / 0.34 });
      if (b >= 0.60 && b < 0.86) out.hop = Math.sin(Math.PI * (b - 0.60) / 0.26);
      if (b >= 0.34 && b < 0.78) out.fx.push({ k: 'ring', t: (b - 0.34) / 0.44 });
      if (b >= 0.84 && b < 1) out.fx.push({ k: 'dust', t: (b - 0.84) / 0.16 });
      if (b >= 0.76) out.fx.push({ k: 'spark', t: (b - 0.76) / 0.24 });
      out.stage = 'boot';
    } else if (ph && ph.end > 0) {
      var e = ph.end;
      if (e < 0.46) {
        var h = (e / 0.46) * 2;
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
  function sparkleAt(x, y, r, col) {
    var w = Math.max(1, Math.round(r * 0.35));
    px(Math.round(x - w / 2), Math.round(y - r), w, r * 2, col);
    px(Math.round(x - r), Math.round(y - w / 2), r * 2, w, col);
  }
  function pixelZ(x, y, sz, col) {
    var t = Math.max(1, Math.round(sz / 4));
    px(x, y, sz, t, col);
    for (var i = 1; i < 4; i++) px(Math.round(x + sz - (sz * i) / 4 - t / 2), Math.round(y + (sz * i) / 4 - t / 2), t, t, col);
    px(x, y + sz - t, sz, t, col);
  }
  function drawPhaseFx(look, hx, hy, now) {
    var cx = hx + ROBOT_W / 2, top = hy + 2;
    look.fx.forEach(function (f) {
      if (f.k === 'power') {                           // 電源の印（⏻）が点滅
        if (Math.floor(now / 160) % 2) return;
        ctx.save(); ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, top - 12, 5, -Math.PI * 0.3, Math.PI * 1.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, top - 19); ctx.lineTo(cx, top - 12); ctx.stroke(); ctx.restore();
      } else if (f.k === 'ring') {
        ctx.save(); ctx.globalAlpha = 1 - f.t; ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, top, 3 + 22 * f.t, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      } else if (f.k === 'spark') {
        ctx.save(); ctx.globalAlpha = 1 - f.t * 0.8;
        [[-0.62, 0.25], [0.66, 0.18], [-0.5, 0.72], [0.58, 0.66]].forEach(function (o, i) {
          var rr = Math.max(2, Math.round(3 * (1 - Math.abs(f.t - 0.3 - i * 0.1))));
          sparkleAt(cx + o[0] * ROBOT_W, hy + o[1] * ROBOT_H, rr, '#fff6c9');
        });
        ctx.restore();
      } else if (f.k === 'dust') {                     // 着地の土ぼこり
        ctx.save(); ctx.globalAlpha = 0.7 * (1 - f.t); ctx.fillStyle = '#c9c2b0';
        [-1, 1].forEach(function (sd) {
          for (var i = 0; i < 3; i++) {
            ctx.beginPath(); ctx.arc(cx + sd * (10 + 10 * f.t + i * 4), hy + ROBOT_H - 4 - i * 2, 2.5 - i * 0.5, 0, Math.PI * 2); ctx.fill();
          }
        });
        ctx.restore();
      } else if (f.k === 'stars') {
        ctx.save(); ctx.globalAlpha = 1 - Math.max(0, f.t - 0.6) / 0.4;
        for (var k = 0; k < 6; k++) {
          var ang = -Math.PI / 2 + (k - 2.5) * 0.5, dd = ROBOT_W * (0.35 + 0.45 * f.t);
          sparkleAt(cx + Math.cos(ang) * dd, top + 4 + Math.sin(ang) * dd * 0.7, 3, (k % 2) ? '#ffd35c' : '#fff6c9');
        }
        ctx.restore();
      } else if (f.k === 'zz') {
        ctx.save(); ctx.globalAlpha = Math.min(1, f.t * 3);
        pixelZ(Math.round(hx + ROBOT_W * 0.78), Math.round(top - 4 - 10 * f.t), 6, '#cfd6e6');
        if (f.t > 0.45) pixelZ(Math.round(hx + ROBOT_W * 0.95), Math.round(top - 14 - 10 * (f.t - 0.45)), 5, '#9aa4b8');
        ctx.restore();
      }
    });
  }
  /** 暗い体（電源が入る前・休んでいる）。別の小さな画用紙に描いて、描いたところだけ暗く塗る。 */
  var dimCanvas = null;
  function drawRobotDim(hx, hy, dir, pal, sm, bright) {
    var pad = 4;
    var oc = dimCanvas || (dimCanvas = (typeof document !== 'undefined' && document.createElement) ? document.createElement('canvas') : null);
    var ocx = oc && oc.getContext ? oc.getContext('2d') : null;
    if (!ocx || !ctx.drawImage) { AQ.sprites.drawFigure(ctx, sm, hx, hy, ROBOT_W, ROBOT_H, dir, pal); return; }
    var tf = ctx.getTransform ? ctx.getTransform() : null, sc = (tf && tf.a) || 1;
    var bw = ROBOT_W + pad * 2, bh = ROBOT_H + pad * 2;
    var nw = Math.ceil(bw * sc), nh = Math.ceil(bh * sc);
    if (oc.width !== nw || oc.height !== nh) { oc.width = nw; oc.height = nh; }
    ocx.setTransform(1, 0, 0, 1, 0, 0); ocx.globalCompositeOperation = 'source-over'; ocx.clearRect(0, 0, nw, nh);
    ocx.setTransform(sc, 0, 0, sc, 0, 0);
    AQ.sprites.drawFigure(ocx, sm, pad, pad, ROBOT_W, ROBOT_H, dir, pal);
    ocx.setTransform(1, 0, 0, 1, 0, 0); ocx.globalCompositeOperation = 'source-atop';
    ocx.fillStyle = 'rgba(8,10,18,' + (1 - bright).toFixed(3) + ')'; ocx.fillRect(0, 0, nw, nh);
    ocx.globalCompositeOperation = 'source-over';
    ctx.drawImage(oc, Math.round(hx - pad), Math.round(hy - pad), bw, bh);
  }

  var ZOOM_KINDS = { require: 1, pay: 1, receive: 1, error: 1 };   // 確定は寄らない（立会所の窓口の寄り絵を出すため）
  var ZOOM_MAX = 1.45;
  function zoomFor(b, p, moving) {
    if (!b || moving || !ZOOM_KINDS[b.kind]) return 1;
    if (b.kind === 'error' && String((b.lead && b.lead.status) || '') !== '402') return 1;
    var a = actP(b, p);
    var up = ease(Math.min(1, a / 0.18)), down = ease(Math.min(1, (1 - a) / 0.12));
    return 1 + (ZOOM_MAX - 1) * Math.min(up, down);
  }

  /* ---------- ④ 確定：立会所の窓口の寄り絵（2026-10-06）---------- */
  /* 時間割（着いてからの進み a）。send＝店から許可証が飛ぶ、checks＝4つを確かめる、
     stamp＝判、gas＝ガス代を入れて燃やす、chain＝ブロックが積まれる、coin＝硬貨が店へ。 */
  var SET = { send: 0.10, land: 0.16, checks: [0.20, 0.29, 0.38, 0.47], checkLen: 0.09,
              stamp: 0.56, gas: 0.62, chain: 0.70, coin: 0.84 };
  var CHECK_FX = ['check-sig', 'check-amount', 'check-balance', 'check-expiry'];
  /** 立会所の横に、つながったブロック（確かめる窓を出さないとき用）。看板は隠さない。 */
  function settledBeforeOf(b) {
    var n = 0;
    if (lastBeats) for (var i = 0; i < lastBeats.length && lastBeats[i] !== b; i++) if (lastBeats[i].kind === 'settle') n++;
    return n;
  }
  function chainBeside(f, n, lift) {
    var bw = 9, gap = 3, total = Math.min(5, n + 1);
    var x0 = Math.round(f.x + f.o.w * T / 2 + 6), y0 = Math.round(f.top + 6);
    for (var i = 0; i < total; i++) {
      var isNew = (i === total - 1);
      var yy = y0 - (isNew ? Math.round((1 - lift) * 18) : 0);
      if (i > 0) px(x0 + i * (bw + gap) - gap, y0 + 4, gap, 1, '#7fb4ff');
      ctx.save(); ctx.globalAlpha = isNew ? Math.min(1, 0.3 + lift) : 1;
      px(x0 + i * (bw + gap) - 1, yy - 1, bw + 2, bw + 2, '#0d1017');
      px(x0 + i * (bw + gap), yy, bw, bw, isNew ? '#3ddc84' : '#2f6fbd');
      px(x0 + i * (bw + gap), yy, bw, 2, isNew ? '#b6ffd6' : '#7fb4ff');
      ctx.restore();
    }
    lastFxDrawn.push('block');
    if (lift >= 0.999) lastFxDrawn.push('block-land');
  }
  function checkMark(x, y, s, on) {
    if (!on) { px(x, y, s, s, '#3a4256'); px(x + 1, y + 1, s - 2, s - 2, '#1a2030'); return; }
    px(x, y, s, s, '#1a7a4a');
    ctx.save(); ctx.strokeStyle = '#b6ffd6'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(x + s * 0.2, y + s * 0.55); ctx.lineTo(x + s * 0.42, y + s * 0.78); ctx.lineTo(x + s * 0.82, y + s * 0.22); ctx.stroke(); ctx.restore();
  }
  function miniShop(x, y) { px(x, y + 2, 10, 7, '#8f96a6'); px(x - 1, y, 12, 3, '#3c4250'); px(x + 4, y + 5, 3, 4, '#0d1017'); px(x + 1, y + 3, 2, 2, '#7fd4ff'); px(x + 7, y + 3, 2, 2, '#7fd4ff'); }
  function miniPurse(x, y) {
    px(x + 1, y + 3, 10, 7, '#2775ca'); px(x, y + 4, 12, 5, '#2775ca'); px(x + 2, y + 2, 8, 1, '#e0b84a');
    px(x + 4, y + 1, 2, 2, '#ffd35c'); px(x + 6, y + 1, 2, 2, '#ffd35c'); px(x + 5, y + 5, 2, 3, '#e8f1ff');
  }
  function miniGlass(x, y, now) {          // 砂時計（期限）
    px(x, y, 9, 1, '#c8a06a'); px(x, y + 10, 9, 1, '#c8a06a');
    px(x + 1, y + 1, 7, 2, '#cfe6ff'); px(x + 2, y + 3, 5, 2, '#cfe6ff'); px(x + 3, y + 5, 3, 1, '#cfe6ff');
    px(x + 2, y + 6, 5, 2, '#cfe6ff'); px(x + 1, y + 8, 7, 2, '#cfe6ff');
    var k = Math.floor(now / 300) % 3;
    px(x + 3, y + 1 + k, 3, 1, '#e0b84a'); px(x + 4, y + 5, 1, 1, '#e0b84a'); px(x + 2, y + 9 - k, 5, 1, '#e0b84a');
  }
  function miniRobot(x, y) { px(x + 1, y, 8, 6, '#cfd6e6'); px(x + 2, y + 2, 6, 2, '#0d1017'); px(x + 3, y + 2, 1, 1, '#ffd35c'); px(x + 6, y + 2, 1, 1, '#ffd35c'); px(x + 2, y + 6, 6, 4, '#e8e2d6'); }
  function gasGem(x, y, r, burn, now) {    // ガス代（立会人が払う）：灰色のひし形。燃えると炎に
    if (burn > 0) {
      var fl = (Math.sin(now / 60) + 1) * 0.5;
      ctx.save(); ctx.globalAlpha = 1 - burn;
      ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.moveTo(x, y - r * (1.6 + fl * 0.4)); ctx.quadraticCurveTo(x + r, y, x, y + r * 0.8); ctx.quadraticCurveTo(x - r, y, x, y - r * (1.6 + fl * 0.4)); ctx.fill();
      ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.moveTo(x, y - r * 0.8); ctx.quadraticCurveTo(x + r * 0.5, y + r * 0.2, x, y + r * 0.6); ctx.quadraticCurveTo(x - r * 0.5, y + r * 0.2, x, y - r * 0.8); ctx.fill();
      ctx.restore();
      if (burn < 0.4) { ctx.save(); ctx.globalAlpha = 1 - burn / 0.4; drawGem(); ctx.restore(); }
      return;
    }
    drawGem();
    function drawGem() {
      ctx.save(); ctx.fillStyle = '#8f9ab8'; ctx.strokeStyle = '#0d1017'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.7, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.7, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9d2ea'; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.7, y); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  var lastPanelDrawn = null;
  /** 立会所の窓口の寄り絵。画面の上、ロボットのいない側に出す（文字は数字だけ）。 */
  function drawFacilPanel(b, a, now, nBefore, robotX, place) {
    var VW = W.view.cols * T, VH = W.view.rows * T;
    var BW = 176, BH = 118;
    var sc, ox, oy;
    if (place) {                                       // 画面の下の寄り絵の欄に描く（2026-10-06）
      sc = place.sc; ox = place.ox; oy = place.oy;
    } else {
      sc = VW < 260 ? (VW - 12) / BW : Math.min(0.95, Math.max(0.75, VW * 0.5 / BW));
      var left = (robotX + ROBOT_W / 2) > VW / 2;
      ox = left ? 6 : VW - BW * sc - 6;
      var slide = ease(Math.min(1, a / 0.06));
      oy = 4 - (1 - slide) * (BH * sc + 10);
    }
    var pw = BW * sc, ph = BH * sc;
    ctx.save();
    ctx.translate(Math.round(ox), Math.round(oy)); ctx.scale(sc, sc);
    /* 枠（ドラクエの窓のように） */
    px(0, 0, BW, BH, '#05070c');
    ctx.strokeStyle = '#f2f5fa'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, BW - 4, BH - 4);
    /* 立会人（左）とカウンター */
    var fx0 = 10, fy0 = 34;
    px(fx0 + 2, fy0 + 2, 16, 14, '#e8c9a0');
    px(fx0 + 1, fy0 - 2, 18, 6, '#2f3646'); px(fx0, fy0 + 2, 20, 2, '#3c4454');
    px(fx0 + 6, fy0 + 9, 2, 2, '#14161f'); px(fx0 + 12, fy0 + 9, 2, 2, '#14161f');
    px(fx0 + 1, fy0 + 16, 18, 22, '#2f7f6a'); px(fx0 + 8, fy0 + 16, 4, 8, '#e8e2d6');
    px(0, 80, BW, 6, '#6f7684'); px(0, 80, BW, 1, '#8f96a6');
    /* 許可証（大きく）：4行＝署名／宛先と金額／財布／期限。右に ✓ の枠 */
    var land = ease(Math.min(1, Math.max(0, (a - SET.send) / (SET.land - SET.send))));
    var showPermit = a >= SET.send && a < SET.gas + 0.04;
    var PX = 40, PY = 10, PWd = 60, PHt = 66;
    var rows = [PY + 8, PY + 22, PY + 36, PY + 50];
    var checked = SET.checks.map(function (c) { return a >= c + SET.checkLen * 0.7; });
    if (showPermit) {
      var shrink = a >= SET.gas ? ease(Math.min(1, (a - SET.gas) / 0.04)) : 0;
      ctx.save(); ctx.globalAlpha = (1 - shrink) * Math.min(1, land * 1.5);
      var dropY = Math.round((1 - land) * -30);
      ctx.translate(0, dropY);
      px(PX - 1, PY - 1, PWd + 2, PHt + 2, '#0d1017');
      px(PX, PY, PWd, PHt, '#f4f1e4'); px(PX, PY, PWd, 1, '#ffffff');
      /* ① 署名 */
      ctx.save(); ctx.strokeStyle = '#2753a8'; ctx.lineWidth = 1.4; ctx.beginPath();
      for (var k = 0; k <= 30; k++) { var yy = rows[0] + 5 + Math.sin(k * 0.9) * 2.5; if (k === 0) ctx.moveTo(PX + 6 + k, yy); else ctx.lineTo(PX + 6 + k, yy); }
      ctx.stroke(); ctx.restore();
      /* ② 宛先（店）と金額 */
      miniShop(PX + 5, rows[1] + 1);
      var am = amountText(b);
      coinAt(PX + 22, rows[1] + 6, 4, !isUsdcBeat(b));
      if (am) label(am, PX + 28, rows[1] + 2, '#14161f', 5);
      /* ③ 財布 */
      miniPurse(PX + 5, rows[2]);
      /* ④ 期限 */
      miniGlass(PX + 6, rows[3], now);
      for (var r = 0; r < 4; r++) checkMark(PX + PWd - 11, rows[r] + 1, 9, checked[r]);
      /* 判（押したあとは許可証に残る） */
      if (a >= SET.stamp + 0.03) {
        ctx.save(); ctx.strokeStyle = '#c02b1c'; ctx.lineWidth = 2; ctx.globalAlpha *= 0.9;
        ctx.beginPath(); ctx.arc(PX + PWd - 16, PY + PHt - 12, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(192,43,28,.35)'; ctx.fill(); ctx.restore();
      }
      ctx.restore();
    }
    /* 虫めがね：いま確かめている行へ */
    var ci = -1;
    for (var q = 0; q < 4; q++) if (a >= SET.checks[q] && a < SET.checks[q] + SET.checkLen) ci = q;
    if (ci >= 0) {
      var tt = (a - SET.checks[ci]) / SET.checkLen;
      var lx = PX + 14 + Math.sin(tt * Math.PI * 2) * 8, ly = rows[ci] + 6;
      ctx.save(); ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(lx, ly, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,233,160,.25)'; ctx.fill();
      ctx.strokeStyle = '#c8a06a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(lx + 6, ly + 6); ctx.lineTo(lx + 13, ly + 13); ctx.stroke();
      ctx.restore();
      /* 比べる相手（右）：① 署名した本人 ② 値札 ③ 財布の中の硬貨 ④ 時計 */
      var RX = 116, RY = rows[ci] - 2;
      ctx.save(); ctx.globalAlpha = Math.min(1, tt * 4);
      px(RX - 4, RY - 2, 50, 18, '#121a2a');
      if (ci === 0) { miniRobot(RX, RY); ctx.strokeStyle = '#2753a8'; ctx.lineWidth = 1.2; ctx.beginPath(); for (var k2 = 0; k2 <= 16; k2++) { var y2 = RY + 7 + Math.sin(k2 * 0.9) * 2; if (k2 === 0) ctx.moveTo(RX + 14 + k2, y2); else ctx.lineTo(RX + 14 + k2, y2); } ctx.stroke(); }
      if (ci === 1) { px(RX, RY, 34, 13, '#ffe08a'); px(RX + 2, RY + 2, 3, 3, '#0d1017'); var am3 = amountText(b); if (am3) label(am3, RX + 7, RY + 3, '#14161f', 5); }
      if (ci === 2) { miniPurse(RX, RY); for (var cn = 0; cn < 3; cn++) coinAt(RX + 20 + cn * 7, RY + 8 - (cn % 2) * 2, 3.5, false); }
      if (ci === 3) { ctx.strokeStyle = '#f2f5fa'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(RX + 7, RY + 7, 6, 0, Math.PI * 2); ctx.stroke();
                      var ang = now / 400; ctx.beginPath(); ctx.moveTo(RX + 7, RY + 7); ctx.lineTo(RX + 7 + Math.cos(ang) * 4, RY + 7 + Math.sin(ang) * 4); ctx.stroke(); }
      ctx.restore();
      /* 「＝」（同じ・足りる・間に合う） */
      px(RX - 14, RY + 4, 8, 2, '#3ddc84'); px(RX - 14, RY + 8, 8, 2, '#3ddc84');
      lastFxDrawn.push('verify');
    }
    checked.forEach(function (on, k3) { if (on) lastFxDrawn.push(CHECK_FX[k3]); });
    /* 判がドン */
    if (a >= SET.stamp && a < SET.gas) {
      var st = (a - SET.stamp) / (SET.gas - SET.stamp);
      var down = st < 0.5 ? ease(st / 0.5) : 1;
      var sx = PX + PWd - 16, sy = PY + PHt - 12 - (1 - down) * 40;
      px(Math.round(sx - 5), Math.round(sy - 18), 10, 12, '#8a5a3a'); px(Math.round(sx - 8), Math.round(sy - 6), 16, 6, '#c02b1c');
      if (st > 0.5) { ctx.save(); ctx.globalAlpha = 1 - (st - 0.5) * 2; ctx.fillStyle = '#fff6c9'; ctx.fillRect(PX - 4, PY - 4, PWd + 8, PHt + 8); ctx.restore(); }
      lastFxDrawn.push('stamp');
    }
    /* チェーン（窓の下）：前の確定ぶんの青いブロック＋この支払いの緑のブロック */
    /* 左の灰色2つ＝それまでにチェーンに積まれていた、ほかの人の取引のブロック（チェーンは
       ずっと前から続いている）。数はこの再生とは関係ない飾り。 */
    var CY = 94, BWk = 14, GAP = 6, total = Math.min(5, nBefore + 1), OTH = 2;
    var CX0 = Math.round((BW - ((total + OTH) * BWk + (total + OTH - 1) * GAP)) / 2) + 16 + OTH * (BWk + GAP);
    for (var oi = 0; oi < OTH; oi++) {
      var ox2 = CX0 - (OTH - oi) * (BWk + GAP);
      ctx.save(); ctx.globalAlpha = 0.55;
      px(ox2 - 1, CY - 1, BWk + 2, BWk + 2, '#0d1017'); px(ox2, CY, BWk, BWk, '#5a6070'); px(ox2, CY, BWk, 2, '#8f96a6');
      px(ox2 + BWk, CY + 6, GAP, 2, '#5a6a8a');
      ctx.restore();
    }
    var lift = a < SET.chain ? 0 : ease(Math.min(1, (a - SET.chain) / (SET.coin - SET.chain - 0.02)));
    for (var bi = 0; bi < total; bi++) {
      var isNew = bi === total - 1, bx = CX0 + bi * (BWk + GAP);
      if (isNew && lift <= 0) { ctx.save(); ctx.setLineDash && ctx.setLineDash([2, 2]); ctx.strokeStyle = '#3a4256'; ctx.strokeRect(bx + 0.5, CY + 0.5, BWk - 1, BWk - 1); ctx.setLineDash && ctx.setLineDash([]); ctx.restore(); continue; }
      var by2 = CY - (isNew ? Math.round((1 - lift) * 26) : 0);
      if (bi > 0) px(bx - GAP, CY + 6, GAP, 2, '#7fb4ff');
      px(bx - 1, by2 - 1, BWk + 2, BWk + 2, '#0d1017');
      px(bx, by2, BWk, BWk, isNew ? '#3ddc84' : '#2f6fbd');
      px(bx, by2, BWk, 2, isNew ? '#b6ffd6' : '#7fb4ff');
      if (isNew) coinAt(bx + BWk / 2, by2 + BWk / 2 + 1, 4, !isUsdcBeat(b));
    }
    lastFxDrawn.push('block');
    if (lift >= 0.999) lastFxDrawn.push('block-land');
    /* 許可証 → 硬貨になって、新しいブロックへ。立会人はガス代（ひし形）を入れて燃やす */
    var newX = CX0 + (total - 1) * (BWk + GAP) + BWk / 2;
    if (a >= SET.gas && a < SET.chain + 0.02) {
      var g = ease(Math.min(1, (a - SET.gas) / (SET.chain + 0.02 - SET.gas)));
      coinAt(PX + PWd / 2 + (newX - PX - PWd / 2) * g, PY + PHt / 2 + (CY - 26 + 7 - PY - PHt / 2) * g, 6, !isUsdcBeat(b));
    }
    if (a >= SET.gas && a < SET.coin + 0.06) {
      var gt = Math.min(1, (a - SET.gas) / (SET.chain - SET.gas));
      var gx = fx0 + 22 + (newX + 16 - fx0 - 22) * ease(gt), gy = fy0 + 26 + (CY + 6 - fy0 - 26) * ease(gt);
      var burn = a >= SET.chain ? Math.min(1, (a - SET.chain) / (SET.coin + 0.06 - SET.chain)) : 0;
      gasGem(gx, gy, 6, burn, now);
      if (burn <= 0) px(fx0 + 18, fy0 + 22, 6, 3, '#e8c9a0');      // 立会人の手
      lastFxDrawn.push('gas');
    }
    ctx.restore();
    lastPanelDrawn = { x: ox, y: oy, w: pw, h: ph, checks: checked.filter(Boolean).length };
    lastFxDrawn.push('facil-panel');
  }

  var OVERLAY = {

    /* ① お店に頼んだ（店へ向かい、着いたら注文の紙を扉へ） */
    travel: function (hx, hy, b, p, now) {
      /* ★ 2026-10-04: 着いたら、まず扉をコンコンとノック（衝撃の線が2回）→ 注文の紙を
         扉の差し入れ口へ。「お店に頼んだ」が動きで分かるように。 */
      var a = actP(b, p), d = doorOf(b);
      if (!d || a <= 0) return;
      [[0.04, 0.14], [0.16, 0.26]].forEach(function (k) {
        if (a < k[0] || a >= k[1]) return;
        var t = (a - k[0]) / (k[1] - k[0]);
        ctx.save(); ctx.globalAlpha = 1 - t; ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        var cxk = d.x + 7, cyk = d.y - 9, r0 = 3 + 6 * t;
        [-0.9, -0.3, 0.3].forEach(function (ang) {
          ctx.beginPath(); ctx.moveTo(cxk + Math.cos(ang) * r0, cyk + Math.sin(ang) * r0);
          ctx.lineTo(cxk + Math.cos(ang) * (r0 + 4), cyk + Math.sin(ang) * (r0 + 4)); ctx.stroke();
        });
        ctx.restore();
        lastFxDrawn.push('knock');
      });
      if (a < 0.3 || a >= 0.92) return;
      var t = ease((a - 0.3) / 0.62);
      var x0 = hx + ROBOT_W * 0.7, y0 = hy + ROBOT_H * 0.45;
      var x = x0 + (d.x - 6 - x0) * t, y = y0 + (d.y - 18 - y0) * t;
      ctx.save(); ctx.globalAlpha = t > 0.8 ? (1 - (t - 0.8) / 0.2) : 1;
      paperAt(Math.round(x), Math.round(y), false, 0, 0);
      ctx.restore();
      lastFxDrawn.push('paper');
    },

    /* ② 「お金が要る」と返した：扉に値札 */
    require: function (hx, hy, b, p, now) {
      var a = actP(b, p), d = doorOf(b);
      var drop = ease(Math.min(1, a / 0.35));
      var swing = Math.sin(now / 260) * 2 * (1 - Math.min(1, a));
      priceTag(d, b, drop, swing);
    },

    /* 402 で断られた：値札が大きく揺れ、扉は閉じたまま */
    error: function (hx, hy, b, p, now) {
      /* ★ 2026-10-04: 扉に錠前。ロボットが扉を押しても開かない（ガタッと揺れる）。
         「まだ払っていないので中身をもらえない」を動きで。 */
      var d = doorOf(b), a = actP(b, p);
      priceTag(d, b, 1, Math.sin(now / 70) * 4);
      if (d) {
        var jolt = (a > 0.15 && a < 0.3) || (a > 0.4 && a < 0.55) ? Math.round(Math.sin(now / 30) * 1.5) : 0;
        var lx = Math.round(d.x - 4 + jolt), ly = Math.round(d.y - 10);
        ctx.save(); ctx.strokeStyle = '#0d1017'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(lx + 4, ly, 3, Math.PI, 0); ctx.stroke();
        ctx.strokeStyle = '#c9ced9'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(lx + 4, ly, 3, Math.PI, 0); ctx.stroke(); ctx.restore();
        px(lx - 1, ly - 1, 10, 9, '#0d1017');
        px(lx, ly, 8, 7, '#e0b84a');
        px(lx + 3, ly + 2, 2, 3, '#0d1017');
        lastFxDrawn.push('lock');
      }
      lastFxDrawn.push('refused');
    },

    /* ③ 許可証に署名した：許可証を出す → 署名 → 光る → 扉へ。払った額は硬貨と数字 */
    pay: function (hx, hy, b, p, now) {
      /* ★ 2026-10-04: 時間をかけて、ひとつずつ見せる（利用者「何をしているのか分からない。
         がま口財布からお金を出す動作などを」）。
           ① がま口を手に取って前に出す ② 口金がパチンと開く ③ 硬貨を1枚取り出す
           ④ 口を閉じて腰に戻す（ここで財布の数字が減る）
           ⑤ 頭の上に許可証。ペンで署名すると光る ⑥ 硬貨を許可証に留めて、一緒に扉へ */
      var a = actP(b, p), d = doorOf(b);
      var px0 = Math.round(hx + ROBOT_W * 0.5 - 6), py0 = Math.round(hy - 20);
      var am = amountText(b);
      var other = !isUsdcBeat(b);
      var pur = lastPurse || { mouthX: hx - 7, mouthY: hy + 20 };
      /* ★ 2026-10-08: チェーンの送金の記録で、署名で払う方式（transferWithAuthorization）と
         分からない送金には、許可証も署名も描かない（記録から言えない）。硬貨だけが店へ。 */
      var plainTx = !viaFacilitator((b.lead && b.lead.meta) || {});
      /* 許可証（署名）：⑤〜⑥ */
      if (plainTx) {
        /* 何もしない（許可証は出さない） */
      } else if (a >= PAY.signFrom && a < PAY.fly) {
        var sign = Math.min(1, Math.max(0, (a - PAY.signFrom) / (PAY.signTo - PAY.signFrom)));
        var glow = a > PAY.signTo ? Math.min(1, (a - PAY.signTo) / (PAY.fly - PAY.signTo)) : 0;
        var rise = Math.round(ease(Math.min(1, (a - PAY.signFrom) / 0.05)) * 6);
        paperAt(px0, py0 - rise, true, glow, sign);
        if (sign < 1) {                                // ペン
          var penX = px0 + 2 + Math.round(9 * sign), penY = py0 + 4 - rise + Math.round(Math.sin(now / 50) * 1);
          ctx.save(); ctx.strokeStyle = '#14161f'; ctx.lineWidth = 2.4; ctx.beginPath();
          ctx.moveTo(penX + 6, penY - 8); ctx.lineTo(penX, penY + 2); ctx.stroke();
          ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 1.2; ctx.beginPath();
          ctx.moveTo(penX + 6, penY - 8); ctx.lineTo(penX + 1, penY); ctx.stroke(); ctx.restore();
        }
        lastFxDrawn.push('sign');
      } else if (a >= PAY.fly && d) {
        var t = ease((a - PAY.fly) / (1 - PAY.fly));
        var x = px0 + (d.x - 6 - px0) * t, y = py0 - 6 + (d.y - 18 - (py0 - 6)) * t;
        paperAt(Math.round(x), Math.round(y), true, 1 - t, 1);
        lastFxDrawn.push('permit');
      }
      /* 硬貨：③ がま口の口から出てくる → ④ 財布の上で待つ → ⑤ 許可証の横へ → ⑥ 一緒に扉へ */
      var cx, cy, show = false;
      var aboveY = pur.mouthY - 16;
      if (a >= PAY.open && a < PAY.coinUp) {
        var u0 = ease((a - PAY.open) / (PAY.coinUp - PAY.open));
        cx = pur.mouthX; cy = pur.mouthY + 2 - (pur.mouthY + 2 - aboveY) * u0; show = true;
        if (u0 > 0.7) {                                // 取り出した瞬間のきらめき
          ctx.save(); ctx.fillStyle = '#fff6c9';
          var r = 4 + 3 * (u0 - 0.7) / 0.3;
          ctx.fillRect(cx - r, cy - 0.5, r * 2, 1); ctx.fillRect(cx - 0.5, cy - r, 1, r * 2);
          ctx.restore();
        }
      } else if (a >= PAY.coinUp && a < PAY.signFrom) {
        cx = pur.mouthX; cy = aboveY + Math.round(Math.sin(now / 160) * 1.5); show = true;
      } else if (a >= PAY.signFrom && a < PAY.fly && plainTx) {
        cx = pur.mouthX; cy = aboveY + Math.round(Math.sin(now / 160) * 1.5); show = true;   // 許可証が無いので、財布の上で待つ
      } else if (a >= PAY.signFrom && a < PAY.fly) {
        var u = ease(Math.min(1, (a - PAY.signFrom) / 0.08));
        var sx = lastPurse ? lastPurse.mouthX : pur.mouthX;
        cx = sx + (px0 + 21 - sx) * u; cy = aboveY + (py0 + 2 - aboveY) * u - Math.sin(u * Math.PI) * 12; show = true;
      } else if (a >= PAY.fly && a < 0.98) {
        var t2 = ease((a - PAY.fly) / (1 - PAY.fly));
        if (plainTx) {
          var sx2 = pur.mouthX, sy2 = aboveY;
          cx = d ? sx2 + (d.x - sx2) * t2 : sx2; cy = d ? sy2 + (d.y - 18 - sy2) * t2 - Math.sin(t2 * Math.PI) * 14 : sy2;
        } else {
          var gx = d ? px0 + (d.x - 6 - px0) * t2 : px0, gy = d ? py0 - 6 + (d.y - 18 - (py0 - 6)) * t2 : py0;
          cx = gx + 21; cy = gy + 8;
        }
        show = true;
      }
      if (show) {
        coinAt(Math.round(cx), Math.round(cy), 6, other);
        if (am && a >= PAY.open + 0.08) {
          /* 画面の右端に近いときは、額を硬貨の左に出す（切れないように） */
          var lw = (am.length + 1) * 6, VWp = W.view.cols * T;
          var leftSide = cx < hx + ROBOT_W * 0.5 || (cx + 8 + lw > VWp - 4);
          var lxx = leftSide ? Math.round(cx) - 8 - lw : Math.round(cx) + 8;
          if (lxx < 2) lxx = Math.round(cx) + 8;
          label('-' + am, lxx, Math.round(cy) - 3, '#c02b1c', 6);
        }
        lastFxDrawn.push('coin');
      }
    },

    /* ⑤ お店が中身を渡した：扉が開き、箱が手に渡る */
    receive: function (hx, hy, b, p, now) {
      /* ★ 2026-10-05: 「払った対価として何を得たのか分からない」（利用者）。
         箱が手に届いたら、ふたが開いて中身（データの紙：グラフの描かれた1枚）が
         ぽんと出てくる＝払ったお金の代わりにこれをもらった、を絵で。
         中身の名前（price.json など）は見出しと「しらべる」に出る（絵には文字を描かない）。 */
      var a = actP(b, p), d = doorOf(b);
      doorOpen(d, Math.min(1, a / 0.25));
      var t = ease(Math.max(0, (a - 0.2) / 0.5));
      var tx = hx + ROBOT_W * 0.5 - 7, ty = hy - 16;
      var bx = d ? d.x - 7 + (tx - (d.x - 7)) * t : tx, by = d ? d.y - 12 + (ty - (d.y - 12)) * t : ty;
      bx = Math.round(bx); by = Math.round(by);
      var lid = a > 0.72 ? ease(Math.min(1, (a - 0.72) / 0.08)) : 0;
      /* 中身（データの紙）：箱から上へ出てくる */
      if (lid > 0) {
        var up = ease(Math.min(1, (a - 0.76) / 0.16));
        var sx = bx + 1, sy = Math.round(by - 2 - up * 18);
        if (up > 0) {
          ctx.save();
          if (up > 0.8) { ctx.globalAlpha = 0.5 * (1 - Math.abs(Math.sin(now / 200)) * 0.5); ctx.fillStyle = '#ffe9a0';
            ctx.fillRect(sx - 4, sy - 4, 20, 22); ctx.globalAlpha = 1; }
          ctx.restore();
          px(sx - 1, sy - 1, 14, 16, '#0d1017');
          px(sx, sy, 12, 14, '#f4f1e4');
          px(sx, sy, 12, 1, '#ffffff');
          /* 小さな折れ線グラフ（＝データ） */
          ctx.save(); ctx.strokeStyle = '#2f6fbd'; ctx.lineWidth = 1.2; ctx.beginPath();
          ctx.moveTo(sx + 2, sy + 10); ctx.lineTo(sx + 5, sy + 6); ctx.lineTo(sx + 7, sy + 8); ctx.lineTo(sx + 10, sy + 3); ctx.stroke(); ctx.restore();
          px(sx + 2, sy + 12, 8, 1, '#9aa0ae');
          lastFxDrawn.push('item');
        }
      }
      px(bx - 1, by - 1, 16, 13, '#0d1017');
      px(bx, by, 14, 11, '#c8a06a');
      px(bx, by + 5, 14, 1, '#a37f4e');
      px(bx + 5, by, 4, 11, '#b08c58');
      if (lid > 0) {                                   // ふたが左右に開く
        var fl = Math.round(5 * lid);
        px(bx - fl, by - 2 - Math.round(2 * lid), 7, 2, '#e0bc86');
        px(bx + 7 + fl, by - 2 - Math.round(2 * lid), 7, 2, '#e0bc86');
        px(bx + 1, by + 1, 12, 3, '#6b5034');
      } else {
        px(bx, by, 14, 1, '#e0bc86');
        px(bx + 1, by + 7, 8, 3, '#f2f5fa');
      }
      lastFxDrawn.push('box');
    },

    /* まとめ: レシートが伸びる */
    batch: function (hx, hy, b, p, now) {
      var n = Math.min(14, Math.ceil(b.count * Math.min(1, p * 1.2)));
      var w = 40, h = 12 + n * 2;
      var x = hx - 12, y = hy - 8 - h;
      px(x - 1, y - 1, w + 2, h + 2, '#0d1017');
      px(x, y, w, h, '#f4f4ef');
      px(x, y, w, 1, '#ffffff');
      label(String(b.count), x + 2, y + 2, '#14161f', 6);
      for (var i = 0; i < n; i++) px(x + 3, y + 11 + i * 2, w - 6 - (i % 3) * 4, 1, '#8b8f99');
    },

    /* ④ 立会人がチェーンに載せた：許可証を立会所へ → 判 → ブロックが積まれる */
    settle: function (hx, hy, b, p, now) {
      /* ★ 2026-10-06: ④ を「確かめる」と「チェーンに載せる」の2つの動きに（利用者の要望）。
         ・店が許可証を立会所へ回す（ロボットは店の前で待つ）
         ・立会所の窓口の寄り絵（画面の上の窓）で、立会人が虫めがねで4つを確かめる：
             ① 署名が本物か ② 宛先と金額が値札どおりか ③ 財布に USDC が足りるか ④ 期限切れでないか
           1つずつ ✓ が付き、最後に判がドン
         ・許可証が USDC の硬貨に変わり、立会人が自分のガス代（灰色のひし形）を入れて燃やし、
           チェーンにブロックが1つ積まれる
         ・そこで初めて、硬貨が立会所から店へ飛ぶ
         ウォレット（チェーンの送金の記録）で、送金のしかたが transferWithAuthorization
         （x402 と同じ、署名で払う方式）と分からないときは、確かめる窓は出さない
         （立会人が確かめたかどうかは記録から言えないため）。 */
      var a = actP(b, p), f = facilOf();
      var mm = (b.lead && b.lead.meta) || {};
      var panelOK = viaFacilitator(mm);
      var shopBeat = (b.lead && b.lead.target) ? b : null;
      if (!shopBeat && lastBeats) {
        for (var j = lastBeats.indexOf(b) - 1; j >= 0; j--) {
          var pb = lastBeats[j];
          if (pb && pb.actor === b.actor && pb.kind === 'pay' && pb.lead && pb.lead.target) { shopBeat = pb; break; }
        }
      }
      var d2 = shopBeat ? doorOf(shopBeat) : null;
      var VW = W.view.cols * T, VH = W.view.rows * T;
      /* 店 → 立会所へ許可証が飛ぶ（立会所が画面の外なら、その方向へ）。
         ★ 2026-10-08: 署名で払う方式と分からないチェーンの送金では、許可証も立会人も描かない。
         その送金がチェーンに載った（ブロックが店の横に積まれる）ことだけを描く。 */
      if (!panelOK) {
        if (d2) {
          var dShop = { x: d2.x + 14, o: { w: 0 }, top: d2.y - 30 };   // 店の扉の右横（看板に重ならない）
          chainBeside(dShop, settledBeforeOf(b), a < SET.chain ? 0 : ease(Math.min(1, (a - SET.chain) / (SET.coin - SET.chain))));
          if (a >= SET.chain) lastFxDrawn.push('block');
        }
      } else if (a < SET.send) {
        var t0 = ease(a / SET.send);
        var sx0 = d2 ? d2.x - 6 : hx, sy0 = d2 ? d2.y - 22 : hy - 18;
        var ex0 = f ? f.x - 6 : sx0 - 200, ey0 = f ? f.y - 24 : sy0;
        paperAt(Math.round(sx0 + (ex0 - sx0) * t0), Math.round(sy0 + (ey0 - sy0) * t0 - Math.sin(t0 * Math.PI) * 16), true, 0, 1);
        lastFxDrawn.push('permit');
      }
      var settledBefore = 0;
      if (lastBeats) for (var i = 0; i < lastBeats.length && lastBeats[i] !== b; i++) if (lastBeats[i].kind === 'settle') settledBefore++;
      /* 立会所の窓口の寄り絵は、画面の下の「寄り絵」の欄に出す（renderCloseup）。街の絵は覆わない。
         ここ（街）では、立会所のランプが光り、許可証が飛び込み、最後に硬貨が店へ飛ぶだけ。 */
      if (panelOK) {
        if (f && a >= SET.send && a < SET.coin) {      // 立会所の窓口で何かしている（小さな光が点滅）
          if (Math.floor(now / 200) % 2) px(Math.round(f.x - 2), Math.round(f.y - 30), 4, 4, '#3ddc84');
          lastFxDrawn.push('facil-busy');
        }
      }
      /* チェーンに載ったら、硬貨が立会所から店へ（ここで初めてお金が店に動く）。
         署名で払う方式と分からない送金では、硬貨は③でもう店へ行っている（ここでは飛ばさない）。 */
      if (!panelOK && mm.tSource === 'chain' && a > SET.coin && d2) {
        var gx0 = Math.round(d2.x - 8), gy0 = Math.round(d2.y - 34), uu = ease((a - SET.coin) / (1 - SET.coin));
        if (uu > 0.3) {
          ctx.save(); ctx.globalAlpha = Math.min(1, (uu - 0.3) / 0.3);
          ctx.setLineDash && ctx.setLineDash([2, 2]);
          ctx.strokeStyle = '#f2f5fa'; ctx.lineWidth = 1.2; ctx.strokeRect(gx0 + 0.5, gy0 + 0.5, 16, 13);
          ctx.setLineDash && ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(13,16,23,.55)'; ctx.fillRect(gx0 + 1, gy0 + 1, 15, 12);
          ctx.restore();
          label('?', gx0 + 5, gy0 + 2, '#ffd35c', 8);
          lastFxDrawn.push('unknown-item');
        }
      }
      if (panelOK && a > SET.coin && d2) {
        var u = ease((a - SET.coin) / (1 - SET.coin));
        var sx = f ? f.x : d2.x - 200, sy = f ? Math.max(12, f.top - 6) : 20;
        var ex = d2.x, ey = Math.max(12, d2.y - 20);
        var cx2 = sx + (ex - sx) * u, cy2 = Math.max(8, sy + (ey - sy) * u - Math.sin(u * Math.PI) * 18);
        coinAt(Math.round(cx2), Math.round(cy2), 6, !isUsdcBeat(b));
        var am2 = amountText(b);
        if (am2) label(am2, Math.round(cx2) + 8, Math.round(cy2) - 3, '#1a5296', 6);
        lastFxDrawn.push('coin-to-shop');
        /* ★ 2026-10-05: ウォレットでは、代わりに何を受け取ったかは記録に無い＝「？」の箱 */
        if (mm.tSource === 'chain' && u > 0.6) {
          var gx = Math.round(d2.x - 8), gy = Math.round(d2.y - 34);
          ctx.save(); ctx.globalAlpha = Math.min(1, (u - 0.6) / 0.3);
          ctx.setLineDash && ctx.setLineDash([2, 2]);
          ctx.strokeStyle = '#f2f5fa'; ctx.lineWidth = 1.2; ctx.strokeRect(gx + 0.5, gy + 0.5, 16, 13);
          ctx.setLineDash && ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(13,16,23,.55)'; ctx.fillRect(gx + 1, gy + 1, 15, 12);
          ctx.restore();
          label('?', gx + 5, gy + 2, '#ffd35c', 8);
          lastFxDrawn.push('unknown-item');
        }
      }
    },

    /* 待機: 充電中の表示 */
    idle: function (hx, hy, b, p, now) {
      var bars = Math.floor(now / 400) % 4;
      bubble(hx - 4, hy - 16, 26, 11);
      for (var i = 0; i < 3; i++) {
        px(hx - 1 + i * 6, hy - 13, 4, 5, i < bars ? '#2fa86a' : '#c9ced9');
      }
    },

    /* 考えた：考えている雲（中に点が順に灯る）。文字は出さない */
    plan: function (hx, hy, b, p, now) {
      var rise = Math.round(Math.min(1, p * 1.4) * 6);
      var cx = hx + ROBOT_W * 0.5, cy = hy - 14 - rise;
      ctx.save(); ctx.fillStyle = '#0d1017';
      [[0, 0, 11], [-9, 3, 7], [9, 3, 7]].forEach(function (c) { ctx.beginPath(); ctx.arc(cx + c[0], cy + c[1], c[2] + 1, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = '#f2f5fa';
      [[0, 0, 11], [-9, 3, 7], [9, 3, 7]].forEach(function (c) { ctx.beginPath(); ctx.arc(cx + c[0], cy + c[1], c[2], 0, Math.PI * 2); ctx.fill(); });
      px(Math.round(cx - 4), Math.round(cy + 14), 3, 3, '#f2f5fa'); px(Math.round(cx - 6), Math.round(cy + 19), 2, 2, '#f2f5fa');
      var on = Math.floor(now / 300) % 4;
      for (var i = 0; i < 3; i++) px(Math.round(cx - 7 + i * 6), Math.round(cy), 3, 3, i < on ? '#5a6070' : '#c9ced9');
      ctx.restore();
      lastFxDrawn.push('think');
    },

    /* 依頼の投稿が立て続けに来た: メモが積み上がる（batch の非金銭版）。数だけ出す */
    planbatch: function (hx, hy, b, p, now) {
      var n = Math.min(14, Math.ceil(b.count * Math.min(1, p * 1.2)));
      var w = 40, h = 12 + n * 2;
      var x = hx - 12, y = hy - 8 - h;
      px(x - 1, y - 1, w + 2, h + 2, '#0d1017');
      px(x, y, w, h, '#f4f4ef');
      px(x, y, w, 1, '#ffffff');
      label(String(b.count), x + 2, y + 2, '#14161f', 6);
      for (var i = 0; i < n; i++) px(x + 3, y + 11 + i * 2, w - 6 - (i % 3) * 4, 1, '#8b8f99');
    }
  };
  /* actbatch も batch と同じ「積み上がる紙」の演出でよい（金額もドル
     記号も出していない絵なので、使い回しても嘘にならない）。 */
  OVERLAY.actbatch = OVERLAY.batch;

  /* ---------- 同じマスに複数ロボットが重なったときのずらし ----------
     中心 (0,0) が最初の入居者。残りは半径9pxの輪に均等に並べるので、
     中心からも・輪どうしでも常に9px離れる（8px以上、という要件に対して
     余裕を持たせてある）。7体目以降は輪を再利用する＝重なりが戻るが、
     この街の候補地（12マス）よりアクターが多いという、かなりの高密度時のみ。 */
  var NUDGE_RING = (function () {
    var pts = [[0, 0]];
    var n = 6, r = 9;
    for (var k = 0; k < n; k++) {
      var a = (k / n) * Math.PI * 2;
      pts.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]);
    }
    return pts;
  })();

  /** いま画面に登場しているロボットたちの、マス単位の居場所を求める。
      render() とテスト用フック（computeRobotScreenPositions）の両方が
      ここを通るので、「実際に描く場所」と「検証する場所」が食い違わない。 */
  /* focusActor が指定されているときは、その1体だけを描く（room.js の
     同名関数と同じ判断: 焦点を当てた画面に「他のロボット」は要らない。
     以前は薄く（alpha 0.25）残していたが、「1体だけ選んだのにまだ他が
     見える」という報告どおり、それでも clutter になる。候補の時点で
     絞るので、他の actor は最初から居ないことになる。 */
  /* ★ 2026-09-08: 絞り込みの説明書きは文字列（1体）だけでなく
     { job, actors } という形（依頼1件＝その依頼に出てくる面々）でも
     来る。街（x402 のログ）には依頼IDが無いので実際には actor 形しか
     来ないが、stage.js が同じ引数を両方へ流すので、ここでも同じ規則で
     受け取れるようにしておく（片方だけ古い意味のままにしない）。 */
  function focusHasActor(focus, actor) {
    if (focus == null) return true;
    if (typeof focus === 'string') return String(actor) === focus;
    if (focus.actors) return !!focus.actors[String(actor)];
    if (focus.actor != null) return String(actor) === String(focus.actor);
    return true;
  }

  function activeRobots(beat, beats, index2, p, focusActor) {
    if (!actorBeats) prepare(beats);
    var activeActor = beat.actor || 'agent';
    var robots = [];
    Object.keys(actorBeats).sort().forEach(function (actor) {
      if (!focusHasActor(focusActor, actor)) return;
      var j = lastBeatOf(actor, index2);
      if (j === -1) return;                 // まだ登場していない
      var b = beats[j];
      var route = b._route || [homeFor(actor)];
      var isActive = (j === index2 && actor === activeActor);
      var walked = isActive ? Math.min(1, p / WALK_UNTIL) : 1;
      var pos = AQ.path.posOn(route, walked);
      if (!isActive) pos.dir = 'down';       // 待機中は正面を向いて止まる
      var moving = isActive && route.length > 1 && walked < 1;
      robots.push({ actor: actor, beat: b, pos: pos, moving: moving, isActive: isActive });
    });
    return robots;
  }

  /** マス座標 → 画面ピクセル座標。同じマスに複数いたら NUDGE_RING でずらす。 */
  function layoutRobots(robots, cam) {
    var tileSlot = {};   // "gx,gy" → そのマスに何人目か
    return robots.map(function (r) {
      var tkey = Math.round(r.pos.x) + ',' + Math.round(r.pos.y);
      var slot = tileSlot[tkey] || 0;
      tileSlot[tkey] = slot + 1;
      var nudge = NUDGE_RING[slot % NUDGE_RING.length];
      return {
        actor: r.actor,
        r: r,
        tileKey: tkey,
        hx: Math.round((r.pos.x - cam.x) * T) + 2 + nudge[0],
        hy: Math.round((r.pos.y - cam.y) * T) + nudge[1]
      };
    });
  }

  /* ---------- エラー（応答なし）は寄りの画面 ---------- */
  function drawError(b, p, st, now) {
    var e = b.lead || {};
    var code = String(e.status || (e.meta && e.meta.code) || '502');
    var svc = serviceFor(e.target);

    px(0, 0, C.width, C.height, '#191d27');
    // 建物の正面（寄り）
    var bx = 40, by = 18, bw = C.width - 80, bh = 118;
    px(bx, by, bw, bh, '#787f8f');
    px(bx, by, bw, 10, '#454c5c');
    px(bx, by, 1, bh, '#8f96a6');
    px(bx + bw - 1, by, 1, bh, '#5f6675');
    px(bx + 6, by + 14, bw - 12, 12, '#161a24');
    label(svc && (svc.liveLabel || svc.label) ? (svc.liveLabel || svc.label) : 'endpoint', bx + 9, by + 17, '#9fe8ff', 6);

    // 閉まったシャッター
    var sx = bx + 24, sy = by + 34, sw = bw - 48, sh = 64;
    px(sx - 2, sy - 2, sw + 4, sh + 4, '#2a2e3a');
    for (var i = 0; i < sh; i += 4) {
      px(sx, sy + i, sw, 3, i % 8 ? '#6a7180' : '#5a6170');
    }
    px(sx, sy + sh - 4, sw, 4, '#3a404d');

    // 貼り紙
    var nx = sx + Math.floor(sw / 2) - 30, ny = sy + 18;
    px(nx - 1, ny - 1, 62, 26, '#0d1017');
    px(nx, ny, 60, 24, '#f2f5fa');
    label(code, nx + 4, ny + 3, '#c02b1c', 8);
    label('NO ANSWER', nx + 4, ny + 15, '#5a6070', 6);

    // 赤ランプ
    var on = (now % 900) < 620;
    px(bx + bw - 20, by + 34, 8, 8, on ? '#e8483a' : '#4a2422');
    if (on) px(bx + bw - 19, by + 35, 6, 3, '#ff8a7a');

    // ロボットは手前で待っている（背中）
    var shake = (p < 0.4 && (Math.floor(now / 70) % 2)) ? 1 : 0;
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.fillRect(C.width / 2 - 6, C.height - 22, 14, 3);
    AQ.sprites.drawFigure(ctx, spriteFor(e.actor),
      Math.round(C.width / 2 - ROBOT_W / 2 + shake), C.height - ROBOT_H - 22,
      ROBOT_W, ROBOT_H, 'up', paletteFor(e.actor), 'sad');
    lastMood = 'sad';
  }

  /* =============================================================
     ★ 2026-10-06 寄り絵（画面の下の欄）
     利用者「画面の下の余白を活用する」「建物が5つぐらいあったと思うが、立会所と同じ要領で
     アニメーションを付けたら」。ロボットが用事をしている建物の「中の様子」を、街の絵の下の
     欄に映す（街の絵は覆わない）。
       お店（api / data / gpu / technocore） … 店主が注文の紙を受け取る → 値札（402）を出す
                                               → 届いた許可証と硬貨を管で立会所へ送る
                                               → 確定の合図が管で戻る → 棚から中身を出して箱で渡す
       立会所（④）                           … 4つを確かめる → 判 → ガス代 → ブロック
       OPERATOR（拠点）                       … 始動：係の人がボタンを押し、財布を渡して送り出す
                                               終了：戻ってきて充電、休む
       考える（plan）                         … ロボットの頭の中（歯車が回り、ひらめく）
       待機（idle）                           … 充電スタンド
     どれも、そのコマが本当にログにあるときだけ出る。ウォレット（チェーンの送金の記録）では、
     お店とのやりとり（注文・値札・中身）は記録に無いので、お店の中は描かない。
     絵の中の文字は、看板（建物の名前）と数字だけ。
     ============================================================= */
  var lastCloseFx = [], lastCloseScene = null, closeLW = 300;
  var CH = 120;                                        // 寄り絵の論理的な高さ（幅は欄の縦横比で決まる）
  var CROP_Y0 = 22, CROP_H = 90;                       // 立会所以外は y 22〜112 を映す（大きく見せる）
  function cuWall(LW, wall, trim) {
    px(0, 0, LW, 96, wall || '#2a2f3d');
    px(0, 64, LW, 32, trim || '#323848');
    px(0, 64, LW, 1, '#454c5e');
    px(0, 96, LW, 24, '#4a3f36');
    for (var x = 0; x < LW; x += 24) px(x, 96, 1, 24, '#3b322b');
    px(0, 96, LW, 1, '#6a5a4c');
  }
  function cuSign(text, x, y) {
    ctx.font = '7px "Press Start 2P", monospace';
    var w = Math.ceil(ctx.measureText(text).width) + 10;
    px(x - 1, y - 1, w + 2, 13, '#0d1017'); px(x, y, w, 11, '#161a24');
    ctx.fillStyle = '#9fe8ff'; ctx.textBaseline = 'top'; ctx.fillText(text, x + 5, y + 2);
  }
  /** 人（店主・係の人）。apron＝前掛けの色、cap＝帽子の色。armsUp 0..1 で腕を上げる。 */
  function cuPerson(x, y, o, now) {
    o = o || {};
    var bob = o.bob ? Math.round(Math.sin(now / 300) * 1) : 0;
    y += bob;
    px(x + 3, y, 14, 13, '#e8c9a0');                   // 顔
    px(x + 2, y - 3, 16, 5, o.cap || '#3a2f28');        // 髪／帽子
    if (o.cap) px(x, y + 1, 20, 2, o.cap);
    var blink = Math.floor(now / 2400) % 12 === 0;
    px(x + 7, y + 6, 2, blink ? 1 : 2, '#14161f'); px(x + 12, y + 6, 2, blink ? 1 : 2, '#14161f');
    if (o.smile) { px(x + 8, y + 10, 5, 1, '#8a4a3a'); px(x + 7, y + 9, 1, 1, '#8a4a3a'); px(x + 13, y + 9, 1, 1, '#8a4a3a'); }
    else if (o.frown) { px(x + 8, y + 10, 5, 1, '#8a4a3a'); px(x + 7, y + 11, 1, 1, '#8a4a3a'); px(x + 13, y + 11, 1, 1, '#8a4a3a'); }
    px(x + 1, y + 13, 18, 22, o.shirt || '#3d6fb0');    // 体
    px(x + 4, y + 15, 12, 20, o.apron || '#e8e2d6');    // 前掛け
    var ar = o.armsUp || 0;
    px(x - 3, y + 15 - Math.round(ar * 8), 4, 12, o.shirt || '#3d6fb0');
    px(x + 19, y + 15 - Math.round(ar * 8), 4, 12, o.shirt || '#3d6fb0');
    if (o.cross) { px(x + 2, y + 22, 16, 4, o.shirt || '#3d6fb0'); px(x + 4, y + 21, 3, 3, '#e8c9a0'); px(x + 13, y + 21, 3, 3, '#e8c9a0'); }
  }
  function cuCounter(x, y, w) { px(x, y, w, 8, '#7a5c44'); px(x, y, w, 2, '#a07a5a'); px(x, y + 8, w, 26, '#5e4634'); px(x + 4, y + 12, w - 8, 1, '#4a3628'); }
  function cuDoor(x, y, open, lock) {                  // 店の内側から見た扉（左の壁）
    px(x - 2, y - 2, 34, 66, '#1c2030'); px(x, y, 30, 62, open > 0 ? '#ffe9a0' : '#4a5468');
    if (open > 0) px(x, y, Math.round(30 * (1 - open)), 62, '#4a5468');
    px(x + 4, y + 30, 22, 3, '#0d1017');                // 差し入れ口
    px(x + 24, y + 34, 3, 3, '#c9ced9');                // 取っ手
    if (lock) { px(x + 10, y + 40, 10, 9, '#e0b84a'); ctx.save(); ctx.strokeStyle = '#c9ced9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + 15, y + 40, 3.5, Math.PI, 0); ctx.stroke(); ctx.restore(); px(x + 14, y + 43, 2, 3, '#0d1017'); }
  }
  function cuShelf(x, y) {
    px(x, y, 70, 48, '#3a3028'); for (var r = 0; r < 2; r++) px(x, y + 18 + r * 20, 70, 3, '#6a5340');
    for (var k = 0; k < 6; k++) {                       // データの紙（グラフ）
      var sx = x + 6 + (k % 3) * 22, sy = y + 3 + Math.floor(k / 3) * 20;
      px(sx, sy, 14, 15, '#f4f1e4'); ctx.save(); ctx.strokeStyle = '#2f6fbd'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(sx + 2, sy + 11); ctx.lineTo(sx + 5, sy + 7); ctx.lineTo(sx + 8, sy + 9); ctx.lineTo(sx + 12, sy + 3); ctx.stroke(); ctx.restore();
    }
  }
  function cuTube(x, y, glow) {                        // 立会所へつながる管（上で右へ曲がる）
    px(x, y, 10, 40, '#5a6a7a'); px(x + 2, y, 3, 40, '#8aa0b4');
    px(x, y - 10, 60, 10, '#5a6a7a'); px(x, y - 8, 60, 3, '#8aa0b4');
    px(x - 3, y + 38, 16, 6, '#3c4a58');                 // 口
    /* 先にいる立会人の小さな顔（帽子・緑の制服）＝この管は立会所へ */
    var fx = x + 62, fy = y - 18;
    px(fx - 2, fy - 2, 22, 24, glow ? '#3ddc84' : '#1c2030');
    px(fx, fy, 18, 20, '#0d1119'); px(fx + 4, fy + 3, 10, 8, '#e8c9a0'); px(fx + 3, fy + 1, 12, 3, '#2f3646'); px(fx + 4, fy + 11, 10, 8, '#2f7f6a');
  }
  function cuBox(x, y) { px(x - 1, y - 1, 22, 17, '#0d1017'); px(x, y, 20, 15, '#c8a06a'); px(x + 8, y, 4, 15, '#b08c58'); px(x, y + 6, 20, 1, '#a37f4e'); }
  function cuItem(x, y) { px(x - 1, y - 1, 16, 19, '#0d1017'); px(x, y, 14, 17, '#f4f1e4'); ctx.save(); ctx.strokeStyle = '#2f6fbd'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x + 2, y + 13); ctx.lineTo(x + 5, y + 8); ctx.lineTo(x + 8, y + 10); ctx.lineTo(x + 12, y + 3); ctx.stroke(); ctx.restore(); }
  function lerp(a0, a1, t) { return a0 + (a1 - a0) * t; }

  /** お店の中。kind＝travel/require/error/pay/receive/batch。a＝着いてからの進み。 */
  function cuShop(b, a, now, LW, svc, chainSrc) {
    cuWall(LW, '#2c3140', '#343a4c');
    var X = Math.round((LW - 320) / 2);                 // 中身は 320 の幅に収める
    cuSign(svc && (svc.liveLabel || svc.label) ? (svc.liveLabel || svc.label) : '?', X + 48, 25);
    var doorX = X + 8, doorY = 34;
    var k = b.kind, is402 = k === 'error' && String((b.lead && b.lead.status) || '') === '402';
    var open = 0, lock = is402;
    if (k === 'receive') open = (a > 0.16 && a < 0.5) ? ease(Math.min(1, (a - 0.16) / 0.06)) * (a > 0.44 ? 1 - (a - 0.44) / 0.06 : 1) : 0;
    cuDoor(doorX, doorY, open, lock);
    var counterX = X + 70, counterW = 130;
    var keepX = X + 118, keepY = 48;
    var o = { apron: '#e8e2d6', shirt: '#3d6fb0', cap: '#2a2a3a', bob: true };
    if (k === 'require') o.armsUp = a < 0.35 ? 1 : 0;
    if (is402) { o.cross = true; o.frown = true; }
    if (k === 'receive' && a > 0.25) o.smile = true;
    cuShelf(X + 150, 30);
    cuTube(X + 236, 46, k === 'settle' || k === 'receive' && a < 0.1);
    cuPerson(keepX, keepY, o, now);
    cuCounter(counterX, 80, counterW);
    var am = amountText(b);
    if (k === 'travel') {                              // ノック（扉が揺れる）→ 注文の紙が差し入れ口から → 店主が読む（街の絵と同じ時間割）
      if ((a > 0.04 && a < 0.14) || (a > 0.16 && a < 0.26)) {
        ctx.save(); ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 1.5;
        [[-6, 20], [-6, 30], [-6, 40]].forEach(function (d) { ctx.beginPath(); ctx.moveTo(doorX + 32, doorY + d[1]); ctx.lineTo(doorX + 38, doorY + d[1] - 3); ctx.stroke(); });
        ctx.restore(); lastFxDrawn.push('cu-knock');
      }
      if (a > 0.6) {
        var t = ease(Math.min(1, (a - 0.6) / 0.25));
        var sx = lerp(doorX + 10, keepX - 6, t), sy = lerp(doorY + 28, keepY + 18, t);
        if (a > 0.85) { sx = keepX + 2 + Math.sin(now / 400) * 1; sy = keepY + 14; }
        paperAt(Math.round(sx), Math.round(sy), false, 0, 0);
        lastFxDrawn.push('cu-order');
      }
      if (a > 0.88) {                                  // 読みながら、首をかしげる（目線が紙へ）
        ctx.save(); ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(keepX + 10, keepY - 10, 4, Math.PI * 1.1, Math.PI * 1.9 + Math.sin(now / 300) * 0.2); ctx.stroke(); ctx.restore();
      }
    } else if (k === 'require') {                      // 値札（402・金額）を書いて差し出す
      var tg = ease(Math.min(1, Math.max(0, a / 0.35)));
      var tx = lerp(keepX - 10, doorX + 6, tg), ty = lerp(keepY + 4, doorY + 22, tg);
      px(Math.round(tx) - 1, Math.round(ty) - 1, 38, 22, '#0d1017'); px(Math.round(tx), Math.round(ty), 36, 20, '#ffe08a');
      label('402', Math.round(tx) + 9, Math.round(ty) + 2, '#c02b1c', 6); if (am) label(am, Math.round(tx) + 3, Math.round(ty) + 11, '#14161f', 5);
      lastFxDrawn.push('cu-tag');
    } else if (is402) {                                // 腕を組み、扉に錠前。値札をもう一度見せる
      px(keepX - 30, keepY + 8, 36, 20, '#ffe08a'); label('402', keepX - 21, keepY + 10, '#c02b1c', 6); if (am) label(am, keepX - 27, keepY + 19, '#14161f', 5);
      lastFxDrawn.push('cu-refuse');
    } else if (k === 'pay' || k === 'settle') {        // ③ 外で署名しているあいだ待つ → 許可証と硬貨が差し入れ口から届く
      /* ④ の始め：店主が許可証と硬貨を管に入れて立会所へ送る（街の絵で許可証が店から飛ぶのと同じ時） */
      var arrive = k === 'pay' ? (a >= PAY.fly ? ease(Math.min(1, (a - PAY.fly) / (1 - PAY.fly))) : -1) : 1;
      var send = k === 'settle' ? ease(Math.min(1, a / SET.send)) : 0;
      if (arrive < 0) {                                // 待つ（指で台をとんとん）
        if (Math.floor(now / 250) % 2) px(keepX + 22, keepY + 30, 3, 2, '#e8c9a0');
        lastFxDrawn.push('cu-wait');
      } else {
        var ppx = lerp(doorX + 8, keepX - 4, arrive), ppy = lerp(doorY + 26, keepY + 16, arrive);
        if (send > 0) { ppx = lerp(keepX - 4, X + 236, send < 0.5 ? send * 2 : 1); ppy = send < 0.5 ? lerp(keepY + 16, 84, send * 2) : lerp(84, 40, (send - 0.5) * 2); }
        if (send < 0.98) {
          paperAt(Math.round(ppx), Math.round(ppy), true, 0, 1);
          coinAt(Math.round(ppx) + 17, Math.round(ppy) + 7, 5, !isUsdcBeat(b));
        }
        lastFxDrawn.push(send > 0 ? 'cu-tube' : 'cu-permit');
      }
    } else if (k === 'receive') {                      // 確定の合図が管で戻る → 棚から中身 → 箱 → 扉から渡す
      if (a < 0.1) {                                   // 緑の ✓ のカプセルが管から（確定の知らせ）
        var cy = lerp(40, 86, ease(a / 0.1));
        px(X + 235, Math.round(cy), 12, 10, '#1a7a4a'); checkMarkSmall(X + 236, Math.round(cy) + 1);
        lastFxDrawn.push('cu-confirm');
      }
      /* 棚から中身 → 箱に入れる → 扉から渡す（街の絵で扉が開き、箱が出てくるのと同じ時） */
      var it = a > 0.06 ? ease(Math.min(1, (a - 0.06) / 0.08)) : 0;
      var bx = keepX - 26, by = 66;
      if (a > 0.06 && a < 0.16) { cuItem(Math.round(lerp(X + 178, bx + 4, it)), Math.round(lerp(34, by - 6, it))); lastFxDrawn.push('cu-item'); }
      if (a >= 0.14 && a < 0.42) {
        var out = a > 0.2 ? ease(Math.min(1, (a - 0.2) / 0.2)) : 0;
        var bxx = Math.round(lerp(bx, doorX + 4, out)), byy = Math.round(lerp(by, doorY + 40, out));
        if (a < 0.2) cuItem(bxx + 3, byy - 8 + Math.round((a - 0.14) / 0.06 * 8));
        cuBox(bxx, byy);
        lastFxDrawn.push('cu-box');
      }
      if (a >= 0.42) { o.armsUp = 0; lastFxDrawn.push('cu-thanks'); }
    } else if (/batch/.test(k)) {
      var n = Math.min(10, Math.ceil((b.count || 1) * Math.min(1, a * 1.2)));
      for (var i = 0; i < n; i++) paperAt(keepX - 34 + (i % 5) * 3, keepY + 26 - i * 2, true, 0, 1);
      label(String(b.count || 1), keepX - 40, keepY + 6, '#f2f5fa', 6);
      lastFxDrawn.push('cu-batch');
    }
    return 'shop';
  }
  function checkMarkSmall(x, y) { ctx.save(); ctx.strokeStyle = '#b6ffd6'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + 2, y + 4); ctx.lineTo(x + 4, y + 7); ctx.lineTo(x + 9, y + 1); ctx.stroke(); ctx.restore(); }

  /** OPERATOR（拠点）：始動・終了。 */
  function cuOperator(b, a, now, LW, st, sm, pal) {
    cuWall(LW, '#273040', '#2f394c');
    var X = Math.round((LW - 320) / 2);
    cuSign('OPERATOR', X + 4, 25);
    /* 机とモニター */
    px(X + 40, 70, 80, 8, '#7a5c44'); px(X + 44, 78, 6, 18, '#5e4634'); px(X + 110, 78, 6, 18, '#5e4634');
    px(X + 56, 44, 40, 26, '#0d1017'); px(X + 58, 46, 36, 20, '#1e6b45'); px(X + 72, 66, 8, 4, '#3a3f4a');
    var ph = phaseNow || {};
    var start = b.kind === 'start';
    var o = { apron: '#cfd6e6', shirt: '#5a4a8a', cap: null, bob: true, smile: true };
    if (start && ph.boot != null && ph.boot < 0.4) o.armsUp = 1;   // ボタンを押す
    cuPerson(X + 14, 46, o, now);
    /* 大きなボタン */
    var pressed = start && ph.boot != null && ph.boot < 0.4;
    px(X + 98, 62, 14, 8, '#3a3f4a'); px(X + 100, pressed ? 60 : 57, 10, 5, '#c02b1c');
    /* ロボット（充電台の上）。始動の明るさに合わせる */
    var rx = X + 170, ry = 40;
    if (start && ph.boot == null) rx += Math.round(ease(Math.min(1, a / 0.9)) * 140);   // 出発（右へ）
    px(X + 160, 86, 56, 10, '#3a3f4a'); px(X + 162, 86, 52, 2, '#3ddc84');
    var bright = (start && ph.boot != null) ? (ph.boot < 0.36 ? 0.3 : Math.min(1, 0.3 + (ph.boot - 0.36) / 0.24 * 0.7)) : (b.kind === 'end' ? 0.55 : 1);
    if (bright < 0.999) drawRobotDim(rx, ry, 'down', pal, sm, bright); else AQ.sprites.drawFigure(ctx, sm, rx, ry, ROBOT_W, ROBOT_H, 'down', pal);
    if (b.kind === 'end') { pixelZ(rx + 30, ry - 6 - Math.round((now / 60) % 10), 6, '#cfd6e6'); lastFxDrawn.push('cu-rest'); }
    /* 財布を渡す（予算がログに書かれているときだけ。数字はその額） */
    if (start && st && st.hasBudget && (ph.boot == null || ph.boot > 0.6)) {
      var gt = ph.boot != null ? ease((ph.boot - 0.6) / 0.4) : 1;
      var gx = lerp(X + 36, rx - 8, gt), gy = lerp(62, ry + 30, gt);
      gamaguchi(gx, gy, 1.2, 0, 0);
      var bt = Number(st.usdc).toFixed(3);
      px(Math.round(gx) - 16, Math.round(gy) - 30, 34, 9, '#f2f5fa'); label(bt, Math.round(gx) - 14, Math.round(gy) - 29, '#1a5296', 5);
      lastFxDrawn.push('cu-budget');
    }
    lastFxDrawn.push(start ? 'cu-start' : 'cu-end');
    return 'operator';
  }
  /** 考える：ロボットの頭の中（歯車が回り、最後にひらめく）。 */
  function cuMind(b, a, now, LW, sm, pal) {
    px(0, 0, LW, CH, '#141a2a');
    for (var i = 0; i < 40; i++) px((i * 53) % LW, (i * 31) % CH, 1, 1, '#2a3450');
    var X = Math.round(LW / 2);
    AQ.sprites.drawFigure(ctx, sm, X - 110, 40, ROBOT_W * 1.4, ROBOT_H * 1.4, 'down', pal, 'determined');
    /* 雲の中で歯車が回る */
    ctx.save(); ctx.fillStyle = '#f2f5fa';
    [[0, 0, 30], [-26, 10, 20], [26, 10, 20], [0, 18, 22]].forEach(function (c) { ctx.beginPath(); ctx.arc(X + c[0], 46 + c[1], c[2], 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
    gear(X - 12, 52, 10, now / 400, '#5a6070'); gear(X + 10, 44, 7, -now / 300, '#8f96a6');
    if (a > 0.7) { ctx.save(); ctx.globalAlpha = Math.min(1, (a - 0.7) / 0.1); ctx.fillStyle = '#ffd35c'; ctx.beginPath(); ctx.arc(X + 30, 22, 8, 0, Math.PI * 2); ctx.fill(); px(X + 27, 30, 6, 4, '#c9ced9'); ctx.restore(); lastFxDrawn.push('cu-idea'); }
    lastFxDrawn.push('cu-think');
    return 'mind';
  }
  function gear(x, y, r, ang, col) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = col;
    for (var k = 0; k < 8; k++) { ctx.rotate(Math.PI / 4); ctx.fillRect(-2, -r - 3, 4, 5); }
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#f2f5fa'; ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  /** 待機：充電スタンド。 */
  function cuCharge(b, a, now, LW, sm, pal) {
    cuWall(LW, '#22303a', '#2a3a44');
    var X = Math.round(LW / 2);
    AQ.sprites.drawFigure(ctx, sm, X - 60, 46, ROBOT_W, ROBOT_H, 'down', pal);
    px(X - 10, 50, 26, 40, '#3a3f4a'); px(X - 6, 56, 18, 28, '#0d1017');
    var lv = Math.floor(now / 350) % 5;
    for (var i = 0; i < 4; i++) px(X - 4, 78 - i * 7, 14, 5, i < lv ? '#3ddc84' : '#1c2230');
    lastFxDrawn.push('cu-charge');
    return 'charge';
  }
  /** ウォレット（チェーンの送金の記録）の支払い：ロボットのがま口から硬貨（お店とのやりとりは描かない）。 */
  function cuWalletPay(b, a, now, LW, sm, pal) {
    cuWall(LW, '#1e2636', '#262f42');
    var X = Math.round(LW / 2) - 80;
    AQ.sprites.drawFigure(ctx, sm, X, 40, ROBOT_W, ROBOT_H, 'down', pal, 'determined');
    var open = a < 0.15 ? ease(a / 0.15) : (a < 0.6 ? 1 : 1 - ease(Math.min(1, (a - 0.6) / 0.1)));
    gamaguchi(X + 70, 92, 2.2, open, 0);
    if (a > 0.15) { var t = ease(Math.min(1, (a - 0.15) / 0.4)); coinAt(X + 70 + t * 90, 60 - t * 20, 8, !isUsdcBeat(b)); var am = amountText(b); if (am) label('-' + am, X + 80 + t * 90, 30 - t * 20, '#ffb4a8', 6); lastFxDrawn.push('cu-coin'); }
    lastFxDrawn.push('cu-walletpay');
    return 'walletpay';
  }

  /** 立会人（facilitator）を通した支払いだと言えるか。x402 のログ（お店とのやりとりの
      記録）なら言える。チェーンの送金の記録だけのときは、送金のしかたが
      transferWithAuthorization（署名で払う x402 と同じ方式）と分かるときだけ。 */
  function viaFacilitator(mm) {
    mm = mm || {};
    return !(mm.tSource === 'chain' && mm.method !== 'transferWithAuthorization');
  }

  function renderCloseup(c2, beat, p, st, now) {
    lastCloseScene = null;
    if (!c2 || !c2.getContext || !beat) return null;
    var cw = c2.clientWidth || 300, chh = c2.clientHeight || 120;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    var needW = Math.max(1, Math.round(cw * dpr)), needH = Math.max(1, Math.round(chh * dpr));
    if (c2.width !== needW || c2.height !== needH) { c2.width = needW; c2.height = needH; }
    var c2x = c2.getContext('2d');
    /* 立会所の窓（高さ 118）以外は、上下を少し切り落として大きく映す（y 22〜112 の 90 だけ） */
    var mm0 = (beat.lead && beat.lead.meta) || {};
    var full = beat.kind === 'settle' && !(mm0.tSource !== 'chain' && actP(beat, p) < SET.send && beat._shopTarget);
    var Y0 = full ? 0 : CROP_Y0, VHc = full ? CH : CROP_H;
    var k = c2.height / VHc, LW = c2.width / k;
    /* ★ 2026-10-07: 寄り絵の枠を右の小さな欄に移した（利用者「説明の文と寄り絵を
       入れ替えて」）。枠の横幅が足りないと、場面の端（お店の店主・ロボット）が
       切れてしまう。場面ごとに要る横幅（お店 320・それ以外 250）に足りなければ、
       絵ぜんたいを縮めて上下の真ん中に置く（切らない）。 */
    var mm1 = mm0, needW = 250;
    if (!(mm1.tSource === 'chain') && (beat.kind === 'travel' || beat.kind === 'require' || beat.kind === 'pay' ||
        beat.kind === 'receive' || beat.kind === 'error' || /batch/.test(beat.kind) ||
        beat.kind === 'start' || beat.kind === 'end' ||      // 係の人の机（cuOperator）も 320 の幅
        (beat.kind === 'settle' && actP(beat, p) < SET.send && beat._shopTarget))) needW = 320;
    var padY = 0;
    if (LW < needW) {
      k = c2.width / needW; LW = needW;
      padY = Math.max(0, (c2.height - VHc * k) / 2);
    }
    closeLW = LW;
    var savedCtx = ctx, savedFx = lastFxDrawn, savedLbl = lastLabelsDrawn, savedCoin = lastCoinPx;
    ctx = c2x; lastFxDrawn = []; lastLabelsDrawn = [];
    var sceneName = null;
    try {
      if (padY > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, c2.width, c2.height);
      }
      ctx.setTransform(k, 0, 0, k, 0, -Y0 * k + padY);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, Y0, LW, VHc);
      var a = actP(beat, p), kind = beat.kind;
      var mm = (beat.lead && beat.lead.meta) || {};
      var chainSrc = mm.tSource === 'chain';
      var pal = paletteFor(beat.actor), sm = spriteFor(beat.actor);
      var is402 = kind === 'error' && String((beat.lead && beat.lead.status) || '') === '402';
      if (kind === 'settle' && !chainSrc && a < SET.send && beat._shopTarget) {
        /* ④ の始め：お店の中で、店主が許可証と硬貨を管に入れて立会所へ送る */
        sceneName = cuShop(beat, a, now, LW, serviceFor(beat._shopTarget), chainSrc);
      } else if (kind === 'settle') {
        var panelOK = viaFacilitator(mm);
        if (panelOK) {
          cuWall(LW, '#20303a', '#26383f');
          var sc = Math.min(1, (CH - 2) / 118);
          var settledBefore = 0;
          if (lastBeats) for (var i = 0; i < lastBeats.length && lastBeats[i] !== beat; i++) if (lastBeats[i].kind === 'settle') settledBefore++;
          cuSign(AQ.i18n ? AQ.i18n.t('scene.facilitator') : 'FACILITATOR', Math.round((LW - 176 * sc) / 2) - 150 > 4 ? Math.round((LW - 176 * sc) / 2) - 150 : 4, 4);
          drawFacilPanel(beat, a, now, settledBefore, 0, { ox: Math.round((LW - 176 * sc) / 2), oy: 1, sc: sc });
          sceneName = 'facilitator';
        } else {
          sceneName = cuWalletPay(beat, Math.min(1, a + 0.6), now, LW, sm, pal);
        }
      } else if (chainSrc && kind === 'pay') {
        sceneName = cuWalletPay(beat, a, now, LW, sm, pal);
      } else if (!chainSrc && (kind === 'travel' || kind === 'require' || kind === 'pay' || kind === 'receive' || is402 || /batch/.test(kind))) {
        var t = beat.lead && beat.lead.target;
        sceneName = cuShop(beat, a, now, LW, t ? serviceFor(t) : null, chainSrc);
      } else if ((kind === 'start' || kind === 'end') && chainSrc) {
        /* ウォレットでは、誰が動かしているか（係の人・ボタン・予算）は記録に無い＝ロボットだけ */
        cuWall(LW, '#1e2636', '#262f42');
        var rxx = Math.round(LW / 2) - 18, ph2 = phaseNow || {};
        var br = (kind === 'start' && ph2.boot != null) ? (ph2.boot < 0.36 ? 0.3 : Math.min(1, 0.3 + (ph2.boot - 0.36) / 0.24 * 0.7)) : (kind === 'end' ? 0.55 : 1);
        if (br < 0.999) drawRobotDim(rxx, 40, 'down', pal, sm, br); else AQ.sprites.drawFigure(ctx, sm, rxx, 40, ROBOT_W, ROBOT_H, 'down', pal);
        if (kind === 'end') pixelZ(rxx + 30, 34 - Math.round((now / 60) % 10), 6, '#cfd6e6');
        lastFxDrawn.push('cu-robot');
        sceneName = 'robot';
      } else if (kind === 'start' || kind === 'end') {
        sceneName = cuOperator(beat, a, now, LW, st, sm, pal);
      } else if (kind === 'plan') {
        sceneName = cuMind(beat, a, now, LW, sm, pal);
      } else if (kind === 'idle') {
        sceneName = cuCharge(beat, a, now, LW, sm, pal);
      } else {
        px(0, 0, LW, CH, '#0d1119');
        sceneName = 'none';
      }
    } finally {
      lastCloseFx = lastFxDrawn;
      ctx = savedCtx; lastFxDrawn = savedFx; lastLabelsDrawn = savedLbl; lastCoinPx = savedCoin;
    }
    lastCloseScene = sceneName;
    return sceneName;
  }

  /* ---------- 公開API ---------- */
  AQ.scene = {
    viaFacilitator: viaFacilitator,
    init: function (canvas) {
      C = canvas; ctx = canvas.getContext('2d');
      cfg = AQ.config; S = AQ.sprites; W = AQ.world; T = W.tile;
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
      AQ.tiles.use(ctx);
      AQ.props.use(ctx, T);
      byId = null;
      actorBeats = null;
      actorHome = {};
      actorIdle = {};
      tintCache = {};
      spriteCache = {};
      camState = null; camLastNow = -1;
      AQ.path.reset();
    },

    prepare: function (beats) { camState = null; prepare(beats || []); },

    /** focusActor（task E）: 指定すると、その actor 以外のロボットを
        薄く描く。街の建物・経路・その他ロボットの最終位置はいつも
        どおり全部描く（focus はレンダラの外の再生対象を絞るだけで、
        render() 自体は今までと同じ「コマ番号→絵」の純粋関数）。 */
    render: function (beat, p, st, now, beats, index2, focusActor) {
      if (!ctx || !beat) return;

      beats = beats || [beat];
      index2 = index2 || 0;
      /* ★ 2026-09-14 重大な修正: ここで焦点を String() に潰していた。
         焦点は「1体のDID文字列」から { actor } / { job, actors } という
         説明書きの形に変わっているので、String({actor:'agent'}) は
         "[object Object]" になり、focusHasActor が誰にも一致しなくなる
         ＝街の絵ではロボットが1体も描かれなくなっていた。
         利用者の報告「肝心のエージェントがどこにいるかわかりません」の
         正体はこれ。focusHasActor は文字列・オブジェクト・null の
         どれも扱えるので、文字列のときだけ String() を通す。 */
      if (focusActor != null && typeof focusActor !== 'object') focusActor = String(focusActor);

      /* 402 は「店が閉まっていた」ではない。シャッターの寄り絵（drawError）は
         応答が無かったとき用なので、402 のときは普通の街の絵のまま
         ——店の前に立っているのに中身をもらえていない——を描く。 */
      var errCode = String((beat.lead && beat.lead.status) || '');
      if (beat.kind === 'error' && errCode !== '402') { drawError(beat, p, st, now); return; }

      if (!actorBeats) prepare(beats);

      /* いま画面に登場しているエージェントごとの居場所を先に求める */
      var robots = activeRobots(beat, beats, index2, p, focusActor);
      var activePos = null;
      robots.forEach(function (r) { if (r.isActive) activePos = r.pos; });
      if (!activePos) activePos = { x: homeFor(beat.actor)[0], y: homeFor(beat.actor)[1], dir: 'down' };

      var cam = camera(activePos.x, activePos.y, now);
      lastCam = cam;
      lastBeats = beats;
      lastLabelsDrawn = []; lastFxDrawn = []; lastMood = null; lastCoinPx = null; lastPhaseDrawn = null; lastPanelDrawn = null;
      var placed = layoutRobots(robots, cam);
      lastNumberOf = numberOfFor(beats);      // 名札の #N はログ全体での登場順

      /* 見せ場でカメラが寄る：寄る中心は、ロボットと相手（扉／立会所）の間 */
      var activeMovingZ = robots.some(function (r) { return r.isActive && r.moving; });
      var zoom = zoomFor(beat, p, activeMovingZ);
      var zoomed = zoom > 1.001 && typeof ctx.translate === 'function';
      lastZoom = { z: zoomed ? zoom : 1, x: 0, y: 0 };
      if (zoomed) {
        var ap = null;
        placed.forEach(function (pl) { if (pl.r.isActive) ap = pl; });
        /* 寄っても、ロボット（財布・頭上の許可証・名札ごと）と相手（扉と値札／立会所と
           ブロック）が両方とも画面に収まるように、寄る中心と倍率を決める。 */
        var VW = W.view.cols * T, VH = W.view.rows * T, M = 6;
        var bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
        var addBox = function (x0, y0, x1, y1) { bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, x1); by1 = Math.max(by1, y1); };
        if (ap) addBox(ap.hx - (beat.kind === 'pay' ? 62 : 18), ap.hy - 30, ap.hx + ROBOT_W + 4, ap.hy + ROBOT_H + 14);
        var tg = (beat.kind === 'settle') ? facilOf() : doorOf(beat);
        if (tg && tg.x > -40 && tg.x < VW + 40) {
          if (beat.kind === 'settle') addBox(tg.x - 44, (tg.top != null ? tg.top : tg.y) - 46, tg.x + 44, tg.y);
          else addBox(tg.x - 24, tg.y - 54, tg.x + 24, tg.y);
        }
        if (bx0 > bx1) { bx0 = 0; by0 = 0; bx1 = VW; by1 = VH; }
        bx0 = Math.max(0, bx0); by0 = Math.max(0, by0); bx1 = Math.min(VW, bx1); by1 = Math.min(VH, by1);
        zoom = Math.max(1, Math.min(zoom, (VW - 2 * M) / Math.max(1, bx1 - bx0), (VH - 2 * M) / Math.max(1, by1 - by0)));
        var fitAxis = function (lo, hi, size) {
          if (zoom <= 1.001) return (lo + hi) / 2;
          var fmax = (zoom * lo - M) / (zoom - 1), fmin = (zoom * hi - size + M) / (zoom - 1);
          var f0 = (lo + hi) / 2;
          return Math.max(0, Math.min(size, Math.max(fmin, Math.min(fmax, f0))));
        };
        var fx = fitAxis(bx0, bx1, VW), fy = fitAxis(by0, by1, VH);
        lastZoom.z = zoom; lastZoom.x = fx; lastZoom.y = fy;
        ctx.save();
        ctx.translate(fx, fy); ctx.scale(zoom, zoom); ctx.translate(-fx, -fy);
      }

      drawGround(cam);

      /* 重なり順: 足元が上にあるものから描く（ロボットも全員ここに混ぜる） */
      var list = W.objects.map(function (o) {
        return {
          bottom: (o.y + o.h) * T,
          go: function () {
            var sx = (o.x - cam.x) * T, sy = (o.y - cam.y) * T;
            if (sx > C.width || sy > C.height || sx + o.w * T < 0 || sy + o.h * T < 0) return;
            AQ.props.shadow(o, sx, sy);
            AQ.props.draw(o, sx, sy, propState(o, beat, st));
          }
        };
      });

      var activeHx = 0, activeHy = 0;
      lastDrawn = [];
      placed.forEach(function (pl) {
        var r = pl.r;
        if (r.isActive) { activeHx = pl.hx; activeHy = pl.hy; }
        list.push({
          bottom: (r.pos.y + 1) * T,
          go: function () {
            var pal = paletteFor(pl.actor);
            var sm = spriteFor(pl.actor);
            /* activeRobots() が既に focusActor 以外を候補から外しているので、
               ここに来る時点で「他のロボット」は存在しない。焦点の輪は
               「これが選ばれた1体だ」という印として残す。 */
            /* ★ 2026-09-14: 輪の大きさが 18×22 のままで、ロボットの
               実寸（ROBOT_W×ROBOT_H）とまったく合っていなかった。
               大きさを合わせたうえで、いま動いている本人の頭上に
               ▼ を出す＝広い街のどこに居ても目で追える。 */
            if (focusActor !== null) {
              ctx.save();
              ctx.strokeStyle = '#ffd35c';
              ctx.lineWidth = 1;
              ctx.strokeRect(pl.hx - 2, pl.hy - 2, ROBOT_W + 4, ROBOT_H + 4);
              ctx.restore();
            }
            /* 検査用の覗き穴：render() が実際に描いたロボットだけを控える。
               computeRobotScreenPositions は activeRobots を直接叩くので、
               render() の中の不具合（焦点を String() に潰していた等）を
               すり抜けてしまう＝そこを見る検査には歯が無い。 */
            lastDrawn.push({ actor: String(pl.actor), hx: pl.hx, hy: pl.hy,
                             isActive: !!r.isActive, tag: actorLabel(pl.actor) });
            if (r.isActive) hereMarker(pl.hx + Math.round(ROBOT_W / 2), pl.hy + ROBOT_H - 2, now);
            ctx.globalAlpha = r.isActive ? 1 : 0.7;
            var look = r.isActive ? phaseLook(phaseNow) : null;
            if (look && look.stage) {
              /* 始動・終了の最中：正面を向き、跳ねる・暗くなる・光の輪…（部屋と同じ） */
              var hop = Math.round(8 * look.hop);
              if (look.bright < 0.999) drawRobotDim(pl.hx, pl.hy - hop, 'down', pal, sm, look.bright);
              else AQ.sprites.drawFigure(ctx, sm, pl.hx, pl.hy - hop, ROBOT_W, ROBOT_H, 'down', pal);
              drawPhaseFx(look, pl.hx, pl.hy - hop, now);
              lastPhaseDrawn = { stage: look.stage, bright: look.bright, hop: hop, fx: look.fx.map(function (f) { return f.k; }) };
              lastMood = null;
            } else {
              var mood = r.isActive ? moodFor(beat, p, r.moving) : null;
              if (r.isActive) lastMood = mood;
              drawRobot(pl.hx, pl.hy, mood ? 'down' : r.pos.dir, r.moving, now, pal, sm, mood);
            }
            /* 名札は足もとへ。頭の上は吹き出し（金額・OK・402）が使うので、
               そこに重ねると両方読めなくなる。 */
            nameTag(actorLabel(pl.actor), pl.hx + Math.round(ROBOT_W / 2), pl.hy + ROBOT_H + 4);
            ctx.globalAlpha = 1;
          }
        });
      });

      list.sort(function (a, b2) { return a.bottom - b2.bottom; });
      list.forEach(function (it) { it.go(); });

      /* ★ 2026-10-06: 主役が建物の裏（建物より奥の歩道）を歩いていて、建物に隠れているときは、
         半透明の姿を建物の上に重ねる（利用者の画面で、data.example.dev の裏で見えなくなった）。 */
      placed.forEach(function (pl) {
        if (!pl.r.isActive) return;
        var rb = (pl.r.pos.y + 1) * T;
        var hidden = W.objects.some(function (o) {
          if (!/office|service|facilitator/.test(o.type)) return false;
          if ((o.y + o.h) * T <= rb) return false;          // 建物のほうが手前ではない
          var ox0 = (o.x - cam.x) * T, ox1 = ox0 + o.w * T, oy0 = (o.y - cam.y) * T - 26, oy1 = (o.y + o.h - cam.y) * T;
          return pl.hx + ROBOT_W * 0.2 < ox1 && pl.hx + ROBOT_W * 0.8 > ox0 && pl.hy + ROBOT_H * 0.3 < oy1 && pl.hy + ROBOT_H > oy0;
        });
        if (!hidden) return;
        ctx.save();
        ctx.globalAlpha = 0.55;
        drawRobot(pl.hx, pl.hy, pl.r.pos.dir, pl.r.moving, now, paletteFor(pl.actor), spriteFor(pl.actor), null);
        ctx.globalAlpha = 1;
        ctx.setLineDash && ctx.setLineDash([3, 2]);
        ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 1;
        ctx.strokeRect(pl.hx - 2, pl.hy - 2, ROBOT_W + 4, ROBOT_H + 4);
        ctx.setLineDash && ctx.setLineDash([]);
        ctx.restore();
        nameTag(actorLabel(pl.actor), pl.hx + Math.round(ROBOT_W / 2), pl.hy + ROBOT_H + 4);
        lastFxDrawn.push('ghost');
      });

      var activeMoving = robots.some(function (r) { return r.isActive && r.moving; });
      /* 財布は主役のロボットの腰に（いつでも）。演出（硬貨が飛ぶ）より先に描く。 */
      if (placed.some(function (pl) { return pl.r.isActive; })) drawPurse(activeHx, activeHy, beat, p, st, now);
      else lastPurse = null;
      var ov = OVERLAY[beat.kind];
      if (ov && !activeMoving) ov(activeHx, activeHy, beat, p, now);
      if (zoomed) ctx.restore();
    },

    /** テスト用: 描画せずに、いま画面に出るはずのロボットの実ピクセル座標だけ返す。
        render() と全く同じ layoutRobots() を通すので、ここでの座標は
        実際に描かれる座標そのもの（Playwright などから重なりを機械的に検証できる）。 */
    /** 直近の render() が実際に描いたロボット。activeRobots を直接叩く
        computeRobotScreenPositions と違い、render() の中の不具合も見える。 */
    lastDrawnRobots: function () { return lastDrawn.slice(); },
    lastLabels: function () { return lastLabelsDrawn.slice(); },
    lastFx: function () { return lastFxDrawn.slice(); },
    /** 検査用: 直近の描画の財布（残高の数字と位置）と、カメラの寄り（z=1 は寄っていない）。 */
    lastMood: function () { return lastMood; },
    /** 画面の下の寄り絵の欄を描く（2026-10-06）。戻り値と lastCloseup は、何の場面を描いたか。 */
    renderCloseup: function (c2, beat, p, st, now) { return renderCloseup(c2, beat, p, st, now); },
    lastCloseup: function () { return { scene: lastCloseScene, fx: lastCloseFx.slice() }; },
    lastPanel: function () { return lastPanelDrawn; },
    /** 始動・終了：main.js が clock.phase() を渡す。lastPhase は検査用（直近の描画）。 */
    setPhase: function (ph) { phaseNow = ph || { boot: null, end: 0 }; },
    lastPhase: function () { return lastPhaseDrawn; },
    lastCoinPx: function () { return lastCoinPx; },
    lastPurse: function () { return lastPurse ? { value: lastPurse.value, held: lastPurse.held, pending: lastPurse.pending } : null; },
    lastZoom: function () { return lastZoom ? { z: lastZoom.z, x: lastZoom.x, y: lastZoom.y } : null; },
    /** 検査用: 直近の描画のカメラ（ワールドのマス）と、画面に映すマス数。 */
    lastCamera: function () { return lastCam ? { x: lastCam.x, y: lastCam.y, cols: W.view.cols, rows: W.view.rows } : null; },

    computeRobotScreenPositions: function (beat, p, beats, index2, focusActor) {
      if (!beat) return [];
      beats = beats || [beat];
      index2 = index2 || 0;
      if (!actorBeats) prepare(beats);
      var robots = activeRobots(beat, beats, index2, p, focusActor);
      var activePos = null;
      robots.forEach(function (r) { if (r.isActive) activePos = r.pos; });
      if (!activePos) activePos = { x: homeFor(beat.actor)[0], y: homeFor(beat.actor)[1] };
      var cam = camera(activePos.x, activePos.y);
      return layoutRobots(robots, cam).map(function (pl) {
        return { actor: pl.actor, hx: pl.hx, hy: pl.hy, tileKey: pl.tileKey, isActive: pl.r.isActive };
      });
    }
  };

})(window.AQ = window.AQ || {});
