/* =============================================================
   data/runs/x402intro.js — 「x402ってなに？」の1本（2026-09-13）
   -------------------------------------------------------------
   このアプリのゴールは Base での x402 の認知向上。ところが起動画面には
   x402 の3文字も無く、LIVE の既定（technocore.chat の kibble）は
   支払いが1件も無い無料の掲示板だった。つまり「x402ってなに？」と
   思って開いた人が、その答えをどこでも見られなかった。
   ここはその答えを1本の再生にしたもの。

   ★ これは説明用に手で書いた作り話です。本物のログではありません。
     画面にもそう明記します（i18n の intro.fake）。ただし、書いてある
     手順そのものは x402 の仕様どおりです：
       ・"exact" スキームの EVM 決済は、USDC の transferWithAuthorization
         （EIP-3009）で行われる
       ・エージェントが返すのは送金そのものではなく「許可証への署名」で、
         その時点ではチェーンに何も乗っていない
       ・チェーンに載せてガス代を払うのはファシリテータ（立会人）
     金額 0.001 USDC・chain 'base' も、実際にありうる形にしてあります
     （ほかのデモが使っている 'arc' は data/chains.js に無い名前）。

   なぜ「断られた」コマ（result.error / 402）を1つ入れてあるか:
     402 の意味は「払わないと中身はもらえない」こと。払う場面だけを
     見せると「402 が出た → 払った」という段取りの説明にしかならず、
     なぜ払うのかが絵にならない。だから一度だけ、空手で帰る場面を置く。
   ============================================================= */
(function (AQ) {
  AQ.runs = AQ.runs || {};
  var T = 1758000000000;
  var URL = 'https://api.example.dev/price/btc';
  var RUN = 'x402-intro';
  var A = 'agent';
  /* 0.001 USDC。x402 が「クレカでは成り立たない額」を扱えることが
     この数字そのもので伝わる（1000分の1ドル）。 */
  var AMT = { asset: 'USDC', value: '0.001', chain: 'base' };

  AQ.runs.x402intro = [
    { v:1, run:RUN, t:T, actor:A, type:'run.start', target:URL,
      meta:{ budget:1.000, credits:100, retries:3 } },

    /* ① 頼んだ */
    { v:1, run:RUN, t:T+600,  actor:A, type:'agent.plan',
      say:'BTC のいまの値段が要る' },
    { v:1, run:RUN, t:T+1400, actor:A, type:'tool.call', target:URL },

    /* ② 402 が返ってきた（中身の代わりに「いくら・どこへ・どのチェーンで」） */
    { v:1, run:RUN, t:T+2200, actor:A, type:'payment.required', target:URL,
      amount:AMT, meta:{ payTo:'0x8f3c00000000000021' } },
    /* 払っていないので、この時点では中身はもらえない */
    { v:1, run:RUN, t:T+3000, actor:A, type:'result.error', target:URL,
      status:'402', meta:{ attempt:1 } },

    /* ③ 許可証に署名して返した（まだチェーンには乗っていない） */
    { v:1, run:RUN, t:T+4000, actor:A, type:'payment.sent', target:URL,
      amount:AMT },

    /* ④ 立会人（ファシリテータ）がチェーンに載せた＝ここで初めてお金が動く */
    { v:1, run:RUN, t:T+5000, actor:A, type:'payment.settled',
      amount:AMT, tx:'0x9be2000000000004', meta:{ batched:1 } },

    /* ⑤ 支払いが確定したので、お店が中身を渡した。
       ★ 2026-10-08 総点検：以前はここで「もう一度取りに行く」（tool.call）をもう1回
       置いていた。x402 の仕様では、署名した許可証は③の「もう一度の依頼」に付けて渡し、
       お店はそれを立会人に確定させてから、その同じ依頼への返事として中身を返す。
       確定のあとにもう一度頼み直すことはないので、そのコマは外した。 */
    { v:1, run:RUN, t:T+6400, actor:A, type:'result.ok', target:URL,
      item:'price.json', meta:{ bytes:'0.4 KB' } },

    { v:1, run:RUN, t:T+6800, actor:A, type:'run.end' }
  ];
})(window.AQ = window.AQ || {});
