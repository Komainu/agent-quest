/* =============================================================
   mailbox.js — ロボットの郵便受け（technocore.chat）（2026-10-11）
   -------------------------------------------------------------
   technocore の手引き（/llms.txt の MAILBOX、/patterns.md の 2・3）どおり:
     ・郵便受け = mb-p-<だれにも当てられない名前> の部屋
         mb- … 署名のある書き込みしか入らない（だれからの手紙かが必ず分かる）
         p-  … 一覧に出ない（名前を知っている人だけが書ける）
     ・自分の DID のノート（/kv/did-<2>/<14>）に「<did:key> mailbox:<部屋名>」と書いて知らせる
     ・相手に手紙を出すときは、相手の DID のノートを読み、mailbox: の部屋に署名して書く
   気をつけること
     ・ノートはだれでも上書きできる（ノート自体は証明にならない）。相手のノートの先頭が
       その相手の did:key でなければ使わない。部屋名は mb- か p- で始まるものだけ（掲示板などへ誤って書かない）
     ・届いた手紙はほかのエージェントが書いた文。ただの文字として出し、従わない
     ・7日だれも書かない部屋は消える（technocore の決まり）。消えたらもう一度開けばよい
   ============================================================= */
(function (AQ) {
  'use strict';

  var BASE = 'https://technocore.chat';
  var MB_STORE = 'aq.myAgent.mailbox';
  var LETTERS_STORE = 'aq.myAgent.letters';
  var SEEN_STORE = 'aq.myAgent.mailSeen';
  var NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
  var POLL_MS = 20000;

  function t(k, v) { return AQ.i18n.t(k, v); }
  function $(id) { return document.getElementById(id); }
  function mine() { return (AQ.birth && AQ.birth.mine && AQ.birth.mine()) || null; }
  function R() { return AQ.robot; }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function shortDid(d) { var m = String(d || '').match(/^did:key:(.+)$/); var b = m ? m[1] : String(d || ''); return b.length > 12 ? b.slice(0, 6) + '…' + b.slice(-4) : b; }
  function status(key, vars, kind) {
    var el = $('robotStatus'); if (!el) return;
    el.textContent = key ? t(key, vars) : '';
    el.className = 'birth-status' + (kind ? ' ' + kind : '');
  }
  function errMsg(e) { return String((e && e.message) || e || '').slice(0, 140); }

  function myBox() { var v = get(MB_STORE, ''); return NAME_RE.test(v) ? v : ''; }
  function letters() { try { return JSON.parse(get(LETTERS_STORE, '[]')) || []; } catch (e) { return []; } }
  function saveLetters(a) { set(LETTERS_STORE, JSON.stringify(a.slice(-50))); }
  function seen() { return Number(get(SEEN_STORE, '0')) || 0; }

  function newBoxName() {
    var b = new Uint8Array(12); crypto.getRandomValues(b);
    return 'mb-p-' + Array.from(b).map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }

  /* ---- 郵便受けを開く ---- */
  var busy = false;
  function openBox() {
    var d = mine(); if (!d || busy || !R()) return;
    var name = myBox() || newBoxName();
    busy = true; sync();
    status('robot.signing');
    var tStart = Date.now();
    R().say(name, 'mailbox of ' + d.name + ' (ERC-8004 agent #' + d.agentId + ' on Base) is open - signed letters only').then(function (res) {
      set(MB_STORE, name);
      if (AQ.activity) AQ.activity.add({ kind: 'mail-open', t0: tStart, t1: Date.now() });
      if (R().rememberName) R().rememberName(res.did, d);
      status('mail.publishing');
      return R().publishCard();
    }).then(function (ok) {
      status(ok ? 'mail.opened' : 'mail.openedNoNote', null, ok ? 'good' : 'bad');
      startPoll(true);
      peer = selfPeer();
      loadPeers().then(renderPeers, renderPeers);
    }).catch(function (e) {
      status((e && e.aq) || 'robot.failed', { msg: errMsg(e) }, 'bad');
    }).then(function () { busy = false; sync(); render(); renderLetterChoices(); });
  }

  /* ---- 届いた手紙を読む（郵便受けがあるあいだ、20秒ごと） ---- */
  var poll = { timer: null, cursor: 0, gen: 0 };
  function startPoll(now) {
    if (poll.timer) clearTimeout(poll.timer);
    poll.timer = null;
    poll.gen++;                                   // 読みに行っている途中の古い見回りは、戻ってきたら止まる
    if (!myBox()) return;
    var gen = poll.gen;
    var a = letters(); poll.cursor = a.reduce(function (m, x) { return Math.max(m, x.seq || 0); }, poll.cursor || 0);
    if (now) check(gen); else poll.timer = setTimeout(function () { check(gen); }, 2000);
  }
  function check(gen) {
    if (gen !== poll.gen) return;
    poll.timer = null;
    var box = myBox(); if (!box) return;
    var me = R() && R().did ? R().did() : null;
    fetch(BASE + '/r/' + box + '?format=json&limit=50' + (poll.cursor ? '&since=' + poll.cursor : ''), { mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : { messages: [] }; })
      .then(function (j) {
        if (gen !== poll.gen) return;
        var got = [];
        ((j && j.messages) || []).forEach(function (m) {
          if (m.seq > poll.cursor) poll.cursor = m.seq;
          /* 自分の「開きました」の行は手紙ではない。★ 2026-10-18 直し：以前は自分の書いたものを全部はじいていたので、
             自分の郵便受けに出した手紙が「届いた手紙」に出なかった */
          if (!m.from || (m.from === me && /^mailbox of /.test(String(m.text || '')))) return;
          got.push({ seq: m.seq, from: String(m.from), text: String(m.text || '').slice(0, 1000), ts: m.ts || null, signed: !!m.sig });
        });
        if (got.length) {
          var a = letters(), have = {};
          a.forEach(function (x) { have[x.seq] = 1; });
          var tNow = Date.now();
          got.forEach(function (x) { if (!have[x.seq]) { a.push(x); if (AQ.activity) AQ.activity.add({ kind: 'mail-recv', t0: tNow, t1: tNow + 1, text: x.text, from: x.from }); } });
          saveLetters(a);
          render();
        }
        poll.timer = setTimeout(function () { check(gen); }, POLL_MS);
      })
      .catch(function () { if (gen === poll.gen) poll.timer = setTimeout(function () { check(gen); }, POLL_MS * 2); });
  }
  function unread() { var s = seen(); return letters().filter(function (x) { return x.seq > s; }).length; }

  /* ---- 手紙を出す ---- */
  function fingerprint(did) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(did)).then(function (h) {
      return Array.from(new Uint8Array(h)).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('').slice(0, 16);
    });
  }
  /** 相手の DID のノートから郵便受けを探す（新しい場所 → 古い場所の順）。見つからなければ null */
  function mailboxOf(did) {
    return fingerprint(did).then(function (fp) {
      var urls = [BASE + '/kv/did-' + fp.slice(0, 2) + '/' + fp.slice(2), BASE + '/kv/did/' + fp];
      function tryAt(i) {
        if (i >= urls.length) return null;
        return fetch(urls[i], { mode: 'cors' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (txt) {
          var box = parseNote(txt, did);
          return box || tryAt(i + 1);
        }, function () { return tryAt(i + 1); });
      }
      return tryAt(0);
    });
  }
  /** ノートの文から mailbox: の部屋名を取り出す。ノートの本文がその did で始まらなければ使わない */
  function parseNote(txt, did) {
    var body = String(txt || '');
    var at = body.indexOf(did);
    if (at < 0) return null;
    /* 本文はその did で始まっていること（前にあってよいのは、technocore が付ける「!! UNTRUSTED…」の見出しだけ） */
    var before = body.slice(0, at).replace(/^!![^\n]*?(instructions\.|\n)/, '').trim();
    if (before) return null;
    var rest = body.slice(at + did.length);
    var m = rest.match(/(?:^|\s)mailbox:\s*([a-z0-9][a-z0-9_-]{0,47})(?=\s|$)/);
    if (!m) return null;
    var name = m[1];
    if (!/^(mb-|p-)/.test(name)) return null;                  // 掲示板などへ誤って書かない
    return name;
  }

  var LETTERS = [
    { key: 'thanksJob',    text: function (d) { return 'Thank you for taking my job on kibble! - ' + d.name + ' (ERC-8004 agent #' + d.agentId + ' on Base)'; } },
    { key: 'thanksReview', text: function (d) { return 'Thank you for reviewing the delivery on kibble. - ' + d.name + ' (ERC-8004 agent #' + d.agentId + ' on Base)'; } },
    { key: 'hello',        text: function (d) { return 'Hello! I am ' + d.name + ', a learning agent (ERC-8004 agent #' + d.agentId + ' on Base). Nice to meet you.'; } }
  ];
  var letterKey = 'hello', peers = [], peer = null;

  /** 手紙を出せそうな相手：自分の仕事を引き受けた子・検品した子（kibble.world の一覧から）＋自分（試し） */
  function loadPeers() {
    var me = R() && R().did ? R().did() : null;
    var mineIds = {}; (R().loadJobs ? R().loadJobs() : []).forEach(function (j) { mineIds[j.id] = j; });
    var list = [];
    if (me && myBox()) list.push({ did: me, role: 'self' });
    var p = R().loadBoard ? R().loadBoard(true) : Promise.resolve({});
    return p.then(function (by) {
      Object.keys(mineIds).forEach(function (id) {
        var job = by[id]; if (!job) return;
        if (job.worker_did && /^did:key:z/.test(job.worker_did)) list.push({ did: job.worker_did, role: 'worker', job: id });
        (job.attestations || []).forEach(function (a) { if (a && /^did:key:z/.test(a.did || '') && a.did !== me) list.push({ did: a.did, role: 'validator', job: id }); });
      });
    }, function () {}).then(function () {
      var seenD = {};
      peers = list.filter(function (x) { if (seenD[x.did]) return false; seenD[x.did] = 1; return true; }).slice(0, 8);
      if (peer) peer = peers.filter(function (x) { return x.did === peer.did; })[0] || null;   // 読み直したら、選んでいた相手を探し直す
      /* ★ 2026-10-19 宛先の既定は自分（試しの手紙）。ほかの子は郵便受けがあるときだけ選べる */
      if (!peer) peer = peers.filter(function (x) { return x.role === 'self'; })[0] || null;
      return Promise.all(peers.map(function (x) {
        if (x.role === 'self') { x.box = myBox(); return null; }
        return mailboxOf(x.did).then(function (b) { x.box = b; }, function () { x.box = null; });
      }));
    }).then(function () { return peers; });
  }

  function send() {
    var d = mine(); if (!d || busy || !peer || !peer.box || !R()) return;
    var L = LETTERS.filter(function (x) { return x.key === letterKey; })[0] || LETTERS[2];
    var text = L.text(d);
    busy = true; sync();
    status('robot.signing');
    var tStart = Date.now(), to = peer;
    R().say(peer.box, text).then(function (res) {
      if (AQ.quest) AQ.quest.setFlag('mail');
      if (AQ.activity) AQ.activity.add({ kind: 'mail-send', t0: tStart, t1: Date.now(), text: text, self: to.role === 'self' });
      status(to.role === 'self' ? 'mail.sentSelf' : 'mail.sent', { who: shortDid(to.did), seq: res.seq }, 'good');
      if (to.role === 'self') {
        /* 自分あての手紙は、サーバーが返した記録（署名を確かめた書き込み）をそのまま「届いた手紙」に入れる＝待たせない */
        var a = letters();
        if (!a.some(function (x) { return x.seq === res.seq; })) {
          a.push({ seq: res.seq, from: String(res.did), text: String(res.text || text).slice(0, 1000), ts: res.ts || new Date().toISOString(), signed: !!res.sig });
          saveLetters(a);
          if (AQ.activity) AQ.activity.add({ kind: 'mail-recv', t0: Date.now(), t1: Date.now() + 1, text: text, from: res.did });
        }
        render();
        var list = $('mailLetters');
        if (list && list.scrollIntoView) setTimeout(function () { list.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); list.classList.remove('quest-flash'); void list.offsetWidth; list.classList.add('quest-flash'); }, 60);
      }
    }).catch(function (e) {
      status((e && e.aq) || 'robot.failed', { msg: errMsg(e) }, 'bad');
    }).then(function () { busy = false; sync(); });
  }

  /* ---- 画面 ---- */
  function sync() {
    ['mailOpenBtn', 'mailSendBtn'].forEach(function (id) { if ($(id)) $(id).disabled = busy; });
    if ($('mailSendBtn')) {
      $('mailSendBtn').disabled = busy || !peer || !peer.box;
      $('mailSendBtn').textContent = t(peer && peer.role !== 'self' ? 'mail.sendBtn' : 'mail.sendSelfBtn');
    }
    var n = unread();
    if ($('robotMailOpen')) $('robotMailOpen').textContent = t('mail.open') + (n ? ' (' + n + ')' : '');
  }

  function render() {
    var box = myBox();
    if ($('mailStep1')) $('mailStep1').textContent = (box ? '✓ ' : '') + t('robot.step3', { n: 1 }) + ' ' + t('mail.step1');
    if ($('mailState')) $('mailState').textContent = box ? t('mail.have', { box: box.slice(0, 11) + '…' }) : t('mail.none');
    if ($('mailOpenBtn')) { $('mailOpenBtn').hidden = !!box; $('mailOpenBtn').textContent = t('mail.openBtn'); }
    var list = $('mailLetters');
    if (list) {
      list.innerHTML = '';
      var a = letters().slice().reverse(), s = seen(), me = R() && R().did ? R().did() : null, d = mine();
      if (!box) list.hidden = true;
      else {
        list.hidden = false;
        list.appendChild(mk('p', 'robot-step', (a.length ? '✓ ' : '') + t('robot.step3', { n: 3 }) + ' ' + t(a.length ? 'mail.step3' : 'mail.step3wait')));
        list.appendChild(mk('span', 'robot-job-lbl', t('mail.inbox')));
        if (!a.length) list.appendChild(mk('p', 'robot-empty', t('mail.empty')));
        a.slice(0, 10).forEach(function (x) {
          var c = mk('div', 'robot-job mail-letter' + (x.seq > s ? ' unread' : ''));
          c.appendChild(mk('small', 'robot-job-sub', t('mail.from', { who: AQ.nick ? AQ.nick.forActor(x.from) : shortDid(x.from), when: x.ts ? new Date(x.ts).toLocaleString(AQ.i18n.lang === 'en' ? 'en-US' : 'ja-JP') : '' })));
          var body = mk('p', 'robot-job-text', x.text); c.appendChild(body);
          /* ★ 2026-10-21 自分あての試しの手紙（利用者の要望）：自分のロボットが出した手紙には、
             「ほかのエージェントが書いた文です…」の注意も翻訳のリンクも要らない。どの手紙かを日本語で添える */
          var own = me && x.from === me, L = own && d ? LETTERS.filter(function (y) { return y.text(d) === x.text; })[0] : null;
          if (own) c.appendChild(mk('small', 'robot-job-sub', L ? t('mail.ownLetter', { kind: t('mail.text.' + L.key) }) : t('mail.ownLetterAny')));
          else {
            var trBar = mk('div', 'tr-bar'); c.appendChild(trBar);
            if (AQ.translate) AQ.translate.decorate([{ text: x.text, after: body }], trBar);
          }
          list.appendChild(c);
        });
        if (a.some(function (x) { return !me || x.from !== me; })) list.appendChild(mk('small', 'robot-job-warn', t('robot.jobs.untrusted')));
      }
    }
    if ($('mailSend')) $('mailSend').hidden = !box;
    renderPeers();
    sync();
  }

  function renderPeers() {
    var el = $('mailPeers'); if (!el) return;
    el.innerHTML = '';
    /* 郵便受けのあるほかの子がいるときだけ、宛先を選ばせる（いなければ自分あてで決まり） */
    var others = peers.filter(function (x) { return x.role !== 'self' && x.box; });
    el.hidden = !others.length; el.style.display = others.length ? '' : 'none';
    if ($('mailToLbl')) $('mailToLbl').hidden = !others.length;
    if (!others.length) { sync(); return; }
    peers.filter(function (x) { return x.role === 'self' || x.box; }).forEach(function (x) {
      var b = mk('button', 'robot-choice' + (peer === x ? ' on' : '')); b.type = 'button';
      b.appendChild(mk('b', null, (AQ.nick ? AQ.nick.forActor(x.did) : shortDid(x.did)) + ' · ' + t('mail.role.' + x.role)));
      b.appendChild(mk('small', null, x.box ? t('mail.hasBox') : t('mail.noBox')));
      b.disabled = !x.box || busy;
      b.addEventListener('click', function () { peer = x; renderPeers(); renderLetterChoices(); sync(); });
      el.appendChild(b);
    });
  }

  function renderLetterChoices() {
    /* 自分あての試しの手紙に「仕事のお礼」はおかしいので、自分あてのときは「あいさつ」だけ */
    var selfTo = !peer || peer.role === 'self';
    if (selfTo) letterKey = 'hello';
    Array.prototype.forEach.call(document.querySelectorAll('#mailTexts .robot-choice'), function (b) {
      var k = b.getAttribute('data-key'), L = LETTERS.filter(function (x) { return x.key === k; })[0], d = mine();
      b.style.display = (selfTo && k !== 'hello') ? 'none' : '';   // hidden 属性は CSS の display に負けるので直接
      b.classList.toggle('on', k === letterKey);
      b.querySelector('b').textContent = t('mail.text.' + k);
      b.querySelector('small').textContent = L && d ? L.text(d) : '';
    });
  }

  function selfPeer() {
    var me = R() && R().did ? R().did() : null;
    return (me && myBox()) ? { did: me, role: 'self', box: myBox() } : null;
  }
  function openPanel() {
    if (!peer) peer = selfPeer();
    set(SEEN_STORE, String(letters().reduce(function (m, x) { return Math.max(m, x.seq || 0); }, seen())));
    render();
    renderLetterChoices();
    if (myBox()) {
      /* 宛先の読み込み中の表示は出さない（既定は自分あて。ほかの子は見つかったときだけ出る） */
      loadPeers().then(renderPeers, renderPeers);
      startPoll(true);
    }
  }

  function relabel() {
    var map = { mailTitle: 'mail.title', mailLead: 'mail.lead', mailToLbl: 'mail.toLbl', mailTextLbl: 'mail.textLbl', mailSendBtn: 'mail.sendBtn', mailNote: 'mail.note',
                mailUsual: 'mail.usual', mailNoteLbl: 'mail.noteLbl' };
    Object.keys(map).forEach(function (id) { if ($(id)) $(id).textContent = t(map[id]); });
    if ($('mailTitle')) $('mailTitle').hidden = true;   // クエストの窓の題と重なる
    if ($('mailStep2')) $('mailStep2').textContent = t('robot.step3', { n: 2 }) + ' ' + t('mail.step2');
    render();
    renderLetterChoices();
  }

  function init() {
    if (!$('robotMail')) return;
    var tx = $('mailTexts');
    if (tx && !tx.children.length) {
      LETTERS.forEach(function (L) {
        var b = mk('button', 'robot-choice'); b.type = 'button'; b.setAttribute('data-key', L.key);
        b.appendChild(mk('b')); b.appendChild(mk('small'));
        b.addEventListener('click', function () { letterKey = L.key; renderLetterChoices(); });
        tx.appendChild(b);
      });
    }
    $('mailOpenBtn').addEventListener('click', openBox);
    $('mailSendBtn').addEventListener('click', send);
    $('robotMailOpen').addEventListener('click', function () { if (R() && R().togglePanel) R().togglePanel('robotMail', openPanel); });
    relabel();
    if (myBox() && mine()) startPoll(false);
  }

  /** クエストの窓では、宛先は自分（試しの手紙）に決める */
  function toSelf() { var sp = selfPeer(); if (sp) peer = sp; renderPeers(); renderLetterChoices(); sync(); }
  AQ.mailbox = { init: init, relabel: relabel, toSelf: toSelf,
    /* 検査用 */ _parseNote: parseNote, _newBoxName: newBoxName, _unread: unread };
})(window.AQ = window.AQ || {});
