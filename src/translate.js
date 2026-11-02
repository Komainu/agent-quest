/* =============================================================
   translate.js — ほかの人が書いた英語の文に、日本語の訳を添える（2026-10-17）
   -------------------------------------------------------------
   利用者の要望:「これは日本語版なので翻訳をつけてください」（買ってきたニュースの見出しなど）

   ★ 作り話をしない
     訳はこのアプリが考えて書くのではなく、ブラウザに入っている翻訳の機能
     （Chrome の Translator API・端末の中で訳す）に頼む。原文はそのまま残し、
     その下に「機械翻訳」と分かる形で添える。
     その機能が無いブラウザでは訳を作らず、「Google 翻訳で開く」リンクだけを出す
     （押したときに、その文が Google に送られる＝利用者が選んだときだけ）。
     日本語の表示のときだけ動く（英語の表示では何もしない）。
   ============================================================= */
(function (AQ) {
  'use strict';

  function t(k, v) { return AQ.i18n.t(k, v); }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var cache = {};             // 原文 → 訳（このページを開いている間だけ）
  var translator = null, creating = null;

  function api() { return (typeof self !== 'undefined' && self.Translator && typeof self.Translator.create === 'function') ? self.Translator : null; }
  function hasJa(s) { return /[ぁ-んァ-ヶ一-龠]/.test(String(s || '')); }

  /** 'available'（すぐ訳せる）／'downloadable'・'downloading'（押すと用意する）／'none'（この機能が無い） */
  function state() {
    var T = api();
    if (!T) return Promise.resolve('none');
    if (translator) return Promise.resolve('available');
    try {
      return Promise.resolve(T.availability({ sourceLanguage: 'en', targetLanguage: 'ja' })).then(function (a) {
        return a === 'available' || a === 'downloadable' || a === 'downloading' ? a : 'none';
      }, function () { return 'none'; });
    } catch (e) { return Promise.resolve('none'); }
  }
  /** 翻訳の機能を用意する（初めてのときは Chrome が訳の部品をダウンロードする。押したときに呼ぶ） */
  function ready(onProgress) {
    if (translator) return Promise.resolve(translator);
    if (creating) return creating;
    var T = api(); if (!T) return Promise.reject(new Error('no translator'));
    creating = Promise.resolve(T.create({ sourceLanguage: 'en', targetLanguage: 'ja',
      monitor: function (m) { try { m.addEventListener('downloadprogress', function (e) { if (onProgress) onProgress(e.loaded); }); } catch (e) {} } }))
      .then(function (tr) { translator = tr; creating = null; return tr; }, function (e) { creating = null; throw e; });
    return creating;
  }
  function one(text) {
    text = String(text || '');
    if (cache[text] != null) return Promise.resolve(cache[text]);
    return ready().then(function (tr) { return tr.translate(text); }).then(function (out) { cache[text] = String(out || ''); return cache[text]; });
  }
  function googleUrl(texts) {
    return 'https://translate.google.com/?sl=auto&tl=ja&op=translate&text=' + encodeURIComponent(texts.join('\n'));
  }

  /**
   * items: [{ text: 原文, after: 訳を入れる場所（この要素のすぐ後ろ） }]
   * bar:   「翻訳する」ボタンや Google 翻訳のリンクを置く入れ物（無ければ作らない）
   */
  function decorate(items, bar) {
    if (!items || !items.length || AQ.i18n.lang !== 'ja') return;
    items = items.filter(function (x) { return x && x.text && x.after && !hasJa(x.text); });
    if (!items.length) return;
    function put(x, out) {
      if (!x.after.parentNode || !out) return;
      var n = x.after.nextSibling;
      if (n && n.classList && n.classList.contains('tr-ja')) n.remove();
      var p = mk('span', 'tr-ja', out);
      p.setAttribute('lang', 'ja');
      x.after.parentNode.insertBefore(p, x.after.nextSibling);
    }
    /* Chrome の翻訳機能が使えなかったとき：理由を短く添えて、Google 翻訳で開くリンクに切り替える */
    function fallback(msg, e) {
      if (!bar) return;
      Array.prototype.forEach.call(bar.querySelectorAll('.tr-btn'), function (b) { b.remove(); });
      if (!bar.querySelector('.tr-google')) {
        var a = mk('a', 'errand-link tr-google', t('tr.google'));
        a.href = googleUrl(items.map(function (x) { return x.text; })); a.target = '_blank'; a.rel = 'noopener noreferrer';
        bar.insertBefore(a, msg || null);
      }
      if (msg) { msg.textContent = t('tr.failGoogle', { why: (e && (e.name || e.message)) ? String(e.name || e.message).slice(0, 40) : '?' }); msg.className = 'tr-note'; }   /* ★ 2026-10-19 エラー扱い（赤字・エラー名）はやめる：リンクで読めれば困らない */
    }
    function runAll(msg) {
      return Promise.all(items.map(function (x) { return one(x.text).then(function (o) { put(x, o); }); })).then(function () {
        if (msg) { msg.textContent = t('tr.done'); msg.className = 'tr-note'; }
      }, function (e) { fallback(msg, e); });
    }
    /* 前に訳した文は、すぐ出す */
    var all = items.every(function (x) { return cache[x.text] != null; });
    items.forEach(function (x) { if (cache[x.text] != null) put(x, cache[x.text]); });
    if (!bar) { if (!all) state().then(function (s) { if (s === 'available') runAll(null); }); return; }
    bar.innerHTML = '';
    var note = mk('small', 'tr-note', all ? t('tr.done') : '');
    bar.appendChild(note);
    if (all) return;
    state().then(function (s) {
      if (s === 'available') { note.textContent = t('tr.working'); runAll(note); return; }
      if (s === 'downloadable' || s === 'downloading') {
        var b = mk('button', 'tr-btn', t('tr.button')); b.type = 'button';
        b.addEventListener('click', function () {
          b.disabled = true; note.textContent = t('tr.preparing');
          ready(function (p) { note.textContent = t('tr.downloading', { pct: Math.round((Number(p) || 0) * 100) }); })
            .then(function () { b.remove(); note.textContent = t('tr.working'); return runAll(note); },
                  function (e) { fallback(note, e); });
        });
        bar.insertBefore(b, note);
        note.textContent = t('tr.firstTime');
        return;
      }
      /* 翻訳の機能が無いブラウザ：訳は作らず、Google 翻訳で開くリンクだけ */
      var a = mk('a', 'errand-link tr-google', t('tr.google'));
      a.href = googleUrl(items.map(function (x) { return x.text; })); a.target = '_blank'; a.rel = 'noopener noreferrer';
      bar.insertBefore(a, note);
      note.textContent = t('tr.noApi');
    });
  }

  AQ.translate = { decorate: decorate, _googleUrl: googleUrl, _reset: function () { cache = {}; translator = null; creating = null; } };
})(window.AQ = window.AQ || {});
