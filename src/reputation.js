/* =============================================================
   reputation.js — ほかのエージェントに評価を付ける（ERC-8004 Reputation Registry）（2026-10-11）
   -------------------------------------------------------------
   調べたこと（2026-10-11）
     ・登録先（Base）: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
       （erc-8004/erc-8004-contracts の README。ABI も同じリポジトリの abis/ReputationRegistry.json）
     ・giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2,
                    string endpoint, string feedbackURI, bytes32 feedbackHash)
       EIP-8004 の例: tag1 = "starred" は「質の評価（0〜100）」、value 87 / valueDecimals 0
     ・持ち主（と、その許可を受けた者）は自分のエージェントを評価できない（"Self-feedback not allowed"）
     ・エージェントが評価するときは、登録した財布（agentWallet＝ここでは持ち主の財布）から送るのがよい（SHOULD）
     ・Base に送らずに試した: 持ち主以外からなら通る（ガス約21.6万）、持ち主からは断られる
   作り話をしない
     ・評価の一覧・平均は readAllFeedback が返した数字から、この画面で計算するだけ
       （getSummary の summaryValue は意味が仕様に書かれていないので使わない）
     ・「評価した」と言うのは、取引の記録に NewFeedback（その番号・自分の財布）が見つかったときだけ
     ・ほかのエージェントの身分証の文は、ただの文字として出す（画像は読み込まない）
   ============================================================= */
