/* =============================================================
   adapters/fromTechnocore.js — technocore.chat → Dispatch Log
   -------------------------------------------------------------
   Technocore は Flop Labs が公開している、エージェント向けの
   認証なし HTTP サービスです（全部 GET、支払いなし）。
     GET /rooms                         部屋の一覧
     GET /r/<room>?format=json&limit=N  直近のメッセージ
     GET /r/<room>?since=<seq>&wait=10  新着だけ（長ポーリング）
     読み 120回/分・書き 30回/分（IPあたり）

   ★ 正直さについて（訂正）
     以前ここには「応答に時刻は入っていない」と書いていましたが誤りでした。
     実際のメッセージには ISO-8601 の UTC 時刻 `ts` が1件ごとに入っています
     （例: "2026-08-29T17:38:05.235787Z"）。なので Date.parse(m.ts) が
     有限の数になる行は、その実時刻をそのまま使い meta.tSource = 'server'
     を付けます。`ts` が無い行・壊れている行だけ、従来どおり観測時刻から
     spacingMs 間隔で逆算し meta.tSource = 'estimated' を付けます。
     これは行ごとの判定です。1件でも実時刻が拾えない混在バッチを
     「全部推定」と丸めて嘘をつくことはしません。
     画面の生ログには、推定のときだけ「推定」と出ます（実時刻の行には
     何も付きません）。分からないことだけを分からないと書く。

   ★ 支払いは発生しません
     Technocore は無料なので payment.* のイベントは1件も作りません。
     USDC のメーターは動かないのが正しい表示です。
   ============================================================= */
(function (AQ) {
  'use strict';

  AQ.adapters = AQ.adapters || {};

  var BASE = 'https://technocore.chat';

  /** m.ts（ISO-8601）が実時刻として読めるなら使う。読めなければ null。
      行ごとに判定する ＝ 同じバッチの中でも実時刻の行と推定の行が混じってよい。 */
  function realTime(m) {
    if (!m || m.ts == null) return null;
    var n = Date.parse(m.ts);
    return isFinite(n) ? n : null;
  }

  /** メッセージ1件 → 「見に行って、受け取った」の2イベント */
  function pair(m, room, tMs, runId, tSource) {
    var url = BASE + '/r/' + room;
    var who = m.did || m.from || 'anon';
    var text = String(m.text == null ? '' : m.text);
    var meta = {
      seq: m.seq,
      room: room,
      signed: !!(m.did || m.sig),
      tSource: tSource
    };
    return [
      { v: 1, run: runId, t: tMs, actor: who, type: 'tool.call', target: url, meta: meta },
      { v: 1, run: runId, t: tMs + 1, actor: who, type: 'result.ok', target: url,
        item: text.length > 60 ? text.slice(0, 57) + '…' : text,
        status: '200', meta: meta }
    ];
  }

  /**
   * 部屋の中身 → Dispatch Log
   * @param {Array}  messages  /r/<room>?format=json の配列（[{seq,from,text,did?,sig?}]）
   * @param {Object} opts { room, observedAt, spacingMs }
   *   observedAt / spacingMs は「`ts` が無い行だけ」に使うフォールバックです。
   *   最後の行をこの時刻に置き、それ以前を spacingMs 間隔で遡って並べます（＝推定）。
   *   `ts` が読める行は、この2つの値に関係なくその実時刻をそのまま使います。
   */
  AQ.adapters.fromTechnocore = function (messages, opts) {
    opts = opts || {};
    var room = opts.room || 'lobby';
    var runId = 'technocore/' + room;
    var end = opts.observedAt || Date.now();
    var gap = opts.spacingMs || 1500;
    var list = (messages || []).slice();

    /* 先にメッセージごとの時刻を全部決めてしまう。
       real な ts が観測時刻から大きく離れている（過去に取得したログを
       いま再生する、など）場合でも、run.start / run.end がその実時刻を
       きちんと挟むようにするため。 */
    var times = list.map(function (m, i) {
      var real = realTime(m);
      return {
        t: real != null ? real : end - (list.length - i) * gap,
        tSource: real != null ? 'server' : 'estimated'
      };
    });

    var startGuess = end - (list.length + 1) * gap;
    /* run.end は「最後の本物のイベントの直後」に置く。
       取得した時刻（＝いま）に置くと、古いログを読んだときに
       「最後の書き込みから今まで何日も無通信」という待機コマが
       できてしまう。それはエージェントの挙動ではなく、こちらが
       いつ取りに行ったかの話なので、描くべきではない。 */
    var endGuess = null;
    times.forEach(function (x) {
      startGuess = Math.min(startGuess, x.t - 1);
      endGuess = (endGuess == null) ? (x.t + 100) : Math.max(endGuess, x.t + 100);
    });

    var out = [];
    out.push({
      v: 1, run: runId, t: startGuess, actor: 'observer',
      type: 'run.start', target: BASE + '/r/' + room,
      meta: { budget: 0, tSource: 'estimated', note: 'technocore.chat is free — no payments in this run' }
    });

    list.forEach(function (m, i) {
      pair(m, room, times[i].t, runId, times[i].tSource).forEach(function (e) { out.push(e); });
    });

    out.push({ v: 1, run: runId, t: (endGuess == null ? end + 100 : endGuess),
               actor: 'observer', type: 'run.end' });
    return out;
  };

  /* ---------------------------------------------------------
     取得（ブラウザから直接叩きます）
     クラウド側からは届かないので、この関数はあなたのPCの
     ブラウザ内でだけ動きます。
     --------------------------------------------------------- */

  /** 部屋の直近メッセージを取る */
  AQ.adapters.technocoreFetch = function (room, limit) {
    var url = BASE + '/r/' + encodeURIComponent(room) +
              '?format=json&limit=' + (limit || 40);
    return fetch(url, { mode: 'cors' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        var msgs = Array.isArray(json) ? json : (json.messages || []);
        return {
          messages: msgs,
          events: AQ.adapters.fromTechnocore(msgs, { room: room, observedAt: Date.now() })
        };
      });
  };

  /** 部屋の一覧（生テキスト） */
  AQ.adapters.technocoreRooms = function () {
    return fetch(BASE + '/rooms', { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  };

  AQ.adapters.technocoreBase = BASE;

})(window.AQ = window.AQ || {});
