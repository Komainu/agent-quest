/* tools/shot-birth.mjs — 「自分のエージェントを作る」の検査（2026-10-11）
   使い方: node tools/shot-birth.mjs   （dist/agent-quest.html を先に build）

   本物のウォレットとチェーンは使わない。ブラウザに「にせのウォレット」を入れて、
   アプリがウォレットに何を頼んだか（どのチェーンへ・どの宛先へ・どんなデータを）を
   全部控え、次を確かめる。
     ・送る前に Base へ切り替え、登録先（ERC-8004）にコードがあるかを確かめる
     ・宛先は ERC-8004 の Identity Registry、関数は register(string)、値は 0
     ・データの末尾に Builder Code（ERC-8021）の印が付いている（ox の結果と一致）
     ・身分証の中身（agentURI）に名前が入っている
     ・番号は届いた記録（Transfer）から読む → 「#番号が生まれました」→ 街で見られる
     ・ウォレットが無い／登録先が無い／取り消された、のときは何も送らずに知らせる */
import { chromium } from 'playwright';
import { withAutoConfirm } from './auto-confirm.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE_URL = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
/* ウォレットは file:// のページとはやりとりできないので、本番と同じく http で開いて試す
   （start.bat が使う localhost のサーバーの代わり） */
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'dist', 'agent-quest.html'))); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const FILE = 'http://127.0.0.1:' + server.address().port + '/';
const OWNER = '0x1111111111111111111111111111111111111111';
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
/* ox/erc8021 の Attribution.toDataSuffix({ codes: ['bc_l49l6vty'] }) の結果（npm の ox で計算） */
const OX_SUFFIX = '62635f6c34396c367674790b0080218021802180218021802180218021';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
withAutoConfirm(browser);   // ウォレットに頼む前の確認は自動で押す（tools/auto-confirm.mjs）

async function run(opts) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((o) => {
    localStorage.removeItem('aq.myAgent');
    if (o.noWallet) return;
    const calls = window.__calls = [];
    let chain = '0x1', receiptTries = 0;
    window.ethereum = {
      request: async ({ method, params }) => {
        calls.push({ method, params });
        switch (method) {
          case 'eth_requestAccounts': return [o.owner];
          case 'eth_chainId': return chain;
          case 'wallet_switchEthereumChain': chain = params[0].chainId; return null;
          case 'eth_getCode': return o.noCode ? '0x' : '0x60806040';
          case 'eth_sendTransaction':
            if (o.reject) { const e = new Error('User rejected'); e.code = 4001; throw e; }
            return '0x' + 'ab'.repeat(32);
          case 'eth_getTransactionReceipt':
            if (receiptTries++ < 1) return null;
            return { status: '0x1', logs: [{ address: o.registry,
              topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                       '0x' + '0'.repeat(64), '0x' + '0'.repeat(24) + o.owner.slice(2), '0x' + (4660).toString(16).padStart(64, '0')] }] };
          default: throw new Error('unexpected ' + method);
        }
      }
    };
  }, { ...opts, owner: OWNER, registry: REGISTRY });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.waitForTimeout(300);
  return { page, errs };
}

