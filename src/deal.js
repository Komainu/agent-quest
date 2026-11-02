/* =============================================================
   deal.js — 取引の約束（tclk）を練習する（2026-10-26）
   -------------------------------------------------------------
   利用者「Technocore でできることを増やす」→ tclk（Technocore Lock Protocol, flop-labs/tclk）。
   エージェント同士が「申し出 → 合意 → ロック → 引き渡し」を、署名つきの部屋の書き込みだけで行う決まり。
   お金そのものは「レール」が預かる。いま公開されているのは、お金を動かさない練習用の
   paper レール（PaperRail）だけ（tclk の README: Alpha、PaperRail rehearses the lifecycle without value）。

   このクエストでは:
     ・払う側 = 自分のロボット（いつもの鍵）、受け取る側 = このブラウザの中の「練習相手」（別の鍵）
     ・申し出と合意は、練習用の部屋（p-aq-tclk-<12桁>。一覧に出ない）に書く。
       本番の待ち合わせ部屋（tclk-offers）には書かない（ほかのエージェントがお金の話と間違えないように。
       SPEC §5: paper は「お金のない練習の場」以外でレールとして出してはいけない）
     ・ロック以降は、決まりどおり契約の番号から作る取引部屋（mb-p-tclk-<16桁>）に書く
     ・paper レールの記録は、決まりどおり /kv/tclk-paper-<2桁>/<14桁> のメモに書く
       （"tclkpaper1 locked hash <statement> <refundAfterMs>" → 引き渡しで claimed + 秘密）
     ・枠（フレーム）の形・番号（id / contract）の作り方は SPEC §3 と @flop-labs/tclk と同じ
       （検査で、本家のライブラリが読んで同じ番号になることを確かめている）
   ★ 作り話をしない：「できた」と言うのは、部屋から読み直した記録で、5つの枠がそろい、
      署名した人・番号・秘密が全部合ったときだけ。お金は1円も動かない、と画面でも言う。
   ============================================================= */
