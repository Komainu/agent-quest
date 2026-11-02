/* tools/shot-progress.mjs — 2026-09-07 の表示（①の在りか）を実際の
   ブラウザで描いて画像に残す。目視の代わりに、はみ出しも数で測る。
   使い方: node tools/shot-progress.mjs   （dist/agent-quest.html を先に build しておく）

   ★ 2026-09-27: ①〜④の帯を画面から外したのに合わせて、検査対象を
     「詳細」パネル（jobWhoBlock。#detailBody の .whoblock）へ移した。
     もとの「①は別のエージェントが出した（.progress .step.elsewhere +
     .progress-note）」という帯の見た目は、①の関係者が本人以外だと
     わかるという保証を、帯という1つの見せ方でやっていただけ。中身
     （①を出したのが誰か・捏造していないか）は詳細パネルにそのまま
     残っているので、実ブラウザで開かせて確かめる。あわせて一覧の丸
     （.jrow .jdots .jd.has）が「記録があるか」を正しく表しているかも
     見る（帯を外したあと、①〜④の事実が残る2か所のうちのもう1つ）。

   ★ 削除した検査（もとの2枚目のスクリーンショット「依頼の切り替わり」）:
     progressRow() が呼ばれなくなったことで、その中でしか使われて
     いなかった computeJobSwitch()（「別の依頼に切り替わりました」の
     判定）も呼び出し元が無くなり、丸ごと死んだコードになった
     （tools/check-progress-origin.js の冒頭コメントで確認済み）。
     詳細パネルは「その依頼の全記録」を出すだけで、直前に見ていた
     依頼が何だったかという考え方を持たないため、移し替え先も無い。
     よって「依頼の切り替わり」のスクリーンショットと検査は削除した。 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

const POSTER = 'did:key:z6MkPosterPosterPosterPosterPosterPoster';
const WORKER = 'did:key:z6MkWorkerWorkerWorkerWorkerWorkerWorker';
const t0 = 1758300000000;
const iso = (ms) => new Date(t0 + ms).toISOString();
const MSGS = [
  { seq: 1, from: POSTER, text: 'JOB v1 | kAlpha01 | review | Check the tide tables for the harbour | detail', ts: iso(0) },
  { seq: 2, from: POSTER, text: 'JOB v1 | kBeta01 | build | Build the west pier walkway | detail', ts: iso(1000) },
  { seq: 3, from: WORKER, text: 'CLAIM v1 | kAlpha01 | builder', ts: iso(40000) },
  { seq: 4, from: WORKER, text: 'DELIVER v1 | kAlpha01 | tide tables checked, see notes', ts: iso(80000) },
  { seq: 5, from: WORKER, text: 'CLAIM v1 | kBeta01 | builder', ts: iso(120000) },
  { seq: 6, from: WORKER, text: 'DELIVER v1 | kBeta01 | walkway done', ts: iso(160000) }
];

/* 画面サイズ × 言語。英語のほうが文が長いので、狭い画面での折り返しは
   英語でも確かめる（日本語だけで確かめて満足しない）。 */
const sizes = [[1920, 1080, 'ja'], [1440, 900, 'ja'], [1440, 900, 'en']];
let bad = 0;
const fail = (m) => { console.log('  ✗ ' + m); bad++; };
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

for (const [w, h, lang] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', e => { console.log('  ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate((lang) => { AQ.i18n.set(lang); if (AQ.hud.relabel) AQ.hud.relabel(); }, lang);

  await page.evaluate((msgs) => {
    AQ.adapters.kibbleForget('shot');
    AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'shot', observedAt: Date.now() }));
    /* 2026-09-28: 読み込み直後の一覧はエージェントになった。この検査は
       依頼の一覧の中身を見るので、依頼の一覧に切り替えてから見る。 */
    AQ.app.setListMode('jobs');
  }, MSGS);

  /* kAlpha01: ①は POSTER が出した。実際に引き受け・納品しているのは
     WORKER なので、この依頼を追うと「①は自分（WORKER）とは別の
     エージェントが出した」という、報告そのものの状況が再現できる。 */
  await page.evaluate(() => { AQ.app.focusOnJob('kAlpha01'); AQ.app.clock.pause(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('detailPanel').hidden = false; });
  await page.waitForTimeout(120);

  const info = await page.evaluate(() => {
    const rows = Array.prototype.map.call(
      document.querySelectorAll('#detailBody .whoblock .drow'), e => e.textContent.trim())
      .filter(s => /^[①②③④]/.test(s));
    const dots = Array.prototype.map.call(
      document.querySelectorAll('.roster-chips .jrow[data-job="kAlpha01"] .jdots .jd'),
      e => e.classList.contains('has'));
    const win = document.querySelector('.win');
    const panel = document.getElementById('detailPanel');
    return {
      rows: rows,
      dots: dots,
      unknownTxt: AQ.i18n.t('jobs.detailUnknown'),
      docOverflow: document.documentElement.scrollHeight - window.innerHeight,
      panelOverflow: panel ? panel.scrollHeight - panel.clientHeight : 0,
      panelVisible: !!(panel && !panel.hidden && panel.getBoundingClientRect().height > 0)
    };
  });

  const file = `/tmp/shot-${w}x${h}-${lang}-step1-detail.png`;
  await page.screenshot({ path: file });
  console.log(`\n${w}x${h} ${lang}`);
  console.log('  丸: ' + info.dots.map(x => x ? '●' : '○').join(''));
  console.log('  詳細: ' + info.rows.map(s => s.replace(/\s+/g, ' ').slice(0, 50)).join(' / '));
  console.log(`  page overflow=${info.docOverflow}px  panel overflow=${info.panelOverflow}px  → ${file}`);

  if (!info.panelVisible) fail('「詳細」パネルが開いて見えていない');
  if (info.rows.length !== 4) fail('①〜④の関係者の行が4つ揃っていない（' + info.rows.length + '）');
  if (info.rows[0]) {
    if (info.rows[0].indexOf(info.unknownTxt) !== -1) fail('①が分かっているのに「不明」になっている');
    if (!/#\d/.test(info.rows[0])) fail('①に#番号が出ていない');
  }
  if (info.rows[1] && !/#\d/.test(info.rows[1])) fail('②（WORKER）に#番号が出ていない');
  /* kAlpha01 には JOB・CLAIM・DELIVER はあるが ATTEST（④判定）は無い。 */
  if (info.dots.length !== 4) fail('①〜④の丸が4つ揃っていない（' + info.dots.length + '）');
  else {
    if (!info.dots[0]) fail('①の丸が「記録なし」になっている（JOB行はあるはず）');
    if (!info.dots[1]) fail('②の丸が「記録なし」になっている（CLAIM はあるはず）');
    if (!info.dots[2]) fail('③の丸が「記録なし」になっている（DELIVER はあるはず）');
    if (info.dots[3]) fail('④の丸が「記録あり」になっている（ATTEST は無いはず）');
  }
  if (info.docOverflow > 0) fail('画面からはみ出している（' + info.docOverflow + 'px）');
  if (info.panelOverflow > 4) fail('「詳細」パネルの中身がパネルからはみ出している（' + info.panelOverflow + 'px）');

  await page.close();
}
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
