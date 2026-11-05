/* tools/run-tests.mjs — npm test の中身（2026-11-02）
   build してから、主なテストを1本ずつ順に流す。
   （並べて同時に流すと、タイミングで落ちることがあるため）
   1本でも落ちたら、最後に落ちたものの一覧を出して終了コード 1 で終わる。 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = (f) => path.join('tools', f);

const checks = fs.readdirSync(path.join(ROOT, 'tools')).filter(f => /^check-.*\.js$/.test(f)).sort();
const list = [
  'build.js',
  ...checks.map(T),
  T('check-lang.mjs'),
  ...['quest', 'tech', 'errand', 'social', 'robot', 'birth', 'start', 'safety', 'nowallet'].map(n => T(`shot-${n}.mjs`)),
  ...(fs.existsSync(path.join(ROOT, 'test')) ? fs.readdirSync(path.join(ROOT, 'test')) : []).filter(f => /\.test\.mjs$/.test(f)).sort().map(f => path.join('test', f))
];
const only = process.argv.slice(2);
const run = only.length ? list.filter(f => only.some(o => f.includes(o))) : list;

const failed = [];
for (const f of run) {
  console.log('\n━━ ' + f);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [f], { cwd: ROOT, stdio: 'inherit', env: process.env });
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 0) { failed.push(f); console.log(`━━ ✗ ${f}（${s}秒・終了コード ${r.status}）`); }
  else console.log(`━━ ✓ ${f}（${s}秒）`);
}
console.log('\n' + (failed.length ? `✗ 落ちたもの ${failed.length}/${run.length}:\n  ` + failed.join('\n  ') : `✓ すべて通りました（${run.length} 本）`));
process.exit(failed.length ? 1 : 0);
