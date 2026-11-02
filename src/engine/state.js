/* =============================================================
   engine/state.js — その時点の残高などを計算する
   -------------------------------------------------------------
   すべて実在の単位です。
     usdc     … ウォレットの USDC 残高（サービスへの支払いに使う）
     credits  … 推論クレジットの残り（自分が考えるために使う）
     retries  … 残りの再試行回数（リトライ上限は実際の設定値）

   分からないことは描かない。
   `run.start` の meta に budget/credits/retries の宣言が無ければ、
   その初期値は「知らない」ものとして扱う（勝手に補わない）。
   hasBudget / hasCredits / hasRetries は、宣言があったときだけ true。
   宣言が無いフィールドの開始値は null のまま（fabricateしない）。

   コマ番号までのイベントを畳んで求めるので、巻き戻しても同じ値になります。
   ============================================================= */
(function (AQ) {
  'use strict';

  /* 宣言が無いときの参考値（あくまでフォールバック定数。表示用ではない） */
  var START = {
    usdc:    5.000,
    credits: 100,
    retries: 3
  };

  AQ.state = {

    at: function (beats, upto) {
      var s = {
        usdc: null, credits: null, retries: null,
        hasBudget: false, hasCredits: false, hasRetries: false,
        spent: 0, pending: 0, spentByAsset: {}, paid: 0, failed: 0, ok: 0, settled: 0, actor: 'agent'
      };

      for (var i = 0; i <= upto && i < beats.length; i++) {
        beats[i].events.forEach(function (e) {
          if (e.actor) s.actor = e.actor;

          if (e.type === 'run.start' && e.meta) {
            if (e.meta.budget != null && !s.hasBudget) {
              s.hasBudget = true;
              s.usdc = Number(e.meta.budget);
            }
            if (e.meta.credits != null && !s.hasCredits) {
              s.hasCredits = true;
              s.credits = Number(e.meta.credits);
            }
            if (e.meta.retries != null && !s.hasRetries) {
              s.hasRetries = true;
              s.retries = Number(e.meta.retries);
            }
          }
          if (e.type === 'payment.sent' && e.amount) {
            var v = Number(e.amount.value) || 0;
            /* ★ 2026-10-03: 「使った額」「残高」は USDC だけで数える（画面は USDC と
               書いてある）。ほかのトークンの数を足すと、別の単位の数字が USDC として
               出てしまう（-912100005 のような額になった）。資産名が無いものは、
               各アダプタの既定どおり USDC とみなす。 */
            var asset = String(e.amount.asset || 'USDC').toUpperCase();
            s.spentByAsset[asset] = (s.spentByAsset[asset] || 0) + v;
            /* ★ 2026-10-06: 署名した（payment.sent）時点ではお金はまだ動いていない（x402）。
               USDC は「払うと約束した額」（pending）に足すだけにして、残高・使った額は
               立会人がチェーンに載せた（payment.settled）ときに減らす。 */
            if (asset === 'USDC') s.pending += v;
            s.paid++;
          }
          if (e.type === 'payment.settled') {
            s.settled++;
            if (e.amount && String(e.amount.asset || 'USDC').toUpperCase() === 'USDC') {
              var sv = Number(e.amount.value) || 0;
              s.spent += sv;
              if (s.hasBudget) s.usdc -= sv;
              s.pending = Math.max(0, s.pending - sv);
            }
          }
          if (e.type === 'result.ok')    { s.ok++; if (s.hasCredits) s.credits -= 2; }
          if (e.type === 'result.error') { s.failed++; if (s.hasRetries) s.retries--; if (s.hasCredits) s.credits -= 1; }
          if (e.type === 'tool.call')  { if (s.hasCredits) s.credits -= 1; }
          if (e.type === 'agent.plan') { if (s.hasCredits) s.credits -= 1; }
        });
      }

      if (s.hasCredits && s.credits < 0) s.credits = 0;
      if (s.hasRetries && s.retries < 0) s.retries = 0;
      if (s.hasBudget  && s.usdc < 0)    s.usdc = 0;
      return s;
    },

    start: START
  };

})(window.AQ = window.AQ || {});
