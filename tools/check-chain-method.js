/* tools/check-chain-method.js — チェーンの送金の「送金のしかた」の読み取り（2026-10-08）
   使い方: node tools/check-chain-method.js

   寄り絵の立会人（FACILITATOR）の場面は、送金のしかたが transferWithAuthorization
   （署名で払う x402 と同じ方式）のときだけ描く（それ以外は、立会人が確かめたとは
   記録から言えない）。エクスプローラが関数名を解読できないと、名前の代わりに
   関数の番号（selector）が届くので、それも名前にそろえて読めることを確かめる。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const AQ = {};
function load(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace('window.AQ = window.AQ || {}', 'AQ');
  // eslint-disable-next-line no-eval
  eval(src);
}
load('src/adapters/fromChain.js');

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
function methodOf(m) {
  const items = [{ from: { hash: ADDR }, to: { hash: '0x' + 'ab'.repeat(20) }, total: { value: '1000', decimals: '6' },
    token: { symbol: 'USDC' }, timestamp: new Date(1758300000000).toISOString(), transaction_hash: '0x' + '1'.repeat(64), method: m }];
  const ev = AQ.adapters.fromChain(items, { address: ADDR, chain: 'base' });
  const e = ev.find(x => x.type === 'payment.settled');
  return e ? e.meta.method : 'NO-EVENT';
}
ok(methodOf('transferWithAuthorization') === 'transferWithAuthorization', '名前で届いたら、そのまま');
ok(methodOf('0xe3ee160e') === 'transferWithAuthorization', '番号 0xe3ee160e（v,r,s 版）も transferWithAuthorization と読む');
ok(methodOf('0xCF092995') === 'transferWithAuthorization', '番号 0xcf092995（署名まとめ版）も transferWithAuthorization と読む');
ok(methodOf('transfer') === 'transfer', 'ふつうの送金（transfer）は transfer のまま＝立会人の場面は出さない');
ok(methodOf(undefined) === null, '送金のしかたが記録に無ければ null＝立会人の場面は出さない');
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて合格'));
process.exit(bad ? 1 : 0);
