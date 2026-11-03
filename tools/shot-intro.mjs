/* tools/shot-intro.mjs — 「x402ってなに？」入門の検査（2026-09-13）
   使い方: node tools/shot-intro.mjs   （dist/agent-quest.html を先に build）

   ★ 何を確かめるか
     ① 何も押さなくても、起動しただけで入門が再生されていること
        （このアプリの目的は x402 の認知向上なのに、起動画面が
          「右の一覧から選んでください」で、x402 の3文字も無かった）
     ② ①〜⑤の帯が 1→2→2→3→4→5→5 の順に進み、一度も後戻りしないこと
     ③ 右の説明が段階ごとに変わり、同じ段階でも
        「402が返った」と「払っていないので断られた」／
        「もう一度取りに行く」と「受け取れた」を書き分けていること
     ④ 「これは作り話です」が必ず画面に出ていること
        （本物のログだと思われたら、このアプリの約束が崩れる）
     ⑤ ほかのデモを読み込んだあとでも、ボタン1つで入門に戻れること
     ⑥ 画面からはみ出さないこと（帯が5段階に増えたので） */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

/* 入門のコマは、この種類がこの順で並ぶ（data/runs/x402intro.js のとおり）。
   期待する段階もここに書いておく＝実装を実装と比べる検査にしない。 */
const WANT = [
  { kind: 'start',   step: 0 },
  { kind: 'plan',    step: 0 },
  { kind: 'travel',  step: 1 },
  { kind: 'require', step: 2 },
  { kind: 'error',   step: 2 },   // 払っていないので断られた
  { kind: 'pay',     step: 3 },
  { kind: 'settle',  step: 4 },
  { kind: 'receive', step: 5 },
  { kind: 'end',     step: 0 }
];

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

