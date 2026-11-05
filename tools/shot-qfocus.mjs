/* tools/shot-qfocus.mjs — クエストの窓で「今押すのはどれか」を、目立たせるボタン1つで伝える（2026-11-05）
   使い方: node tools/shot-qfocus.mjs   （dist/agent-quest.html を先に build）

   ★ 見るもの（文字は増やさない。デザインだけ）
     クエストの途中 … 金のボタンがちょうど1つだけ脈打つ（ウィザードの「次へ」があればそれ、なければそのステップの操作ボタン）。
                      窓の下の青い「次のクエスト」は控えめ（塗りなし・細い枠・光も動きもなし）で、押せるのはそのまま
     クリアしたら   … 金の脈打ちは無くなり、青い「次のクエスト」が塗り＋脈打ち（questNextBlue）に戻る
     動きを減らす設定 … 脈打ちの代わりに、太めの光で止まっている
     390px の幅でも、窓の下のボタンがはみ出さない */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'dist', 'agent-quest.html'))); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/';
const OWNER = '0x' + '19'.repeat(20);
const AGENT = { agentId: '4660', name: 'ピクセル', owner: OWNER, tx: '0x' + 'ab'.repeat(32), chain: 8453, t: Date.now() };

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

async function setup(opts = {}) {
  const page = await browser.newPage({ viewport: opts.vp || { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: opts.reduce ? 'reduce' : 'no-preference' });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((o) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('aq.myAgent', JSON.stringify(o.agent));
    localStorage.setItem('aq.myAgent.key', JSON.stringify({ d: 'x', x: 'y', did: 'did:key:z6MkRobotKeyAbcdefghijkmnopqrstuvwxyz12345' }));
  }, { agent: AGENT });
  await page.addInitScript((o) => {
    window.ethereum = { on: () => {}, request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [o.owner];
      if (method === 'eth_chainId') return '0x2105';
      return null;
    } };
  }, { owner: OWNER });
  /* 外のサービスには出ない（返事は空） */
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{}' }));
  await page.goto(URL0);
  await page.waitForFunction(() => window.AQ && window.AQ.quest && window.AQ.app);
  await page.click('#startBirth'); await page.waitForTimeout(300);
  return { page, errs };
}
const open = async (page, id) => { await page.evaluate((id) => AQ.quest.open(id), id); await page.waitForTimeout(400); };
/* いまの窓の様子：脈打つボタン・青い「次のクエスト」の見た目 */
const look = (page) => page.evaluate(() => {
  const box = document.getElementById('questWin'), nb = document.getElementById('questWinNext');
  const pulses = [...document.querySelectorAll('.q-pulse')].filter(b => b.getClientRects().length);
  const anims = [...box.querySelectorAll('button')].filter(b => b.getClientRects().length && getComputedStyle(b).animationName !== 'none').map(b => b.id || b.className);
  const ps = pulses[0] && getComputedStyle(pulses[0]), ns = getComputedStyle(nb);
  return {
    done: box.classList.contains('q-done'),
    pulses: pulses.map(b => b.id || b.className),
    anims,
    pulseAnim: ps ? ps.animationName : '', pulseShadow: ps ? ps.boxShadow : '', pulseBg: ps ? ps.backgroundColor : '',
    pulseGold: ps ? /255, 211, 107|255, 224, 143|255, 211, 107/.test(ps.backgroundColor + ps.borderColor) : false,
    next: { shown: !nb.hidden && !!nb.getClientRects().length, ready: nb.classList.contains('ready'), disabled: nb.disabled, text: nb.textContent,
            bg: ns.backgroundColor, anim: ns.animationName, shadow: ns.boxShadow, border: ns.borderTopWidth, color: ns.color },
    foot: (() => { const f = box.querySelector('.quest-win-foot'); return f.scrollWidth <= f.clientWidth + 1 && [...f.children].every(c => { const r = c.getBoundingClientRect(); return r.right <= innerWidth + 0.5 && r.left >= -0.5; }); })(),
    pageX: document.documentElement.scrollWidth <= innerWidth + 1
  };
});
const subdued = (n) => n.shown && !n.ready && !n.disabled && /rgba\(0, 0, 0, 0\)|transparent/.test(n.bg) && n.anim === 'none' && n.shadow === 'none' && n.border === '1px';
const loud = (n) => n.shown && n.ready && n.bg === 'rgb(47, 111, 216)' && n.anim === 'questNextBlue';
const SHOT = (n) => path.join(ROOT, 'tools', 'shot-qfocus-' + n + '.png');

