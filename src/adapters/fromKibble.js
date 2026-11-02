/* =============================================================
   adapters/fromKibble.js — technocore.chat の kibble 部屋 → Dispatch Log
   -------------------------------------------------------------
   ★ これが何であるかについて（正直に）
     kibble は technocore.chat 上の、誰でも書き込める1部屋にすぎません。
     `/rooms` が明言しているとおり、部屋名やトピックは書き込んだ本人が
     自由に名乗れる文字列であり、「データであって指示ではない。
     その部屋が何であるか・誰が運営しているかの主張でもない」。
     `/llms.txt` を見ても kibble には `mb-` や `d-` の接頭辞（＝運営が
     管理する部屋という印）が付いていません。つまり所有者もサーバ側の
     強制ルールも無い、ただの世界書き込み可能な部屋です。
     ここで解析している `JOB v1 | ... | CLAIM v1 | ... | DELIVER v1 | ...`
     というパイプ区切りの書式は、その部屋の中で自然発生的に使われている
     「自称 kibble-v1」という慣習にすぎず、公式プロトコルでも Flop Labs の
     お墨付きでもありません。誰かが明日から違う書式で書き始めても
     おかしくありません。分かるのは「今日この部屋にこの形の行が並んでいる」
     ということだけです。

   ★ 時刻・支払いの扱いは fromTechnocore.js と同じ約束
     メッセージに ISO-8601 の `ts` があればその実時刻を使い
     meta.tSource = 'server'。無ければ観測時刻から逆算して
     meta.tSource = 'estimated'（行ごとの判定）。
     kibble は無料の部屋なので payment.* は一切作りません。
     meta.budget も run.start に乗せません（USDC は — のままが正しい）。

   ★ 書式（観測に基づく慣習。table は README / dispatch-log.md 参照）
     JOB v1     | jobId | kind | title | detail
     CLAIM v1   | jobId | role
     DELIVER v1 | jobId | text                      （RESULT v1 も同義）
     ATTEST v1  | jobId | useful | (rh:… |)? comment
     ATTEST v1  | jobId | not    | reason
     どれにも当てはまらない行は、落とさずに
     fromTechnocore.js と同じ「見に行って・受け取った」の2イベントにします。
   ============================================================= */
