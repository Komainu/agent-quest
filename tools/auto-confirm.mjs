/* tools/auto-confirm.mjs — 検査用（2026-11-02）
   ウォレットに頼む前の確認（src/confirm.js）が出たら、自動で「ウォレットで確かめる」を押す。
   確認そのものを確かめる検査（tools/shot-safety.mjs）では使わない（window.__noAutoConfirm = true でも止まる）。
   押した順は window.__confirms に残す（確認がウォレットより先に出たかを、検査で確かめられる）。 */
export const AUTO_CONFIRM = `(() => {
  window.__confirms = [];
  const go = () => {
    if (window.__noAutoConfirm) return;
    document.querySelectorAll('.wallet-confirm-ok').forEach((b) => {
      if (b.__aq) return; b.__aq = 1;
      const w = b.closest('.wallet-confirm');
      window.__confirms.push((w && w.querySelector('.wallet-confirm-what') || {}).textContent || '');
      setTimeout(() => b.click(), 0);
    });
  };
  new MutationObserver(go).observe(document, { childList: true, subtree: true });
})();`;

/** browser.newPage を包んで、どのページにも自動の確認を入れる */
export function withAutoConfirm(browser) {
  const np = browser.newPage.bind(browser);
  browser.newPage = async (o) => { const p = await np(o); await p.addInitScript(AUTO_CONFIRM); return p; };
  return browser;
}
