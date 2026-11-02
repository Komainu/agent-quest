/* =============================================================
   quest.js — クエスト帳（2026-10-13）
   -------------------------------------------------------------
   利用者の方針: 「AIエージェントを作成し、実際に動かす体験」をメインに。クエスト方式で、
   たとえばニュースを買うとチェックが付いて完了。ひととおり体験すれば全部にチェックが入る。
   順番: 1〜2（つなぐ → 生み出す）だけ順番必須、3 からは自由に選べる。
   最終目標: Base の Builder Code（ERC-8021）を埋め込むこと → 最後のクエストで、
             自分の取引に Builder Code の印が本当に入っているかを Base の記録で確かめる。

   ★ 作り話をしない
     チェックは「押した」ではなく「成功を確かめた」ときだけ。各モジュールが確かめてから残した
     記録（このブラウザの localStorage）を読んで判定する。
       hello   … サーバーが返した自分の書き込み（lobby）
       news    … お店が 200 で中身を返した x402 の支払い
       job     … kibble に貼れた JOB の行
       judge   … 依頼主として送れた ATTEST の行
       card    … setAgentURI の記録（URIUpdated）を確かめた
       feedback… NewFeedback の記録を確かめた
       mail    … 署名した手紙を届けられた
       builder … Base の取引の中身に、このアプリの Builder Code の印を見つけた
   ============================================================= */
