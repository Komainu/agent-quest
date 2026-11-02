/* tools/shot-agents.mjs — 「エージェントから入る道」の検査（2026-09-12）
   使い方: node tools/shot-agents.mjs   （dist/agent-quest.html を先に build）

   ★ 2026-09-13 に意味が変わった。利用者の提案:
     「四つの動作はすべて行うのだから、それを何件ずつ行っているか、
       という表示にしたほうが分かりやすいのでは？」
   エージェントから入ったときは「その子の仕事ぶりのまとめ」になった:
     ・①〜④それぞれ何件やったかを正確に出す（間引きゼロ）
     ・各段階につき1件を例として実際に動かす（最大4場面）
     ・時系列の再生ではないので、まとめであることを画面に書く
   確かめるのは、そのとおりに動いていること・数が正確なこと・
   全記録が「詳細」にあること。 */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

const A = 'did:key:zPoster', B = 'did:key:zWorker', C = 'did:key:zJudge';
const iso = (ms) => new Date(1758300000000 + ms).toISOString();
/* B は3件に関わる。うち kA だけが①〜④そろっている＝代表になるはず。 */
const MSGS = [
  { seq: 1, from: A, text: 'JOB v1 | kA | build | Build the west pier walkway | d', ts: iso(0) },
  { seq: 2, from: A, text: 'JOB v1 | kB | review | Check the tide tables | d', ts: iso(1000) },
  { seq: 3, from: A, text: 'JOB v1 | kC | coordinate | Plan the harbour rota | d', ts: iso(2000) },
  { seq: 4, from: B, text: 'CLAIM v1 | kA | builder', ts: iso(40000) },
  { seq: 5, from: B, text: 'CLAIM v1 | kB | builder', ts: iso(50000) },
  { seq: 6, from: B, text: 'CLAIM v1 | kC | builder', ts: iso(55000) },
  { seq: 7, from: B, text: 'DELIVER v1 | kA | walkway done', ts: iso(90000) },
  { seq: 8, from: C, text: 'ATTEST v1 | kA | useful | matches the plan', ts: iso(120000) }
];

