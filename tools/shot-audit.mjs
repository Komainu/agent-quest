/* tools/shot-audit.mjs — 画面ぜんたいの総点検（2026-10-08）
   使い方: node tools/shot-audit.mjs   （dist/agent-quest.html を先に build）
   SHOTS=1 で各場面のスクリーンショットを /tmp/aq-audit/ に保存する。

   いろいろなログ（入門・デモ4種・ウォレット・kibble の部屋）を、いろいろな
   画面の大きさと言語で、全コマ再生しながら次を機械的に探す：
     ・JS のエラー／console.error
     ・画面の文字に undefined / NaN / null / [object …] が出ていないか
     ・画面の文字に、訳されていない辞書の鍵（cmd.why.pay など）がそのまま出ていないか
     ・絵の中に描いた文字（ラベル）に undefined / NaN が無いか
     ・縦横のはみ出し（ページがスクロールしてしまう）
     ・コマンド（しらべる・さいふ・きろく）を押したときの窓の中身が空でないか */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const SHOTS = !!process.env.SHOTS;
const OUT = '/tmp/aq-audit';
if (SHOTS) fs.mkdirSync(OUT, { recursive: true });

const VPS = [{ w: 1280, h: 720 }, { w: 1440, h: 900 }, { w: 1920, h: 1080 }, { w: 820, h: 1180 }, { w: 390, h: 844 }];
const LANGS = ['ja', 'en'];
const iso = (ms) => new Date(1758300000000 + ms).toISOString();
const K = (n) => 'did:key:z6Mk' + n + 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' + n;
const KIBBLE = [
  { seq: 1, from: K('A'), text: 'JOB v1 | kQ1 | build | Build the pier | d', ts: iso(0) },
  { seq: 2, from: K('B'), text: 'CLAIM v1 | kQ1 | builder', ts: iso(40000) },
  { seq: 3, from: K('C'), text: 'CLAIM v1 | kQ1 | builder', ts: iso(60000) },
  { seq: 4, from: K('B'), text: 'DELIVER v1 | kQ1 | done', ts: iso(90000) },
  { seq: 5, from: K('D'), text: 'ATTEST v1 | kQ1 | not | redo', ts: iso(120000) },
  { seq: 6, from: K('B'), text: 'DELIVER v1 | kQ1 | done again', ts: iso(150000) },
  { seq: 7, from: K('D'), text: 'ATTEST v1 | kQ1 | useful | ok', ts: iso(180000) },
  { seq: 8, from: K('E'), text: 'hello everyone', ts: iso(200000) } ];