console.log('\n[ふつうに作る]');
{
  const { page, errs } = await run({});
  const door = await page.evaluate(() => { const q = document.getElementById('startQuest'); return q && !document.getElementById('startScreen').hidden ? q.innerText : ''; });
  ok(/クエストを始める/.test(door) && /クエスト帳を開く/.test(door), 'はじめの画面のいちばん上に、クエスト（始める・クエスト帳）がある');
  await page.click('#startBirth');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById('birthScreen').hidden), '扉を押すと作る窓が開く');
  ok(await page.evaluate(() => document.getElementById('birthGo').disabled), 'つなぐ前は「作る」が押せない');
  await page.click('#birthConnect'); await page.waitForTimeout(200);
  await page.fill('#birthName', 'ピクセル');
  await page.click('#birthGo');
  await page.waitForFunction(() => !document.getElementById('birthDone').hidden, null, { timeout: 15000 }).catch(() => {});
  const r = await page.evaluate(() => ({ calls: window.__calls, done: document.getElementById('birthDoneMsg').innerText,
    status: document.getElementById('birthStatus').innerText, saved: localStorage.getItem('aq.myAgent'),
    tx: document.getElementById('birthTx').href, ex: document.getElementById('birthExplorer').href }));
  const m = r.calls.map(c => c.method);
  ok(m.indexOf('wallet_switchEthereumChain') !== -1 && r.calls.find(c => c.method === 'wallet_switchEthereumChain').params[0].chainId === '0x2105', 'Base（0x2105）に切り替えてから送る');
  ok(m.indexOf('eth_getCode') !== -1 && m.indexOf('eth_getCode') < m.indexOf('eth_sendTransaction'), '送る前に登録先にコードがあるか確かめる');
  const tx = (r.calls.find(c => c.method === 'eth_sendTransaction') || {}).params?.[0] || {};
  ok(String(tx.to).toLowerCase() === REGISTRY.toLowerCase(), '宛先は ERC-8004 の Identity Registry');
  ok(tx.value === '0x0', 'お金（ETH）は送らない（値 0）');
  ok(String(tx.data).startsWith('0xf2c298be'), '関数は register(string)');
  ok(String(tx.data).endsWith(OX_SUFFIX), 'データの末尾に Builder Code の印（ox の結果と一致）');
  /* 身分証の中身を取り出して名前を確かめる */
  const hex = String(tx.data).slice(10, String(tx.data).length - OX_SUFFIX.length);
  const len = parseInt(hex.slice(64, 128), 16);
  const uri = Buffer.from(hex.slice(128, 128 + len * 2), 'hex').toString('utf8');
  const json = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
  ok(json.name === 'ピクセル', '身分証の中身に名前が入っている（' + json.name + '）');
  ok(/4660/.test(r.done), '届いた記録から番号を読み、「#4660 が生まれました」と出す（' + r.done + '）');
  ok(/basescan\.org\/tx\/0xabab/.test(r.tx) && /agents\/base-mainnet\/4660/.test(r.ex), '取引と身分証へのリンクが出る');
  ok(!!r.saved && JSON.parse(r.saved).agentId === '4660', 'このブラウザに覚えておく');
  await page.click('#birthWatch'); await page.waitForTimeout(1500);
  const w = await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(0); c.elapsed = c.durationOf(0) * 0.9; c.onFrame();
    return { n: c.beats.length, actor: String(c.beats[0].actor), cmd: document.getElementById('cmdWinBody').innerText,
             robots: AQ.scene.lastRobotsDrawn ? AQ.scene.lastRobotsDrawn() : null, closed: document.getElementById('birthScreen').hidden }; });
  ok(w.closed && w.n === 2 && /#4660/.test(w.actor), '「街で見る」で、生まれた場面（2コマ）が再生される（' + w.actor + '）');
  const stg0 = await page.evaluate(() => document.getElementById('scene').dataset.stage);
  ok(stg0 === 'city', '「街で見る」は街の場面（' + stg0 + '）');
  ok(/ERC-8004/.test(w.cmd) && /4660/.test(w.cmd), '説明に「ERC-8004 に登録されて #4660 が生まれた」と出る');
  /* もう一度はじめの画面を開くと、扉は「自分のエージェントを見る」になる */
  await page.evaluate(() => AQ.birth.relabel());
  const door2 = await page.evaluate(() => document.getElementById('startQuestAgent').innerText + ' / ' + document.getElementById('startQuestGoT').innerText);
  ok(/#4660/.test(door2) && /続きから/.test(door2), 'つぎに開くと、はじめの画面に「あなたのエージェント #4660」と「続きから」が出る（' + door2 + '）');
  await page.click('#langPill button:not(.on)'); await page.waitForTimeout(200);
  const en = await page.evaluate(() => document.getElementById('startQuestAgent').innerText + ' / ' + document.getElementById('birthTitle').innerText);
  ok(/agent #4660/.test(en) && /my agent #4660/.test(en), '英語に切り替えると窓も英語になる（生まれたあとは「my agent #4660」）：' + en);
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '：' + errs[0] : ''));
  await page.close();
}

