/* =============================================================
   codefont.js — 正確に読む必要がある英数字だけ、読みやすい等幅の字にする（2026-10-18）
   -------------------------------------------------------------
   指摘: ドット絵の字では「bc_l49l6vty」が「bc_l4916vty」に、「AI」が「AT」に見える。
   方針: ドット絵の雰囲気（日本語・ふつうの言葉）はそのまま残し、
         番号・アドレス・取引番号・コード・金額・サイトの名前だけを
         <span class="code"> で包んで、l と 1、I と T、0 と O の区別がはっきりした
         等幅の字（IBM Plex Mono）で出す。
   しくみ: ドット絵の字を使っている場所（物語の枠・コマンド・上の計器・見出しなど）を見張り、
          文字が書きかわったら、その中の英数字のかたまりを探して包む。
          包んでも文字そのもの（textContent）は変わらないので、ほかの処理には影響しない。
   ============================================================= */
(function (AQ) {
  'use strict';

  /* 包む対象（左から順に試す）
     0x…（アドレス・取引番号） / did:key:… / bc_…（Builder Code） / #123（番号） /
     サイトの名前（example.com/path） / 英字と数字がまざった語（v1, x402, ERC-8004） / 数（1.000, 0.005, 12,345） / AI */
  var RE = /(0x[0-9a-fA-F]+(?:…[0-9a-fA-F]+)?|did:key:[A-Za-z0-9…]+|z6Mk[A-Za-z0-9…]+|bc_[a-z0-9]+|#\d+|(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|dev|chat|world|xyz|io|app|ai|test|example)(?:\/[^\s　、。）)」]*)?|[A-Za-z]+-?\d[A-Za-z0-9_-]*|\d[\d,]*(?:\.\d+)?|\bAI\b)/g;

  /* ドット絵の字を使っている場所。ここに無い場所（ふつうの等幅の字）は、もともと読みやすい */
  var SEL = '.win, .hud, .cmd-menu, .cmd-win, .start-card h2, #certProof, #certName, #certBody, #questBuilder';

  function wrapText(node) {
    var s = node.nodeValue;
    if (!s || !/[0-9#]|0x|bc_|did:|AI|\./.test(s)) return;
    RE.lastIndex = 0;
    var m, last = 0, frag = null;
    while ((m = RE.exec(s))) {
      if (!m[0]) { RE.lastIndex++; continue; }
      frag = frag || document.createDocumentFragment();
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      var sp = document.createElement('span'); sp.className = /^bc_/.test(m[0]) ? 'code code-bc' : 'code'; sp.textContent = m[0];
      frag.appendChild(sp);
      last = m.index + m[0].length;
    }
    if (!frag) return;
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (root.parentNode && !skip(root.parentNode)) wrapText(root); return; }
    if (root.nodeType !== 1 || skip(root)) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), list = [], n;
    while ((n = w.nextNode())) if (!skip(n.parentNode)) list.push(n);
    list.forEach(wrapText);
  }
  /* 包まないもの: すでに包んだ字・入力欄・ほかの人が書いた文（data-foreign は原文のまま）・絵文字だけの記号 */
  function skip(el) {
    return !el || !el.closest || !!el.closest('.code, input, textarea, select, script, style, [data-nocode]');
  }

  var busy = false;
  function onMut(list) {
    if (busy) return;
    busy = true;
    try {
      list.forEach(function (r) {
        if (r.type === 'characterData') { scan(r.target); return; }
        Array.prototype.forEach.call(r.addedNodes, function (n) { scan(n); });
      });
    } finally { busy = false; }
  }
  function watch(el) {
    if (!el || el.__aqCode) return;
    el.__aqCode = true;
    scan(el);
    new MutationObserver(onMut).observe(el, { childList: true, subtree: true, characterData: true });
  }
  function init() {
    Array.prototype.forEach.call(document.querySelectorAll(SEL), watch);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  AQ.codefont = { init: init, scan: scan, _re: RE };
})(window.AQ = window.AQ || {});
