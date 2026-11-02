/* チームデモ：3体（scout / sage / smith）が同時に別のAPIへ向かう。
   scout … 有料APIを1回呼んで成功
   sage  … 有料APIを2回呼んで、どちらも成功
   smith … 1回目は 502、リトライして成功

   タイムスタンプはわざと間隔を空けてあります。
   aggregate.js は actor を見ずに pending を溜めるので、間隔が詰まりすぎると
   別のエージェントの出来事まで1つの「つけ」に混ざってしまいます。
   ここでは 1件だけ残った result.ok の直後に aggregateWindowMs(4000ms) より
   広い間を空けて、次のエージェントが動き出す前に必ず単独で流すようにしています。 */
(function (AQ) {
  AQ.runs = AQ.runs || {};
  var T = 1758300000000;
  var RUN = '0xf00d…7e';

  AQ.runs.team = [
    { v:1, run:RUN, t:T,      actor:'scout', type:'run.start',
      target:'https://api.example.dev/news', meta:{ budget:5.000, credits:100, retries:3 } },
    { v:1, run:RUN, t:T+50,   actor:'sage',  type:'run.start',
      target:'https://data.example.dev/tick', meta:{ budget:5.000, credits:100, retries:3 } },
    { v:1, run:RUN, t:T+100,  actor:'smith', type:'run.start',
      target:'https://gpu-bridge.example/infer', meta:{ budget:5.000, credits:100, retries:3 } },

    /* --- scout: 1回で成功 --- */
    { v:1, run:RUN, t:T+600,  actor:'scout', type:'tool.call',
      target:'https://api.example.dev/news' },
    { v:1, run:RUN, t:T+750,  actor:'scout', type:'payment.required',
      target:'https://api.example.dev/news',
      amount:{ asset:'USDC', value:'0.010', chain:'arc' },
      meta:{ payTo:'0x8f3c00000000000021' } },
    { v:1, run:RUN, t:T+950,  actor:'scout', type:'payment.sent',
      target:'https://api.example.dev/news',
      amount:{ asset:'USDC', value:'0.010', chain:'arc' } },
    { v:1, run:RUN, t:T+1150, actor:'scout', type:'payment.settled',
      amount:{ asset:'USDC', value:'0.010', chain:'arc' },
      tx:'0x9be2000000000101', meta:{ batched:1 } },
    { v:1, run:RUN, t:T+1350, actor:'scout', type:'result.ok',
      target:'https://api.example.dev/news',
      item:'news.json', meta:{ bytes:'12.4 KB' } },

    /* --- sage: 1回目 --- */
    { v:1, run:RUN, t:T+6000, actor:'sage', type:'tool.call',
      target:'https://data.example.dev/tick' },
    { v:1, run:RUN, t:T+6150, actor:'sage', type:'payment.required',
      target:'https://data.example.dev/tick',
      amount:{ asset:'USDC', value:'0.004', chain:'arc' },
      meta:{ payTo:'0x2211000000000034' } },
    { v:1, run:RUN, t:T+6350, actor:'sage', type:'payment.sent',
      target:'https://data.example.dev/tick',
      amount:{ asset:'USDC', value:'0.004', chain:'arc' } },
    { v:1, run:RUN, t:T+6550, actor:'sage', type:'payment.settled',
      amount:{ asset:'USDC', value:'0.004', chain:'arc' },
      tx:'0xa1b2000000000202', meta:{ batched:1 } },
    { v:1, run:RUN, t:T+6750, actor:'sage', type:'result.ok',
      target:'https://data.example.dev/tick',
      item:'tick-1.json', meta:{ bytes:'640 B' } },

    /* --- smith: 1回目は 502 --- */
    { v:1, run:RUN, t:T+11500, actor:'smith', type:'tool.call',
      target:'https://gpu-bridge.example/infer' },
    { v:1, run:RUN, t:T+11650, actor:'smith', type:'payment.required',
      target:'https://gpu-bridge.example/infer',
      amount:{ asset:'USDC', value:'0.030', chain:'arc' },
      meta:{ payTo:'0x22ff00000000000091' } },
    { v:1, run:RUN, t:T+11850, actor:'smith', type:'payment.sent',
      target:'https://gpu-bridge.example/infer',
      amount:{ asset:'USDC', value:'0.030', chain:'arc' } },
    { v:1, run:RUN, t:T+12050, actor:'smith', type:'result.error',
      target:'https://gpu-bridge.example/infer',
      status:'502', meta:{ attempt:1, backoff:'2s' } },

    /* --- smith: 再試行して成功 --- */
    { v:1, run:RUN, t:T+12300, actor:'smith', type:'tool.call',
      target:'https://gpu-bridge.example/infer' },
    { v:1, run:RUN, t:T+12450, actor:'smith', type:'payment.required',
      target:'https://gpu-bridge.example/infer',
      amount:{ asset:'USDC', value:'0.030', chain:'arc' },
      meta:{ payTo:'0x22ff00000000000091' } },
    { v:1, run:RUN, t:T+12650, actor:'smith', type:'payment.sent',
      target:'https://gpu-bridge.example/infer',
      amount:{ asset:'USDC', value:'0.030', chain:'arc' } },
    { v:1, run:RUN, t:T+12850, actor:'smith', type:'payment.settled',
      amount:{ asset:'USDC', value:'0.030', chain:'arc' },
      tx:'0x3d7100000000303', meta:{ batched:1, attempt:2 } },
    { v:1, run:RUN, t:T+13050, actor:'smith', type:'result.ok',
      target:'https://gpu-bridge.example/infer',
      item:'inference.json', meta:{ bytes:'2.1 KB' } },

    /* --- sage: 2回目 --- */
    { v:1, run:RUN, t:T+18000, actor:'sage', type:'tool.call',
      target:'https://data.example.dev/tick' },
    { v:1, run:RUN, t:T+18150, actor:'sage', type:'payment.required',
      target:'https://data.example.dev/tick',
      amount:{ asset:'USDC', value:'0.004', chain:'arc' },
      meta:{ payTo:'0x2211000000000034' } },
    { v:1, run:RUN, t:T+18350, actor:'sage', type:'payment.sent',
      target:'https://data.example.dev/tick',
      amount:{ asset:'USDC', value:'0.004', chain:'arc' } },
    { v:1, run:RUN, t:T+18550, actor:'sage', type:'payment.settled',
      amount:{ asset:'USDC', value:'0.004', chain:'arc' },
      tx:'0xc3d4000000000404', meta:{ batched:1 } },
    { v:1, run:RUN, t:T+18750, actor:'sage', type:'result.ok',
      target:'https://data.example.dev/tick',
      item:'tick-2.json', meta:{ bytes:'640 B' } },

    { v:1, run:RUN, t:T+19000, actor:'scout', type:'run.end' },
    { v:1, run:RUN, t:T+19100, actor:'sage',  type:'run.end' },
    { v:1, run:RUN, t:T+19200, actor:'smith', type:'run.end' }
  ];
})(window.AQ = window.AQ || {});
