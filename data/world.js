/* =============================================================
   data/world.js — 街
   -------------------------------------------------------------
   舞台は現代の市街地。空想の地形は使いません。
   地面（ground）と、その上に置く物（objects）に分けてあります。

   ground の文字（1文字 = 1マス = 20px）
     s  歩道        x  横断歩道      p  敷地・タイル舗装
     a  車道        l  車道（センターライン）
     g  植え込み

   歩けるのは walkable の文字のマスだけ。
   建物などの objects は、その足元を自動で通行止めにします。

   ★ 2026-09-04 横幅を24列→34列に拡張（「可視化された街の部分が
     小さすぎる」というユーザー報告への対応）
     縦の高さ予算（画面を1コマも超えさせない制約）は変えられないので、
     tile は20pxのまま・行数も16行のまま据え置き、横方向だけ広げて
     同じ縦予算でより多くの横幅を使えるようにする。建物は1つも
     減らさず・routing の対応も変えず、間隔を広げて配置し直しただけ。
     view.cols も34に合わせてあるので、カメラは今までどおり (0,0) に
     固定のまま＝街全体が常に画面いっぱいに見える。 */
(function (AQ) {
  'use strict';

  AQ.world = {
    tile: 20,

    /* 34列 × 16行。横断歩道（xx）は新しい横幅の中央（列16-17）に置く。 */
    ground: [
      'gggggggggggggggggggggggggggggggggg',
      'pppppppppppppppppppppppppppppppppp',
      'pppppppppppppppppppppppppppppppppp',
      'pppppppppppppppppppppppppppppppppp',
      'ssssssssssssssssssssssssssssssssss',
      'ssssssssssssssssssssssssssssssssss',
      'aaaaaaaaaaaaaaaaxxaaaaaaaaaaaaaaaa',
      'llllllllllllllllxxllllllllllllllll',
      'aaaaaaaaaaaaaaaaxxaaaaaaaaaaaaaaaa',
      'ssssssssssssssssssssssssssssssssss',
      'ssssssssssssssssssssssssssssssssss',
      'pppppppppppppppppppppppppppppppppp',
      'pppppppppppppppppppppppppppppppppp',
      'pppppppppppppppppppppppppppppppppp',
      'ssssssssssssssssssssssssssssssssss',
      'gggggggggggggggggggggggggggggggggg',
      'gggggggggggggggggggggggggggggggggg'
    ],

    /* 歩けるマス（配送ロボットなので歩道と横断歩道と敷地だけ） */
    walkable: 'sxp',

    /* ---------------------------------------------------------
       街に置くもの。
         x, y   左上のマス
         w, h   マス数
         at     ロボットが用事のときに立つマス（歩けること）
       建物を動かしたいときは x, y と at をいっしょに直します。
       --------------------------------------------------------- */
    objects: [
      /* 拠点＝エージェントを動かしている事務所 */
      { id: 'home', type: 'office', x: 1, y: 1, w: 4, h: 3,
        label: 'OPERATOR', at: [2, 4] },

      /* エンドポイント＝実際に呼び出す先。看板がそのままURL */
      { id: 'svc-news', type: 'service', x: 28, y: 1, w: 5, h: 3,
        label: 'api.example.dev', at: [30, 4] },
      /* ★ 2026-10-03: 通りの南側の建物は、扉が南の面（下）にある。用事のときに立つマスを
         北の歩道（建物の裏）にしていたので、ロボットが建物の陰に隠れ、硬貨や許可証も
         建物を突き抜けて扉へ飛んでいた（利用者の報告「エージェントが建物に隠れてしまう」）。
         建物の南に歩道（14行目）を通し、扉の前に立つようにした。 */
      { id: 'svc-data', type: 'service', x: 6, y: 11, w: 5, h: 3,
        label: 'data.example.dev', at: [8, 14] },
      { id: 'svc-tc',   type: 'service', x: 9, y: 1, w: 5, h: 3,
        label: 'technocore.chat', at: [11, 4] },
      { id: 'svc-gpu',  type: 'service', x: 24, y: 11, w: 5, h: 3,
        label: 'gpu-bridge.example', at: [26, 14] },

      /* 決済の確定を映す街頭ビジョン */
      { id: 'board', type: 'signage', x: 16, y: 4, w: 3, h: 1, at: [16, 5] },

      { id: 'facil', type: 'facilitator', x: 21, y: 2, w: 3, h: 2, at: [22, 4] },
      /* 立会所＝ファシリテータの窓口（2026-09-14）。
         x402 で実際にチェーンへ載せて、ガス代を払うのはこの人。
         エージェントは署名した許可証をここへ持ってくる。 */
      

      /* 充電スタンド＝待機場所 */
      { id: 'charger', type: 'charger', x: 2, y: 9, w: 2, h: 1, at: [4, 9] },

      /* 街の細かいもの（通行止めになります） */
      { type: 'tree', x: 7,  y: 4, w: 1, h: 1 },
      { type: 'tree', x: 14, y: 4, w: 1, h: 1 },
      { type: 'tree', x: 20, y: 4, w: 1, h: 1 },
      { type: 'tree', x: 14, y: 10, w: 1, h: 1 },
      { type: 'tree', x: 20, y: 10, w: 1, h: 1 },
      { type: 'vending', x: 9, y: 9, w: 1, h: 1 },
      { type: 'signal', x: 18, y: 9, w: 1, h: 1 },
      { type: 'car', x: 3,  y: 8, w: 2, h: 1 },   /* ★ 2026-10-19: 北の車線(y=6)だと拠点(y=5)のロボットと重なるので南の車線へ */
      { type: 'car', x: 29, y: 8, w: 2, h: 1 }
    ],

    /* エンドポイントのURL → どの建物か（部分一致・先頭から順に判定） */
    routing: [
      { match: 'technocore', id: 'svc-tc' },
      { match: 'gpu',  id: 'svc-gpu' },
      { match: 'data', id: 'svc-data' },
      { match: '',     id: 'svc-news' }     // 既定
    ],

    places: {
      home:    [2, 4],
      charger: [4, 9],
      board:   [16, 5],
      facilitator: [22, 4],   /* 立会所のカウンターの前に立つマス */

      /* 複数エージェントが同時に映るための「拠点」の候補地。
         北の歩道（y=5）は端から端まで空いているので、そこに均等に
         奇数列いっぱい並べてあります。エージェント名のハッシュから
         1つを選ぶので、同じ名前は常に同じマスに戻ります
         （tools/check-world.js で全マス検証）。 */
      homes: [
        [1, 5], [3, 5], [5, 5], [7, 5], [9, 5], [11, 5], [13, 5],
        [15, 5], [17, 5], [19, 5], [21, 5], [23, 5], [25, 5], [27, 5], [29, 5], [31, 5]
      ],

      /* 同じく「用事の合間に待機する場所」の候補地。南の歩道（y=10）から、
         木（x=14,20）を避けて並べてあります。charger のすぐ近くにも
         まとまっているので「充電エリア周辺で各自ばらばらに待っている」
         ように見えます。 */
      idles: [
        [1, 10], [4, 10], [7, 10], [10, 10], [13, 10],
        [17, 10], [23, 10], [26, 10], [29, 10], [32, 10]
      ]
    },

    /* 画面に映るマス数。
       街ぜんたい（34×16）を入れているので、複数のロボットが同時に見えます。
       1体に寄りたいときは小さくすると、カメラが動くロボットを追いかけます。 */
    /* ★ 2026-10-02: 17×8 マス（建物2〜3軒ぶん）。カメラが主役を追い、歩いていくと
       画面が切り替わる（render/scene.js の camera）。縦横の比は 34×16 と同じ。 */
    view: { cols: 17, rows: 8,
            /* 縦の画面の切り替え：ロボットの行が from 以上なら、その帯の y から8行を映す。
               北側＝建物(1-3)・歩道(4-5)・車道、南側＝車道・歩道(9-10)・建物(11-13)。 */
            bands: [ { from: 0, y: 0.5 }, { from: 8, y: 7.5 } ] }
  };

})(window.AQ = window.AQ || {});
