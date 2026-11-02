/* tools/shot-agentfirst.mjs — エージェント起点・文字をさらに絵へ（2026-09-28）
   使い方: node tools/shot-agentfirst.mjs

   ★ 指摘
     ・最初は依頼ではなくエージェントの名前から選べるように（エージェント目線）
     ・絵の中の名札（#6 トキ）は、マウスを乗せたときだけ
     ・「（仮）」は完全に外す
     ・まとめの文を RPG のステータス欄（顔＋📜×依頼数＋✒×書き込み数）に
     ・右の一覧の「作る」などの種類の文字、依頼の英文の題名を絵に
     ・LIVE の「最新に追いついています」「（累計 52 コマを飛ばして表示）」をランプに

   ★ ただし守ること（事実は消さない）
     ・呼び名がアプリの付けたものだという断りは、詳細パネルの先頭に必ず残す
     ・題名は捨てない：行の title（マウスを乗せる）と詳細で読める。題名が
       ログに無い依頼は、羊皮紙を灰色にして区別する
     ・飛ばしたコマ数は「»| 数字」として出し続ける（ランプだけにしない）

   ★ ついでに見つけて直した不具合
     一覧の「顔」の絵が、ずっと透明だった（絵の作り方が変わったのに、一覧の
     縮小画は古い関数を呼んだままだった）。名札をホバーだけにする以上、一覧の
     顔で見分けられることが前提になるので、顔が実際に描かれているかを
     ピクセルで確かめる。
*/
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

const KINDS = ['build', 'research', 'explain', 'review', 'weird-kind'];
const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 12; i++) {
    const id = 'af' + i;
    const w = 'did:key:zW' + (i % 4), j = 'did:key:zJ' + (i % 3), p = 'did:key:zP' + (i % 3);
    MSGS.push({ seq: s++, from: p, text: `JOB v1 | ${id} | ${KINDS[i % 5]} | Task number ${i} | d`, ts: iso(t += 800) });
    MSGS.push({ seq: s++, from: w, text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 800) });
    MSGS.push({ seq: s++, from: w, text: `DELIVER v1 | ${id} | done`,  ts: iso(t += 800) });
    MSGS.push({ seq: s++, from: j, text: `ATTEST v1 | ${id} | ${i % 3 ? 'useful | ok' : 'not | thin'}`, ts: iso(t += 800) });
  }
  /* 題名の無い依頼（JOB 行が取得範囲の外）を1件だけ混ぜる */
  MSGS.push({ seq: s++, from: 'did:key:zW0', text: 'CLAIM v1 | afNoTitle | builder', ts: iso(t += 800) });
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate((m) => {
  AQ.adapters.kibbleForget('af');
  AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'af', observedAt: Date.now() }));
}, MSGS);
await page.waitForTimeout(700);

/* ---------- 1) 最初はエージェントの一覧 ---------- */
{
  const r = await page.evaluate(() => ({
    mode: AQ.app.listMode,
    agentRows: document.querySelectorAll('.roster-chips .jrow.agentrow').length,
    jobRows: document.querySelectorAll('.roster-chips .jrow[data-job]').length,
    tabOn: (document.getElementById('modeAgents') || {}).className || '',
    playing: AQ.app.clock.playing
  }));
  if (r.mode !== 'agents') fail(`読み込み直後の一覧がエージェントになっていない（${r.mode}）`);
  if (!r.agentRows) fail('読み込み直後にエージェントの行が1つも無い');
  if (r.jobRows) fail(`読み込み直後に依頼の行が並んでいる（${r.jobRows}行）`);
  if (!/\bon\b/.test(r.tabOn)) fail('エージェントのタブが選ばれた見た目になっていない');
  if (r.playing) fail('まだ誰も選んでいないのに時計が進んでいる（ボタンが「停止」を示してしまう）');
  ok(`起点: 一覧=${r.mode} / エージェント ${r.agentRows} 行 / 依頼 ${r.jobRows} 行 / 再生中=${r.playing}`);
}

