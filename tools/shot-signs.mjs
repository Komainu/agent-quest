/* tools/shot-signs.mjs — 合否の見せ方をそろえる／数字の重複をなくす
   （2026-09-27）。使い方: node tools/shot-signs.mjs

   ★ 指摘
     「OK」バッジ・検品台の✓✗・失敗カウンタの数字と、成功/失敗を示す
     記号が場所ごとに違う形式（テキスト・記号・数字）で混在している。
     色と形のルールを全画面でそろえてほしい。
     再生位置の数字が2か所にあって見分けがつかない。

   ★ この検査が見るもの（絵を目で見ない）
     room.js が「その1フレームで何という文字を描いたか（lastLabels）」と
     「合否の印をどの色で描いたか（lastMarks）」を数えている。
       ・合格のコマ  → 緑の✓が描かれ、「OK」という文字は描かれない
       ・不合格のコマ → 赤の✗が描かれ、「REJECTED」という文字は描かれない
       ・402 のような数字のステータスは文字のまま残る（事実なので消さない）
       ・失敗の件数は札の✗と同じ赤で出る
       ・HUD の数字と操作欄の数字が二重にならない
*/
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* 合格と不合格の両方が出る掲示板のログ */
const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 8; i++) {
    const id = 'sg' + i;
    MSGS.push({ seq: s++, from: 'did:key:zPost',  text: `JOB v1 | ${id} | build | Job ${i} | d`, ts: iso(t += 800) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `CLAIM v1 | ${id} | builder`,            ts: iso(t += 800) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `DELIVER v1 | ${id} | done`,             ts: iso(t += 800) });
    MSGS.push({ seq: s++, from: 'did:key:zJudge',
                text: `ATTEST v1 | ${id} | ${i % 2 ? 'useful | ok' : 'not | thin'}`,              ts: iso(t += 800) });
  }
}

const GREEN = '#1a7a4a', RED = '#c02b1c';
let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

/* ---------- 1) 掲示板：合否の印と、消えたはずの英単語 ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1820, height: 1000 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate((m) => {
    AQ.adapters.kibbleForget('sg');
    AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'sg', observedAt: Date.now() }));
  }, MSGS);
  await page.waitForTimeout(600);

  /* 吹き出しはロボットが歩き終わってから、しかも点滅して出る。
     コマを止めて覗くと取り逃がすので、依頼を1件ずつ実際に再生させて、
     その間ずっと「何を描いたか」を拾い続ける。 */
  let words = [], marks = { ok: 0, ng: 0 }, wrongColor = [];
  const jobs = await page.evaluate(() => AQ.app.jobIndex.list.map(r => r.id));
  for (const id of jobs.slice(0, 4)) {
    await page.evaluate((j) => {
      AQ.app.focusOnJob(j);
      /* 既定の再生速度では①〜④を通すのに20秒以上かかる。検査は
         速度を上げて通す（描くものは速度で変わらない）。 */
      AQ.app.clock.speed = 4;
    }, id);
    for (let f = 0; f < 60; f++) {
      await page.waitForTimeout(110);
      const r = await page.evaluate(() => ({
        labels: (AQ.room && AQ.room.lastLabels) ? AQ.room.lastLabels() : null,
        marks:  (AQ.room && AQ.room.lastMarks)  ? AQ.room.lastMarks()  : null
      }));
      if (r.labels === null || r.marks === null) {
        fail('描画側の覗き穴（lastLabels / lastMarks）が取れない＝この検査は何も見ていない');
        f = 999; break;
      }
      for (const w of r.labels) if (/^(OK|REJECTED|ERROR)$/.test(w.trim())) words.push(w.trim());
      for (const mk of r.marks) {
        if (mk.ok) marks.ok++; else marks.ng++;
        if (mk.ok && mk.color !== GREEN && mk.color !== '#3ddc84') wrongColor.push('ok:' + mk.color);
        if (!mk.ok && mk.color !== RED && mk.color !== '#ff6b57') wrongColor.push('ng:' + mk.color);
      }
    }
  }
  if (words.length) {
    fail(`合否が英単語のままのコマがある: ${Array.from(new Set(words)).join(', ')}`);
  }
  if (!marks.ok) fail('合格の✓が1度も描かれていない（印そのものが出ていない）');
  if (!marks.ng) fail('不合格の✗が1度も描かれていない（印そのものが出ていない）');
  if (wrongColor.length) {
    fail(`合否の色がそろっていない: ${Array.from(new Set(wrongColor)).join(', ')}`);
  }
  ok(`掲示板: ✓ ${marks.ok} 回 / ✗ ${marks.ng} 回 / 英単語 ${words.length} 回`);

  /* 失敗の件数は札の✗と同じ赤か */
  const hud = await page.evaluate(() => {
    const sp = document.getElementById('hud-retries');
    const b = document.getElementById('retries');
    return { cls: sp.className, txt: b.textContent,
             color: getComputedStyle(b).color, hidden: sp.hidden };
  });
  if (hud.hidden) fail('失敗の件数が出ていない（この検査の前提が崩れている）');
  if (!/rgb\(\s*2\d\d/.test(hud.color) || !/bad/.test(hud.cls)) {
    fail(`失敗の件数が赤になっていない: class="${hud.cls}" color=${hud.color}`);
  }
  ok(`失敗カウンタ: "${hud.txt}" class="${hud.cls}" color=${hud.color}`);

  /* 数字の重複 */
  const nums = await page.evaluate(() => ({
    showing: (document.getElementById('showing') || {}).textContent || '',
    beat: (document.getElementById('beat') || {}).textContent || ''
  }));
  const countNums = (s) => (s.match(/\d+/g) || []).length;
  if (/コマ|beats|step/.test(nums.showing)) {
    fail(`HUD 側にも「コマ」の数字が残っている: "${nums.showing}" ／ 操作欄: "${nums.beat}"`);
  }
  if (countNums(nums.showing) > 1) {
    fail(`HUD 側の数字が2つ以上ある（位置と件数が混ざる）: "${nums.showing}"`);
  }
  if (countNums(nums.beat) < 2) {
    fail(`再生バーのそばに「いま何コマ目／全部で何コマ」が出ていない: "${nums.beat}"`);
  }
  ok(`数字: HUD="${nums.showing}" 操作欄="${nums.beat}"`);
  await page.close();
}

