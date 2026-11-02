/* tools/shot-robot.mjs — 「ロボットに頼む」（掲示板に出勤）の検査（2026-10-11）
   使い方: node tools/shot-robot.mjs   （dist/agent-quest.html を先に build）

   本物の technocore.chat には書き込まない。ブラウザから technocore.chat への通信を
   横取りして、届いた書き込みを Node 側で検証する。
     ・署名が「<room>|<nonce>|<text>」の UTF-8 に対する Ed25519 として正しいか
       （did:key から公開鍵を取り出して Node の crypto で確かめる＝サーバーと同じ確かめ方）
     ・sig は 86 文字の base64url、nonce は数字、text は1行
     ・kibble には JOB v1 の行、lobby にはあいさつ
     ・最初に DID の名刺（/kv/did-<2>/<14>）に ERC-8004 の番号を書く
     ・サーバーの返事が合わないときは「貼れた」と言わない
     ・「部屋で見る」で kibble につなぎ、その仕事が選ばれ、ロボットが持ち主の名前で出る */
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'dist', 'agent-quest.html'))); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/';
const OWNER = '0x1111111111111111111111111111111111111111';
const AGENT = { agentId: '4660', name: 'ピクセル', owner: OWNER, tx: '0x' + 'ab'.repeat(32), chain: 8453, t: Date.now() };

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58dec(s) { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; } return Buffer.from(out); }
function verify(did, room, nonce, text, sig) {
  const raw = b58dec(did.slice('did:key:z'.length));
  if (raw.length !== 34 || raw[0] !== 0xed || raw[1] !== 0x01) return false;
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw.subarray(2)]), format: 'der', type: 'spki' });
  return crypto.verify(null, Buffer.from(room + '|' + nonce + '|' + text, 'utf8'), key, Buffer.from(sig, 'base64url'));
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function setup(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [], posts = [], notes = [];
  const rooms = { kibble: [], lobby: [] };
  let seq = 100;
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((a) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.clear(); localStorage.setItem('aq.myAgent', JSON.stringify(a)); }, AGENT);
  await page.route('https://kibble.world/**', async (route) => {
    const u = new URL(route.request().url());
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (u.pathname === '/api/board') {
      const jobs = (rooms.kibble || []).filter(m => /^JOB v1/.test(m.text) && !/Noise/.test(m.from)).map((m, i, arr) => {
        const id = m.text.split('|')[1].trim(), title = m.text.split('|')[3].trim();
        const last = i === arr.length - 1;
        return { job_id: id, title, status: last ? 'delivered' : 'open', poster_did: m.from, seq: m.seq,
          worker_did: last ? 'did:key:z6MkothErAgent' + 'x'.repeat(30) + 'Q1' : '', result: last ? 'ERC-8004 gives each AI agent an on-chain ID card (an NFT). <b>bold?</b> ' + 'x'.repeat(300) : '',
          result_hash: last ? 'abcd1234abcd1234' : '', attestations: last ? [{ did: 'did:key:z6MkValidator' + 'v'.repeat(30), verdict: 'not', reason: 'thin' }] : [] };
      });
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ jobs }) });
    }
    if (u.pathname === '/api/score') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, found: true, score: 2, rank: 500,
      breakdown: { own_actions: 2, quarantine_own_actions: 3, own_terms_quarantined: true, terms: { jobs_posted: { count: 2, weight: 2, points: 0 }, results_delivered: { count: 0, weight: 1, points: 0 },
        useful_attestations_received: { count: 0, weight: 6, points: 0 }, poster_accepts_received: { count: 0, weight: 1, points: 0 },
        not_useful_attestations_received: { count: 0, weight: -3, points: 0 }, attestations_given: { count: 1, weight: 1, points: 0 } } } }) });
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  await page.route('https://technocore.chat/**', async (route) => {
    const req = route.request(), u = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (req.method() === 'POST' && u.pathname.startsWith('/kv/')) { notes.push({ path: u.pathname, body: JSON.parse(req.postData()) }); return route.fulfill({ status: 200, headers: cors, body: '{"ok":true}' }); }
    const m = u.pathname.match(/^\/r\/([a-z0-9_-]+)$/);
    if (req.method() === 'POST' && m) {
      const b = JSON.parse(req.postData()); posts.push({ room: m[1], ...b });
      if (opts.mismatch) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ posted: { from: b.did, text: b.text + 'x', nonce: b.nonce, seq: 1 } }) });
      if (opts.dupe) return route.fulfill({ status: 422, headers: cors, body: '422 duplicate text' });
      const rec = { seq: ++seq, from: b.did, text: b.text, nonce: b.nonce, sig: b.sig, ts: new Date().toISOString() };
      rooms[m[1]] = rooms[m[1]] || []; rooms[m[1]].push(rec);
      /* 部屋はほかの子の書き込みでいっぱい（実際の lobby は1秒に何十行） */
      for (let n = 0; n < 5; n++) rooms[m[1]].push({ seq: ++seq, from: 'did:key:z6MkNoise' + n + 'y'.repeat(30), text: 'CLAIM v1 | kother' + n + ' | worker', ts: new Date().toISOString() });
      if (m[1] === 'kibble' && /^JOB v1/.test(b.text)) {
        const id = b.text.split('|')[1].trim();
        const other = 'did:key:z6MkothErAgent' + 'x'.repeat(30) + 'Q1';
        rooms.kibble.push({ seq: ++seq, from: other, text: 'CLAIM v1 | ' + id + ' | worker', ts: new Date(Date.now() + 2000).toISOString() });
        rooms.kibble.push({ seq: ++seq, from: other, text: 'DELIVER v1 | ' + id + ' | x402 lets a server ask for a payment with HTTP 402.', ts: new Date(Date.now() + 9000).toISOString() });
      }
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ room: m[1], posted: rec }) });
    }
    if (req.method() === 'GET' && m) {
      const since = Number(u.searchParams.get('since') || 0);
      const list = (rooms[m[1]] || []).filter(x => x.seq > since);
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ room: m[1], count: list.length, messages: list }) });
    }
    return route.fulfill({ status: 200, headers: cors, body: '[]' });
  });
  await page.goto(URL0);
  await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  return { page, errs, posts, notes, rooms };
}

