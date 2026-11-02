/* =============================================================
   engine/aggregate.js — イベント列 → コマ（beat）列
   -------------------------------------------------------------
   「画面は帯域の決まったチャンネル」を実装している部分です。
     Tier1 … 必ず1コマ
     Tier2 … 少なければ1件1コマ、多ければ1コマにまとめる
     Tier3 … コマにしない（環境の密度としてだけ数える）
   ルールを変えたいときは config.js の tier / aggregate* を触る。
   ============================================================= */
(function (AQ) {
  'use strict';

  var KIND_OF = {
    'run.start':        'start',
    'run.end':          'end',
    'payment.required': 'require',   // 402 を出された
    'payment.sent':     'pay',       // 支払った
    'payment.settled':  'settle',    // オンチェーンで確定した
    'result.ok':        'receive',   // 受け取った
    'result.error':     'error',     // 応答なし
    'tool.call':        'travel',    // 向かっている
    'agent.plan':       'plan'       // 考えた／依頼を board に投稿した
  };

  function tierOf(type) {
    var t = AQ.config.tier[type];
    return t ? t : 2;
  }

  /* Tier2 の中でも「考えた／依頼を投稿した」(agent.plan) は、支払いや
     呼び出しとは別腹の会話だと考える。たまたま同じ数秒に payment.sent が
     3件・agent.plan が1件並んだだけで1つの「つけ」に混ぜてしまうと、
     依頼の投稿が金額の集計に紛れて消える（＝分からないことを描いてしまう）。
     なので、まとめる（pending）候補は同じ family どうしだけに限る。

     ★ 2026-09-03: 'wire' をさらに 'payment' と 'activity' に分けた（訂正）
       以前はここが agent.plan 以外すべて 'wire' という1つの family で、
       payment.sent / payment.required と、kibble の tool.call / result.ok が
       同じ「つけ」に混ざれた。kibble には payment.* が1件も無いのに、
       その束が flushPending() の「まとめて記録した」＝支払いの文言
       （「N authorizations · total 0.000」）で描かれてしまう、という
       実際に起きたバグの原因がここだった。kibble には払っていない金額を
       画面が「まとめて支払った」と報告していた＝分からないことを
       描いてしまっていた、最悪のクラスの嘘。
       payment.required / payment.sent だけを 'payment' family にし、
       それ以外（tool.call・result.ok など、今後増える非支払いの Tier2）は
       'activity' family にする。'payment' の束だけが金額の文言（batch）を
       持ち、'activity' の束は金額に一切触れない別の文言（actbatch）になる。 */
  function familyOf(type) {
    if (type === 'agent.plan') return 'plan';
    if (type === 'payment.required' || type === 'payment.sent') return 'payment';
    return 'activity';
  }

  /** ★ 2026-09-07: まとめる単位に「どの依頼か」を入れる。
      それまでは種別の family だけで束ねていたので、1つの
      「まとめて記録した」コマの中に別々の依頼のイベントが混ざり、
        ・見出しには代表イベント1件ぶんの題名しか出せない
          （＝残りの依頼の話が消える／急に別の依頼に変わったように見える）
        ・①〜④の進み具合が「どの依頼の話か」決められず消える
      という2つの症状になっていた（利用者からの報告）。
      依頼ごとに束ねれば、束は必ず1つの依頼の話になる。
      job を持たないイベント（街の x402 側など）は今までどおり
      family だけでまとまる。 */
  function groupKeyOf(e) {
    var m = e.meta || {};
    /* ★ 2026-10-08: 依頼のあるイベントは「だれの」も分ける。同じ依頼を何体もが
       立て続けに引き受けると、ちがう子の行が1つの束になり、束の主役（最後の行の子）
       しか動かない＝選んだ子が何もしていないように見えていた。 */
    if (m.job != null) return familyOf(e.type) + '\u0000' + m.job + '\u0000' + (e.actor || '');
    return familyOf(e.type) + '\u0000';
  }

  function beat(kind, events, extra) {
    var lead = events[events.length - 1] || null;   // 代表イベント（生ログ表示用）
    var b = {
      kind:   kind,
      events: events,
      lead:   lead,
      count:  events.length,
      actor:  (lead && lead.actor) || 'agent'        // このコマを動かしているエージェント
    };
    if (extra) Object.keys(extra).forEach(function (k) { b[k] = extra[k]; });
    return b;
  }

  AQ.aggregate = {

    /**
     * events → { beats, stats }
     * beats は再生順。stats.shown / stats.total を画面隅に出します。
     */
    toBeats: function (events) {
      var cfg = AQ.config;
      var beats = [];
      var pending = [];       // Tier2 の溜め
      var ambient = 0;        // Tier3 の件数（描かない）
      var lastT = null;
      var lastActor = null;   // 直前に動いていたエージェント（idle コマの持ち主にする）

      function flushPending() {
        if (!pending.length) return;
        if (pending.length >= cfg.aggregateMin) {
          // まとめて1コマ。pending は family＋依頼IDで分けて溜めているので、
          // ここに来る時点で中身は必ず同じ family かつ同じ依頼（下の push 側で
          // 保証）。family ごとに文言も別にする。
          var fam = familyOf(pending[0].type);
          if (fam === 'plan') {
            // agent.plan の束 ＝ 依頼の投稿。金額は無いので payment の「つけ」とは
            // 別の見せ方にする（合計 0 USDC と出すのは、無いものをあるように
            // 描くのと同じで嘘になる）。
            beats.push(beat('planbatch', pending.slice()));
          } else if (fam === 'payment') {
            // payment.required / payment.sent の束だけがここに来る。
            // 金額の合計は本物の payment.* から積んだものだけを足す。
            var total = 0, asset = '';
            pending.forEach(function (e) {
              if (e.amount) { total += Number(e.amount.value) || 0; asset = e.amount.asset || asset; }
            });
            beats.push(beat('batch', pending.slice(), { total: total, asset: asset }));
          } else {
            // 'activity'：payment.* を1件も含まない Tier2 の束（kibble の
            // tool.call / result.ok など）。何が起きたかを、実際にあった
            // イベント種別の内訳（byKind）で正直に持たせる。合計金額や
            // 「支払い」という言葉はここには一切出さない（hud.js 側）。
            var byKind = {};
            pending.forEach(function (e) {
              var k = KIND_OF[e.type] || e.type;
              byKind[k] = (byKind[k] || 0) + 1;
            });
            beats.push(beat('actbatch', pending.slice(), { byKind: byKind }));
          }
        } else {
          // 少数なので1件ずつ描く
          pending.forEach(function (e) {
            beats.push(beat(KIND_OF[e.type] || 'travel', [e]));
          });
        }
        pending = [];
      }

      function maybeIdle(e) {
        if (lastT === null) return;
        var gap = e.t - lastT;
        if (gap >= cfg.idleGapMs) {
          // 待機しているのは直前に動いていたエージェント。
          // どのロボットが充電スタンドにいるかを画面に正しく出すため。
          beats.push(beat('idle', [], { gapMs: gap, actor: lastActor || 'agent' }));
        }
      }

      events.forEach(function (e) {
        var tier = tierOf(e.type);

        if (tier === 3) { ambient++; return; }          // 描かない

        /* ★ 2026-10-08: 依頼の出来事（JOB・CLAIM・DELIVER・ATTEST）は束ねない。
           1件ずつが「板から札を取る」「納品口に入れる」などの別々の動作で、束ねると
           どの札がどこへ動いたかを描けず、札がワープしていた（自動の検査で発見）。 */
        var jobStep = tier === 2 && e.meta && e.meta.job != null && e.meta.job !== '';
        if (tier === 1 || jobStep) {
          flushPending();
          maybeIdle(e);
          beats.push(beat(KIND_OF[e.type] || 'travel', [e]));
          lastT = e.t;
          lastActor = e.actor;
          return;
        }

        // Tier2
        if (pending.length &&
            (groupKeyOf(pending[0]) !== groupKeyOf(e) ||
             (e.t - pending[0].t) > cfg.aggregateWindowMs)) {
          flushPending();
        }
        maybeIdle(e);
        pending.push(e);
        lastT = e.t;
        lastActor = e.actor;
      });

      flushPending();

      beats.forEach(function (b, i) { b.index = i; });

      return {
        beats: beats,
        stats: {
          shown:   beats.length,
          total:   events.length,
          ambient: ambient
        }
      };
    }
  };

})(window.AQ = window.AQ || {});