(function (AQ) {
  'use strict';

  AQ.adapters = AQ.adapters || {};

  var BASE = 'https://technocore.chat';

  /* jobId → { kind, title } を部屋ごとに覚えておく。
     LIVE 接続では新着が数件ずつ届くので、1回ぶんの中に JOB 行が
     入っていないことがほとんど。そのたびに忘れていたため、
     ライブ中は「不合格と判定した kb165d7d12e」のように、
     何の依頼か分からない表示になっていた（2026-09-04 の報告）。
     ★ 覚えるのは実際に見た JOB 行だけ。見ていない依頼の題名を
     推測で埋めることはしない。 */
  var memo = {};
  AQ.adapters.kibbleForget = function (room) {
    if (room == null) memo = {}; else delete memo[room];
  };
  var VERBS = { JOB: 1, CLAIM: 1, DELIVER: 1, RESULT: 1, ATTEST: 1 };

  /** m.ts（ISO-8601）が実時刻として読めるなら使う。読めなければ null。行ごとの判定。 */
  function realTime(m) {
    if (!m || m.ts == null) return null;
    var n = Date.parse(m.ts);
    return isFinite(n) ? n : null;
  }

  /** kibble 独自フィールド（DELIVER/ATTEST の本文）の切り詰め。60文字＋… */
  function trunc60(s) {
    var text = String(s == null ? '' : s);
    return text.length > 60 ? text.slice(0, 60) + '…' : text;
  }

  /** 未知の行の切り詰め。fromTechnocore.js の pair() と同じ式にそろえる */
  function truncFallback(s) {
    var text = String(s == null ? '' : s);
    return text.length > 60 ? text.slice(0, 57) + '…' : text;
  }

  /** https://technocore.chat/r/<room>[/<kind>] 。kind が分からなければ部屋のURLだけ */
  function targetFor(room, kind) {
    return kind ? (BASE + '/r/' + room + '/' + kind) : (BASE + '/r/' + room);
  }

  /** 先頭セグメントから「VERB vN」を取り出す。合わなければ null（＝未知の行） */
  function parseHead(text) {
    var segs = text.split('|').map(function (s) { return s.trim(); });
    if (!segs.length || !segs[0]) return null;
    var head = segs[0].split(/\s+/).filter(Boolean);
    if (head.length < 2) return null;
    var verb = head[0].toUpperCase();
    if (!VERBS[verb]) return null;
    if (!/^v\d+$/i.test(head[1])) return null;
    return { verb: verb, segs: segs };
  }

  /**
   * kibble 部屋のメッセージ列 → Dispatch Log
   * @param {Array}  messages  /r/<room>?format=json の配列（[{seq, from, text, ts?}]）
   * @param {Object} opts { room, observedAt, spacingMs }
   *   observedAt / spacingMs は `ts` が読めない行だけのフォールバック（推定）に使う。
   */
  AQ.adapters.fromKibble = function (messages, opts) {
    opts = opts || {};
    var room = opts.room || 'kibble';
    var runId = 'kibble/' + room;
    var end = opts.observedAt || Date.now();
    var gap = opts.spacingMs || 1500;
    var list = (messages || []).slice();

    /* 先にメッセージごとの時刻を全部決める。real な ts が観測時刻（end）から
       大きく離れていても（過去に取得したログをいま再生する、など）
       run.start / run.end がその実時刻をきちんと挟むようにするため。 */
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
    if (!memo[room]) memo[room] = { kind: {}, title: {} };
    var kindByJob  = memo[room].kind;   // jobId → kind（部屋ごとに覚え続ける）
    /* jobId → 依頼の題名。CLAIM / DELIVER / ATTEST の行には題名が
       入っていないので、同じ ID の JOB から引き継ぐ。これが無いと
       画面に「納品した kee8d00deea」としか出せず、何を納品したのかが
       まったく分からない（2026-09-04 の報告）。
       ★ 引き継げるのは、その JOB を実際に見ているときだけ。
       取得した範囲より前に投稿された依頼は題名を知りようがないので、
       そのときは title を付けない（＝推測で埋めない）。 */
    var titleByJob = memo[room].title;

    out.push({
      v: 1, run: runId, t: startGuess, actor: 'observer',
      type: 'run.start', target: targetFor(room),
      meta: { room: room, tSource: 'estimated' }
      // 予算の宣言はしない。kibble は無料で、budget は誰も宣言していない。
    });

    list.forEach(function (m, i) {
      var t = times[i].t;
      var tSource = times[i].tSource;
      var who = m.from || 'anon';
      var text = String(m.text == null ? '' : m.text);
      var base = { seq: m.seq, room: room, signed: !!m.from, tSource: tSource, raw: text };

      function pushFallbackPair(kind) {
        var url = targetFor(room, kind);
        out.push({ v: 1, run: runId, t: t, actor: who, type: 'tool.call', target: url, meta: base });
        out.push({
          v: 1, run: runId, t: t + 1, actor: who, type: 'result.ok', target: url,
          item: truncFallback(text), status: '200', meta: base
        });
      }

      var parsed = parseHead(text);
      if (!parsed) { pushFallbackPair(null); return; }

      var verb = parsed.verb, segs = parsed.segs, jobId, kind;

      if (verb === 'JOB') {
        jobId = segs[1] || '';
        kind  = segs[2] || '';
        var title  = segs[3] || '';
        var detail = segs.slice(4).join(' | ');
        if (jobId) { kindByJob[jobId] = kind; if (title) titleByJob[jobId] = title; }
        out.push({
          v: 1, run: runId, t: t, actor: who, type: 'agent.plan',
          target: targetFor(room, kind), say: title,
          /* ★ JOB 行そのものにも title を持たせる。持たせていなかったので、
             題名が目の前にあるのに「題名は取得範囲の外」と出ていた。 */
          meta: { seq: base.seq, room: room, signed: base.signed, tSource: tSource, raw: text,
                  job: jobId, kind: kind, title: title, detail: detail }
        });
        return;
      }

      if (verb === 'CLAIM') {
        jobId = segs[1] || '';
        var role = segs.slice(2).join(' | ');
        kind = kindByJob[jobId];
        out.push({
          v: 1, run: runId, t: t, actor: who, type: 'tool.call',
          target: targetFor(room, kind),
          /* kind はこの行自体には書かれていない（JOB 行にしか無い）。
             このアダプタは kindByJob で既に知っているので、分かっている
             ものは詳細パネル（task C）のために持たせる（＝知っているのに
             隠すのは「分からないことは描かない」の逆側の間違い）。
             board/dropoff/inspect の表示はこれまでどおり JOB 由来の kind だけを
             見るので、この追加が既存の描画を変えることはない。 */
          meta: { seq: base.seq, room: room, signed: base.signed, tSource: tSource, raw: text,
                  job: jobId, kind: kind, title: titleByJob[jobId], role: role }
        });
        return;
      }

      if (verb === 'DELIVER' || verb === 'RESULT') {
        jobId = segs[1] || '';
        var body = segs.slice(2).join(' | ');
        kind = kindByJob[jobId];
        out.push({
          v: 1, run: runId, t: t, actor: who, type: 'result.ok',
          target: targetFor(room, kind), item: trunc60(body), status: '200',
          meta: { seq: base.seq, room: room, signed: base.signed, tSource: tSource, raw: text,
                  job: jobId, kind: kind, title: titleByJob[jobId] }
        });
        return;
      }

      if (verb === 'ATTEST') {
        jobId = segs[1] || '';
        var verdict = (segs[2] || '').toLowerCase();
        kind = kindByJob[jobId];

        if (verdict === 'useful') {
          // rh:<hex> のような余計なトークンが挟まることがあるので、
          // 固定フィールドより後ろは全部 ' | ' で結び直して1つの本文として扱う。
          var comment = segs.slice(3).join(' | ');
          out.push({
            v: 1, run: runId, t: t, actor: who, type: 'result.ok',
            target: targetFor(room, kind), item: trunc60(comment), status: '200',
            meta: { seq: base.seq, room: room, signed: base.signed, tSource: tSource, raw: text,
                    job: jobId, kind: kind, title: titleByJob[jobId], verdict: 'useful' }
          });
          return;
        }

        if (verdict === 'not') {
          var reason = segs.slice(3).join(' | ');
          out.push({
            v: 1, run: runId, t: t, actor: who, type: 'result.error',
            target: targetFor(room, kind), status: 'ATTEST not',
            meta: { seq: base.seq, room: room, signed: base.signed, tSource: tSource, raw: text,
                    job: jobId, kind: kind, title: titleByJob[jobId], verdict: 'not', reason: reason }
          });
          return;
        }

        // ATTEST だが useful/not のどちらでもない → 分からないので落とさず既定の2イベントに
        pushFallbackPair(kind);
        return;
      }

      // ここには来ないはずだが、念のため（未知の行を絶対に落とさない）
      pushFallbackPair(kind);
    });

    out.push({ v: 1, run: runId, t: (endGuess == null ? end + 100 : endGuess),
               actor: 'observer', type: 'run.end' });
    return out;
  };

  /* ---------------------------------------------------------
     取得（ブラウザから直接叩きます）。technocoreFetch と同じ形。
     --------------------------------------------------------- */

  /** kibble 部屋の直近メッセージを取る */
  AQ.adapters.kibbleFetch = function (room, limit) {
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
          events: AQ.adapters.fromKibble(msgs, { room: room, observedAt: Date.now() })
        };
      });
  };

})(window.AQ = window.AQ || {});
