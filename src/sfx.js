/* =============================================================
   sfx.js — 効果音（2026-10-03）
   -------------------------------------------------------------
   利用者「初心者向け。文字ではなくアニメ的な表現で」。動きに短い 8bit 風の
   音を添える（硬貨＝チャリン、判＝ドン、402＝ブブッ…）。
   ・最初は鳴らさない（音が急に出ると驚かせる）。🔈 のボタンで鳴らす。
   ・音のファイルは使わない（Web Audio で、その場で波形を作る）＝1ファイルの
     まま、ネットにもつながない。
   ・どの音を鳴らすかは main.js が「絵に新しく出た演出」を見て決める
     （絵に出ていない段階の音は鳴らない＝絵と音が食い違わない）。
   ============================================================= */
(function (AQ) {
  'use strict';

  var ac = null, master = null;
  var VOLUME = 0.07;
  var lastAt = {};          // 同じ音の連打を防ぐ（名前 → 最後に鳴らした時刻）

  function ctx() {
    if (ac) return ac;
    var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try { ac = new AC(); } catch (e) { return null; }
    master = ac.createGain(); master.gain.value = VOLUME; master.connect(ac.destination);
    return ac;
  }

  /** 1音。type: 'square'|'triangle'|'sawtooth'|'sine'。f0→f1 に音程を滑らせる。 */
  function tone(at, dur, f0, f1, type, vol) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f0, at);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol || 1, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master);
    o.start(at); o.stop(at + dur + 0.02);
  }
  /** ノイズ（判を押す・物が落ちる）。 */
  function noise(at, dur, vol, lowpass) {
    var n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass || 1200;
    src.buffer = buf; g.gain.value = vol || 1;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(at);
  }

  var SOUNDS = {
    tick:    function (t) { tone(t, 0.05, 1320, 1320, 'square', 0.45); tone(t + 0.06, 0.08, 1760, 1760, 'square', 0.45); },
    gas:     function (t) { noise(t, 0.35, 0.5, 1800); tone(t, 0.3, 200, 500, 'sawtooth', 0.25); },
    clasp:   function (t) { tone(t, 0.03, 2200, 2200, 'square', 0.5); tone(t + 0.04, 0.05, 1600, 1600, 'square', 0.4); },
    knock:   function (t) { noise(t, 0.05, 1.0, 900); noise(t + 0.13, 0.05, 1.0, 900); },
    lock:    function (t) { tone(t, 0.05, 330, 330, 'square', 0.6); tone(t + 0.07, 0.05, 330, 330, 'square', 0.6); },
    coin:    function (t) { tone(t, 0.07, 988, 988, 'square', 0.8); tone(t + 0.07, 0.22, 1319, 1319, 'square', 0.8); },
    buzz:    function (t) { tone(t, 0.12, 196, 180, 'square', 0.9); tone(t + 0.16, 0.16, 196, 160, 'square', 0.9); },
    stamp:   function (t) { noise(t, 0.12, 1.4, 500); tone(t, 0.12, 120, 60, 'triangle', 1); },
    block:   function (t) { tone(t, 0.06, 523, 523, 'square', 0.6); tone(t + 0.06, 0.06, 659, 659, 'square', 0.6); tone(t + 0.12, 0.14, 784, 784, 'square', 0.6); },
    sign:    function (t) { noise(t, 0.16, 0.35, 3500); },
    swish:   function (t) { tone(t, 0.14, 600, 1400, 'triangle', 0.5); },
    door:    function (t) { tone(t, 0.08, 392, 392, 'square', 0.5); tone(t + 0.09, 0.18, 587, 587, 'square', 0.5); },
    happy:   function (t) { [523, 659, 784, 1047].forEach(function (f, i) { tone(t + i * 0.07, 0.1, f, f, 'square', 0.5); }); },
    sad:     function (t) { tone(t, 0.18, 392, 370, 'triangle', 0.8); tone(t + 0.2, 0.3, 311, 262, 'triangle', 0.8); },
    fall:    function (t) { tone(t, 0.22, 1200, 300, 'triangle', 0.5); },
    thud:    function (t) { noise(t, 0.1, 1.2, 300); tone(t, 0.1, 90, 50, 'sine', 1); },
    scan:    function (t) { tone(t, 0.05, 1568, 1568, 'square', 0.35); tone(t + 0.08, 0.05, 1568, 1568, 'square', 0.35); },
    ok:      function (t) { tone(t, 0.09, 784, 784, 'square', 0.6); tone(t + 0.09, 0.2, 1175, 1175, 'square', 0.6); },
    ng:      function (t) { tone(t, 0.25, 220, 150, 'sawtooth', 0.5); },
    bootUp:  function (t) { tone(t, 0.35, 180, 900, 'square', 0.4); },
    bootDown:function (t) { tone(t, 0.4, 700, 120, 'square', 0.4); }
  };

  AQ.sfx = {
    enabled: false,
    names: Object.keys(SOUNDS),
    /** 検査用：直近に鳴らした（鳴らそうとした）音の名前。鳴らしていないときも
        「鳴るはずだった」順に記録する（headless では音が出ないため）。 */
    log: [],
    setEnabled: function (on) {
      this.enabled = !!on;
      if (on) { var c = ctx(); if (c && c.state === 'suspended' && c.resume) c.resume(); }
    },
    play: function (name) {
      if (!this.enabled || !SOUNDS[name]) return false;
      var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (lastAt[name] && now - lastAt[name] < 120) return false;
      lastAt[name] = now;
      this.log.push(name); if (this.log.length > 50) this.log.shift();
      var c = ctx(); if (!c) return false;
      try { SOUNDS[name](c.currentTime + 0.01); } catch (e) { return false; }
      return true;
    }
  };

})(window.AQ = window.AQ || {});