/* ---------- 2) 一覧の顔が本当に描かれているか（透明ではないか） ---------- */
{
  const faces = await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('.roster-chips .agentrow img.thumb'));
    const out = [];
    for (const im of imgs.slice(0, 5)) {
      await (im.decode ? im.decode().catch(() => {}) : Promise.resolve());
      const c = document.createElement('canvas');
      c.width = im.naturalWidth || 32; c.height = im.naturalHeight || 40;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) opaque++;
      out.push(opaque);
    }
    return { n: imgs.length, opaque: out };
  });
  if (!faces.n) fail('エージェントの行に顔の絵（img.thumb）が無い');
  const blank = faces.opaque.filter(v => v < 60).length;
  if (blank) fail(`顔の絵が透明のまま（塗られた点が少ない）: ${faces.opaque.join(', ')}`);
  ok(`顔: ${faces.n} 枚 / 塗られた点 ${faces.opaque.join(', ')}`);
}

/* ---------- 3) エージェントを選ぶ → ステータス欄 ---------- */
await page.evaluate(() => { AQ.app.focusOnAgent('did:key:zW0'); AQ.app.clock.speed = 4; });
await page.waitForTimeout(900);
{
  const r = await page.evaluate(() => {
    const card = document.querySelector('#focus-stat .statcard');
    const ent = AQ.app.agentIndex.byId['did:key:zW0'];
    const nums = card ? Array.from(card.querySelectorAll('.stat b')).map(b => b.textContent.trim()) : [];
    return {
      card: !!card, thumb: !!(card && card.querySelector('img.thumb')),
      stats: card ? card.querySelectorAll('.stat svg.ic').length : 0,
      nums, jobs: ent ? ent.jobs.length : -1,
      writes: AQ.app.agentStory ? AQ.app.agentStory.total : -1,
      title: card ? card.getAttribute('title') || '' : ''
    };
  });
  if (!r.card) fail('まとめがステータス欄（.statcard）になっていない');
  if (!r.thumb) fail('ステータス欄に顔が無い');
  if (r.stats !== 2) fail(`ステータス欄の絵（羊皮紙・羽ペン）が2つそろっていない（${r.stats}）`);
  if (r.nums[0] !== String(r.jobs)) fail(`ステータス欄の依頼数が事実と違う（${r.nums[0]} ≠ ${r.jobs}）`);
  if (r.nums[1] !== String(r.writes)) fail(`ステータス欄の書き込み数が事実と違う（${r.nums[1]} ≠ ${r.writes}）`);
  if (!/まとめ|summary/.test(r.title)) fail('「まとめ」の断りが title からも消えている');
  ok(`ステータス欄: 依頼 ${r.nums[0]}（事実 ${r.jobs}）/ 書き込み ${r.nums[1]}（事実 ${r.writes}）`);
}

/* ---------- 4) 依頼の行：種類は絵、題名は羊皮紙（題名はマウスで読める） ---------- */
await page.evaluate(() => AQ.app.setListMode('jobs'));
await page.waitForTimeout(400);
{
  const r = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.roster-chips .jrow[data-job]'));
    const words = ['作る', '調べる', '説明する', '評価する', 'build', 'research', 'explain', 'review'];
    const visible = rows.map(rw => rw.innerText).join(' ');
    const byId = {};
    rows.forEach(rw => { byId[rw.dataset.job] = rw; });
    const noTitle = byId['afNoTitle'];
    const titled = byId['af1'];
    return {
      rows: rows.length,
      chips: document.querySelectorAll('.roster-chips .kchip svg').length,
      scrolls: document.querySelectorAll('.roster-chips .jscroll svg').length,
      kindWord: words.filter(w => visible.indexOf(w) !== -1),
      titleVisible: /Task number/.test(visible),
      titledTitle: titled ? titled.getAttribute('title') || '' : '(行が無い)',
      noTitleGrey: noTitle ? !!noTitle.querySelector('.jscroll.none') : null,
      noTitleTitle: noTitle ? noTitle.getAttribute('title') || '' : ''
    };
  });
  if (!r.rows) fail('依頼の行が無い');
  if (!r.chips) fail('種類の絵（.kchip svg）が1つも無い');
  if (!r.scrolls) fail('題名の羊皮紙（.jscroll svg）が1つも無い');
  if (r.kindWord.length) fail(`種類の文字が行に残っている: ${r.kindWord.join(', ')}`);
  if (r.titleVisible) fail('依頼の英文の題名が行にそのまま出ている');
  if (!/Task number 1\b/.test(r.titledTitle)) fail(`題名が title からも消えている（捨ててしまった）: "${r.titledTitle}"`);
  if (r.noTitleGrey !== true) fail('題名の無い依頼の羊皮紙が灰色になっていない（区別がつかない）');
  if (!/afNoTitle/.test(r.noTitleTitle)) fail(`題名の無い依頼の title に ID が無い: "${r.noTitleTitle}"`);
  ok(`依頼の行: ${r.rows} 行 / 種類の絵 ${r.chips} / 羊皮紙 ${r.scrolls} / 題名なし=灰色 ${r.noTitleGrey}`);
}

