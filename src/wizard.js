/* =============================================================
   wizard.js — クエストの窓を「1画面に1ステップ」にする（2026-10-19）
   -------------------------------------------------------------
   利用者の要望：「さくさく進むのがいい。次に何をやるのかが明確で、ユーザーが迷わない方向」
   決めたこと（利用者と相談して）:
     ・窓は増やさない。同じクエストの窓の中で、ステップごとに中身を入れ替える
     ・上に「① ― ② ― ③」と大きな見出し。下には、そのステップで選ぶものだけ
     ・1つだけ選ぶもの（相手・★・紹介文など）は、押したら自動で次へ。
       いくつでも選べるもの・自分で書くものは「次へ ▶」
     ・はじめから「おすすめ」が選んであるので、「次へ」だけで最後まで行ける
     ・前のステップで選んだものは小さな札で残す（押すとそのステップへ戻る）
     ・長い説明（💡と✔）は最初のステップだけ。2画面目からは見出し1行
     ・ボタン1つで終わるクエスト（あいさつ・Builder Code など）は今のまま
   しくみ:
     パネルの部品（ボタンや一覧）はそのまま使い、いまのステップに無い部品に .wz-off を
     付けて隠すだけ。部品の働き（errand.js・reputation.js など）には手を入れない。
     状態の文（robotStatus）とウォレットを選ぶボタンは、どのステップでも見える。
     郵便受けと判定は「やったこと」で段階が決まるので、状態を見て自動で先へ進む。
   ============================================================= */
