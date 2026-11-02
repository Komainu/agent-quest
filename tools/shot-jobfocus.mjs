/* tools/shot-jobfocus.mjs — 選んだ依頼の行を目立たせる・行の中の始動と終了（2026-09-30）
   使い方: node tools/shot-jobfocus.mjs [--shots]

   ★ 提案（利用者）
     「仕事が選ばれているときは右のウィンドウでもっと目立つ形に。仕事が選ばれたら
       始動のアクションをウィンドウの中で演出、終了したときも何か演出を」

   ★ 見るもの
     ・選んだ行：太い金の枠（2px 以上）と、にじむ光（box-shadow）がある。ほかの行には無い
     ・選んだ行が一覧のスクロールの外にあっても、選ぶと見える位置まで一覧が動く
     ・ロボットの始動中だけ、その行に booting（光が走り、ランプが順に点く）。始動が終われば外れる
     ・最後のコマのあと、終了の動作中は ending、止まったあとは ended ＋ チェッカーフラッグ
       フラッグの説明は「再生はここまで（依頼が終わった・うまくいったという意味ではない）」
     ・コマを選び直すと ending / ended・フラッグは消える
     ・ランプの点き方（どの段階の記録があるか）は、演出の前後で変わらない（事実は変えない）
*/
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE ? 'file://' + process.env.AQ_FILE : 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const SCR = '/tmp/claude-0/-home-claude/771479e9-d120-5f80-8905-16d478e5aced/scratchpad';
const SHOTS = process.argv.includes('--shots');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* 依頼を40件（一覧がスクロールするように）。jf0 は最初の依頼＝一覧のいちばん下（新しい順のため） */
const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 40; i++) {
    const id = 'jf' + i;
    MSGS.push({ seq: s++, from: 'did:key:zP', text: `JOB v1 | ${id} | ${['build', 'review', 'research'][i % 3]} | Task ${i} | d`, ts: iso(t += 400) });
    MSGS.push({ seq: s++, from: 'did:key:zW' + (i % 3), text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 400) });
    if (i % 2 === 0) MSGS.push({ seq: s++, from: 'did:key:zW' + (i % 3), text: `DELIVER v1 | ${id} | done`, ts: iso(t += 400) });
  }
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1860, height: 900 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate((m) => { AQ.adapters.kibbleForget('jf'); AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'jf', observedAt: Date.now() })); AQ.app.setListMode('jobs'); }, MSGS);
await page.waitForTimeout(300);

const rowInfo = (id) => page.evaluate((id) => {
  const r = document.querySelector('.roster-chips .jrow[data-job="' + id + '"]');
  if (!r) return null;
  const cs = getComputedStyle(r), box = document.getElementById('roster').getBoundingClientRect(), rr = r.getBoundingClientRect();
  return { cls: r.className, outline: parseFloat(cs.outlineWidth) || 0, shadow: cs.boxShadow,
           visible: rr.top >= box.top - 1 && rr.bottom <= box.bottom + 1,
           lamps: Array.from(r.querySelectorAll('.jd.lamp')).map(l => l.classList.contains('has') ? 1 : 0).join(''),
           flag: (r.querySelector('.jend') || {}).title || null };
}, id);

