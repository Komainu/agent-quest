/* tools/shot-diorama.mjs — 「読ませる」要素を画面から外す（2026-09-28）
   使い方: node tools/shot-diorama.mjs

   ★ 指摘
     ・画面下の巨大なテロップ枠を丸ごと撤廃し、エージェントの頭上に
       小さな進捗ゲージとアイテムの絵を浮かべるだけにする
     ・再生コントローラーを記号（⏸ ⏭ ⏮）だけにする
     ・右パネルの①②③④を点灯するランプにする
     ・左上の「失敗」は警告の印に、「x402ってなに？」も記号に

   ★ ただし守ること
     ・支払いのあるログ（x402 の入門）ではテロップ枠を残す。そこに出る
       x402 の①〜⑤の道すじは、このアプリの目的そのもので、絵だけでは
       伝わらない。
     ・ボタンの言葉は捨てずに title / aria-label に移す（読み上げで読める）。
     ・合格の✓は「判定が合格だったとき」だけ。納品（まだ判定前）に✓を
       出すと、合格したように見える（前回の記号統一で入った誤りの修正）。

   ★ 見るもの（絵を目で見ない）
     描画側が数えた「頭上の状態表示（lastBadges）」「描いた合否の印
     （lastMarks）」と、DOM の表示状態・aria-label。
*/
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 8; i++) {
    const id = 'dio' + i;
    MSGS.push({ seq: s++, from: 'did:key:zPost',  text: `JOB v1 | ${id} | build | Job ${i} | d`, ts: iso(t += 700) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `CLAIM v1 | ${id} | builder`,            ts: iso(t += 700) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `DELIVER v1 | ${id} | done`,             ts: iso(t += 700) });
    MSGS.push({ seq: s++, from: 'did:key:zJudge',
                text: `ATTEST v1 | ${id} | ${i % 2 ? 'useful | ok' : 'not | thin'}`,              ts: iso(t += 700) });
  }
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

