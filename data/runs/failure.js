/* 失敗デモ：払ったのに 502。再試行して、最後は別の提供元へ。
   「失敗は普通に起きる／原因があり／代償がある」を見せるための run。 */
(function (AQ) {
  AQ.runs = AQ.runs || {};
  var T = 1758100000000;

  AQ.runs.failure = [
    { v:1, run:'0x41aa…b7', t:T,      actor:'scout', type:'run.start',
      target:'https://gpu-bridge.example/infer', meta:{ budget:5.000, credits:100, retries:3 } },

    { v:1, run:'0x41aa…b7', t:T+800,  actor:'scout', type:'tool.call',
      target:'https://gpu-bridge.example/infer' },

    { v:1, run:'0x41aa…b7', t:T+1100, actor:'scout', type:'payment.required',
      target:'https://gpu-bridge.example/infer',
      amount:{ asset:'USDC', value:'0.030', chain:'arc' },
      meta:{ payTo:'0x22ff00000000000091' } },

    { v:1, run:'0x41aa…b7', t:T+1500, actor:'scout', type:'payment.sent',
      target:'https://gpu-bridge.example/infer',
      amount:{ asset:'USDC', value:'0.030', chain:'arc' } },

    { v:1, run:'0x41aa…b7', t:T+2200, actor:'scout', type:'result.error',
      target:'https://gpu-bridge.example/infer',
      status:'502', meta:{ attempt:1, backoff:'2s' } },

    { v:1, run:'0x41aa…b7', t:T+4400, actor:'scout', type:'tool.call',
      target:'https://gpu-bridge.example/infer' },

    { v:1, run:'0x41aa…b7', t:T+5000, actor:'scout', type:'result.error',
      target:'https://gpu-bridge.example/infer',
      status:'502', meta:{ attempt:2, backoff:'4s' } },

    /* 30秒の無通信 → 待機（充電スタンド）のコマが自動で入る（config.idleGapMs） */
    { v:1, run:'0x41aa…b7', t:T+35000, actor:'scout', type:'agent.plan',
      say:'別の提供元をあたる' },

    { v:1, run:'0x41aa…b7', t:T+35600, actor:'scout', type:'tool.call',
      target:'https://api.example.dev/infer' },

    { v:1, run:'0x41aa…b7', t:T+35900, actor:'scout', type:'payment.required',
      target:'https://api.example.dev/infer',
      amount:{ asset:'USDC', value:'0.020', chain:'arc' } },

    { v:1, run:'0x41aa…b7', t:T+36300, actor:'scout', type:'payment.sent',
      target:'https://api.example.dev/infer',
      amount:{ asset:'USDC', value:'0.020', chain:'arc' } },

    { v:1, run:'0x41aa…b7', t:T+36800, actor:'scout', type:'payment.settled',
      amount:{ asset:'USDC', value:'0.050', chain:'arc' },
      tx:'0x3d7100000000000c', meta:{ batched:2 } },

    { v:1, run:'0x41aa…b7', t:T+37200, actor:'scout', type:'result.ok',
      target:'https://api.example.dev/infer',
      item:'inference.json', meta:{ bytes:'2.1 KB' } },

    { v:1, run:'0x41aa…b7', t:T+37400, actor:'scout', type:'run.end' }
  ];
})(window.AQ = window.AQ || {});
