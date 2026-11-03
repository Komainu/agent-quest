/* tools/shot-layout.mjs — 実況欄と盤面の取り合い／x402 の解説の出どころ
   （2026-09-19）。使い方: node tools/shot-layout.mjs

   ★ 何を確かめるか（利用者の2つの報告）
     ①「文字を表示する枠が大きくなり過ぎて、ロボットの動きを表現する枠が
        小さくなっています」
        → 主語・目的語・動詞を1行にまとめた。実況欄はどのコマでも
          一定の高さに収まり、盤面はそのぶん大きいこと。
     ②「なぜか X402 の説明が割り込んでいます。X402 ボタンは押していません」
        → 支払いが1件も無いログ（kibble の部屋）では、x402 の①〜⑤も
          その解説も絶対に出ないこと。以前は「③納品」のコマが x402 の
          ⑤と判定され、押してもいない解説が右に出ていた。 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();

/* 支払いが1件も無い、ふつうの kibble の部屋 */
const MSGS = [];
{
  let s = 1, t = 0;
  for (let i = 0; i < 12; i++) {
    const id = 'kLay' + i;
    MSGS.push({ seq: s++, from: 'did:key:zPost',  text: `JOB v1 | ${id} | build | Job ${i} about the pier | d`, ts: iso(t += 1000) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 1000) });
    MSGS.push({ seq: s++, from: 'did:key:zWork',  text: `DELIVER v1 | ${id} | done`,  ts: iso(t += 1000) });
    MSGS.push({ seq: s++, from: 'did:key:zJudge', text: `ATTEST v1 | ${id} | useful | ok`, ts: iso(t += 1000) });
  }
}

/* 実況欄の高さの上限。1行にまとめた今の作りでの実測（102px）に、
   文言が少し伸びても耐える余裕を足した値。ここを超えたら、また
   盤面を押し潰し始めているということ。 */
const WIN_MAX = 135;

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

for (const vp of [{ width: 1860, height: 880 }, { width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  for (const mode of ['job', 'agent']) {
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
    await page.goto(FILE);
    await page.waitForFunction(() => window.AQ && window.AQ.app);
    await page.evaluate(({ m, mo }) => {
      AQ.adapters.kibbleForget('lay');
      AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'lay', observedAt: Date.now() }));
      if (mo === 'agent') { AQ.app.setListMode('agents'); AQ.app.focusOnAgent('did:key:zWork'); }
      else { AQ.app.focusOnJob(AQ.app.jobIndex.list[0].id); }
    }, { m: MSGS, mo: mode });
    await page.waitForTimeout(900);

    const n = await page.evaluate(() => AQ.app.clock.beats.length);
    let winMax = 0, overMax = 0, canvas = 0, leaked = [], lines = 0;
    for (let i = 0; i < n; i++) {
      const r = await page.evaluate((k) => {
        AQ.app.clock.pause(); AQ.app.clock.seek(k);
        const win = document.querySelector('.win');
        const sn = document.getElementById('sideNote');
        const sideTxt = (sn && !sn.hidden) ? sn.textContent : '';
        /* x402 の解説の文が1つでも混ざっていないか（文言そのもので照合） */
        const x402Keys = ['x402.why1','x402.why2','x402.why2b','x402.why3',
                          'x402.why4','x402.why5','x402.why5a','x402.recap'];
        const leak = x402Keys.filter(key => {
          const v = AQ.i18n.t(key);
          return v && sideTxt.indexOf(v.slice(0, 20)) !== -1;
        });
        return {
          win: Math.round(win.getBoundingClientRect().height),
          lines: win.children.length,
          bar402: document.querySelectorAll('.win .progress.x402').length,
          leak: leak,
          canvas: Math.round(document.getElementById('scene').getBoundingClientRect().height),
          over: document.documentElement.scrollHeight - window.innerHeight,
          /* 主語・目的語・動詞が同じ1行に入っているか */
          sayline: !!document.querySelector('.win .sayline'),
          sayRows: (() => {
            const el = document.querySelector('.win .sayline');
            if (!el) return 0;
            const tops = new Set();
            Array.prototype.forEach.call(el.children, c => tops.add(Math.round(c.getBoundingClientRect().top)));
            return tops.size;
          })()
        };
      }, i);
      winMax = Math.max(winMax, r.win);
      overMax = Math.max(overMax, r.over);
      canvas = r.canvas; lines = Math.max(lines, r.lines);
      if (r.leak.length) leaked = leaked.concat(r.leak);
      if (r.bar402) fail(`${vp.width}x${vp.height} ${mode} コマ${k}: 支払いの無いログに x402 の①〜⑤の帯が出ている`);
      if (!r.sayline) fail(`${vp.width}x${vp.height} ${mode} コマ${i}: 主語・動詞が1行にまとまっていない`);
      if (r.sayRows > 2) fail(`${vp.width}x${vp.height} ${mode} コマ${i}: 1文が ${r.sayRows} 行に割れている`);
    }
    console.log(`  ${vp.width}x${vp.height} ${mode}: 実況の最大 ${winMax}px / 盤面 ${canvas}px / ` +
                `実況のブロック ${lines} / はみ出し ${overMax}px`);
    if (winMax > WIN_MAX) fail(`実況欄が大きすぎる（${winMax}px > ${WIN_MAX}px）＝盤面を押し潰している`);
    if (canvas < winMax * 2) fail(`盤面（${canvas}px）が実況欄（${winMax}px）の2倍に届かない＝主役が小さい`);
    if (overMax > 0) fail(`画面からはみ出している（${overMax}px）`);
    if (leaked.length) {
      fail('押していないのに x402 の解説が出ている: ' + Array.from(new Set(leaked)).join(', '));
    }
    await page.close();
  }
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
