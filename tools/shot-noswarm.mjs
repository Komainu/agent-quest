/* tools/shot-noswarm.mjs — 「選んでいないのに全員が動き出す」不具合
   （2026-09-27）。使い方: node tools/shot-noswarm.mjs

   ★ 利用者の報告
     「なぜか急にエージェントがわらわらと現れました。
       エージェントの名前はクリックしていません」

   ★ 何が起きていたか（実測で特定）
     依頼／エージェントを選んだあと、一覧の「依頼から」「エージェントから」
     や「◀ エージェント一覧へ戻る」を押すと、絞り込み（agentFilter・
     focusJob）は外れるのに hasChosen だけ true のまま残っていた。
     この「選んだことになっているが、実際には何も選んでいない」状態で
     computePlayBeats() を呼ぶと3つとも null なのでログ全体が返る。
     押した直後は clock.beats が古いままなので画面は変わらないが、
     LIVE の新着が届いた次の rebuild(false) で clock.beats がログ全体に
     差し替わり、その瞬間に全エージェントがいっせいに動き出した
     （実測: 2コマ → 126コマ）。

   ★ この検査が見るもの
     画面に実際に描かれたロボットの体数（room.lastRobotsDrawn）。
     絵を見た印象ではなく、描画側が数えた数字で確かめる。
       ・選んでいないとき      → 0体（家具だけ）
       ・1件／1体を選んだとき  → 1体
       ・一覧のタブを押した後  → 0体（＝「選んでください」に戻る）
       ・その直後に LIVE の新着が届いても → 0体のまま
       ・「すべて表示」を押したときだけ → 何体出てもよい（利用者の意思）
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
  for (let i = 0; i < 30; i++) {
    const id = 'ns' + i;
    const w = 'did:key:zW' + (i % 12), j = 'did:key:zJ' + (i % 6), p = 'did:key:zP' + (i % 8);
    MSGS.push({ seq: s++, from: p, text: `JOB v1 | ${id} | build | Job ${i} | d`, ts: iso(t += 500) });
    MSGS.push({ seq: s++, from: w, text: `CLAIM v1 | ${id} | builder`,            ts: iso(t += 500) });
    MSGS.push({ seq: s++, from: w, text: `DELIVER v1 | ${id} | done`,             ts: iso(t += 500) });
    MSGS.push({ seq: s++, from: j, text: `ATTEST v1 | ${id} | useful | ok`,       ts: iso(t += 500) });
  }
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1820, height: 1000 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate((m) => {
  AQ.adapters.kibbleForget('ns');
  AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'ns', observedAt: Date.now() }));
}, MSGS);

/* 何フレームか回して、いちばん多く描かれた体数を取る（1フレームだけ
   見ると、たまたま静止しているコマを拾って見逃す）。 */
async function worstRobots(ms) {
  let worst = 0, st = null;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await page.evaluate(() => ({
      n: (AQ.room && AQ.room.lastRobotsDrawn) ? AQ.room.lastRobotsDrawn() : -1,
      chosen: AQ.app.hasChosen, filter: AQ.app.agentFilter,
      job: AQ.app.focusJob, beats: AQ.app.clock.beats.length
    }));
    if (r.n > worst) worst = r.n;
    st = r;
    await page.waitForTimeout(120);
  }
  return { worst, st };
}

const steps = [
  ['読み込み直後',            async () => {},                                                  0],
  ['依頼を1件えらんだ',        async () => page.evaluate(() => AQ.app.focusOnJob(AQ.app.jobIndex.list[0].id)), 1],
  ['「エージェントから」を押した', async () => page.evaluate(() => AQ.app.setListMode('agents')),  1],
  ['エージェントをえらんだ',    async () => page.evaluate(() => AQ.app.focusOnAgent('did:key:zW0')), 1],
  /* 2026-09-28: エージェントを選ぶと、その子の代表の依頼1件を選んだ状態になる。
     だから「依頼から」を押しても、その依頼1件の再生は続く（1体まで）。
     守るのは「全員がいっせいに動き出さない」こと。 */
  /* ★ 2026-10-08: 「依頼から」に切り替えても、いま見ていた場面（同じ出来事のコマ）に
     留まるようにした。その依頼の②（引き受け）の場面なら、①を出した子と②の子の
     2体が板の前にいるのが正しい。守るのは「依頼の関係者（この依頼は3体）より多く
     動き出さない」こと。 */
  ['「依頼から」を押した',      async () => page.evaluate(() => AQ.app.setListMode('jobs')),      3],
  ['LIVEの新着がとどいた',     async () => page.evaluate(() => AQ.app.appendEvents(
      AQ.adapters.fromKibble(
        [{ seq: 99999, from: 'did:key:zW3',
           text: 'JOB v1 | nsZZ | build | later job | d',
           ts: new Date(1758300000000 + 999000).toISOString() }],
        { room: 'ns', observedAt: Date.now() }))),                                             3]
];

for (const [label, act, max] of steps) {
  await act();
  const { worst, st } = await worstRobots(1100);
  console.log(`  ${label.padEnd(26)} 描いた体数=${worst}（上限${max}） ` +
              `選んだ=${st.chosen} 絞り=${st.filter ? '有' : '無'}/${st.job ? '有' : '無'} コマ=${st.beats}`);
  if (worst < 0) fail(`${label}: 描画側の覗き穴（lastRobotsDrawn）が取れない＝この検査は何も見ていない`);
  if (worst > max) {
    fail(`${label}: 選んでいないのに ${worst} 体が動いている（上限 ${max} 体）` +
         ` — 「わらわら」の再発`);
  }
}

/* 「すべて表示」は利用者が自分でログ全体を選んだ場合。ここまで消して
   しまうと、今度は全体を見る道が無くなる＝直しすぎ。 */
await page.evaluate(() => {
  AQ.app.focusClear();
  /* ログの後ろのほうまで進めておく（直後の数コマだけでは、まだ
     何体も登場していないので「全体を見られる」ことの確認にならない）。 */
  AQ.app.clock.seek(Math.floor(AQ.app.clock.beats.length * 0.8));
});
{
  const { worst, st } = await worstRobots(2500);
  console.log(`  ${'「すべて表示」を押した'.padEnd(26)} 描いた体数=${worst} 選んだ=${st.chosen}`);
  if (worst < 2) fail(`「すべて表示」を押したのに ${worst} 体しか出ない＝全体を見る道を塞いでしまった`);
}

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
