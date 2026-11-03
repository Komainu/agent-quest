/* tools/shot-plain.mjs — 「説明文を減らして、形でわかるようにする」段階1
   （2026-09-27）。使い方: node tools/shot-plain.mjs

   ★ 利用者の指摘
     ①「詳細項目はどこにあるのですか？」
        → 実況が「詳しくは『詳細』」と案内しているのに、その入口は画面
          いちばん下の折りたたみの中にあった。引用文の右に常設し、
          折りたたみを開かなくても押せること・押せば開くことを見る。
     ②「こまごまとした説明を、直感でわかるデザインに」
        → 支払いが1件も無いログで USDC・CREDITS を出さない
          （意味の無い語を3つ並べない）。
        → 名簿の行に ▶ を置き、「クリックすると再生します」という
          案内文を見出しから落とす。

   ★ 事実は消さない。件数（依頼 n 件／エージェント n 体）と失敗件数は
     残っていることを同時に確かめる（説明文だけを消す、が方針）。 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* 支払いが1件も無い、ふつうの kibble の部屋。失敗（not）も混ぜる。 */
const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 10; i++) {
    const id = 'kPl' + i;
    MSGS.push({ seq: s++, from: 'did:key:zPost',  text: `JOB v1 | ${id} | build | Job ${i} about the pier | d`, ts: iso(t += 1000) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 1000) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `DELIVER v1 | ${id} | done`,  ts: iso(t += 1000) });
    MSGS.push({ seq: s++, from: 'did:key:zJudge',
                text: `ATTEST v1 | ${id} | ${i % 3 === 0 ? 'not | thin' : 'useful | ok'}`, ts: iso(t += 1000) });
  }
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

/* ---------- 1) 支払いの無いログ ---------- */
for (const vp of [{ width: 1860, height: 880 }, { width: 1280, height: 800 }]) {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate((m) => {
    AQ.adapters.kibbleForget('pl');
    AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'pl', observedAt: Date.now() }));
    AQ.app.focusOnJob(AQ.app.jobIndex.list[0].id);
  }, MSGS);
  await page.waitForTimeout(900);

  const r = await page.evaluate(() => {
    const vis = (id) => {
      const e = document.getElementById(id);
      if (!e) return null;
      const rc = e.getBoundingClientRect();
      return !e.hidden && rc.width > 0 && rc.height > 0;
    };
    const det = document.getElementById('detail');
    const dr  = det ? det.getBoundingClientRect() : null;
    const adv = document.querySelector('details.advanced');
    const rows = Array.from(document.querySelectorAll('.roster-chips .jrow:not(.more)'));
    return {
      usdc: vis('hud-usdc'), credits: vis('hud-credits'), retries: vis('hud-retries'),
      retriesLbl: vis('retries-lbl'),
      retriesTxt: (document.getElementById('retries') || {}).textContent || '',
      advOpen: !!(adv && adv.open),
      detVis: !!(det && !det.hidden && dr.width > 0 && dr.height > 0),
      detText: det ? det.textContent.trim() : '',
      detInAdv: !!(det && adv && adv.contains(det)),
      rows: rows.length,
      rowsWithMark: rows.filter(x => x.querySelector('.gomark')).length,
      head: (document.getElementById('roster-head') || {}).textContent || '',
      over: document.documentElement.scrollHeight - window.innerHeight,
      canvas: Math.round(document.getElementById('scene').getBoundingClientRect().height)
    };
  });

  if (r.usdc)    fail(`${vp.width}: 支払いの無いログで USDC が出ている`);
  if (r.credits) fail(`${vp.width}: 支払いの無いログで CREDITS が出ている`);
  if (r.retriesLbl) fail(`${vp.width}: 上限の宣言が無いのに RETRIES の語が出ている`);
  if (!r.retries) fail(`${vp.width}: 失敗があるのに失敗の件数まで消えている（事実を消してはいけない）`);
  if (!/\d/.test(r.retriesTxt)) fail(`${vp.width}: 失敗の件数が数字で出ていない: "${r.retriesTxt}"`);

  if (r.advOpen)   fail(`${vp.width}: 「詳しい設定」が最初から開いている（前提が崩れている）`);
  if (r.detInAdv)  fail(`${vp.width}: 「詳細」がまだ折りたたみの中にある`);
  if (!r.detVis)   fail(`${vp.width}: 折りたたみを開かずに「詳細」が見えない`);
  if (!r.detText)  fail(`${vp.width}: 「詳細」ボタンに文字が入っていない`);

  if (!r.rows)                    fail(`${vp.width}: 名簿の行が1つも無い`);
  if (r.rowsWithMark !== r.rows)  fail(`${vp.width}: ▶ の無い行がある（${r.rows - r.rowsWithMark}/${r.rows}）`);
  if (/クリック|[Cc]lick/.test(r.head)) fail(`${vp.width}: 見出しに「クリックすると」の説明が残っている: "${r.head}"`);
  if (!/\d/.test(r.head))         fail(`${vp.width}: 見出しから件数（事実）まで消えている: "${r.head}"`);

  if (r.over > 0) fail(`${vp.width}: 画面からはみ出している（${r.over}px）`);

  ok(`${vp.width}x${vp.height}: USDC=${r.usdc} CREDITS=${r.credits} 失敗欄="${r.retriesTxt}" ` +
     `詳細="${r.detText}"(見える:${r.detVis}) ▶ ${r.rowsWithMark}/${r.rows} ` +
     `見出し="${r.head}" 盤面 ${r.canvas}px はみ出し ${r.over}px`);

  /* 押したら本当に開くか（実クリック） */
  await page.click('#detail');
  const opened = await page.evaluate(() => {
    const p = document.getElementById('detailPanel');
    return !!(p && !p.hidden && p.getBoundingClientRect().height > 0 &&
              (document.getElementById('detailBody') || {}).textContent.trim().length > 0);
  });
  if (!opened) fail(`${vp.width}: 「詳細」を押しても中身のあるパネルが開かない`);
  await page.close();
}