/* 1) 選ぶ（一番下にある jf0 ＝スクロールの外） */
const before = await rowInfo('jf0');
if (!before) fail('jf0 の行が無い＝空回り');
else if (before.visible) fail('jf0 が最初から見えている＝スクロールの検査が空回り（依頼を増やす）');
const other0 = await rowInfo('jf39');
await page.evaluate(() => AQ.app.focusOnJob('jf0'));
const seen = [];
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(60);
  const r = await page.evaluate(() => ({ ph: AQ.app.clock.phase(), cls: (document.querySelector('.roster-chips .jrow.focused') || {}).className || '' }));
  seen.push(r);
}
const a = await rowInfo('jf0');
const other = await rowInfo('jf39');
if (!a || !/focused/.test(a.cls)) fail('選んだ行に focused が無い');
else {
  if (a.outline < 2) fail(`選んだ行の枠が細い（${a.outline}px）`);
  if (!a.shadow || a.shadow === 'none') fail('選んだ行に光のにじみ（box-shadow）が無い');
  if (!a.visible) fail('選んだ行が一覧の見えるところに来ていない（スクロールしていない）');
  if (a.lamps !== before.lamps) fail(`演出でランプの点き方が変わった（${before.lamps} → ${a.lamps}）`);
}
if (other && /focused/.test(other.cls)) fail('選んでいない行まで目立っている');
const bootFrames = seen.filter(r => r.ph.boot != null);
if (!bootFrames.length) fail('始動の間を1度も見られなかった＝空回り');
if (bootFrames.some(r => !/booting/.test(r.cls))) fail('始動中なのに、選んだ行に booting が付いていない');
const afterBoot = seen.filter(r => r.ph.boot == null);
if (afterBoot.some(r => /booting/.test(r.cls))) fail('始動が終わったのに booting が残っている');
ok(`選んだ行: 枠 ${a && a.outline}px / にじみ ${a && a.shadow !== 'none'} / 見える ${a && a.visible} / 始動中 booting ${bootFrames.length} フレーム`);
if (SHOTS) {
  await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(0); c.bootLeft = c.bootMs * 0.4; c.onFrame(); });
  const r = await page.evaluate(() => { const e = document.getElementById('roster').getBoundingClientRect(); return { x: e.left - 4, y: e.top - 4, width: e.width + 8, height: e.height + 8 }; });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SCR}/jf-boot.png`, clip: r });
}

/* 1b) 再生中は「いまここを処理している」：行が脈打つ（active）・中身が明るい
       （2026-10-01 報告「黄色い枠の行の α や巻物が暗く半透明で、ほかの行より目立たない」） */
{
  const r = await page.evaluate(() => new Promise((res) => {
    const c = AQ.app.clock;
    c.pause(); c.seek(0); c.play();
    (function w() {
      if (c.phase().boot != null) { setTimeout(w, 50); return; }
      setTimeout(() => {
        const row = document.querySelector('.roster-chips .jrow.focused');
        const lum = (col) => { const m = col.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
        const nick = row.querySelector('.jnick'), sc = row.querySelector('.jscroll');
        const other = Array.from(document.querySelectorAll('.roster-chips .jrow[data-job]')).find(x => !x.classList.contains('focused'));
        const out = { playing: c.playing, cls: row.className, anim: getComputedStyle(row).animationName,
          nickLum: lum(getComputedStyle(nick).color), otherNickLum: lum(getComputedStyle(other.querySelector('.jnick')).color),
          scrollOp: parseFloat(getComputedStyle(sc).opacity), otherScrollOp: parseFloat(getComputedStyle(other.querySelector('.jscroll')).opacity),
          bgLum: lum(getComputedStyle(row).backgroundColor) };
        c.pause(); AQ.app.clock.onFrame();
        setTimeout(() => { out.pausedCls = document.querySelector('.roster-chips .jrow.focused').className; res(out); }, 80);
      }, 300);
    })();
  }));
  if (!r.playing) fail('再生中の検査なのに再生していない＝空回り');
  if (!/active/.test(r.cls) || r.anim !== 'activePulse') fail(`再生中なのに選んだ行が脈打っていない（${r.cls} / ${r.anim}）`);
  if (!(r.nickLum > r.otherNickLum)) fail(`選んだ行の呼び名が、ほかの行より明るくない（${r.nickLum.toFixed(2)} ≤ ${r.otherNickLum.toFixed(2)}）`);
  if (!(r.nickLum > 0.8)) fail(`選んだ行の呼び名が暗い（明るさ ${r.nickLum.toFixed(2)}）`);
  if (r.scrollOp < 0.9 || r.scrollOp < r.otherScrollOp) fail(`選んだ行の巻物が薄い（${r.scrollOp} / ほかの行 ${r.otherScrollOp}）`);
  if (/active/.test(r.pausedCls)) fail('一時停止しても脈打ったまま（止めたら止まるはず）');
  ok(`再生中: 脈打つ ${r.anim} / 呼び名の明るさ ${r.nickLum.toFixed(2)}（ほかの行 ${r.otherNickLum.toFixed(2)}）/ 巻物 ${r.scrollOp}（ほか ${r.otherScrollOp}）/ 止めると ${r.pausedCls}`);
}

/* 2) 終了：ending → ended ＋ フラッグ */
const endSeen = await page.evaluate(() => new Promise((res) => {
  const c = AQ.app.clock;
  const spd = document.getElementById('speed'); spd.value = '1'; spd.dispatchEvent(new Event('change'));
  c.pause(); c.seek(c.beats.length - 1); c.elapsed = Math.max(0, c.durationOf(c.index) - 40); c.play();
  const out = [], t0 = performance.now();
  (function tick() {
    const row = document.querySelector('.roster-chips .jrow.focused');
    out.push({ end: c.phase().end, playing: c.playing, cls: row ? row.className : '', flag: row && row.querySelector('.jend') ? row.querySelector('.jend').title : null });
    if (c.playing && performance.now() - t0 < 4000) requestAnimationFrame(tick);
    else setTimeout(() => { const r2 = document.querySelector('.roster-chips .jrow.focused'); out.push({ end: c.phase().end, playing: c.playing, cls: r2 ? r2.className : '', flag: r2 && r2.querySelector('.jend') ? r2.querySelector('.jend').title : null, final: true }); res(out); }, 200);
  })();
}));
const ending = endSeen.filter(r => r.end > 0 && r.end < 1);
const fin = endSeen[endSeen.length - 1];
if (!ending.length) fail('終了の動作の間を見られなかった＝空回り');
if (ending.some(r => !/ending/.test(r.cls))) fail('終了の動作中なのに、選んだ行に ending が付いていない');
if (fin.playing) fail('終了の動作のあとも止まらない');
if (!/ended/.test(fin.cls)) fail('止まったあと、選んだ行に ended が付いていない');
if (!fin.flag) fail('止まったあと、行にフラッグが出ていない');
else if (!/再生はここまで/.test(fin.flag) || !/意味ではありません/.test(fin.flag)) fail(`フラッグの説明が「再生はここまで・終わった意味ではない」になっていない（"${fin.flag}"）`);
const lampsEnd = await rowInfo('jf0');
if (lampsEnd && before && lampsEnd.lamps !== before.lamps) fail('終了の演出でランプの点き方が変わった');
ok(`終了: ending ${ending.length} フレーム → ended・フラッグ「${(fin.flag || '').slice(0, 12)}…」`);
if (SHOTS) {
  const r = await page.evaluate(() => { const e = document.getElementById('roster').getBoundingClientRect(); return { x: e.left - 4, y: e.top - 4, width: e.width + 8, height: e.height + 8 }; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCR}/jf-end.png`, clip: r });
}

