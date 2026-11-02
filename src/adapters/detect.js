/* =============================================================
   adapters/detect.js — 「手元のログの形式が分からない」を吸収する
   -------------------------------------------------------------
   初心者向けの入口です。文字列でもパース済みの値でも渡せます。
   中身を見て、上から順に一番それらしい読み方を選びます。
     1) すでに Dispatch Log
     2) technocore.chat の部屋データ（seq / text）
        → さらにメッセージの半分以上が「自称 kibble-v1」書式（JOB/CLAIM/…）
          なら fromKibble、そうでなければ fromTechnocore
     3) x402 のレシート（url と price か txHash）
     4) 送金履歴（hash と value）
     5) それ以外：url らしき文字列があれば、そこだけ見て「呼んだ・受け取った」を推測
   5番目まで来たら「分かること」しか描きません（README の設計上の約束）。
   何にも当てはまらなければ、日本語の短いメッセージで例外を投げます。
   ============================================================= */
(function (AQ) {
  'use strict';

  AQ.adapters = AQ.adapters || {};

  /* ---------- 入力を配列に直す ---------- */

  /** JSON 全体として読めなければ、1行1JSON（JSONL）として読む */
  function parseText(str) {
    var s = String(str == null ? '' : str).trim();
    if (!s) throw new Error('空のデータです');
    try {
      return JSON.parse(s);
    } catch (e) {
      var out = [];
      s.split('\n').forEach(function (line) {
        line = line.trim();
        if (!line || line[0] === '#' || line[0] === '/') return;
        try { out.push(JSON.parse(line)); } catch (e2) { /* 壊れた行は無視 */ }
      });
      if (!out.length) throw new Error('JSON としても JSONL としても読めませんでした');
      return out;
    }
  }

  /** 配列 / { messages:[...] } / { events:[...] } / 単発オブジェクト → 配列 */
  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.messages)) return value.messages;
      if (Array.isArray(value.events)) return value.events;
      return [value];
    }
    return null;
  }

  /* ---------- それぞれの形式の見分け方 ---------- */

  function isObj(o) { return !!o && typeof o === 'object'; }

  function looksLikeDispatchLog(arr) {
    return arr.every(function (e) { return isObj(e) && AQ.questlog.types.indexOf(e.type) !== -1; });
  }

  function looksLikeTechnocore(arr) {
    return arr.every(function (e) { return isObj(e) && 'seq' in e && 'text' in e; });
  }

  /** 元の値そのものが「部屋の応答」の形をしているか（{room:...} や {messages:[...]}）。
      配列がそのまま渡された場合は、中身（1件ずつ seq/text を持つか）で判断する。 */
  function looksLikeTechnocoreRoom(value, arr) {
    if (isObj(value) && !Array.isArray(value) && ('room' in value || Array.isArray(value.messages))) {
      return true;
    }
    return looksLikeTechnocore(arr);
  }

  var KIBBLE_VERB = /^(JOB|CLAIM|DELIVER|RESULT|ATTEST)\s+v\d/i;

  /** メッセージの半分以上が「自称 kibble-v1」書式（JOB v1 | ... など）に見えるか。
      kibble は所有者のいない世界書き込み可能な部屋の、あくまで観測した慣習。 */
  function looksLikeKibble(arr) {
    if (!arr.length) return false;
    var hits = 0;
    arr.forEach(function (m) {
      if (isObj(m) && typeof m.text === 'string' && KIBBLE_VERB.test(m.text.trim())) hits++;
    });
    return hits >= arr.length / 2;
  }
  // LIVE（engine/live.js）が同じ判定を長ポーリングの新着メッセージにも使うための公開関数。
  AQ.adapters.looksLikeKibble = looksLikeKibble;

  function looksLikeX402(arr) {
    return arr.every(function (e) { return isObj(e) && 'url' in e && ('price' in e || 'txHash' in e); });
  }

  function looksLikeTransfers(arr) {
    return arr.every(function (e) { return isObj(e) && 'hash' in e && 'value' in e; });
  }

  function isUrlLike(v) { return typeof v === 'string' && /^https?:\/\//i.test(v); }

  /** その行のどれかのキーに http(s) で始まる文字列があれば、それを URL とみなす */
  function findUrl(row) {
    if (!isObj(row)) return null;
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i++) {
      if (isUrlLike(row[keys[i]])) return row[keys[i]];
    }
    return null;
  }

  var TIME_KEYS = ['t', 'ts', 'time', 'timestamp'];

  /** t / ts / time / timestamp のどれかが数値か、日付として読める文字列なら使う */
  function findTime(row) {
    for (var i = 0; i < TIME_KEYS.length; i++) {
      var v = row[TIME_KEYS[i]];
      if (v == null) continue;
      if (typeof v === 'number' && isFinite(v)) return v;
      var n = Date.parse(v);
      if (!isNaN(n)) return n;
    }
    return null;
  }

  /* ---------- 5番目: 見出しだけからの推測 ---------- */
  function fromGeneric(rows) {
    var runId = 'generic/' + Date.now();
    var now = Date.now();
    var n = rows.length;

    var times = rows.map(function (r) { return findTime(r); });
    if (times.some(function (v) { return v == null; })) {
      // 時刻が分からない行があるので、全部いまから逆算して並べる（推定）
      times = rows.map(function (_, i) { return now - (n - i) * 1500; });
    }

    var out = [];
    out.push({
      v: 1, run: runId, t: (times[0] || now) - 500, actor: 'agent', type: 'run.start',
      target: findUrl(rows[0]) || '', meta: { tSource: 'estimated' }
    });

    rows.forEach(function (row, i) {
      var url = findUrl(row);
      if (!url) return;                 // URL が分からない行は描かない
      var t = times[i];
      out.push({ v: 1, run: runId, t: t,     actor: 'agent', type: 'tool.call',
                 target: url, meta: { tSource: 'estimated' } });
      out.push({ v: 1, run: runId, t: t + 1, actor: 'agent', type: 'result.ok',
                 target: url, meta: { tSource: 'estimated' } });
    });

    out.push({ v: 1, run: runId, t: (times[n - 1] || now) + 500, actor: 'agent', type: 'run.end' });
    return out;
  }

  /* ---------- 公開API ---------- */
  /* ★ 2026-10-08: 画面に出す文は言語の設定に合わせる（英語表示でも日本語が出ていた） */
  function L(key, vars, fallback) {
    if (AQ.i18n && AQ.i18n.t) { var v = AQ.i18n.t(key, vars); if (v !== key) return v; }
    return fallback;
  }

  AQ.adapters.detect = function (input) {
    var value = (typeof input === 'string') ? parseText(input) : input;
    var arr = toArray(value);

    if (!arr || !arr.length) throw new Error(L('load.none', null, '読み込めるデータが見つかりませんでした'));

    if (looksLikeDispatchLog(arr)) {
      return { events: arr, how: L('load.dispatch', null, 'Dispatch Log として読み込みました') };
    }
    if (looksLikeTechnocoreRoom(value, arr)) {
      var room = (isObj(value) && !Array.isArray(value) && value.room) || 'imported';
      if (looksLikeKibble(arr)) {
        return { events: AQ.adapters.fromKibble(arr, { room: room }),
                 how: L('load.kibble', null, 'kibble（technocore.chat）のパイプ区切り書式として読み込みました') };
      }
      return { events: AQ.adapters.fromTechnocore(arr, { room: room }),
               how: L('load.technocore', null, 'technocore.chat の部屋データとして読み込みました') };
    }
    if (looksLikeX402(arr)) {
      return { events: AQ.adapters.fromX402(arr, {}), how: L('load.x402', null, 'x402 のレシートとして読み込みました') };
    }
    if (looksLikeTransfers(arr)) {
      return { events: AQ.adapters.fromTransfers(arr, {}), how: L('load.transfers', null, '送金履歴として読み込みました') };
    }
    if (arr.some(findUrl)) {
      return { events: fromGeneric(arr), how: L('load.generic', null, '見出しから推測して読み込みました（推定）') };
    }

    throw new Error(L('load.unknown', null, 'このデータの形式が分かりませんでした（Dispatch Log / technocore / x402 / 送金履歴 のどれにも合いません）'));
  };

})(window.AQ = window.AQ || {});