/* ---------- 5) 札の上の種類は絵（文字ではない） ---------- */
await page.evaluate(() => { AQ.app.focusClear(); AQ.app.clock.seek(Math.floor(AQ.app.clock.beats.length * 0.9)); });
await page.waitForTimeout(700);
{
  let kinds = new Set(), cardWords = [];
  const WORDS = ['作', '調', '説', '評', 'BUILD', 'RSRCH', 'XPLN', 'REV'];
  for (let f = 0; f < 12; f++) {
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => ({
      k: (AQ.room && AQ.room.lastKindIcons) ? AQ.room.lastKindIcons() : null,
      l: (AQ.room && AQ.room.lastLabels) ? AQ.room.lastLabels() : []
    }));
    if (r.k === null) { fail('札の絵の覗き穴（lastKindIcons）が取れない＝この検査は何も見ていない'); break; }
    r.k.forEach(x => kinds.add(x));
    r.l.forEach(w => { if (WORDS.indexOf(w.trim()) !== -1) cardWords.push(w.trim()); });
  }
  if (kinds.size < 3) fail(`札の種類の絵が ${kinds.size} 種類しか出ていない（${Array.from(kinds).join(',')}）`);
  if (cardWords.length) fail(`札の上に種類の文字が残っている: ${Array.from(new Set(cardWords)).join(', ')}`);
  ok(`札の絵: ${Array.from(kinds).sort().join(', ')} / 文字 ${cardWords.length} 回`);
}

/* ---------- 6) 名札は動いている本人と、マウスを乗せたロボットだけ ---------- */
{
  const r0 = await page.evaluate(() => { AQ.room.setHover(null); return null; });
  await page.waitForTimeout(250);
  const none = await page.evaluate(() => AQ.room.lastTags().length);
  /* 実際に描いたロボットの本体の真ん中にマウスを置く */
  const target = await page.evaluate(() => {
    const b = AQ.app.clock.beats[AQ.app.clock.index];
    const list = AQ.room.computeRobotScreenPositions
      ? AQ.room.computeRobotScreenPositions(b, 1, AQ.app.clock.beats, AQ.app.clock.index, null) : [];
    const pl = (list.placed || list).find(x => x && x.spriteRect);
    if (!pl) return null;
    const sr = pl.spriteRect;
    return { x: sr.x + sr.w / 2, y: sr.y + sr.h / 2 };
  });
  let hovered = -1;
  if (target) {
    await page.evaluate((pt) => AQ.room.setHover(pt), target);
    await page.waitForTimeout(250);
    hovered = await page.evaluate(() => AQ.room.lastTags().length);
  }
  /* ★ 2026-10-09: いま動いている本人の名札だけは、はじめから出す（利用者の希望）。
     ほかの子の名札は、マウスを乗せたときだけ（何枚も並べない）。 */
  if (none > 1) fail(`マウスが乗っていないのに名札が ${none} 枚描かれている（出してよいのは動いている本人の1枚）`);
  if (target && hovered < 1) fail('ロボットにマウスを乗せても名札が出ない');
  if (target && hovered > 2) fail(`マウスを乗せたロボットと本人以外の名札まで出ている（${hovered} 枚）`);
  if (!target) fail('名札の検査に使うロボットの位置が取れない');
  ok(`名札: マウスなし ${none} 枚 / 乗せたとき ${hovered} 枚`);
}