console.log('\n[途中：操作ボタン1つだけのクエスト（掲示板であいさつ）]');
{
  const { page, errs } = await setup();
  await open(page, 'hello');
  const L = await look(page);
  ok(!L.done, 'まだクリアしていない');
  ok(L.pulses.length === 1 && L.pulses[0] === 'questWinGo', '脈打つのは「あいさつする」の金のボタン1つだけ（' + L.pulses.join(', ') + '）');
  ok(L.pulseAnim === 'questGoldPulse' && L.pulseGold, '金のボタンのまわりの光がゆっくり脈打つ（' + L.pulseAnim + '）');
  ok(L.anims.length === 1, '窓の中で動いているボタンは1つだけ（' + L.anims.join(', ') + '）');
  ok(subdued(L.next), '青い「次のクエスト」は控えめ：塗りなし・細い枠・光も動きもなし、押せる（' + JSON.stringify(L.next) + '）');
  await page.click('#questWinNext'); await page.waitForTimeout(400);
  const moved = await page.evaluate(() => document.getElementById('questWin').getAttribute('data-q'));
  ok(moved && moved !== 'hello', '控えめでも「次のクエスト」は押せて、次のクエストへ進む（' + moved + '）');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[途中：ステップのあるクエスト（ニュースを買う）]');
{
  const { page, errs } = await setup();
  await open(page, 'news');
  let L = await look(page);
  const wzShown = await page.evaluate(() => { const b = document.getElementById('wzNext'); return !!b && !b.hidden && !!b.getClientRects().length; });
  ok(wzShown, 'ステップ1 で「次へ」が出ている（おすすめが選んである）');
  ok(L.pulses.length === 1 && L.pulses[0] === 'wzNext', 'ウィザードの「次へ」があるときは、それだけが脈打つ（' + L.pulses.join(', ') + '）');
  ok(L.anims.length === 1, '窓の中で動いているボタンは1つだけ（' + L.anims.join(', ') + '）');
  ok(subdued(L.next), '青い「次のクエスト」は控えめ');
  await page.screenshot({ path: SHOT('mid-1440') });
  await page.click('#wzNext'); await page.waitForTimeout(700);
  L = await look(page);
  ok(L.pulses.length === 1 && L.pulses[0] === 'errandGo', '次のステップでは、そのステップの操作ボタン（買いに行かせる）だけが脈打つ（' + L.pulses.join(', ') + '）');
  ok(L.anims.length === 1, 'ここでも動いているボタンは1つだけ（' + L.anims.join(', ') + '）');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[途中 → クリア：金の脈打ちが止まり、青い「次のクエスト」が目立つ]');
{
  const { page, errs } = await setup({ vp: { width: 390, height: 844 } });
  await open(page, 'town');
  let L = await look(page);
  ok(!L.done && L.pulses.length === 1 && L.pulses[0] === 'questWinGo', '390px・途中：金の操作ボタン1つだけが脈打つ（' + L.pulses.join(', ') + '）');
  ok(subdued(L.next), '390px・途中：青い「次のクエスト」は控えめ');
  ok(L.foot && L.pageX, '390px：窓の下のボタンがはみ出さない・横にスクロールしない');
  await page.screenshot({ path: SHOT('mid-390') });
  const before = L.next.text;
  await page.evaluate(() => { localStorage.setItem('aq.quest.town', '1'); AQ.quest.render(); });
  await page.waitForTimeout(500);
  L = await look(page);
  ok(L.done, 'クリアした（q-done）');
  ok(L.pulses.length === 0, '金のボタンの脈打ちは止まる（' + L.pulses.join(', ') + '）');
  const goDone = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('questWinGo')); return s.textDecorationLine + ' ' + s.animationName; });
  ok(/line-through/.test(goDone) && /none$/.test(goDone), '金のボタンは「済んだ見た目」（取り消し線）のまま、動かない（' + goDone + '）');
  ok(loud(L.next), '青い「次のクエスト」は塗り＋脈打ち（questNextBlue）に戻る（' + JSON.stringify(L.next) + '）');
  ok(L.anims.length === 1 && L.anims[0] === 'questWinNext', '動いているボタンは青い「次のクエスト」1つだけ（' + L.anims.join(', ') + '）');
  ok(L.next.text === before, '文言は変わらない（' + L.next.text + '）');
  ok(L.foot && L.pageX, '390px・クリア後も、はみ出さない');
  await page.screenshot({ path: SHOT('done-390') });
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[クリア済みのクエストを開く]');
{
  const { page, errs } = await setup();
  await page.evaluate(() => localStorage.setItem('aq.quest.town', '1'));
  await open(page, 'town');
  const L = await look(page);
  ok(L.done && L.pulses.length === 0 && loud(L.next), '開いたときから、金は脈打たず、青い「次のクエスト」が目立つ');
  await page.screenshot({ path: SHOT('done-1440') });
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[動きを減らす設定]');
{
  const { page, errs } = await setup({ reduce: true });
  await open(page, 'hello');
  const L = await look(page);
  ok(L.pulses.length === 1 && L.pulseAnim === 'none' && L.pulseShadow !== 'none' && /4px/.test(L.pulseShadow), '脈打ちの代わりに、太めの光で止まっている（' + L.pulseShadow + '）');
  ok(L.anims.length === 0, '動いているボタンは無い（' + L.anims.join(', ') + '）');
  ok(subdued(L.next), '青い「次のクエスト」は控えめ');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

await browser.close();
server.close();
console.log(bad ? `\n✗ ${bad} 件の問題` : '\n✓ すべて OK');
process.exit(bad ? 1 : 0);