const SCENES = [
  { name: 'intro' },
  ...['basic', 'burst', 'failure', 'team'].map(r => ({ name: 'run-' + r, run: r })),
  { name: 'wallet-twa', chain: 'transferWithAuthorization' },
  { name: 'wallet-plain', chain: null },
  { name: 'kibble-job', kibble: 'job' },
  { name: 'kibble-agent', kibble: 'agent' }
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const problems = [];
const add = (where, what) => { problems.push(where + ' — ' + what); };

/* はじめの画面 */
for (const vp of VPS) for (const lang of LANGS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  const errs = [];
  page.on('pageerror', e => errs.push('JS: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load resource|CORS/i.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(FILE + (lang === 'en' ? '?lang=en' : ''));
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate((lang) => { if (AQ.i18n.lang !== lang) document.getElementById('lang').click(); }, lang);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const vis = document.getElementById('startScreen');
    const txt = vis && !vis.hidden ? vis.innerText : '';
    return { txt, overX: document.documentElement.scrollWidth - innerWidth, open: !!(vis && !vis.hidden) };
  });
  const where = `start ${vp.w}x${vp.h} ${lang}`;
  errs.forEach(e => add(where, e));
  if (!r.open) add(where, 'はじめの画面が出ていない');
  if (/undefined|NaN|\[object/.test(r.txt)) add(where, '文字に undefined/NaN');
  if (r.overX > 2) add(where, `横にはみ出し ${r.overX}px`);
  if (lang === 'en' && /[぀-ヿ]/.test(r.txt)) add(where, '英語なのに日本語が残っている: ' + (r.txt.match(/[^\n]*[぀-ヿ][^\n]*/) || [''])[0].slice(0, 60));
  if (SHOTS && vp.w === 1440) await page.screenshot({ path: `${OUT}/start-${lang}.png` });
  await page.close();
}

for (const sc of SCENES) for (const vp of VPS) for (const lang of LANGS) {
  if (lang === 'en' && vp.w !== 1440 && vp.w !== 390) continue;      // 英語は2つの大きさで十分
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  const errs = [];
  page.on('pageerror', e => errs.push('JS: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load resource|CORS/i.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate((lang) => { if (AQ.i18n.lang !== lang) document.getElementById('lang').click(); }, lang);
  await page.evaluate(({ sc, KIBBLE }) => {
    if (sc.name === 'intro') { AQ.app.startIntro(); return; }
    if (sc.run) { AQ.app.loadRun(sc.run); const b = AQ.app.clock.beats; }
    if (sc.chain !== undefined) {
      const iso = (ms) => new Date(Date.now() - 600000 + ms).toISOString();
      const items = [0, 1, 2].map(i => ({ from: { hash: '0xE0f8567890abcdef1234567890abcdef12345638' }, to: { hash: '0x' + 'ab'.repeat(20) },
        total: { value: String(5322 * (i + 1)), decimals: '6' }, token: { symbol: 'USDC' }, timestamp: iso(i * 60000),
        transaction_hash: '0x' + String(i).repeat(64), method: sc.chain || undefined }));
      AQ.app.loadEvents(AQ.adapters.fromChain(items, { address: '0xE0f8567890abcdef1234567890abcdef12345638', chain: 'base' }));
    }
    if (sc.kibble) {
      AQ.adapters.kibbleForget('audit');
      AQ.app.loadEvents(AQ.adapters.fromKibble(KIBBLE, { room: 'audit', observedAt: Date.now() }));
    }
  }, { sc, KIBBLE });
  await page.waitForTimeout(400);
  /* 選ぶ（入門は自動） */
  await page.evaluate(({ sc, KIBBLE }) => {
    if (sc.name === 'intro') return;
    if (sc.kibble === 'job') { AQ.app.setListMode('jobs'); AQ.app.focusOnJob('kQ1'); return; }
    if (sc.kibble === 'agent') { AQ.app.setListMode('agents'); AQ.app.focusOnAgent(KIBBLE[1].from); return; }
    const fb = AQ.app.clock.beats;
    const actor = (fb.find(b => b.actor && b.actor !== 'observer') || fb[0] || {}).actor;
    if (actor != null) AQ.app.focusOn(String(actor));
  }, { sc, KIBBLE });
  await page.waitForTimeout(500);
  const where = `${sc.name} ${vp.w}x${vp.h} ${lang}`;
  const res = await page.evaluate(({ lang }) => {
    const out = [];
    const c = AQ.app.clock; c.pause();
    const stage = () => document.getElementById('scene').dataset.stage;
    const R = () => stage() === 'room' ? AQ.room : AQ.scene;
    const KEYRE = /(?:^|[\s(（「])((?:cmd|ui|act|story|detail|roster|x402|jobs|agents|recap|places|start|load|chain|scene|nick|progress|hud|obj|card|kind|noun)\.[a-zA-Z][\w.]*)/;
    const visText = (sel) => { const e = document.querySelector(sel); return e && e.offsetParent !== null ? e.innerText : ''; };
    const n = c.beats.length;
    if (!n) out.push('コマが1つも無い');
    for (let i = 0; i < n; i++) {
      for (const p of [0.15, 0.5, 0.95]) {
        c.seek(i); c.elapsed = c.durationOf(i) * p; c.onFrame();
        const labels = (R().lastLabels ? R().lastLabels() : []).join(' | ');
        if (/undefined|NaN|null|\[object/.test(labels)) out.push(`コマ${i}(${c.beats[i].kind}) p=${p}: 絵の文字に ${labels.slice(0, 80)}`);
        const over = document.documentElement.scrollHeight - innerHeight, overX = document.documentElement.scrollWidth - innerWidth;
        if (innerWidth >= 1200 && over > 2) out.push(`コマ${i}(${c.beats[i].kind}) p=${p}: 縦にはみ出し ${over}px`);
        if (overX > 2) out.push(`コマ${i}: 横にはみ出し ${overX}px`);
      }
      /* コマンド */
      for (const cmd of ['cmdInspect', 'cmdWallet', 'cmdLog']) {
        const b = document.getElementById(cmd); if (!b) continue;
        b.click();
        const body = document.getElementById('cmdWinBody');
        const txt = body ? body.innerText.trim() : '';
        const html = body ? body.innerHTML : '';
        if (!txt && !/<svg|<img/.test(html)) out.push(`コマ${i}(${c.beats[i].kind}): ${cmd} の窓が空`);
        if (/undefined|NaN|\[object|\bnull\b/.test(txt)) out.push(`コマ${i}(${c.beats[i].kind}): ${cmd} に ${txt.slice(0, 80)}`);
        const km = txt.match(KEYRE); if (km) out.push(`コマ${i}: ${cmd} に辞書の鍵がそのまま: ${km[1]}`);
        if (lang === 'en' && /[぀-ヿ]/.test(txt)) out.push(`コマ${i}(${c.beats[i].kind}): 英語なのに ${cmd} に日本語: ${txt.slice(0, 60)}`);
      }
      document.getElementById('cmdWinClose') && document.getElementById('cmdWinClose').click();
      /* 詳細（ⓘ）の中身 */
      if (i === 0 || i === n - 1) {
        const db = document.getElementById('detail'); if (db) db.click();
        const dp = document.getElementById('detailPanel');
        const dt = dp && !dp.hidden ? dp.innerText : '';
        if (dp && dp.hidden) out.push(`コマ${i}: 詳細（ⓘ）が開かない`);
        if (/\bundefined\b|\bNaN\b|\[object/.test(dt)) out.push(`コマ${i}: 詳細に undefined/NaN: ${(dt.match(/[^\n]*(undefined|NaN|\[object)[^\n]*/) || [''])[0].slice(0, 80)}`);
        const km3 = dt.match(KEYRE); if (km3) out.push(`コマ${i}: 詳細に辞書の鍵: ${km3[1]}`);
        const dc = document.getElementById('detailClose'); if (dc) dc.click();
      }
      const all = document.querySelector('main').innerText;
      if (/\bundefined\b|\bNaN\b|\[object/.test(all)) out.push(`コマ${i}: 画面の文字に undefined/NaN: ${(all.match(/[^\n]*(undefined|NaN|\[object)[^\n]*/) || [''])[0].slice(0, 80)}`);
      const km2 = all.match(KEYRE); if (km2) out.push(`コマ${i}: 画面に辞書の鍵がそのまま: ${km2[1]}`);
      if (lang === 'en') {
        const side = visText('#sideCol') + '\n' + visText('.win') + '\n' + visText('#hint');
        const jp = side.match(/[^\n]*[぀-ヿ][^\n]*/);
        if (jp) out.push(`コマ${i}: 英語なのに日本語: ${jp[0].slice(0, 70)}`);
      }
    }
    return { out, n, stage: stage() };
  }, { lang });
  errs.forEach(e => add(where, e));
  const seen = new Set();
  res.out.forEach(o => { const k = o.replace(/コマ\d+/, 'コマ#').replace(/p=[\d.]+/, ''); if (!seen.has(k)) { seen.add(k); add(where, o); } });
  if (SHOTS && (vp.w === 1440 || vp.w === 390)) {
    await page.evaluate(() => { const c = AQ.app.clock; c.seek(Math.floor(c.beats.length / 2)); c.elapsed = c.durationOf(c.index) * 0.6; c.onFrame(); document.getElementById('cmdInspect').click(); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${sc.name}-${vp.w}-${lang}.png` });
  }
  await page.close();
  process.stdout.write('.');
}
await browser.close();
console.log('\n');
problems.forEach(p => console.log('  ✗ ' + p));
console.log('\n' + (problems.length ? '✗ ' + problems.length + ' 件' : '✓ 総点検で問題は見つからなかった'));
process.exit(problems.length ? 1 : 0);
