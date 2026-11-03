/* tools/shot-furniture.mjs — 家具の見出しを絵にする（2026-09-28）
   使い方: node tools/shot-furniture.mjs

   ★ 指摘
     「『掲示板』『納品口』『検品台』という文字入りのウィンドウ枠を外し、
       完全なピクセルアートのオブジェクトに描き換える」
     （ドット絵の上に HTML の見出しが浮いて見える＝世界観を壊す異物）

   ★ ただし守ること
     画面に入る札は数枚で、残りは「+N」にまとめている。件数まで消すと
     「35件あるのに5件しかないように見える」画面になる。文字の見出しは
     消すが、**数は家具に打ち込んだプレートとして必ず残す**。

   ★ この検査が見るもの（絵を目で見ない）
     room.js が「その1フレームで何という文字を描いたか（lastLabels）」と
     「どの家具の看板に、いくつと刻んだか（lastSigns）」を数えている。
       ・日本語の見出し（掲示板／納品口／検品台／この依頼の札 …）は
         1度も描かれない
       ・3つの家具の看板が毎フレーム描かれている（消しただけではない）
       ・看板の件数は、必ずその数字として画面に描かれている
       ・少なくとも1度は 0 でない件数が出る（検査が空回りしていない）
*/
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* 板にも納品口にも検品台にも札が溜まるログ（合格・不合格の両方を混ぜる）。
   依頼数を多めにして、枠に入りきらない「+N」も起きるようにする。 */
const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 14; i++) {
    const id = 'fn' + i;
    MSGS.push({ seq: s++, from: 'did:key:zPost', text: `JOB v1 | ${id} | build | Job ${i} | d`, ts: iso(t += 400) });
  }
  for (let i = 0; i < 10; i++) {
    const id = 'fn' + i;
    MSGS.push({ seq: s++, from: 'did:key:zWork', text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 400) });
    MSGS.push({ seq: s++, from: 'did:key:zWork', text: `DELIVER v1 | ${id} | done`,  ts: iso(t += 400) });
  }
  for (let i = 0; i < 6; i++) {
    const id = 'fn' + i;
    MSGS.push({ seq: s++, from: 'did:key:zJudge',
                text: `ATTEST v1 | ${id} | ${i % 2 ? 'useful | ok' : 'not | thin'}`, ts: iso(t += 400) });
  }
}

/* 消えているべき見出しの言葉（ja / en の両方）。 */
const BANNED = ['掲示板', '納品口', '検品台', 'この依頼の札', '判定', '未着手',
                'board', 'drop-off', 'inspection', 'unclaimed', 'judged'];

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

for (const lang of ['ja', 'en']) {
  const page = await browser.newPage({ viewport: { width: 1860, height: 880 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.evaluate(({ m, l }) => {
    AQ.i18n.set(l);
    AQ.adapters.kibbleForget('fn');
    AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'fn', observedAt: Date.now() }));
    AQ.app.focusClear();          // すべての札が家具に並ぶ状態で見る
    AQ.app.clock.speed = 4;
  }, { m: MSGS, l: lang });
  await page.waitForTimeout(700);
  /* 判定まで進んだ状態も必ず見る（頭から再生しているだけでは、
     検品台がずっと空のままで検査が空回りする）。 */
  await page.evaluate(() => AQ.app.clock.seek(AQ.app.clock.beats.length - 1));
  await page.waitForTimeout(500);

  let banned = [], missingSign = 0, missingNum = [], frames = 0;
  let maxN = 0, sawOk = false, sawNg = false, kinds = new Set();

  for (let f = 0; f < 70; f++) {
    await page.waitForTimeout(110);
    const r = await page.evaluate(() => ({
      labels: (AQ.room && AQ.room.lastLabels) ? AQ.room.lastLabels() : null,
      signs:  (AQ.room && AQ.room.lastSigns)  ? AQ.room.lastSigns()  : null
    }));
    if (r.labels === null || r.signs === null) {
      fail('描画側の覗き穴（lastLabels / lastSigns）が取れない＝この検査は何も見ていない');
      break;
    }
    if (!r.signs.length) continue;      // まだ1フレームも描いていない
    frames++;
    for (const w of r.labels) {
      for (const b of BANNED) {
        if (w.indexOf(b) !== -1) banned.push(w.trim());
      }
    }
    if (r.signs.length !== 3) missingSign++;
    for (const sg of r.signs) {
      kinds.add(sg.kind);
      maxN = Math.max(maxN, sg.n || 0);
      /* 看板に刻んだ件数が、実際に数字として描かれているか */
      if (!r.labels.some(w => w.trim() === String(sg.n))) {
        missingNum.push(`${sg.kind}:${sg.n}`);
      }
      if (sg.kind === 'inspect') {
        if (sg.ok > 0) sawOk = true;
        if (sg.ng > 0) sawNg = true;
        for (const v of [sg.ok, sg.ng]) {
          if (v != null && !r.labels.some(w => w.trim() === String(v))) {
            missingNum.push(`inspect(${v})`);
          }
        }
      }
    }
  }

  if (!frames) { fail(`[${lang}] 家具が1フレームも描かれていない`); await page.close(); continue; }
  if (banned.length) {
    fail(`[${lang}] 家具の見出しの日本語が残っている: ${Array.from(new Set(banned)).slice(0, 4).join(' / ')}`);
  }
  if (missingSign) fail(`[${lang}] 3つの家具の看板がそろわないフレームが ${missingSign} 回`);
  if (kinds.size !== 3) fail(`[${lang}] 看板の種類が ${Array.from(kinds).join(',')} しかない（board/dropoff/inspect の3つが要る）`);
  if (missingNum.length) {
    fail(`[${lang}] 看板の件数が数字として描かれていない: ${Array.from(new Set(missingNum)).slice(0, 4).join(' / ')}`);
  }
  if (maxN === 0) fail(`[${lang}] どの家具の件数も 0 のまま＝検査が空回りしている`);
  if (lang === 'ja' && !(sawOk && sawNg)) {
    fail(`[${lang}] 検品台に合格(${sawOk})・不合格(${sawNg})の両方が出ていない＝検査が空回りしている`);
  }
  ok(`[${lang}] ${frames}フレーム / 看板 ${Array.from(kinds).sort().join(',')} / ` +
     `最大件数 ${maxN} / 合格${sawOk ? '有' : '無'}・不合格${sawNg ? '有' : '無'} / 禁止語 ${banned.length} 回`);
  await page.close();
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