/* ---------- 7) （仮）は画面から消え、詳細に断りが1回ある ---------- */
{
  await page.evaluate(() => AQ.app.focusOnAgent('did:key:zW0'));
  await page.waitForTimeout(400);
  const visible = await page.evaluate(() => document.body.innerText);
  if (/（仮）|\(nickname\)/.test(visible)) fail('画面のどこかに「（仮）」が残っている');
  await page.click('#detail');
  await page.waitForTimeout(300);
  const det = await page.evaluate(() => {
    const p = document.getElementById('detailPanel');
    const n = document.querySelectorAll('#detailBody .nicknote').length;
    return { open: !!(p && !p.hidden), n, text: (document.querySelector('#detailBody .nicknote') || {}).textContent || '' };
  });
  if (!det.open) fail('「詳細」が開かない');
  if (det.n !== 1) fail(`詳細パネルに呼び名の断りが ${det.n} 回（1回だけ必要）`);
  if (!/このアプリが付けた|this app assigned/.test(det.text)) fail(`呼び名の断りの中身がおかしい: "${det.text}"`);
  ok(`（仮）: 画面に無し / 詳細の断り ${det.n} 回`);
}

/* ---------- 8) LIVE はランプ、飛ばした数は »| 数字 ---------- */
{
  const r = await page.evaluate(() => {
    const lamp = document.getElementById('liveLamp');
    const off = lamp ? lamp.className : '(無い)';
    /* つないでいるふりをして1コマ描かせる（ランプが点くか） */
    AQ.live.running = true;
    AQ.app.clock.seek(0);
    AQ.app.clock.step();
    const on = lamp ? lamp.className : '';
    const onTitle = lamp ? lamp.title : '';
    const statusText = (document.getElementById('live-status') || {}).textContent || '';
    /* 最新まで飛ばす（飛ばした数が »| 数字 で残るか）。先頭に戻してから飛ばす。 */
    AQ.app.clock.seek(0);
    const skipped = AQ.app.jumpToLive();
    const skip = document.getElementById('live-skip');
    AQ.live.running = false;
    AQ.app.clock.step();
    return { off, on, onTitle, statusText, skipped,
             skipText: skip ? skip.textContent : '', skipTitle: skip ? skip.title : '',
             offAgain: lamp ? lamp.className : '' };
  });
  if (!/live-lamp/.test(r.off)) fail('LIVE のランプ（#liveLamp）が無い');
  if (!/\b(ok|behind)\b/.test(r.on)) fail(`つないでいるのにランプが点いていない（${r.on}）`);
  if (/追いついています|caught up|コマ遅れ|behind/.test(r.statusText)) {
    fail(`LIVE の状態が文のまま出ている: "${r.statusText}"`);
  }
  if (!r.onTitle) fail('ランプに状態の文（title）が無い');
  if (!(r.skipped > 0)) fail('最新まで飛ばす検査が空回りしている（飛ばしたコマが 0）');
  if (r.skipped > 0 && !/»\|\s*\d+/.test(r.skipText)) fail(`飛ばした数が「»| 数字」で出ていない: "${r.skipText}"`);
  if (r.skipped > 0 && !/\d/.test(r.skipTitle)) fail('飛ばした数の説明（title）が無い');
  if (!/\boff\b/.test(r.offAgain)) fail(`切ったのにランプが消えていない（${r.offAgain}）`);
  ok(`LIVE: 未接続=${r.off} / 接続=${r.on}（"${r.onTitle}"）/ 飛ばした ${r.skipped} → "${r.skipText}"`);
}

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