console.log('\n[仕事を頼む（kibble）]');
{
  const { page, errs, posts, notes } = await setup();
  const vis = await page.evaluate(() => !document.getElementById('robotBox').hidden);
  ok(vis, '生まれた子がいると「ロボットに頼む」が出る');
  await page.click('#robotJobOpen');
  const ch = await page.evaluate(() => ({ keys: [...document.querySelectorAll('#robotChoices .robot-choice')].map(b => b.dataset.key + ':' + b.innerText.replace(/\n/g, ' / ')),
    on: (document.querySelector('#robotChoices .robot-choice.on') || {}).dataset?.key, go: document.getElementById('robotJobGo').disabled, free: document.getElementById('robotFree').hidden }));
  ok(ch.keys.length === 4 && /^free:/.test(ch.keys[3]), '頼みごとは3択＋「自分で書く」の4つ（' + ch.keys.map(k => k.split(' / ')[0]).join('、') + '）');
  ok(ch.keys.every(k => / \/ /.test(k)), 'どの選択肢にも、貼られる英文（または説明）が小さく出る');
  ok(ch.on === 'x402' && !ch.go && ch.free, '最初は1つ目が選ばれていて、すぐ貼れる（自由欄は隠れている）');
  await page.click('#robotChoices .robot-choice[data-key="free"]');
  let goOff = await page.evaluate(() => ({ g: document.getElementById('robotJobGo').disabled, f: document.getElementById('robotFree').hidden }));
  ok(goOff.g && !goOff.f, '「自分で書く」を選ぶと入力欄が出て、空のうちは貼れない');
  await page.fill('#robotJobTitle', 'Explain x402 | in 3 sentences\nplease');
  await page.click('#robotJobGo');
  await page.waitForFunction(() => /#\d+/.test(document.getElementById('robotStatus').innerText), null, { timeout: 5000 }).catch(() => {});
  const p = posts[0] || {};
  ok(posts.length === 1 && p.room === 'kibble', 'kibble に1回だけ書き込む');
  ok(/^did:key:z6Mk/.test(p.did || ''), 'ロボット自身の did:key で名乗る（' + String(p.did).slice(0, 16) + '…）');
  ok(/^[A-Za-z0-9_-]{86}$/.test(p.sig || '') && /^[0-9]{1,19}$/.test(p.nonce || ''), 'sig は 86 文字の base64url、nonce は数字');
  ok(p.did && verify(p.did, 'kibble', p.nonce, p.text, p.sig), '署名が「kibble|nonce|text」に対して正しい（Node の Ed25519 で確認）');
  ok(/^JOB v1 \| k[0-9a-f]{10} \| research \| Explain x402 \/ in 3 sentences please \|$/.test(p.text || ''), '自由に書いた行の形（| は / に、改行は空白に）：' + p.text);
  ok(notes.length === 1 && /^\/kv\/did-[0-9a-f]{2}\/[0-9a-f]{14}$/.test(notes[0].path) && /erc8004:eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:4660/.test(notes[0].body.value) && /owner:0x1111/.test(notes[0].body.value) && notes[0].body.value.startsWith(p.did), '先に DID の名刺（先頭に did:key・慣習どおり）に ERC-8004 の番号と持ち主を書く');
  const fp = crypto.createHash('sha256').update(p.did || '').digest('hex').slice(0, 16);
  ok(notes[0] && notes[0].path === '/kv/did-' + fp.slice(0, 2) + '/' + fp.slice(2), '名刺の場所は SHA-256(did) の先頭16文字（2+14 に分ける）');
  /* 3択の1つ（ERC-8004）を貼る */
  await page.click('#robotJobOpen');
  await page.click('#robotChoices .robot-choice[data-key="erc8004"]');
  await page.click('#robotJobGo');
  await page.waitForFunction(() => document.getElementById('robotStatus').innerText.match(/#\d+/g), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const p2 = posts[1] || {};
  ok(/^JOB v1 \| k[0-9a-f]{10} \| explain \| Explain what ERC-8004 agent identity is and why it matters \| Success: under 100 words, plain words$/.test(p2.text || ''), '選んだ頼みごとがそのまま英文で貼られる：' + p2.text);
  ok(p2.did && verify(p2.did, 'kibble', p2.nonce, p2.text, p2.sig) && BigInt(p2.nonce) > BigInt(p.nonce), '2回目も同じ鍵で正しく署名、nonce は増える');
  const st = await page.evaluate(() => ({ s: document.getElementById('robotStatus').innerText, w: !document.getElementById('robotWatch').hidden, did: document.getElementById('robotDid').innerText }));
  ok(/貼りました/.test(st.s) && st.w, '「貼りました」と出て「部屋で見る」が出る');
  ok(/z6Mk/.test(st.did), 'ロボットの名前（did:key）が窓に出る');
  /* 部屋で見る：自分のロボットと、その仕事への返事だけ */
  await page.click('#robotWatch');
  await page.waitForFunction(() => AQ.app.focusJob != null, null, { timeout: 6000 }).catch(() => {});
  const jobId = (p2.text || '').split('|')[1].trim();
  await page.waitForFunction((id) => AQ.app.events.some(e => /CLAIM/.test(JSON.stringify(e.meta || {}) + (e.type || '')) && String(e.actor).includes('othErAgent')), jobId, { timeout: 9000 }).catch(() => {});
  const w = await page.evaluate(() => {
    const actors = [...new Set(AQ.app.events.map(e => String(e.actor)))];
    return { job: AQ.app.focusJob, live: AQ.live.running, open: !document.getElementById('birthScreen').hidden, actors,
      label: AQ.nick.forActor(JSON.parse(localStorage.getItem('aq.myAgent.key')).did) };
  });
  ok(w.job === jobId && !w.live, '「部屋で見る」は部屋全体につながず、その仕事を選ぶ（' + w.job + '）');
  ok(!w.open, '窓は閉じる');
  ok(!w.actors.some(a => /Noise/.test(a)), '関係のないエージェント（部屋の雑談・ほかの仕事）は出ない（' + w.actors.length + ' 体）');
  console.log('    actors:', w.actors.map(a => a.slice(0, 22)));
  ok(w.actors.some(a => a === p.did) && w.actors.some(a => /othErAgent/.test(a)) && w.actors.length === 2, '出るのはロボットと、ロボットの仕事を引き受けた子だけ');
  ok(w.label === 'ピクセル #4660', 'ロボットは持ち主が付けた名前で出る（' + w.label + '）');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-robot.png') });
  const who = await page.evaluate(() => { const c = AQ.app.clock, b = c.beats[c.index]; return b && AQ.nick.forActor(String(b.actor)); });
  ok(who === 'ピクセル #4660', 'いま再生しているコマの主役はロボット（' + who + '）');
  /* あいさつ → lobby も自分だけ */
  await page.evaluate(() => AQ.birth.open()); await page.waitForTimeout(200);
  await page.click('#robotHello');
  await page.waitForFunction(() => /lobby/.test(document.getElementById('robotStatus').innerText) && /#/.test(document.getElementById('robotStatus').innerText), null, { timeout: 5000 }).catch(() => {});
  const q = posts[2] || {};
  ok(q.room === 'lobby' && q.did === p.did, 'あいさつは lobby に、同じ鍵で');
  ok(q.did && verify(q.did, 'lobby', q.nonce, q.text, q.sig) && /#4660/.test(q.text), 'あいさつの署名も正しく、番号を名乗る（' + q.text + '）');
  ok(notes.length === 1, '名刺は1回だけ書く');
  /* 頼んだ仕事 → 依頼主として判定 */
  await page.click('#robotJobsOpen');
  await page.waitForSelector('#robotJobsList .robot-job', { timeout: 5000 }).catch(() => {});
  const cards = await page.evaluate(() => [...document.querySelectorAll('#robotJobsList .robot-job')].map(c => ({ t: c.innerText, judge: !!c.querySelector('.robot-judge'), next: !!c.querySelector('.robot-step-go'), html: c.innerHTML })));
  ok(cards.length === 2, '頼んだ仕事が2件、新しい順に並ぶ（' + cards.length + '）');
  /* ★ 2026-10-19 判定は「① 読む → ② 判定する」の2段階（向こうのセッションの変更）。まず届いた文と「判定へ進む」 */
  ok(/納品ずみ/.test(cards[0].t) && /ERC-8004 gives/.test(cards[0].t) && cards[0].next && !cards[0].judge, '納品された仕事には、届いた文と「判定へ進む」が出る');
  ok(!/<b>bold/.test(cards[0].html.replace(/&lt;b&gt;/g, '')) && /&lt;b&gt;bold/.test(cards[0].html), '届いた文は HTML として解釈せず、ただの文字として出す');
  ok(/合格 0・不合格 1/.test(cards[0].t), 'ほかの検品役の判定の数も出る');
  ok(/受付中/.test(cards[1].t) && !cards[1].judge && !cards[1].next, 'まだ納品されていない仕事には判定ボタンが出ない');
  await page.evaluate(() => document.getElementById('robotJobs').scrollIntoView());
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-robot-jobs.png') });
  await page.click('#robotJobsList .robot-job .robot-step-go'); await page.waitForTimeout(600);
  ok(await page.evaluate(() => !!document.querySelector('#robotJobsList .robot-judge') && document.querySelectorAll('#robotJobsList > .robot-job').length === 1), '「判定へ進む」で、その仕事の判定の画面になる（ほかの仕事は出さない）');
  await page.click('#robotJobsList .robot-job .robot-yes');
  ok(/理由/.test(await page.evaluate(() => document.getElementById('robotStatus').innerText)) && posts.length === 3, '理由が空なら送らずに知らせる');
  await page.click('#robotJobsList .robot-job .robot-chip.useful');
  await page.click('#robotJobsList .robot-job .robot-yes');
  await page.waitForFunction(() => /受け取る/.test(document.getElementById('robotStatus').innerText), null, { timeout: 5000 }).catch(() => {});
  const at = posts[3] || {};
  const jid = (p2.text || '').split('|')[1].trim();
  ok(at.room === 'kibble' && at.text === 'ATTEST v1 | ' + jid + ' | useful | rh:abcd1234abcd1234 | Meets the success condition: clear, correct and in plain words', '依頼主の判定は ATTEST v1 | 番号 | useful | rh:結果のハッシュ | 理由（kibble.world の Accept と同じ形）：' + at.text);
  ok(at.did === p.did && verify(at.did, 'kibble', at.nonce, at.text, at.sig), '判定も同じロボットの署名');
  await page.waitForTimeout(300);
  ok(/受け取る（合格）」を付けました/.test(await page.evaluate(() => document.querySelector('#robotJobsList .robot-job').innerText)), '判定したあとは、ボタンの代わりに「付けました」と出る（2回付けない）');
  /* 評判 */
  await page.click('#robotRepOpen');
  await page.waitForSelector('#robotRepBody .robot-rep-score', { timeout: 5000 }).catch(() => {});
  const rep = await page.evaluate(() => ({ t: document.getElementById('robotRepBody').innerText, jobsHidden: document.getElementById('robotJobs').hidden }));
  ok(/^2/.test(rep.t) && /500 位/.test(rep.t) && /依頼した[\s\S]*2 × 2 = 0/.test(rep.t), '評判は kibble.world の数字をそのまま出す（' + rep.t.split('\n').slice(0, 3).join(' / ') + '）');
  ok(/3 回になるまで/.test(rep.t) && /約束されたものではありません/.test(rep.t), '点が0のままの理由と、エアドロップの約束ではないことを書く');
  ok(rep.jobsHidden, 'パネルは1つずつ開く');
  await page.evaluate(() => document.getElementById('robotRep').scrollIntoView());
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-robot-rep.png') });
  await page.click('#robotWatch'); await page.waitForTimeout(800);
  const kw = await page.evaluate(() => ({ actors: [...new Set(AQ.app.events.map(e => String(e.actor)))], hasAtt: AQ.app.events.some(e => e.meta && e.meta.verdict === 'useful') }));
  ok(kw.hasAtt, '「部屋で見る」に、ロボット自身の判定の場面が入る');
  await page.evaluate(() => AQ.birth.open()); await page.waitForTimeout(200);
  await page.click('#robotHello');
  await page.waitForFunction(() => /lobby/.test(document.getElementById('robotStatus').innerText), null, { timeout: 5000 }).catch(() => {});
  await page.click('#robotWatch'); await page.waitForTimeout(800);
  const lw = await page.evaluate(() => ({ actors: [...new Set(AQ.app.events.map(e => String(e.actor)))], live: AQ.live.running, focus: AQ.app.focusActor }));
  console.log('    lobby actors:', lw.actors.map(a => a.slice(0, 22)));
  ok(lw.actors.length === 1 && lw.actors[0] === p.did && !lw.live, 'lobby の「部屋で見る」も、出るのは自分のロボットだけ（' + lw.actors.length + ' 体）');
  const lb = await page.evaluate(() => { const c = AQ.app.clock; return { n: c.beats.length, kinds: c.beats.map(b => b.kind), playing: c.playing, i: c.index, scene: AQ.stage && AQ.stage.mode }; });
  console.log('    lobby beats:', JSON.stringify(lb));
  await page.evaluate(() => { const c = AQ.app.clock; c.pause(); c.seek(Math.min(1, c.beats.length - 1)); c.elapsed = c.durationOf(c.index) * 0.5; c.onFrame(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shot-robot-lobby.png') });
  const say = [];
  for (const bi of [1, 2]) { await page.evaluate((bi) => { const c = AQ.app.clock; c.pause(); c.seek(bi); c.elapsed = c.durationOf(bi) * 0.9; c.onFrame(); }, bi); await page.waitForTimeout(250);
    /* ★ 2026-10-18 説明の窓の1行目は「動き i / n」になった（もう一度見るの作り直し）。その次の行が説明 */
    say.push(await page.evaluate(() => document.getElementById('cmdWinBody').innerText.split('\n').filter(x => x.trim() && !/^(動き|step) \d+ \/ \d+/.test(x.trim()))[0] || '')); }
  ok(!say.some(x => /依頼|引き受け/.test(x)) && (/hello from/.test(say[1]) || /2 件/.test(say[0] + say[1])), 'あいさつを「依頼を取った」とは言わず、書いた文（2回なら「2 件」）を出す（' + say.join(' / ') + '）');
  const seen = await page.evaluate(() => AQ.app.clock.playing !== undefined);
  ok(seen, 'lobby でもロボットが選ばれて再生される');
  /* 開きなおしても、記録は残っている */
  await page.reload(); await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById('robotWatch').hidden), '開きなおしても「部屋で見る」が出る（記録はこのブラウザに残る）');
  ok(errs.length === 0, 'JS のエラーが無い' + (errs.length ? '（' + errs[0] + '）' : ''));
  await page.close();
}

console.log('\n[返事が合わない・断られた]');
{
  const { page } = await setup({ mismatch: true });
  await page.click('#robotHello'); await page.waitForTimeout(800);
  let s = await page.evaluate(() => ({ s: document.getElementById('robotStatus').innerText, w: !document.getElementById('robotWatch').hidden }));
  ok(/確かめられません/.test(s.s) && !s.w, '返ってきた記録が合わなければ「貼れた」と言わない');
  await page.close();
  const b = await setup({ dupe: true });
  await b.page.click('#robotHello'); await b.page.waitForTimeout(800);
  s = await b.page.evaluate(() => document.getElementById('robotStatus').innerText);
  ok(/文を変えて/.test(s), '同じ文の繰り返し（422）は、そう伝える');
  await b.page.close();
}

console.log('\n[生まれていない]');
{
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.clear());
  await page.goto(URL0); await page.waitForFunction(() => window.AQ && window.AQ.app);
  await page.click('#startBirth'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById('robotBox').hidden), 'まだ生まれていなければ「ロボットに頼む」は出ない');
  await page.close();
}

await browser.close();
server.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
