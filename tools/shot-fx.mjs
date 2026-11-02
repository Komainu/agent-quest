/* tools/shot-fx.mjs — 家具の演出と、頭上・ステータス欄の札の呼び名（2026-09-28）
   使い方: node tools/shot-fx.mjs

   ★ 取り入れた案（見た目だけ。何が起きたかは変えない）
     ・検品台：判定しているあいだ、虫めがねから本人へ青いスキャン光
     ・納品口：納品しているあいだ、足もとの受け口へ粒が渦を巻いて吸い込まれる
     ・頭上の吹き出しに、運んでいる札の呼び名（ξ・π …）を添える
     ・ステータス欄に「いま扱っている札」（種類の絵＋呼び名）

   ★ 取り入れなかった案（事実と食い違うため）
     ・作業中の吹き出しに ✓ …… ✓は画面全体で「合格」。判定前に出すと嘘になる
     ・「依頼→実行→完了」…… このログに「実行」という段階は無く、納品は判定より前

   ★ 見るもの（描画側が数えた数字）
     lastFx（演出の種類）・lastBadges（頭上の絵と呼び名）・DOM のステータス欄。
       ・スキャン光は判定のコマでだけ、吸い込みは納品のコマでだけ出る
       ・引き受け・書き込みのコマでは、どちらも出ない
       ・頭上の呼び名は、そのコマの依頼の呼び名と一致する
       ・ステータス欄の札の呼び名も、そのコマの依頼の呼び名と一致する
*/
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 6; i++) {
    const id = 'fx' + i;
    MSGS.push({ seq: s++, from: 'did:key:zP', text: `JOB v1 | ${id} | ${['build', 'review', 'research'][i % 3]} | T ${i} | d`, ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zW', text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zW', text: `DELIVER v1 | ${id} | done`,  ts: iso(t += 900) });
    MSGS.push({ seq: s++, from: 'did:key:zJ', text: `ATTEST v1 | ${id} | ${i % 2 ? 'useful | ok' : 'not | thin'}`, ts: iso(t += 900) });
  }
  /* 依頼に属さない書き込み（呼び名の無いコマ） */
  MSGS.push({ seq: s++, from: 'did:key:zW', text: 'just chatting about the pier', ts: iso(t += 900) });
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate((m) => {
  AQ.adapters.kibbleForget('fx');
  AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'fx', observedAt: Date.now() }));
}, MSGS);
await page.waitForTimeout(400);

/* 何のコマか（room.js の stepKindOf と同じ分け方）。 */
const stats = { dropoff: { suction: 0, scan: 0, n: 0 }, inspect: { suction: 0, scan: 0, n: 0 },
                board: { suction: 0, scan: 0, n: 0 } };
let nickMismatch = [], heldMismatch = [], nickOnWrite = 0, sawNick = 0;

for (const who of ['did:key:zW', 'did:key:zJ']) {
  await page.evaluate((w) => { AQ.app.focusOnAgent(w); AQ.app.clock.speed = 2; }, who);
  for (let f = 0; f < 140; f++) {   // 2026-10-04: 始動が 1.3→1.8 秒・支払いの場面が長くなったぶん長めに見る
    await page.waitForTimeout(90);
    const r = await page.evaluate(() => {
      const b = AQ.app.clock.beats[AQ.app.clock.index] || {};
      const m = (b.lead && b.lead.meta) || {};
      /* 2026-09-28: 呼び名（ID）は画面から外した。ステータス欄の持ち物枠には
         種類の絵だけを置き、呼び名はマウスを乗せたときの title に入れる。 */
      const heldEl = document.querySelector('#focus-stat .statcard .held');
      return {
        fx: (AQ.room && AQ.room.lastFx) ? AQ.room.lastFx() : null,
        badges: (AQ.room && AQ.room.lastBadges) ? AQ.room.lastBadges() : [],
        kind: b.kind, verdict: m.verdict || null, job: m.job || null,
        want: m.job != null ? AQ.nick.forJob(String(m.job)) : null,
        held: heldEl ? (heldEl.getAttribute('title') || '') : null,
        heldText: heldEl ? heldEl.textContent.trim() : null,
        heldChip: heldEl ? !!heldEl.querySelector('.kchip') : null
      };
    });
    if (r.fx === null) { fail('演出の覗き穴（lastFx）が取れない＝この検査は何も見ていない'); f = 999; break; }
    const cat = (r.kind === 'receive' || r.kind === 'error') && r.verdict ? 'inspect'
              : (r.kind === 'receive' && r.job) ? 'dropoff' : 'board';
    stats[cat].n++;
    /* 2026-09-28: 納品の演出は「足もとの吸い込み」から「腕で投入口へ落とし入れる」
       （'deliver'）に変わった。数える名前だけ差し替え、欄の名前は据え置く。 */
    if (r.fx.indexOf('deliver') !== -1) stats[cat].suction++;
    if (r.fx.indexOf('scan') !== -1) stats[cat].scan++;
    for (const bd of r.badges) {
      /* 2026-09-28: 頭上の吹き出しにも呼び名（ID）は出さない（絵とゲージだけ）。 */
      if (bd.nick) { sawNick++; nickMismatch.push(bd.nick); }
    }
    if (r.job != null && r.held !== null) {
      if (r.heldText) heldMismatch.push(`枠に文字「${r.heldText}」`);
      if (!r.heldChip) heldMismatch.push('枠に種類の絵が無い');
      if (r.want && r.held.indexOf(r.want) === -1) heldMismatch.push(`title に呼び名 ${r.want} が無い`);
    }
  }
}

if (!stats.dropoff.suction) fail('納品のコマで投入口へ落とす演出が1度も出ていない');
if (!stats.inspect.scan)    fail('判定のコマでスキャン光が1度も出ていない');
if (stats.dropoff.scan)     fail(`納品のコマでスキャン光が出ている（${stats.dropoff.scan} 回）`);
if (stats.inspect.suction)  fail(`判定のコマで吸い込みが出ている（${stats.inspect.suction} 回）`);
if (!stats.board.n) fail('引き受け・書き込みのコマを1度も見ていない＝「そこでは出ない」の検査が空回り');
if (stats.board.scan || stats.board.suction) {
  fail(`引き受け・書き込みのコマで演出が出ている（光 ${stats.board.scan} / 吸い込み ${stats.board.suction}）`);
}
if (sawNick) fail(`頭上の吹き出しに呼び名（ID）が出ている（${sawNick} 回: ${Array.from(new Set(nickMismatch)).slice(0, 3).join(' / ')}）`);
if (heldMismatch.length) fail(`ステータス欄の持ち物枠がおかしい: ${Array.from(new Set(heldMismatch)).slice(0, 3).join(' / ')}`);

ok(`納品: 吸い込み ${stats.dropoff.suction}/${stats.dropoff.n} ・光 ${stats.dropoff.scan} / ` +
   `判定: 光 ${stats.inspect.scan}/${stats.inspect.n} ・吸い込み ${stats.inspect.suction} / ` +
   `その他: ${stats.board.scan + stats.board.suction}/${stats.board.n}`);
ok(`頭上の呼び名 ${sawNick} 回（出てはいけない）/ ステータス欄の持ち物枠の問題 ${heldMismatch.length}`);

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