/* ---------- 1) 掲示板のログ：テロップ枠は無く、頭上に状態が出る ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate((m) => {
    AQ.adapters.kibbleForget('dio');
    AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'dio', observedAt: Date.now() }));
    /* 2026-09-28: 読み込み直後の一覧はエージェントになった。この検査は
       依頼の一覧の中身を見るので、依頼の一覧に切り替えてから見る。 */
    AQ.app.setListMode('jobs');
  }, MSGS);
  await page.waitForTimeout(500);

  let winShown = 0, rawShown = 0, badges = {}, frames = 0;
  let tickOnDelivery = 0, gaugeMoved = new Set();
  const jobs = await page.evaluate(() => AQ.app.jobIndex.list.map(r => r.id));
  for (const id of jobs.slice(0, 3)) {
    await page.evaluate((j) => { AQ.app.focusOnJob(j); AQ.app.clock.speed = 4; }, id);
    for (let f = 0; f < 70; f++) {   // 2026-10-04: 始動が 1.3→1.8 秒になったぶん長めに見る
      await page.waitForTimeout(110);
      const r = await page.evaluate(() => {
        const win = document.querySelector('.win'), raw = document.getElementById('raw');
        const vis = (e) => !!(e && !e.hidden && e.getBoundingClientRect().height > 0);
        const b = AQ.app.clock.beats[AQ.app.clock.index] || {};
        const m = (b.lead && b.lead.meta) || {};
        return {
          win: vis(win), raw: vis(raw),
          badges: (AQ.room && AQ.room.lastBadges) ? AQ.room.lastBadges() : null,
          marks: (AQ.room && AQ.room.lastMarks) ? AQ.room.lastMarks() : [],
          kind: b.kind, verdict: m.verdict || null, job: m.job || null
        };
      });
      if (r.badges === null) { fail('頭上の状態表示の覗き穴（lastBadges）が取れない＝この検査は何も見ていない'); f = 999; break; }
      frames++;
      if (r.win) winShown++;
      if (r.raw) rawShown++;
      for (const bd of r.badges) {
        badges[bd.kind] = (badges[bd.kind] || 0) + 1;
        gaugeMoved.add(Math.round(bd.p * 10));
      }
      /* 納品（receive・判定なし）のコマで、合格の✓が描かれていないか */
      if (r.kind === 'receive' && !r.verdict && r.marks.some(mk => mk.ok && mk.color === '#1a7a4a')) {
        tickOnDelivery++;
      }
    }
  }
  if (winShown) fail(`掲示板のログなのにテロップ枠が ${winShown} フレーム出ている`);
  if (rawShown) fail(`掲示板のログなのに生ログの行が ${rawShown} フレーム出ている`);
  for (const k of ['board', 'dropoff', 'inspect']) {
    if (!badges[k]) fail(`頭上の状態表示に「${k}」の絵が1度も出ていない`);
  }
  if (gaugeMoved.size < 3) fail(`頭上のゲージが動いていない（出た値 ${Array.from(gaugeMoved).join(',')}）`);
  if (tickOnDelivery) fail(`判定前の納品のコマで合格の✓が ${tickOnDelivery} 回描かれた（合格したように見える）`);
  ok(`掲示板: ${frames}フレーム / テロップ ${winShown} / 頭上 ` +
     Object.keys(badges).sort().map(k => `${k}=${badges[k]}`).join(' ') +
     ` / ゲージの段階 ${gaugeMoved.size} / 納品に✓ ${tickOnDelivery}`);

  /* ---------- 2) 操作ボタンは記号、言葉は aria-label に ---------- */
  const btn = await page.evaluate(() => {
    const ids = ['play', 'step', 'restart', 'detail', 'connect', 'catchup', 'modeJobs', 'modeAgents', 'focusAll2'];
    return ids.map(id => {
      const e = document.getElementById(id);
      if (!e) return { id, missing: true };
      return { id, text: e.textContent.trim(), aria: e.getAttribute('aria-label') || '',
               title: e.title || '' };
    });
  });
  const LETTERS = /[぀-ヿ一-鿿A-Za-z]{2,}/;   // かな・漢字・英単語
  for (const b of btn) {
    if (b.missing) { fail(`ボタン #${b.id} が見つからない`); continue; }
    if (LETTERS.test(b.text)) fail(`ボタン #${b.id} に文字が残っている: "${b.text}"`);
    if (!b.aria || !LETTERS.test(b.aria)) fail(`ボタン #${b.id} の言葉（aria-label）が失われている: "${b.aria}"`);
  }
  ok('ボタン: ' + btn.map(b => `${b.id}="${b.text}"`).join(' '));

  /* ---------- 3) ランプ・失敗・x402 ---------- */
  const misc = await page.evaluate(() => {
    const lamps = document.querySelectorAll('.roster-chips .jdots.lamps .jd.lamp');
    const lit = document.querySelectorAll('.roster-chips .jdots.lamps .jd.lamp.has');
    const circled = /[①②③④]/.test((document.querySelector('.roster-chips') || {}).textContent || '');
    return {
      lamps: lamps.length, lit: lit.length, circled,
      failed: (document.getElementById('retries') || {}).textContent || '',
      failedStamp: !!document.querySelector('#retries svg.stamp'),
      intro: (document.getElementById('introBtn') || {}).textContent || '',
      introAria: (document.getElementById('introBtn') || {}).getAttribute('aria-label') || '',
      hint: (document.getElementById('hint') || {}).textContent || ''
    };
  });
  if (!misc.lamps) fail('右の一覧にランプが1つも無い');
  if (!misc.lit)   fail('点いているランプが1つも無い（記録のある段階が点いていない）');
  if (misc.circled) fail('右の一覧に丸数字（①②③④）が残っている');
  if (/失敗|failed/.test(misc.failed)) fail(`左上の失敗の件数に語が残っている: "${misc.failed}"`);
  /* 2026-09-28: 「✗ 50」は「×50（50倍）」とも読めるので、札のスタンプと同じ
     形の絵（svg.stamp）＋数字にした。 */
  if (!misc.failedStamp || !/\d/.test(misc.failed)) {
    fail(`左上の失敗が「スタンプの絵＋数字」になっていない: stamp=${misc.failedStamp} "${misc.failed}"`);
  }
  if (/ってなに|What is/.test(misc.intro)) fail(`x402 のボタンに文が残っている: "${misc.intro}"`);
  if (!/x402/.test(misc.intro)) fail(`x402 のボタンから「x402」の語まで消えている: "${misc.intro}"`);
  if (!/x402/.test(misc.introAria)) fail(`x402 のボタンの言葉（aria-label）が失われている`);
  if (misc.hint.trim()) fail(`画面下に操作の説明文が残っている: "${misc.hint}"`);
  ok(`ランプ ${misc.lit}/${misc.lamps} 点灯 / 失敗="${misc.failed}" / x402="${misc.intro}"`);
  await page.close();
}

/* ---------- 4) x402 の入門ではテロップ枠を残す ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate(() => AQ.app.startIntro());
  await page.waitForTimeout(700);
  const n = await page.evaluate(() => AQ.app.clock.beats.length);
  let winShown = 0, bar = 0, fake = 0;
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate((k) => {
      AQ.app.clock.pause(); AQ.app.clock.seek(k);
      const w = document.querySelector('.win');
      const h = document.getElementById('hint');
      return {
        win: !!(w && !w.hidden && w.getBoundingClientRect().height > 0),
        bar: document.querySelectorAll('.win .progress.x402').length,
        fake: !!(h && !h.hidden && h.textContent.trim())
      };
    }, i);
    if (r.win) winShown++;
    bar += r.bar;
    if (r.fake) fake++;
  }
  if (!winShown) fail('x402 の入門でテロップ枠まで消えている（①〜⑤の道すじが見えない）');
  if (!bar) fail('x402 の入門で①〜⑤の帯が出ていない');
  if (fake !== n) fail(`入門の「これは作り話です」が出ていないコマがある（${fake}/${n}）`);
  ok(`x402の入門: テロップ ${winShown}/${n} コマ / ①〜⑤の帯 ${bar} / 作り話の断り ${fake}/${n}`);
  await page.close();
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