/* 2b) LIVE で新しい依頼が次々に届いても、選んだ行は一覧の中で見え続ける
       （2026-09-30(2) 報告「仕事を選んでもすぐにその選んだ仕事は枠外に行ってしまう」）。
       一覧が作り直されても、旗は残り、演出は繰り返さない（steady）。 */
{
  const r = await page.evaluate(() => {
    const iso = (ms) => new Date(1758300000000 + 900000 + ms).toISOString();
    const out = [];
    for (let k = 0; k < 6; k++) {
      const more = [];
      for (let j = 0; j < 8; j++) {
        const id = 'live' + k + '_' + j;
        /* 分かっている段階を3つにして、選んだ jf0 より上に並ぶ依頼にする
           （一覧の上限 40 行の外へ jf0 を押し出す） */
        more.push({ seq: 5000 + k * 30 + j * 3, from: 'did:key:zP', text: `JOB v1 | ${id} | build | L | d`, ts: iso((k * 10 + j) * 300) });
        more.push({ seq: 5001 + k * 30 + j * 3, from: 'did:key:zW9', text: `CLAIM v1 | ${id} | b`, ts: iso((k * 10 + j) * 300 + 100) });
        more.push({ seq: 5002 + k * 30 + j * 3, from: 'did:key:zW9', text: `DELIVER v1 | ${id} | ok`, ts: iso((k * 10 + j) * 300 + 200) });
      }
      AQ.app.appendEvents(AQ.adapters.fromKibble(more, { room: 'jf', observedAt: Date.now() }));
      const row = document.querySelector('.roster-chips .jrow.focused');
      const box = document.getElementById('roster').getBoundingClientRect();
      const rr = row ? row.getBoundingClientRect() : null;
      out.push({ vis: !!rr && rr.top >= box.top - 1 && rr.bottom <= box.bottom + 1, cls: row ? row.className : '',
                 flag: !!(row && row.querySelector('.jend')), rows: document.querySelectorAll('.roster-chips .jrow[data-job]').length });
    }
    return out;
  });
  const total = await page.evaluate(() => AQ.app.jobIndex.list.length);
  if (total < 80) fail(`依頼が増えていない（${total} 件）＝空回り`);
  if (r[r.length - 1].rows > 41) fail(`一覧の行数が上限を超えた（${r[r.length - 1].rows}）`);
  if (r.some(x => !x.cls)) fail('選んだ依頼が一覧の上限の外へ押し出されて、行ごと消えた');
  if (r.some(x => !x.vis)) fail(`新しい依頼が届いたら、選んだ行が一覧の外へ出た（${r.map(x => x.vis ? '○' : '×').join('')}）`);
  if (r.some(x => !x.flag || !/ended/.test(x.cls))) fail('一覧が作り直されたら、旗・終了の印が消えた');
  if (r.some(x => !/steady/.test(x.cls))) fail('一覧が作り直されるたびに、終了の演出を繰り返している（steady が付いていない）');
  ok(`LIVE で依頼 +48: 選んだ行は見え続ける ${r.map(x => x.vis ? '○' : '×').join('')} / 旗 ${r.every(x => x.flag)} / 繰り返さない ${r.every(x => /steady/.test(x.cls))}`);
}

/* 3) 選び直すと消える */
await page.evaluate(() => { const c = AQ.app.clock; c.seek(0); });
await page.waitForTimeout(100);
const back = await rowInfo('jf0');
if (!back || /ending|ended/.test(back.cls) || back.flag) fail(`コマを選び直しても終了の印が残っている（${back && back.cls}）`);
if (back && /steady/.test(back.cls)) fail('状態が変わったのに steady（演出を止める印）が残っている');
ok(`選び直し: ${back && back.cls}`);

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