(function (AQ) {
  'use strict';

  var REP = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
  /* Base への問い合わせ先は src/rpc.js（自分用の窓口 → 公式の窓口）にまとめた（2026-10-23） */
  var SEL_GIVE = '0x3c036a7e';
  var SEL_READ_ALL = '0xd9d84224';
  var TOPIC_NEW = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc';
  var TAG1 = 'starred', TAG2 = 'profile';
  var GIVEN_STORE = 'aq.myAgent.feedback';

  function t(k, v) { return AQ.i18n.t(k, v); }
  function $(id) { return document.getElementById(id); }
  function W() { return AQ.birth && AQ.birth.wallet; }
  function mine() { return (AQ.birth && AQ.birth.mine && AQ.birth.mine()) || null; }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function n64(n) { return BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0'); }
  function hexOf(s) { return Array.from(new TextEncoder().encode(String(s))).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function strTail(s) { var h = hexOf(s); return n64(h.length / 2) + (h.length ? h.padEnd(Math.ceil(h.length / 64) * 64, '0') : ''); }
  function short(a) { a = String(a || ''); return a.slice(0, 6) + '…' + a.slice(-4); }
  function errMsg(e) { return String((e && ((e.data && e.data.message) || e.message)) || e || '').slice(0, 140); }
  function status(key, vars, kind) {
    var el = $('robotStatus'); if (!el) return;
    el.textContent = key ? t(key, vars) : '';
    el.className = 'birth-status' + (kind ? ' ' + kind : '');
  }
  /* Base への問い合わせは src/rpc.js（自分用の窓口 → だめなら公式の窓口）を通す。時間切れは「遅い」として伝える */
  function viaRpc(method, params, ms) {
    return AQ.rpc.call(method, params, ms).catch(function (e) { if (e && e.timeout) e.aq = 'fb.slow'; throw e; });
  }
  function rpcRead(data) { return viaRpc('eth_call', [{ to: REP, data: data }, 'latest'], 12000); }

  /** giveFeedback の呼び出しデータ（ABI の形）。 */
  function giveData(agentId, value, decimals, tag1, tag2, endpoint, uri) {
    var tails = [tag1, tag2, endpoint, uri].map(strTail), off = 8 * 32, offs = [];
    tails.forEach(function (x) { offs.push(n64(off)); off += x.length / 2; });
    return SEL_GIVE + n64(agentId) + n64(value) + n64(decimals) + offs.join('') + n64(0) + tails.join('');
  }
  /** readAllFeedback(agentId, [], "starred", "", false) */
  function readAllData(agentId) {
    var head = n64(agentId) + n64(160) + n64(192) + n64(256) + n64(0);
    return SEL_READ_ALL + head + n64(0) + strTail(TAG1) + strTail('');
  }
  function word(h, i) { return h.slice(i * 64, i * 64 + 64); }
  function toSigned(hex) { return BigInt.asIntN(256, BigInt('0x' + hex)); }
  /** readAllFeedback の答えから、評価した財布・値・小数の桁を取り出す */
  function decodeAll(ret) {
    var h = String(ret || '').replace(/^0x/, '');
    if (h.length < 64 * 7) return [];
    function arr(k) { var off = parseInt(word(h, k), 16) / 32, n = parseInt(word(h, off), 16), out = []; for (var i = 0; i < n; i++) out.push(word(h, off + 1 + i)); return out; }
    var clients = arr(0), values = arr(2), decs = arr(3);   // 0:clients 1:feedbackIndexes 2:values 3:valueDecimals 4:tag1s 5:tag2s 6:revoked
    return clients.map(function (c, i) {
      var v = Number(toSigned(values[i])), d = parseInt(decs[i], 16);
      return { client: '0x' + c.slice(24), value: v / Math.pow(10, d) };
    });
  }
  function summaryOf(list) {
    if (!list.length) return null;
    var sum = list.reduce(function (a, x) { return a + x.value; }, 0);
    return { n: list.length, avg: sum / list.length };
  }

  /* ---- 評価する相手の一覧（Base の Blockscout にある、最近の身分証）----
     ★ 2026-10-17 利用者の報告「読み込みに時間がかかりすぎ」。調べると、Base の身分証は
       いま大量に登録されていて（1000ブロックで1000件ほど）、新しい順の1ページ目は名前の読めない
       身分証ばかりになることがある。以前は「名前の読めるもの0件」を「読み込み中」と見せたまま
       止まっていた。いまは:
         ・1回の読み込みに上限時間（15秒）。止まったら、そう言って「もう一度」を出す
         ・名前の読めるものが少なければ、次のページを自動で読む（最大5ページ）。何件見たかを出す
         ・読めた一覧はこのブラウザに30分覚えておく（次に開いたときはすぐ出る）
         ・番号（agentId）を入れて選ぶこともできる（Base から直接読む） */
  var agents = [], next = null, picked = null, stars = 4, busy = false;
  var load = { busy: false, err: null, seen: 0, gen: 0 };
  var CACHE = 'aq.cache.fbAgents', CACHE_MS = 30 * 60 * 1000, PAGE_MS = 15000, WANT = 8;
  function fetchT(url, ms, opt) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var tm = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    var o = opt || {}; o.mode = 'cors'; if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) { clearTimeout(tm); return r; }, function (e) {
      clearTimeout(tm);
      if (e && e.name === 'AbortError') { var x = new Error('timeout'); x.aq = 'fb.slow'; throw x; }
      throw e;
    });
  }
  function itemsOf(j) {
    var d = mine();
    return ((j && j.items) || []).filter(function (it) {
      var m = it && it.metadata;
      return m && typeof m.name === 'string' && m.name.trim() && (!d || String(it.id) !== String(d.agentId));
    }).map(function (it) { return agentOf(it.id, it.metadata, it.owner && it.owner.hash ? String(it.owner.hash) : null); });
  }
  function agentOf(id, m, owner) {
    m = m || {};
    return { id: String(id), name: String(m.name || '').slice(0, 40), description: String(m.description || '').slice(0, 400),
             services: Array.isArray(m.services) ? m.services.map(function (s) { return String((s && s.name) || '').slice(0, 20); }).filter(Boolean) : [],
             owner: owner || null };
  }
  function page(params) {
    var reg = AQ.birth.REGISTRY;
    var url = 'https://base.blockscout.com/api/v2/tokens/' + reg + '/instances' + (params ? '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&') : '');
    return fetchT(url, PAGE_MS).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  /* ★ 2026-10-17 3回目の報告「やはり出ない（0 件見ました のまま）」。利用者のブラウザからは Blockscout が
       ほとんど返事をしないことがある。そこで一覧の元を Base そのものに変えた（Blockscout は並行して読み、
       返ってきたら足すだけ）。
         ① Base の記録（Registered＝身分証が登録された印）を、新しいほうから 400 ブロックずつさかのぼって読む
         ② 同じサイトから大量に登録されているもの（1つの窓で3件より多い）は「まとめて作られた身分証」として省く
         ③ 身分証の中身（紹介）は、data: ならその場で、ipfs/https は相手が読ませてくれれば読む（3秒まで）。
            読めなくても、番号と置き場所は出して選べるようにする（中身は「身分証を開く」で本人が見られる）
       Base の記録そのものを読むので、作り話は入らない。 */
  var TOPIC_REGISTERED = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a';
  /* ★ 2026-10-17 Base の記録を実際に調べたところ、ここ数日の登録はほぼすべて1つのサイトからの大量登録だった
       （約1000ブロックで1067件すべて／2日前の400ブロックでも388件中386件が同じサイト）。30日前の辺りは
       いろいろな作り手の身分証が混ざっていた。そこで、直近の少しの範囲を見たあと、30日前・40日前…と
       時間をさかのぼって、いくつかの時期の記録を少しずつ見る。 */
  var BULK = 3, BLOCKS_PER_DAY = 43200;
  var PLAN = [[0, 400], [400, 400], [30, 1000], [40, 1000], [50, 1000], [65, 1000], [80, 1000], [100, 1000], [125, 1000], [150, 1000], [180, 1000], [210, 1000], [240, 1000]];
  var chainHead = null, planAt = 0;
  function windowAt(i) {
    var p = PLAN[i]; if (!p) return null;
    var back = p[0] < 1000 && i < 2 ? p[0] : p[0] * BLOCKS_PER_DAY;     // 最初の2つはブロック数、あとは日数
    var top = chainHead - back;
    return top > 0 ? { from: Math.max(0, top - p[1] + 1), to: top } : null;
  }
  function rpc(method, params) { return viaRpc(method, params, 12000); }
  function hostOf(uri) {
    uri = String(uri || '');
    if (/^data:/i.test(uri)) return 'data';
    if (/^ipfs:/i.test(uri)) return 'ipfs';
    try { return new URL(uri).host; } catch (e) { return ''; }
  }
  function addAgents(list) {
    var have = {}; agents.forEach(function (a) { have[a.id] = 1; });
    agents = agents.concat(list.filter(function (a) { return a && !have[a.id]; }));
    var score = function (a) { return (a.name && !a.unnamed ? 2 : 0) + (a.description ? 1 : 0); };
    agents.sort(function (a, b) { return score(b) - score(a); });
  }
  /** Base の記録から、時期をさかのぼって候補を集める（want 件になるまで） */
  function fromChainLogs(gen, want) {
    var reg = AQ.birth.REGISTRY, d = mine(), found = 0;
    function head() { return chainHead != null ? Promise.resolve(chainHead) : rpc('eth_blockNumber', []).then(function (h) { chainHead = parseInt(h, 16); return chainHead; }); }
    function one() {
      if (gen !== load.gen || found >= want) return Promise.resolve();
      var w = windowAt(planAt);
      if (!w) return Promise.resolve();
      planAt++;
      return rpc('eth_getLogs', [{ address: reg, fromBlock: '0x' + w.from.toString(16), toBlock: '0x' + w.to.toString(16), topics: [TOPIC_REGISTERED] }]).then(function (logs) {
        if (gen !== load.gen) return;
        logs = logs || [];
        load.seen += logs.length;
        var byHost = {};
        var rows = logs.map(function (L) {
          var uri = ''; try { uri = decodeStr(L.data); } catch (e) {}
          var h = hostOf(uri), owner = '0x' + String(L.topics[2] || '').slice(-40);
          /* まとめて作られたかどうか：https はサイトごと、ipfs と data: は持ち主ごとに数える（ipfs は作り手がばらばらなため） */
          var key = (h === 'ipfs' || h === 'data') ? 'o:' + owner.toLowerCase() : h;
          byHost[key] = (byHost[key] || 0) + 1;
          return { id: String(BigInt(L.topics[1])), owner: owner, uri: uri, host: h, key: key };
        }).filter(function (r) {
          return r.host && byHost[r.key] <= BULK && (!d || r.id !== String(d.agentId)) &&
                 !(d && d.owner && r.owner.toLowerCase() === String(d.owner).toLowerCase());
        }).reverse();                                                   // 新しいものから
        renderList();
        return Promise.all(rows.map(function (r) {
          return metaFromUri(r.uri, r.host === 'ipfs' ? 6000 : 3000).then(function (m) {
            var a = agentOf(r.id, m, r.owner);
            a.uri = r.uri; a.host = r.host; a.src = 'search';
            if (!a.name) { a.name = t('fb.unnamed', { host: r.host === 'data' ? 'Base' : r.host }); a.unnamed = true; }
            return a;
          });
        })).then(function (list) {
          if (gen !== load.gen) return;
          found += list.length; addAgents(list); renderList();
        });
      }, function () { /* その時期が読めなければ次の時期へ */ }).then(one);
    }
    return head().then(one);
  }
  function loadAgents(more) {
    var gen = ++load.gen, start = agents.length, errs = [];
    load.busy = true; load.err = null;
    if (!more) { load.seen = 0; planAt = 0; queue = ANCHORS.map(function (a) { return a == null ? null : { unique_token: a }; }); }   // 入れておいた身分証は消さない
    next = null;
    renderList();
    load.found = 0;
    var chain = fromChainLogs(gen, WANT).catch(function (e) { errs.push(e); });
    var bs = more ? Promise.resolve() : fromBlockscout(gen).catch(function (e) { errs.push(e); });   // 返ってきたら足すだけ（待たせる元にしない）
    /* 「読み込み中」を終える合図は Base の記録のほう。Blockscout は遅ければ後から足される */
    return chain.then(function () {
      if (gen !== load.gen) return agents;
      if (agents.length - start < 1) return Promise.race([bs, new Promise(function (r) { setTimeout(r, 8000); })]);   // Base から1件も無ければ、Blockscout を少しだけ（8秒まで）待つ
    }).then(function () {
      if (gen !== load.gen) return agents;
      load.busy = false;
      next = planAt < PLAN.length ? true : null;                      // さらにさかのぼれる
      load.searched = true;
      load.found = agents.length - start;
      if (!load.found && errs.length) load.err = errs[0];
      try { var sa = agents.filter(function (a) { return a.src === 'search'; }); if (sa.length) localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), agents: sa.slice(0, 120) })); } catch (e) {}
      renderList();
      return agents;
    });
  }
  /* Blockscout（並行して読むだけ）：新しい順と、少し前の番号の辺り */
  var ANCHORS = [null, 150000, 100000, 60000, 30000, 12000, 4000, 1000];
  var queue = [];
  function fromBlockscout(gen) {
    var t0 = Date.now();
    function worker() {
      if (gen !== load.gen || !queue.length || Date.now() - t0 > 40000) return Promise.resolve();
      var params = queue.shift();
      return page(params).then(function (j) {
        if (gen !== load.gen) return;
        var got = itemsOf(j);
        got.forEach(function (a) { a.src = 'search'; });
        addAgents(got);
        if (j && j.next_page_params && got.length) queue.push(j.next_page_params);
        renderList();
      }, function () {}).then(worker);
    }
    return Promise.all([worker(), worker()]);
  }
  /* ★ 2026-10-18 利用者「出ません。ユーザーを待たせすぎるのは良くない」。
       利用者のブラウザでは、Blockscout も Base の記録の検索（eth_getLogs）も返ってこなかった
       （一方で、1件ずつ読む eth_call は通っていた＝自分の評判は読めていた）。そこで、
       ・開いたらすぐ出す：ERC-8004 の初期に登録された身分証（番号）を、このアプリに入れておく。
         2026-10-18 に Base の記録（tokenURI）で、身分証があること・置き場所を確かめたもの。
       ・名前と紹介は、開いたときに Base から1件ずつ読み直す（eth_call。読めなければ置き場所だけ出す）。
       ・ほかを探すのは、利用者が「ほかのエージェントも探す」を押したときだけ（待たせない）。 */
  var FEATURED = [
    { id: '1', host: 'data', name: 'ClawNews', description: 'Hacker News for AI agents - built by agents, for agents.' },
    { id: '2', host: 'hackmoney.batikankutluer.com' },
    { id: '3', host: 'marketplace.olas.network' }, { id: '4', host: 'marketplace.olas.network' },
    { id: '5', host: 'marketplace.olas.network' }, { id: '6', host: 'marketplace.olas.network' }
  ];
  var featuredDone = false;
  function featured() {
    var d = mine();
    return FEATURED.filter(function (f) { return !d || String(d.agentId) !== f.id; }).map(function (f) {
      var a = agentOf(f.id, f.name ? { name: f.name, description: f.description } : null, null);
      a.host = f.host; a.featured = true;
      if (!a.name) { a.name = t('fb.unnamed', { host: f.host }); a.unnamed = true; }
      return a;
    });
  }
  /** 入れておいた身分証の名前・紹介を、Base から読み直す（1件ずつ・並べたまま、読めたものから書き換える） */
  function enrichFeatured() {
    if (featuredDone) return; featuredDone = true;
    var reg = AQ.birth.REGISTRY;
    agents.filter(function (a) { return a.featured; }).forEach(function (a) {
      rpcCall(reg, SEL_TOKEN_URI + n64(a.id)).then(function (ret) {
        var uri = decodeStr(ret); a.uri = uri; a.host = hostOf(uri) || a.host;
        return metaFromUri(uri, 3000);
      }).then(function (m) {
        if (m && typeof m.name === 'string' && m.name.trim()) {
          var b = agentOf(a.id, m, a.owner);
          a.name = b.name; a.description = b.description; a.services = b.services; a.unnamed = false;
        } else if (a.unnamed) a.name = t('fb.unnamed', { host: a.host === 'data' ? 'Base' : a.host });
        renderList();
        if (picked && picked.id === a.id) pick(a);
      }, function () {});
    });
  }

  function fromCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (c && Array.isArray(c.agents) && c.agents.length && Date.now() - c.t < CACHE_MS) {
        var d = mine();
        agents = c.agents.filter(function (a) { return !d || String(a.id) !== String(d.agentId); }); next = null; queue = [];
        return agents.length > 0;
      }
    } catch (e) {}
    return false;
  }

  function renderList() {
    var box = $('fbList'); if (!box) return;
    box.innerHTML = '';
    if (agents.some(function (a) { return a.featured; })) box.appendChild(mk('small', 'robot-job-warn fb-note', t('fb.featuredNote')));
    /* ★ 2026-10-19 名前が読めない身分証が「（名前は … の身分証の中）」で何件も並び、選べなかった
       （利用者の報告）。名前の読めるものだけを大きく並べ、読めないものは「くわしく」に
       発行元ごとにまとめて、小さな番号ボタンにする（選べはする）。 */
    var shown = agents.slice(0, 120);
    var named = shown.filter(function (a) { return !a.unnamed; }), unnamed = shown.filter(function (a) { return a.unnamed; });
    function choice(a) {
      var b = mk('button', 'robot-choice fb-agent' + (picked && picked.id === a.id ? ' on' : '')); b.type = 'button';
      b.appendChild(mk('b', null, '#' + a.id + ' ' + a.name));
      var sm = mk('small', null, a.description ? a.description.slice(0, 90) + (a.description.length > 90 ? '…' : '') : t('fb.noDesc'));
      if (a.description) sm.setAttribute('data-foreign', '');      // 相手が書いた紹介文（選ぶと訳を添えて全文を出す）
      b.appendChild(sm);
      b.addEventListener('click', function () { pick(a); });
      return b;
    }
    named.forEach(function (a) { box.appendChild(choice(a)); });
    if (unnamed.length) {
      var det = mk('details', 'robot-more-info fb-unnamed');
      if (picked && picked.unnamed) det.open = true;
      det.appendChild(mk('summary', null, t('fb.unnamedGroup', { n: unnamed.length })));
      var byHost = {}, order = [];
      unnamed.forEach(function (a) { var h = a.host === 'data' ? 'Base' : (a.host || '?'); if (!byHost[h]) { byHost[h] = []; order.push(h); } byHost[h].push(a); });
      order.forEach(function (h) {
        var row = mk('div', 'fb-unnamed-row');
        row.appendChild(mk('small', null, t('fb.unnamedHost', { host: h })));
        byHost[h].forEach(function (a) {
          var nb = mk('button', 'robot-chip' + (picked && picked.id === a.id ? ' on' : ''), '#' + a.id); nb.type = 'button';
          nb.addEventListener('click', function () { pick(a); });
          row.appendChild(nb);
        });
        det.appendChild(row);
      });
      box.appendChild(det);
    }
    if (load.busy) box.appendChild(mk('p', 'robot-empty', t('fb.loading', { n: load.seen })));
    else if (load.searched && !load.found) box.appendChild(mk('p', 'robot-empty', load.err ? (load.err.aq ? t(load.err.aq) : t('fb.searchFail')) : t('fb.none', { n: load.seen })));
    if (agents.some(function (a) { return a.src === 'search'; })) box.appendChild(mk('small', 'robot-job-warn fb-bulk', t('fb.bulkNote')));
    if ($('fbMore')) { $('fbMore').hidden = load.busy || (load.searched && !next); $('fbMore').textContent = t('fb.search'); }
  }

  /* ---- 番号（agentId）で選ぶ：Base から直接読む ---- */
  var SEL_OWNER_OF = '0x6352211e', SEL_TOKEN_URI = '0xc87b56dd';
  function rpcCall(to, data) { return viaRpc('eth_call', [{ to: to, data: data }, 'latest'], 12000); }
  function decodeStr(ret) {
    var h = String(ret || '').replace(/^0x/, ''); if (h.length < 128) return '';
    var off = parseInt(h.slice(0, 64), 16) * 2, n = parseInt(h.slice(off, off + 64), 16);
    var hex = h.slice(off + 64, off + 64 + n * 2), u = new Uint8Array(hex.length / 2);
    for (var i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16);
    return new TextDecoder().decode(u);
  }
  function metaFromUri(uri, ms) {
    uri = String(uri || '');
    var m = uri.match(/^data:application\/json(;[^,]*)?,(.*)$/i);
    if (m) {
      try {
        var body = /;base64/i.test(m[1] || '') ? new TextDecoder().decode(Uint8Array.from(atob(m[2]), function (c) { return c.charCodeAt(0); })) : decodeURIComponent(m[2]);
        return Promise.resolve(JSON.parse(body));
      } catch (e) { return Promise.resolve(null); }
    }
    var url = /^ipfs:\/\//i.test(uri) ? 'https://ipfs.io/ipfs/' + uri.replace(/^ipfs:\/\//i, '') : (/^https:\/\//i.test(uri) ? uri : null);
    if (!url) return Promise.resolve(null);
    return fetchT(url, ms || 8000).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });   // 相手のサイトが読ませてくれなければ名前なし
  }
  function pickById() {
    var inp = $('fbId'), id = String(inp && inp.value || '').trim(), d = mine();
    if (!/^\d{1,12}$/.test(id)) { status('fb.idBad', null, 'bad'); return; }
    if (d && String(d.agentId) === id) { status('fb.self', null, 'bad'); return; }
    var reg = AQ.birth.REGISTRY;
    status('fb.idLoading', { id: id });
    var owner = null;
    rpcCall(reg, SEL_OWNER_OF + n64(id)).then(function (ret) {
      owner = '0x' + String(ret || '').slice(-40);
      if (!/^0x[0-9a-f]{40}$/i.test(owner) || /^0x0{40}$/.test(owner)) { var e = new Error('none'); e.aq = 'fb.idNone'; throw e; }
      return rpcCall(reg, SEL_TOKEN_URI + n64(id));
    }).then(function (ret) { return metaFromUri(decodeStr(ret)); }).then(function (m) {
      var a = agentOf(id, m, owner);
      if (!a.name) a.name = t('fb.noName');
      status(null);
      pick(a);
    }).catch(function (e) {
      status(e && e.aq ? e.aq : 'fb.idNone', { id: id }, 'bad');
    });
  }

  function pick(a) {
    picked = a; renderList();
    var box = $('fbPicked'); if (!box) return;
    box.hidden = false; box.innerHTML = '';
    box.appendChild(mk('b', 'fb-name', '#' + a.id + ' ' + a.name));
    var desc = mk('p', 'robot-job-text', a.description || t('fb.noDesc')); box.appendChild(desc);
    if (a.description && AQ.translate) { var trBar = mk('div', 'tr-bar'); box.appendChild(trBar); AQ.translate.decorate([{ text: a.description, after: desc }], trBar); }
    box.appendChild(mk('small', 'robot-job-sub', a.services.length ? t('fb.services', { list: a.services.join(' / ') }) : t('fb.noServices')));
    var cardUrl = /^https:\/\//i.test(a.uri || '') ? a.uri : (/^ipfs:\/\//i.test(a.uri || '') ? 'https://ipfs.io/ipfs/' + a.uri.replace(/^ipfs:\/\//i, '') : null);
    if (cardUrl) { var ol = mk('a', 'errand-link', t('fb.openCard', { host: hostOf(cardUrl) })); ol.href = cardUrl; ol.target = '_blank'; ol.rel = 'noopener noreferrer'; box.appendChild(ol); }
    var rep = mk('small', 'robot-job-sub', t('fb.repLoading')); box.appendChild(rep);
    box.appendChild(mk('small', 'robot-job-warn', t('robot.jobs.untrusted')));
    rpcRead(readAllData(a.id)).then(function (ret) {
      var s = summaryOf(decodeAll(ret));
      rep.textContent = s ? t('fb.rep', { n: s.n, avg: s.avg.toFixed(0) }) : t('fb.repNone');
    }, function () { rep.textContent = t('fb.repFail'); });
    renderStars();
    if ($('fbGo')) $('fbGo').disabled = busy || !picked;
  }

  function renderStars() {
    Array.prototype.forEach.call(document.querySelectorAll('#fbStars button'), function (b) {
      var n = Number(b.getAttribute('data-n')); b.classList.toggle('on', n <= stars); b.setAttribute('aria-pressed', n === stars ? 'true' : 'false');
    });
    if ($('fbValue')) $('fbValue').textContent = t('fb.value', { v: stars * 20 });
  }

  function renderMine() {
    var el = $('fbMine'), d = mine(); if (!el || !d) return;
    el.textContent = t('fb.mineLoading');
    rpcRead(readAllData(d.agentId)).then(function (ret) {
      var s = summaryOf(decodeAll(ret));
      el.textContent = s ? t('fb.mine', { n: s.n, avg: s.avg.toFixed(0) }) : t('fb.mineNone');
    }, function () { el.textContent = t('fb.repFail'); });
  }

  function loadGiven() { try { return JSON.parse(localStorage.getItem(GIVEN_STORE) || '[]') || []; } catch (e) { return []; } }

  function give() {
    var d = mine(); if (!d || !picked || busy) return;
    var w = W(), target = picked, acc = null, hash = null, value = stars * 20, tStart = Date.now(), nStars = stars;
    busy = true; if ($('fbGo')) $('fbGo').disabled = true;
    status('errand.connecting');
    w.connect().then(function (a) {
      if (!a) { var e0 = new Error('no account'); e0.aq = (w.needsPick && w.needsPick()) ? 'errand.pickWallet' : 'errand.noAccount'; throw e0; }
      if (String(a).toLowerCase() !== String(d.owner).toLowerCase()) { var e1 = new Error('not owner'); e1.aq = 'errand.notOwner'; e1.vars = { acc: short(a), owner: short(d.owner) }; throw e1; }
      if (target.owner && target.owner.toLowerCase() === String(a).toLowerCase()) { var e2 = new Error('self'); e2.aq = 'fb.self'; throw e2; }
      acc = a;
      return w.ensureBase();
    }).then(function () {
      /* ★ 2026-11-02 ウォレットに頼む前に、アプリの中で中身を見せる */
      status('confirm.look');
      return AQ.confirm.ask({
        after: $('robotStatus'),
        what: t('confirm.what.fb', { id: target.id, stars: '★'.repeat(nStars) }),
        rows: [AQ.confirm.party('ReputationRegistry', REP), { k: t('confirm.money'), v: t('confirm.gasOnly') }],
        ok: t('confirm.okTx')
      });
    }).then(function () {
      status('card.confirm');
      return w.rpc('eth_sendTransaction', [{ from: acc, to: REP, value: '0x0', data: giveData(target.id, value, 0, TAG1, TAG2, '', '') + w.builderSuffix() }]);
    }).then(function (h) {
      hash = h; status('card.waiting');
      return w.waitReceipt(h);
    }).then(function (rc) {
      if (rc.status && rc.status !== '0x1' && rc.status !== 1) { var e = new Error('reverted'); e.aq = 'fb.reverted'; throw e; }
      var me = '0x' + '0'.repeat(24) + String(acc).toLowerCase().replace(/^0x/, '');
      var ok = ((rc && rc.logs) || []).some(function (L) {
        return String(L.address).toLowerCase() === REP.toLowerCase() && L.topics && String(L.topics[0]).toLowerCase() === TOPIC_NEW &&
               BigInt(L.topics[1]) === BigInt(target.id) && String(L.topics[2]).toLowerCase() === me;
      });
      if (!ok) { var e2 = new Error('no event'); e2.aq = 'fb.noEvent'; throw e2; }
      var a = loadGiven(); a.push({ t: Date.now(), agentId: target.id, name: target.name, value: value, tx: hash });
      try { localStorage.setItem(GIVEN_STORE, JSON.stringify(a.slice(-30))); } catch (e) {}
      status('fb.done', { id: target.id, name: target.name, stars: nStars }, 'good');
      var actId = AQ.activity ? AQ.activity.add({ kind: 'feedback', t0: tStart, t1: Date.now(), tx: hash, agentId: target.id, name: target.name, stars: nStars }) : null;
      var done = $('fbDone');
      if (done) {
        done.hidden = false; done.innerHTML = '';
        var l = mk('a', 'errand-link', t('fb.txLink')); l.href = 'https://basescan.org/tx/' + hash; l.target = '_blank'; l.rel = 'noopener';
        done.appendChild(l);
        if (actId) { var wb = mk('button', 'go watch-btn', t('errand.watch')); wb.type = 'button'; wb.addEventListener('click', function () { AQ.activity.watchOne(actId); }); done.appendChild(wb); }
      }
      pick(target);
    }).catch(function (e) {
      if (e && e.code === 4001) status('errand.rejected', null, 'bad');
      else if (e && e.aq === 'confirm.cancelled') status('confirm.cancelled');
      else if (e && /Self-feedback/i.test(errMsg(e))) status('fb.self', null, 'bad');
      else status((e && e.aq) || 'errand.failed', (e && e.vars) || { msg: errMsg(e), tx: hash ? short(hash) : '' }, 'bad');
    }).then(function () { busy = false; if ($('fbGo')) $('fbGo').disabled = !picked; });
  }

  function open() {
    renderMine();
    if (!agents.length) { agents = featured(); fromCacheAdd(); }   // すぐ出す（待たせない）
    renderList();
    enrichFeatured();
  }
  function fromCacheAdd() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE) || 'null'), d = mine();
      if (c && Array.isArray(c.agents) && Date.now() - c.t < CACHE_MS) addAgents(c.agents.filter(function (a) { return a && !a.featured && (!d || String(a.id) !== String(d.agentId)); }).map(function (a) { a.src = 'search'; return a; }));
    } catch (e) {}
  }

  function relabel() {
    if ($('fbId')) $('fbId').placeholder = t('fb.idPh');
    var map = { robotFeedbackOpen: 'fb.open', fbTitle: 'fb.title', fbLead: 'fb.lead', fbPickLbl: 'fb.pickLbl', fbMore: 'fb.more', fbIdGo: 'fb.idGo', fbIdLbl: 'fb.idLbl',
                fbStarsLbl: 'fb.starsLbl', fbGo: 'fb.go', fbNote: 'fb.note', fbStep3: 'fb.step3' };
    Object.keys(map).forEach(function (id) { if ($(id)) $(id).textContent = t(map[id]); });
    renderStars();
  }

  function init() {
    if (!$('robotFeedback')) return;
    var sb = $('fbStars');
    if (sb && !sb.children.length) {
      [1, 2, 3, 4, 5].forEach(function (n) {
        var b = mk('button', 'fb-star', '★'); b.type = 'button'; b.setAttribute('data-n', String(n)); b.setAttribute('aria-label', n + ' / 5');
        b.addEventListener('click', function () { stars = n; renderStars(); });
        sb.appendChild(b);
      });
    }
    $('fbGo').addEventListener('click', give);
    $('fbGo').disabled = true;            // 相手を選ぶまでは押せない
    $('fbMore').addEventListener('click', function () {
      if (load.busy) return;
      loadAgents(!!load.searched).catch(function () {});
    });
    if ($('fbIdGo')) $('fbIdGo').addEventListener('click', pickById);
    if ($('fbId')) $('fbId').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') pickById(); });
    $('robotFeedbackOpen').addEventListener('click', function () { if (AQ.robot && AQ.robot.togglePanel) AQ.robot.togglePanel('robotFeedback', open); });
    relabel();
  }

  AQ.reputation = { init: init, relabel: relabel, REP: REP,
    /* 検査用 */ _setPageMs: function (ms) { PAGE_MS = ms; }, _metaFromUri: metaFromUri, _decodeStr: decodeStr, _giveData: giveData, _readAllData: readAllData, _decodeAll: decodeAll };
})(window.AQ = window.AQ || {});
