/* =============================================================
   engine/live.js — ライブ表示（Phase 1 の中身）
   -------------------------------------------------------------
   設計の約束どおり、レンダラは最後までリプレイ専用のままです。
   ここがやるのは「新着イベントをコマ列の後ろに足す」ことだけ。

   technocore.chat の長ポーリングを使います:
     GET /r/<room>?format=json&since=<seq>&wait=10
   10秒待って新着があれば返る。無ければ空で返るので、
   これを繰り返すだけで実質のライブになります。
   読みは 120回/分まで（＝2回/秒）。10秒待ちなら余裕で収まります。

   ★ 部屋の書式は接続してみるまで分からない
     技術的には「同じ technocore.chat の、部屋名が違うだけ」なので、
     生のメッセージを取ってきたあとで adapters/detect.js と同じ判定
     （looksLikeKibble）にかけ、kibble 書式が多ければ fromKibble、
     そうでなければ fromTechnocore に流します。ロング・ポーリング自体の
     タイミングやリトライは一切変えていません。
   ============================================================= */
(function (AQ) {
  'use strict';

  AQ.live = {
    room: null,
    since: 0,
    running: false,
    onEvents: null,      // function(events) { ... }
    onStatus: null,      // function(text) { ... }
    _timer: null,
    _fromEvents: null,   // 接続後に決まる: fromTechnocore か fromKibble

    /** 生のメッセージ配列を見て、どちらの adapter で翻訳するか選ぶ。
        一度決めたら、その部屋につないでいる間は変えない。 */
    _pickAdapter: function (msgs) {
      return (AQ.adapters.looksLikeKibble && AQ.adapters.looksLikeKibble(msgs))
        ? AQ.adapters.fromKibble
        : AQ.adapters.fromTechnocore;
    },

    /** 直近メッセージだけを取る（変換前・adapter を選ぶ前に使う） */
    _fetchRaw: function (room, limit) {
      var url = AQ.adapters.technocoreBase + '/r/' + encodeURIComponent(room) +
                '?format=json&limit=' + limit;
      return fetch(url, { mode: 'cors' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (json) {
        return Array.isArray(json) ? json : (json.messages || []);
      });
    },

    /** 開始。まず直近を取ってから、以後は新着だけを追いかけます */
    start: function (room, onEvents, onStatus) {
      var self = this;
      self.stop();
      /* ★ 2026-10-08: つなぐたびに番号を変える。前のつなぎの応答（10秒の待ち受けなど）が
         あとから返ってきても、番号が違えば捨てる（部屋を切り替えたとき、前の部屋の
         発言が新しい部屋に混ざったり、待ち受けが2重になったりしていた）。 */
      var gen = self._gen = (self._gen || 0) + 1;
      self.room = room;
      self.since = 0;
      self.running = true;
      self.onEvents = onEvents || function () {};
      self.onStatus = onStatus || function () {};
      self._fromEvents = null;

      self.onStatus('connecting…');
      self._fetchRaw(room, 40).then(function (msgs) {
        if (!self.running || gen !== self._gen) return;
        self._fromEvents = self._pickAdapter(msgs);
        msgs.forEach(function (m) {
          if (m.seq != null && m.seq > self.since) self.since = m.seq;
        });
        self.onEvents(self._fromEvents(msgs, { room: room, observedAt: Date.now() }));
        self.onStatus('LIVE · ' + room + ' · seq ' + self.since);
        self._poll(gen);
      }).catch(function (e) {
        if (gen !== self._gen) return;
        self.running = false;
        self.onStatus('failed: ' + e.message);
      });
    },

    stop: function () {
      this.running = false;
      this._gen = (this._gen || 0) + 1;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    },

    _poll: function (gen) {
      var self = this;
      if (gen == null) gen = self._gen;
      if (!self.running || gen !== self._gen) return;
      var url = AQ.adapters.technocoreBase + '/r/' + encodeURIComponent(self.room) +
                '?format=json&since=' + self.since + '&wait=10';

      fetch(url, { mode: 'cors' })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (json) {
          if (!self.running || gen !== self._gen) return;
          var msgs = Array.isArray(json) ? json : (json.messages || []);
          if (msgs.length) {
            if (!self._fromEvents) self._fromEvents = self._pickAdapter(msgs);
            msgs.forEach(function (m) {
              if (m.seq != null && m.seq > self.since) self.since = m.seq;
            });
            // 新着は「今」観測したもの。推定の間隔は詰める。
            var ev = self._fromEvents(msgs, {
              room: self.room, observedAt: Date.now(), spacingMs: 400
            }).filter(function (e) {
              return e.type !== 'run.start' && e.type !== 'run.end';
            });
            self.onEvents(ev);
          }
          self.onStatus('LIVE · ' + self.room + ' · seq ' + self.since);
          self._timer = setTimeout(function () { self._poll(gen); }, 500);
        })
        .catch(function (e) {
          if (!self.running || gen !== self._gen) return;
          self.onStatus('retrying… (' + e.message + ')');
          self._timer = setTimeout(function () { self._poll(gen); }, 4000);
        });
    }
  };

})(window.AQ = window.AQ || {});
