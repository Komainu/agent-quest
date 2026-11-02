/* 2026-09-28: 往復の加速はやめた（どのコマも1往復）。件数ごとの往復回数の
   検査は「1往復であること」に置き換えた。速さが一定かは shot-pace.mjs が見る。

   tools/shot-trips.mjs — 「件数ぶん往復」「納品中」「0件の段階」の検査（2026-09-13）
   使い方: node tools/shot-trips.mjs   （dist/agent-quest.html を先に build）

   ★ 何を確かめるか
     ① 件数の多い段階は、ロボットが同じ道を何度も往復する。
        往復の回数は件数の桁数（10〜99件=2／100〜999件=3、上限5）。
        画面座標ではなく世界座標で測る——カメラが本人を追うので、
        画面上では往復してもほとんど動かず、測ったつもりになる。
     ② 運んでいる最中は進行形（納品中）、置き終わったら完了形（納品した）。
     ③ その子がやらない段階は 0件 とはっきり書く（「①出された は
        使いませんね？」への対応）。件数・0件の区別そのものは正確な
        まま残っていることを見る。
     ④ 往復しても札が消えるフレーム（どこにも描かれない）が出ないこと。

     ①②④はロボットの歩き（world 座標）と実況の動詞（.win .verb）を
     見ているだけで、①〜④の帯とは無関係——帯を画面から外した後も
     手を付けていない。

   ★ 2026-09-27: ①〜④の帯を画面から外したのに合わせて、③の検査対象を
     移した・一部削除した。

     ・件数の表示（「トラ が 101件 引き受けた」／0件は取り消し線）は、
       progressRow() という1つの関数が「依頼1件を追う帯」と「エージェント
       のまとめ（件数）帯」の両方を出していた同じコードで、帯そのものが
       呼ばれなくなったのでこちらも道連れで画面から消えた
       （hud.js で progressRow() の呼び出し元がコメント以外どこにも
       無いことを確認済み）。件数と0件の区別という事実そのものは
       「詳細」パネル（agentDetailBlock。#detailBody .whoblock）に
       段階ごとの件数＋依頼IDとして残っているので、そちらを検査する。
       ラベルの文言（取り消し線・「していません」という言い回し）は
       帯だけの見た目だったので引き継がない——「0件であることが
       捏造でなくはっきり分かる」という中身の保証だけを立て直す。

     ・「読み方の説明（画面右の #sideNote、①〜④は依頼の道すじで1体が
       4つ全部をやるとはかぎらない）」は削除した。hud.js 側に
       「2026-09-27: 『①〜④の読み方』のメモはここから外した…この欄に
       残るのは x402 の『なぜ』だけ」という同日付のコメントがあり、
       帯を外した結果として読み方を説明する相手ごと画面から無くなった
       （移し替え先が無い、道連れの削除）。詳細パネルは常に件数と
       依頼IDを出すだけの一覧で、「なぜ0件のものがあるのか」という
       説明文を持たない設計なので、ここへ移すのも筋が違う。 */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

const iso = (ms) => new Date(1758300000000 + ms).toISOString();
const POSTER = 'did:key:zPoster', W = 'did:key:zWorker', JUDGE = 'did:key:zJudge';

/* 依頼を N 件。出すのは POSTER、引き受けて納品するのは W、判定は JUDGE。
   ＝W は「やる係」だけ。①出された・④判定 は必ず 0 件になる。 */
function build(n) {
  const msgs = [];
  let seq = 1, t = 0;
  for (let i = 0; i < n; i++) {
    const id = 'kT' + i;
    msgs.push({ seq: seq++, from: POSTER, text: `JOB v1 | ${id} | build | Job ${i} title | d`, ts: iso(t += 1000) });
    msgs.push({ seq: seq++, from: W,      text: `CLAIM v1 | ${id} | builder`,                  ts: iso(t += 1000) });
    msgs.push({ seq: seq++, from: W,      text: `DELIVER v1 | ${id} | done ${i}`,              ts: iso(t += 1000) });
    msgs.push({ seq: seq++, from: JUDGE,  text: `ATTEST v1 | ${id} | useful | ok`,             ts: iso(t += 1000) });
  }
  return msgs;
}

/* 件数 → 期待する往復回数（src/render/room.js の tripsForCount と同じ規則。
   ここに規則をもう一度書いておくのは、実装をそのまま呼んで
   「実装＝実装」と比べる無意味な検査にしないため）。 */
const expectTrips = (c) => (c <= 9 ? 1 : Math.max(1, Math.min(5, String(c).length)));

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/* 3件（1往復のまま）と 40件（2往復）と 150件（3往復）で比べる。
   ＝件数が増えたときだけ絵が変わることを見る。 */
