/* tools/check-world.js — 街と部屋、どちらの通行もチェック
   使い方:  node tools/check-world.js
   建物・机・依頼板などを動かしたあとに走らせると、歩道が塞がっていないか分かります。
   街（data/world.js）と部屋（data/room.js）の両方を同じロジックで検証します。
   ★ 2026-09-06 (2): 板・納品口・検品台の間の床（floor band）が、
   ロボットの footprint より低くないかも machine で検査する（目視に
   頼らない。src/render/room.js の computeFloorBand / spriteFootprint）。 */
const fs = require('fs');
const AQ = {};
function loadInto(rel) {
  eval(fs.readFileSync(__dirname + '/../' + rel, 'utf8').replace('window.AQ = window.AQ || {}', 'AQ'));
}
loadInto('data/world.js');
loadInto('data/room.js');

/** 1つの舞台（街 or 部屋）を検証する。W は AQ.world / AQ.roomWorld、
    origin は到達チェックの起点（街=home、部屋=机の1つめ）、
    poolKeys は「複数エージェント同時表示」用の候補地プール名（homes/idles または desks）。
    見つかった問題の件数を返す。 */
function checkStage(label, W, origin, poolKeys, decorativeKeys) {
  console.log(`\n--- ${label} ---`);
  let bad = 0;
  decorativeKeys = decorativeKeys || [];

  const blocked = new Set();
  W.objects.forEach(o => { for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) blocked.add(`${o.x + x},${o.y + y}`); });
  const can = (x, y) => {
    const row = W.ground[y];
    if (!row || x < 0 || x >= row.length) return false;
    return W.walkable.includes(row[x]) && !blocked.has(`${x},${y}`);
  };
  const bfs = (from) => {
    const seen = new Set([from.join(',')]); const q = [from];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && can(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); }
      }
    }
    return seen;
  };

  const spots = [];
  Object.entries(W.places).forEach(([k, v]) => {
    if (decorativeKeys.includes(k)) return;   // 見た目だけの座標（壁の上の飾りなど）は通行チェックの対象外
    if (Array.isArray(v[0])) {
      // homes / idles / desks のような「候補地の配列」。1件ずつ検証する。
      v.forEach((p, i) => spots.push([`${k}[${i}]`, p]));
    } else {
      spots.push([k, v]);
    }
  });
  W.objects.filter(o => o.at).forEach(o => spots.push([o.id || o.type, o.at]));

  // 複数エージェント同時表示の要となる候補地プール。1マスも欠けてはいけないので、
  // 何マス分あるか・重複していないかもここで確認する。
  poolKeys.forEach(key => {
    const pool = W.places[key];
    if (!Array.isArray(pool) || !pool.length) {
      console.log(`✗ places.${key} が定義されていません（複数エージェントが重ならなくなる仕組みに必須）`);
      bad++;
      return;
    }
    const seen = new Set();
    pool.forEach(p => {
      const k = p.join(',');
      if (seen.has(k)) { console.log(`✗ places.${key} に重複したマス [${p}] があります`); bad++; }
      seen.add(k);
    });
  });

  spots.forEach(([n, p]) => { if (!can(p[0], p[1])) { console.log(`✗ ${n} の立ち位置 [${p}] が歩けないマスです`); bad++; } });

  const reach = bfs(origin);
  spots.forEach(([n, p]) => {
    if (!reach.has(p.join(','))) { console.log(`✗ ${n} [${p}] に起点 ${origin} から到達できません`); bad++; }
  });

  if (!bad) console.log(`✓ ${label}: すべての地点に到達できます`);
  return bad;
}

const cityBad = checkStage('街（data/world.js）', AQ.world, AQ.world.places.home, ['homes', 'idles']);
const roomBad = checkStage('部屋（data/room.js）', AQ.roomWorld, AQ.roomWorld.places.desks[0], ['desks'], ['door']);

/* ---- 部屋: 板の下端〜納品口・検品台の上端の床（floor band）が、
   ロボットの footprint（SPRITE_H * SPRITE_SCALE）より低くないか。
   「掲示板・納品口・検品台の間にロボットが収まる高さの床があるか」を
   目視ではなく機械的に検査する（task 2）。 */
console.log('\n--- 部屋（床の帯 floor band）---');
let floorBandBad = 0;
loadInto('src/config.js');
loadInto('src/engine/path.js');
loadInto('src/render/room.js');
{
  const fakeCanvas = { getContext: function () { return {}; }, width: 0, height: 0 };
  AQ.room.init(fakeCanvas);
  const band = AQ.room.computeFloorBand();
  const foot = AQ.room.spriteFootprint();
  if (band.h < foot.h) {
    console.log(`✗ 床の帯の高さ ${band.h}px が、ロボットの footprint ${foot.h}px より低い`
      + `（板の下端〜納品口・検品台の上端が詰まりすぎ）`);
    floorBandBad++;
  } else {
    console.log(`✓ 床の帯の高さ ${band.h}px は、ロボットの footprint ${foot.h}px 以上ある`);
  }
  if (band.w <= 0) {
    console.log(`✗ 床の帯の幅が ${band.w}px（0以下）`);
    floorBandBad++;
  }
}

const bad = cityBad + roomBad + floorBandBad;
console.log(bad ? `\n${bad} 件の問題` : '\n✓ 街・部屋とも、すべての地点に到達できます');
process.exit(bad ? 1 : 0);
