/* tools/check-rpc.mjs — Base の窓口（src/rpc.js）の検査（2026-10-23）
   使い方: node tools/check-rpc.mjs   （dist/agent-quest.html を先に build）
   ・自分用の窓口が設定されていれば、まずそこへ聞く
   ・回数制限（429）・時間切れ・つながらないときは、公式の窓口 mainnet.base.org に切り替える
   ・429 で断られた窓口は、しばらく使わない
   ・設定が無ければ、公式の窓口だけ */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'dist', 'agent-quest.html'))); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage();
const hits = [];
let mode = 'ok';
await page.route('https://my-node.example/**', async r => { hits.push('mine'); if (mode === '429') return r.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*' }, body: 'too many' }); if (mode === 'hang') return; return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"result":"0xmine"}' }); });
await page.route('https://mainnet.base.org/**', r => { hits.push('public'); r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"result":"0xpublic"}' }); });
await page.route(/^https:\/\/(?!my-node|mainnet\.base)/, r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
await page.goto('http://127.0.0.1:' + server.address().port + '/'); await page.waitForFunction(() => window.AQ && window.AQ.rpc);
const call = (ms) => page.evaluate((ms) => AQ.rpc.call('eth_blockNumber', [], ms).then(r => r, e => 'ERR ' + e.message), ms);
hits.length = 0;
ok(await call() === '0xpublic' && hits.join() === 'public', '設定が無ければ、公式の窓口だけに聞く');
await page.evaluate(() => { AQ.config.rpcUrl = 'https://my-node.example/v2/key'; });
hits.length = 0;
ok(await call() === '0xmine' && hits.join() === 'mine', '自分用の窓口があれば、そこへ聞く（公式には聞かない）');
mode = 'hang'; hits.length = 0;
ok(await call(800) === '0xpublic' && hits.join() === 'mine,public', '自分用の窓口が黙ったら、時間切れで公式の窓口に切り替える');
mode = '429'; hits.length = 0;
ok(await call() === '0xpublic' && hits.join() === 'mine,public', '回数制限（429）で断られたら、公式の窓口に切り替える');
hits.length = 0;
ok(await call() === '0xpublic' && hits.join() === 'public', '429 で断られた窓口は、しばらく使わない');
await b.close(); server.close();
console.log(bad ? '✗ ' + bad + ' 件' : '✓ すべて OK');
process.exit(bad ? 1 : 0);
