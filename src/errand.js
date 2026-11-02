/* =============================================================
   errand.js — ロボットの「お使い（x402）」と「身分証を育てる（ERC-8004）」（2026-10-11）
   -------------------------------------------------------------
   利用者「kibble 以外の行動も。選ぶだけで、できるだけ実際の用法を。x402 のサービスも」
   → 提案 ① x402 でお使い → ② 身分証を育てる、の順で作ることになった。

   ① x402 でお使い（CoinGecko の有料 API を1回 0.01 USDC で買う）
     調べたこと（2026-10-11）
       ・x402 Bazaar の公式おすすめのうち、ほかのサイトのページ（＝このアプリ）から
         呼べたのは CoinGecko だけ（BlockRun・Exa・天気系はブラウザからの呼び出しを断る）
       ・CoinGecko の 402 の返事は、支払い条件（PAYMENT-REQUIRED ヘッダー）をブラウザに見せない
         → Bazaar に公開されている条件をそのまま使う（下の REQ）。
         Base 上で、この受取先に 0.01 USDC が transferWithAuthorization で実際に届いていることも確認済み
       ・払い方は x402 v2 の "exact"（@x402/core・@x402/evm 2.28.0 の作りに合わせた）
           PAYMENT-SIGNATURE: base64( {x402Version:2, resource, accepted, payload:{authorization, signature}} )
           signature = EIP-712「TransferWithAuthorization」（USDC の EIP-3009）への署名
         署名するだけで、ガス代は払わない（チェーンに載せるのは立会人＝ファシリテータ）
     作り話をしない
       ・「払えた」と言うのは、お店が 200 で中身を返したときだけ
       ・チェーンの取引（tx）は、Base の記録（Blockscout）で実際に見つけたものだけを出す
       ・街の場面は、このとき実際に起きた順（頼む → 402 → 署名して頼みなおす → 確定 → 受け取る）

   ② 身分証を育てる（ERC-8004 の setAgentURI、ガス代1回）
       ・登録ファイルの形は EIP-8004 の本文どおり（type / name / description / services / active / registrations）
       ・送る前に、Base 上でその番号の持ち主が今つないでいる財布かを確かめる（ownerOf）
       ・書き換わったかは、URIUpdated の記録と、読み直した tokenURI で確かめる
   ============================================================= */
