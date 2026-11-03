/* =============================================================
   birth.js — 自分のエージェントを作る（2026-10-11・第1段階「誕生」）
   -------------------------------------------------------------
   利用者の案:「ウォレットをつないだユーザーが、少しのガス代だけで、
   自分が持ち主のAIエージェントを作れる体験を」。

   ここでやること（第1段階）:
     1. ブラウザのウォレット（window.ethereum）につなぐ
     2. Base（chainId 8453）に切り替える
     3. AI エージェントの身分証の規格 ERC-8004 の登録先（Identity Registry）に
        register(string agentURI) を1回送る → 身分証（ERC-721）がその人のウォレットに届く
        ・手数料なし、ガス代だけ
        ・取引の末尾に Builder Code（ERC-8021）を付ける＝Base 側に記録が残る
     4. 届いた番号（agentId）を覚えて、街に「生まれた」場面として出す

   ★ 作り話をしない約束
     ・登録先のコントラクトが本当にそのチェーンにあるか（eth_getCode）を送る前に確かめる。
       無ければ送らない。
     ・番号は、実際に届いた取引の記録（Transfer イベント）から読む。読めなければ「確定待ち」のまま。
     ・まだ何もしていないエージェントには、何もしていない絵（家で休む）しか出さない。

   ★ 鍵は預からない
     このファイルはユーザーのウォレットに「送ってください」と頼むだけ。秘密鍵には触れない。
   ============================================================= */