for (const N of [3, 40, 150]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
  await page.goto(FILE);
  await page.waitForFunction(() => window.AQ && window.AQ.app);

  await page.evaluate(({ msgs, W }) => {
    AQ.adapters.kibbleForget('trips');
    AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'trips', observedAt: Date.now() }));
    window.__obs = [];
    const real = AQ.stage.render;
    AQ.stage.render = function (beat, pp, st, now, beats, index2, focus) {
      const r = real.apply(this, arguments);
      try {
        const walk = AQ.room.lastWalk();
        const an   = AQ.room.lastAnim();
        const trays = AQ.room.computeBoardLayout(index2, focus).count +
                      AQ.room.computeDropoffLayout(index2, focus).count +
                      AQ.room.computeInspectLayout(index2, focus).count;
        const held = AQ.room.lastHeldCards();
        window.__obs.push({
          i: index2, p: pp, kind: beat.kind, trips: an && an.trips, back: an && an.back,
          x: walk ? walk.x : null, y: walk ? walk.y : null, raw: walk ? walk.raw : null,
          roundTrip: walk ? walk.roundTrip : null,
          verb: '',
          ghost: (trays === 0 && held.length === 0)
        });
      } catch (e) {}
      return r;
    };
    /* 実況の文字は stage.render の後に書き換わる（main.js は render →
       hud.update の順）。render の中で DOM を読むと1フレーム前の文が
       取れてしまうので、hud.update の直後に同じフレームへ書き戻す。 */
    const realHud = AQ.hud.update;
    AQ.hud.update = function () {
      const r = realHud.apply(this, arguments);
      const last = window.__obs[window.__obs.length - 1];
      const verbEl = document.querySelector('.win .verb');
      if (last) last.verb = verbEl ? verbEl.textContent : '';
      return r;
    };
    AQ.app.setListMode('agents');
    AQ.app.focusOnAgent(W);
  }, { msgs: build(N), W });

  await page.waitForTimeout(28000);   // ②③の2コマぶん（2026-10-03 動きを半分の速さにしたので2倍）（この子は②③しか持たない）

  const info = await page.evaluate(() => ({
    obs: window.__obs,
    counts: AQ.app.agentStory.counts,
    sceneStep: AQ.app.agentStory.sceneStep,
    /* ★ 2026-09-27: 件数（0件／N件）の保証は「詳細」パネル
       （agentDetailBlock）へ移した。①〜④それぞれの .drow を、先頭の
       丸数字で選び出す（同じ .whoblock に依頼と無関係な行は無いが、
       他の詳細検査と選び方をそろえておく）。 */
    detailRows: Array.prototype.map.call(
      /* 2026-09-28: 詳細には、その子の内訳（先頭の .whoblock）の下に、いま再生
         している依頼の関係者（2つめの .whoblock）も並ぶようになった。
         ここで見るのは先頭＝その子の内訳だけ。 */
      (document.querySelector('#detailBody .whoblock') || document.createElement('div')).querySelectorAll('.drow'),
      e => e.textContent.trim())
      .filter(s => /^[①②③④]/.test(s)),
    detailHead: (document.querySelector('#detailBody .whoblock') || {}).textContent || '',
    detailNone: AQ.i18n.t('detail.none'),
    starActor: AQ.app.agentStory.starring,
    starNick: AQ.nick.forActor(AQ.app.agentStory.starring),
    over: document.documentElement.scrollHeight - window.innerHeight,
    lines: (document.querySelector('.win') || { children: [] }).children.length,
    doneVerb: AQ.i18n.t('act.deliver'), ingVerb: AQ.i18n.t('act.deliver.ing')
  }));
  await page.close();

  const { obs, counts, sceneStep } = info;
  console.log(`\n[依頼 ${N} 件 / この子は「やる係」だけ]  描画 ${obs.length} フレーム`);
  console.log(`  件数: ①${counts[1]} ②${counts[2]} ③${counts[3]} ④${counts[4]}`);

  /* ---- ③ 0件の段階の書き方（詳細パネル側）------------------------- */
  if (counts[1] !== 0 || counts[4] !== 0) fail('この形では①④は0件のはず（フィクスチャが壊れている）');
  if (info.detailRows.length !== 4) {
    fail('詳細（関係者の内訳）が①〜④の4行そろっていない（' + info.detailRows.length + '）');
  } else {
    /* ①④＝0件。捏造した番号・件数を出さず、はっきり「無し」と書くこと。 */
    [1, 4].forEach(n => {
      const row = info.detailRows[n - 1];
      if (row.indexOf(info.detailNone) === -1) {
        fail(`0件のはずの段階${n}が「${info.detailNone}」になっていない: ` + row);
      }
    });
    /* ②③＝N件。件数の数字と、実在する依頼IDが両方出ていること
       （「トラが101件」ではなく本当にその件数・その依頼か）。 */
    [2, 3].forEach(n => {
      const row = info.detailRows[n - 1];
      if (row.indexOf(String(counts[n])) === -1) {
        fail(`段階${n}の件数（${counts[n]}）が詳細に出ていない: ` + row);
      }
      if (!/kT\d/.test(row)) {
        fail(`段階${n}に依頼IDが出ていない（件数だけで裏付けが無い）: ` + row.slice(0, 60));
      }
    });
  }
  /* この詳細がどの子のものかは、その子のDIDがブロックに出ていることで
     裏を取る（他の子の内訳を見せていないこと）。 */
  if (info.detailHead.indexOf(info.starActor) === -1) {
    fail('詳細にこの子のDIDが出ていない（誰の内訳か確かめられない）');
  }
  console.log('  詳細（①〜④）: ' + info.detailRows.map(s => s.replace(/\s+/g, ' ').slice(0, 40)).join(' / '));
  console.log('  実況の行数: ' + info.lines + ' / はみ出し: ' + info.over + 'px');
  if (info.over > 0) fail('画面からはみ出している（' + info.over + 'px）');
  if (info.lines > 6) fail('実況が6行を超えている（' + info.lines + '行）');

  /* ---- コマごとにまとめる ----------------------------------------- */
  const beats = [];
  obs.forEach(o => {
    if (o.i < 0 || o.x == null) return;
    let b = beats[beats.length - 1];
    if (!b || b.i !== o.i) { b = { i: o.i, kind: o.kind, frames: [] }; beats.push(b); }
    b.frames.push(o);
  });

  beats.forEach(b => {
    const step = sceneStep[b.i];
    /* 2026-09-28: 件数が多くても往復はしない（歩く速さを一定にしたため。
       往復のぶん速く歩くのが「0.25倍なのに猛然と走る」に見えた）。
       どのコマも1往復＝経路を1回だけ歩く。速さの検査は tools/shot-pace.mjs。 */
    const want = 1;
    const fr = b.frames.filter(f => f.raw != null);
    if (!fr.length) return;

    /* ---- ① 往復の回数を世界座標で数える --------------------------- */
    const x0 = fr[0].x, y0 = fr[0].y;
    const d = fr.map(f => Math.abs(f.x - x0) + Math.abs(f.y - y0));
    const dmax = Math.max.apply(null, d);
    let peaks = 0, state = 'out';
    d.forEach(v => {
      if (state === 'out' && v >= dmax * 0.85) { peaks++; state = 'in'; }
      else if (state === 'in' && v <= dmax * 0.25) { state = 'out'; }
    });
    /* 経路そのものが「行って戻る」形（②引き受けた）のときは、片道1本で
       山が1つできる。だから山の数＝片道の本数＝2n-1。
       一方通行の経路（③納品）は、行きだけが山になる＝山の数＝n。 */
    const roundTrip = !!fr[0].roundTrip;
    const wantPeaks = roundTrip ? (2 * want - 1) : want;
    const declared = fr[0].trips;
    console.log(`  コマ${b.i} ${b.kind}（段階${step} ${counts[step]}件 / ` +
                `経路${roundTrip ? '往復型' : '片道型'}）: ` +
                `宣言 ${declared}往復 / 山 ${peaks}（期待 ${wantPeaks}）/ 移動幅 ${Math.round(dmax)}`);
    if (declared !== want) fail(`往復の宣言が件数と合わない（${counts[step]}件 → ${want} のはずが ${declared}）`);
    /* ★ 2026-10-19 納品は「机で書き込む → すぐ横の納品口へ」になり（向こうのセッションの変更）、歩く道が1マス弱と短い。
       止まっているかどうかの境目は 0.5 マスにする */
    if (dmax < 0.5) fail('そもそも動いていない（移動幅 ' + dmax + '）');
    else if (peaks !== wantPeaks) fail(`実際に歩いた回数が違う（期待 山${wantPeaks} / 実測 ${peaks}）`);
    /* 1往復のときに「帰り道」が現れたら畳み方が壊れている */
    const backs = fr.filter(f => f.back).length;
    if (want === 1 && backs > 0) fail('1往復なのに帰り道のフレームがある（' + backs + '）');
    if (want > 1 && backs === 0) fail('往復のはずなのに帰り道のフレームが1つも無い');

    /* ---- ④ 札が消えるフレームが無いこと --------------------------- */
    const ghosts = fr.filter(f => f.raw < 1 && f.ghost).length;
    if (ghosts) fail('運搬中に札がどこにも描かれないフレームが ' + ghosts + ' ある');

    /* ---- ② 納品中 → 納品した ------------------------------------- */
    if (step === 3) {
      const walking = fr.filter(f => f.raw < 0.99).map(f => f.verb);
      const done    = fr.filter(f => f.p >= 0.99).map(f => f.verb);
      const ingOk = walking.length && walking.every(v => v === info.ingVerb);
      if (!ingOk) fail('運んでいる最中に「' + info.ingVerb + '」になっていない: ' +
                       Array.from(new Set(walking)).join(' / '));
      if (done.length && done.some(v => v !== info.doneVerb)) {
        fail('置き終わっても完了形（' + info.doneVerb + '）に戻らない: ' +
             Array.from(new Set(done)).join(' / '));
      }
      console.log('    動詞: 運搬中「' + (walking[0] || '') + '」→ 終わり「' + (done[done.length - 1] || '(未観測)') + '」');
    }
  });
  if (!beats.length) fail('1コマも描かれなかった');
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
