/* =============================================================
   adapters/fromX402.js — x402 のレシート → Dispatch Log
   -------------------------------------------------------------
   ★ 新しいチェーンを足すときは、このファイルを丸ごとコピーして
     中の変換だけ書き換えてください。他のファイルは触らなくて済みます。
   入力の形が変わっても、出力（Dispatch Log の配列）さえ守れば動きます。
   ============================================================= */
(function (AQ) {
  'use strict';

  AQ.adapters = AQ.adapters || {};

  /**
   * @param {Array} receipts  x402 クライアントが残したレシート
   *   想定する1件の形（無い項目は空でよい）:
   *   { id, ts, agent, url, price:{asset,amount,network}, payTo,
   *     status, txHash, settledWith, bytes, error }
   * @param {Object} opts { run, budget }
   * @returns {Array} Dispatch Log イベント配列
   */
  AQ.adapters.fromX402 = function (receipts, opts) {
    opts = opts || {};
    var run = opts.run || 'x402-run';
    var out = [];
    var t0 = receipts.length ? new Date(receipts[0].ts || Date.now()).getTime() : Date.now();

    out.push({ v:1, run:run, t:t0, actor:'agent', type:'run.start',
               target:(receipts[0] && receipts[0].url) || '',
               meta:{ budget: opts.budget != null ? opts.budget : 5.0 } });

    receipts.forEach(function (r) {
      var t = new Date(r.ts || Date.now()).getTime();
      var actor = r.agent || 'agent';
      var amount = r.price ? {
        asset: r.price.asset || 'USDC',
        value: String(r.price.amount != null ? r.price.amount : '0'),
        chain: r.price.network || 'arc'
      } : null;

      out.push({ v:1, run:run, t:t, actor:actor, type:'tool.call', target:r.url });

      if (amount) {
        out.push({ v:1, run:run, t:t + 1, actor:actor, type:'payment.required',
                   target:r.url, amount:amount, meta:{ payTo:r.payTo } });
        out.push({ v:1, run:run, t:t + 2, actor:actor, type:'payment.sent',
                   target:r.url, amount:amount });
      }

      if (r.txHash) {
        out.push({ v:1, run:run, t:t + 3, actor:actor, type:'payment.settled',
                   amount:amount, tx:r.txHash,
                   meta:{ batched: r.settledWith || 1 } });
      }

      if (r.error || (r.status && Number(r.status) >= 400 && Number(r.status) !== 402)) {
        out.push({ v:1, run:run, t:t + 4, actor:actor, type:'result.error',
                   target:r.url, status:String(r.status || 'error'),
                   meta:{ attempt: r.attempt || 1 } });
      } else {
        out.push({ v:1, run:run, t:t + 4, actor:actor, type:'result.ok',
                   target:r.url, item:r.item || 'response',
                   meta:{ bytes:r.bytes } });
      }
    });

    out.push({ v:1, run:run, t:t0 + 1, actor:'agent', type:'run.end' });
    out[out.length - 1].t = (out[out.length - 2] || { t:t0 }).t + 100;
    return out;
  };

})(window.AQ = window.AQ || {});