console.log('\n[ウォレットが無い]');
{
  const { page, errs } = await run({ noWallet: true });
  await page.click('#startBirth'); await page.waitForTimeout(200);
  await page.click('#birthConnect'); await page.waitForTimeout(200);
  const st = await page.evaluate(() => document.getElementById('birthStatus').innerText);
  ok(/ウォレットが見つかりません/.test(st), 'ウォレットが無いと知らせる（' + st.slice(0, 20) + '）');
  ok(errs.length === 0, 'JS のエラーが無い');
  await page.close();
}

console.log('\n[ファイルを直接開いている（file://）]');
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => { localStorage.removeItem('aq.myAgent'); window.__asked = 0;
    window.ethereum = { request: () => { window.__asked++; return new Promise(() => {}); } }; });
  await page.goto(FILE_URL);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  const st = await page.evaluate(() => ({ s: document.getElementById('birthStatus').innerText, d: document.getElementById('birthConnect').disabled, n: window.__asked }));
  ok(/start\.bat/.test(st.s) && /localhost/.test(st.s), '開いたとたんに「start.bat で http://localhost から開いて」と案内する');
  ok(st.d && st.n === 0, 'つなぐボタンは押せず、ウォレットに頼みも送らない（返事が来ないまま止まらない）');
  await page.close();
}

console.log('\n[ウォレットが2本（MetaMask と Rabby）]');
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((o) => {
    localStorage.removeItem('aq.myAgent');
    window.__used = [];
    const mk = (name) => ({ request: async ({ method }) => { window.__used.push(name + ':' + method);
      if (method === 'eth_requestAccounts') return [o.owner]; if (method === 'eth_chainId') return '0x2105'; return null; } });
    const ws = [{ info: { uuid: 'u1', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider: mk('MetaMask') },
                { info: { uuid: 'u2', name: 'Rabby', icon: '', rdns: 'io.rabby' }, provider: mk('Rabby') }];
    window.ethereum = mk('window.ethereum');
    window.addEventListener('eip6963:requestProvider', () => {
      ws.forEach(w => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze(w) })));
    });
  }, { owner: OWNER });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  const names = await page.evaluate(() => [...document.querySelectorAll('#birthWallets .birth-wallet')].map(b => b.innerText.trim()));
  ok(names.join(',') === 'MetaMask,Rabby', '2本のウォレットを選ぶボタンが出る（' + names.join(',') + '）');
  await page.click('#birthWallets .birth-wallet:nth-of-type(2)'); await page.waitForTimeout(300);
  const used = await page.evaluate(() => window.__used);
  ok(used.some(u => u === 'Rabby:eth_requestAccounts') && !used.some(u => /^(MetaMask|window\.ethereum):eth_requestAccounts/.test(u)), '選んだウォレット（Rabby）だけにつなぐ');
  const btn = await page.evaluate(() => ({ c: document.getElementById('birthConnect').innerText, hidden: document.getElementById('birthWallets').hidden }));
  ok(/0x1111/.test(btn.c) && btn.hidden, 'つないだら選ぶボタンは引っ込み、つないだアドレスが出る');
  ok(errs.length === 0, 'JS のエラーが無い');
  await page.close();
}