/* ---------- 2) 支払いのあるログ（x402 の導入）では出る ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate(() => AQ.app.startIntro());
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const vis = (id) => {
      const e = document.getElementById(id);
      const rc = e.getBoundingClientRect();
      return !e.hidden && rc.width > 0 && rc.height > 0;
    };
    return { usdc: vis('hud-usdc'), credits: vis('hud-credits'),
             usdcTxt: document.getElementById('usdc').textContent };
  });
  if (!r.usdc) fail('支払いのあるログなのに USDC が消えている（隠しすぎ）');
  ok(`x402の導入: USDC=${r.usdc}("${r.usdcTxt}") CREDITS=${r.credits}`);
  await page.close();
}

/* ---------- 3) 案内文そのものが辞書から消えているか ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.i18n);
  const r = await page.evaluate(() => {
    const keys = ['jobs.head', 'agents.head', 'agents.jobsHead', 'jobs.note', 'roster.note'];
    const out = {};
    for (const lang of ['ja', 'en']) {
      AQ.i18n.set(lang);
      out[lang] = keys.map(k => [k, AQ.i18n.t(k)]);
    }
    AQ.i18n.set('ja');
    return out;
  });
  for (const lang of ['ja', 'en']) {
    for (const [k, v] of r[lang]) {
      if (/クリックすると、?その|[Cc]lick a row|click one to/.test(v)) {
        fail(`[${lang}] ${k} に「クリックすると…」の案内が残っている`);
      }
    }
  }
  ok('案内文の削除を辞書で確認（ja/en）');
  await page.close();
}


/* ---------- 4) 実況から①〜④の帯と読み方メモが消えているか ----------
   2026-09-27 の指示「①②③④と説明も削除」「右に余計な説明も削除」
   「極力文字は使わない」。どのコマでも、どちらの入り方でも、
   帯と右のメモが1つも出ないこと。事実（件数）は足もとに残ること。 */
