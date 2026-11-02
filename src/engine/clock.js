/* =============================================================
   engine/clock.js — 再生時計
   -------------------------------------------------------------
   コマを1つずつ進めるだけの小さな時計。
   ライブ表示（Phase1）にするときは、beats に後ろから足していけば
   この時計はそのまま使えます（だから中身に実時刻を持たせていない）。
   ============================================================= */
(function (AQ) {
  'use strict';

  AQ.Clock = function (opts) {
    var self = this;
    this.beats   = opts.beats || [];
    this.index   = 0;
    this.elapsed = 0;          // 現在のコマの経過 [ms]
    this.speed   = AQ.config.defaultSpeed;
    this.playing = false;
    this.onBeat  = opts.onBeat  || function () {};
    this.onFrame = opts.onFrame || function () {};
    this._last   = 0;
    this._raf    = null;
    /* ★ 2026-09-30: 始動と終了の動作（報告「初めて動きだすときは始動の動作が、
       タスクを終了するときも終了する動作が欲しい」）。
       bootMs … 頭から再生を始めるとき、最初のコマを進める前に置く時間
       tailMs … 最後のコマを終えたあと、止まる前に置く時間
       どちらも実時間（再生速度に関係なく同じ長さ）。コマそのもの（durationOf）
       は変えない＝ログのどの行が何コマ目か、は何も変わらない。
       0 なら今までどおり（main.js が、選んで再生しているときだけ入れる）。 */
    this.bootMs  = 0;
    this.tailMs  = 0;
    this.bootLeft = 0;         // 始動の残り [ms]
    this.tailT    = 0;         // 終了の経過 [ms]

    this.durationOf = function (i) {
      var b = self.beats[i];
      if (!b) return 1000;
      var base = AQ.config.beatMs[b.kind] || 1200;
      /* ★ 2026-09-28: 歩く速さを一定にする。
         以前は「どのコマも決まった時間の中で目的地まで歩き切る」作りで、
         遠くへ行くコマほど速く歩いた（さらに件数の多い場面では何往復も
         したので、そこだけ猛スピードに見えた＝利用者の報告「0.25倍なのに
         猛然としたスピードで動き出し、その後 0.25倍の動きになる」）。
         いまは歩く速さのほうを固定し（render/room.js の MS_PER_TILE）、
         遠い場所へ行くコマは、歩き切れるだけコマ自体を長くする。
         歩くのはコマの前半 70%（WALK_UNTIL）なので、その分で割る。 */
      var wm = (AQ.stage && AQ.stage.walkMsFor) ? AQ.stage.walkMsFor(b) : 0;
      if (wm > 0) return Math.max(base, Math.round(wm / 0.7));
      return base;
    };

    this.progress = function () {
      var d = self.durationOf(self.index);
      return d ? Math.min(1, self.elapsed / d) : 1;
    };

    this.setBeats = function (beats) {
      self.beats = beats || [];
      self.index = 0;
      self.elapsed = 0;
      self.onBeat(self.index);
    };

    this.seek = function (i) {
      self.index = Math.max(0, Math.min(self.beats.length - 1, i));
      self.elapsed = 0;
      self.bootLeft = 0; self.tailT = 0;
      self.onBeat(self.index);
      self.onFrame();          // 停止中でも必ず描き直す
    };

    this.step = function () {
      self.pause();
      self.seek(self.index + 1);
    };

    this.stepBack = function () {
      self.pause();
      self.seek(self.index - 1);
    };

    this.restart = function () { self.seek(0); self.play(); };

    /** 始動・終了の進み具合。boot: 0..1（始動中）/ null（始動していない）、
        end: 0（終わっていない）..1（終了の動作を終えた）。 */
    this.phase = function () {
      return {
        boot: (self.bootMs > 0 && self.bootLeft > 0) ? 1 - self.bootLeft / self.bootMs : null,
        end: (self.tailMs > 0 && self.tailT > 0) ? Math.min(1, self.tailT / self.tailMs) : 0
      };
    };

    this.play = function () {
      if (self.playing) return;
      /* 終了の動作は「最後のコマを終えたところ」にいるときだけ意味がある。
         呼び出し側がコマの位置を直接書き換えた（別の子を選んだ等）ときは捨てる。 */
      if (self.tailT > 0 && (self.index !== self.beats.length - 1 || self.elapsed < self.durationOf(self.index))) self.tailT = 0;
      /* 頭から（まだ1歩も進んでいない）再生を始めるときだけ始動する。 */
      if (self.bootMs > 0 && self.index === 0 && self.elapsed === 0 && !self.tailT) self.bootLeft = self.bootMs;
      self.playing = true;
      self._last = performance.now();
      loop(self._last);
    };

    this.pause = function () {
      self.playing = false;
      if (self._raf) cancelAnimationFrame(self._raf);
      self._raf = null;
    };

    this.toggle = function () { self.playing ? self.pause() : self.play(); };

    function loop(now) {
      if (!self.playing) return;
      /* ★ 2026-09-28: 1フレームで進める時間に上限を付ける。
         重い処理（エージェントを選んだ直後の集計など）で次のフレームが
         遅れると、以前はその遅れた分を一気に進めていた＝ロボットが
         瞬間移動したり、選んだ直後だけ猛スピードで走ったりして見えた
         （報告「クリックして選んだ直後に暴走気味に動く」）。
         遅れた分は捨て、1フレームぶん（最大 MAX_FRAME_MS）だけ進める。 */
      var MAX_FRAME_MS = 50;
      var raw = Math.min(Math.max(0, now - self._last), MAX_FRAME_MS);
      self._last = now;

      /* 始動中：コマは進めない（実時間で数える） */
      if (self.bootLeft > 0) {
        var u = Math.min(self.bootLeft, raw);
        self.bootLeft -= u; raw -= u;
        if (raw <= 0) { self.onFrame(); self._raf = requestAnimationFrame(loop); return; }
      }
      /* 終了の動作中：コマは最後のまま（LIVE で後ろにコマが増えたら、そちらへ戻る） */
      if (self.tailT > 0) {
        if (self.index < self.beats.length - 1) {
          self.tailT = 0;
        } else {
          self.tailT = Math.min(self.tailMs, self.tailT + raw);
          if (self.tailT >= self.tailMs) { self.pause(); self.onFrame(); return; }
          self.onFrame(); self._raf = requestAnimationFrame(loop); return;
        }
      }

      var dt = raw * self.speed;
      self.elapsed += dt;

      var d = self.durationOf(self.index);
      while (self.elapsed >= d) {
        self.elapsed -= d;
        if (self.index >= self.beats.length - 1) {
          self.elapsed = d;              // 最後のコマで止まる
          if (self.tailMs > 0) {         // 止まる前に、終了の動作
            self.tailT = 0.001;
            self.onFrame();
            self._raf = requestAnimationFrame(loop);
            return;
          }
          self.pause();
          self.onFrame();
          return;
        }
        self.index++;
        self.onBeat(self.index);
        d = self.durationOf(self.index);
      }
      self.onFrame();
      self._raf = requestAnimationFrame(loop);
    }
  };

})(window.AQ = window.AQ || {});
