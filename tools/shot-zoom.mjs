/* tools/shot-zoom.mjs — 主役の大きさを守る（2026-09-28）
   使い方: node tools/shot-zoom.mjs

   ★ 指摘
     「背景の壁面エリアに対してキャラクターと作業台の占める割合が小さい」
     「あまり変わっていませんね。魅力的ですっきりしたデザインにすべき」

   ★ やったこと
     canvas の見かけの大きさは縦の予算で頭打ちになっていて、これ以上
     大きくできない。そこで映すマス数のほうを減らした（20列×8行 →
     17列×7行）。同じ画面幅を少ないマスで分けるので、ロボットも札も
     家具も大きく映る。あわせてページの最大幅を広げ、左右に捨てていた
     余白を盤面に回した。

   ★ この検査が守るもの
     画面に映るロボットの高さ（CSS ピクセル）。あとから列を増やしたり
     ページ幅を戻したりすると、絵は黙って小さくなって元に戻る。
     数字で下限を打っておく。はみ出しゼロも同時に見る（大きくする方向の
     変更は、油断すると画面からあふれる）。
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
  for (let i = 0; i < 10; i++) {
    const id = 'z' + i;
    MSGS.push({ seq: s++, from: 'did:key:zPost',  text: `JOB v1 | ${id} | build | Job ${i} | d`, ts: iso(t += 600) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `CLAIM v1 | ${id} | builder`,            ts: iso(t += 600) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `DELIVER v1 | ${id} | done`,             ts: iso(t += 600) });
    MSGS.push({ seq: s++, from: 'did:key:zJudge', text: `ATTEST v1 | ${id} | useful | ok`,       ts: iso(t += 600) });
  }
}

/* 実測値（2026-09-28(2)・15列×7行・テロップ枠撤廃後）:
     1860x880=183.9px / 1440x900=160.5px / 1280x800=137.4px。
   下限はそこから 1 割ほど下に置く。ここを割ったら「絵が小さくなった」。
   変更前（20列×8行・ページ幅1320px）の実測は 111.6 / 114.6 / 100.3、
   1回目の寄せ（17列×7行）は 148 / 141.6 / 118 なので、どちらに戻しても落ちる。 */
/* ★ 2026-10-07: 利用者の希望で右の列（仕事・エージェント・部屋の一覧）を広げ、
   見出しが増える場面のぶんの余白も少し増やした。1860×880 は縦で頭打ちになる
   画面で、その余白のぶん（約1.4%）だけ小さくなる。下限もそのぶんだけ下げる。 */
const MIN_SPRITE = { '1860x880': 160, '1440x900': 145, '1280x800': 124 };

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

for (const vp of [{ width: 1860, height: 880 }, { width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  const key = vp.width + 'x' + vp.height;
  for (const mode of ['job', 'agent']) {
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
    await page.goto(FILE);
    await page.waitForFunction(() => window.AQ && window.AQ.app);
    await page.evaluate(({ m, mo }) => {
      AQ.adapters.kibbleForget('z');
      AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'z', observedAt: Date.now() }));
      if (mo === 'agent') { AQ.app.setListMode('agents'); AQ.app.focusOnAgent('did:key:zWork'); }
      else { AQ.app.focusOnJob(AQ.app.jobIndex.list[0].id); }
    }, { m: MSGS, mo: mode });
    await page.waitForTimeout(900);

    const n = await page.evaluate(() => AQ.app.clock.beats.length);
    let worstOver = -9999, r0 = null;
    for (let i = 0; i < n; i++) {
      const r = await page.evaluate((k) => {
        AQ.app.clock.pause(); AQ.app.clock.seek(k);
        const c = document.getElementById('scene').getBoundingClientRect();
        const v = AQ.roomWorld.view, t = AQ.roomWorld.tile;
        const fp = (AQ.room && AQ.room.spriteFootprint) ? AQ.room.spriteFootprint() : null;
        const scale = c.width / (v.cols * t);
        return {
          stage: document.getElementById('scene').dataset.stage,
          w: Math.round(c.width), h: Math.round(c.height),
          cols: v.cols, rows: v.rows,
          sprite: fp ? +(fp.h * scale).toFixed(1) : null,
          over: Math.round(window.innerHeight -
                document.querySelector('.controls').getBoundingClientRect().bottom)
        };
      }, i);
      if (r0 === null) r0 = r;
      if (-r.over > worstOver) worstOver = -r.over;
      if (r.sprite === null) { fail(`${key} ${mode}: spriteFootprint の覗き穴が取れない＝この検査は何も見ていない`); break; }
    }
    if (!r0) { fail(`${key} ${mode}: 1コマも測れなかった`); await page.close(); continue; }
    if (r0.stage !== 'room') fail(`${key} ${mode}: 部屋の絵になっていない（stage=${r0.stage}）`);
    const min = MIN_SPRITE[key];
    if (r0.sprite < min) {
      fail(`${key} ${mode}: 画面に映るロボットが ${r0.sprite}px しかない（下限 ${min}px）＝絵が小さくなった`);
    }
    if (worstOver > 0) fail(`${key} ${mode}: 画面から ${worstOver}px はみ出している`);
    console.log(`  ${key} ${mode}: 盤面 ${r0.w}x${r0.h} / ${r0.cols}列${r0.rows}行 / ` +
                `ロボット ${r0.sprite}px（下限 ${min}）/ 余白 ${-worstOver}px`);
    await page.close();
  }
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
