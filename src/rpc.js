/* =============================================================
   rpc.js — Base の記録を読む窓口（2026-10-23）
   -------------------------------------------------------------
   身分証の読み取り・Builder Code の確認・支払いの確認など、Base への問い合わせはすべてここを通す。
   ・自分用の窓口（Alchemy など）が設定されていれば、まずそこへ聞く
     （配布用ファイルを作るとき、ルートの rpc-url.txt の1行が AQ.config.rpcUrl に入る。build.js）
   ・断られた（回数制限・時間切れ・つながらない）ときは、Base の公式の無料窓口 mainnet.base.org に切り替える
   ・回数制限（HTTP 429）で断られた窓口は、1分間は使わない
   ウォレットに Base を追加するときの窓口（birth.js）は、鍵の入った URL を渡さないよう公式のままにする。
   ============================================================= */
(function (AQ) {
  'use strict';

  var PUBLIC = 'https://mainnet.base.org';
  var timer = window.setTimeout.bind(window);   // 読み込んだときの時計（検査で setTimeout を速めても、待つ上限は変えない）
  var cool = {};                                 // 窓口 → この時刻までは使わない（回数制限のあと）

  function urls() {
    var u = String((AQ.config && AQ.config.rpcUrl) || '').trim();
    return (/^https:\/\//.test(u) && u !== PUBLIC) ? [u, PUBLIC] : [PUBLIC];
  }
  function once(url, payload, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var tm = timer(function () { if (ctl) ctl.abort(); }, ms);
    var o = { method: 'POST', mode: 'cors', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
    if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) {
      clearTimeout(tm);
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }, function (e) {
      clearTimeout(tm);
      var x = new Error(e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e)); x.timeout = !!(e && e.name === 'AbortError'); throw x;
    });
  }
  /** Base に JSON-RPC で1回問い合わせる。結果（result）を返す。どの窓口でもだめなら最後のエラーで失敗する */
  function call(method, params, ms) {
    var list = urls().filter(function (u) { return !(cool[u] > Date.now()); });
    if (!list.length) list = [PUBLIC];
    var i = 0, last = null;
    function next() {
      if (i >= list.length) return Promise.reject(last || new Error('rpc'));
      var u = list[i++];
      return once(u, { jsonrpc: '2.0', id: 1, method: method, params: params || [] }, ms || 12000).then(function (j) {
        if (!j) throw new Error('empty');
        if (j.error) { var e = new Error(j.error.message || 'rpc error'); e.rpc = j.error; throw e; }
        if (!Object.prototype.hasOwnProperty.call(j, 'result')) throw new Error('no result');   // 中身の無い返事も「断られた」とみなす
        return j.result;
      }).catch(function (e) {
        last = e;
        if (e && e.status === 429) cool[u] = Date.now() + 60000;
        return next();
      });
    }
    return next();
  }

  AQ.rpc = { call: call, urls: urls, PUBLIC: PUBLIC };
})(window.AQ = window.AQ || {});