(function (AQ) {
  'use strict';

  var FLAG = 'aq.quest.';
  var SEEN = 'aq.quest.seen';
  function t(k, v) { return AQ.i18n.t(k, v); }
  function $(id) { return document.getElementById(id); }
  function mine() { return (AQ.birth && AQ.birth.mine && AQ.birth.mine()) || null; }
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function flag(k) { try { return localStorage.getItem(FLAG + k) === '1'; } catch (e) { return false; } }
  function setFlag(k) { try { localStorage.setItem(FLAG + k, '1'); } catch (e) {} refresh(); }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function myDid() { var k = J('aq.myAgent.key', null); return k && k.did || null; }
  function posts() { var did = myDid(); return J('aq.myAgent.posts', []).filter(function (p) { return p && (!did || p.from === did); }); }
  function acts(kind) { return (AQ.activity ? AQ.activity.load() : []).filter(function (a) { return a.kind === kind; }); }

  /* クエストの一覧（順番どおり）。open … 「やってみる」で何をするか */
  var QUESTS = [
    { id: 'connect', icon: '🦊', cost: 'free',   done: function () { return flag('connect') || !!mine(); },
      open: function () { var b = $('birthConnect'); if (b && !b.disabled) b.click(); else if (b) b.focus(); } },
    { id: 'create',  icon: '🪪', cost: 'gas',    done: function () { return !!mine(); },
      open: function () { var n = $('birthName'); if (n) n.focus(); } },
    { id: 'hello',   icon: '👋', cost: 'free',   done: function () { return posts().some(function (p) { return p.room === 'lobby'; }) || acts('post').some(function (a) { return a.room === 'lobby'; }); },
      open: function () { panel(null); if (AQ.robot && AQ.robot.hello) AQ.robot.hello(); } },
    { id: 'news',    icon: '📰', cost: 'usdc',   done: function () { return flag('news') || J('aq.myAgent.errands', []).some(function (x) { return x && x.shop === 'news' && x.result; }); },
      open: function () { panel('robotErrand', function () { if (AQ.errand && AQ.errand.pickShop) AQ.errand.pickShop('news'); }); } },
    { id: 'job',     icon: '📌', cost: 'free',   done: function () { return J('aq.myAgent.jobs', []).length > 0; },
      open: function () { panel('robotJobForm'); } },
    { id: 'judge',   icon: '🔍', cost: 'free',   done: function () { return posts().some(function (p) { return p.room === 'kibble' && /^ATTEST v1 \|/.test(p.text || ''); }); },
      open: function () { openJudge(); } },
    { id: 'card',    icon: '🌱', cost: 'gas',    done: function () { return !!J('aq.myAgent.card', null); },
      open: function () { panel('robotCard'); } },
    { id: 'feedback',icon: '🤝', cost: 'gas',    done: function () { return J('aq.myAgent.feedback', []).length > 0; },
      open: function () { panel('robotFeedback'); } },
    { id: 'mail',    icon: '📮', cost: 'free',   done: function () { return flag('mail') || acts('mail-send').length > 0; },
      open: function () { panel('robotMail'); } },
    /* ★ 2026-10-26 Technocore でできることを増やす：メモ（記憶）と tclk（取引の約束）の練習 */
    { id: 'memo',    icon: '🧠', cost: 'free',   done: function () { return !!J('aq.myAgent.memo', null); },
      open: function () { panel('robotMemo'); } },
    { id: 'deal',    icon: '🔐', cost: 'free',   done: function () { return !!J('aq.myAgent.deal', null); },
      open: function () { panel('robotDeal'); } },
    { id: 'town',    icon: '🗺️', cost: 'free',   done: function () { return flag('town'); },
      open: function () { if (AQ.activity && AQ.activity.watchDay()) setFlag('town'); else say('quest.townEmpty', 'bad'); } },
    { id: 'builder', icon: '🏷️', cost: 'free',   done: function () { return flag('builder'); },
      open: function () { checkBuilder(); } }
  ];
  function locked(q) {
    if (q.id === 'connect') return false;
    if (q.id === 'create') return !QUESTS[0].done();
    return !mine();
  }
  /* 判定のクエスト: 一覧を開いて読み直し、いま何ができるかをクエスト帳に書く（押しても何も起きないように見えないように） */
  function openJudge() {
    if (!AQ.robot || !AQ.robot.renderJobs) return;
    var el = $('robotJobs');                    // 開くだけ（読み込みは下で1回だけ）。案内（すぐ下）を読めるよう、まだ画面は動かさない
    if (el && el.hidden) AQ.robot.togglePanel('robotJobs');
    say('robot.jobs.loading');
    var g = winGen;
    AQ.robot.renderJobs().then(function (s) {
      /* ★ 2026-10-19 読み込みを待つあいだに別のクエストへ移ったら、判定の案内は出さない
         （評価の窓に「判定できる納品がありません」が赤字で出て紛らわしかった・利用者の報告） */
      if (g !== winGen) return;
      /* もう判定したなら（クエストは1件でクリア）、「判定できる納品が N 件」とは言わない */
      if (!s.fail && s.judged && QUESTS.filter(function (x) { return x.id === 'judge'; })[0].done()) { say(null); return; }
      if (s.fail) say('quest.judge.netFail', 'bad');
      else if (s.judgeable) {
        say('quest.judge.ready', 'good', { n: s.judgeable }); flash('robotJobs');
        var j = document.querySelector('#robotJobsList .robot-judge'); if (j && j.scrollIntoView) j.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      else if (s.waiting) say('quest.judge.waiting', null, { n: s.waiting });
      else say(s.total ? 'quest.judge.needJob' : 'quest.judge.noJob', null, null, { label: t('quest.judge.toJob'), nav: true, fn: function () { openWin('job'); } });
    });
  }
  function flash(id) { var p = $(id); if (!p) return; p.classList.remove('quest-flash'); void p.offsetWidth; p.classList.add('quest-flash'); }
  function panel(id, after, noScroll) {
    if (!id) return;
    var el = $(id);
    if (el && el.hidden && AQ.robot && AQ.robot.togglePanel) {   // もう開いていれば閉じない（押すたびに開け閉めしない）
      /* robot.js 側の「開くときの準備」を通すため、対応するボタンを押す */
      var btn = { robotErrand: 'robotErrandOpen', robotJobForm: 'robotJobOpen', robotJobs: 'robotJobsOpen', robotCard: 'robotCardOpen',
                  robotFeedback: 'robotFeedbackOpen', robotMail: 'robotMailOpen' }[id];
      if (btn && $(btn)) $(btn).click(); else AQ.robot.togglePanel(id);
    }
    if (after) after();
    if (!noScroll) setTimeout(function () { var p = $(id); if (p && !p.hidden && p.scrollIntoView) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 50);
  }
  function say(key, kind, vars, action) {
    var el = $('questSay'); if (!el) return;
    el.textContent = key ? t(key, vars) : '';
    el.className = 'quest-say' + (kind ? ' ' + kind : '');
    if (key && action) {
      var b = mk('button', 'quest-say-act' + (action.nav ? ' nav' : ''), action.label); b.type = 'button';   // nav＝別のクエストへ移る（青）
      b.addEventListener('click', action.fn);
      el.appendChild(document.createElement('br')); el.appendChild(b);
    }
  }

  /* ---- お店が止まっていて進めないとき、自分で完了にする（2026-10-21 利用者の要望） ----
     押したことと理由を記録し、「本当の記録」の欄には「お店が止まっていたので自分で完了にした（買えてはいない）」と書く */
  function offerSkip(id, why, vars) {
    var q = QUESTS.filter(function (x) { return x.id === id; })[0];
    if (!q || q.done() || win.id !== id) return;
    var early = ['errand.shopSlow', 'errand.shopDown', 'errand.not402'].indexOf(why) >= 0;   // まだ署名していない
    say(early ? 'quest.skip.offerEarly' : 'quest.skip.offer', null, null, { label: '✓ ' + t('quest.skip.btn'), fn: function () {
      try { localStorage.setItem(FLAG + id + '.manual', JSON.stringify({ t: Date.now(), why: why, shop: (vars && vars.shop) || '' })); } catch (e) {}
      setFlag(id);
      say('quest.skip.done', 'good');
    } });
    var b = document.querySelector('#questSay .quest-say-act'); if (b && b.scrollIntoView) setTimeout(function () { b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 80);
  }

  /* ---- 最後のクエスト：Builder Code の印を確かめる ---- */
  function codeHex() {
    var c = (AQ.config && AQ.config.builderCode) || '';
    return Array.from(new TextEncoder().encode(c)).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }
  function myTxs() {
    var d = mine(), list = [];
    if (d && d.tx) list.push({ kind: 'birth', tx: d.tx });
    var c = J('aq.myAgent.card', null); if (c && c.tx) list.push({ kind: 'card', tx: c.tx });
    J('aq.myAgent.feedback', []).forEach(function (f) { if (f && f.tx) list.push({ kind: 'feedback', tx: f.tx }); });
    J('aq.myAgent.errands', []).forEach(function (x) { if (x && x.tx) list.push({ kind: 'x402', tx: x.tx }); });
    var seen = {};
    return list.filter(function (x) { var k = String(x.tx).toLowerCase(); if (!/^0x[0-9a-f]{64}$/.test(k) || seen[k]) return false; seen[k] = 1; return true; }).slice(-12);
  }
  /** 取引の中身（input）の最後に ERC-8021 の印（8021 ×8）があり、その中にこのアプリのコードがあるか */
  function hasCode(input) {
    var h = String(input || '').toLowerCase().replace(/^0x/, ''), mark = '8021'.repeat(8), code = codeHex();
    if (!code || h.slice(-mark.length) !== mark) return false;
    return h.slice(Math.max(0, h.length - 600)).indexOf(code) >= 0;
  }
  var checking = false;
  function checkBuilder() {
    if (checking) return;
    var txs = myTxs(), box = $('questBuilder');
    if (!box) return;
    box.hidden = false; box.innerHTML = '';
    box.appendChild(mk('b', 'quest-b-title', t('quest.b.title', { code: (AQ.config && AQ.config.builderCode) || '' })));
    if (!txs.length) { box.appendChild(mk('p', 'robot-empty', t('quest.b.none'))); return; }
    checking = true;
    var api = ((AQ.chains || []).filter(function (c) { return c.id === 'base'; })[0] || {}).api || 'https://base.blockscout.com/api/v2';
    var ul = mk('ul', 'quest-b-list'); box.appendChild(ul);
    var found = 0, okTxs = [], g = winGen;
    /* ★ 2026-10-20 「ここで止まってしまう」（利用者の報告）：Blockscout が返事をしないと、時間切れが無いため
       「確かめています…」のまま待ち続けていた。
       → 取引の中身は、まず Base の公式の窓口（mainnet.base.org の eth_getTransactionByHash）で読む。
         だめなときだけ Blockscout。2つあわせて 8 秒で打ち切る。1つ見つかった時点でクリアにする（全部を待たない） */
    function getT(url, ms, opt) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var tm = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
      var o = opt || {}; o.mode = 'cors'; if (ctl) o.signal = ctl.signal;
      return fetch(url, o).then(function (r) { clearTimeout(tm); return r.ok ? r.json() : null; }, function (e) { clearTimeout(tm); throw e; });
    }
    function inputOf(hash) {
      var t0 = Date.now();                    // 2つの窓口あわせて 8 秒まで（それ以上は待たせない）
      return AQ.rpc.call('eth_getTransactionByHash', [hash], 8000)   // 自分用の窓口 → 公式の窓口（src/rpc.js）
        .then(function (r) { var x = r && r.input; if (!x) throw new Error('no input'); return x; })
        .catch(function () { var left = 8000 - (Date.now() - t0); if (left < 500) throw new Error('timeout'); return getT(api + '/transactions/' + hash, left).then(function (j) { return (j && (j.raw_input || j.input)) || null; }); });
    }
    function cleared() {
      try { localStorage.setItem('aq.quest.builderTxs', JSON.stringify(okTxs.slice(0, 12))); } catch (e) {}
      if (!flag('builder')) setFlag('builder');
      if (g === winGen) say('quest.b.done', 'good', { n: found });
    }
    Promise.all(txs.map(function (x) {
      var li = mk('li', null, t('quest.b.kind.' + x.kind) + ' … ' + t('quest.b.checking')); ul.appendChild(li);
      return inputOf(x.tx).then(function (input) {
        var ok = !!input && hasCode(input);
        if (ok) { found++; okTxs.push({ kind: x.kind, tx: x.tx }); cleared(); }
        li.textContent = '';
        li.className = ok ? 'ok' : 'ng';
        li.appendChild(mk('span', null, (ok ? '✓ ' : '・ ') + t('quest.b.kind.' + x.kind) + ' — ' + (input ? t(ok ? 'quest.b.yes' : (x.kind === 'x402' ? 'quest.b.noX402' : 'quest.b.no')) : t('quest.b.unknown'))));
        var a = mk('a', 'errand-link', ' ' + x.tx.slice(0, 10) + '…'); a.href = 'https://basescan.org/tx/' + x.tx; a.target = '_blank'; a.rel = 'noopener';
        li.appendChild(a);
      }).catch(function () {
        li.textContent = ''; li.className = 'ng';
        li.appendChild(mk('span', null, '・ ' + t('quest.b.kind.' + x.kind) + ' — ' + t('quest.b.unknown')));
        var a = mk('a', 'errand-link', ' ' + x.tx.slice(0, 10) + '…'); a.href = 'https://basescan.org/tx/' + x.tx; a.target = '_blank'; a.rel = 'noopener';
        li.appendChild(a);
      });
    })).then(function () {
      checking = false;
      box.appendChild(mk('small', 'robot-job-warn', t('quest.b.note')));
      if (found) cleared();
      else if (g === winGen) say('quest.b.notYet', 'bad');
    });
  }

  /* =============================================================
     クエストの窓（2026-10-16 利用者の要望: 字が小さくて分かりづらい → 別の窓で大きな字で）
     クエストを選ぶと、画面いっぱいの窓が開く。そのクエストで使う操作（ロボットのパネルなど）を
     元の場所からこの窓へ「移して」使い、閉じたら元の場所へ戻す（ボタンの働きはそのまま）。
     ============================================================= */
  /* 財布を使うクエストは、パネルのすぐ下に「状態の文・財布を選ぶボタン」を並べる（窓の上の方に置くと見えない） */
  var WALLET_TAIL = ['robotStatus', 'birthStatus', 'birthWallets'];
  var WIN = {
    connect:  { nodes: ['birthForm', 'birthStatus', 'birthWallets'],
                /* 前に出た「名前を決めて「作る」を…」の案内は、名前の欄が無いこの窓では消しておく */
                prep: function () { var st = $('birthStatus'); if (st && st.textContent === t('birth.readyName')) { st.textContent = ''; st.className = 'birth-status'; } } },
    create:   { nodes: ['birthForm', 'birthStatus', 'birthWallets'], prep: function () { var n = $('birthName'); if (n && !mine()) setTimeout(function () { n.focus(); }, 80); } },
    hello:    { nodes: ['robotStatus', 'robotWatch'], act: 'quest.act.hello' },
    news:     { nodes: ['robotErrand'].concat(WALLET_TAIL), panel: 'robotErrand', prep: function () { if (AQ.errand && AQ.errand.lock) AQ.errand.lock('news'); else if (AQ.errand && AQ.errand.pickShop) AQ.errand.pickShop('news'); } },
    job:      { nodes: ['robotJobForm', 'robotStatus', 'robotWatch'], panel: 'robotJobForm' },
    judge:    { nodes: ['robotJobs', 'robotStatus', 'robotWatch'], prep: function () { openJudge(); } },
    card:     { nodes: ['robotCard'].concat(WALLET_TAIL), panel: 'robotCard' },
    feedback: { nodes: ['robotFeedback'].concat(WALLET_TAIL), panel: 'robotFeedback' },
    /* ★ 2026-10-19 「届いた手紙を見る（0 通）」ボタンは受信箱と重なるのでやめた（郵便受けを3段階に整理） */
    mail:     { nodes: ['robotMail', 'robotStatus'], panel: 'robotMail', prep: function () { if (AQ.mailbox && AQ.mailbox.toSelf) AQ.mailbox.toSelf(); } },   // 2026-10-21 自分あての試しの手紙のクエスト
    memo:     { nodes: ['robotMemo', 'robotStatus'], panel: 'robotMemo', prep: function () { if (AQ.memo) AQ.memo.prep(); } },
    deal:     { nodes: ['robotDeal', 'robotStatus'], panel: 'robotDeal', prep: function () { if (AQ.deal) AQ.deal.prep(); } },
    town:     { nodes: [], act: 'quest.act.town' },
    builder:  { nodes: ['questBuilder'], act: 'quest.act.builder' }
  };
  var win = { id: null, moved: [] };
  var winGen = 0;         // 窓を開け閉めするたびに増える（待ちのあとで出す案内が、別の窓に出ないように）
  var lastWinId = null;   // 最後に開いたクエスト（別のクエストに移ったかの判定用）
  function restoreNodes() {
    if (AQ.wizard) AQ.wizard.stop();
    if (win.id === 'news' && AQ.errand && AQ.errand.lock) AQ.errand.lock(null);   // 窓を出たらお店の固定を外す
    win.moved.forEach(function (m) { if (m.ph.parentNode) { m.ph.parentNode.insertBefore(m.node, m.ph); m.ph.remove(); } });
    win.moved = [];
  }
  function moveIn(id) {
    var node = $(id), slot = $('questWinSlot'); if (!node || !slot) return;
    var ph = document.createComment('quest:' + id);
    node.parentNode.insertBefore(ph, node);
    slot.appendChild(node);
    win.moved.push({ node: node, ph: ph });
  }
  function openWin(id) {
    var q = QUESTS.filter(function (x) { return x.id === id; })[0], w = WIN[id], box = $('questWin');
    if (!q || !box || locked(q)) return;
    restoreNodes();
    winGen++;
    /* ★ 2026-10-19: 前のクエストの結果の文（「お使い成功！」など）が次のクエストの窓に
       残って紛らわしい（利用者の報告）。別のクエストに移ったら、共用の状態の文を消す。 */
    if (lastWinId !== id) {
      ['robotStatus', 'birthStatus'].forEach(function (sid) {
        var el = $(sid); if (el) { el.textContent = ''; el.className = 'birth-status'; }
      });
    }
    lastWinId = id;
    win.id = id; selected = id;
    box.setAttribute('data-q', id);   // 2026-10-22 クエストごとの見た目の出し分け（例：クエスト1では名前の欄を出さない）
    var act = $('questWinAct'); if (act) act.innerHTML = '';
    if ($('questWinSlot')) $('questWinSlot').innerHTML = '';
    w.nodes.forEach(moveIn);
    var say = $('questSay'); if (say) { moveIn('questSay'); say.textContent = ''; say.className = 'quest-say'; }
    if (w.panel) panel(w.panel, null, true);
    if (w.extra && act) w.extra(act);
    if (w.act && act) {
      var b = mk('button', 'go quest-win-go', t(w.act)); b.type = 'button'; b.id = 'questWinGo';
      b.addEventListener('click', function () { q.open(); setTimeout(render, 300); });
      act.appendChild(b);
    }
    box.hidden = false;
    fillWin();
    if (AQ.birth && AQ.birth.checkOwner) AQ.birth.checkOwner();
    if (w.prep) w.prep();
    if (AQ.wizard) AQ.wizard.start(id, w.panel || (id === 'judge' ? 'robotJobs' : null), function () { return q.done(); });   // 2026-10-19: 1画面に1ステップ
    var body = $('questWinBody'); if (body) body.scrollTop = 0;
    setTimeout(function () { var c = $('questWinClose'); if (c && !box.contains(document.activeElement)) c.focus(); }, 30);
    render();
  }
  function fillWin() {
    var id = win.id, box = $('questWin'); if (!id || !box || box.hidden) return;
    var q = QUESTS.filter(function (x) { return x.id === id; })[0], i = QUESTS.indexOf(q), done = q.done();
    $('questWinStep').textContent = t('quest.win.step', { n: i + 1, total: QUESTS.length }) + ' · ' + t('quest.cost.' + q.cost);
    $('questWinTitle').textContent = q.icon + ' ' + t('quest.' + id + '.title');
    $('questWinWhat').textContent = t('quest.' + id + '.what');
    $('questWinLearn').textContent = '💡 ' + t('quest.' + id + '.learn');
    $('questWinCheck').textContent = '✔ ' + t('quest.' + id + '.check');
    $('questWinClose').textContent = '✕ ' + t('quest.win.close');
    $('questWinClose').setAttribute('aria-label', t('quest.win.close'));
    $('questWinBack').textContent = '◀ ' + t('quest.win.back');
    var st = $('questWinState'); st.hidden = !done; st.textContent = done ? t('quest.win.cleared') : '';
    box.classList.toggle('q-done', !!done);   // 2026-10-24 クリアしたら「やること」のボタンを済みの見た目に（取り消し線）
    renderProof(id, done);
    /* 生み出したら、そのまま次の「掲示板であいさつ」へ進める大きなボタン（窓の下の小さなボタンに気づかないことがあるため） */
    var hello = QUESTS.filter(function (x) { return x.id === 'hello'; })[0];
    var cta = $('questWinCta');
    if (cta) {
      var showCta = id === 'create' && done && hello && !hello.done() && !locked(hello);
      cta.hidden = !showCta;
      if (showCta) { $('questWinCtaT').textContent = t('quest.cta.hello'); $('questWinCtaS').textContent = t('quest.cta.helloS'); }
    }
    var nx = nextOpen(id), nb = $('questWinNext');
    nb.hidden = !nx; nb.textContent = nx ? t('quest.win.next', { name: t('quest.' + nx.id + '.title') }) + ' ▶' : '';
    nb.classList.toggle('ready', done);
    var go = $('questWinGo'); if (go && WIN[id].act) go.textContent = t(WIN[id].act);
    if ((id === 'connect' || id === 'create') && mine()) { var f = $('birthForm'); if (f) f.hidden = true; }
    if (AQ.wizard) AQ.wizard.refresh();
  }
  /* =============================================================
     クリアしたクエストの「成果」（2026-10-18 指摘：クリアしても「クリアしました！」しか出ず、何が起きたか振り返れない）
     ★ 作り話をしない：このブラウザに残っている本当の記録（取引番号・サーバーが返した書き込み・
       貼れた仕事の番号）だけを出す。記録が無いものは出さない。
       リンクは、中身を確かめられる場所（Basescan の取引・ERC-8004 の身分証の一覧）だけ。
     ============================================================= */
  var SCAN = 'https://basescan.org';
  var ID8004 = 'https://erc-8004.quicknode.com/agents/base-mainnet/';
  function last(a) { return a && a.length ? a[a.length - 1] : null; }
  function isTx(x) { return /^0x[0-9a-fA-F]{64}$/.test(String(x || '')); }
  function shortTx(x) { x = String(x || ''); return x.slice(0, 10) + '…' + x.slice(-6); }
  function proofItems(id) {
    var d = mine(), out = [];
    function link(label, href) { out.push({ label: label, href: href }); }
    function said(label, text, foreign) { out.push({ label: label, text: String(text || '').slice(0, 140), foreign: !!foreign }); }
    if (!d && id !== 'connect') return out;
    switch (id) {
      case 'connect':
        if (d && d.owner) link(t('quest.proof.wallet', { addr: shortA(d.owner) }), SCAN + '/address/' + d.owner);
        break;
      case 'create':
        if (isTx(d.tx)) link(t('quest.proof.birthTx', { tx: shortTx(d.tx) }), SCAN + '/tx/' + d.tx);
        link(t('quest.proof.idCard', { id: d.agentId }), ID8004 + encodeURIComponent(d.agentId));
        break;
      case 'hello': {
        var p = last(posts().filter(function (x) { return x.room === 'lobby'; }));
        if (p) said(t('quest.proof.post', { seq: p.seq != null ? p.seq : '?' }), p.text);
        break;
      }
      case 'news': {
        var e = last(J('aq.myAgent.errands', []).filter(function (x) { return x && x.shop === 'news' && x.result; }));
        if (!e) {
          /* お店が止まっていて、自分で完了にしたとき：そう書く（買えたことにはしない） */
          var sk = J(FLAG + 'news.manual', null);
          if (sk) out.push({ label: t('quest.proof.skipped', { shop: sk.shop || '?' }) });
          break;
        }
        if (isTx(e.tx)) link(t('quest.proof.payTx', { price: e.price || '', tx: shortTx(e.tx) }), SCAN + '/tx/' + e.tx);
        else if (e.paid && d && d.owner) link(t('quest.proof.payOk', { price: e.price || '' }), SCAN + '/address/' + d.owner + '#tokentxns');
        /* 買ってきた見出しは、すぐ下の「買ってきたもの」に原文のまま出ているので、ここには重ねて出さない */
        break;
      }
      case 'job': {
        var j = last(J('aq.myAgent.jobs', []));
        if (j) said(t('quest.proof.job', { id: j.id }), j.title);
        if (j) link(t('quest.proof.kibble'), 'https://kibble.world');
        break;
      }
      case 'judge': {
        var at = last(posts().filter(function (x) { return x.room === 'kibble' && /^ATTEST v1 \|/.test(x.text || ''); }));
        if (!at) break;
        var f = String(at.text).split('|').map(function (x) { return x.trim(); });
        out.push({ label: t('quest.proof.attest', { id: f[1] || '?', verdict: t(f[2] === 'useful' ? 'quest.proof.useful' : 'quest.proof.not') }) });
        link(t('quest.proof.kibble'), 'https://kibble.world');
        break;
      }
      case 'card': {
        var c = J('aq.myAgent.card', null);
        if (c && isTx(c.tx)) link(t('quest.proof.cardTx', { tx: shortTx(c.tx) }), SCAN + '/tx/' + c.tx);
        link(t('quest.proof.idCard', { id: d.agentId }), ID8004 + encodeURIComponent(d.agentId));
        break;
      }
      case 'feedback': {
        var g = last(J('aq.myAgent.feedback', []));
        if (!g) break;
        if (isTx(g.tx)) link(t('quest.proof.fbTx', { id: g.agentId, tx: shortTx(g.tx) }), SCAN + '/tx/' + g.tx);
        if (g.agentId != null) link(t('quest.proof.fbAgent', { id: g.agentId }), ID8004 + encodeURIComponent(g.agentId));
        break;
      }
      case 'mail': {
        var m = last(acts('mail-send'));
        if (m && m.text) said(t('quest.proof.mail'), m.text);
        break;
      }
      case 'memo': {
        var mm = J('aq.myAgent.memo', null);
        if (mm && mm.line) said(t('quest.proof.memo'), mm.line);
        if (mm && /^https:\/\/technocore\.chat\/kv\//.test(mm.url || '')) link(t('quest.proof.memoNote'), mm.url);
        break;
      }
      case 'deal': {
        var dl = J('aq.myAgent.deal', null);
        if (dl && /^0x[0-9a-f]{64}$/.test(dl.contract || '')) {
          out.push({ label: t('quest.proof.deal', { id: dl.contract.slice(0, 10) + '…' }) });
          if (/^mb-p-tclk-[0-9a-f]{16}$/.test(dl.dealRoom || '')) link(t('quest.proof.dealRoom'), 'https://technocore.chat/r/' + dl.dealRoom);
        }
        break;
      }
      case 'builder':
        J('aq.quest.builderTxs', []).slice(0, 4).forEach(function (x) {
          if (isTx(x.tx)) link(t('quest.proof.builderTx', { kind: t('quest.b.kind.' + x.kind), tx: shortTx(x.tx) }), SCAN + '/tx/' + x.tx);
        });
        break;
    }
    return out;
  }
  function renderProof(id, done) {
    var box = $('questWinProof'); if (!box) return;
    var items = done ? proofItems(id) : [];
    box.hidden = !items.length;
    box.innerHTML = '';
    if (!items.length) return;
    box.appendChild(mk('b', 'quest-proof-head', t('quest.proof.head')));
    var ul = mk('ul', 'quest-proof-list'); box.appendChild(ul);
    items.forEach(function (x) {
      var li = mk('li');
      if (x.href && !x.text) {
        var a = mk('a', 'quest-proof-link', x.label + ' ↗'); a.href = x.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        li.appendChild(a);
      } else {
        li.appendChild(mk('span', 'quest-proof-label', x.label));
        if (x.text) {
          var q = x.href ? mk('a', 'quest-proof-said', x.text) : mk('q', 'quest-proof-said', x.text);
          if (x.href) { q.href = x.href; q.target = '_blank'; q.rel = 'noopener noreferrer'; }
          q.setAttribute(x.foreign ? 'data-foreign' : 'data-user', '');
          li.appendChild(q);
        }
      }
      ul.appendChild(li);
    });
  }
  /** 次に挑めるクエスト（このクエストより後ろで、まだ済んでおらず、選べるもの。無ければ前から探す） */
  function nextOpen(id) {
    var i = QUESTS.map(function (q) { return q.id; }).indexOf(id);
    var order = QUESTS.slice(i + 1).concat(QUESTS.slice(0, i));
    return order.filter(function (q) { return !q.done() && !locked(q); })[0] || null;
  }
  function closeWin() {
    var box = $('questWin'); if (!box || !win.id) return;
    var w = WIN[win.id];
    restoreNodes();
    if (w && w.panel && $(w.panel)) $(w.panel).hidden = true;
    if (win.id === 'judge' && $('robotJobs')) $('robotJobs').hidden = true;
    var was = win.id;
    winGen++;
    box.hidden = true; win.id = null; selected = null;
    box.removeAttribute('data-q');
    render();
    var back = document.querySelector('#questList .quest[data-q="' + was + '"]');   // クエスト帳の、いま閉じたクエストへ戻る
    if (back && back.focus && $('birthScreen') && !$('birthScreen').hidden) back.focus();
  }
  function bindWin() {
    var box = $('questWin'); if (!box) return;
    $('questWinClose').addEventListener('click', closeWin);
    $('questWinBack').addEventListener('click', closeWin);
    $('questWinNext').addEventListener('click', function () { var nx = nextOpen(win.id); if (nx) openWin(nx.id); });
    /* Esc は窓だけを閉じる（フォーカスがどこにあっても。自分のエージェントの画面は閉じない） */
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && win.id && !box.hidden) { ev.stopPropagation(); ev.preventDefault(); closeWin(); } }, true);
    /* 街で見るなどで「自分のエージェント」の画面ごと閉じたら、移したものを元へ戻しておく */
    /* 窓の中で、状態の文や財布を選ぶボタンが変わったら、そこが見えるところまで動かして光らせる
       （下の方に出た「ウォレットを選んで」などに気づかず、押しても反応しないように見えないように） */
    if (window.MutationObserver) ['robotStatus', 'birthStatus', 'birthWallets'].forEach(function (id) {
      var el = $(id); if (!el) return;
      new MutationObserver(function () {
        if (!win.id || box.hidden || !box.contains(el) || el.hidden || !el.textContent.trim()) return;
        clearTimeout(el._qwTm);
        el._qwTm = setTimeout(function () {
          /* 状態の文と財布のボタンはひとまとまり。いちばん下のものまで見えるように動かす */
          var tail = ['robotStatus', 'birthStatus', 'birthWallets'].map($).filter(function (x) { return x && box.contains(x) && !x.hidden && x.offsetParent !== null && x.textContent.trim(); });
          var last = tail[tail.length - 1] || el;
          if (last.scrollIntoView) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          el.classList.remove('quest-flash'); void el.offsetWidth; el.classList.add('quest-flash');
        }, 60);
      }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    });
    var scr = $('birthScreen');
    if (scr && window.MutationObserver) new MutationObserver(function () {
      if (scr.hidden && win.id) closeWin();
      if (!scr.hidden) hideReturn();                 // 自分のエージェントの画面に戻ったら、戻る札はしまう
    }).observe(scr, { attributes: true, attributeFilter: ['hidden'] });
    if ($('questReturnGo')) $('questReturnGo').addEventListener('click', goReturn);
    if ($('questReturnX')) $('questReturnX').addEventListener('click', hideReturn);
  }

  /* =============================================================
     部屋・街で見に行ったあと、クエストへ戻る道（2026-10-17 利用者の要望：帰りかたが分からない）
     見に行くときに開いていたクエストを覚えておき、画面の上に「◀ クエストにもどる」を出す。
     ============================================================= */
  var returnTo = { on: false, id: null };
  function markReturn() {
    returnTo.on = true; returnTo.id = win.id || null;
    showReturn();
  }
  function showReturn() {
    var box = $('questReturn'), go = $('questReturnGo'); if (!box || !go) return;
    box.hidden = !returnTo.on;
    if (!returnTo.on) return;
    go.textContent = '◀ ' + (returnTo.id ? t('quest.return.to', { name: t('quest.' + returnTo.id + '.title') }) : t('quest.return.book'));
    if ($('questReturnX')) { $('questReturnX').setAttribute('aria-label', t('quest.win.close')); $('questReturnX').title = t('quest.win.close'); }
  }
  function hideReturn() { returnTo.on = false; var box = $('questReturn'); if (box) box.hidden = true; }
  function goReturn() {
    var id = returnTo.id;
    hideReturn();
    if (AQ.birth && AQ.birth.open) AQ.birth.open();
    if (id) setTimeout(function () { openWin(id); }, 30);
  }

  /* =============================================================
     修了証（2026-10-18 利用者の提案：クエストを終えたら、別の窓で分かりやすく終了の証を）
     ・全部そろった瞬間に自動で開く。あとからはクエスト帳の「🎓 修了証を見る」で開ける
     ・書くのは、このブラウザに残っている本当の記録だけ（エージェントの番号と名前・持ち主・
       Builder Code の印を確かめた取引）。日付は「この修了証を発行した日」（初めて開いた日）
     ・「画像で保存」は、この窓と同じ中身を絵（PNG）にして、利用者のパソコンに保存する
     ============================================================= */
  var CERT_AT = 'aq.quest.certAt';
  function certDate() {
    var v = null; try { v = localStorage.getItem(CERT_AT); } catch (e) {}
    if (!v) { v = new Date().toISOString(); try { localStorage.setItem(CERT_AT, v); } catch (e) {} }
    return new Date(v);
  }
  function fmtDate(d) { return d.toLocaleDateString(AQ.i18n.lang === 'en' ? 'en-US' : 'ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }); }
  function shortA(a) { a = String(a || ''); return a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a; }
  function openCert() {
    var box = $('certWin'), d = mine(); if (!box || !d || count() !== QUESTS.length) return;
    var when = certDate();
    $('certKicker').textContent = 'AGENT QUEST';
    $('certTitle').textContent = t('quest.cert.title');
    $('certName').textContent = t('quest.cert.name', { id: d.agentId, name: d.name });
    $('certBody').textContent = t('quest.cert.body', { total: QUESTS.length });
    var ul = $('certQuests'); ul.innerHTML = '';
    QUESTS.forEach(function (q) { ul.appendChild(mk('li', null, '✓ ' + q.icon + ' ' + t('quest.' + q.id + '.title'))); });
    var pr = $('certProof'); pr.innerHTML = '';
    var txs = J('aq.quest.builderTxs', []);
    pr.appendChild(mk('b', null, proofText(txs)));
    txs.slice(0, 4).forEach(function (x) {
      var a = mk('a', 'errand-link', t('quest.b.kind.' + x.kind) + ' ' + String(x.tx).slice(0, 10) + '…'); a.href = 'https://basescan.org/tx/' + x.tx; a.target = '_blank'; a.rel = 'noopener';
      pr.appendChild(a);
    });
    var ex = mk('a', 'errand-link', t('quest.cert.idLink')); ex.href = 'https://erc-8004.quicknode.com/agents/base-mainnet/' + encodeURIComponent(d.agentId); ex.target = '_blank'; ex.rel = 'noopener';
    pr.appendChild(ex);
    $('certMeta').textContent = t('quest.cert.meta', { date: fmtDate(when), owner: shortA(d.owner) });
    $('certSave').textContent = '🖼 ' + t('quest.cert.save');
    $('certClose').textContent = t('quest.win.close');
    box.hidden = false;
    var cf = box.querySelector('.cert-confetti');
    if (cf) { cf.classList.remove('go'); void cf.offsetWidth; cf.classList.add('go'); }
    setTimeout(function () { var b = $('certSave'); if (b) b.focus(); }, 30);
  }
  /** 確かめた取引の件数は、このブラウザに控えがあるときだけ書く（無ければ件数を書かない＝作らない） */
  function proofText(txs) {
    var code = (AQ.config && AQ.config.builderCode) || '';
    return txs.length ? t('quest.cert.proof', { code: code, n: txs.length }) : t('quest.cert.proofNoCount', { code: code });
  }
  function closeCert() { var b = $('certWin'); if (b) b.hidden = true; }
  /** 修了証を絵（PNG）にする。窓に出している文字と同じものを、キャンバスに描く */
  function certPng() {
    var d = mine(); if (!d) return null;
    var W = 1200, H = 850, c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'); if (!g) return null;
    /* 英数字は l と 1・I と T の区別がはっきりした IBM Plex Mono（ページで読み込み済み）、日本語はパソコンの字 */
    var font = '"IBM Plex Mono","Hiragino Sans","Yu Gothic","Meiryo",system-ui,sans-serif';
    var grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#1b2a48'); grd.addColorStop(1, '#0d1525');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#ffd36b'; g.lineWidth = 10; g.strokeRect(24, 24, W - 48, H - 48);
    g.strokeStyle = 'rgba(255,211,107,.45)'; g.lineWidth = 2; g.strokeRect(44, 44, W - 88, H - 88);
    g.textAlign = 'center'; g.fillStyle = '#9fb0c8'; g.font = '600 22px ' + font; g.fillText('AGENT QUEST', W / 2, 105);
    g.fillStyle = '#ffd36b'; g.font = '600 64px ' + font; g.fillText(t('quest.cert.title'), W / 2, 185);
    g.fillStyle = '#f1f5fb'; g.font = '600 38px ' + font; g.fillText(t('quest.cert.name', { id: d.agentId, name: d.name }), W / 2, 255);
    g.fillStyle = '#cfd9ea'; g.font = '400 22px ' + font;
    wrap(g, t('quest.cert.body', { total: QUESTS.length }), W / 2, 305, W - 220, 32);
    g.textAlign = 'left'; g.font = '500 21px ' + font; g.fillStyle = '#b8f5cf';
    QUESTS.forEach(function (q, i) {
      var col = i % 2, row = Math.floor(i / 2);
      g.fillText('✓ ' + t('quest.' + q.id + '.title'), 150 + col * 470, 425 + row * 38);
    });
    var txs = J('aq.quest.builderTxs', []);
    g.textAlign = 'center'; g.fillStyle = '#ffd36b'; g.font = '600 22px ' + font;
    g.fillText(proofText(txs), W / 2, 690);
    g.fillStyle = '#9fb0c8'; g.font = '400 19px ' + font;
    if (txs[0]) g.fillText('Basescan: ' + String(txs[0].tx).slice(0, 18) + '…', W / 2, 722);
    g.fillText(t('quest.cert.meta', { date: fmtDate(certDate()), owner: shortA(d.owner) }), W / 2, 778);
    g.font = '64px ' + font; g.fillText('🎓', W - 140, 160);
    return c;
  }
  function wrap(g, text, x, y, maxW, lh) {
    var line = '', chars = Array.from(String(text));
    chars.forEach(function (ch) {
      if (g.measureText(line + ch).width > maxW && line) { g.fillText(line, x, y); y += lh; line = ch; } else line += ch;
    });
    if (line) g.fillText(line, x, y);
  }
  function saveCert() {
    var ready = (document.fonts && document.fonts.load) ? Promise.all([document.fonts.load('400 22px "IBM Plex Mono"'), document.fonts.load('600 22px "IBM Plex Mono"')]).catch(function () {}) : Promise.resolve();
    ready.then(saveCertNow);
  }
  function saveCertNow() {
    var c = certPng(); if (!c) return;
    var d = mine();
    c.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'agent-quest-certificate-' + (d ? d.agentId : '') + '.png';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }, 'image/png');
  }
  function bindCert() {
    if ($('certClose')) $('certClose').addEventListener('click', closeCert);
    if ($('certSave')) $('certSave').addEventListener('click', saveCert);
    if ($('questCertBtn')) $('questCertBtn').addEventListener('click', openCert);
    document.addEventListener('keydown', function (ev) { var b = $('certWin'); if (ev.key === 'Escape' && b && !b.hidden) { ev.stopPropagation(); ev.preventDefault(); closeCert(); } }, true);
  }

  /* =============================================================
     はじめの画面のクエスト（2026-10-18：アプリ名 Agent Quest。クエストを一番上に）
     11 の印（済んだものは光る）・進みぐあい・ボタン1つ（始める／続きから／修了証）
     ============================================================= */
  function nextQuest() { return QUESTS.filter(function (q) { return !q.done() && !locked(q); })[0] || null; }
  function renderStart() {
    if (!$('startQuest')) return;
    var n = count(), total = QUESTS.length, d = mine(), nx = nextQuest();
    $('startTagline').textContent = t('start.tagline');
    /* ★ 2026-11-02 安全についてのページへのリンク（はじめの画面とページの下） */
    if ($('startSafety')) $('startSafety').textContent = t('start.safety');
    if ($('footSafety')) $('footSafety').textContent = t('foot.safety');
    if ($('footGithub')) $('footGithub').textContent = t('foot.github');
    $('startQuestTitle').textContent = t('start.questTitle');
    var ag = $('startQuestAgent');
    ag.hidden = !d; ag.textContent = d ? t('start.agent', { id: d.agentId, name: d.name }) : '';
    if (!d) { ag.hidden = false; ag.className = 'start-quest-agent lead'; ag.textContent = t('start.questLead'); } else ag.className = 'start-quest-agent';
    var ol = $('startQuestDots'); ol.innerHTML = '';
    QUESTS.forEach(function (q) {
      var li = mk('li', q.done() ? 'done' : (nx && nx.id === q.id ? 'next' : ''), q.icon);
      li.title = t('quest.' + q.id + '.title');
      ol.appendChild(li);
    });
    $('startQuestCount').textContent = t('start.count', { n: n, total: total });
    var T = $('startQuestGoT'), S = $('startQuestGoS');
    if (n === total) { T.textContent = t('start.goDone'); S.textContent = t('start.goDoneS', { total: total }); }
    else if (n === 0 || !nx) { T.textContent = t('start.goNew'); S.textContent = t('start.goNewS'); }
    else { T.textContent = t('start.goNext'); S.textContent = t('start.goNextS', { name: t('quest.' + nx.id + '.title') }); }
    $('startQuestGo').classList.toggle('done', n === total);
    if ($('startOtherKicker')) $('startOtherKicker').textContent = t('start.otherT');
  }
  function startGo() {
    var n = count();
    if (AQ.birth && AQ.birth.open) AQ.birth.open();
    if (n === QUESTS.length) { setTimeout(openCert, 60); return; }
    var nx = nextQuest();
    if (nx) setTimeout(function () { openWin(nx.id); }, 60);
  }

  /* ---- 画面 ---- */
  var selected = null;
  var lastSig = '';
  function sig() { return QUESTS.map(function (q) { var d = q.done(); return d ? 'd' : (locked(q) ? 'l' : 'o'); }).join('') + '|' + AQ.i18n.lang; }
  function render() {
    var list = $('questList'); if (!list) return;
    lastSig = sig();
    list.innerHTML = '';
    var n = 0, nx = nextQuest();
    QUESTS.forEach(function (q, i) {
      var done = q.done(), lock = !done && locked(q), isNext = !!nx && nx.id === q.id;
      if (done) n++;
      var b = mk('button', 'quest' + (done ? ' done' : '') + (lock ? ' locked' : '') + (isNext ? ' next' : '') + (selected === q.id ? ' on' : '')); b.type = 'button';
      b.setAttribute('data-q', q.id);
      b.appendChild(mk('span', 'quest-mark', done ? '✓' : (lock ? '🔒' : String(i + 1))));
      var mid = mk('span', 'quest-main');
      mid.appendChild(mk('b', null, q.icon + ' ' + t('quest.' + q.id + '.title')));
      mid.appendChild(mk('small', null, t('quest.cost.' + q.cost)));
      b.appendChild(mid);
      if (isNext) b.appendChild(mk('span', 'quest-badge', t('quest.next.badge')));
      b.disabled = lock;
      b.addEventListener('click', function () { openWin(q.id); });
      list.appendChild(b);
    });
    renderNext(nx, n);
    var bn = $('birthNextQuest'), hq = QUESTS.filter(function (x) { return x.id === 'hello'; })[0];
    if (bn) {
      var showB = !!mine() && hq && !hq.done() && !locked(hq);
      bn.hidden = !showB;
      if (showB) { $('birthNextQuestT').textContent = t('quest.cta.hello'); $('birthNextQuestS').textContent = t('quest.cta.helloS'); }
    }
    if ($('questCount')) $('questCount').textContent = t('quest.count', { n: n, total: QUESTS.length });
    if ($('questBar')) $('questBar').style.width = Math.round(n / QUESTS.length * 100) + '%';
    if ($('questTitle')) $('questTitle').textContent = t('quest.title');
    if ($('questDetail')) $('questDetail').hidden = true;     // 説明はクエストの窓に出す
    renderReset(n);
    showReturn();
    renderStart();
    fillWin();
    celebrate(n);
    return n;
  }
  /* つぎのクエスト（2026-10-18）：3〜11 は順番自由。でも「次に何をすればいいか」は、いつも一番上に1つ出す */
  function renderNext(nx, n) {
    var b = $('questNextBtn'); if (!b) return;
    b.hidden = !nx;
    if (!nx) return;
    b.setAttribute('data-q', nx.id);
    $('questNextK').textContent = t('quest.next.k');
    $('questNextT').textContent = nx.icon + ' ' + t('quest.' + nx.id + '.title');
    /* ★ 2026-10-19 生まれた直後は「どの順番でも」ではなく、まず あいさつ へ（利用者「ここだけ次に進むべき方向が不明瞭」）。
       「順番自由」の一言は、あいさつが済んでから */
    var first = nx.id === 'hello' && n === 2, free = n >= 3;
    $('questNextS').hidden = !(first || free);
    $('questNextS').textContent = first ? t('quest.next.firstHello') : (free ? t('quest.next.free') : '');
    $('questNextGo').textContent = t('quest.next.go');
  }
  function select(id) { selected = selected === id ? null : id; say(null); render(); }
  /* 最初からやり直す（2026-10-17）。消すものがあるときだけ出す */
  function renderReset(n) {
    var box = $('questReset'); if (!box || !AQ.birth || !AQ.birth.resetButton) return;
    var has = n > 0 || !!mine();
    box.hidden = !has;
    if (!has) return;
    if (box.getAttribute('data-lang') === AQ.i18n.lang && box.firstChild) return;   // 押しかけ（確認待ち）の状態を描き直しで消さない
    box.setAttribute('data-lang', AQ.i18n.lang);
    box.innerHTML = '';
    box.appendChild(AQ.birth.resetButton(t('birth.reset.label')));
    box.appendChild(mk('small', null, t('quest.reset.note')));
  }
  var shownN = null;
  function celebrate(n) {
    var seen = Number((function () { try { return localStorage.getItem(SEEN); } catch (e) { return '0'; } })()) || 0;
    if (shownN === null) {                       // 開いた直後は祝わない（前から済んでいた分を、いま達成したように見せない）
      shownN = n; if (n > seen) { try { localStorage.setItem(SEEN, String(n)); } catch (e) {} }
    }
    if (n > seen) {
      try { localStorage.setItem(SEEN, String(n)); } catch (e) {}
      var just = QUESTS.filter(function (q) { return q.done(); }).slice(-1)[0];
      var el = $('questToast');
      if (el && shownN !== null && n > shownN) {
        el.textContent = n === QUESTS.length ? t('quest.allDone') : t('quest.cleared', { name: just ? t('quest.' + just.id + '.title') : '' , n: n, total: QUESTS.length });
        el.className = 'quest-toast show' + (n === QUESTS.length ? ' all' : '');
        clearTimeout(celebrate.tm);
        celebrate.tm = setTimeout(function () { el.className = 'quest-toast'; }, n === QUESTS.length ? 8000 : 3500);
        /* 全部そろったら、修了証の窓を開く。★ 2026-10-21 利用者「間髪入れずに出るので、少し遅らせても」：
           最後のクエストの結果と「全クエスト達成」の知らせを見てもらってから（約 3.5 秒後） */
        if (n === QUESTS.length) setTimeout(openCert, 3500);
      }
    }
    shownN = n;
    if ($('questDone')) { $('questDone').hidden = n !== QUESTS.length; $('questDone').textContent = t('quest.doneMsg'); }
    if ($('questCertBtn')) { $('questCertBtn').hidden = n !== QUESTS.length; $('questCertBtn').textContent = '🎓 ' + t('quest.cert.open'); }
  }
  function count() { return QUESTS.filter(function (q) { return q.done(); }).length; }
  var tm = null;
  function refresh() { if (tm) return; tm = setTimeout(function () { tm = null; render(); if (AQ.birth && AQ.birth.relabelDoor) AQ.birth.relabelDoor(); }, 50); }

  function init() {
    if (!$('questList')) return;
    bindWin();
    bindCert();
    if ($('startQuestGo')) $('startQuestGo').addEventListener('click', startGo);
    ['questWinCta', 'birthNextQuest'].forEach(function (cid) { if ($(cid)) $(cid).addEventListener('click', function () { openWin('hello'); }); });
    if ($('questNextBtn')) $('questNextBtn').addEventListener('click', function () { var id = this.getAttribute('data-q'); if (id) openWin(id); });
    if (AQ.activity) { var prev = AQ.activity.onChange; AQ.activity.onChange = function () { if (prev) prev(); refresh(); }; }
    window.addEventListener('storage', refresh);
    render();
    setInterval(function () {                    // 待ちのあるクエスト（判定など）を拾う。変化が無ければ描き直さない（フォーカスを奪わない）
      if (!$('birthScreen') || $('birthScreen').hidden) return;
      if (sig() !== lastSig) render();
    }, 3000);   // 待ちのあるクエスト（判定など）を拾う
  }

  AQ.quest = { init: init, render: render, refresh: refresh, setFlag: setFlag, count: count, total: QUESTS.length,
               select: select, open: openWin, close: closeWin, markReturn: markReturn, offerSkip: offerSkip, openCert: openCert, _certPng: certPng, renderStart: renderStart, _hasCode: hasCode, QUESTS: QUESTS };
})(window.AQ = window.AQ || {});