for (const mode of ['job', 'agent']) {
  const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate(({ m, mo }) => {
    AQ.adapters.kibbleForget('q');
    AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'q', observedAt: Date.now() }));
    if (mo === 'agent') { AQ.app.setListMode('agents'); AQ.app.focusOnAgent('did:key:zWork'); }
    else { AQ.app.focusOnJob(AQ.app.jobIndex.list[0].id); }
  }, { m: MSGS, mo: mode });
  await page.waitForTimeout(900);

  const n = await page.evaluate(() => AQ.app.clock.beats.length);
  let bars = 0, notes = 0, winMax = 0, overMax = 0, canvas = 0, foot = '', glyph = 0;
  let footTitle = '', footCard = false;
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate((k) => {
      AQ.app.clock.pause(); AQ.app.clock.seek(k);
      const win = document.querySelector('.win');
      const sn = document.getElementById('sideNote');
      const fs = document.getElementById('focus-stat');
      return {
        bar:  document.querySelectorAll('.win .progress').length,
        note: (sn && !sn.hidden && sn.textContent.trim()) ? 1 : 0,
        /* 実況の文に①〜④の丸数字が残っていないか（帯を消しても
           文言のどこかに紛れていたら「消した」ことにならない） */
        glyph: /[①②③④]/.test(win.textContent) ? 1 : 0,
        win: Math.round(win.getBoundingClientRect().height),
        canvas: Math.round(document.getElementById('scene').getBoundingClientRect().height),
        over: document.documentElement.scrollHeight - window.innerHeight,
        foot: (fs && !fs.hidden) ? fs.textContent.trim() : '',
        footTitle: (fs && !fs.hidden && fs.querySelector('.statcard'))
          ? fs.querySelector('.statcard').getAttribute('title') || '' : '',
        footCard: !!(fs && !fs.hidden && fs.querySelector('.statcard .stat')),
        hint: (document.getElementById('hint') || {}).textContent || ''
      };
    }, i);
    bars += r.bar; notes += r.note; glyph += r.glyph;
    /* 画面の下に長い「見かた」の段落を戻していないか（絵が自分で
       名乗っている以上、文章で二度言う必要はない、という判断） */
    if (r.hint.length > 40) fail(`${mode} コマ${i}: 画面下の説明が長すぎる（${r.hint.length}字）: "${r.hint.slice(0, 30)}…"`);
    winMax = Math.max(winMax, r.win); overMax = Math.max(overMax, r.over);
    canvas = r.canvas; if (r.foot) { foot = r.foot; footTitle = r.footTitle; footCard = r.footCard; }
  }
  if (bars)  fail(`${mode}: 実況に①〜④の帯が ${bars} 回出ている`);
  if (notes) fail(`${mode}: 右の読み方メモが ${notes} 回出ている`);
  if (glyph) fail(`${mode}: 実況の文に丸数字（①〜④）が ${glyph} 回残っている`);
  if (overMax > 0) fail(`${mode}: 画面からはみ出している（${overMax}px）`);
  /* 事実は消さない：まとめのときは件数が足もとに残っていること */
  if (mode === 'agent') {
    if (!/\d/.test(foot))            fail(`まとめの件数（事実）まで消えている: "${foot}"`);
    /* 2026-09-28: まとめは RPG のステータス欄の形（顔＋羊皮紙×数＋羽ペン×数）に
       した。「時系列の再生ではなくまとめだ」は欄の形が言い、文はマウスを
       乗せると出る（title）。その title に断りが入っていることを見る。 */
    if (!footCard) fail(`まとめがステータス欄の形（.statcard .stat）になっていない: "${foot}"`);
    if (!/まとめ|summary/.test(footTitle)) fail(`「まとめ」の断りが title からも消えている（時系列の再生と誤解させる）: "${footTitle}"`);
    if (/[①②③④]/.test(foot))       fail(`足もとの行に①〜④が残っている: "${foot}"`);
  }
  ok(`${mode}: 帯 ${bars} 回 / メモ ${notes} 回 / 丸数字 ${glyph} 回 / ` +
     `実況 ${winMax}px 盤面 ${canvas}px はみ出し ${overMax}px / 足もと="${foot}"`);
  await page.close();
}

/* ---------- 5) x402 の帯と「なぜ」は消していない ----------
   このアプリの目的そのものなので、簡素化のついでに道連れにしていない
   ことを必ず確かめる（支払いのあるログでだけ出る）。 */
{
  const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate(() => AQ.app.startIntro());
  await page.waitForTimeout(600);
  const n = await page.evaluate(() => AQ.app.clock.beats.length);
  let bar = 0, why = 0;
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate((k) => {
      AQ.app.clock.pause(); AQ.app.clock.seek(k);
      const sn = document.getElementById('sideNote');
      return {
        bar: document.querySelectorAll('.win .progress.x402').length,
        why: (sn && !sn.hidden && sn.textContent.trim().length > 10) ? 1 : 0
      };
    }, i);
    bar += r.bar; why += r.why;
  }
  if (!bar) fail('x402 の①〜⑤の帯まで消えている（このアプリの目的そのもの）');
  if (!why) fail('x402 の「なぜ」の説明まで消えている');
  ok(`x402の導入: ①〜⑤の帯 ${bar} コマ / 「なぜ」 ${why} コマ`);
  await page.close();
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
