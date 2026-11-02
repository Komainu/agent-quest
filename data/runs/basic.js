/* 基本デモ：1回の有料リクエスト（402 → 支払い → 確定 → 取得）
   実データに差し替えるときは、この配列と同じ形にするだけ。 */
(function (AQ) {
  AQ.runs = AQ.runs || {};
  var T = 1758000000000;

  AQ.runs.basic = [
    { v:1, run:'0x7c3f…a1', t:T,        actor:'scout', type:'run.start',
      target:'https://api.example.dev/news', meta:{ budget:5.000, credits:100, retries:3 } },

    { v:1, run:'0x7c3f…a1', t:T+400,    actor:'scout', type:'agent.plan',
      say:'今日の見出しが要る' },

    { v:1, run:'0x7c3f…a1', t:T+900,    actor:'scout', type:'tool.call',
      target:'https://api.example.dev/news' },

    { v:1, run:'0x7c3f…a1', t:T+1200,   actor:'scout', type:'payment.required',
      target:'https://api.example.dev/news',
      amount:{ asset:'USDC', value:'0.010', chain:'arc' },
      meta:{ payTo:'0x8f3c00000000000021' } },

    { v:1, run:'0x7c3f…a1', t:T+1600,   actor:'scout', type:'payment.sent',
      target:'https://api.example.dev/news',
      amount:{ asset:'USDC', value:'0.010', chain:'arc' } },

    { v:1, run:'0x7c3f…a1', t:T+2100,   actor:'scout', type:'payment.settled',
      amount:{ asset:'USDC', value:'0.010', chain:'arc' },
      tx:'0x9be2000000000004', meta:{ batched:1 } },

    { v:1, run:'0x7c3f…a1', t:T+2400,   actor:'scout', type:'result.ok',
      target:'https://api.example.dev/news',
      item:'news.json', meta:{ bytes:'12.4 KB' } },

    { v:1, run:'0x7c3f…a1', t:T+2600,   actor:'scout', type:'run.end' }
  ];
})(window.AQ = window.AQ || {});