console.log('\n[ウォレットの画面が出ない（返事が来ない）]');
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((o) => {
    localStorage.removeItem('aq.myAgent');
    window.__used = [];
    /* Rabby は返事をしない（確認画面が出ないまま）。MetaMask はすぐ返す。 */
    const mk = (name, hang) => ({ request: ({ method }) => { window.__used.push(name + ':' + method);
      if (method === 'eth_requestAccounts') return hang ? new Promise(() => {}) : Promise.resolve([o.owner]);
      return Promise.resolve(method === 'eth_chainId' ? '0x2105' : null); } });
    const ws = [{ info: { uuid: 'u1', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider: mk('MetaMask', false) },
                { info: { uuid: 'u2', name: 'Rabby', icon: '', rdns: 'io.rabby' }, provider: mk('Rabby', true) }];
    window.addEventListener('eip6963:requestProvider', () => {
      ws.forEach(w => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze(w) })));
    });
  }, { owner: OWNER });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate(() => AQ.birth._setHintMs(400));
  await page.click('#startBirth'); await page.waitForTimeout(200);
  const look = await page.evaluate(() => { const b = document.querySelector('#birthWallets .birth-wallet'); const cs = getComputedStyle(b);
    return { color: cs.color, bg: cs.backgroundColor }; });
  ok(look.color !== look.bg && /230|236|245/.test(look.color), '選ぶボタンの文字が見える色（' + look.color + ' / ' + look.bg + '）');
  await page.click('#birthWallets .birth-wallet:nth-of-type(2)'); await page.waitForTimeout(150);
  let st = await page.evaluate(() => ({ s: document.getElementById('birthStatus').innerText, c: document.getElementById('birthConnect').innerText,
    cd: document.getElementById('birthConnect').disabled, wd: [...document.querySelectorAll('#birthWallets .birth-wallet')].some(b => b.disabled) }));
  ok(/接続/.test(st.s), '待っているあいだ「ウォレットの画面で接続を押して」と出る');
  ok(st.c === 'やり直す' && !st.cd && !st.wd, '待っているあいだも「やり直す」とウォレットのボタンが押せる');
  await page.waitForTimeout(500);
  st = await page.evaluate(() => document.getElementById('birthStatus').innerText);
  ok(/アイコン/.test(st) && /もう一方/.test(st), '返事が来ないと、ウォレットのアイコンを押す案内が出る');
  await page.click('#birthWallets .birth-wallet:nth-of-type(1)'); await page.waitForTimeout(300);
  st = await page.evaluate(() => ({ c: document.getElementById('birthConnect').innerText, hidden: document.getElementById('birthWallets').hidden }));
  ok(/0x1111/.test(st.c) && st.hidden, 'もう一方（MetaMask）を選びなおすと、そちらでつながる');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}
{
  /* 1本だけで返事が無い → 「やり直す」でもう一度頼める。-32002（前の頼みが残っている）の案内 */
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    localStorage.removeItem('aq.myAgent');
    window.__n = 0;
    window.ethereum = { request: ({ method }) => {
      if (method !== 'eth_requestAccounts') return Promise.resolve(null);
      window.__n++;
      if (window.__n === 1) return new Promise(() => {});
      const e = new Error('Request of type wallet_requestPermissions already pending'); e.code = -32002; return Promise.reject(e);
    } };
  });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate(() => AQ.birth._setHintMs(300));
  await page.click('#startBirth'); await page.waitForTimeout(150);
  await page.click('#birthConnect'); await page.waitForTimeout(450);
  let s = await page.evaluate(() => document.getElementById('birthStatus').innerText);
  ok(/やり直す/.test(s), '1本だけのときは「やり直す」を案内する');
  await page.click('#birthConnect'); await page.waitForTimeout(200);
  s = await page.evaluate(() => ({ s: document.getElementById('birthStatus').innerText, n: window.__n, c: document.getElementById('birthConnect').innerText }));
  ok(s.n === 2 && /前の接続/.test(s.s), '「やり直す」でもう一度頼み、前の頼みが残っていればそう案内する');
  ok(s.c === 'ウォレットをつなぐ' || !/やり直す/.test(s.c), '案内のあとはボタンが元に戻る（' + s.c + '）');
  await page.close();
}

console.log('\n[登録先が無い]');
{
  const { page } = await run({ noCode: true });
  await page.click('#startBirth'); await page.click('#birthConnect'); await page.waitForTimeout(150);
  await page.fill('#birthName', 'test'); await page.click('#birthGo'); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ m: window.__calls.map(c => c.method), st: document.getElementById('birthStatus').innerText }));
  ok(r.m.indexOf('eth_sendTransaction') === -1, '登録先にコードが無ければ送らない');
  ok(/見つかりませんでした/.test(r.st), 'そのことを知らせる');
  await page.close();
}

console.log('\n[ウォレットで取り消した]');
{
  const { page } = await run({ reject: true });
  await page.click('#startBirth'); await page.click('#birthConnect'); await page.waitForTimeout(150);
  await page.fill('#birthName', 'test'); await page.click('#birthGo'); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ st: document.getElementById('birthStatus').innerText, done: !document.getElementById('birthDone').hidden,
    go: document.getElementById('birthGo').disabled }));
  ok(/取り消されました/.test(r.st) && !r.done, '取り消したと知らせ、生まれたことにはしない');
  ok(!r.go, 'もう一度押せる');
  await page.close();
}

await browser.close();
server.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
