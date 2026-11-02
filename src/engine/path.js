/* =============================================================
   engine/path.js — 目的地までの道すじ
   -------------------------------------------------------------
   歩けるのは歩道・横断歩道・敷地だけ。建物や設備の足元は通れません。
   歩道を優先して歩くように、マスごとに「歩きにくさ」を付けています。
   ============================================================= */
(function (AQ) {
  'use strict';

  function key(x, y) { return x + ',' + y; }

  var blocked = null;            // AQ.world（街）用のキャッシュ。既定の呼び出しはずっとこれだけを使う
  var otherBlocked = [];         // [{world, map}] 街以外の舞台（部屋など）用。数が少ないので配列で十分

  /** objects の足元を通行止めの集合にする */
  function buildBlockedFor(world) {
    var b = {};
    (world.objects || []).forEach(function (o) {
      for (var dy = 0; dy < o.h; dy++) {
        for (var dx = 0; dx < o.w; dx++) b[key(o.x + dx, o.y + dy)] = true;
      }
    });
    return b;
  }

  /* ★ world 引数について（後から追加した拡張。既存の呼び方は一切変えていない）
     もともとこのファイルは AQ.world（街）だけを見ていました。部屋（data/room.js）を
     足すにあたって「別の間取りでも経路探索できる」必要が出てきたので、
     canWalk / costAt / find の最後に世界（world）を省略可能な引数として足しました。
     省略すれば今までどおり AQ.world を見ます＝街側の呼び出し（scene.js）は
     1行も変えていません。部屋側（room.js）だけが第3引数に AQ.room を渡します。 */
  function worldOf(world) { return world || AQ.world; }

  function blockedFor(world) {
    if (!world || world === AQ.world) {
      if (!blocked) blocked = buildBlockedFor(AQ.world);
      return blocked;
    }
    for (var i = 0; i < otherBlocked.length; i++) {
      if (otherBlocked[i].world === world) return otherBlocked[i].map;
    }
    var m = buildBlockedFor(world);
    otherBlocked.push({ world: world, map: m });
    return m;
  }

  AQ.path = {

    /* 歩きにくさ。歩道を1にしてあるので、遠回りでも歩道を選びます */
    cost: { 's': 1, 'x': 1, 'p': 3 },

    reset: function () { blocked = null; otherBlocked = []; routeCaches = []; },

    canWalk: function (x, y, world) {
      world = worldOf(world);
      var b = blockedFor(world);
      var g = world.ground;
      if (y < 0 || y >= g.length) return false;
      var row = g[y];
      if (x < 0 || x >= row.length) return false;
      if (world.walkable.indexOf(row[x]) === -1) return false;
      return !b[key(x, y)];
    },

    costAt: function (x, y, world) {
      world = worldOf(world);
      var c = AQ.path.cost[world.ground[y][x]];
      return c == null ? 3 : c;
    },

    /** [x,y] から [x,y] までのマスの並び（出発点を含む・ダイクストラ）。
        world を省略すると街（AQ.world）。部屋の経路がほしいときは AQ.room を渡す。 */
    find: function (from, to, world) {
      world = worldOf(world);
      if (!from || !to) return [];
      if (from[0] === to[0] && from[1] === to[1]) return [from.slice()];
      /* ★ 2026-09-28: 同じ間取りで同じ出発点・目的地なら道は同じ。
         数千コマのログでは同じ道を何千回も探していた（LIVE で行が届く
         たびに全コマぶん）。一度探した道は覚えておき、写しを返す。 */
      var ck = from[0] + ',' + from[1] + '>' + to[0] + ',' + to[1];
      var cache = routeCacheFor(world);
      if (cache[ck]) return cache[ck].map(function (pt) { return pt.slice(); });
      var found = findUncached(from, to, world);
      cache[ck] = found.map(function (pt) { return pt.slice(); });
      return found;
    }
  };

  var routeCaches = [];          // [{world, map}]
  function routeCacheFor(world) {
    for (var i = 0; i < routeCaches.length; i++) if (routeCaches[i].world === world) return routeCaches[i].map;
    var m = {};
    routeCaches.push({ world: world, map: m });
    return m;
  }

  function findUncached(from, to, world) {

      var dist = {}, prev = {}, open = [from.slice()];
      dist[key(from[0], from[1])] = 0;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

      while (open.length) {
        var bi = 0;
        for (var i = 1; i < open.length; i++) {
          if (dist[key(open[i][0], open[i][1])] < dist[key(open[bi][0], open[bi][1])]) bi = i;
        }
        var cur = open.splice(bi, 1)[0];
        if (cur[0] === to[0] && cur[1] === to[1]) break;

        for (var d = 0; d < dirs.length; d++) {
          var nx = cur[0] + dirs[d][0], ny = cur[1] + dirs[d][1];
          if (!AQ.path.canWalk(nx, ny, world)) continue;
          var k = key(nx, ny);
          var nd = dist[key(cur[0], cur[1])] + AQ.path.costAt(nx, ny, world);
          if (dist[k] == null || nd < dist[k]) { dist[k] = nd; prev[k] = cur; open.push([nx, ny]); }
        }
      }

      if (dist[key(to[0], to[1])] == null) return [from.slice()];

      var route = [], node = to;
      while (node) { route.unshift(node); node = prev[key(node[0], node[1])]; }
      return route;
  }

  /** 経路上の位置。dir は向き */
  AQ.path.posOn = function (route, p) {
      if (!route.length) return { x: 0, y: 0, dir: 'down' };
      if (route.length === 1) return { x: route[0][0], y: route[0][1], dir: 'down' };

      var segs = route.length - 1;
      var f = Math.max(0, Math.min(1, p)) * segs;
      var i = Math.min(segs - 1, Math.floor(f));
      var t = f - i;
      var a = route[i], b = route[i + 1];

      var dir = 'down';
      if (b[0] > a[0]) dir = 'right';
      else if (b[0] < a[0]) dir = 'left';
      else if (b[1] < a[1]) dir = 'up';

      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dir: dir };
  };

})(window.AQ = window.AQ || {});