/* ---------- 2) 数字のステータス（402 など）は文字のまま残す ----------
   合否は印に置き換えたが、HTTP の番号は事実そのもの。とくに 402 は
   このアプリが伝えたいことの中心なので、印にしてしまうと消えてしまう。
   支払いが無く・行き先が1つだけのログは部屋で描かれる（街ではない）ので、
   部屋の吹き出しに番号が出ることを、描いた文字そのもので確かめる。 */
{
  const page = await browser.newPage({ viewport: { width: 1820, height: 1000 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate(() => {
    var T = 1758100000000, U = 'https://api.one.example/x';
    AQ.app.loadEvents([
      { v:1, run:'r402', t:T,      actor:'scout', type:'run.start', target:U },
      { v:1, run:'r402', t:T+800,  actor:'scout', type:'tool.call', target:U },
      { v:1, run:'r402', t:T+1600, actor:'scout', type:'result.error', target:U, status:'402' },
      { v:1, run:'r402', t:T+2400, actor:'scout', type:'tool.call', target:U },
      { v:1, run:'r402', t:T+3200, actor:'scout', type:'result.error', target:U, status:'402' }
    ]);
    AQ.app.focusOnDid('scout');
    AQ.app.clock.speed = 4;
  });
  await page.waitForTimeout(600);
  const stage = await page.evaluate(() => document.getElementById('scene').dataset.stage);
  if (stage !== 'room') {
    fail(`この検査は部屋の絵を見る前提だが stage=${stage} になっている＝前提が崩れている`);
  }
  let saw = false, marksHere = 0;
  for (let f = 0; f < 70 && !saw; f++) {
    await page.waitForTimeout(110);
    const r = await page.evaluate(() => ({
      labels: (AQ.room && AQ.room.lastLabels) ? AQ.room.lastLabels() : [],
      marks:  (AQ.room && AQ.room.lastMarks)  ? AQ.room.lastMarks()  : []
    }));
    marksHere += r.marks.length;
    if (r.labels.some(w => w.trim() === '402')) saw = true;
  }
  if (!saw) {
    fail('402 という番号が絵の中に1度も描かれていない（印に置き換えて事実を消した）');
  }
  ok(`402: 絵の中に番号として出ている（この間に描かれた合否の印 ${marksHere} 個）`);
  await page.close();
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
