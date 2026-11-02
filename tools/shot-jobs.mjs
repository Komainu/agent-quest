/* tools/shot-jobs.mjs — 「依頼1件を追う」画面を実ブラウザで描いて確かめる。
   使い方: node tools/shot-jobs.mjs   （dist/agent-quest.html を先に build）

   目で見て満足するためではなく、次を数で測るために撮る:
     ・JS エラーが1件も出ないこと
     ・依頼を選ぶと①から再生が始まること（①がログにある依頼の場合）
     ・盤面に出る札がその依頼の1枚だけになること
     ・「詳細」に、この依頼の関係者が①〜④とも正確に出ること
     ・1920×1080 / 1440×900 のどちらでも画面からはみ出さないこと

   ★ 2026-09-27: ①〜④の帯を画面から外したのに合わせて、検査対象を移した。

     ・「いま①〜④のどの段階か」は、帯（.progress .step.current）の
       代わりに再生中のコマそのもの（AQ.app.clock.beats[i] の種類・
       verdict）で確かめる。①のコマは JOB（agent.plan）、④のコマは
       ATTEST useful（result.ok）——これは帯の見た目ではなくコマの
       中身そのものなので、帯が無くても直接確かめられる。

     ・「④まで来たら①〜④すべてに #番号＋呼び名が付く」は、詳細パネル
       （jobWhoBlock。#detailBody .whoblock）で確かめる。もっとも、
       詳細パネルは再生位置に関係なく常に「その依頼の全記録」を出す
       設計なので、①のコマの時点で確かめても同じ内容になる
       （他の詳細系検査が前提にしている挙動と同じ）。

   ★ 削除した検査:
     ・「①のコマでは②以降の『誰が』を出さない（この先の話を先に描かない）」
       ……①〜④の帯が「いま何コマ目か」に応じて表示を出し分けていた
       仕組みで、帯そのものが画面から無くなった以上、どのコマを再生中
       でも出し分ける相手が無い（詳細パネルは前述のとおり常に全部を
       出す設計）。移し替え先が無いので削除した。
     ・「依頼を追っているのに『切り替わりました』（.progress-switch）が
       出た」……computeJobSwitch() 自体が呼び出し元を失って死んだコード
       になっている（tools/check-progress-origin.js の冒頭コメントで
       確認済み）ので、常に真になるだけの検査は意味を持たない。削除した。
     ・「＋N（.pmore）がまだ画面に出ていない」…….pmore は2026-09-27より
       前に、すでにコード上どこにも無くなっていた（grep で確認済み）。
       帯の除去とは無関係に、とっくに死んでいた検査なので、ついでに
       削除した。 */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

const A = 'did:key:z6MkPosterPosterPosterPosterPosterPoster';
const B = 'did:key:z6MkWorkerWorkerWorkerWorkerWorkerWorker';
const C = 'did:key:z6MkJudgeJudgeJudgeJudgeJudgeJudgeJudge';
/* 同じ依頼を後から引き受ける「その他大勢」。利用者の画面では1件の依頼に
   6体が並んでいた（同じ動きのロボットが何体も出る＝読めない）。 */
const D2 = 'did:key:z6MkExtraOneExtraOneExtraOneExtraOne';
const D3 = 'did:key:z6MkExtraTwoExtraTwoExtraTwoExtraTwo';
const D4 = 'did:key:z6MkExtraSixExtraSixExtraSixExtraSix';
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* 2件の依頼を交互に進める＝1体を追うと入り乱れて見えた、まさにその形。
   さらに kAlpha01 は4体が引き受け・2体が納品する（＝代表だけ出す対象）。 */
const MSGS = [
  { seq: 1, from: A, text: 'JOB v1 | kAlpha01 | review | Check the tide tables for the harbour | detail', ts: iso(0) },
  { seq: 2, from: A, text: 'JOB v1 | kBeta01 | build | Build the west pier walkway | detail', ts: iso(1000) },
  { seq: 3, from: B, text: 'CLAIM v1 | kAlpha01 | builder', ts: iso(40000) },
  { seq: 4, from: D2, text: 'CLAIM v1 | kAlpha01 | builder', ts: iso(41000) },
  { seq: 5, from: D3, text: 'CLAIM v1 | kAlpha01 | builder', ts: iso(42000) },
  { seq: 6, from: D4, text: 'CLAIM v1 | kAlpha01 | builder', ts: iso(43000) },
  { seq: 7, from: B, text: 'CLAIM v1 | kBeta01 | builder', ts: iso(60000) },
  { seq: 8, from: B, text: 'DELIVER v1 | kAlpha01 | tide tables checked, see notes', ts: iso(90000) },
  { seq: 9, from: D2, text: 'DELIVER v1 | kAlpha01 | second opinion attached', ts: iso(91000) },
  { seq: 10, from: C, text: 'ATTEST v1 | kAlpha01 | useful | matches the harbour records', ts: iso(120000) },
  { seq: 11, from: B, text: 'DELIVER v1 | kBeta01 | walkway done', ts: iso(150000) }
];

