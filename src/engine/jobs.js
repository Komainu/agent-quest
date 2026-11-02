/* =============================================================
   engine/jobs.js — イベント列 → 依頼（job）ごとの索引
   -------------------------------------------------------------
   何をする場所か:
     Dispatch Log の中で meta.job を持つイベントだけを依頼ID別に
     束ね、①出された→②引き受けた→③納品→④判定 という kibble-v1 の
     書式が自然に持っている順序に沿って「代表イベント」を1件ずつ
     割り当てる。beat（コマ）化とは別腹＝aggregate.js には一切触れない。
     UI（board/dropoff/inspect など）がこの索引を土台にできるよう、
     ここでは描画都合の間引き（maxBoardCards 等）は一切しない。

   ★ 段階の当てはめは fromKibble.js が実際に出している形そのもの。
     ここで「CLAIM が無ければ後の行から推測する」といった穴埋めは
     しない（分からないことは描かない）。JOB 行が無い依頼（板の外で
     もらった依頼が CLAIM から始まる、など）は steps[1] が null の
     まま、known はその分だけ減って正直に出す。

   ★ title / kind の由来:
     fromKibble.js は CLAIM/DELIVER/ATTEST の行にも「そのとき既に
     JOB 行を見ていれば」titleByJob を引き継いで meta.title / meta.kind
     を載せる（2026-09-04 の修正）。つまり同じ依頼の複数の行に同じ
     題名が重複して乗っていることがほとんどだが、取得範囲の先頭が
     JOB 行より後ろだと、どの行にも乗っていないことがある。
     ここでは「①(JOB)行を最優先、無ければ他の行、どれにも無ければ
     null」という規則をそのまま素直に実装するだけで、それ以上の
     穴埋め（他の依頼から借りる、など）はしない。
   ============================================================= */
(function (AQ) {
  'use strict';

  /* イベント1件が①〜④のどれに当たるかを判定する。
     当てはまらない（type が違う、result.ok なのに verdict が
     useful でも空でもない、等）ときは 0 を返す＝rec.events には
     入れるが、どの段階の代表にも件数にも数えない。 */
  function classifyStep(e) {
    var m = e.meta || {};
    if (e.type === 'agent.plan') return 1;
    if (e.type === 'tool.call')  return 2;
    if (e.type === 'result.ok' && !m.verdict)          return 3;
    if (e.type === 'result.ok' && m.verdict === 'useful') return 4;
    if (e.type === 'result.error' && m.verdict === 'not') return 4;
    return 0;
  }

  /** 登場順・重複なしで actor を積む */
  function addUnique(arr, actor) {
    if (actor == null) return;
    if (arr.indexOf(actor) === -1) arr.push(actor);
  }

  /* 「①(JOB)行を最優先、無ければ他の行、どれにも無ければ null」を
     そのまま実装する。捏造しない＝空文字列や undefined は「無い」扱い。 */
  function deriveField(repEvent, eventsAsc, field) {
    if (repEvent) {
      var v0 = (repEvent.meta || {})[field];
      if (v0) return v0;
    }
    for (var i = 0; i < eventsAsc.length; i++) {
      var v = (eventsAsc[i].meta || {})[field];
      if (v) return v;
    }
    return null;
  }

  /** 同じ t のときは元の並び順を保つ（安定ソート）。
      Array#sort は ES2019 以降どの実装でも安定なので、比較関数を
      t の大小だけにすれば同値の相対順序は自然に保たれる。 */
  function byTAsc(a, b) { return a.t - b.t; }

  function buildRecord(id, rawEvents) {
    var events = rawEvents.slice().sort(byTAsc);

    var steps  = { 1: null, 2: null, 3: null, 4: null };
    var counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    var cast   = { poster: null, claimers: [], deliverers: [], judges: [] };

    events.forEach(function (e) {
      var step = classifyStep(e);
      if (!step) return; // どの段階にも当たらない＝件数にも代表にも数えない

      counts[step]++;
      if (!steps[step]) steps[step] = e; // その段階の「最初の1件」だけを代表にする

      if (step === 1)      { if (cast.poster === null) cast.poster = e.actor; }
      else if (step === 2) addUnique(cast.claimers, e.actor);
      else if (step === 3) addUnique(cast.deliverers, e.actor);
      else if (step === 4) addUnique(cast.judges, e.actor);
    });

    var known = 0;
    [1, 2, 3, 4].forEach(function (k) { if (steps[k]) known++; });

    var verdict = null;
    if (steps[4]) {
      var v = (steps[4].meta || {}).verdict;
      verdict = (v === 'useful') ? 'useful' : (v === 'not' ? 'not' : null);
    }

    return {
      id:      id,
      title:   deriveField(steps[1], events, 'title'),
      kind:    deriveField(steps[1], events, 'kind'),
      steps:   steps,
      counts:  counts,
      known:   known,
      cast:    cast,
      verdict: verdict,
      events:  events,
      firstT:  events.length ? events[0].t : null,
      lastT:   events.length ? events[events.length - 1].t : null
    };
  }

  /* known が多い依頼を先に、同数なら直近に動きがあった依頼を先に。
     どちらも同じなら id で決め切る（描画の並びが実行ごとに
     ぶれないようにするための最終タイブレーク）。 */
  function compareRecs(a, b) {
    if (b.known !== a.known) return b.known - a.known;
    if (b.lastT !== a.lastT) return b.lastT - a.lastT;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  }

  AQ.jobs = {

    /**
     * events（questlog.load 済みの Dispatch Log 配列）→
     *   { list: [rec,...], byId: { <jobId>: rec } }
     * meta.job を持たないイベントは依頼と無関係なので完全に無視する。
     */
    index: function (events) {
      var byId = {};
      var order = []; // 依頼ID の初出順（最終的な並びは compareRecs が決める）

      (events || []).forEach(function (e) {
        var m = e.meta || {};
        var jobId = m.job;
        if (jobId == null || jobId === '') return;
        if (!byId[jobId]) { byId[jobId] = []; order.push(jobId); }
        byId[jobId].push(e);
      });

      var list = order.map(function (id) { return buildRecord(id, byId[id]); });
      list.sort(compareRecs);

      var byIdOut = {};
      list.forEach(function (rec) { byIdOut[rec.id] = rec; });

      return { list: list, byId: byIdOut };
    },

    /** rec → 'judged' | 'delivered' | 'claimed' | 'posted' | 'unknown'
        判定・納品・引き受け・投稿のどこまで進んだかを、一番進んだ
        段階1つだけで表す（board/dropoff/inspect の置き場所の判断に使う想定）。*/
    stateOf: function (rec) {
      if (!rec) return 'unknown';
      if (rec.steps[4]) return 'judged';
      if (rec.steps[3]) return 'delivered';
      if (rec.steps[2]) return 'claimed';
      if (rec.steps[1]) return 'posted';
      return 'unknown';
    },

    /** rec → [actor,...]（poster→claimers→deliverers→judges の順、重複なし） */
    castOf: function (rec) {
      var out = [];
      if (!rec) return out;
      addUnique(out, rec.cast.poster);
      (rec.cast.claimers   || []).forEach(function (a) { addUnique(out, a); });
      (rec.cast.deliverers || []).forEach(function (a) { addUnique(out, a); });
      (rec.cast.judges     || []).forEach(function (a) { addUnique(out, a); });
      return out;
    }
  };

})(window.AQ = window.AQ || {});
