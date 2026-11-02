/* =============================================================
   data/chains.js — 対応チェーンの一覧
   -------------------------------------------------------------
   ここに1行足すだけで「アドレス欄」の選択肢が増えます。
   api は Blockscout v2 互換のエンドポイント、explorer はリンク用。
   （Arc は説明インターフェースのURLが公開されたらここに追加してください）
   ============================================================= */
(function (AQ) {
  'use strict';

  /* ★ 2026-10-03: usdc ＝ そのチェーンの本物の USDC（Circle 発行）のコントラクト。
     ウォレットの送金履歴から x402 の支払いとして描くのは、このコントラクトの送金だけ。
     名前（symbol）が「USDC」でも別のコントラクトは偽物のことがある（送ったように
     見せかける詐欺トークンが、あなたのアドレスから巨額を送った記録を勝手に作る）。 */
  AQ.chains = [
    { id: 'base',     label: 'Base',     api: 'https://base.blockscout.com/api/v2',     explorer: 'https://base.blockscout.com',
      usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
    { id: 'ethereum', label: 'Ethereum', api: 'https://eth.blockscout.com/api/v2',       explorer: 'https://eth.blockscout.com',
      usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
    { id: 'optimism', label: 'Optimism', api: 'https://optimism.blockscout.com/api/v2',  explorer: 'https://optimism.blockscout.com',
      usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85' }
  ];

  AQ.defaultChain = 'base';

})(window.AQ = window.AQ || {});
