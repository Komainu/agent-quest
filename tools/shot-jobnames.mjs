/* tools/shot-jobnames.mjs — 依頼の呼び名は「出てきた順」の α, β, γ …（2026-09-30）
   使い方: node tools/shot-jobnames.mjs

   ★ 要望
     「仕事には名前がついていたと思いますが、これも右の欄に記載してください。
       名前の振り方は、アルファ、ベータという感じに順番に」

   ★ 見るもの
     ・ログに出てきた順に α, β, γ, …, ω（22文字。ο・ι は除く）、23件目から α2, β2, …
     ・右の一覧の各行に、その依頼の呼び名が出ている（行と呼び名が1対1）
     ・LIVE で依頼が増えても、前からある依頼の呼び名は変わらず、新しい依頼に次の名前
     ・言語を切り替えても同じ呼び名
     ・「詳細」にはこれまでどおり本物の依頼 ID と呼び名の両方
*/
import { chromium } from '/home/claude/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.AQ_FILE ? 'file://' + process.env.AQ_FILE : 'file://' + path.join(ROOT, 'dist', 'agent-quest.html');
const iso = (ms) => new Date(1758300000000 + ms).toISOString();
const GREEK = ['α','β','γ','δ','ε','ζ','η','θ','κ','λ','μ','ν','ξ','π','ρ','σ','τ','υ','φ','χ','ψ','ω'];
const want = (n) => GREEK[n % 22] + (n >= 22 ? String(Math.floor(n / 22) + 1) : '');

/* 依頼ID はわざとバラバラ（ハッシュ順・辞書順と「出てきた順」が一致しないように） */
const IDS = Array.from({ length: 30 }, (_, i) => 'j' + ((i * 7919) % 1000).toString(36) + 'x' + i);
const MSGS = [];
let s = 1, t = 0;
IDS.forEach((id, i) => {
  MSGS.push({ seq: s++, from: 'did:key:zP' + (i % 3), text: `JOB v1 | ${id} | ${['build', 'review', 'research'][i % 3]} | Task ${i} | d`, ts: iso(t += 500) });
  MSGS.push({ seq: s++, from: 'did:key:zW', text: `CLAIM v1 | ${id} | builder`, ts: iso(t += 500) });
});

let bad = 0;
const fail = (m) => { console.log('    ✗ ' + m); bad++; };
const ok   = (m) => console.log('    · ' + m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1860, height: 1000 } });
page.on('pageerror', e => { console.log('    ✗ JS error: ' + e.message); bad++; });
await page.goto(FILE);
await page.waitForFunction(() => window.AQ && window.AQ.app);
await page.evaluate((m) => { AQ.adapters.kibbleForget('jn'); AQ.app.loadEvents(AQ.adapters.fromKibble(m, { room: 'jn', observedAt: Date.now() })); AQ.app.setListMode('jobs'); }, MSGS);
await page.waitForTimeout(300);

/* 順番 */
const names = await page.evaluate((ids) => ids.map(id => AQ.nick.forJob(id)), IDS);
const wrong = IDS.map((id, i) => [i, names[i], want(i)]).filter(x => x[1] !== x[2]);
if (wrong.length) fail(`出てきた順の名前になっていない: ${wrong.slice(0, 4).map(x => `${x[0] + 1}件目=${x[1]}（期待 ${x[2]}）`).join(' / ')}`);
ok(`順番: ${names.slice(0, 4).join(' ')} … ${names[21]} ${names[22]} ${names[23]} …`);

/* 右の一覧 */
async function rowNames() {
  return page.evaluate(() => Array.from(document.querySelectorAll('.roster-chips .jrow[data-job]')).map(r => ({
    id: r.getAttribute('data-job'), nick: (r.querySelector('.jnick') || {}).textContent || null, title: r.getAttribute('title') || '' })));
}
{
  const rows = await rowNames();
  if (!rows.length) fail('一覧に依頼の行が無い＝空回り');
  const miss = rows.filter(r => !r.nick);
  if (miss.length) fail(`呼び名の出ていない行が ${miss.length} 行`);
  const mism = rows.filter(r => r.nick && r.nick !== names[IDS.indexOf(r.id)]);
  if (mism.length) fail(`行の呼び名と依頼が食い違う: ${mism.slice(0, 3).map(r => r.id + '=' + r.nick).join(', ')}`);
  const dup = rows.map(r => r.nick).filter((n, i, a) => n && a.indexOf(n) !== i);
  if (dup.length) fail(`同じ呼び名の行が複数ある: ${dup.join(', ')}`);
  ok(`一覧: ${rows.length} 行・全行に呼び名（例 ${rows.slice(0, 3).map(r => r.nick).join(' ')}）`);
}

/* LIVE で増える */
{
  const more = [];
  ['zz-new-1', 'aa-new-2'].forEach((id, k) => more.push({ seq: 900 + k, from: 'did:key:zP9', text: `JOB v1 | ${id} | build | New ${k} | d`, ts: iso(t + 10000 + k * 500) }));
  const r = await page.evaluate(({ m, ids }) => {
    AQ.app.appendEvents(AQ.adapters.fromKibble(m, { room: 'jn', observedAt: Date.now() }));
    return { old: ids.map(id => AQ.nick.forJob(id)), n1: AQ.nick.forJob('zz-new-1'), n2: AQ.nick.forJob('aa-new-2') };
  }, { m: more, ids: IDS });
  const changed = r.old.filter((n, i) => n !== names[i]);
  if (changed.length) fail(`依頼が増えたら、前からある依頼の呼び名が ${changed.length} 件変わった`);
  if (r.n1 !== want(30) || r.n2 !== want(31)) fail(`新しい依頼に次の名前が付いていない（${r.n1}, ${r.n2} ／ 期待 ${want(30)}, ${want(31)}）`);
  await page.waitForTimeout(200);
  const rows = await rowNames();
  if (!rows.some(x => x.id === 'zz-new-1' && x.nick === want(30))) fail('増えた依頼の行に呼び名が出ていない');
  ok(`LIVE: 前からの呼び名はそのまま / 新しい依頼 ${r.n1}, ${r.n2}`);
}

/* 言語 */
{
  const r = await page.evaluate((ids) => { AQ.i18n.set('en'); AQ.hud.relabel(); const en = ids.map(id => AQ.nick.forJob(id)); AQ.i18n.set('ja'); AQ.hud.relabel(); return en; }, IDS);
  if (r.some((n, i) => n !== names[i])) fail('英語に切り替えると呼び名が変わる');
}

/* 詳細 */
{
  const r = await page.evaluate((id) => { AQ.app.focusOnJob(id); document.getElementById('detail').click(); return (document.getElementById('detailBody') || {}).textContent || ''; }, IDS[5]);
  if (r.indexOf(IDS[5]) === -1 || r.indexOf(names[5]) === -1) fail(`詳細に本物の ID（${IDS[5]}）と呼び名（${names[5]}）の両方が無い`);
  ok(`詳細: ${names[5]} と ${IDS[5]}`);
}

await page.close();
await browser.close();
console.log('\n' + (bad ? '✗ ' + bad + ' 件' : '✓ すべて OK'));
process.exit(bad ? 1 : 0);
