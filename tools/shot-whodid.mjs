/* tools/shot-whodid.mjs — 「誰がやったか」の出し方の検査（2026-09-17）
   使い方: node tools/shot-whodid.mjs

   ★ 何を確かめるか（もとの保証）
     利用者の指摘「#2 が誰なのか特定しづらい」への対応で、①〜④の主語を
     役割の言葉（やる人）から本人（#2 ネコ）に差し替えた。規則は3つ:

       ・もう起きていて、その行がログにある   → 「#2 ネコ が引き受けた」
       ・もう起きているが、その行がログに無い → 「Xエージェント が…」
         （数学の不明な変数 X と同じ扱い。「詳細」では「不明」と明記）
       ・まだ来ていない段階                   → 役割の言葉のまま
         （ここに名前を出すと、これから誰が納品するかを先に教えてしまう）

     ①の相手は「掲示板」。kibble の JOB 行は板に貼る投稿で、特定の
     エージェントに宛てて出すものではない＝「〜に出した」と書けるのは
     掲示板だけ（ログに無いことを描かないため）。

   ★ 2026-09-27: ①〜④の帯を画面から外したので、検査対象を移した。
     「まだ来ていない段階は役割の言葉のまま（名前を先出ししない）」
     という規則は、帯が「いま何コマ目か」に応じて表示を切り替える
     仕組みだったので、帯そのものが無くなった以上どこにも表示されない
     （詳細パネルは常に「その依頼の全記録」を出す設計で、そもそも
     コマ位置に応じて隠す・出すという考え方を持たない——他の詳細系
     検査でも前提にしている挙動）。よってこの部分は削除する。
     残る2つの規則――「分かっているときは本人の#番号＋DID」「分から
     ないときは『不明』と明記し、番号を捏造しない」――は詳細パネル
     （jobWhoBlock／#detailBody .whoblock）にそのまま残っているので、
     そちらを検査する。あわせて、一覧の丸（.jrow .jdots .jd.has）が
     「その段階の記録がログにあるか」を文字を使わずに正しく表している
     ことも確かめる（背景メモにある、①〜④の事実が残る2か所のうち
     もう1つ）。 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* kNoPost … ①の JOB 行が取れた記録の外（CLAIM から始まる）
   kFull   … ①〜④が全部そろっている */
const MSGS = [
  { seq: 1, from: 'did:key:zWorkerA', text: 'CLAIM v1 | kNoPost | builder',            ts: iso(1000) },
  { seq: 2, from: 'did:key:zWorkerA', text: 'DELIVER v1 | kNoPost | done',             ts: iso(2000) },
  { seq: 3, from: 'did:key:zJudge',   text: 'ATTEST v1 | kNoPost | not | needs work',  ts: iso(3000) },
  { seq: 4, from: 'did:key:zPoster',  text: 'JOB v1 | kFull | build | Build the pier | d', ts: iso(4000) },
  { seq: 5, from: 'did:key:zWorkerB', text: 'CLAIM v1 | kFull | builder',              ts: iso(5000) },
  { seq: 6, from: 'did:key:zWorkerB', text: 'DELIVER v1 | kFull | done',               ts: iso(6000) },
  { seq: 7, from: 'did:key:zJudge',   text: 'ATTEST v1 | kFull | useful | ok',          ts: iso(7000) }
];

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

for (const lang of ['ja', 'en']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate(({ m, l }) => {
    AQ.i18n.set(l); AQ.hud.relabel();
    AQ.adapters.kibbleForget('who');
    AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'who', observedAt: Date.now() }));
    /* 2026-09-28: 読み込み直後の一覧はエージェントになった。この検査は
       依頼の一覧の中身を見るので、依頼の一覧に切り替えてから見る。 */
    AQ.app.setListMode('jobs');
  }, { m: MSGS, l: lang });
  await page.waitForTimeout(700);

  console.log(`\n[${lang}]`);

  for (const jid of ['kNoPost', 'kFull']) {
    await page.evaluate((j) => { AQ.app.focusOnJob(j); }, jid);
    await page.waitForTimeout(400);

    const r = await page.evaluate((jid) => {
      const dots = Array.prototype.map.call(
        document.querySelectorAll(`.roster-chips .jrow[data-job="${jid}"] .jdots .jd`),
        e => e.classList.contains('has'));
      /* .whoblock の .drow には①〜④の関係者行のほかに、依頼IDや題名
         などの行（detailField）も同じクラスで混ざっている。①〜④の
         行だけを、先頭の丸数字で選び出す。 */
      const rows = Array.prototype.map.call(
        document.querySelectorAll('#detailBody .whoblock .drow'), r => r.textContent.trim())
        .filter(t => /^[①②③④]/.test(t));
      return {
        dots: dots,
        rows: rows,
        unknownTxt: AQ.i18n.t('jobs.detailUnknown')
      };
    }, jid);

    console.log('  ' + jid + ': 丸=' + r.dots.map(x => x ? '●' : '○').join('') +
                ' / 詳細=' + r.rows.map(x => x.replace(/\s+/g, ' ').slice(0, 50)).join(' | '));

    if (r.dots.length !== 4) { fail(`${jid}: ①〜④の丸が4つ揃っていない（${r.dots.length}）`); continue; }
    if (r.rows.length !== 4) { fail(`${jid}: 詳細の関係者の行が4つ揃っていない（${r.rows.length}）`); continue; }

    /* ---- 丸（記録の有無、文字を使わない形）---- */
    const wantDots = jid === 'kNoPost' ? [false, true, true, true] : [true, true, true, true];
    r.dots.forEach((has, i) => {
      if (has !== wantDots[i]) {
        fail(`${jid} 段階${i + 1}: 丸の有無が違う（記録${wantDots[i] ? 'あり' : 'なし'}のはずが ${has ? 'あり' : 'なし'}）`);
      }
    });

    /* ---- 詳細（本人の#番号 or 不明。捏造しない）---- */
    r.rows.forEach((row, i) => {
      const n = i + 1;
      const known = wantDots[n - 1];
      const isUnknown = row.indexOf(r.unknownTxt) !== -1;
      const numbered = /#\d/.test(row);
      if (known) {
        if (isUnknown) fail(`${jid} ①〜④の${n}: 記録があるのに「不明」になっている: ${row}`);
        if (!numbered) fail(`${jid} ①〜④の${n}: 記録があるのに #番号 が出ていない: ${row}`);
      } else {
        if (!isUnknown) fail(`${jid} ①〜④の${n}: 記録が無いのに「不明」と書いていない: ${row}`);
        if (numbered) fail(`${jid} ①〜④の${n}: 記録が無いのに #番号 を捏造している: ${row}`);
      }
    });

    /* 文言が訳されているか（en の画面に日本語が残っていた実例がある） */
    if (lang === 'en' && /[ぁ-んァ-ン一-龯]/.test(r.unknownTxt)) {
      fail('en なのに「不明」の文言が日本語のまま: ' + r.unknownTxt);
    }

    /* 詳細には本物の DID が必ず出る（呼び名だけで終わらせない） */
    const detailTxt = r.rows.join(' ');
    if (jid === 'kFull' && detailTxt.indexOf('did:key:zPoster') === -1) {
      fail('詳細に本物の DID が出ていない');
    }
  }
  await page.close();
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