(function (AQ) {
  'use strict';

  var BASE = { id: 8453, hex: '0x2105', name: 'Base', rpc: 'https://mainnet.base.org',
               explorer: 'https://basescan.org' };
  /* ERC-8004 Identity Registry（どのチェーンでも同じ CREATE2 のアドレス）。
     送る前に、そのアドレスに本当にコードがあるかを必ず確かめる。 */
  var REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
  var SEL_REGISTER = '0xf2c298be';   // register(string)
  var TOPIC_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  var STORE_KEY = 'aq.myAgent';
  var NAME_MAX = 20;

  function t(k, v) { return AQ.i18n.t(k, v); }
  function $(id) { return document.getElementById(id); }

  /* ---- 16進のこまごま ---- */
  function utf8Hex(s) {
    var b = new TextEncoder().encode(String(s)), h = '';
    for (var i = 0; i < b.length; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return h;
  }
  function pad64(h) { var r = h.length % 64; return r ? h + '0'.repeat(64 - r) : h; }
  function num64(n) { var h = Number(n).toString(16); return '0'.repeat(64 - h.length) + h; }

  /** ERC-8021（Builder Code の印）。[コードの文字][長さ1バイト][型 00][8021 ×8]。
      ox/erc8021 の Attribution.toDataSuffix と同じ並び（検査で突き合わせ済み）。 */
  function builderSuffix(codes) {
    var s = (codes || []).join(',');
    if (!s) return '';
    var body = utf8Hex(s), len = body.length / 2;
    if (len > 255) return '';
    return body + (len < 16 ? '0' : '') + len.toString(16) + '00' + '8021'.repeat(8);
  }

  /** register(string agentURI) の呼び出しデータ（ABI の形）＋ Builder Code の印。 */
  function registerData(agentURI, codes) {
    var bytes = utf8Hex(agentURI);
    return SEL_REGISTER + num64(32) + num64(bytes.length / 2) + pad64(bytes) + builderSuffix(codes);
  }

  /** 身分証の中身（ERC-8004 の登録ファイル）。外の保管場所が要らないよう data: の URI にする。 */
  function agentURIFor(name) {
    var json = JSON.stringify({
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: name,
      description: 'Born in Agent Quest / Agent Quest で生まれたエージェント',
      services: []          // EIP-8004 の今の名前（以前は endpoints）
    });
    var b64 = btoa(String.fromCharCode.apply(null, new TextEncoder().encode(json)));
    return 'data:application/json;base64,' + b64;
  }

  function cleanName(s) {
    s = String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return Array.from(s).slice(0, NAME_MAX).join('');
  }

  function loadSaved() {
    try { var v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return (v && v.agentId) ? v : null; } catch (e) { return null; }
  }
  function save(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) {} }

  var state = { account: null, busy: false, done: null, chosen: null, connecting: false, attempt: 0 };
  var HINT_MS = 12000;   // これだけ待っても返事が無ければ、ウォレットの開き方を案内する
  var hintTimer = null;

  /* ★ 2026-10-11: ウォレットが何本も入っていると（MetaMask と Rabby など）、window.ethereum を
     取り合って、どちらにつながるか分からない。いまのウォレットは EIP-6963 で
     「ここにいます」と名乗り出るので、それを集めて、2本以上なら選んでもらう。 */
  var wallets = [];   // [{ info: {uuid, name, icon, rdns}, provider }]
  function listenWallets() {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('eip6963:announceProvider', function (ev) {
      var d = ev && ev.detail;
      if (!d || !d.provider || !d.info) return;
      if (wallets.some(function (w) { return w.info.uuid === d.info.uuid; })) return;
      wallets.push({ info: d.info, provider: d.provider });
      /* 2026-10-17: 前に選んだ財布（rdns で覚えておく）があれば、それを使う。毎回「どれでつなぐ？」と聞かない */
      if (!state.chosen && d.info.rdns && d.info.rdns === savedWallet()) state.chosen = d.provider;
      renderWallets();
    });
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) {}
  }
  /* ★ 2026-10-11 総点検: MetaMask でアカウントを切り替えても、覚えていた口座のままだった。
     使う財布の accountsChanged を聞いて、覚えている口座を合わせる。 */
  var watched = [];
  function watchAccounts(p) {
    if (!p || typeof p.on !== 'function' || watched.indexOf(p) >= 0) return;
    watched.push(p);
    try {
      p.on('accountsChanged', function (accs) {
        if (provider() !== p) return;
        state.account = (accs && accs[0]) || null;
        renderWallets(); syncButtons(); checkOwner();
      });
    } catch (e) {}
  }
  function provider() {
    if (state.chosen) return state.chosen;
    if (wallets.length === 1) return wallets[0].provider;
    return (typeof window !== 'undefined' && window.ethereum) ? window.ethereum : null;
  }
  /** ウォレットが2本以上なら、どれでつなぐかのボタンを出す。 */
  function renderWallets() {
    var box = $('birthWallets');
    if (!box) return;
    /* エージェントができたあとは、つないだ口座が持ち主と違うときも出す（別の財布へ乗り換えられるように） */
    var me = state.done || loadSaved();
    var ownerOk = !!(state.account && me && me.owner && String(state.account).toLowerCase() === String(me.owner).toLowerCase());
    if (wallets.length < 2 || isFile() || (state.account && (me ? (state.chosen && ownerOk) : true))) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<span class="birth-pick">' + esc(t('birth.pick')) + '</span>';
    wallets.forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ghost birth-wallet' + (state.chosen === w.provider ? ' on' : '');
      if (w.info.icon && /^data:image\//.test(w.info.icon)) {
        var img = document.createElement('img'); img.src = w.info.icon; img.alt = ''; img.width = 18; img.height = 18; b.appendChild(img);
      }
      b.appendChild(document.createTextNode(' ' + String(w.info.name || ('wallet ' + (i + 1)))));
      /* つないでいる途中でも押せる（片方の確認画面が出ないときに、もう片方へ乗り換えられる） */
      b.addEventListener('click', function () { if (state.chosen !== w.provider) state.account = null; state.chosen = w.provider; rememberWallet(w.info.rdns); renderWallets(); connect(); });
      box.appendChild(b);
    });
  }
  var WALLET_KEY = 'aq.wallet.rdns';
  function savedWallet() { try { return localStorage.getItem(WALLET_KEY) || ''; } catch (e) { return ''; } }
  function rememberWallet(rdns) { try { if (rdns) localStorage.setItem(WALLET_KEY, String(rdns)); } catch (e) {} }
  function esc(x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /** ウォレットが見つからないときの案内（ファイルを直接開いているときは、その理由を言う）。 */
  function noWalletKey() {
    return (typeof location !== 'undefined' && location.protocol === 'file:') ? 'birth.noWalletFile' : 'birth.noWallet';
  }
  /* ★ 2026-10-11: ファイルを直接開いている（file://）と、MetaMask はページとやりとりできない
     （ブラウザの安全上の制限。名乗り出はしても、接続の頼みに返事が来ない）。
     → 最初から「start.bat で http://localhost から開いて」と案内し、ボタンは押せなくする。 */
  function isFile() { return typeof location !== 'undefined' && location.protocol === 'file:'; }
  function rpc(method, params) { return provider().request({ method: method, params: params || [] }); }

  function status(key, vars, kind) {
    var el = $('birthStatus');
    if (!el) return;
    el.textContent = key ? t(key, vars) : '';
    el.className = 'birth-status' + (kind ? ' ' + kind : '');
  }
  function syncButtons() {
    var name = cleanName($('birthName') && $('birthName').value);
    if ($('birthConnect')) {
      $('birthConnect').textContent = state.account ? t('birth.connected', { addr: short(state.account) })
        : (state.connecting ? t('birth.retry') : t('birth.connect'));
      $('birthConnect').disabled = state.busy || !!state.account || isFile();
    }
    if ($('birthGo')) $('birthGo').disabled = state.busy || !state.account || !name;
  }
  function short(a) { a = String(a || ''); return a.slice(0, 6) + '…' + a.slice(-4); }

  /* ★ 2026-10-11: 「ウォレットにつないでいます…」のまま止まる報告。
     eth_requestAccounts は、ウォレットの確認画面で「接続」を押すまで返ってこない。
     確認画面が出ない（ロック中・別の窓の裏・前の頼みが残っている）と、いつまでも待つ。
     → 待っているあいだもボタンは押せるままにして、
       ・少し待っても返事が無ければ、ウォレットの開き方を案内する
       ・「やり直す」や別のウォレットを押したら、前の頼みの返事は無視して頼みなおす */
  function stopHint() { if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; } }
  function connect() {
    if (state.account || state.busy) return Promise.resolve(state.account);
    if (isFile()) { status('birth.fileProto', null, 'bad'); return Promise.resolve(null); }
    if (!provider()) { status(noWalletKey(), null, 'bad'); return Promise.resolve(null); }
    if (!state.chosen && wallets.length > 1) { renderWallets(); status('birth.pick'); return Promise.resolve(null); }
    var my = ++state.attempt;
    state.connecting = true; syncButtons(); status('birth.connecting');
    watchAccounts(provider());
    stopHint();
    hintTimer = setTimeout(function () {
      if (my === state.attempt && state.connecting) status(wallets.length > 1 ? 'birth.slowConnect2' : 'birth.slowConnect', null, 'bad');
    }, HINT_MS);
    return rpc('eth_requestAccounts').then(function (accs) {
      if (my !== state.attempt) return null;          // 頼みなおしたあとに、古い頼みの返事が来た
      state.account = (accs && accs[0]) || null;
      if (state.account && AQ.quest) AQ.quest.setFlag('connect');
      checkOwner();
      /* 身分証ができたあとは「名前を決めて作る」の案内は出さない（つながっただけ） */
      if (state.done || loadSaved()) status(state.account ? null : 'birth.noAccount', null, state.account ? '' : 'bad');
      /* クエスト1（つなぐだけ）の窓では、名前の欄は出していないので「名前を決めて」の案内も出さない */
      else if (state.account && document.querySelector('.quest-win[data-q="connect"]:not([hidden])')) status(null);
      else status(state.account ? 'birth.readyName' : 'birth.noAccount', null, state.account ? '' : 'bad');
      return state.account;
    }).catch(function (e) {
      if (my !== state.attempt) return null;
      var c = e && e.code;
      /* -32002 = 前の頼みがウォレットの中にまだ残っている（MetaMask など） */
      status(c === 4001 ? 'birth.rejected' : (c === -32002 ? 'birth.pendingReq' : 'birth.failed'), { msg: errMsg(e) }, 'bad');
      return null;
    }).then(function (a) {
      if (my !== state.attempt) return a;
      stopHint(); state.connecting = false; renderWallets(); syncButtons();
      return a;
    });
  }
  /** 「やり直す」：待っている頼みは捨てて、もう一度頼む。 */
  function connectOrRetry() {
    if (state.connecting) { state.connecting = false; state.attempt++; stopHint(); }
    return connect();
  }

  function ensureBase() {
    return rpc('eth_chainId').then(function (id) {
      if (String(id).toLowerCase() === BASE.hex) return;
      status('birth.switching');
      return rpc('wallet_switchEthereumChain', [{ chainId: BASE.hex }]).catch(function (e) {
        if (e && (e.code === 4902 || /unrecognized|not added/i.test(e.message || ''))) {
          return rpc('wallet_addEthereumChain', [{ chainId: BASE.hex, chainName: BASE.name,
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: [BASE.rpc], blockExplorerUrls: [BASE.explorer] }]);
        }
        throw e;
      }).then(function () {
        return rpc('eth_chainId').then(function (id2) {
          if (String(id2).toLowerCase() !== BASE.hex) { var er = new Error('wrong chain'); er.aq = 'birth.wrongChain'; throw er; }
        });
      });
    });
  }

  function waitReceipt(hash) {
    var tries = 0;
    return new Promise(function (resolve, reject) {
      (function poll() {
        rpc('eth_getTransactionReceipt', [hash]).then(function (r) {
          if (r) { resolve(r); return; }
          if (++tries > 90) { var e = new Error('timeout'); e.aq = 'birth.slow'; reject(e); return; }
          setTimeout(poll, 2000);
        }).catch(function (e) { if (++tries > 90) reject(e); else setTimeout(poll, 2000); });
      })();
    });
  }

  /** 届いた記録から、この人に届いた身分証の番号を読む（ERC-721 の Transfer：0 → 本人）。 */
  function agentIdFrom(receipt, owner) {
    var logs = (receipt && receipt.logs) || [];
    var me = '0x' + '0'.repeat(24) + String(owner).toLowerCase().replace(/^0x/, '');
    for (var i = 0; i < logs.length; i++) {
      var L = logs[i], tp = L.topics || [];
      if (String(L.address).toLowerCase() !== REGISTRY.toLowerCase()) continue;
      if (String(tp[0]).toLowerCase() !== TOPIC_TRANSFER) continue;
      if (!/^0x0+$/.test(String(tp[1])) || String(tp[2]).toLowerCase() !== me) continue;
      return BigInt(tp[3]).toString();
    }
    return null;
  }

  function errMsg(e) {
    if (!e) return '';
    var m = (e.data && e.data.message) || e.shortMessage || e.message || String(e);
    return String(m).slice(0, 120);
  }

  function create() {
    var name = cleanName($('birthName').value);
    if (!name || !state.account || state.busy) return;
    state.busy = true; syncButtons();
    var owner = state.account, txHash = null;
    ensureBase().then(function () {
      status('birth.checking');
      return rpc('eth_getCode', [REGISTRY, 'latest']);
    }).then(function (code) {
      /* 登録先が本当にあるか。無いチェーン・無いアドレスには送らない（作り話をしない）。 */
      if (!code || /^0x0*$/.test(code)) { var e = new Error('no registry'); e.aq = 'birth.noRegistry'; throw e; }
      /* ★ 2026-11-02 ウォレットに頼む前に、アプリの中で中身を見せる。押すまでウォレットは呼ばない */
      status('confirm.look');
      return AQ.confirm.ask({
        after: $('birthStatus'),
        what: t('confirm.what.birth', { name: name }),
        rows: [AQ.confirm.party('IdentityRegistry', REGISTRY), { k: t('confirm.money'), v: t('confirm.gasOnly') }],
        ok: t('confirm.okTx')
      });
    }).then(function () {
      status('birth.confirm');
      var codes = (AQ.config && AQ.config.builderCode) ? [AQ.config.builderCode] : [];
      return rpc('eth_sendTransaction', [{ from: owner, to: REGISTRY, value: '0x0', data: registerData(agentURIFor(name), codes) }]);
    }).then(function (hash) {
      txHash = hash;
      status('birth.waiting');
      return waitReceipt(hash);
    }).then(function (receipt) {
      if (receipt.status && receipt.status !== '0x1' && receipt.status !== 1) { var e = new Error('reverted'); e.aq = 'birth.reverted'; throw e; }
      var id = agentIdFrom(receipt, owner);
      if (id == null) { var e2 = new Error('no id'); e2.aq = 'birth.noId'; throw e2; }
      state.done = { agentId: id, name: name, owner: owner, tx: txHash, chain: BASE.id, t: Date.now() };
      save(state.done);
      showDone(state.done);
      status('birth.born', { id: id, name: name }, 'good');
    }).catch(function (e) {
      if (e && e.code === 4001) status('birth.rejected', null, 'bad');
      else if (e && e.aq === 'confirm.cancelled') status('confirm.cancelled');
      else if (e && e.aq) status(e.aq, { tx: txHash ? short(txHash) : '' }, 'bad');
      else status('birth.failed', { msg: errMsg(e) }, 'bad');
    }).then(function () { state.busy = false; syncButtons(); });
  }

  function showDone(d) {
    var box = $('birthDone');
    if (!box || !d) return;
    box.hidden = false;
    $('birthDoneMsg').textContent = t('birth.doneMsg', { id: d.agentId, name: d.name });
    var tx = $('birthTx');
    tx.href = BASE.explorer + '/tx/' + d.tx; tx.textContent = t('birth.txLink');
    var ex = $('birthExplorer');
    ex.href = 'https://erc-8004.quicknode.com/agents/base-mainnet/' + encodeURIComponent(d.agentId);
    ex.textContent = t('birth.explorerLink');
    $('birthForm').hidden = true;
    /* 生まれたあとは「作り方」の説明はしまって、自分のエージェントの窓にする */
    if ($('birthSteps')) $('birthSteps').hidden = true;
    if ($('birthLead')) $('birthLead').hidden = true;
    if ($('birthTitle')) $('birthTitle').textContent = t('birth.titleMine', { id: d.agentId, name: d.name });
    if (AQ.robot) AQ.robot.refresh();
    if (AQ.quest) AQ.quest.refresh();
  }

  /** 生まれた場面（本当に起きたことだけ：登録された → 家で休む）。 */
  function eventsFor(d) {
    var T = d.t || Date.now();
    var actor = d.name + ' #' + d.agentId;
    var meta = { born: true, agentId: d.agentId, tx: d.tx, tSource: 'chain', owner: d.owner, stage: 'city' };   // ★ 2026-10-13: 「街で見る」なのに部屋が出ていた（行き先の無い2コマは部屋と判定されていた）
    return [
      { v: 1, run: 'birth', t: T, actor: actor, type: 'run.start', meta: meta },
      { v: 1, run: 'birth', t: T + 1000, actor: actor, type: 'run.end', meta: meta }
    ];
  }
  function watch() {
    var d = state.done || loadSaved();
    if (!d) return;
    close('watch');
    var ev = eventsFor(d);
    AQ.app.loadEvents(ev);
    if (AQ.app.focusOn) AQ.app.focusOn(ev[0].actor);
  }

  function relabel() {
    if (typeof checkOwner === 'function') checkOwner();
    var map = { birthTitle: 'birth.title', birthLead: 'birth.lead', birthNameLbl: 'birth.nameLbl',
                birthGo: 'birth.go', birthWatch: 'birth.watch', birthNote: 'birth.note',
                birthStep1: 'birth.step1', birthStep2: 'birth.step2', birthStep3: 'birth.step3' };
    Object.keys(map).forEach(function (id) { if ($(id)) $(id).textContent = t(map[id]); });
    if ($('birthName')) $('birthName').placeholder = t('birth.namePh');
    if ($('birthClose')) { $('birthClose').title = t('cmd.close'); $('birthClose').setAttribute('aria-label', t('cmd.close')); }
    var saved = loadSaved();
    if ($('startBirthT')) $('startBirthT').textContent = saved ? t('birth.doorMine', { id: saved.agentId, name: saved.name }) : t('birth.doorT');
    relabelDoor();
    syncButtons();
    if (state.done) showDone(state.done);
  }

  /** 開始画面の扉：クエストの進み具合も出す */
  function relabelDoor() {
    var saved = loadSaved();
    var n = AQ.quest ? AQ.quest.count() : 0, total = AQ.quest ? AQ.quest.total : 0;
    /* 2026-10-18: はじめの画面ではクエストが主役。この扉は「クエスト帳を開く」（進みぐあいつき） */
    if ($('startBirthT')) $('startBirthT').textContent = t('start.book');
    if ($('startBirthS')) $('startBirthS').textContent = total ? t('quest.doorProgress', { n: n, total: total }) : '';
    if (AQ.quest && AQ.quest.renderStart) AQ.quest.renderStart();
  }

  /* =============================================================
     ★ 2026-10-17 途中でウォレットのアドレスを変えたとき（利用者の報告）
     このブラウザに覚えているエージェントの持ち主と、いまつないでいる口座が違えば、
     画面の上（自分のエージェントの画面・クエストの窓）にそう出し、
     「持ち主に切り替える」か「いまのウォレットで最初からやり直す」を選べるようにする。
     ============================================================= */
  function sameAddr(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }
  function ownerMismatch() {
    var me = state.done || loadSaved();
    return !!(me && me.owner && state.account && !sameAddr(state.account, me.owner));
  }
  function checkOwner() {
    var bad = ownerMismatch(), me = state.done || loadSaved();
    if (typeof document === 'undefined' || !document.querySelectorAll) return bad;
    Array.prototype.forEach.call(document.querySelectorAll('.owner-warn'), function (box) {
      var was = !box.hidden;
      box.hidden = !bad; box.innerHTML = '';
      if (bad && !was && box.offsetParent !== null && box.scrollIntoView) setTimeout(function () { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
      if (!bad) return;
      var b = document.createElement('b'); b.textContent = '⚠ ' + t('birth.ownerWarn.title'); box.appendChild(b);
      var p = document.createElement('p'); p.textContent = t('birth.ownerWarn.body', { acc: short(state.account), owner: short(me.owner), id: me.agentId, name: me.name || '' }); box.appendChild(p);
      box.appendChild(resetButton(t('birth.ownerWarn.reset')));
    });
    return bad;
  }
  /** 財布に「いまの口座」を聞く（確認画面は出さない）。財布が2つあって選んでいないときは聞かない（違う財布の口座を拾わないため） */
  function silentCheck() {
    var p = provider();
    if (!(state.done || loadSaved())) return;      // まだエージェントがいなければ、つなぐのは「ウォレットをつなぐ」のときだけ
    if (!p || isFile() || (!state.chosen && wallets.length > 1)) { checkOwner(); return; }
    watchAccounts(p);
    try {
      p.request({ method: 'eth_accounts' }).then(function (accs) {
        if (provider() !== p) return;
        if (accs && accs[0]) { state.account = accs[0]; renderWallets(); syncButtons(); }
        checkOwner();
      }, function () { checkOwner(); });
    } catch (e) { checkOwner(); }
  }
  /** このブラウザに覚えている「自分のエージェント」の記録を消して、最初からやり直す（チェーンの記録は消えない） */
  function resetAll() {
    var ks = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^aq\.myAgent/.test(k) || /^aq\.quest\./.test(k) || k === WALLET_KEY) ks.push(k);
      }
      ks.forEach(function (k) { localStorage.removeItem(k); });
      sessionStorage.setItem('aq.openBirth', '1');   // 読み込み直したら、すぐ「自分のエージェントを作る」を開く
    } catch (e) {}
    location.reload();
  }
  /** やり直しのボタン。1回目は「本当に？」と聞き、6秒以内にもう一度押すと消す（ブラウザの確認ダイアログは使わない） */
  function resetButton(label) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'reset-btn'; b.textContent = label;
    var armed = false, tm = null;
    b.addEventListener('click', function () {
      if (!armed) {
        armed = true; b.classList.add('arm'); b.textContent = t('birth.reset.confirm');
        tm = setTimeout(function () { armed = false; b.classList.remove('arm'); b.textContent = label; }, 6000);
        return;
      }
      clearTimeout(tm); resetAll();
    });
    return b;
  }

  function open() {
    var scr = $('birthScreen');
    if (!scr) return;
    var saved = loadSaved();
    if (saved && !state.done) state.done = saved;
    relabel();
    if (state.done) showDone(state.done);
    else {
      $('birthForm').hidden = false; $('birthDone').hidden = true;
      try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) {}
      renderWallets();
      if (isFile()) status('birth.fileProto', null, 'bad');
      else status(provider() ? null : noWalletKey(), null, provider() ? '' : 'bad');
    }
    scr.hidden = false;
    silentCheck();
    if (AQ.quest) AQ.quest.render();
    /* 開いたら上（クエスト帳）から見せる。フォーカスで下へ動かさない */
    setTimeout(function () {
      var f = state.done ? (document.querySelector('#questList .quest:not(:disabled)') || $('birthWatch')) : (state.account ? $('birthName') : $('birthConnect'));
      if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
      var card = scr.querySelector('.birth-card'); if (card) card.scrollTop = 0;
      scr.scrollTop = 0;
    }, 0);
  }
  /** 閉じる。reason が 'watch'（部屋や街で見に行く）なら、あとで戻れるように「クエストにもどる」を出す */
  function close(reason) {
    var scr = $('birthScreen');
    if (reason === 'watch' && scr && !scr.hidden && AQ.quest && AQ.quest.markReturn) AQ.quest.markReturn();
    if (scr) scr.hidden = true;
  }

  function init() {
    if (!$('birthScreen')) return;
    $('birthConnect').addEventListener('click', connectOrRetry);
    $('birthGo').addEventListener('click', create);
    $('birthWatch').addEventListener('click', watch);
    $('birthClose').addEventListener('click', function () { close(); });
    $('birthName').addEventListener('input', syncButtons);
    $('birthName').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') create(); });
    $('birthScreen').addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } });
    $('birthScreen').addEventListener('click', function (ev) { if (ev.target === $('birthScreen')) close(); });
    if ($('startBirth')) $('startBirth').addEventListener('click', open);
    listenWallets();
    relabel();
    try { if (sessionStorage.getItem('aq.openBirth')) { sessionStorage.removeItem('aq.openBirth'); setTimeout(open, 0); } } catch (e) {}
  }

  AQ.birth = {
    init: init, open: open, close: close, relabel: relabel,
    mine: function () { return state.done || loadSaved(); },
    relabelDoor: function () { relabelDoor(); },
    checkOwner: function () { return checkOwner(); }, ownerMismatch: function () { return ownerMismatch(); },
    resetButton: function (label) { return resetButton(label); },
    /* ★ 2026-10-11: ロボットの「お使い（x402）」「身分証を育てる」が同じ財布の道具を使う */
    wallet: {
      provider: function () { return provider(); },
      account: function () { return state.account; },
      /* いまの口座を財布に聞き直してから使う（切り替えていたら合わせる）。まだなら接続を頼む */
      connect: function () {
        if (!state.chosen && wallets.length > 1) { renderWallets(); return Promise.resolve(null); }   // 選ぶボタンの見出しが「選んでください」と言う
        var p = provider();
        if (!p) return Promise.resolve(null);
        watchAccounts(p);
        return rpc('eth_accounts').then(function (accs) {
          if (accs && accs[0]) { state.account = accs[0]; syncButtons(); renderWallets(); checkOwner(); return state.account; }
          state.account = null;
          return connect();
        }, function () { return state.account ? state.account : connect(); });
      },
      needsPick: function () { return !state.chosen && wallets.length > 1; },
      rpc: function (m, p) { return rpc(m, p); },
      ensureBase: function () { return ensureBase(); },
      waitReceipt: function (h) { return waitReceipt(h); },
      builderSuffix: function () { return builderSuffix((AQ.config && AQ.config.builderCode) ? [AQ.config.builderCode] : []); },
      agentURIType: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      BASE: BASE
    },
    /* 検査用（作り方そのものを外から確かめる） */
    _builderSuffix: builderSuffix, _registerData: registerData, _agentURIFor: agentURIFor,
    _agentIdFrom: agentIdFrom, _eventsFor: eventsFor, REGISTRY: REGISTRY,
    _setHintMs: function (n) { HINT_MS = n; }
  };
})(window.AQ = window.AQ || {});
