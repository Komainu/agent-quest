/* tools/shot-cityact.mjs — 街の x402 は文字ではなく物の動きで（2026-10-02）
   使い方: node tools/shot-cityact.mjs

   ★ 提案（利用者）「kibble の部屋を参考に、こちらも文字ではなく、なるべくアクションで」
     ① 頼んだ → 注文の紙が扉へ       ② お金が要る → 扉に値札（402・金額の数字だけ）
     402 で断られた → 値札が揺れる    ③ 署名 → ペンで署名・許可証が光って扉へ・硬貨と金額
     ④ チェーンに載せた → 許可証を立会所へ・判・ブロックが積まれる
     ⑤ 中身を渡した → 扉が開いて箱が手に渡る

   ★ 見るもの
     ・入門の各コマで、その段階の動きが描かれている
     ・絵の中の文字は数字だけ（402・金額）。「未払い」「OK」「PLAN」のような言葉は出ない
     ・ウォレット（チェーンの送金記録）を見るときは、記録にある③④の動きだけが出て、
       記録に無い①②⑤の動き（紙・値札・箱）は出ない
*/
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE ? 'file://' + process.env.AQ_FILE : 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.click('#startDemo');
await page.waitForTimeout(200);

async function sweep() {
  return page.evaluate(() => {
    const c = AQ.app.clock, out = [];
    c.pause();
    for (let i = 0; i < c.beats.length; i++) {
      const fx = new Set(), labels = new Set();
      for (const q of [0.05, 0.3, 0.6, 0.76, 0.85, 0.92, 0.99]) {
        c.seek(i); c.elapsed = c.durationOf(i) * q; c.onFrame();
        AQ.scene.lastFx().forEach(f => fx.add(f));
        /* ★ 2026-10-06: 立会所の窓口（判・ブロック）は画面の下の寄り絵に出る */
        if (AQ.scene.lastCloseup) AQ.scene.lastCloseup().fx.forEach(f => fx.add(f));
        AQ.scene.lastLabels().forEach(l => labels.add(l));
      }
      out.push({ i, kind: c.beats[i].kind, status: String((c.beats[i].lead && c.beats[i].lead.status) || ''), fx: [...fx], labels: [...labels] });
    }
    return out;
  });
}

const WANT = { plan: ['think'], travel: ['paper'], require: ['tag402'], pay: ['sign', 'permit'], settle: ['permit', 'block'], receive: ['door-open', 'box'] };
const intro = await sweep();
const seenKinds = new Set();
for (const r of intro) {
  const want = r.kind === 'error' && r.status === '402' ? ['tag402', 'refused'] : WANT[r.kind];
  if (want) {
    seenKinds.add(r.kind);
    const miss = want.filter(f => !r.fx.includes(f));
    if (miss.length) fail(`コマ${r.i}（${r.kind}）: 動き ${miss.join(', ')} が描かれていない（描いたもの: ${r.fx.join(',') || 'なし'}）`);
  }
  const words = r.labels.filter(l => !/^-?\d+(\.\d+)?$/.test(l));
  if (words.length) fail(`コマ${r.i}（${r.kind}）: 絵の中に数字以外の文字がある: ${words.join(' / ')}`);
}
for (const k of ['plan', 'travel', 'require', 'pay', 'settle', 'receive']) if (!seenKinds.has(k)) fail(`入門に ${k} のコマが無い＝この検査は空回り`);
ok('入門: ' + intro.map(r => `${r.kind}[${r.fx.join('+') || '-'}]`).join(' '));

/* ウォレット（チェーンの送金記録）：記録にある③④の動きだけ */
await page.evaluate(() => {
  const iso = (ms) => new Date(Date.now() - 600000 + ms).toISOString();
  const items = [0, 1].map(i => ({ from: { hash: '0x1234567890abcdef1234567890abcdef12345678' }, to: { hash: '0x' + 'ab'.repeat(20) },
    total: { value: '1000', decimals: '6' }, token: { symbol: 'USDC' }, timestamp: iso(i * 60000), transaction_hash: '0x' + String(i).repeat(64) }));
  const ev = AQ.adapters.fromChain(items, { address: '0x1234567890abcdef1234567890abcdef12345678', chain: 'base' });
  AQ.app.loadEvents(ev);
  AQ.app.focusOn(ev[0].actor);
});
await page.waitForTimeout(200);
const chain = await sweep();
/* ★ 2026-10-03: 財布（使った額）・硬貨（払った額）・ブロックが積み終わった合図・硬貨が店へ、も
   送金の記録（③④）から描けるもの＝出てよい */
const allowed = new Set(['sign', 'permit', 'stamp', 'block', 'purse', 'coin', 'block-land', 'coin-to-shop', 'purse-open', 'unknown-item', 'pending', 'ghost', 'cu-coin', 'cu-walletpay', 'cu-robot', 'cu-charge']);   // ghost＝建物の裏で隠れたロボットを透かす（2026-10-06）   // 2026-10-06: 払うと約束した額（③〜④のあいだ）   // 2026-10-05: 受け取った物は記録に無い（？の箱）   // 2026-10-04: がま口が開く（③の支払いの動き）
const extra = [...new Set(chain.flatMap(r => r.fx))].filter(f => !allowed.has(f));
if (extra.length) fail(`ウォレットの記録に無い段階の動きが出ている: ${extra.join(', ')}`);
if (!chain.some(r => r.fx.includes('block'))) fail('ウォレットの記録で、チェーンに載る動き（ブロック）が出ていない');
ok('ウォレット: ' + chain.map(r => `${r.kind}[${r.fx.join('+') || '-'}]`).join(' '));

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