(function (AQ) {
  'use strict';

  function t(k, v) { return AQ.i18n.t(k, v); }
  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function txt(sel) { var e = document.querySelector(sel); return e ? e.textContent.trim() : ''; }
  function vis(id) { var e = $(id); return !!e && !e.hidden && e.textContent.trim() !== ''; }
  function val(id) { var e = $(id); return e ? String(e.value || '').trim() : ''; }
  function onKey(sel) { var e = document.querySelector(sel); return e ? e.getAttribute('data-key') : null; }
  /* 見出しの文は、パネル用に「ステップ 1/3 …」が付いているものがあるので、その頭を外して使う */
  function title(k) { return t(k).replace(/^(?:✓\s*)?(?:ステップ|step)\s*\d+\s*\/\s*\d+[:：]?\s*/i, ''); }
  function stars() { return document.querySelectorAll('#fbStars button.on').length; }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  var FLOWS = {
    /* 前に買ったものが出ているときは、ステップ 2（買ってきたもの＋もう一度買うボタン）から */
    news: { state: function () { return vis('errandResult') ? 1 : 0; }, finished: function () { return vis('errandResult'); }, steps: [
      { k: 'errand.step1', show: ['errandChoices', 'errandFreeBox'],
        auto: [{ within: 'errandChoices', sel: '.robot-choice', unless: function (b) { return b.getAttribute('data-key') === 'free'; } }],
        ready: function () { return onKey('#errandChoices .robot-choice.on') !== 'free' || !!val('errandFree'); },
        chip: function () { return onKey('#errandChoices .robot-choice.on') === 'free' ? { v: val('errandFree'), user: true } : { v: txt('#errandChoices .robot-choice.on b') }; } },
      { k: 'errand.step2', show: ['errandGo', 'errandNote', 'errandResult'] }
    ] },
    job: { steps: [
      { k: 'robot.pickLbl', show: ['robotChoices', 'robotFree'],
        auto: [{ within: 'robotChoices', sel: '.robot-choice', unless: function (b) { return b.getAttribute('data-key') === 'free'; } }],
        ready: function () { return onKey('#robotChoices .robot-choice.on') !== 'free' || !!val('robotJobTitle'); },
        chip: function () { return onKey('#robotChoices .robot-choice.on') === 'free' ? { v: val('robotJobTitle'), user: true } : { v: txt('#robotChoices .robot-choice.on b') }; } },
      { k: 'robot.jobStep2', show: ['robotJobGo'] }
    ] },
    card: { finished: function () { return vis('cardDone'); }, steps: [
      { k: 'card.skillsLbl', show: ['cardSkills'],
        chip: function () { var a = [].map.call(document.querySelectorAll('#cardSkills .on'), function (b) { return b.textContent.trim(); }); return { v: a.length ? a.join('・') : t('wz.none') }; } },
      { k: 'card.introLbl', show: ['cardIntros'],
        auto: [{ within: 'cardIntros', sel: '.robot-choice' }],
        chip: function () { return { v: txt('#cardIntros .robot-choice.on b') }; } },
      { k: 'card.step3', show: ['cardDidRow', 'cardVisualLbl', 'cardVisual', 'cardPreviewBox', 'cardGo', 'cardNote', 'cardDone'] }
    ] },
    feedback: { finished: function () { return vis('fbDone'); }, steps: [
      { k: 'fb.pickLbl', show: ['fbMine', 'fbList', 'fbMore', 'fbByIdBox'],
        auto: [{ within: 'fbList', sel: '.fb-agent, .robot-chip' }, { within: 'fbByIdBox', sel: '#fbIdGo', wait: true }],
        ready: function () { return vis('fbPicked'); },
        sig: function () { return txt('#fbPicked .fb-name'); },
        chip: function () { return { v: txt('#fbPicked .fb-name'), foreign: true }; } },
      { k: 'fb.starsLbl', show: ['fbPicked', 'fbStarsRow'],
        auto: [{ within: 'fbStars', sel: 'button' }],
        chip: function () { var n = stars(); return { v: '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n) }; } },
      { k: 'fb.step3', show: ['fbGo', 'fbNote', 'fbDone'] }
    ] },
    /* ★ 2026-10-26 記憶：覚えさせることを選ぶ → 覚えさせる（読み直した記憶が出たら ✓） */
    memo: { finished: function () { return vis('memoResult'); }, steps: [
      { k: 'memo.step1', show: ['memoLead', 'memoChoices'],
        auto: [{ within: 'memoChoices', sel: '.robot-choice' }],
        chip: function () { return { v: txt('#memoChoices .robot-choice.on b') }; } },
      { k: 'memo.step2', show: ['memoGo', 'memoNote', 'memoResult', 'memoRecall'] }
    ] },
    /* 郵便受け：開く → 試しの手紙 → 届いた（やったことで先へ進む） */
    mail: {
      finished: function () { return !!document.querySelector('#mailLetters .mail-letter'); },
      state: function () { var ob = $('mailOpenBtn'); if (!ob || !ob.hidden) return 0; return document.querySelector('#mailLetters .mail-letter') ? 2 : 1; },
      steps: [
        { k: 'mail.step1', show: ['mailLead', 'mailState', 'mailOpenBtn'],
          ready: function () { var ob = $('mailOpenBtn'); return !!ob && ob.hidden; },
          chip: function () { return { v: t('wz.chip.boxOpen') }; } },
        { k: 'mail.step2', show: ['mailSend'],
          ready: function () { return !!document.querySelector('#mailLetters .mail-letter'); },
          chip: function () { return { v: t('wz.chip.sent') }; } },
        { k: function () { return document.querySelector('#mailLetters .mail-letter') ? 'mail.step3' : 'mail.step3wait'; }, show: ['mailLetters', 'mailUsual', 'mailNoteBox'] }
      ] },
    /* 判定：読む → 判定する。進む・戻るは仕事のカードのボタンで（ここは見出しだけ） */
    judge: {
      nav: false,
      /* 判定した仕事が一番上に出ているときも ②（判定する）が済んだところ */
      state: function () { return document.querySelector('#robotJobsList .robot-judge') || document.querySelector('#robotJobsList > .robot-job .robot-job-mine') ? 1 : 0; },
      finished: function () { return !document.querySelector('#robotJobsList .robot-judge') && !!document.querySelector('#robotJobsList > .robot-job .robot-job-mine'); },
      steps: [{ k: 'robot.step.read', show: ['questSay', 'robotJobsTitle'] }, { k: 'robot.step.judge', show: [] }]
    }
  };

  var cur = { id: null, flow: null, i: 0, state: 0, mo: null, tm: null };

  function allIds(flow) { var a = []; flow.steps.forEach(function (s) { (s.show || []).forEach(function (id) { if (a.indexOf(id) < 0) a.push(id); }); }); return a; }
  function step() { return cur.flow ? cur.flow.steps[cur.i] : null; }
  function ready(s) { try { return !s.ready || !!s.ready(); } catch (e) { return true; } }

  function start(id, panelId, isDone) {
    stop();
    var flow = FLOWS[id], box = $('questWin');
    if (!flow || !box) return;
    cur.id = id; cur.flow = flow; cur.isDone = isDone || null;
    cur.state = flow.state ? flow.state() : 0;
    cur.i = Math.min(cur.state, flow.steps.length - 1);
    box.classList.add('wz');
    var nav = $('wzNav'), slot = $('questWinSlot'), p = panelId && $(panelId);
    if (nav && slot && flow.nav !== false) {
      if (p && p.parentNode === slot) slot.insertBefore(nav, p.nextSibling); else slot.appendChild(nav);
      nav.hidden = false;
    }
    if (slot && window.MutationObserver) {
      cur.mo = new MutationObserver(function () { clearTimeout(cur.tm); cur.tm = setTimeout(update, 60); });
      cur.mo.observe(slot, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'disabled'] });
    }
    show(false);
  }
  function stop() {
    if (cur.mo) { cur.mo.disconnect(); cur.mo = null; }
    clearTimeout(cur.tm);
    if (cur.flow) allIds(cur.flow).forEach(function (id) { var e = $(id); if (e) e.classList.remove('wz-off'); });
    var box = $('questWin'); if (box) box.classList.remove('wz', 'wz-later');
    var head = $('wzHead'); if (head) { head.hidden = true; head.innerHTML = ''; }
    var nav = $('wzNav'), home = $('wzHome'); if (nav) { nav.hidden = true; if (home) home.appendChild(nav); }
    cur.id = null; cur.flow = null; cur.i = 0; cur.state = 0;
  }

  /** n 番目のステップへ（0 から） */
  function go(n, anim) {
    if (!cur.flow) return;
    n = Math.max(0, Math.min(cur.flow.steps.length - 1, n));
    if (n === cur.i && anim !== false) { show(false); return; }
    var fwd = n > cur.i;
    cur.i = n;
    show(anim === false ? false : (fwd ? 'fwd' : 'back'));
    var body = $('questWinBody'); if (body) body.scrollTop = 0;
  }
  function next() { var s = step(); if (s && ready(s)) go(cur.i + 1); }
  function back() { go(cur.i - 1); }

  function show(anim) {
    var flow = cur.flow, s = step(); if (!flow || !s) return;
    var box = $('questWin');
    allIds(flow).forEach(function (id) { var e = $(id); if (e) e.classList.toggle('wz-off', (s.show || []).indexOf(id) < 0); });
    if (box) box.classList.toggle('wz-later', cur.i > 0);
    renderHead();
    renderNav();
    if (anim) {
      var slot = $('questWinSlot'), head = $('wzHead');
      [slot, head].forEach(function (el) { if (!el) return; el.classList.remove('wz-in-fwd', 'wz-in-back'); void el.offsetWidth; el.classList.add(anim === 'fwd' ? 'wz-in-fwd' : 'wz-in-back'); });
    }
  }

  function renderHead() {
    var head = $('wzHead'), flow = cur.flow; if (!head || !flow) return;
    head.hidden = false; head.innerHTML = '';
    var n = flow.steps.length;
    var dots = mk('ol', 'wz-dots'), fin = finished();
    head.classList.toggle('fin', fin);
    flow.steps.forEach(function (s, i) {
      var ok = i < cur.i || (fin && i === cur.i);           // 最後のステップまで済んでいれば、そこにも ✓
      var li = mk('li', ok ? 'done' : (i === cur.i ? 'now' : ''));
      var reach = i < cur.i && flow.nav !== false;
      var b = mk(reach ? 'button' : 'span', 'wz-dot', ok ? '✓' : String(i + 1));
      if (reach) { b.type = 'button'; b.title = title(typeof s.k === 'function' ? s.k() : s.k); b.addEventListener('click', function () { go(i); }); }
      li.appendChild(b);
      dots.appendChild(li);
    });
    head.appendChild(dots);
    var tx = mk('div', 'wz-text');
    tx.appendChild(mk('small', 'wz-count', t('wz.step', { n: cur.i + 1, m: n }) + (fin ? ' · ✓ ' + t('wz.allDone') : '')));
    var s = step();
    tx.appendChild(mk('b', 'wz-title', title(typeof s.k === 'function' ? s.k() : s.k)));
    head.appendChild(tx);
    /* 前のステップで選んだもの（押すとそのステップへ戻る） */
    var chips = mk('div', 'wz-chips');
    for (var i = 0; i < cur.i; i++) (function (i) {
      var st = flow.steps[i]; if (!st.chip) return;
      var c; try { c = st.chip(); } catch (e) { c = null; }
      if (!c || !c.v) return;
      var el = mk(flow.nav === false ? 'span' : 'button', 'wz-chip');
      if (flow.nav !== false) { el.type = 'button'; el.title = t('wz.edit'); el.addEventListener('click', function () { go(i); }); }
      el.appendChild(mk('span', 'wz-chip-n', String(i + 1)));
      var v = mk('span', 'wz-chip-v', short(c.v, 40));
      if (c.user) v.setAttribute('data-user', ''); if (c.foreign) v.setAttribute('data-foreign', '');
      el.appendChild(v);
      if (flow.nav !== false) el.appendChild(mk('span', 'wz-chip-e', '✎'));
      chips.appendChild(el);
    })(i);
    if (chips.firstChild) head.appendChild(chips);
  }

  function renderNav() {
    var nav = $('wzNav'), flow = cur.flow; if (!nav || !flow || flow.nav === false) return;
    var bk = $('wzBack'), nx = $('wzNext'), s = step(), last = cur.i === flow.steps.length - 1;
    bk.textContent = '◀ ' + t('wz.back'); bk.hidden = cur.i === 0;
    nx.textContent = t('wz.next') + ' ▶'; nx.hidden = last || !ready(s); nx.disabled = false;   // まだ選んでいないときは「次へ」を出さない（押せないボタンで迷わせない）
    nav.classList.toggle('solo', bk.hidden || nx.hidden);
    nav.hidden = bk.hidden && nx.hidden;
  }

  /* 中身が変わったとき：「次へ」を押せるか、状態で先へ進むか */
  /* 最後のステップにいて、クエストがクリア済みで、このステップでやることも済んでいる（記録が画面に出ている）とき */
  function finished() {
    var flow = cur.flow; if (!flow || cur.i !== flow.steps.length - 1) return false;
    var done = false; try { done = !!(cur.isDone && cur.isDone()); } catch (e) {}
    if (!done) return false;
    try { return flow.finished ? !!flow.finished() : true; } catch (e) { return false; }
  }
  function update() {
    var flow = cur.flow; if (!flow) return;
    var head = $('wzHead'); if (head && head.classList.contains('fin') !== finished()) renderHead();
    if (flow.state) {
      var st = flow.state();
      if (st !== cur.state) {
        var was = cur.state; cur.state = st;
        if (st > was || flow.nav === false) { go(Math.min(st, flow.steps.length - 1)); return; }
      }
    }
    renderNav();
  }

  /* 1つだけ選ぶものは、押したら自動で次へ */
  function onClick(ev) {
    var s = step(); if (!s || !s.auto || !cur.flow) return;
    var path = ev.composedPath ? ev.composedPath() : [];
    var hit = null;
    s.auto.some(function (a) {
      var inside = path.some(function (n) { return n && n.id === a.within; });
      if (!inside) return false;
      var b = null;
      path.some(function (n) { if (n && n.nodeType === 1 && n.matches && n.matches(a.sel)) { b = n; return true; } return n && n.id === a.within; });
      if (!b || (a.unless && a.unless(b))) return false;
      hit = a; return true;
    });
    if (!hit) return;
    var at = cur.i, id = cur.id, before = s.sig ? s.sig() : null, t0 = Date.now();
    (function wait() {
      if (cur.id !== id || cur.i !== at) return;          // そのあいだに自分で動いた
      var okSig = !hit.wait || !s.sig || s.sig() !== before;
      if (ready(s) && okSig) { setTimeout(function () { if (cur.id === id && cur.i === at) go(at + 1); }, 260); return; }
      if (Date.now() - t0 < (hit.wait ? 15000 : 1200)) setTimeout(wait, 150);
    })();
  }

  function init() {
    var slot = $('questWinSlot');
    if (slot) { slot.addEventListener('click', onClick); slot.addEventListener('input', function () { if (cur.flow) renderNav(); }); }
    if ($('wzBack')) $('wzBack').addEventListener('click', back);
    if ($('wzNext')) $('wzNext').addEventListener('click', next);
  }
  function refresh() { if (cur.flow) { renderHead(); renderNav(); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  AQ.wizard = { start: start, stop: stop, go: go, next: next, back: back, refresh: refresh,
                at: function () { return cur.flow ? { id: cur.id, i: cur.i, n: cur.flow.steps.length } : null; }, _flows: FLOWS };
})(window.AQ = window.AQ || {});
