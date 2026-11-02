/* =============================================================
   engine/questlog.js — Dispatch Log の読み込みと検証
   -------------------------------------------------------------
   入口はここ1か所。どのチェーンから来たデータでも、
   adapters/ で「Dispatch Log の配列」に直してから渡してください。
   ============================================================= */
(function (AQ) {
  'use strict';

  var TYPES = [
    'run.start', 'agent.plan', 'tool.call',
    'payment.required', 'payment.sent', 'payment.settled',
    'result.ok', 'result.error', 'run.end',
    'cache.hit', 'poll'
  ];

  /** 1件を正規化する。壊れていたら null を返す（落とさない） */
  function normalize(e, i) {
    if (!e || typeof e !== 'object') return null;
    var type = String(e.type || '');
    if (TYPES.indexOf(type) === -1) type = 'tool.call';   // 未知の種別は移動扱い
    return {
      i:      i,
      v:      e.v || 1,
      run:    e.run || 'run',
      t:      Number(e.t) || 0,
      actor:  e.actor || 'agent',
      type:   type,
      target: e.target || '',
      amount: e.amount || null,          // {asset,value,chain}
      tx:     e.tx || '',
      status: e.status || '',
      item:   e.item || '',
      say:    e.say || '',
      meta:   e.meta || {}
    };
  }

  AQ.questlog = {
    types: TYPES,

    /** 配列 or JSONL文字列 → 正規化済み配列（時刻順） */
    load: function (input) {
      var arr = [];
      if (typeof input === 'string') {
        input.split('\n').forEach(function (line) {
          line = line.trim();
          if (!line || line[0] === '/' || line[0] === '#') return;
          try { arr.push(JSON.parse(line)); } catch (err) { /* 壊れた行は無視 */ }
        });
      } else if (Array.isArray(input)) {
        arr = input.slice();
      }
      var out = [];
      arr.forEach(function (e, i) {
        var n = normalize(e, i);
        if (n) out.push(n);
      });
      out.sort(function (a, b) { return a.t - b.t; });
      return out;
    },

    /** 表示用の要約 */
    summary: function (events) {
      var spent = 0, paid = 0, failed = 0, actors = {};
      events.forEach(function (e) {
        if (e.type === 'payment.sent' && e.amount) { spent += Number(e.amount.value) || 0; paid++; }
        if (e.type === 'result.error') failed++;
        actors[e.actor] = true;
      });
      return {
        events:  events.length,
        spent:   spent,
        paid:    paid,
        failed:  failed,
        actors:  Object.keys(actors),
        run:     events.length ? events[0].run : '',
        startT:  events.length ? events[0].t : 0,
        endT:    events.length ? events[events.length - 1].t : 0
      };
    }
  };

})(window.AQ = window.AQ || {});
