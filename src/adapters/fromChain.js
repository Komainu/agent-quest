/* =============================================================
   adapters/fromChain.js — ウォレットアドレスだけで始める（準備ゼロの入口）
   -------------------------------------------------------------
   ファイルもコードもAPIキーも要らない。アドレスを貼るだけで、
   そのウォレットが「払った」履歴を街として再生します。

   2つに分かれています。
     (a) 純粋な変換（fromChain）    … ネットワークなし。単体テストできる
     (b) 実際の取得（chainFetch）   … ブラウザの fetch を使う（ここだけ）

   Blockscout v2 の /addresses/{a}/token-transfers を読みます。
   送金履歴しか見えないので、「払った」「確定した」しか描きません
   （分からないことは描かない。fromTransfers.js と同じ約束）。
   ============================================================= */
(function (AQ) {
  'use strict';

  AQ.adapters = AQ.adapters || {};

  /* ---------- 補助 ---------- */

  /** 0x1234…ab のような短縮表示 */
  function shortAddr(a) {
    var s = String(a == null ? '' : a);
    if (s.length <= 10) return s;
    return s.slice(0, 6) + '…' + s.slice(-2);
  }

  /** raw / 10^decimals を「文字列のまま」計算する（parseFloat は使わない）。
      小数点を差し込むだけの筆算。丸めず、末尾を最大6桁に切り詰める。
      decimals が分からなければ raw をそのまま文字列で返す。 */
  function divideByDecimals(raw, rawDecimals) {
    if (raw == null) raw = '0';
    if (rawDecimals == null || rawDecimals === '') return String(raw);

    var decimals = parseInt(rawDecimals, 10);
    if (!isFinite(decimals) || decimals <= 0) return String(raw);

    var neg = false;
    var s = String(raw);
    if (s[0] === '-') { neg = true; s = s.slice(1); }

    while (s.length <= decimals) s = '0' + s;          // 桁が足りない分は先頭に0を足す

    var intPart  = s.slice(0, s.length - decimals);
    var fracPart = s.slice(s.length - decimals);

    intPart = intPart.replace(/^0+(?=\d)/, '');         // 先頭の余計な0を削る（"0"は残す）
    fracPart = fracPart.slice(0, 6);                    // 最大6桁に切り詰め（四捨五入しない）
    fracPart = fracPart.replace(/0+$/, '');             // 末尾の0は落とす

    var out = fracPart ? (intPart + '.' + fracPart) : intPart;
    return (neg ? '-' : '') + out;
  }

  /* ---------- (a) 純粋な変換：Blockscout v2 の token-transfers → Dispatch Log ---------- */

  /**
   * @param {Array} items  Blockscout v2 /addresses/{a}/token-transfers の items
   * @param {Object} opts  { address, chain, label }
   *   address … 調べたいウォレット（送金元として一致させる）
   *   chain   … amount.chain に入れるID（例 'base'）
   *   label   … run 名に使う読みやすい呼び名（省略可）
   */
  AQ.adapters.fromChain = function (items, opts) {
    opts = opts || {};
    var address = String(opts.address || '').toLowerCase();
    var chain = opts.chain || 'chain';
    items = Array.isArray(items) ? items : [];

    /* このアドレスから出た送金だけを拾う（＝エージェントが払った分） */
    /* ★ 2026-10-03: 拾うのは USDC の送金だけ（x402 の支払いは USDC）。
       利用者の報告「-912100005.019 のような巨額を使った履歴は無いはず」。
       USDC 以外のトークン（詐欺トークンが勝手に作る「あなたから送った」記録を含む）
       まで「払った額」に足していた。opts.usdc（そのチェーンの本物の USDC の
       コントラクト）があればコントラクトで照合し、名前が USDC でも別物は捨てる。
       無いとき（単体の検査など）は名前が USDC のものだけ。捨てた件数は
       fromChain.skipped に残す（画面で「描かなかった N 件」と言えるように）。 */
    var usdc = opts.usdc ? String(opts.usdc).toLowerCase() : null;
    var skipped = 0;
    var matches = [];
    items.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var from = it.from && it.from.hash;
      if (!from || String(from).toLowerCase() !== address) return;

      var t = Date.parse(it.timestamp);
      if (isNaN(t)) return;                              // 時刻が読めない行は描かない

      var total = it.total || {};
      var token = it.token || {};
      var tokenAddr = String(token.address || token.address_hash || '').toLowerCase();
      var isUsdc = usdc ? (tokenAddr === usdc) : (String(token.symbol || '').toUpperCase() === 'USDC');
      if (!isUsdc) { skipped++; return; }
      var amount = {
        asset: token.symbol || 'TOKEN',
        value: divideByDecimals(total.value, total.decimals),
        chain: chain
      };
      var target = (it.to && it.to.hash) || '';
      var tx = it.transaction_hash || '';

      /* ★ 2026-10-06: 送金のしかた（transferWithAuthorization＝署名で払う x402 と同じ方式か）。
         分からなければ null（立会人が確かめた、とは描かない）。 */
      var method = (typeof it.method === 'string' && it.method) ? it.method : null;
      /* エクスプローラが関数名を解読できないと、名前ではなく関数の番号（selector）が
         入ってくる。transferWithAuthorization の番号（v,r,s 版 0xe3ee160e／
         署名まとめ版 0xcf092995）なら、名前にそろえる。 */
      if (method && (/^0x(e3ee160e|cf092995)$/i.test(method) || /^transferwithauthorization$/i.test(method))) {
        method = 'transferWithAuthorization';
      }
      matches.push({ t: t, amount: amount, target: target, tx: tx, method: method });
    });

    AQ.adapters.fromChain.skipped = skipped;
    if (!matches.length) {
      var nf = new Error(skipped
        ? L('chain.noUsdc', { n: skipped }, 'このアドレスからの USDC の送金が見つかりませんでした（USDC 以外の送金 ' + skipped + ' 件は描いていません）')
        : L('chain.noTransfers', null, 'このアドレスからの送金が見つかりませんでした'));
      nf.code = 'notFound';
      throw nf;
    }

    matches.sort(function (a, b) { return a.t - b.t; });

    var actor = shortAddr(opts.address);
    var run = (opts.label || chain) + '/' + shortAddr(opts.address);
    var out = [];

    /* 残高は分からないので budget は入れない（分からないことは描かない） */
    out.push({
      v: 1, run: run, t: matches[0].t - 1, actor: actor, type: 'run.start',
      target: matches[0].target, meta: { tSource: 'chain' }
    });

    matches.forEach(function (m) {
      out.push({ v: 1, run: run, t: m.t, actor: actor, type: 'payment.sent',
                 target: m.target, amount: m.amount, meta: { tSource: 'chain', method: m.method } });
      out.push({ v: 1, run: run, t: m.t + 1, actor: actor, type: 'payment.settled',
                 amount: m.amount, tx: m.tx, meta: { tSource: 'chain', method: m.method } });
    });

    out.push({
      v: 1, run: run, t: matches[matches.length - 1].t + 100, actor: actor, type: 'run.end',
      meta: { tSource: 'chain' }
    });

    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  };

  /* ---------- (b) 実際の取得：ブラウザの fetch だけがここに出てくる ---------- */

  /**
   * @param {string} address  0x… の42文字
   * @param {string} chainId  data/chains.js の id
   * @returns {Promise<{events:Array, how:string}>}
   */
  function L(key, vars, fallback) {
    if (AQ.i18n && AQ.i18n.t) { var v = AQ.i18n.t(key, vars); if (v !== key) return v; }
    return fallback;
  }

  AQ.adapters.chainFetch = function (address, chainId) {
    return new Promise(function (resolve, reject) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) {
        reject(new Error(L('chain.badAddr', null, 'アドレスの形式が違います（0x で始まる42文字）')));
        return;
      }

      var list = AQ.chains || [];
      var chain = list.filter(function (c) { return c.id === chainId; })[0] || list[0];
      if (!chain) { reject(new Error(L('chain.noChain', null, '対応チェーンが設定されていません'))); return; }

      var url = chain.api + '/addresses/' + address + '/token-transfers?type=ERC-20';
      var host = chain.api.replace(/^https?:\/\//, '').split('/')[0];

      fetch(url, { mode: 'cors' }).then(function (res) {
        if (!res.ok) { reject(new Error(L('chain.http', { status: res.status }, '読み込めませんでした（HTTP ' + res.status + '）'))); return; }
        return res.json().then(function (data) {
          var events = AQ.adapters.fromChain((data && data.items) || [], { address: address, chain: chain.id, usdc: chain.usdc });
          var n = events.filter(function (e) { return e.type === 'payment.sent'; }).length;
          var sk = AQ.adapters.fromChain.skipped || 0;
          resolve({ events: events, skipped: sk,
                    how: sk ? L('chain.loadedSkip', { chain: chain.label, n: n, sk: sk }, chain.label + ' の USDC の送金履歴として読み込みました（' + n + '件・USDC 以外の送金 ' + sk + ' 件は描いていません）')
                            : L('chain.loaded', { chain: chain.label, n: n }, chain.label + ' の USDC の送金履歴として読み込みました（' + n + '件）') });
        });
      }).catch(function (err) {
        // fromChain が投げた「見つかりませんでした」もここに来るので、
        // その日本語メッセージがあればそのまま使う
        if (err && err.code === 'notFound') {
          reject(err);
          return;
        }
        reject(new Error(L('chain.cors', { host: host }, 'このブラウザから ' + host + ' に接続できませんでした（CORS またはネットワーク）')));
      });
    });
  };

})(window.AQ = window.AQ || {});