(function (AQ) {
  'use strict';

  function t(k, v) { return AQ.i18n.t(k, v); }
  function $(id) { return document.getElementById(id); }
  function W() { return AQ.birth && AQ.birth.wallet; }
  function mine() { return (AQ.birth && AQ.birth.mine && AQ.birth.mine()) || null; }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function n64(n) { var h = BigInt(n).toString(16); return '0'.repeat(64 - h.length) + h; }
  function hexOf(s) { var b = new TextEncoder().encode(String(s)), h = ''; for (var i = 0; i < b.length; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16); return h; }
  function pad64(h) { var r = h.length % 64; return r ? h + '0'.repeat(64 - r) : h; }
  function b64(s) { var u = new TextEncoder().encode(s), x = ''; for (var i = 0; i < u.length; i++) x += String.fromCharCode(u[i]); return btoa(x); }
  function short(a) { a = String(a || ''); return a.slice(0, 6) + '…' + a.slice(-4); }
  function errMsg(e) { return String((e && ((e.data && e.data.message) || e.shortMessage || e.message)) || e || '').slice(0, 140); }

  function status(key, vars, kind) { stopTick(); drawStatus(key, vars, kind); }
  function drawStatus(key, vars, kind) {
    var el = $('robotStatus'); if (!el) return;
    el.textContent = key ? t(key, vars) : '';
    el.className = 'birth-status' + (kind ? ' ' + kind : '');
  }
  /* ★ 2026-10-21 待っているあいだは秒数を数えて見せる（利用者の報告：「署名を付けて、もう一度頼んでいます…」で固まって見えた） */
  var tickT = null;
  function tick(key, vars) {
    stopTick();
    var t0 = Date.now();
    function draw() { drawStatus(key, vars); var el = $('robotStatus'); if (el) el.textContent += t('errand.secs', { sec: Math.round((Date.now() - t0) / 1000) }); }
    draw(); tickT = setInterval(draw, 1000);
  }
  function stopTick() { if (tickT) { clearInterval(tickT); tickT = null; } }
  /* 返事を待つ時間に上限を付ける（上限が無いと、お店や立会人が黙ったときに止まったままになる） */
  var timer = window.setTimeout.bind(window);   // 読み込んだときの時計（検査で setTimeout を速めても、返事を待つ上限は変えない）
  function fetchT(url, ms, opt) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var tm = timer(function () { if (ctl) ctl.abort(); }, ms);
    var o = opt || {}; o.mode = 'cors'; if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) { clearTimeout(tm); return r; }, function (e) {
      clearTimeout(tm);
      var x = new Error(e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e)); x.net = true; x.timeout = !!(e && e.name === 'AbortError'); throw x;
    });
  }
  /* この署名（nonce）の支払いが、もうチェーンに載ったか（USDC の authorizationState。Base の記録そのもの） */
  var SEL_AUTH_STATE = '0xe94a0102';   // authorizationState(address,bytes32)
  /* ★ 2026-10-25 待ち時間を短く（利用者の報告：お店が止まっていると待たされる時間が長い）。
     署名のあとの支払いは、ふつう数秒で返事が来るので 20 秒で見切り、Base の記録を約 6 秒だけ確かめる。
     最初の 402 は、窓を開いたときにお店を起こしておく（wake）ので 40 秒まで */
  var TIMING = { first: 40000, paid: 20000, gap: 3000, tries: 3 };   // テストでは短くする（_timing）
  function authUsed(acc, nonce) {
    return W().rpc('eth_call', [{ to: USDC, data: SEL_AUTH_STATE + n64(acc) + String(nonce).replace(/^0x/, '') }, 'latest'])
      .then(function (r) { return !!r && r !== '0x' && BigInt(r) !== 0n; });
  }
  function waitAuthUsed(acc, nonce, tries) {
    return new Promise(function (resolve) {
      var n = 0;
      (function poll() {
        authUsed(acc, nonce).then(function (u) { if (u) resolve(true); else if (++n >= tries) resolve(false); else setTimeout(poll, TIMING.gap); },
                                  function () { if (++n >= tries) resolve(null); else setTimeout(poll, TIMING.gap); });
      })();
    });
  }
  /* ★ 2026-10-22 支払いの取引を、Blockscout ではなく Base の記録から直接さがす（利用者のパソコンでは Blockscout が
     返事をしないことが多い）。USDC の契約が出す AuthorizationUsed（この署名の nonce が使われた）の記録を、
     ウォレットの窓口 → Base の公式の窓口の順に、直近の約 20 分ぶんだけ読む */
  var TOPIC_AUTH_USED = '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5';   // AuthorizationUsed(address,bytes32)
  function publicRpc(method, params) { return AQ.rpc.call(method, params, 8000); }   // 自分用の窓口 → 公式の窓口（src/rpc.js）
  function logsByNonce(rpc, acc, nonce) {
    return rpc('eth_blockNumber', []).then(function (bn) {
      var to = BigInt(bn), from = to > 600n ? to - 600n : 0n;
      return rpc('eth_getLogs', [{ address: USDC, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [TOPIC_AUTH_USED, '0x' + n64(acc), nonce] }]);
    }).then(function (logs) { var L = (logs || [])[0]; return L && L.transactionHash ? { transaction_hash: L.transactionHash, timestamp: null } : null; });
  }
  function findByNonce(acc, nonce, tries) {
    return new Promise(function (resolve) {
      var n = 0;
      (function again() {
        logsByNonce(function (m, p) { return W().rpc(m, p); }, acc, nonce)
          .catch(function () { return null; })
          .then(function (hit) { return hit || logsByNonce(publicRpc, acc, nonce).catch(function () { return null; }); })
          .then(function (hit) { if (hit) resolve(hit); else if (++n >= tries) resolve(null); else setTimeout(again, 2500); });
      })();
    });
  }
  /** 品物が届いたあと：支払いの取引を探す。Base の記録（nonce）と Blockscout を同時に試し、先に見つかった方を使う。
      取引の番号が分からなくても、この署名が使われたこと（authorizationState）が確かめられれば「支払いは確認ずみ」 */
  function settleOf(acc, x, req) {
    var paidP = x.nonce ? authUsed(acc, x.nonce).catch(function () { return null; }) : Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false, left = 2;
      function end(hit) {
        if (done) return;
        if (hit) { done = true; resolve(hit); return; }
        if (--left > 0) return;
        done = true; paidP.then(function (u) { resolve(u ? { paid: true } : null); });
      }
      if (x.nonce) findByNonce(acc, x.nonce, 4).then(end, function () { end(null); }); else end(null);
      findSettlement(acc, x.tSent || x.t0, req, 6).then(end, function () { end(null); });
      timer(function () { if (!done) { done = true; paidP.then(function (u) { resolve(u ? { paid: true } : null); }); } }, 20000);   // 長くても 20 秒で切り上げる
    });
  }

  /* 成功の返事のヘッダー（PAYMENT-RESPONSE）に、立会人が載せた取引の番号が入っていれば、それを使う */
  function txFromHeader(r) {
    try {
      var h = r.headers.get('PAYMENT-RESPONSE') || r.headers.get('X-PAYMENT-RESPONSE');
      if (!h) return null;
      var j = JSON.parse(atob(h.trim()));
      var tx = j && (j.transaction || j.txHash || j.transactionHash);
      return /^0x[0-9a-fA-F]{64}$/.test(String(tx || '')) ? String(tx) : null;
    } catch (e) { return null; }
  }
  var busy = false;
  function setBusy(b) {
    busy = b;
    Array.prototype.forEach.call(document.querySelectorAll('#robotErrand button, #robotCard button'), function (x) { x.disabled = b; });
  }

  /* 財布につないで、Base に切り替え、その財布がロボットの持ち主（＝登録した財布）かを確かめる */
  function readyOwner(d) {
    var w = W();
    if (!w || (!w.provider() && !(w.needsPick && w.needsPick()))) { var e0 = new Error('no wallet'); e0.aq = 'errand.noWallet'; return Promise.reject(e0); }
    return w.connect().then(function (acc) {
      if (!acc) { var e1 = new Error('no account'); e1.aq = (w.needsPick && w.needsPick()) ? 'errand.pickWallet' : 'errand.noAccount'; throw e1; }
      if (String(acc).toLowerCase() !== String(d.owner).toLowerCase()) {
        var e2 = new Error('not owner'); e2.aq = 'errand.notOwner'; e2.vars = { acc: short(acc), owner: short(d.owner) }; throw e2;
      }
      return w.ensureBase().then(function () { return acc; });
    });
  }

  /* =================== ① x402 でお使い =================== */
  var USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  /* お店（2026-10-11 に、このアプリのページから呼べることを確かめた2軒）
     price … CoinGecko（Bazaar の公式おすすめ）。402 の支払い条件（PAYMENT-REQUIRED）をブラウザに
             見せない設定なので、Bazaar に公開されている条件（req）を使う
     news  … News Search & Headlines（GDELT・主要メディア・Hacker News の見出し）。
             PAYMENT-REQUIRED をブラウザに見せてくれるので、その場で読んだ条件で払う（x402 の本来の手順）
     どちらも受取先に transferWithAuthorization の支払いが実際に届いていることを Base の記録で確認済み */
  var SHOPS = {
    price: {
      resource: 'https://pro-api.coingecko.com/api/v3/x402/onchain/search/pools',
      req: { scheme: 'exact', network: 'eip155:8453', amount: '10000', asset: USDC,
             payTo: '0x110cdBba7FE6434Ec4CE3464CC523942ad6Fb784', maxTimeoutSeconds: 60,
             extra: { name: 'USD Coin', version: '2' } },
      url: function (q) { return this.resource + '?query=' + encodeURIComponent(q) + '&network=base&include=base_token&page=1'; },
      choices: [{ key: 'weth', query: 'weth' }, { key: 'aero', query: 'aero' }, { key: 'degen', query: 'degen' }],
      read: function (j) {
        var d = j && j.data && j.data[0] && j.data[0].attributes;
        if (!d) return null;
        var p = Number(d.base_token_price_usd);
        return { kind: 'price', pool: String(d.name || ''), usd: isFinite(p) ? p : null,
                 dex: (j.data[0].relationships && j.data[0].relationships.dex && j.data[0].relationships.dex.data && j.data[0].relationships.dex.data.id) || '' };
      }
    },
    news: {
      resource: 'https://x402-seller-pmlm.onrender.com/news',
      req: null,                                   // その場で 402 から読む
      url: function (q) { return this.resource + '?q=' + encodeURIComponent(q) + '&limit=5&hours=48'; },
      choices: [{ key: 'base', query: 'Base blockchain' }, { key: 'ethereum', query: 'Ethereum' }, { key: 'agents', query: 'AI agents' }],
      read: function (j) {
        var arts = ((j && j.articles) || []).slice(0, 5).map(function (a) {
          var u = String((a && a.url) || '');
          return { title: String((a && a.title) || '').slice(0, 200), source: String((a && a.source) || '').slice(0, 60),
                   at: (a && a.publishedAt) || null, url: /^https:\/\//.test(u) ? u : '' };
        }).filter(function (a) { return a.title; });
        return { kind: 'news', articles: arts, count: (j && j.count) || arts.length };
      }
    }
  };
  var LOG_STORE = 'aq.myAgent.errands';
  var shopKey = 'news';
  var choice = 'base';
  function shop() { return SHOPS[shopKey]; }
  function priceOf(req) { return (Number(req.amount) / 1e6).toString(); }

  /** 402 の返事の PAYMENT-REQUIRED（base64 の JSON）から、Base の USDC で払える条件を選ぶ */
  function pickRequirement(r) {
    var h = r.headers.get('payment-required');
    if (!h) return null;
    var pr = null; try { pr = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(h), function (c) { return c.charCodeAt(0); }))); } catch (e) { return null; }
    var acc = ((pr && pr.accepts) || []).filter(function (a) {
      return a && a.scheme === 'exact' && a.network === 'eip155:8453' && String(a.asset).toLowerCase() === USDC.toLowerCase() &&
             a.extra && a.extra.name && a.extra.version && /^\d+$/.test(String(a.amount)) && /^0x[0-9a-fA-F]{40}$/.test(String(a.payTo));
    })[0];
    return acc ? { req: acc, resource: pr.resource || null, extensions: pr.extensions || null } : null;
  }

  function randHex32() { var b = new Uint8Array(32); crypto.getRandomValues(b); return '0x' + Array.from(b).map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function typedData(req, from, validBefore, nonce) {
    return {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' },
                       { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
        TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }]
      },
      primaryType: 'TransferWithAuthorization',
      domain: { name: req.extra.name, version: req.extra.version, chainId: 8453, verifyingContract: req.asset },
      message: { from: from, to: req.payTo, value: req.amount, validAfter: '0', validBefore: String(validBefore), nonce: nonce }
    };
  }
  /** 支払いの見出し（x402 v2 の PaymentPayload を base64 にしたもの） */
  function paymentHeader(req, resource, auth, signature, extensions) {
    var o = { x402Version: 2, resource: resource, accepted: req, payload: { authorization: auth, signature: signature } };
    if (extensions) o.extensions = extensions;
    return b64(JSON.stringify(o));
  }
  /* ★ 2026-10-13 Builder Code を x402 の支払いにも（@x402/extensions の builder-code と同じ形）。
     お店が 402 で出した extensions をそのまま返し（x402 の手順どおり）、builder-code の s に
     このアプリのコードを足す。お店が builder-code を出していないとき（または条件が読めないとき）は
     何も足さない（知らない拡張を送って断られないように）。実際に印が入るかは立会人しだい。 */
  function withBuilderCode(ext) {
    var code = AQ.config && AQ.config.builderCode;
    if (!ext || typeof ext !== 'object' || !ext['builder-code'] || !code || !/^[a-z0-9_]{1,32}$/.test(code)) return ext || null;
    var out = JSON.parse(JSON.stringify(ext));
    var bc = out['builder-code']; bc.info = (bc.info && typeof bc.info === 'object') ? bc.info : {};
    var s = Array.isArray(bc.info.s) ? bc.info.s.slice() : [];
    if (s.indexOf(code) < 0) s.push(code);
    bc.info.s = s.slice(0, 11);
    return out;
  }
  function usdcBalance(acc) {
    return W().rpc('eth_call', [{ to: USDC, data: '0x70a08231' + n64(acc) }, 'latest']).then(function (r) { return BigInt(r && r !== '0x' ? r : '0x0'); });
  }
  function fmtUsd(p) { if (p == null) return '—'; return '$' + (p >= 1 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p.toPrecision(4)); }

  /** Base の記録で、この支払い（自分 → お店の受取先、その金額）を探す */
  function findSettlement(acc, since, req, maxTries) {
    /* ★ 2026-10-11 総点検: 少し前の同じ額の支払い（前回のお使い）を取り違えないよう、
       署名を送ったあと（時計のずれ30秒まで）のものだけ・前に使った取引は除く */
    var used = {}; loadLog().forEach(function (x) { if (x && x.tx) used[String(x.tx).toLowerCase()] = 1; });
    var chain = (AQ.chains || []).filter(function (c) { return c.id === 'base'; })[0];
    if (!chain) return Promise.resolve(null);
    var tries = 0;
    return new Promise(function (resolve) {
      (function poll() {
        fetch(chain.api + '/addresses/' + acc + '/token-transfers?type=ERC-20', { mode: 'cors' }).then(function (r) { return r.ok ? r.json() : { items: [] }; })
          .then(function (j) {
            var hit = ((j && j.items) || []).filter(function (it) {
              var tok = String((it.token && (it.token.address || it.token.address_hash)) || '').toLowerCase();
              return it.from && String(it.from.hash).toLowerCase() === String(acc).toLowerCase() &&
                     it.to && String(it.to.hash).toLowerCase() === String(req.payTo).toLowerCase() &&
                     tok === USDC.toLowerCase() && it.total && String(it.total.value) === String(req.amount) &&
                     Date.parse(it.timestamp) >= since - 30000 && !used[String(it.transaction_hash || '').toLowerCase()];
            })[0];
            if (hit) { resolve(hit); return; }
            if (++tries >= (maxTries || 30)) { resolve(null); return; }
            setTimeout(poll, 3000);
          }).catch(function () { if (++tries >= (maxTries || 30)) resolve(null); else setTimeout(poll, 3000); });
      })();
    });
  }

  function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_STORE) || '[]') || []; } catch (e) { return []; } }
  function saveLog(x) { var a = loadLog(); a.push(x); try { localStorage.setItem(LOG_STORE, JSON.stringify(a.slice(-20))); } catch (e) {} }

  function actorKey(d) { return 'agent #' + d.agentId + ' (' + d.name + ')'; }
  function itemOf(x) {
    var r = x.result;
    if (r && r.kind === 'news' && !Array.isArray(r.articles)) r.articles = [];
    if (r && r.kind === 'news') return (r.articles[0] ? r.articles[0].title.slice(0, 60) : 'news') + (r.articles.length > 1 ? ' (+' + (r.articles.length - 1) + ')' : '');
    if (r && r.kind === 'price') return r.pool + ' ' + fmtUsd(r.usd);
    if (r && r.pool) return r.pool + ' ' + fmtUsd(r.usd);     // 以前の記録（kind が無い）
    return 'data.json';
  }

  /** このとき実際に起きたことだけで、街の場面を作る */
  function errandEvents(x, d) {
    var A = actorKey(d), RUN = 'x402-errand/' + x.t0;
    var AMT = { asset: 'USDC', value: x.price || '0.01', chain: 'base' };
    var url = x.url;
    var ev = [
      { v: 1, run: RUN, t: x.t0 - 1, actor: A, type: 'run.start', target: url, meta: { tSource: 'local', errand: true } },
      { v: 1, run: RUN, t: x.t0, actor: A, type: 'tool.call', target: url, meta: { tSource: 'local' } },
      { v: 1, run: RUN, t: x.t402, actor: A, type: 'payment.required', target: url, amount: AMT, meta: { tSource: 'local', payTo: x.payTo } },
      { v: 1, run: RUN, t: x.t402 + 1, actor: A, type: 'result.error', target: url, status: '402', meta: { tSource: 'local' } },
      { v: 1, run: RUN, t: x.tSent, actor: A, type: 'payment.sent', target: url, amount: AMT, meta: { tSource: 'local', method: 'transferWithAuthorization' } }
    ];
    var tOk = x.tOk;
    if (x.tx) {
      var ts = x.tChain || x.tOk - 1;
      /* チェーンの時刻は秒まで。手元の時計とのずれで「受け取った」より後になったら、
         順番だけはそろえる（受け取ったのは確定のあと＝x402 の仕様） */
      if (ts <= x.tSent) ts = x.tSent + 1;
      if (tOk <= ts) tOk = ts + 1;
      ev.push({ v: 1, run: RUN, t: ts, actor: A, type: 'payment.settled', amount: AMT, tx: x.tx,
                meta: { tSource: 'chain', method: 'transferWithAuthorization', goodsSeen: true } });
    }
    ev.push({ v: 1, run: RUN, t: tOk, actor: A, type: 'result.ok', target: url, status: '200', item: itemOf(x), meta: { tSource: 'local' } });
    ev.push({ v: 1, run: RUN, t: tOk + 400, actor: A, type: 'run.end', meta: { tSource: 'local' } });
    return ev;
  }

  var last = null;
  function goErrand() {
    var d = mine(); if (!d || busy) return;
    var S = shop(), sk = shopKey;
    var pick = S.choices.filter(function (e) { return e.key === choice; })[0];
    var q = pick ? pick.query : String(($('errandFree') && $('errandFree').value) || '').trim().slice(0, 80);
    if (!q) { status('errand.needQuery', null, 'bad'); return; }
    var url = S.url(q), acc = null, req = S.req, resource = { url: S.resource, description: '', mimeType: 'application/json' }, exts = null;
    var x = { t0: 0, url: url, query: q, shop: sk };
    setBusy(true); last = null; renderResult();
    status('errand.connecting');
    readyOwner(d).then(function (a) {
      acc = a;
      tick('errand.asking', { shop: hostOf(url) });
      x.t0 = Date.now();
      /* 寝ているお店（無料のサーバー）は起きるのに時間がかかるので、最初の1回は少し長めに待つ（窓を開いたときに起こしてある） */
      return fetchT(url, TIMING.first).catch(function (e) {
        if (e && e.net) { var eA = new Error('shop silent'); eA.aq = e.timeout ? 'errand.shopSlow' : 'errand.shopDown'; eA.vars = { shop: hostOf(url), sec: Math.round(TIMING.first / 1000) }; throw eA; }
        throw e;
      });
    }).then(function (r) {
      x.t402 = Date.now();
      if (r.status !== 402) { var e = new Error('HTTP ' + r.status); e.aq = 'errand.not402'; e.vars = { status: r.status }; throw e; }
      if (!req) {
        var got = pickRequirement(r);
        if (!got) { var e2 = new Error('no requirement'); e2.aq = 'errand.noReq'; throw e2; }
        req = got.req; if (got.resource) resource = got.resource; exts = withBuilderCode(got.extensions);
      }
      if (Number(req.amount) > 50000) { var e3 = new Error('too expensive'); e3.aq = 'errand.tooMuch'; e3.vars = { price: priceOf(req) }; throw e3; }
      x.price = priceOf(req); x.payTo = req.payTo;
      return usdcBalance(acc);
    }).then(function (bal) {
      if (bal < BigInt(req.amount)) { var e = new Error('low'); e.aq = 'errand.lowUsdc'; e.vars = { price: x.price }; throw e; }
      status('errand.sign', { price: x.price });
      var validBefore = Math.floor(Date.now() / 1000) + Math.min(Number(req.maxTimeoutSeconds) || 60, 300);
      var nonce = randHex32(); x.nonce = nonce;
      var auth = { from: acc, to: req.payTo, value: String(req.amount), validAfter: '0', validBefore: String(validBefore), nonce: nonce };
      return W().rpc('eth_signTypedData_v4', [acc, JSON.stringify(typedData(req, acc, validBefore, nonce))]).then(function (sig) {
        x.tSent = Date.now();
        tick('errand.paying');
        return fetchT(url, TIMING.paid, { headers: { 'PAYMENT-SIGNATURE': paymentHeader(req, resource, auth, sig, exts) } }).catch(function (e) {
          if (!e || !e.net) throw e;
          /* ★ 2026-10-21 お店から返事が来ない（時間切れ・通信の失敗）。お金が動いたかどうかを、
             Base の記録（この署名の nonce が使われたか）で確かめてから、正直に伝える */
          tick('errand.checkPaid');
          return waitAuthUsed(acc, nonce, TIMING.tries).then(function (used) {
            var eP = new Error('no answer');
            eP.aq = used === true ? 'errand.paidNoGoods' : (used === false ? 'errand.notPaid' : 'errand.unknownPaid');
            eP.vars = { price: x.price, shop: hostOf(url) };
            throw eP;
          });
        });
      });
    }).then(function (r) {
      x.txHeader = txFromHeader(r);
      return r.text().then(function (txt) {
        x.tOk = Date.now();
        if (r.status !== 200 && x.tSent - x.t402 > (Number(req.maxTimeoutSeconds) || 60) * 1000) {
          var eS = new Error('slow'); eS.aq = 'errand.tooSlow'; eS.vars = { sec: Number(req.maxTimeoutSeconds) || 60 }; throw eS;
        }
        if (r.status !== 200) {
          var e = new Error(txt.slice(0, 120) || ('HTTP ' + r.status)); e.aq = 'errand.refused'; e.vars = { status: r.status, msg: txt.replace(/\s+/g, ' ').slice(0, 100) }; throw e;
        }
        var j = null; try { j = JSON.parse(txt); } catch (e2) {}
        x.result = SHOPS[sk].read(j);
        if (x.txHeader) return { transaction_hash: x.txHeader, timestamp: null };   // 取引の番号はお店の返事に入っていた
        tick('errand.findTx');
        return settleOf(acc, x, req);
      });
    }).then(function (hit) {
      if (hit && hit.transaction_hash) { x.tx = hit.transaction_hash; x.tChain = hit.timestamp ? Date.parse(hit.timestamp) : null; }
      if (hit && hit.paid) x.paid = true;
      last = x;
      var rec = { t: x.t0, t0: x.t0, shop: sk, query: q, result: x.result, tx: x.tx || null, paid: !!(x.tx || x.paid), tChain: x.tChain || null, t402: x.t402, tSent: x.tSent, tOk: x.tOk, url: url, price: x.price, payTo: x.payTo };
      saveLog(rec);
      if (AQ.activity) AQ.activity.add({ kind: 'errand', t: x.t0, x: rec });
      status(x.tx ? 'errand.done' : (x.paid ? 'errand.donePaid' : 'errand.doneNoTx'), { price: x.price, what: t('errand.what.' + (sk === 'news' ? 'news' : 'price')) }, 'good');
      renderResult();
    }).catch(function (e) {
      if (e && e.code === 4001) status('errand.rejected', null, 'bad');
      else status((e && e.aq) || 'errand.failed', (e && e.vars) || { msg: errMsg(e) }, 'bad');
      /* ★ 2026-10-21 お店の側で止まったとき（利用者の要望）：クエストの窓では「完了にする」ボタンを出す。
         自分の操作（取り消し・USDC 不足・署名が遅い）で止まったときは出さない（やり直せるので） */
      var why = (e && e.code !== 4001) ? ((e && e.aq) || 'errand.failed') : null;
      if (why && SHOP_SIDE.indexOf(why) >= 0 && sk === 'news' && AQ.quest && AQ.quest.offerSkip) AQ.quest.offerSkip('news', why, { shop: hostOf(url) });
    }).then(function () { setBusy(false); });
  }
  var SHOP_SIDE = ['errand.shopSlow', 'errand.shopDown', 'errand.not402', 'errand.refused', 'errand.notPaid', 'errand.paidNoGoods', 'errand.unknownPaid', 'errand.failed'];
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return String(u); } }

  /* ★ 2026-10-19 クエストの窓では、お店をそのクエストの1軒に固定する（利用者の報告：
     「ニュースを買う」の窓に「値段」のタブと、前に買った値段の結果が出ていて分かりにくい）。
     固定中はお店のタブを隠し、結果もそのお店で買ったものだけを見せる。 */
  var lockShop = null;
  /* お店を前もって起こしておく（無料のサーバーは、しばらく使われないと眠る）。
     返事は見ない。5 分に 1 回まで */
  var woke = {};
  function wake(k) {
    var S = SHOPS[k]; if (!S || !S.resource) return;
    var o; try { o = new URL(S.resource).origin; } catch (e) { return; }
    if (!/\.onrender\.com$/.test(new URL(o).host)) return;   // 眠るのは無料のサーバーだけ
    if (woke[o] && Date.now() - woke[o] < 300000) return;
    woke[o] = Date.now();
    try { fetch(o + '/', { mode: 'no-cors', cache: 'no-store' }).catch(function () {}); } catch (e) {}
  }
  function lock(k) {
    lockShop = (k && SHOPS[k]) ? k : null;
    if (lockShop) wake(lockShop);
    if (lockShop && shopKey !== lockShop) pickShop(lockShop);
    if ($('errandShops')) $('errandShops').style.display = lockShop ? 'none' : '';
    if ($('errandLead')) $('errandLead').style.display = lockShop ? 'none' : '';   // クエストの説明と同じことを2度言わない
    renderResult();
  }
  function renderResult() {
    var box = $('errandResult'); if (!box) return;
    box.innerHTML = '';
    var x = last;
    if (lockShop && x && x.shop !== lockShop) x = null;
    if (!x) x = loadLog().filter(function (r) { return !lockShop || r.shop === lockShop; }).slice(-1)[0];
    if (!x) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(mk('span', 'robot-job-lbl', t('errand.got')));
    var r = x.result;
    if (r && r.kind === 'news') {
      if (!Array.isArray(r.articles)) r.articles = [];
      if (!r.articles.length) box.appendChild(mk('small', 'robot-job-sub', t('errand.noNews')));
      box.appendChild(mk('small', 'robot-job-sub', t('errand.newsRaw')));
      var ul = mk('ul', 'errand-news'); ul.setAttribute('data-foreign', ''); ul.setAttribute('translate', 'no');
      var trItems = [];
      r.articles.forEach(function (a) {
        var li = mk('li'), te;
        if (a.url) { te = mk('a', null, a.title); te.href = a.url; te.target = '_blank'; te.rel = 'noopener noreferrer'; li.appendChild(te); }
        else { te = mk('span', null, a.title); li.appendChild(te); }
        trItems.push({ text: a.title, after: te });
        li.appendChild(mk('small', null, ' — ' + a.source + (a.at ? ' · ' + new Date(a.at).toLocaleString(AQ.i18n.lang === 'en' ? 'en-US' : 'ja-JP') : '')));
        ul.appendChild(li);
      });
      box.appendChild(ul);
      /* 日本語の表示では、見出しの下に訳を添える（ブラウザの翻訳機能。無ければ Google 翻訳へのリンク） */
      var trBar = mk('div', 'tr-bar'); box.appendChild(trBar);
      if (AQ.translate) AQ.translate.decorate(trItems, trBar);
      box.appendChild(mk('small', 'robot-job-warn', t('errand.newsNote')));
    } else if (r && (r.kind === 'price' || r.pool != null)) {
      var top = mk('div', 'errand-price');
      top.appendChild(mk('b', null, fmtUsd(r.usd)));
      top.appendChild(mk('span', null, r.pool + (r.dex ? ' · ' + r.dex : '')));
      box.appendChild(top);
    } else box.appendChild(mk('small', 'robot-job-sub', t('errand.noPool')));
    box.appendChild(mk('small', 'robot-job-sub', t('errand.paid', { price: x.price || '0.01', query: x.query })));
    var row = mk('div', 'robot-acts');
    if (x.tx) {
      var a = mk('a', 'errand-link', t('errand.txLink')); a.href = 'https://basescan.org/tx/' + x.tx; a.target = '_blank'; a.rel = 'noopener';
      row.appendChild(a);
    } else if (x.paid) row.appendChild(mk('small', 'robot-job-sub', t('errand.paidOk')));   // 取引の番号は分からないが、支払いは Base の記録で確かめた
    else row.appendChild(mk('small', 'robot-job-warn', t('errand.noTxYet')));
    var w = mk('button', 'go watch-btn', t('errand.watch')); w.type = 'button';
    w.addEventListener('click', function () { watchErrand(x); });
    row.appendChild(w);
    box.appendChild(row);
  }

  function watchErrand(x) {
    var d = mine(); if (!d || !AQ.app || !AQ.app.showMine) return;
    var ev = errandEvents(x, d);
    if (AQ.nick && AQ.nick.setName) AQ.nick.setName(actorKey(d), d.name + ' #' + d.agentId);
    if (AQ.birth) AQ.birth.close('watch');
    AQ.app.showMine(ev, { agent: actorKey(d) });
  }

  function buildChoices() {
    var ec = $('errandChoices'); if (!ec) return;
    ec.innerHTML = '';
    shop().choices.map(function (e) { return e.key; }).concat(['free']).forEach(function (k) {
      var b = mk('button', 'robot-choice'); b.type = 'button'; b.setAttribute('data-key', k);
      b.appendChild(mk('b')); b.appendChild(mk('small'));
      b.addEventListener('click', function () { pickErrand(k); });
      ec.appendChild(b);
    });
    labelChoices();
  }
  function labelChoices() {
    Array.prototype.forEach.call(document.querySelectorAll('#errandChoices .robot-choice'), function (b) {
      var k = b.getAttribute('data-key');
      b.querySelector('b').textContent = t('errand.pick.' + (k === 'free' ? shopKey + '.free' : k));
      b.querySelector('small').textContent = k === 'free' ? t('errand.pick.' + shopKey + '.freeSub') : t('errand.pick.' + shopKey + '.sub');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#errandShops .robot-chip'), function (b) {
      var on = b.getAttribute('data-key') === shopKey; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = t('errand.shop.' + b.getAttribute('data-key'));
    });
    if ($('errandFree')) $('errandFree').placeholder = t('errand.' + shopKey + '.freePh');
    if ($('errandLead')) $('errandLead').textContent = t('errand.lead.' + shopKey);
    if ($('errandGo')) $('errandGo').textContent = t('errand.go.' + shopKey);
  }
  function pickShop(k) { if (!SHOPS[k]) return; shopKey = k; choice = SHOPS[k].choices[0].key; buildChoices(); pickErrand(choice); }
  function pickErrand(k) {
    choice = k;
    Array.prototype.forEach.call(document.querySelectorAll('#errandChoices .robot-choice'), function (b) {
      var on = b.getAttribute('data-key') === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if ($('errandFreeBox')) $('errandFreeBox').hidden = k !== 'free';
  }

  /* =================== ② 身分証を育てる =================== */
  var SEL_SET_URI = '0x0af28bd3';   // setAgentURI(uint256,string)
  var SEL_OWNER_OF = '0x6352211e';  // ownerOf(uint256)
  var SEL_TOKEN_URI = '0xc87b56dd'; // tokenURI(uint256)
  var TOPIC_URI_UPDATED = '0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb'; // URIUpdated(uint256,string,address)
  var SKILLS = ['research', 'explain', 'review'];
  var INTROS = [
    { key: 'helper',  text: 'A learning agent born in Agent Quest. It posts jobs, judges deliveries and pays for data with x402.' },
    { key: 'curious', text: 'A curious beginner agent. It asks good questions and checks answers carefully.' },
    { key: 'trader',  text: 'A small agent that buys market data with x402 and reports token prices in plain words.' }
  ];
  var CARD_STORE = 'aq.myAgent.card';
  var card = { skills: { research: true, explain: true }, intro: 'helper', did: true };

  function regFile(d) {
    var reg = (AQ.birth && AQ.birth.REGISTRY) || '';
    var intro = INTROS.filter(function (x) { return x.key === card.intro; })[0] || INTROS[0];
    var skills = SKILLS.filter(function (s) { return card.skills[s]; });
    var desc = intro.text + (skills.length ? ' Skills: ' + skills.join(', ') + '.' : '');
    var services = [];
    var did = robotDid();
    if (card.did && did) services.push({ name: 'DID', endpoint: did, version: 'v1' });
    return {
      type: W().agentURIType,
      name: d.name,
      description: desc,
      services: services,
      active: true,
      registrations: [{ agentId: Number(d.agentId), agentRegistry: 'eip155:8453:' + reg }]
    };
  }
  function robotDid() { try { var s = JSON.parse(localStorage.getItem('aq.myAgent.key') || 'null'); return s && s.did || null; } catch (e) { return null; } }
  function dataURI(obj) { return 'data:application/json;base64,' + b64(JSON.stringify(obj)); }
  function setUriData(agentId, uri) {
    var h = hexOf(uri);
    return SEL_SET_URI + n64(agentId) + n64(64) + n64(h.length / 2) + pad64(h) + W().builderSuffix();
  }
  function decodeString(ret) {
    var h = String(ret || '').replace(/^0x/, '');
    if (h.length < 128) return null;
    var len = parseInt(h.slice(64, 128), 16), body = h.slice(128, 128 + len * 2);
    var u = new Uint8Array(body.length / 2);
    for (var i = 0; i < u.length; i++) u[i] = parseInt(body.substr(i * 2, 2), 16);
    return new TextDecoder().decode(u);
  }

  function renderCard() {
    var d = mine(); if (!d || !$('cardPreview')) return;
    Array.prototype.forEach.call(document.querySelectorAll('#cardSkills .robot-chip'), function (b) {
      var on = !!card.skills[b.getAttribute('data-key')]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#cardIntros .robot-choice'), function (b) {
      var on = b.getAttribute('data-key') === card.intro; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var didOk = !!robotDid();
    if ($('cardDid')) { $('cardDid').checked = card.did && didOk; $('cardDid').disabled = !didOk; }
    if ($('cardDidLbl')) $('cardDidLbl').textContent = didOk ? t('card.did') : t('card.didNone');
    $('cardPreview').textContent = JSON.stringify(regFile(d), null, 2);
    renderCardVisual(d);
  }
  /** 名刺風の見た目：名前・番号・ひとこと紹介・得意なこと・掲示板の名前の有無（中身は regFile と同じものだけ） */
  function renderCardVisual(d) {
    var v = $('cardVisual'); if (!v) return;
    v.innerHTML = '';
    var head = mk('div', 'card-visual-head');
    head.appendChild(mk('span', 'card-visual-badge', 'ERC-8004'));
    head.appendChild(mk('b', 'card-visual-name', d.name));
    head.appendChild(mk('span', 'card-visual-id', '#' + d.agentId));
    v.appendChild(head);
    v.appendChild(mk('p', 'card-visual-intro', t('card.introSub.' + card.intro)));
    var skills = SKILLS.filter(function (s) { return card.skills[s]; });
    var row = mk('div', 'card-visual-row');
    row.appendChild(mk('small', null, t('card.vis.skills')));
    if (skills.length) skills.forEach(function (k) { row.appendChild(mk('span', 'card-visual-chip', t('card.skill.' + k))); });
    else row.appendChild(mk('small', null, t('card.vis.none')));
    v.appendChild(row);
    var did = card.did && robotDid();
    v.appendChild(mk('small', 'card-visual-did', did ? t('card.vis.did', { did: did.slice(0, 14) + '…' }) : t('card.vis.noDid')));
    v.appendChild(mk('small', 'card-visual-note', t('card.vis.note')));
  }

  function goCard() {
    var d = mine(); if (!d || busy) return;
    var reg = AQ.birth.REGISTRY, file = regFile(d), uri = dataURI(file), acc = null, hash = null, tStart = Date.now();
    setBusy(true);
    status('errand.connecting');
    readyOwner(d).then(function (a) {
      acc = a;
      status('card.checking');
      return W().rpc('eth_call', [{ to: reg, data: SEL_OWNER_OF + n64(d.agentId) }, 'latest']);
    }).then(function (ret) {
      var owner = '0x' + String(ret || '').slice(-40);
      if (owner.toLowerCase() !== String(acc).toLowerCase()) { var e = new Error('not owner'); e.aq = 'card.notOwnerChain'; e.vars = { owner: short(owner) }; throw e; }
      status('card.confirm');
      return W().rpc('eth_sendTransaction', [{ from: acc, to: reg, value: '0x0', data: setUriData(d.agentId, uri) }]);
    }).then(function (h) {
      hash = h;
      status('card.waiting');
      return W().waitReceipt(h);
    }).then(function (rc) {
      if (rc.status && rc.status !== '0x1' && rc.status !== 1) { var e = new Error('reverted'); e.aq = 'card.reverted'; throw e; }
      var ok = ((rc && rc.logs) || []).some(function (L) {
        return String(L.address).toLowerCase() === reg.toLowerCase() && L.topics && String(L.topics[0]).toLowerCase() === TOPIC_URI_UPDATED &&
               BigInt(L.topics[1]) === BigInt(d.agentId);
      });
      if (!ok) { var e2 = new Error('no event'); e2.aq = 'card.noEvent'; throw e2; }
      return W().rpc('eth_call', [{ to: reg, data: SEL_TOKEN_URI + n64(d.agentId) }, 'latest']);
    }).then(function (ret) {
      var now = decodeString(ret);
      try { localStorage.setItem(CARD_STORE, JSON.stringify({ t: Date.now(), tx: hash, file: file, onchain: now === uri })); } catch (e) {}
      status(now === uri ? 'card.done' : 'card.doneLag', null, 'good');
      var actId = AQ.activity ? AQ.activity.add({ kind: 'card', t0: tStart, t1: Date.now(), tx: hash }) : null;
      var box = $('cardDone');
      if (box) {
        box.hidden = false; box.innerHTML = '';
        var a1 = mk('a', 'errand-link', t('card.txLink')); a1.href = 'https://basescan.org/tx/' + hash; a1.target = '_blank'; a1.rel = 'noopener';
        var a2 = mk('a', 'errand-link', t('birth.explorerLink')); a2.href = 'https://erc-8004.quicknode.com/agents/base-mainnet/' + encodeURIComponent(d.agentId); a2.target = '_blank'; a2.rel = 'noopener';
        box.appendChild(a1); box.appendChild(mk('span', null, ' · ')); box.appendChild(a2);
        if (actId) { var wb = mk('button', 'go watch-btn', t('errand.watch')); wb.type = 'button'; wb.addEventListener('click', function () { AQ.activity.watchOne(actId); }); box.appendChild(wb); }
      }
    }).catch(function (e) {
      if (e && e.code === 4001) status('errand.rejected', null, 'bad');
      else status((e && e.aq) || 'errand.failed', (e && e.vars) || { msg: errMsg(e), tx: hash ? short(hash) : '' }, 'bad');
    }).then(function () { setBusy(false); });
  }

  /* =================== 画面 =================== */
  function relabel() {
    var map = { robotErrandOpen: 'errand.open', robotCardOpen: 'card.open', errandTitle: 'errand.title',
                errandNote: 'errand.note', cardTitle: 'card.title', cardLead: 'card.lead',
                cardSkillsLbl: 'card.skillsLbl', cardIntroLbl: 'card.introLbl', cardPreviewLbl: 'card.previewMore', cardVisualLbl: 'card.visLbl', cardGo: 'card.go', cardNote: 'card.note',
                errandStep1: 'errand.step1', errandStep2: 'errand.step2', cardStep3: 'card.step3' };
    Object.keys(map).forEach(function (id) { if ($(id)) $(id).textContent = t(map[id]); });
    labelChoices();
    Array.prototype.forEach.call(document.querySelectorAll('#cardSkills .robot-chip'), function (b) { b.textContent = t('card.skill.' + b.getAttribute('data-key')); });
    Array.prototype.forEach.call(document.querySelectorAll('#cardIntros .robot-choice'), function (b) {
      var k = b.getAttribute('data-key'), x = INTROS.filter(function (i) { return i.key === k; })[0];
      b.querySelector('b').textContent = t('card.intro.' + k);
      b.querySelector('small').textContent = x ? t('card.introSub.' + k) : '';
    });
    renderCard();
    renderResult();
  }

  function init() {
    if (!$('robotErrand')) return;
    var es = $('errandShops');
    if (es && !es.children.length) {
      ['news', 'price'].forEach(function (k) {
        var b = mk('button', 'robot-chip'); b.type = 'button'; b.setAttribute('data-key', k);
        b.addEventListener('click', function () { pickShop(k); });
        es.appendChild(b);
      });
    }
    buildChoices();
    var sk = $('cardSkills');
    if (sk && !sk.children.length) {
      SKILLS.forEach(function (k) {
        var b = mk('button', 'robot-chip'); b.type = 'button'; b.setAttribute('data-key', k);
        b.addEventListener('click', function () { card.skills[k] = !card.skills[k]; renderCard(); });
        sk.appendChild(b);
      });
    }
    var ci = $('cardIntros');
    if (ci && !ci.children.length) {
      INTROS.forEach(function (x) {
        var b = mk('button', 'robot-choice'); b.type = 'button'; b.setAttribute('data-key', x.key);
        b.appendChild(mk('b')); b.appendChild(mk('small'));
        b.addEventListener('click', function () { card.intro = x.key; renderCard(); });
        ci.appendChild(b);
      });
    }
    if ($('cardDid')) $('cardDid').addEventListener('change', function () { card.did = $('cardDid').checked; renderCard(); });
    $('errandGo').addEventListener('click', goErrand);
    $('cardGo').addEventListener('click', goCard);
    if ($('robotErrandOpen')) $('robotErrandOpen').addEventListener('click', function () { if (AQ.robot && AQ.robot.togglePanel) AQ.robot.togglePanel('robotErrand', function () { pickErrand(choice); renderResult(); }); });
    if ($('robotCardOpen')) $('robotCardOpen').addEventListener('click', function () { if (AQ.robot && AQ.robot.togglePanel) AQ.robot.togglePanel('robotCard', renderCard); });
    pickErrand(choice);
    relabel();
  }

  AQ.errand = { _timing: function (o) { for (var k in o) TIMING[k] = o[k]; },
    init: init, relabel: relabel,
    /* 検査用 */
    SHOPS: SHOPS, REQ: SHOPS.price.req, RESOURCE: SHOPS.price.resource, _typedData: typedData, _paymentHeader: paymentHeader, _withBuilderCode: withBuilderCode,
    _readPrice: function (j) { return SHOPS.price.read(j); }, _readNews: function (j) { return SHOPS.news.read(j); }, pickShop: pickShop, lock: lock,
    _errandEvents: errandEvents, _regFile: regFile, _setUriData: setUriData, _decodeString: decodeString
  };
})(window.AQ = window.AQ || {});
