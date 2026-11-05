/* tools/shot-nowallet.mjs — ウォレットなしで試した人の指摘への小さな直し（2026-11-05）
   使い方: node tools/shot-nowallet.mjs   （dist/agent-quest.html を先に build）

   ★ 指摘と見るもの（外部のサービスはこの検査の中で偽物に差し替える。ウォレットは無し）
     1. ヘッダーの「x402 ?」を押しても反応が見えない
        → 押すと入門が頭から再生され、「x402 の流れを最初から再生します」が出る（LIVE を見ていても）
     2. 窓の × が右上の言語切り替えに覆われて押せない幅がある
        → 390 / 768 / 1024 / 1280 / 1600px で、自分のエージェントの窓とクエストの窓の × の真上が × 自身で、押すと閉じる
     3. デモ（作り話）と LIVE（本物の掲示板）が見分けにくい
        → 絵の左上の角に札。デモ／LIVE／読みこんだ記録で文字が変わる。やさしい表示でも見える
     4. USDC / CREDITS / RETRIES が何の数値か分からない
        → 押すか、指（マウス）を乗せると、短い説明が HUD の下に出る
     5. ロック中のクエストの中身が見られない
        → クエスト帳から押すと、説明だけの窓が開く（操作ボタンは無し・「まずクエスト1・2を終えると遊べます」）
     6. LICENSE（MIT・Komainu・2026）があり、README にも書いてある
     どれも日本語と英語の両方で、日本語の画面に英語の言い回し・英語の画面に日本語が混ざらないこと */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const WALLET = '0x1234567890abcdef1234567890abcdef12345678';
