/* =============================================================
   adapters/fromTransfers.js — ウォレットの送金履歴 → Dispatch Log
   -------------------------------------------------------------
   エージェントが何も出力しなくても、オンチェーンの送金だけから
   実行を再構成するための読み取り部。
   （Arc の USDC 送金を想定。Flop を足すときはこれを複製して
     asset と「何を買ったか」の解釈だけ差し替える）
   ============================================================= */
(function (AQ) {
  'use strict';

  AQ.adapters = AQ.adapters || {};

  /**
   * @param {Array} transfers
   *   { hash, ts, from, to, value, asset, chain, label }
   * @param {Object} opts { run, actor, budget, gapMs }
   *   gapMs … これ以上あいた送金は別の「旅」として扱う目印にします
   */
  AQ.adapters.fromTransfers = function (transfers, opts) {
    opts = opts || {};
    var run   = opts.run || 'chain-run';
    var actor = opts.actor || 'agent';
    var out = [];
    if (!transfers.length) return out;

    var sorted = transfers.slice().sort(function (a, b) {
      return new Date(a.ts).getTime() - new Date(b.ts).getTime();
    });
    var t0 = new Date(sorted[0].ts).getTime();

    out.push({ v:1, run:run, t:t0 - 1, actor:actor, type:'run.start',
               target:(sorted[0].label || sorted[0].to),
               meta:{ budget: opts.budget != null ? opts.budget : 5.0 } });

    sorted.forEach(function (x) {
      var t = new Date(x.ts).getTime();
      var amount = { asset: x.asset || 'USDC', value: String(x.value), chain: x.chain || 'arc' };
      var target = x.label || x.to;

      // 送金しか見えないので「払った」と「確定した」だけを立てる。
      // 何を買ったかは分からない ＝ 分からないことは描かない。
      out.push({ v:1, run:run, t:t, actor:actor, type:'payment.sent',
                 target:target, amount:amount });
      out.push({ v:1, run:run, t:t + 1, actor:actor, type:'payment.settled',
                 amount:amount, tx:x.hash, meta:{ batched: x.batched || 1 } });
    });

    var last = new Date(sorted[sorted.length - 1].ts).getTime();
    out.push({ v:1, run:run, t:last + 100, actor:actor, type:'run.end' });
    return out;
  };

})(window.AQ = window.AQ || {});
