/* =============================================================
   confirm.js — ウォレットに頼む直前に、アプリの中で中身を見せる（2026-11-02）
   -------------------------------------------------------------
   ねらい：
     ・署名や取引をウォレットに頼む前に、「何を頼むか・相手・上限と期限」を
       アプリの中で短く見せる。プレイする人が、ウォレットの画面を見る前に
       中身を知っていられるようにする（学習アプリとしても分かりやすい）
     ・「ウォレットで確かめる」を押すまで、ウォレットは呼ばない
       （押さずに「やめる」を押したら、何も頼まずに止まる）
   使い方：
     AQ.confirm.ask({ after: 状態の文の要素, what: '何を頼むか', rows: [{ k, v, href }], ok: 'ボタンの文' })
       → 押したら resolve、やめたら reject（e.aq = 'confirm.cancelled'）
   作り話をしない：
     ・ここに出すのは、このあとウォレットに渡す中身そのもの（相手・金額・期限）だけ
   ============================================================= */
(function (AQ) {
  'use strict';

  function t(k, v) { return AQ.i18n.t(k, v); }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function short(a) { a = String(a || ''); return a.slice(0, 6) + '…' + a.slice(-4); }
  var SCAN = 'https://basescan.org';

  var open = null;   // いま出ている確認（1つだけ）

  function close(why) {
    if (!open) return;
    var o = open; open = null;
    if (o.box && o.box.parentNode) o.box.parentNode.removeChild(o.box);
    if (why === 'ok') o.resolve(true);
    else { var e = new Error('cancelled'); e.aq = 'confirm.cancelled'; o.reject(e); }
  }

  /** 確認の小さな枠を出す。押したら resolve、やめたら reject */
  function ask(o) {
    close('replaced');
    return new Promise(function (resolve, reject) {
      var box = mk('div', 'wallet-confirm');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', t('confirm.title'));
      box.appendChild(mk('small', 'wallet-confirm-kicker', t('confirm.title')));
      box.appendChild(mk('b', 'wallet-confirm-what', o.what));
      var dl = mk('dl', 'wallet-confirm-rows');
      (o.rows || []).forEach(function (r) {
        if (!r || r.v == null || r.v === '') return;
        dl.appendChild(mk('dt', null, r.k));
        var dd = mk('dd');
        if (r.href) { var a = mk('a', null, r.v); a.href = r.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; dd.appendChild(a); }
        else dd.textContent = r.v;
        dl.appendChild(dd);
      });
      box.appendChild(dl);
      box.appendChild(mk('small', 'wallet-confirm-note', t('confirm.note')));
      var row = mk('div', 'wallet-confirm-btns');
      var ok = mk('button', 'go wallet-confirm-ok', o.ok || t('confirm.ok')); ok.type = 'button';
      var no = mk('button', 'wallet-confirm-no', t('confirm.cancel')); no.type = 'button';
      ok.addEventListener('click', function (ev) { ev.stopPropagation(); close('ok'); });
      no.addEventListener('click', function (ev) { ev.stopPropagation(); close('no'); });
      row.appendChild(ok); row.appendChild(no);
      box.appendChild(row);
      open = { box: box, resolve: resolve, reject: reject };
      var at = o.after;
      if (at && at.parentNode) at.parentNode.insertBefore(box, at.nextSibling);
      else document.body.appendChild(box);
      try { ok.focus({ preventScroll: true }); } catch (e) {}
      if (box.scrollIntoView) setTimeout(function () { try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }, 30);
    });
  }

  /** 相手の行（短いアドレス＋Basescan へのリンク） */
  function party(label, addr) { return { k: t('confirm.to'), v: (label ? label + ' ' : '') + short(addr), href: SCAN + '/address/' + addr }; }

  AQ.confirm = {
    ask: ask, party: party, short: short,
    cancel: function () { close('no'); },
    isOpen: function () { return !!open; }
  };
})(window.AQ = window.AQ || {});
