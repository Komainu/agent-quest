/* =============================================================
   memo.js — ロボットに記憶を持たせる（technocore.chat のメモ）（2026-10-26）
   -------------------------------------------------------------
   利用者「Technocore でできることを増やす」→ まだ使っていなかった「メモ（記憶）」を使うクエスト。
   technocore の手引き（/skill.md の notes）どおり:
     POST /kv/<名前>/<鍵> {"value": "..."}   … 書く（無料・ガス代なし・8192 字まで）
     GET  /kv/<名前>/<鍵>                     … 読む
     ・メモは部屋（7日で消える）と違って残る
     ・p- で始まる名前は一覧に出ない（ただし URL を知っていればだれでも読める。秘密は書かない）
   このアプリでは:
     ・名前は「ロボットの did:key から作った p-aq-mem-<20桁>」。同じロボットならいつも同じ場所
     ・書く前に今のメモを読み、新しい1行を足して書く（記憶が積み上がるのが分かるように）
     ・「覚えた」と言うのは、書いたあとにサーバーから読み直して、その1行が入っていたときだけ
   ★ 作り話をしない：読み直した中身をそのまま見せる。書けなかったら正直にそう言う。
   ============================================================= */
(function (AQ) {
  'use strict';

  var BASE = 'https://technocore.chat';
  var STORE = 'aq.myAgent.memo';
  var KEY = 'notes';
  var MAX_LINES = 20;

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
  function sweep(s) { return R() && R().sweep ? R().sweep(s) : String(s || '').trim(); }
  function hex(buf) { return Array.from(new Uint8Array(buf)).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function stamp(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** ロボットのメモの場所（同じ did:key ならいつも同じ） */
  function place() {
    return R()._loadOrMakeKey().then(function (k) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(k.did + '|agent-quest-memory')).then(function (h) {
        var ns = 'p-aq-mem-' + hex(h).slice(0, 20);
        return { ns: ns, key: KEY, url: BASE + '/kv/' + ns + '/' + KEY, did: k.did };
      });
    });
  }
  /** technocore は読んだメモの頭に「!! UNTRUSTED …」の見出しを付けることがある。それを外して行に分ける */
  function linesOf(txt) {
    var body = String(txt || '').replace(/^!![^\n]*\n?/, '');
    return body.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function read(p) {
    return fetch(p.url, { mode: 'cors', cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return [];
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.aq = 'memo.readFail'; throw e; }
      return r.text().then(linesOf);
    });
  }
  function write(p, lines) {
    return fetch(p.url, {
      method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ value: lines.join('\n') })
    }).then(function (r) {
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.aq = r.status === 429 ? 'robot.busy' : 'memo.writeFail'; throw e; }
      return true;
    });
  }

  /* ---- 覚えさせること（3択。どれも自分のデータから作る。秘密になるものは入れない） ---- */
  function lastNews() {
    var e = J('aq.myAgent.errands', []).filter(function (x) { return x && x.shop === 'news' && x.result; }).pop();
    if (!e) return null;
    var r = e.result, h = null;
    if (r && r.headlines && r.headlines.length) h = r.headlines[0].title || r.headlines[0];
    else if (r && r.articles && r.articles.length) h = r.articles[0].title;
    else if (typeof r === 'string') h = r;
    return h ? String(h).slice(0, 120) : null;
  }
  function lastJob() { var j = J('aq.myAgent.jobs', []).pop(); return j && j.title ? String(j.title).slice(0, 120) : null; }
  var CHOICES = [
    { key: 'me',   text: function (d) { return 'I am ' + d.name + ', ERC-8004 agent #' + d.agentId + ' on Base. My owner is ' + d.owner + '.'; } },
    { key: 'news', text: function () { var h = lastNews(); return h ? 'I bought news with x402. Headline: ' + h : null; } },
    { key: 'job',  text: function () { var j = lastJob(); return j ? 'I asked for a job on kibble: ' + j : null; } }
  ];
  var choice = 'me';

  /* ---- 画面 ---- */
  var busy = false, shown = null;
  function buildChoices() {
    var box = $('memoChoices'); if (!box) return;
    box.innerHTML = '';
    var d = mine();
    CHOICES.forEach(function (c) {
      var txt = d ? c.text(d) : null;
      if (!txt) return;
      var b = mk('button', 'robot-choice'); b.type = 'button'; b.setAttribute('data-key', c.key);
      b.appendChild(mk('b', null, t('memo.pick.' + c.key)));
      var sm = mk('small', null, txt); sm.setAttribute('data-user', ''); sm.lang = 'en'; b.appendChild(sm);   // ロボットが書く英文そのもの
      b.addEventListener('click', function () { pick(c.key); });
      box.appendChild(b);
    });
    if (!box.querySelector('[data-key="' + choice + '"]')) choice = 'me';
    pick(choice);
  }
  function pick(k) {
    choice = k;
    Array.prototype.forEach.call(document.querySelectorAll('#memoChoices .robot-choice'), function (b) {
      var on = b.getAttribute('data-key') === k;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function sync() {
    if ($('memoGo')) $('memoGo').disabled = busy || !mine();
    if ($('memoRecall')) { $('memoRecall').disabled = busy; $('memoRecall').hidden = !J(STORE, null); }
  }
  function renderResult() {
    var box = $('memoResult'); if (!box) return;
    box.innerHTML = '';
    box.hidden = !shown;
    if (!shown) return;
    box.appendChild(mk('b', 'robot-job-title', t('memo.resultTitle', { n: shown.lines.length })));
    var ul = mk('ul', 'memo-lines'); box.appendChild(ul);
    shown.lines.slice(-8).forEach(function (line) {
      var li = mk('li', line === shown.mark ? 'memo-line new' : 'memo-line', line);
      li.setAttribute('data-user', '');
      ul.appendChild(li);
    });
    var a = mk('a', 'robot-job-sub', t('memo.where') + ' ↗'); a.href = shown.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    box.appendChild(a);
  }

  function remember() {
    var d = mine(); if (!d || busy || !R()) return;
    var c = CHOICES.filter(function (x) { return x.key === choice; })[0];
    var text = c && c.text(d); if (!text) return;
    busy = true; sync();
    status('memo.reading');
    var p, line;
    place().then(function (pl) {
      p = pl;
      return read(p);
    }).then(function (old) {
      line = sweep(stamp(Date.now()) + ' | ' + text).slice(0, 300);
      var lines = old.concat([line]).slice(-MAX_LINES);
      status('memo.writing');
      return write(p, lines);
    }).then(function () {
      status('memo.checking');
      return read(p);
    }).then(function (back) {
      if (back.indexOf(line) < 0) { var e = new Error('not found'); e.aq = 'memo.unconfirmed'; throw e; }
      var rec = { url: p.url, ns: p.ns, key: p.key, line: line, kind: choice, t: Date.now(), n: back.length };
      try { localStorage.setItem(STORE, JSON.stringify(rec)); } catch (e2) {}
      shown = { lines: back, mark: line, url: p.url };
      renderResult();
      status('memo.done', { n: back.length }, 'good');
      if (AQ.quest && AQ.quest.refresh) AQ.quest.refresh();
    }).catch(function (e) {
      status((e && e.aq) || 'memo.failed', { msg: (e && e.message) || '' }, 'bad');
    }).then(function () { busy = false; sync(); });
  }
  /** 思い出す：サーバーから読み直して見せるだけ（書かない） */
  function recall() {
    if (busy || !R()) return;
    busy = true; sync();
    status('memo.reading');
    place().then(function (p) {
      return read(p).then(function (lines) {
        var rec = J(STORE, null);
        shown = { lines: lines, mark: rec && rec.line, url: p.url };
        renderResult();
        status(lines.length ? 'memo.recalled' : 'memo.empty', { n: lines.length }, lines.length ? 'good' : 'bad');
      });
    }).catch(function (e) {
      status((e && e.aq) || 'memo.failed', { msg: (e && e.message) || '' }, 'bad');
    }).then(function () { busy = false; sync(); });
  }

  function prep() { buildChoices(); shown = null; renderResult(); sync(); }
  function relabel() {
    var map = { memoStep1: 'memo.step1', memoStep2: 'memo.step2', memoLead: 'memo.lead', memoGo: 'memo.go', memoRecall: 'memo.recall', memoNote: 'memo.note' };
    Object.keys(map).forEach(function (id) { if ($(id)) $(id).textContent = t(map[id]); });
    buildChoices(); renderResult();
  }
  function init() {
    if ($('memoGo')) $('memoGo').addEventListener('click', remember);
    if ($('memoRecall')) $('memoRecall').addEventListener('click', recall);
    relabel(); sync();
  }

  AQ.memo = { init: init, relabel: relabel, prep: prep, remember: remember, recall: recall,
    /* 検査用 */ _linesOf: linesOf, _place: place, STORE: STORE };
})(window.AQ = window.AQ || {});
