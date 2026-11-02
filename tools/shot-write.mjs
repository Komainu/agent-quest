/* tools/shot-write.mjs — kibble の「書き込み」のコマの検査（2026-09-18）
   使い方: node tools/shot-write.mjs

   ★ 何を確かめるか（利用者の2つの報告）
     「エージェントの動きがワープ方式になっています。滑らかでない」
     「書き込みをまとめて記録した、ばかりで何の面白みもありません。
       記録しているなら記録している動作を入れてください」

     kibble の大半は JOB/CLAIM/DELIVER/ATTEST のどれでもないただの発言で、
     アダプタが tool.call + result.ok の対にする（meta.job は付かない）。
     これが actbatch のコマになる。以前は行き先が「掲示板」だけだったので、
     最初の1コマで板の前へ行ったきり、あとは何十コマも棒立ちのまま同じ
     文字が出ていた。いまは「机で書く→板に貼りに行く→机へ戻る」の往復。

     1) どのコマも自分の机で始まり、自分の机で終わる
        ＝前のコマの終わりと次のコマの始まりが必ず一致する（ワープしない）
     2) コマの中で本当に移動している（棒立ちではない）
     3) 行きはメモを持ち、板に着いたら貼る絵が実際に描かれている
     4) 文字は「掲示板に書き込んだ」＋本当の回数
        （イベント数ではなく発言の回数。tool.call と result.ok の対で
          倍に見えるのを、seq の種類数で数え直している）
     5) 回数が多いコマほど往復が増える */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* ただの発言だけの部屋（JOB 行が1つも無い＝利用者が見ていた形） */
const WHO = ['did:key:zChatA', 'did:key:zChatB'];
const MSGS = [];
for (let i = 0, t = 0; i < 60; i++) {
  MSGS.push({ seq: i + 1, from: WHO[i % 2], text: 'note about the harbour ' + i, ts: iso(t += 900) });
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);

await page.evaluate((m) => {
  AQ.adapters.kibbleForget('wr');
  AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'wr', observedAt: Date.now() }));
  window.__o = [];
  const real = AQ.stage.render;
  AQ.stage.render = function (beat, pp, st, now, beats, i2, focus) {
    const r = real.apply(this, arguments);
    try {
      const w = AQ.room.lastWalk(), d = AQ.room.lastWriteDraw();
      window.__o.push({ i: i2, p: pp, kind: beat.kind,
                        w: w ? w.w : null, x: w ? w.x : null, y: w ? w.y : null,
                        memo: d.memo, pin: d.pinned });
    } catch (e) {}
    return r;
  };
  AQ.app.focusOn('did:key:zChatA');
}, MSGS);

await page.waitForTimeout(32000);   // 2026-10-03 動きを半分の速さにしたので2倍
const info = await page.evaluate(() => ({
  o: window.__o,
  kinds: AQ.app.beats.reduce((a, b) => { a[b.kind] = (a[b.kind] || 0) + 1; return a; }, {}),
  verb: (document.querySelector('.win .verb') || {}).textContent || '',
  obj:  (document.querySelector('.win .objline') || {}).textContent || '',
  wantVerb: AQ.i18n.t('act.actbatch'),
  /* 画面に出ている回数と、ログから数え直した本当の回数 */
  shown: AQ.app.clock.beats.map(b => {
    const seen = {}; let n = 0;
    (b.events || []).forEach(e => {
      const k = (e && e.meta && e.meta.seq != null) ? String(e.meta.seq) : null;
      if (k == null) { n++; return; }
      if (!seen[k]) { seen[k] = true; n++; }
    });
    return { kind: b.kind, events: (b.events || []).length, writes: n,
             trips: AQ.room.tripsForCount(n) };
  })
}));

console.log('コマの種類: ' + JSON.stringify(info.kinds));
console.log('文字: 「' + info.verb + '」 / 「' + info.obj + '」');

/* ---- 4) 文字 ---- */
if (info.verb !== info.wantVerb) fail('動詞が「' + info.wantVerb + '」になっていない: ' + info.verb);
const w0 = info.shown.filter(s => s.kind === 'actbatch')[0];
if (w0) {
  if (w0.events === w0.writes) fail('発言1件＝イベント2件のはずが同数（フィクスチャが想定と違う）');
  if (info.obj.indexOf(String(w0.writes)) === -1) {
    fail(`画面の回数が本当の回数（${w0.writes}）と違う: ${info.obj}（イベント数は ${w0.events}）`);
  }
  if (info.obj.indexOf(String(w0.events)) !== -1) {
    fail('画面にイベント数（' + w0.events + '）が出ている＝発言の回数ではない: ' + info.obj);
  }
}

/* ---- コマごとにまとめる ---- */
const beats = [];
info.o.forEach(f => {
  if (f.i < 0 || f.x == null) return;
  let b = beats[beats.length - 1];
  if (!b || b.i !== f.i) { b = { i: f.i, kind: f.kind, frames: [] }; beats.push(b); }
  b.frames.push(f);
});
if (beats.length < 2) fail('観測できたコマが少なすぎる（' + beats.length + '）');

let prevEnd = null;
beats.forEach(b => {
  const fr = b.frames;
  const first = fr[0], last = fr[fr.length - 1];
  const xs = fr.map(f => f.x), ys = fr.map(f => f.y);
  const span = (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys));
  const memo = fr.filter(f => f.memo > 0).length;
  const pin  = fr.filter(f => f.pin > 0).length;
  console.log(`  コマ${b.i} ${b.kind}: ${fr.length}フレーム / 移動幅 ${span.toFixed(1)}` +
              ` / メモを持った ${memo} / 板に貼った ${pin}`);

  /* 2) 棒立ちでないこと */
  if (b.kind === 'actbatch' && span < 2) fail(`コマ${b.i}: ほとんど動いていない（移動幅 ${span}）`);

  /* 1) ワープしないこと（前のコマの終わり＝次のコマの始まり） */
  if (prevEnd && last.p >= 0.9) {
    const d = Math.abs(prevEnd[0] - first.x) + Math.abs(prevEnd[1] - first.y);
    if (d > 0.5) fail(`コマ${b.i}: 前のコマの終わりから ${d.toFixed(1)} マス飛んでいる（ワープ）`);
  }
  if (last.p >= 0.9) prevEnd = [last.x, last.y];

  /* 3) 記録している動作が実際に描かれていること */
  if (b.kind === 'actbatch' && fr.length > 30) {
    if (!memo) fail(`コマ${b.i}: メモを持って歩く絵が1フレームも描かれていない`);
    if (last.p >= 0.9 && !pin) fail(`コマ${b.i}: 板に貼る絵が1フレームも描かれていない`);
  }
});

/* ---- 5) （2026-09-28 撤去）回数が多いほど往復が増える ----
   往復の加速はやめた：件数が多い場面だけ速く歩くのが「再生速度の設定と
   違う速さ」に見えたため。代わりに、どの場面でも歩く速さが一定であることを
   tools/shot-pace.mjs が実測で確かめる（書き込みをまとめたコマも含む）。 */

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