const sizes = [[1920, 1080, 'ja'], [1440, 900, 'ja'], [1440, 900, 'en']];
let bad = 0;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const [w, h, lang] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', e => { console.log('  ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate((lang) => { AQ.i18n.set(lang); AQ.hud.relabel(); }, lang);
  await page.evaluate((msgs) => {
    AQ.adapters.kibbleForget('shot');
    AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'shot', observedAt: Date.now() }));
    /* 2026-09-28: 読み込み直後の一覧はエージェントになった。この検査は
       依頼の一覧の中身を見るので、依頼の一覧に切り替えてから見る。 */
    AQ.app.setListMode('jobs');
  }, MSGS);

  console.log(`\n=== ${w}x${h} ${lang} ===`);

  /* 1) 選ぶ前: 依頼の一覧が出ていて、ロボットも札も出ていない */
  const before = await page.evaluate(() => ({
    rows: document.querySelectorAll('.jrow[data-job]').length,
    chosen: AQ.app.hasChosen,
    head: (document.getElementById('roster-head') || {}).textContent || ''
  }));
  console.log(`  一覧の行 ${before.rows} / まだ選んでいない=${!before.chosen}`);
  console.log('  見出し: ' + before.head);
  if (before.rows !== 2) { console.log('  ✗ 依頼が2件出ていない'); bad++; }
  if (before.chosen)     { console.log('  ✗ 選ぶ前なのに再生対象がある'); bad++; }
  await page.screenshot({ path: `/tmp/jobs-${w}x${h}-${lang}-list.png` });

  /* 2) 1件目（判定まで揃っている kAlpha01 が先頭に来るはず）をクリック */
  const firstJob = await page.evaluate(() => {
    const row = document.querySelector('.jrow[data-job]');
    return row ? row.getAttribute('data-job') : null;
  });
  console.log('  一覧の先頭: ' + firstJob);
  if (firstJob !== 'kAlpha01') { console.log('  ✗ 段階が多い依頼が先頭に来ていない'); bad++; }
  await page.evaluate(() => { document.querySelector('.jrow[data-job]').click(); });
  await page.evaluate(() => AQ.app.clock.pause());
  await page.waitForTimeout(120);

  const first = await page.evaluate(() => {
    const win = document.querySelector('.win');
    const b = AQ.app.clock.beats[AQ.app.clock.index];
    const m = (b && b.lead && b.lead.meta) || {};
    /* ①〜④の関係者の行だけを、先頭の丸数字で選び出す（他の詳細系
       検査と選び方をそろえる。.whoblock には依頼ID・題名などの行も
       同じ .drow クラスで混ざっている）。 */
    const whoRows = Array.prototype.map.call(
      document.querySelectorAll('#detailBody .whoblock .drow'), e => e.textContent.trim())
      .filter(s => /^[①②③④]/.test(s));
    return {
      job: AQ.app.focusJob,
      beats: AQ.app.clock.beats.length,
      index: AQ.app.clock.index,
      /* ★ 2026-09-27: 「いま①か」は帯の文字ではなく、再生中のコマ
         そのものの種類で確かめる（① JOB＝agent.plan）。 */
      leadType: (b && b.lead && b.lead.type) || '',
      cast: (document.querySelector('.castline') || {}).textContent || '',
      whoRows: whoRows,
      castline: !!document.querySelector('.castline'),
      progressNote: !!document.querySelector('.progress-note'),
      /* 「行数」は innerText では測れない（①〜④が縦並びの span なので
         改行だらけに見える）。実況欄の直下のブロックの数＝画面で見たときの
         行の数として数える。 */
      lines: (win ? win.children.length : 0),
      winH: win ? Math.round(win.getBoundingClientRect().height) : 0,
      detail: document.querySelectorAll('#detailBody .devent').length,
      /* 2026-09-11: このアプリが付けた呼び名（仮）。名前そのものとして
         出していないか（必ず（仮）が付くか）と、正確なIDが詳細に
         出ているかを、両方ここで確かめる。 */
      subjNick: (document.querySelector('.win .subject .nick') || {}).textContent || '',
      /* 2026-09-13: 見出しから原文の題名を外したので、依頼の呼び名は
         .jobtitle そのものになった（旧 .job-nick は無い）。 */
      jobNick:  (document.querySelector('.win .headline .jobtitle') || {}).textContent || '',
      nickMark: AQ.i18n.t('nick.mark'),
      detailText: (document.getElementById('detailBody') || {}).textContent || '',
      text: win ? win.innerText.replace(/\n+/g, ' / ') : '',
      over: document.documentElement.scrollHeight - window.innerHeight
    };
  });
  console.log('  選んだ依頼: ' + first.job + ' / コマ数 ' + first.beats);
  console.log('  詳細（①〜④）: ' + first.whoRows.map(s => s.replace(/\s+/g, ' ').slice(0, 40)).join(' / '));
  console.log('  実況の行数: ' + first.lines + '（高さ ' + first.winH + 'px）   詳細に出ている件数: ' + first.detail);
  /* ①〜④の代表だけ＝どんなに大勢が同じことをしても4コマを超えない */
  if (first.beats > 4) { console.log('  ✗ 代表だけに間引けていない（' + first.beats + 'コマ）'); bad++; }
  /* 関係者ブロック（devent 1つぶん）が先頭に増えたので 8+1。 */
  if (first.detail !== 9) { console.log('  ✗ 詳細にこの依頼の全記録＋関係者が出ていない（' + first.detail + '）'); bad++; }
  /* 実況に出す行数は少ないほど読める、という方針の歯止め。 */
  if (first.lines > 6) { console.log('  ✗ 実況が6行を超えている（' + first.lines + '行）'); bad++; }
  if (first.castline) { console.log('  ✗ 面々の行がまだ別に出ている'); bad++; }
  if (first.progressNote) {
    console.log('  ✗ 外したはずの帯の注記（.progress-note）がまだ出ている'); bad++;
  }
  if (first.whoRows.length !== 4) {
    console.log('  ✗ 詳細の関係者（①〜④）が4行揃っていない（' + first.whoRows.length + '）'); bad++;
  }
  if (first.detailText.indexOf('#') === -1) {
    console.log('  ✗ 詳細に関係者（#番号）が出ていない'); bad++;
  }
  console.log('  呼び名: 主語=' + first.subjNick + ' / 依頼=' + first.jobNick);
  if (!first.subjNick) { console.log('  ✗ 主語に呼び名が出ていない'); bad++; }
  if (!first.jobNick)  { console.log('  ✗ 依頼に呼び名が出ていない'); bad++; }
  if (first.subjNick.indexOf(first.nickMark.trim()) === -1 ||
      first.jobNick.indexOf(first.nickMark.trim()) === -1) {
    console.log('  ✗ 呼び名に（仮）が付いていない＝本名のように見える'); bad++;
  }
  /* 呼び名だけ出して本物のIDを隠していないこと（詳細に必ず両方ある）。 */
  if (first.detailText.indexOf('kAlpha01') === -1) {
    console.log('  ✗ 詳細に本物の依頼IDが出ていない'); bad++;
  }
  if (first.detailText.indexOf('did:key:') === -1) {
    console.log('  ✗ 詳細に本物のDIDが出ていない'); bad++;
  }
  console.log('  はみ出し: ' + first.over + 'px');
  if (first.job !== 'kAlpha01') { console.log('  ✗ 選んだ依頼になっていない'); bad++; }
  if (first.index !== 0) { console.log('  ✗ 最初のコマから始まっていない'); bad++; }
  if (first.leadType !== 'agent.plan') { console.log('  ✗ ①（JOB）から始まっていない（種類: ' + first.leadType + '）'); bad++; }
  if (first.over > 0) { console.log('  ✗ 画面からはみ出している'); bad++; }
  await page.screenshot({ path: `/tmp/jobs-${w}x${h}-${lang}-step1.png` });

  /* 3) 最後のコマ（④判定）まで進めて、札と見出しを確かめる */
  await page.evaluate(() => {
    AQ.app.clock.pause();
    AQ.app.clock.seek(AQ.app.clock.beats.length - 1);
  });
  await page.waitForTimeout(120);
  const last = await page.evaluate(() => {
    const win = document.querySelector('.win');
    const b = AQ.app.clock.beats[AQ.app.clock.index];
    const F = { job: AQ.app.focusJob, actors: {} };
    /* 2026-09-12: 札は「歩き終わってから」置かれるようになった
       （tools/shot-carry.mjs 参照）。ここで見たいのはコマの最終状態
       なので、p=1 まで進めた絵を描いてから数える。 */
    AQ.stage.render(b, 1, AQ.state.at(AQ.app.beats, b.index), performance.now(),
                    AQ.app.beats, b.index, F);
    const lay = AQ.room.computeInspectLayout(b.index, F);
    const board = AQ.room.computeBoardLayout(b.index, F);
    const drop = AQ.room.computeDropoffLayout(b.index, F);
    const m = (b && b.lead && b.lead.meta) || {};
    const whoRows = Array.prototype.map.call(
      document.querySelectorAll('#detailBody .whoblock .drow'), e => e.textContent.trim())
      .filter(s => /^[①②③④]/.test(s));
    return {
      /* ★ 2026-09-27: 「いま④か」は帯の文字ではなく、再生中のコマ
         そのものの種類・verdict で確かめる（④ ATTEST useful＝result.ok）。 */
      leadType: (b && b.lead && b.lead.type) || '',
      verdict: m.verdict || '',
      whoRows: whoRows,
      progressNote: !!document.querySelector('.progress-note'),
      cards: board.count + drop.count + lay.count,
      /* 盤面に出ている札の依頼ID（ぜんぶ、いま追っている依頼のものか） */
      cardJobs: [].concat(board.shown, drop.shown, lay.shown).filter(it => it.card).map(it => String(it.card.id)),
      job: F && F.job,
      inspect: lay.count, ok: lay.ok, ng: lay.ng,
      text: win ? win.innerText.replace(/\n+/g, ' / ') : '',
      over: document.documentElement.scrollHeight - window.innerHeight
    };
  });
  const robots = await page.evaluate(() => {
    const b = AQ.app.clock.beats[AQ.app.clock.index];
    return AQ.stage.computeRobotScreenPositions(b, 0.5, AQ.app.beats, b.index,
      { job: AQ.app.focusJob, actors: (function () {
          const m = {}; AQ.app.clock.beats.forEach(x => { m[String(x.actor)] = true; }); return m; })() }).length;
  });
  console.log('  画面に出ているロボット: ' + robots + ' 体');
  if (robots > 4) { console.log('  ✗ ロボットが4体を超えている'); bad++; }
  console.log('  詳細（①〜④）: ' + last.whoRows.map(s => s.replace(/\s+/g, ' ').slice(0, 40)).join(' / '));
  /* ★ 2026-09-17: #番号だけでなく呼び名も出ていること（「#2 が誰？」
     という指摘への対応。番号だけに戻ったらここで落ちる）。①〜④の
     どのコマを再生中でも「詳細」は同じ内容（その依頼の全記録）を
     出す設計なので、④のコマでもこれが変わらないことをここで見る。 */
  if (last.whoRows.length !== 4) {
    console.log('  ✗ 詳細の関係者（①〜④）が4行揃っていない（' + last.whoRows.length + '）'); bad++;
  }
  const named = last.whoRows.filter(l => /#\d+\s+\S/.test(l)).length;
  if (named !== 4) {
    console.log('  ✗ ④まで来たのに、呼び名つきの行が4つ揃っていない（' +
                last.whoRows.join(' | ') + '）'); bad++;
  }
  if (last.progressNote) { console.log('  ✗ 外したはずの帯の注記（.progress-note）がまだ出ている'); bad++; }
  console.log('  盤面の札（この依頼のみ）: ' + last.cards + ' 枚（検品台 ' + last.inspect + ' ✓' + last.ok + ' ✗' + last.ng + '）');
  console.log('  はみ出し: ' + last.over + 'px');
  if (last.leadType !== 'result.ok' || last.verdict !== 'useful') {
    console.log('  ✗ ④（ATTEST useful）で終わっていない（種類: ' + last.leadType + ' verdict: ' + last.verdict + '）'); bad++;
  }
  /* ★ 2026-10-07: 引き受けた子それぞれが自分の札を持つ形にしたので、この依頼
     （4体が引き受け・2体が納品）は札が2枚になる（判定済み1・判定待ち1）。
     確かめるのは「盤面の札がぜんぶこの依頼のもの」で、枚数ではない。 */
  if (!last.cards || last.cardJobs.some(j => j !== String(last.job))) { console.log('  ✗ 盤面にこの依頼以外の札がある（' + last.cardJobs.join(',') + '）'); bad++; }
  if (last.ok !== 1) { console.log('  ✗ 合格の判定が反映されていない'); bad++; }
  if (last.over > 0) { console.log('  ✗ 画面からはみ出している'); bad++; }
  await page.screenshot({ path: `/tmp/jobs-${w}x${h}-${lang}-step4.png` });

  await page.close();
}
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