const now = Date.now();
const iso = (ms) => new Date(now - 120000 + ms).toISOString();
const KIBBLE = [];
{ let s = 1; for (let i = 0; i < 3; i++) {
  KIBBLE.push({ seq: s++, from: 'did:key:zPoster111111111', text: `JOB v1 | st${i} | build | Task ${i} | d`, ts: iso(s * 500) });
  KIBBLE.push({ seq: s++, from: DID, text: `CLAIM v1 | st${i} | builder`, ts: iso(s * 500) });
  KIBBLE.push({ seq: s++, from: DID, text: `DELIVER v1 | st${i} | done`, ts: iso(s * 500) });
} }
const TRANSFERS = { items: [0, 1].map(i => ({
  from: { hash: WALLET }, to: { hash: '0x' + 'cd'.repeat(20) },
  total: { value: String((i + 1) * 1000), decimals: '6' }, token: { symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  timestamp: iso(i * 60000), tx_hash: '0x' + String(i).repeat(64), method: 'transferWithAuthorization', type: 'token_transfer'
})) };

let bad = 0;
const ok = (c, m) => { if (c) console.log('    · ' + m); else { console.log('    ✗ ' + m); bad++; } };
const JA = /[ぁ-んァ-ヶ一-龠]/;
const ENG2 = /[A-Za-z]{2,}[\s,]+[A-Za-z]{2,}/;   // 英単語が2つ続く（日本語の画面に混ざってはいけない）
const langOk = (lang, s) => lang === 'en' ? !JA.test(s) : !ENG2.test(String(s).replace(/x402|USDC|CREDITS|RETRIES|LIVE|Builder Code|Base|ERC-\d+|MetaMask/g, ' '));

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
async function fresh(lang, opts = {}) {
  const page = await browser.newPage({ viewport: { width: opts.w || 1440, height: opts.h || 900 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.addInitScript((o) => {
    try { localStorage.clear(); localStorage.setItem('aq.lang', o.lang); if (o.more) localStorage.setItem('aq.moreText', '1'); } catch (e) {}
  }, { lang, more: !!opts.more });
  await page.route('https://technocore.chat/**', async (route) => {
    const u = new URL(route.request().url()), h = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (u.pathname === '/rooms') return route.fulfill({ status: 200, headers: { ...h, 'content-type': 'text/plain' }, body: '# x\n/r/kibble  seq 9  1M  0s ago\n' });
    if (u.searchParams.has('since')) { await new Promise(r => setTimeout(r, 300)); return route.fulfill({ status: 200, headers: h, body: '[]' }); }
    return route.fulfill({ status: 200, headers: h, body: JSON.stringify(KIBBLE) });
  });
  await page.route('https://base.blockscout.com/**', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(TRANSFERS) }));
  await page.route(/^https:\/\/(?!technocore\.chat|base\.blockscout\.com)/, r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{}' }));
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app && window.AQ.quest);
  await page.waitForTimeout(200);
  return page;
}
const tag = (page) => page.evaluate(() => { const t = document.getElementById('modeTag'); return { mode: t.getAttribute('data-mode'), text: t.textContent, title: t.title, vis: getComputedStyle(t).visibility, shown: t.getBoundingClientRect().width > 0, app: AQ.app.mode }; });

for (const lang of ['ja', 'en']) {
  console.log(`\n[${lang}] 1. 「x402 ?」を押すと、すぐに再生が始まったと分かる]`);
  {
    const page = await fresh(lang);
    await page.click('#startLive'); await page.waitForTimeout(800);
    const live = await tag(page);
    ok(live.mode === 'live' && live.app === 'live', '（前提）LIVE を見ている：札は ' + live.text);
    await page.click('#introBtn'); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent,
      playing: AQ.app.clock.playing, live: AQ.live.running, hint: document.getElementById('hint') ? document.getElementById('hint').textContent : '' }));
    ok(!r.live && r.playing, '押すと LIVE を切って、入門を頭から再生する');
    ok(/x402/.test(r.toast) && (lang === 'ja' ? /最初から再生/.test(r.toast) : /from the start/.test(r.toast)), '「x402 の流れを最初から再生します」が出る：' + r.toast);
    ok(langOk(lang, r.toast), 'お知らせの文は ' + lang + ' だけ');
    const d = await tag(page);
    ok(d.mode === 'demo', '札がデモ（作り話）に変わる：' + d.text);
    /* もう入門を見ているときに押しても、同じように分かる（同じ再生のままで何も起きないように見えない） */
    await page.waitForTimeout(4300);
    await page.click('#introBtn'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => !document.getElementById('toast').hidden && AQ.app.clock.playing && AQ.app.clock.index <= 1), '入門を見ている途中で押しても、頭から再生し直してお知らせが出る');
    await page.close();
  }

  console.log(`\n[${lang}] 2. 窓の × が、どの画面幅でも押せる]`);
  for (const w of [390, 768, 1024, 1280, 1600]) {
    const page = await fresh(lang, { w, h: w === 390 ? 844 : 900 });
    await page.click('#startBirth'); await page.waitForTimeout(300);
    const top = (id) => page.evaluate((id) => { const x = document.getElementById(id), b = x.getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!e && (e === x || x.contains(e)); }, id);
    ok(await top('birthClose'), w + 'px：自分のエージェントの窓の × の上に、ほかの部品が重なっていない');
    await page.click('#questList .quest[data-q="connect"]'); await page.waitForTimeout(300);
    ok(await top('questWinClose'), w + 'px：クエストの窓の × の上にも重なっていない');
    await page.click('#questWinClose', { timeout: 2000 }); await page.waitForTimeout(150);
    await page.click('#birthClose', { timeout: 2000 }).catch(() => {}); await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.getElementById('questWin').hidden && document.getElementById('birthScreen').hidden), w + 'px：× を押すと閉じる');
    await page.close();
  }

  console.log(`\n[${lang}] 3. デモ（作り話）／LIVE（本物）／読みこんだ記録の札]`);
  {
    const page = await fresh(lang);
    await page.click('#startDemo'); await page.waitForTimeout(400);
    const d = await tag(page);
    ok(d.mode === 'demo' && d.shown && d.vis === 'visible', 'デモ：札が見えている（やさしい表示でも）：' + d.text);
    ok(lang === 'ja' ? /作り話/.test(d.text) : /made up/i.test(d.text), 'デモの札は「作り話」と書いてある');
    await page.click('#homeBtn'); await page.waitForTimeout(200);
    await page.click('#startLive'); await page.waitForTimeout(800);
    const l = await tag(page);
    ok(l.mode === 'live' && /LIVE/.test(l.text) && (lang === 'ja' ? /本物/.test(l.text) : /real/i.test(l.text)), 'LIVE：札は「LIVE（本物の掲示板）」：' + l.text);
    await page.click('#homeBtn'); await page.waitForTimeout(200);
    await page.fill('#startId', WALLET); await page.click('#startGo'); await page.waitForTimeout(1200);
    const g = await tag(page);
    ok(g.mode === 'log', 'ウォレットの記録を読みこんだ：札は「記録の再生」：' + g.text);
    for (const x of [d, l, g]) ok(langOk(lang, x.text) && langOk(lang, x.title), '札の文字と説明は ' + lang + ' だけ：' + x.text + ' / ' + x.title);
    ok(new Set([d.text, l.text, g.text]).size === 3, '3つの札の文字はどれも違う');
    await page.close();
  }

  console.log(`\n[${lang}] 4. USDC / CREDITS / RETRIES の説明]`);
  {
    const page = await fresh(lang, { more: true });
    await page.click('#startDemo'); await page.waitForTimeout(400);
    await page.evaluate(() => { AQ.app.clock.pause(); AQ.app.clock.seek(AQ.app.clock.beats.length - 1); });
    await page.waitForTimeout(200);
    const after = (id) => page.evaluate((id) => { const c = getComputedStyle(document.getElementById(id), '::after').content; return c && c !== 'none' ? c : ''; }, id);
    for (const [id, word] of [['hud-usdc', 'USDC'], ['hud-credits', 'CREDITS'], ['hud-retries', 'RETRIES']]) {
      const vis = await page.evaluate((id) => { const e = document.getElementById(id); return !e.hidden && e.getBoundingClientRect().width > 0; }, id);
      if (!vis) { ok(false, word + ' が入門の HUD に出ていない'); continue; }
      const tip = await page.evaluate((id) => document.getElementById(id).getAttribute('data-tip'), id);
      ok(!!tip && tip.indexOf(word) === 0 && langOk(lang, tip), word + '：説明がある（' + lang + ' だけ）：' + tip);
      ok(!(await after(id)), word + '：ふだんは説明を出していない');
      await page.hover('#' + id); await page.waitForTimeout(100);
      ok((await after(id)).indexOf(word) >= 0, word + '：マウスを乗せると説明が出る');
      await page.mouse.move(5, 5); await page.waitForTimeout(100);
      await page.click('#' + id); await page.mouse.move(5, 5); await page.waitForTimeout(100);
      ok((await after(id)).indexOf(word) >= 0, word + '：押すと説明が出る（指を離しても残る）');
      await page.click('#' + id); await page.mouse.move(5, 5); await page.waitForTimeout(100);
      ok(!(await after(id)), word + '：もう一度押すと消える');
    }
    /* スマホ幅でも、説明が画面からはみ出さない */
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    await page.click('#hud-usdc'); await page.mouse.move(5, 5); await page.waitForTimeout(150);
    const ov = await page.evaluate(() => { const h = document.querySelector('.hud').getBoundingClientRect(); return h.right <= window.innerWidth + 1 && h.left >= -1; });
    ok(ov, '390px：説明は画面の幅に収まる（HUD の幅いっぱいに出す）');
    await page.close();
  }

  console.log(`\n[${lang}] 5. ロック中のクエストも、説明だけは読める]`);
  {
    const page = await fresh(lang);
    await page.click('#startBirth'); await page.waitForTimeout(300);
    const locked = await page.evaluate(() => [...document.querySelectorAll('#questList .quest.locked')].map(b => b.dataset.q));
    ok(locked.length === 12 && !locked.includes('connect'), 'ウォレットなし：クエスト2〜13 が 🔒（' + locked.length + ' 件）');
    for (const id of ['create', 'news', 'builder']) {
      await page.click(`#questList .quest[data-q="${id}"]`); await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const box = document.getElementById('questWin'), lk = document.getElementById('questWinLock'), vis = (e) => !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
        return { open: !box.hidden, title: document.getElementById('questWinTitle').textContent, what: document.getElementById('questWinWhat').textContent,
          learn: document.getElementById('questWinLearn').textContent, lock: vis(lk) ? lk.textContent : '',
          go: vis(document.getElementById('questWinGo')), slot: document.getElementById('questWinSlot').children.length,
          next: vis(document.getElementById('questWinNext')), wz: box.classList.contains('wz'),
          btns: [...box.querySelectorAll('.quest-win-body button')].filter(vis).map(b => b.id || b.className) };
      });
      ok(r.open && r.what.length > 5 && r.learn.length > 5, id + '：窓が開き、何をするクエストかが読める：' + r.what.slice(0, 40));
      const want = id === 'create' ? (lang === 'ja' ? /まずクエスト1を終えると遊べます/ : /Finish quest 1 first/) : (lang === 'ja' ? /まずクエスト1・2を終えると遊べます/ : /Finish quests 1 and 2 first/);
      ok(want.test(r.lock), id + '：「' + r.lock + '」と添えてある');
      ok(langOk(lang, r.lock) && langOk(lang, r.what), id + '：文は ' + lang + ' だけ');
      ok(!r.go && r.slot === 0 && !r.next && !r.wz && r.btns.length === 0, id + '：操作のボタン・パネル・次へは出さない' + (r.btns.length ? '（' + r.btns.join(',') + '）' : ''));
      await page.click('#questWinClose'); await page.waitForTimeout(150);
    }
    /* 遊べるクエスト（1）は今までどおり：説明だけの札は出ず、ボタンがある */
    await page.click('#questList .quest[data-q="connect"]'); await page.waitForTimeout(400);
    const c = await page.evaluate(() => ({ lock: !document.getElementById('questWinLock').hidden, locked: document.getElementById('questWin').classList.contains('q-locked'), slot: document.getElementById('questWinSlot').children.length }));
    ok(!c.lock && !c.locked && c.slot > 0, 'クエスト1：いつもの窓（説明だけの札は無く、操作の部品がある）');
    await page.close();
  }
}

console.log('\n[6. LICENSE]');
{
  const lic = fs.existsSync(path.join(ROOT, 'LICENSE')) ? fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8') : '';
  ok(/^MIT License/.test(lic) && /Copyright \(c\) 2026 Komainu/.test(lic) && /THE SOFTWARE IS PROVIDED "AS IS"/.test(lic), 'LICENSE：MIT・2026・Komainu');
  const rd = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok(/## License[\s\S]*MIT[\s\S]*\(LICENSE\)/.test(rd) && /ライセンス：MIT/.test(rd), 'README（英語・日本語）にライセンスが書いてある');
  ok(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).license === 'MIT', 'package.json の license も MIT');
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