let bad = 0;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const lang of ['ja', 'en']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => { console.log('  ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate((l) => { AQ.i18n.set(l); AQ.hud.relabel(); }, lang);
  await page.evaluate((msgs) => {
    AQ.adapters.kibbleForget('ag');
    AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'ag', observedAt: Date.now() }));
  }, MSGS);

  console.log(`\n=== ${lang} ===`);

  /* 1) 切り替えボタンが出ていて、既定は「エージェントから」
     ★ 2026-09-28: 既定は 2026-09-28 から「エージェントから」（利用者の要望
     「エージェント目線のほうがわかりやすい」）。以前のこの検査は
     className.indexOf('on') で見ていて、'icon-btn' の中の "on" に一致して
     しまい、既定が変わっても通っていた（空回り）。class の語として見る。 */
  const sw = await page.evaluate(() => ({
    jobs: !document.getElementById('modeJobs').hidden,
    agents: !document.getElementById('modeAgents').hidden,
    on: document.getElementById('modeAgents').classList.contains('on') &&
        !document.getElementById('modeJobs').classList.contains('on'),
    iconBtn: document.getElementById('modeJobs').classList.contains('icon-btn') &&
             document.getElementById('modeAgents').classList.contains('icon-btn'),
    labelJobs: document.getElementById('modeJobs').textContent,
    labelAgents: document.getElementById('modeAgents').textContent
  }));
  console.log('  切り替え: ' + sw.labelJobs + ' / ' + sw.labelAgents + '（既定はエージェントから=' + sw.on + '）');
  if (!sw.jobs || !sw.agents) { console.log('  ✗ 切り替えボタンが出ていない'); bad++; }
  if (!sw.on) { console.log('  ✗ 既定が「エージェントから」になっていない'); bad++; }
  if (!sw.iconBtn) { console.log('  ✗ 切り替えボタンから記号ボタンの見た目（icon-btn）が外れている'); bad++; }

  /* 2) エージェント一覧へ切り替える */
  await page.evaluate(() => document.getElementById('modeAgents').click());
  const ag = await page.evaluate(() => ({
    head: (document.getElementById('roster-head') || {}).textContent || '',
    rows: Array.prototype.map.call(document.querySelectorAll('.agentrow[data-agent]'),
                                   e => e.innerText.replace(/\n+/g, ' ')),
    playing: AQ.app.hasChosen
  }));
  console.log('  見出し: ' + ag.head);
  ag.rows.forEach(r => console.log('    ' + r));
  if (ag.rows.length !== 3) { console.log('  ✗ エージェントが3体出ていない'); bad++; }
  if (ag.rows[0].indexOf('3') === -1) { console.log('  ✗ 関わった依頼の件数が出ていない'); bad++; }

  /* 3) 3件に関わっている B をクリック → その子の依頼だけの一覧＋代表を再生 */
  await page.evaluate((b) => { document.querySelector('.agentrow[data-agent="' + b + '"]').click(); }, B);
  await page.evaluate(() => AQ.app.clock.pause());
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    head: (document.getElementById('roster-head') || {}).textContent || '',
    jobs: Array.prototype.map.call(document.querySelectorAll('.jrow[data-job]'),
                                   e => e.getAttribute('data-job')),
    back: !!document.querySelector('.backrow'),
    focusJob: AQ.app.focusJob,
    agentFilter: AQ.app.agentFilter,
    beats: AQ.app.clock.beats.length,
    stat: (document.getElementById('focus-stat') || {}).textContent || '',
    detail: document.querySelectorAll('#detailBody .devent').length,
    /* ★ 2026-09-12(2): 選んだ子以外が動いていないこと。
       報告「タヌキを選んだのに違う名前のエージェントが動いている／
       複数のエージェントが入り乱れて動く」への歯止め。 */
    actors: AQ.app.clock.beats.map(b => String(b.actor)),
    robots: (function () {
      const b = AQ.app.clock.beats[AQ.app.clock.index];
      return AQ.stage.computeRobotScreenPositions(b, 0.5, AQ.app.beats, b.index,
        { job: AQ.app.focusJob, actors: (function () {
            const m = {}; m[String(AQ.app.agentFilter)] = true; return m; })() })
        .map(r => String(r.actor));
    })(),
    counts: (AQ.app.agentStory && AQ.app.agentStory.counts) || null,
    /* 件数はログから数え直して突き合わせる（画面の数字が正しいか）。 */
    recount: (function () {
      const c = { 1: 0, 2: 0, 3: 0, 4: 0 };
      AQ.app.events.forEach(e => {
        const m = e.meta || {};
        if (!m.job || String(e.actor) !== String(AQ.app.agentFilter)) return;
        if (e.type === 'agent.plan') c[1]++;
        else if (e.type === 'tool.call') c[2]++;
        else if (e.type === 'result.ok') c[m.verdict === 'useful' ? 4 : 3]++;
        else if (e.type === 'result.error' && m.verdict === 'not') c[4]++;
      });
      return c;
    })(),
    rowCounts: Array.prototype.map.call(document.querySelectorAll('.progress .pw'), e => e.textContent),
    ownSteps: []
  }));
  console.log('  見出し: ' + after.head);
  console.log('  その子の依頼: ' + after.jobs.join(', ') + ' / 再生中: ' + after.focusJob +
              '（' + after.beats + 'コマ）');
  console.log('  下の行: ' + after.stat);
  if (after.jobs.length !== 3) { console.log('  ✗ その子の依頼だけに絞れていない'); bad++; }
  if (after.beats > 4) { console.log('  ✗ 場面が4つを超えている（①〜④の例だけのはず）'); bad++; }
  console.log('  件数: ' + JSON.stringify(after.counts) + ' / 画面の数字: ' + after.rowCounts.join(' '));
  if (!after.counts) { console.log('  ✗ まとめ（件数）が作られていない'); bad++; }
  else {
    [1,2,3,4].forEach(n => {
      if (after.counts[n] !== after.recount[n]) {
        console.log('  ✗ ' + n + ' の件数が実際と違う（画面 ' + after.counts[n] +
                    ' / ログ ' + after.recount[n] + '）'); bad++;
      }
    });
  }
  if (!after.back) { console.log('  ✗ エージェント一覧へ戻る行が無い'); bad++; }
  if (after.stat.indexOf('3') === -1) {
    console.log('  ✗ 依頼の件数が画面に出ていない'); bad++;
  }
  if (after.detail < 4) { console.log('  ✗ 詳細にこの依頼の全記録が出ていない'); bad++; }
  console.log('  再生するコマの actor: ' + after.actors.join(', ') +
              ' / 画面のロボット: ' + after.robots.join(', '));
  if (after.actors.some(a => a !== B)) {
    console.log('  ✗ 選んだ子以外のコマが再生対象に入っている'); bad++;
  }
  if (after.robots.length !== 1 || after.robots[0] !== B) {
    console.log('  ✗ 画面に選んだ子以外のロボットが出ている'); bad++;
  }


  /* 4) 戻る → またエージェント一覧 */
  await page.evaluate(() => document.querySelector('.backrow').click());
  const back = await page.evaluate(() => ({
    rows: document.querySelectorAll('.agentrow[data-agent]').length,
    filter: AQ.app.agentFilter
  }));
  if (back.rows !== 3 || back.filter !== null) { console.log('  ✗ 戻れていない'); bad++; }

  const over = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  console.log('  はみ出し: ' + over + 'px');
  if (over > 0) { console.log('  ✗ 画面からはみ出している'); bad++; }
  await page.screenshot({ path: `/tmp/agents-${lang}.png` });

  /* 5) 依頼IDを持たないログ（x402 のサンプル）では切り替え自体を出さない */
  const noJobs = await page.evaluate(() => {
    AQ.app.loadRun('basic');
    return {
      hiddenJobs: document.getElementById('modeJobs').hidden,
      hiddenAgents: document.getElementById('modeAgents').hidden,
      arows: document.querySelectorAll('.arow[data-actor]').length
    };
  });
  console.log('  依頼の無いログ: 切り替え非表示=' + (noJobs.hiddenJobs && noJobs.hiddenAgents) +
              ' / 従来の名簿 ' + noJobs.arows + ' 行');
  if (!noJobs.hiddenJobs || !noJobs.hiddenAgents) {
    console.log('  ✗ 依頼の無いログで切り替えが出ている（押しても意味が無い）'); bad++;
  }
  if (!noJobs.arows) { console.log('  ✗ 依頼の無いログで従来の名簿が出ていない'); bad++; }

  await page.close();
}
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
