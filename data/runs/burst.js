/* 大量デモ：ナノペイメント想定。
   承認（オフチェーン）が高頻度で走り、まとめて1本のオンチェーン取引で確定する。
   → 承認は「つけ（batch）」1コマに集約され、確定だけがフルのコマになる。
   config.aggregateMin を 999 にすると集約が止まるので、違いを見せられます。 */
(function (AQ) {
  AQ.runs = AQ.runs || {};
  var T = 1758200000000;
  var ev = [];

  ev.push({ v:1, run:'0x9d02…5e', t:T, actor:'sage', type:'run.start',
            target:'https://data.example.dev/tick', meta:{ budget:5.000, credits:100, retries:3 } });

  /* 3回のバッチ。各バッチのあいだに承認を 18 件ずつ積む。 */
  var t = T + 500, tx = ['0xa1b2000000000031', '0xc3d4000000000077', '0xe5f6000000000019'];
  for (var b = 0; b < 3; b++) {
    for (var i = 0; i < 18; i++) {
      ev.push({ v:1, run:'0x9d02…5e', t:t, actor:'sage', type:'payment.sent',
                target:'https://data.example.dev/tick',
                amount:{ asset:'USDC', value:'0.0004', chain:'arc' } });
      ev.push({ v:1, run:'0x9d02…5e', t:t + 30, actor:'sage', type:'cache.hit' });
      t += 90;
    }
    ev.push({ v:1, run:'0x9d02…5e', t:t + 200, actor:'sage', type:'payment.settled',
              amount:{ asset:'USDC', value:'0.0072', chain:'arc' },
              tx:tx[b], meta:{ batched:18 } });
    t += 900;
  }

  ev.push({ v:1, run:'0x9d02…5e', t:t + 300, actor:'sage', type:'result.ok',
            target:'https://data.example.dev/tick',
            item:'ticks.parquet', meta:{ bytes:'1.9 MB' } });
  ev.push({ v:1, run:'0x9d02…5e', t:t + 500, actor:'sage', type:'run.end' });

  AQ.runs.burst = ev;
})(window.AQ = window.AQ || {});
