/* tools/shot-places.mjs — 場所（仕事の部屋）の一覧（2026-09-30）
   使い方: node tools/shot-places.mjs

   ★ 提案（利用者）
     「場所の一覧を作って、地名をクリックするとその場所に飛べる感じがいい」
     → technocore.chat の部屋一覧から、ジオラマが動く「仕事の部屋」だけを並べ、
       地名を押すとその部屋へ LIVE でつなぐ。

   ★ 見るもの（technocore.chat はこの検査の中で偽物に差し替える＝実物には
     1回も問い合わせない。いつ走らせても同じ結果になる）
     ・並ぶのは、直近の行の半分以上が JOB / CLAIM / DELIVER / ATTEST の部屋だけ。
       雑談の部屋・読めなかった部屋は出ない。並び順は一覧（最近動いた順）のまま
     ・部屋の名前・説明に HTML が入っていても、文字として出る（要素にならない）
     ・「名前と説明は誰でも付けられる文字」という注意書きが付いている
     ・地名を押すと、その部屋へ LIVE でつながり、ログが読み込まれる。一覧は閉じる
     ・一覧は右の列（依頼／エージェントの一覧の下）に最初から出ている（2026-09-30 利用者の提案で移動）
     ・何部屋を確かめて何部屋が仕事の部屋だったかが添えてある（「なぜ1つだけ？」への答え）
     ・部屋を乗り換えても・言語を切り替えても、部屋の一覧も各部屋も読み直さない（10分覚えておく）
     ・↻ を押すと読み直す
     ・いまつないでいる部屋が一覧で分かる。同じ部屋を押してもつなぎ直さない
     ・確かめる部屋の数は上限（AQ.places.MAX_PROBE）まで
     ・部屋の一覧が読めないときは、読めなかったと出る
*/
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE ? 'file://' + process.env.AQ_FILE : 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');

const EVIL_NAME = 'x<b>y';
const EVIL_TOPIC = '<img src=x onerror="window.__pwned=1"> free money';
const ROOMS = [
  ['hxd-01-a', 'chat'], ['kibble', 'board'], ['lobby', 'chat'], ['job-hall', 'board', EVIL_TOPIC],
  ['broken', 'error'], [EVIL_NAME, 'board'], ['random', 'chat']
];
for (let i = 0; i < 45; i++) ROOMS.push(['filler-' + i, 'chat']);   // 上限（50）を超える数の部屋
ROOMS.push(['late-board', 'board']);                                // 上限より下＝確かめない

const LISTING = '# ' + ROOMS.length + ' of 63897 rooms (cap 300000), newest first\n' +
  '# !! UNTRUSTED NAMES — a room\'s name is a string its creator chose\n' +
  ROOMS.map(([n, k, topic], i) => `/r/${n.padEnd(24)} seq ${1000 + i}     1.2M  ${i * 7}s ago` + (topic ? `  · ${topic}` : '')).join('\n');

const iso = (ms) => new Date(Date.now() - 60000 + ms).toISOString();
function msgsFor(kind, room) {
  if (kind === 'board') {
    const out = []; let s = 1;
    for (let i = 0; i < 6; i++) {
      out.push({ seq: s++, from: 'did:key:zP', text: `JOB v1 | ${room.replace(/\W/g, '')}${i} | build | T ${i} | d`, ts: iso(s * 500) });
      out.push({ seq: s++, from: 'did:key:zW', text: `CLAIM v1 | ${room.replace(/\W/g, '')}${i} | builder`, ts: iso(s * 500) });
    }
    return out;
  }
  return Array.from({ length: 10 }, (_, i) => ({ seq: i + 1, from: 'did:key:zC', text: 'hello there ' + i, ts: iso(i * 500) }));
}

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1860, height: 1000 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });

const hits = { rooms: 0, probe: {}, poll: 0, other: 0 };
let roomsFail = false;
await page.route('https://technocore.chat/**', async (route) => {
  const u = new URL(route.request().url());
  const cors = { 'access-control-allow-origin': '*' };
  if (u.pathname === '/rooms') {
    hits.rooms++;
    if (roomsFail) return route.fulfill({ status: 503, headers: cors, body: 'busy' });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain' }, body: LISTING });
  }
  const m = u.pathname.match(/^\/r\/(.+)$/);
  if (m) {
    const room = decodeURIComponent(m[1]);
    const def = ROOMS.find(r => r[0] === room);
    if (u.searchParams.has('since')) {       // 長ポーリング：新着なし
      hits.poll++;
      await new Promise(r => setTimeout(r, 300));
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '[]' });
    }
    hits.probe[room] = (hits.probe[room] || 0) + 1;
    if (!def || def[1] === 'error') return route.fulfill({ status: 500, headers: cors, body: 'no' });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(msgsFor(def[1], room)) });
  }
  hits.other++;
  return route.fulfill({ status: 404, headers: cors, body: '' });
});