for (const lang of ['ja', 'en']) {
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
    await page.goto(FILE);
    await page.waitForFunction(() => window.AQ && window.AQ.app);
    /* 2026-10-02: 開くとまず「どのエージェントを見ますか？」の画面が出る。
       入門は③「はじめての人：x402 の流れを見る」を押したときに始まる。 */
    if (lang === 'en') await page.evaluate(() => { AQ.i18n.set('en'); AQ.hud.relabel(); });
    await page.click('#startDemo');
    await page.waitForTimeout(900);

    console.log(`\n[${lang} ${vp.width}x${vp.height}]`);

    /* ---- ① 何も押さずに動いているか ---- */
    const boot = await page.evaluate(() => ({
      playing: AQ.app.clock.playing,
      chosen:  AQ.app.hasChosen,
      beats:   AQ.app.clock.beats.length,
      hint:    (document.getElementById('hint') || {}).textContent || '',
      btn:     (document.getElementById('introBtn') || {}).textContent || '',
      fake:    AQ.i18n.t('x402.introFake'),
      rosterHidden: !!(document.getElementById('roster') || {}).hidden
    }));
    console.log(`  自動再生=${boot.playing} / 選択ずみ=${boot.chosen} / ${boot.beats}コマ / 一覧は畳んである=${boot.rosterHidden}`);
    if (!boot.playing) fail('「はじめての人」を押しても再生が始まらない（x402 が見られない）');
    if (!boot.chosen)  fail('「まだ選んでいない」状態のまま＝ロボットが描かれない');
    if (boot.beats !== WANT.length) fail(`コマ数が違う（期待 ${WANT.length} / 実測 ${boot.beats}）`);
    if (!boot.btn) fail('「x402ってなに？」ボタンに文字が入っていない');
    if (boot.hint !== boot.fake) fail('「作り話です」の断りが出ていない: ' + boot.hint.slice(0, 40));
    if (!boot.rosterHidden) fail('入門なのに一覧が開いている（選ぶものが無いのに選べと出る）');

    /* ---- ②③ 1コマずつ見る ---- */
    const seen = [];
    for (let i = 0; i < WANT.length; i++) {
      const s = await page.evaluate((idx) => {
        AQ.app.clock.pause(); AQ.app.clock.seek(idx);
        const cur = document.querySelector('.win .progress.x402 .step.current .lab');
        const all = document.querySelectorAll('.win .progress.x402 .step');
        const side = document.getElementById('sideNote');
        return {
          kind: (AQ.app.clock.beats[idx] || {}).kind,
          steps: all.length,
          cur: cur ? cur.textContent.trim() : '',
          side: (side && !side.hidden) ? side.textContent : '',
          over: document.documentElement.scrollHeight - window.innerHeight
        };
      }, i);
      /* いまの段階は「▲いまここ」が付いた丸数字から読む（画面が真実） */
      const n = ['①', '②', '③', '④', '⑤'].findIndex(g => s.cur.indexOf(g) === 0) + 1;
      seen.push({ kind: s.kind, step: n, side: s.side, over: s.over });
      const w = WANT[i];
      if (s.kind !== w.kind) fail(`コマ${i} の種類が違う（期待 ${w.kind} / 実測 ${s.kind}）`);
      if (n !== w.step) fail(`コマ${i}（${s.kind}）の段階が違う（期待 ${w.step || 'なし'} / 実測 ${n || 'なし'}）`);
      if (w.step && s.steps !== 5) fail(`①〜⑤が5つ揃っていない（${s.steps}）`);
      if (w.step && !s.side) fail(`コマ${i}（${s.kind}）に「なぜ」の説明が出ていない`);
      if (s.over > 0) fail(`コマ${i} で画面からはみ出している（${s.over}px）`);
    }
    console.log('  段階の並び: ' + seen.map(x => x.kind + '→' + (x.step || '—')).join(' '));

    /* 後戻りしないこと（①〜⑤が行ったり来たりすると道すじに見えない） */
    let prev = 0;
    seen.forEach((x, i) => { if (x.step) { if (x.step < prev) fail(`段階が後戻りした（コマ${i}）`); prev = x.step; } });

    /* ---- ③ 同じ段階でも文を書き分けているか ---- */
    const s2 = seen[3].side, s2b = seen[4].side;          // require / error（どちらも②）
    /* ★ 2026-10-08: 確定のあとに「もう一度取りに行く」コマは外した（x402 の仕様では
       許可証は③の依頼に付けて渡し、確定のあと同じ依頼への返事として中身が来る）。
       ⑤は「受け取れた」の1コマだけ。④の説明とは別の文になっていること。 */
    const s5a = seen[6].side, s5 = seen[7].side;          // settle（④）/ receive（⑤）
    if (!s2 || s2 === s2b) fail('②で「402が返った」と「払っていないので断られた」が同じ文になっている');
    if (!s5 || s5 === s5a) fail('⑤の「受け取れた」の説明が出ていない（または④と同じ文）');
    console.log('  ②の書き分け: ' + s2.slice(0, 22) + ' ／ ' + s2b.slice(0, 22));
    console.log('  ⑤の書き分け: ' + s5a.slice(0, 22) + ' ／ ' + s5.slice(0, 22));

    /* ---- ③' 街の絵に「誰が・どこで」が出ているか（2026-09-14）----
       報告:「肝心のエージェントがどこにいるかわかりません」。
       原因は render() が焦点を String() に潰していたこと（焦点は
       { actor } という形なので "[object Object]" になり、誰にも
       一致せず、街ではロボットが1体も描かれなかった）。
       ここでは「描くロボットが居ること」「名札が #N＋呼び名であること」
       「頼んだ相手の建物の前に立っていること」「確定は立会所であること」
       を、実際の描画と同じ計算（computeRobotScreenPositions / _route）で見る。 */
    const world = await page.evaluate(() => {
      const out = [];
      AQ.app.clock.beats.forEach((b, i) => {
        /* ★ アプリ自身に描かせて、描かれたものだけを見る。
           computeRobotScreenPositions を呼ぶだけだと render() の中を
           通らないので、「街からロボットが消える」種類の不具合を
           すり抜ける（実際にすり抜けた）。 */
        AQ.app.clock.pause(); AQ.app.clock.seek(i);
        const drawn = AQ.scene.lastDrawnRobots();
        const end = b._route ? b._route[b._route.length - 1] : null;
        out.push({ i: i, kind: b.kind, robots: drawn.length,
                   tag: drawn.length ? drawn[0].tag : '',
                   target: (b.lead && b.lead.target) || null, end: end });
      });
      /* 街のどの建物が api.example.dev / 立会所 か（世界の定義から取る） */
      const objs = AQ.world.objects;
      const shop  = objs.filter(o => o.label === 'api.example.dev')[0];
      const facil = objs.filter(o => o.id === 'facil')[0];
      return { out: out, shopAt: shop ? shop.at : null, facilAt: facil ? facil.at : null,
               tag: AQ.i18n.t('scene.facilitator') };
    });
    const same = (a, b2) => !!a && !!b2 && a[0] === b2[0] && a[1] === b2[1];
    world.out.forEach(w => {
      if (w.kind === 'start' || w.kind === 'end' || w.kind === 'plan') return;
      if (!w.robots) fail(`コマ${w.i}（${w.kind}）で街にロボットが1体も描かれない`);
      else if (!/^#\d+\s/.test(w.tag)) fail(`コマ${w.i} の名札が「#番号 呼び名」になっていない: ${w.tag}`);
      if (w.target && !same(w.end, world.shopAt)) {
        fail(`コマ${w.i}（${w.kind}）が頼んだ相手（api.example.dev）の前に立っていない: ` + JSON.stringify(w.end));
      }
      /* ★ 2026-10-06: 実際の x402 では、許可証を立会人へ回すのはお店。確定のあいだロボットは
         店の前で待つ（立会所へは行かない） */
      if (w.kind === 'settle' && !same(w.end, world.shopAt)) {
        fail('確定のコマでロボットが店の前で待っていない（立会所へ行ってしまう）: ' + JSON.stringify(w.end));
      }
    });
    if (!world.facilAt) fail('街に立会所（ファシリテータ）が無い');
    if (!world.tag) fail('立会所の看板の文言が無い');
    console.log(`  街: 立会所=${JSON.stringify(world.facilAt)}「${world.tag}」 / ` +
                `お店=${JSON.stringify(world.shopAt)} / ロボットの居るコマ=` +
                world.out.filter(w => w.robots).length + '/' + world.out.length);

    /* ---- ③'' 段階の言葉が「誰が何を」になっているか ---- */
    const words = await page.evaluate(() => [1, 2, 3, 4, 5].map(n => AQ.i18n.t('x402.step' + n))
                        .concat([1, 2, 3, 4].map(n => AQ.i18n.t('progress.step' + n))));
    /* 「頼んだ」「出された」のような、主語も相手も無い短い語が残っていないか。
       6文字未満＝ほぼ動詞1語、と機械的に見る（日本語・英語とも）。 */
    const bare = words.filter(w => w.length < 6);
    if (bare.length) fail('主語の無い短い段階名が残っている: ' + bare.join(' / '));

    /* ---- ③''' LIVE につないだまま入門を押したら、接続を切るか（2026-09-14）
       報告の画面では、LIVE 接続中に「x402ってなに？」を押した結果、
       入門の10コマに kibble が後ろから流れ込んで404コマになっていた
       （＝誰が主役なのか分からない画面）。入門は1体だけの静かな1本で
       あることが値打ちなので、押した時点で必ず切る。 */
    const cut = await page.evaluate(() => {
      let stopped = false;
      const realStop = AQ.live.stop;
      AQ.live.stop = function () { stopped = true; return realStop.apply(this, arguments); };
      AQ.live.running = true;                    // つないでいるふり
      document.getElementById('introBtn').click();
      AQ.live.stop = realStop;
      AQ.live.running = false;
      return { stopped: stopped, beats: AQ.app.clock.beats.length,
               /* 2026-09-28: ボタンは記号（●）になり、言葉は aria-label に
                  移った。見るのは「接続する」側の言葉に戻ったか、と、
                  接続中の赤い点滅（live-on）が消えたか。 */
               connectLabel: (document.getElementById('connect') || {}).getAttribute('aria-label') || '',
               connectWord: String(AQ.i18n.t('ui.connect')).replace(/^[^\p{L}\p{N}]+/u, '').trim(),
               liveOn: document.getElementById('connect').classList.contains('live-on') };
    });
    console.log('  LIVE中に入門を押す: 切断した=' + cut.stopped + ' / ' + cut.beats + 'コマ');
    if (!cut.stopped) fail('LIVE につないだまま入門を押しても接続が切れない（kibble が入門に流れ込む）');
    if (cut.beats !== WANT.length) fail('入門のコマ数になっていない（' + cut.beats + '）');
    if (cut.connectLabel !== cut.connectWord) fail('ボタンの文字が「接続する」に戻っていない');
    if (cut.liveOn) fail('接続を切ったのに LIVE の赤い点滅が残っている');

    /* ---- ④ 最後のコマに「つまり x402 とは」があるか ---- */
    const recap = seen[seen.length - 1].side;
    if (!recap) fail('最後のコマに持ち帰るまとめが無い');

    /* ---- ⑤' 入門を抜けたら一覧が必ず戻ること（2026-09-13(2) の不具合）
       報告:「仕事の札やエージェントを選ぶ欄がなくなりました」。
       入門の間だけ一覧を畳む実装にしたのに、LIVE でつないだときに
       入門モードが解除されず、畳まれたまま何も選べなくなっていた。
       データを入れ替える道は4本あるので、そのすべてで確かめる
       （デモ・ファイル読み込み・LIVE の初回・最新に追いつく——
       後ろ2つは実際の通信をせず、同じ入口 loadEvents を叩いて再現する）。 */
    const KIBBLE = [
      { seq: 1, from: 'did:key:zA', text: 'JOB v1 | kR1 | build | Something | d', ts: new Date(1758300000000).toISOString() },
      { seq: 2, from: 'did:key:zB', text: 'CLAIM v1 | kR1 | builder',            ts: new Date(1758300040000).toISOString() },
      { seq: 3, from: 'did:key:zB', text: 'DELIVER v1 | kR1 | done',             ts: new Date(1758300090000).toISOString() }
    ];
    const ways = await page.evaluate((msgs) => {
      const out = [];
      const check = (how) => out.push({
        how: how,
        rosterHidden: !!document.getElementById('roster').hidden,
        rows: document.querySelectorAll('.roster .arow, .roster .jrow').length,
        hint: (document.getElementById('hint') || {}).textContent || '',
        win:  (document.querySelector('.win') || {}).innerText || ''
      });
      const backToIntro = () => document.getElementById('introBtn').click();

      backToIntro(); AQ.app.loadRun('team');                       check('ほかのデモ');
      backToIntro();
      AQ.adapters.kibbleForget('reg');
      AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'reg', observedAt: Date.now() }));
      check('LIVE 相当（kibble を読み込む）');
      backToIntro();
      AQ.app.loadEvents(AQ.adapters.fromKibble(msgs, { room: 'reg2', observedAt: Date.now() }));
      check('最新に追いつく相当');
      backToIntro();
      check('入門に戻った');
      return { out: out, fake: AQ.i18n.t('x402.introFake') };
    }, KIBBLE);

    ways.out.forEach(w => {
      const isIntroNow = (w.how === '入門に戻った');
      console.log(`  ${w.how}: 一覧は畳んである=${w.rosterHidden} 行=${w.rows}`);
      if (!isIntroNow) {
        if (w.rosterHidden) fail(w.how + ' のあと一覧が畳まれたまま（選ぶ欄が消える）');
        if (!w.rows) fail(w.how + ' のあと一覧に行が1つも無い');
        if (w.hint === ways.fake) fail(w.how + ' のあとも「作り話です」が出たまま');
      } else {
        if (!w.rosterHidden) fail('入門に戻ったのに一覧が開いている');
        if (w.hint !== ways.fake) fail('入門に戻ったのに断りが出ていない');
      }
    });

    /* ---- ⑤ ほかのデモを読んでも戻れるか ---- */
    await page.evaluate(() => { document.getElementById('introBtn').click(); });
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => {
      AQ.app.loadRun('burst');
      const away = { hint: (document.getElementById('hint') || {}).textContent || '',
                     chosen: AQ.app.hasChosen };
      document.getElementById('introBtn').click();
      return { away: away,
               backPlaying: AQ.app.clock.playing,
               backBeats: AQ.app.clock.beats.length,
               backHint: (document.getElementById('hint') || {}).textContent || '',
               fake: AQ.i18n.t('x402.introFake') };
    });
    if (back.away.hint === back.fake) fail('ほかのデモを読んでも「作り話です」が出たまま');
    if (!back.backPlaying) fail('ボタンを押しても入門が再生されない');
    if (back.backBeats !== WANT.length) fail('ボタンで戻ったのに入門のコマ数でない');
    if (back.backHint !== back.fake) fail('ボタンで戻ったのに断りが出ていない');
    console.log('  ほかのデモ→ボタンで復帰: 再生=' + back.backPlaying + ' / ' + back.backBeats + 'コマ');

    await page.close();
  }
}

await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