(function (AQ) {
  'use strict';

  var BASE = 'https://technocore.chat';
  var STORE = 'aq.myAgent.deal';
  var PARTNER_STORE = 'aq.tclk.partnerKey';
  var DOMAIN = 'FLOP::tclk::v1';
  var PREFIX = 'tclk1 ';
  /* 練習の取引の中身（お金は動かない。数字は「0.01 USDC 相当」の見本） */
  var TERMS = { amount: '10000', asset: 'USDC', rails: ['paper'] };
  var STEPS = ['offer', 'accept', 'lock', 'reveal', 'receipt'];

  function t(k, v) { return AQ.i18n.t(k, v); }
  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function J(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function mine() { return (AQ.birth && AQ.birth.mine && AQ.birth.mine()) || null; }
  function R() { return AQ.robot; }
  function status(key, vars, kind) {
    var el = $('robotStatus'); if (!el) return;
    el.textContent = key ? t(key, vars) : '';
    el.className = 'birth-status' + (kind ? ' ' + kind : '');
  }
  function hexOf(u8) { return Array.from(u8).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function randHex(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return hexOf(b); }
  function bytesOfHex(h) { h = String(h).replace(/^0x/, ''); var u = new Uint8Array(h.length / 2); for (var i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; }
  function sha256(u8) { return crypto.subtle.digest('SHA-256', u8).then(function (h) { return '0x' + hexOf(new Uint8Array(h)); }); }
  function sha256Text(s) { return sha256(new TextEncoder().encode(s)); }

  /* ---- 枠（フレーム）の書き方：SPEC §3 ---- */
  /** キーを並べ替え、区切りは , と : だけ、undefined は落とす */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  /** ASCII 以外は \uXXXX に（保存される字と署名する字を同じにする） */
  function ascii(s) { return s.replace(/[\u0080-￿]/g, function (ch) { return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4); }); }
  function domainHash(tag, json) { return sha256Text(DOMAIN + '|' + tag + '|' + ascii(json)); }
  function line(frame) { return PREFIX + ascii(canon(frame)); }
  function parse(text) {
    var s = String(text || '');
    if (s.indexOf(PREFIX) !== 0) return null;
    try { var f = JSON.parse(s.slice(PREFIX.length)); return f && typeof f === 'object' ? f : null; } catch (e) { return null; }
  }
  function offerOf(fields) {
    return domainHash('offer', canon(fields)).then(function (id) { var o = {}; Object.keys(fields).forEach(function (k) { o[k] = fields[k]; }); o.id = id; return o; });
  }
  function contractOf(offer, core) { return domainHash('contract', canon({ offer: offer, accept: core })); }
  function dealRoom(contract) { return 'mb-p-tclk-' + contract.slice(2, 18); }
  function paperNote(contract) { return { ns: 'tclk-paper-' + contract.slice(2, 4), key: contract.slice(4, 18) }; }

  /* ---- 練習相手の鍵（このブラウザの中だけ。お金は持たない） ---- */
  var partnerP = null;
  function partner() {
    if (partnerP) return partnerP;
    var saved = J(PARTNER_STORE, null);
    partnerP = (saved && saved.d && saved.x
      ? crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', d: saved.d, x: saved.x, ext: true }, { name: 'Ed25519' }, true, ['sign'])
          .then(function (priv) { return { priv: priv, x: saved.x }; })
      : crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']).then(function (kp) {
          return crypto.subtle.exportKey('jwk', kp.privateKey).then(function (jwk) {
            try { localStorage.setItem(PARTNER_STORE, JSON.stringify({ d: jwk.d, x: jwk.x })); } catch (e) {}
            return { priv: kp.privateKey, x: jwk.x };
          });
        })
    ).then(function (k) {
      var s = String(k.x).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
      var bin = atob(s), raw = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
      return { priv: k.priv, did: R()._didFromPub(raw) };
    }).catch(function (e) { partnerP = null; throw e; });
    return partnerP;
  }
  var lastNonce = 0;
  function nextNonce() { lastNonce = Math.max(Date.now() + 7, lastNonce + 1); return String(lastNonce); }
  function b64url(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  /** 練習相手として署名して書く（ロボットの say と同じ決まり） */
  function partnerSay(room, text) {
    return partner().then(function (k) {
      var nonce = nextNonce();
      return crypto.subtle.sign('Ed25519', k.priv, new TextEncoder().encode(room + '|' + nonce + '|' + text)).then(function (sig) {
        return fetch(BASE + '/r/' + room + '?format=json', {
          method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
          body: JSON.stringify({ did: k.did, sig: b64url(new Uint8Array(sig)), nonce: nonce, text: text })
        }).then(function (r) {
          return r.text().then(function (txt) {
            if (!r.ok) { var e = new Error(String(txt || '').split('\n')[0].slice(0, 140) || ('HTTP ' + r.status)); e.aq = r.status === 429 ? 'robot.busy' : 'deal.refused'; throw e; }
            var j = null; try { j = JSON.parse(txt); } catch (e2) {}
            var p = j && j.posted;
            if (!p || p.from !== k.did || p.text !== text || !(p.seq > 0)) { var e3 = new Error('posted record mismatch'); e3.aq = 'robot.unconfirmed'; throw e3; }
            return { did: k.did, seq: p.seq, room: room, text: text };
          });
        });
      });
    });
  }
  function note(ns, key, value) {
    return fetch(BASE + '/kv/' + ns + '/' + key, {
      method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ value: value })
    }).then(function (r) { if (!r.ok) { var e = new Error('HTTP ' + r.status); e.aq = 'deal.noteFail'; throw e; } return true; });
  }
  function readNote(ns, key) {
    return fetch(BASE + '/kv/' + ns + '/' + key, { mode: 'cors', cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) { var m = String(txt || '').match(/tclkpaper1 [^\n]*/); return m ? m[0].trim() : ''; });
  }
  function readRoom(room) {
    return fetch(BASE + '/r/' + room + '?since=0&limit=50&format=json', { mode: 'cors', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { messages: [] }; })
      .then(function (j) { return (j && (j.messages || j.items)) || []; });
  }

  /* ---- 確かめる：部屋から読み直した記録で、5つの枠と番号・秘密が全部合うか ---- */
  function verify(rec) {
    return Promise.all([readRoom(rec.offersRoom), readRoom(rec.dealRoom), readNote(rec.paper.ns, rec.paper.key)]).then(function (got) {
      var all = got[0].concat(got[1]), note = got[2];
      /* 署名した人（部屋の記録の from）と、枠の中の from が同じものだけを数える（SPEC §2） */
      function find(type) {
        return all.map(function (m) { return { m: m, f: parse(m && m.text) }; })
          .filter(function (x) { return x.f && x.f.type === type; })
          .filter(function (x) { return (x.f.contract === rec.contract || x.f.id === rec.offerId) && x.m.from === x.f.from; })[0] || null;
      }
      var o = find('offer'), a = find('accept'), l = find('lock'), v = find('reveal'), c = find('receipt');
      var why = [];
      if (!o || !a || !l || !v || !c) why.push('missing');
      if (why.length) return { ok: false, why: why };
      var core = { from: a.f.from, ref: a.f.ref, statement: a.f.statement, paymentKey: a.f.paymentKey, nonce: a.f.nonce };
      var offerFields = {}; Object.keys(o.f).forEach(function (k) { if (k !== 'id') offerFields[k] = o.f[k]; });
      return Promise.all([domainHash('offer', canon(offerFields)), contractOf(o.f, core), sha256(bytesOfHex(v.f.secret))]).then(function (h) {
        if (h[0] !== o.f.id) why.push('offerId');
        if (a.f.ref !== o.f.id || h[1] !== a.f.contract) why.push('contract');
        if (l.f.from !== o.f.from || TERMS.rails.indexOf(l.f.rail) < 0) why.push('lock');
        if (v.f.from !== a.f.from || h[2] !== a.f.statement) why.push('secret');
        if (c.f.outcome !== 'claimed') why.push('receipt');
        if (note.indexOf('tclkpaper1 claimed ') !== 0) why.push('paper');
        return { ok: !why.length, why: why, seqs: { offer: o.m.seq, accept: a.m.seq, lock: l.m.seq, reveal: v.m.seq, receipt: c.m.seq }, note: note };
      });
    });
  }

  /* ---- 画面 ---- */
  var busy = false, at = -1;
  function renderSteps(done, failAt) {
    var box = $('dealSteps'); if (!box) return;
    box.innerHTML = '';
    STEPS.forEach(function (s, i) {
      var cls = 'deal-step' + (i < done ? ' ok' : '') + (i === done && busy ? ' now' : '') + (i === failAt ? ' ng' : '');
      var li = mk('li', cls);
      li.appendChild(mk('span', 'deal-mark', i < done ? '✓' : (i === failAt ? '✕' : String(i + 1))));
      var tx = mk('span', 'deal-txt');
      tx.appendChild(mk('b', null, t('deal.step.' + s)));
      tx.appendChild(mk('small', null, t('deal.who.' + s)));
      li.appendChild(tx);
      box.appendChild(li);
    });
  }
  function renderResult() {
    var box = $('dealResult'); if (!box) return;
    var rec = J(STORE, null);
    box.innerHTML = ''; box.hidden = !rec;
    if (!rec) return;
    box.appendChild(mk('b', 'robot-job-title', t('deal.resultTitle')));
    box.appendChild(mk('small', 'robot-job-sub', t('deal.resultBody', { amount: '0.01', asset: TERMS.asset })));
    box.appendChild(mk('small', 'robot-job-sub code', t('deal.contract', { id: rec.contract.slice(0, 10) + '…' + rec.contract.slice(-6) })));
    var a = mk('a', 'robot-job-sub', t('deal.seeRoom') + ' ↗'); a.href = BASE + '/r/' + rec.dealRoom; a.target = '_blank'; a.rel = 'noopener noreferrer';
    box.appendChild(a);
  }
  function sync() { if ($('dealGo')) $('dealGo').disabled = busy || !mine(); }

  function run() {
    var d = mine(); if (!d || busy || !R()) return;
    busy = true; at = 0; sync(); renderSteps(0);
    var now = Date.now(), offersRoom = 'p-aq-tclk-' + randHex(6);
    var me, pa, offer, accept, contract, room, paper, preimage = new Uint8Array(32), statement;
    crypto.getRandomValues(preimage);
    function step(i) { at = i; renderSteps(i); }
    status('deal.preparing');
    Promise.all([R()._loadOrMakeKey(), partner()]).then(function (ks) {
      me = ks[0]; pa = ks[1];
      /* ① 申し出（払う側＝自分のロボット） */
      return offerOf({ type: 'offer', from: me.did, role: 'payer', amount: TERMS.amount, asset: TERMS.asset, lock: 'hash', rails: TERMS.rails.slice(),
                       claimByMs: now + 10 * 60000, refundAfterMs: now + 20 * 60000, expiresMs: now + 5 * 60000, nonce: randHex(8) });
    }).then(function (o) {
      offer = o;
      status('deal.posting', { what: t('deal.step.offer') });
      return R().say(offersRoom, line(offer));
    }).then(function () {
      step(1);
      /* ② 合意（受け取る側＝練習相手）。秘密を作り、そのハッシュだけを出す */
      return sha256(preimage);
    }).then(function (h) {
      statement = h;
      var core = { from: pa.did, ref: offer.id, statement: statement, nonce: randHex(8) };
      return contractOf(offer, core).then(function (c) { contract = c; accept = { type: 'accept', from: core.from, ref: core.ref, statement: core.statement, nonce: core.nonce, contract: c }; });
    }).then(function () {
      status('deal.posting', { what: t('deal.step.accept') });
      return partnerSay(offersRoom, line(accept));
    }).then(function () {
      step(2);
      /* ③ ロック：paper レールに「預けた」記録を書き、取引部屋で知らせる */
      room = dealRoom(contract); paper = paperNote(contract);
      status('deal.posting', { what: t('deal.step.lock') });
      return note(paper.ns, paper.key, 'tclkpaper1 locked hash ' + statement + ' ' + offer.refundAfterMs)
        .then(function () { return R().say(room, line({ type: 'lock', from: me.did, contract: contract, rail: 'paper', ref: contract })); });
    }).then(function () {
      step(3);
      /* ④ 引き渡し：練習相手が秘密を明かして受け取る（paper の記録も claimed に） */
      var secret = '0x' + hexOf(preimage);
      status('deal.posting', { what: t('deal.step.reveal') });
      return partnerSay(room, line({ type: 'reveal', from: pa.did, contract: contract, secret: secret }))
        .then(function () { return note(paper.ns, paper.key, 'tclkpaper1 claimed hash ' + statement + ' ' + offer.refundAfterMs + ' ' + secret); });
    }).then(function () {
      step(4);
      /* ⑤ 受領：払う側が「受け取られた」ことを確かめた、と記す */
      status('deal.posting', { what: t('deal.step.receipt') });
      return R().say(room, line({ type: 'receipt', from: me.did, contract: contract, outcome: 'claimed', rail: 'paper', ref: contract }));
    }).then(function () {
      status('deal.checking');
      var rec = { contract: contract, offerId: offer.id, offersRoom: offersRoom, dealRoom: room, paper: paper, partner: pa.did, t: Date.now() };
      return verify(rec).then(function (v) {
        if (!v.ok) { var e = new Error(v.why.join(',')); e.aq = 'deal.unconfirmed'; throw e; }
        rec.seqs = v.seqs;
        try { localStorage.setItem(STORE, JSON.stringify(rec)); } catch (e2) {}
        at = 5; busy = false; renderSteps(5); renderResult();
        status('deal.done', null, 'good');
        if (AQ.quest && AQ.quest.refresh) AQ.quest.refresh();
      });
    }).catch(function (e) {
      var failAt = at; busy = false; renderSteps(failAt, failAt);
      status((e && e.aq) || 'deal.failed', { msg: (e && e.message) || '' }, 'bad');
    }).then(function () { busy = false; sync(); });
  }

  function prep() { if (!busy) renderSteps(J(STORE, null) ? 5 : 0); renderResult(); sync(); }
  function relabel() {
    var map = { dealLead: 'deal.lead', dealGo: 'deal.go', dealNote: 'deal.note', dealStepsLbl: 'deal.stepsLbl' };
    Object.keys(map).forEach(function (id) { if ($(id)) $(id).textContent = t(map[id]); });
    prep();
  }
  function init() {
    if ($('dealGo')) $('dealGo').addEventListener('click', run);
    relabel();
  }

  AQ.deal = { init: init, relabel: relabel, prep: prep, run: run,
    /* 検査用 */ _canon: canon, _line: line, _parse: parse, _offerOf: offerOf, _contractOf: contractOf, _verify: verify, STORE: STORE, TERMS: TERMS };
})(window.AQ = window.AQ || {});