await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app && window.AQ.places);

async function panel() {
  return page.evaluate(() => {
    const p = document.getElementById('placesPanel');
    return {
      open: !p.hidden,
      rows: Array.from(p.querySelectorAll('.place-row')).map(b => ({
        room: b.getAttribute('data-room'), text: (b.querySelector('b') || {}).textContent, on: b.classList.contains('on'),
        title: b.getAttribute('title'), kids: b.querySelectorAll('*').length, imgs: b.querySelectorAll('img').length })),
      note: (p.querySelector('.places-note') || {}).textContent || '',
      notes: Array.from(p.querySelectorAll('.places-note')).map(n => n.textContent).join(' / '),
      side: !!p.closest('#sideCol'),
      warn: (document.getElementById('placesWarn') || {}).title || '',
      imgs: p.querySelectorAll('img').length
    };
  });
}
async function waitDone() {
  for (let i = 0; i < 80; i++) {
    const p = await panel();
    if (p.open && p.notes && !/確かめています|読んでいます/.test(p.notes)) return p;
    await page.waitForTimeout(100);
  }
  return panel();
}

/* 1) 最初から右の列に出ている → 仕事の部屋だけ */
const p1 = await waitDone();
if (!p1.side) fail('仕事の部屋の一覧が右の列に無い');
if (await page.$('#places')) fail('LIVE の欄のピン（前の置き場所）が残っている');
const want = ['kibble', 'job-hall', EVIL_NAME];
const got = p1.rows.map(r => r.room);
if (!p1.open) fail('仕事の部屋の一覧が出ていない');
if (!/50 部屋を確かめて、仕事の部屋 3/.test(p1.notes)) fail(`何部屋を確かめて何部屋が仕事の部屋か、が出ていない（"${p1.notes}"）`);
if (JSON.stringify(got) !== JSON.stringify(want)) fail(`並んだ部屋が違う: ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
if (got.includes('late-board')) fail('上限より下の部屋まで確かめている');
const probed = Object.keys(hits.probe).length;
const maxProbe = await page.evaluate(() => AQ.places.MAX_PROBE);
if (probed > maxProbe) fail(`${probed} 部屋も確かめた（上限 ${maxProbe}）`);
if (hits.rooms !== 1) fail(`部屋の一覧を ${hits.rooms} 回読んだ（1回のはず）`);
ok(`一覧: ${got.join(' / ')}（確かめた部屋 ${probed} / 上限 ${maxProbe}・雑談と読めない部屋は出ない）`);

if (process.argv.includes('--shots')) {
  const r = await page.evaluate(() => { const a = document.getElementById('sideCol').getBoundingClientRect(), c = document.querySelector('canvas').getBoundingClientRect();
    return { x: a.left - 10, y: c.top, width: a.width + 20, height: c.height }; });
  await page.screenshot({ path: (process.env.SHOT_DIR || (await import('node:os')).tmpdir()) + '/places.png', clip: r });
}

/* 2) 信用しない文字 */
const evil = p1.rows.find(r => r.room === EVIL_NAME);
if (!evil || evil.text !== EVIL_NAME) fail(`HTML の入った部屋名が文字として出ていない（"${evil && evil.text}"）`);
const plain = p1.rows.find(r => r.room === 'kibble');
if (evil && plain && evil.kids !== plain.kids) fail(`部屋名の中の HTML が要素になっている（行の中の要素 ${evil.kids} 個・ふつうの行は ${plain.kids} 個）`);
const hall = p1.rows.find(r => r.room === 'job-hall');
if (!hall || hall.title.indexOf(EVIL_TOPIC) === -1 || hall.imgs) fail('HTML の入った説明が、文字として説明（title）に出ていない／要素になっている');
if (p1.imgs || await page.evaluate(() => window.__pwned)) fail('説明の HTML が実行された');
if (!/自由に付けた文字/.test(p1.warn)) fail(`「名前と説明は誰でも付けられる」注意書きが無い（"${p1.warn}"）`);
ok('信用しない文字: 部屋名・説明の HTML は文字のまま / 注意書きあり');

/* 3) 地名を押す → その部屋へ LIVE */
await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.place-row')).find(x => x.getAttribute('data-room') === 'job-hall'); b.click(); });
await page.waitForTimeout(800);
const c1 = await page.evaluate(() => ({ running: AQ.live.running, room: AQ.live.room, input: document.getElementById('room').value,
  open: !document.getElementById('placesPanel').hidden, n: AQ.app.events.length,
  runs: Array.from(new Set(AQ.app.events.map(e => e.run))) }));
if (!c1.running || c1.room !== 'job-hall') fail(`地名を押しても、その部屋へつながっていない（${c1.running} ${c1.room}）`);
if (c1.input !== 'job-hall') fail('LIVE の欄に部屋の名前が入っていない');
if (!c1.n || !c1.runs.some(r => /job-hall/.test(String(r)))) fail(`その部屋のログが読み込まれていない（${c1.n} 件 ${c1.runs.join(',')}）`);
ok(`つなぐ: ${c1.room} / ログ ${c1.n} 件`);

/* 4) 読み直さない・いまの部屋が分かる */
const before = { rooms: hits.rooms, probe: JSON.stringify(hits.probe) };
await page.evaluate(() => { document.getElementById('lang').click(); document.getElementById('lang').click(); });
await page.waitForTimeout(300);
const p2 = await waitDone();
if (hits.rooms !== before.rooms || JSON.stringify(hits.probe) !== before.probe) fail('部屋を乗り換えた／言語を切り替えたら、部屋の一覧か各部屋を読み直した');
const onRows = p2.rows.filter(r => r.on).map(r => r.room);
if (JSON.stringify(onRows) !== '["job-hall"]') fail(`いまつないでいる部屋の印が違う: ${JSON.stringify(onRows)}`);
/* 同じ部屋を押しても、つなぎ直さない */
const startsBefore = await page.evaluate(() => { window.__starts = 0; const f = AQ.live.start; AQ.live.start = function () { window.__starts++; return f.apply(this, arguments); }; return 0; });
await page.evaluate(() => Array.from(document.querySelectorAll('.place-row')).find(x => x.getAttribute('data-room') === 'job-hall').click());
await page.waitForTimeout(200);
const re = await page.evaluate(() => ({ starts: window.__starts, running: AQ.live.running, room: AQ.live.room }));
if (re.starts || !re.running) fail(`同じ部屋を押したら、つなぎ直した／切れた（${JSON.stringify(re)}）`);
ok(`開き直し: 読み直し 0 / いまの部屋 ${onRows.join(',')} / 同じ部屋を押す → つなぎ直し ${re.starts}`);

/* 5) 別の部屋へ乗り換え */
await page.evaluate(() => Array.from(document.querySelectorAll('.place-row')).find(x => x.getAttribute('data-room') === 'kibble').click());
await page.waitForTimeout(800);
const c2 = await page.evaluate(() => ({ running: AQ.live.running, room: AQ.live.room, starts: window.__starts }));
if (!c2.running || c2.room !== 'kibble' || c2.starts !== 1) fail(`別の部屋へ乗り換えられない（${JSON.stringify(c2)}）`);
ok(`乗り換え: ${c2.room}`);

/* 6) ↻ で読み直す */
{
  const r0 = hits.rooms;
  await page.click('#placesRefresh');
  await waitDone();
  if (hits.rooms !== r0 + 1) fail(`↻ を押しても部屋の一覧を読み直さない（${r0} → ${hits.rooms}）`);
  const on2 = (await panel()).rows.filter(r => r.on).map(r => r.room);
  if (JSON.stringify(on2) !== '["kibble"]') fail(`乗り換えたあと、いまの部屋の印が付け替わっていない: ${JSON.stringify(on2)}`);
  ok(`↻: 部屋の一覧を読み直した / いまの部屋 ${on2.join(',')}`);
}

/* 7) 部屋の一覧が読めないとき：読めなかったと出し、知っている部屋（kibble と、
      つないだことのある部屋）だけを確かめて出す（作り話の部屋は足さない） */
await page.evaluate(() => { AQ.live.stop(); });
roomsFail = true;
await page.click('#placesRefresh');
const p3 = await waitDone();
const notes3 = await page.evaluate(() => Array.from(document.querySelectorAll('#placesPanel .places-note')).map(n => n.textContent).join(' / '));
const got3 = p3.rows.map(r => r.room);
if (!/繋がりません|読めなかった/.test(notes3)) fail(`部屋の一覧が読めないのに、そう出ていない（"${notes3}"）`);
if (JSON.stringify(got3.slice().sort()) !== JSON.stringify(['job-hall', 'kibble'])) fail(`読めないときに並んだ部屋が違う: ${JSON.stringify(got3)}（期待: 知っている部屋 kibble・job-hall）`);
/* ★ 2026-10-03: 赤い英語は出さない（落ち着いた1行）。理由はマウスを乗せると出る＝消してはいない */
const calm3 = await page.evaluate(() => { const n = document.querySelector('#placesPanel .places-note.calm'); return n ? { title: n.title, bad: document.querySelectorAll('#placesPanel .places-note.bad').length } : null; });
if (!calm3) fail('読めないときの落ち着いた1行が無い');
else {
  if (calm3.bad) fail('読めないときに赤い字の注意が出ている');
  if (!/読めなかった|読めません/.test(calm3.title) || !/503|busy|HTTP/.test(calm3.title)) fail(`読めなかった理由がマウスを乗せても出ない（"${calm3.title}"）`);
}
ok(`読めないとき: ${got3.join(' / ')} / "${notes3}" / 理由（マウス）: ${calm3 && calm3.title}`);

if (hits.other) fail(`想定していない問い合わせが ${hits.other} 回あった`);

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
