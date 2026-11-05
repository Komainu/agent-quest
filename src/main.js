/* =============================================================
   main.js — 配線だけ
   -------------------------------------------------------------
   ロジックはここに書かないこと。
   「どの部品をどうつなぐか」だけを置く場所です。
   ============================================================= */
(function (AQ) {
  'use strict';

  var userPaused = false;   // ユーザーが自分で停止したか
  var clock, fullBeats = [], playBeats = [], stats = { shown: 0, total: 0 }, st;

  /* ★ 2026-09-08: 追う対象を「エージェント1体」から「依頼1件」へ変えた。
     1体を追うと、その子が同時に抱えている複数の依頼が入り乱れ、①〜④が
     行ったり来たりして人間には追えない（利用者の報告）。依頼1件なら
     ①出された→②引き受けた→③納品→④判定 は必ず一方通行で、登場人物も
     出した人・引き受けた人・判定した人の2〜3体に減る。
     null＝まだ何も選んでいない（＝何も再生しない）。 */
  var focusJob = null;
  var focusActor = null;   // 旧・1体だけに絞る道（依頼の無いログ用に残す）
  var jobIndex = { list: [], byId: {} };   // rebuild のたびに作り直す依頼の索引
  /* ★ 2026-09-12: 追い方は2通り。'jobs'＝依頼から入る、'agents'＝
     エージェントから入る。どちらを選んでも、最後に再生するのは
     「依頼1件」＝画面の作りは1本のまま（エージェントを選んだときは、
     その子が関わった依頼のうち代表の1件を自動で再生する）。 */
  /* ★ 2026-09-28: 最初に並べるのはエージェント（「エージェント目線のほうが
     わかりやすい」という指摘）。依頼IDの無いログは hud 側が名簿に切り替える。 */
  var listMode = 'agents';
  var agentFilter = null;                 // エージェントで絞っているときの actor
  var agentIndex = { list: [], byId: {} };
  var agentStory = null;                  // エージェントから入ったときの「まとめ」

  /* LIVE の追いつき（task B）。liveFollowing=false の間は、届いた量が
     どれだけ増えても自動では追いつかない（ユーザーがコマ送り／一時停止／
     スクラブで自分の位置を選んだと分かったとき）。 */
  var liveFollowing = true;
  var liveTotalSkipped = 0;   // 累計スキップ数（正直に出し続ける）
  var liveSkipMsgUntil = 0;   // この時刻まで「N コマ飛ばした」の表示を保持する

  function $(id) { return document.getElementById(id); }

  var el = {
    canvas:   $('scene'),
    win:      $('win'),
    raw:      $('raw'),
    usdc:     $('usdc'),    usdcLbl:    $('usdc-lbl'),
    credits:  $('credits'), creditsLbl: $('credits-lbl'),
    retries:  $('retries'), retriesLbl: $('retries-lbl'),
    /* 支払いの無いログでは USDC・CREDITS・RETRIES を隠すための、
       span 自体への参照（変更B）。 */
    hudUsdc: $('hud-usdc'), hudCredits: $('hud-credits'), hudRetries: $('hud-retries'),
    showing:  $('showing'),
    beat:     $('beat'),
    scrub:    $('scrub'),
    play:     $('play'),
    step:     $('step'),
    restart:  $('restart'),
    speed:    $('speed'),   speedLbl: $('speed-lbl'),
    file:     $('file'),    openLbl:  $('open-lbl'),
    runSelect:$('run'),     runLbl:   $('run-lbl'),
    lang:     $('lang'),
    introBtn: $('introBtn'),
    homeBtn:  $('homeBtn'),
    startScreen: $('startScreen'),
    startTitle:  $('startTitle'),
    startIdLbl:  $('startIdLbl'),
    startId:     $('startId'),
    startGo:     $('startGo'),
    startIdSub:  $('startIdSub'),
    startErr:    $('startErr'),
    startLive:   $('startLive'),
    startLiveT:  $('startLiveT'),
    startLiveS:  $('startLiveS'),
    startDemo:   $('startDemo'),
    startDemoT:  $('startDemoT'),
    startDemoS:  $('startDemoS'),
    hint:     $('hint'),
    drophint: $('drophint'),
    advancedSummary: $('advanced-summary'),
    room:     $('room'),
    connect:  $('connect'),
    placesPanel: $('placesPanel'),
    placesPin:   $('placesPin'),
    placesRefresh: $('placesRefresh'),
    placesList:  $('placesList'),
    placesHead:  $('placesHead'),
    placesWarn:  $('placesWarn'),
    liveLbl:  $('live-lbl'),
    liveStat: $('live-status'),
    liveSkip: $('live-skip'),
    catchup:  $('catchup'),
    chain:    $('chain'),
    addr:     $('addr'),    addrLbl:  $('addr-lbl'),
    loadAddr: $('loadaddr'),
    liveHelp:    $('livehelp'),
    roster:      $('roster'),
    rosterChips: $('roster-chips'),
    modeJobs:    $('modeJobs'),
    modeAgents:  $('modeAgents'),
    rosterHead:  $('roster-head'),
    rosterFilter:$('roster-filter'),
    focusAll2:   $('focusAll2'),
    rosterNote:  $('roster-note'),
    sideNote:    $('sideNote'),
    sideCol:     $('sideCol'),
    focusStat:   $('focus-stat'),
    focusDid:    $('focusDid'),
    focusGo:     $('focusGo'),
    detailToggle:$('detail'),
    detailPanel: $('detailPanel'),
    detailClose: $('detailClose'),
    detailBody:  $('detailBody'),
    detailTitle: $('detailTitle'),
    detailNow:   $('detailNow'),
    soundBtn:    $('soundBtn'),
    cmdMenu:     $('cmdMenu'),
    cmdHead:     $('cmdHead'),
    cmdWin:      $('cmdWin'),
    cmdWinBody:  $('cmdWinBody'),
    cmdWinClose: $('cmdWinClose'),
    closeup:     $('closeup'),
    lower:       $('lower'),
    recap:       $('recap'),
    recapRec:    $('recapRec'),
    stageWipe:   $('stageWipe'),
    wipeIcon:    $('wipeIcon'),
    recDot:      $('recDot'),
    toast:       $('toast'),
    modeTag:     $('modeTag'),
    shareBtn:    $('shareBtn'),
    recapSteps:  $('recapSteps'),
    recapFacts:  $('recapFacts'),
    recapClose:  $('recapClose'),
    recapAgain:  $('recapAgain'),
    recapNext:   $('recapNext'),
    moreText:    $('moreText'),
    moreTextLbl: $('moreTextLbl'),
    rawLine:     $('raw'),
    beatLbl:     $('beat'),
    hudBar:      (document.querySelector ? document.querySelector('.hud') : null),
    langJa:      $('lang-ja'),
    langEn:      $('lang-en')
  };

  /* ---- 起動 ---- */
  /* ---- 絵を空いている高さまで大きくする（2026-10-05）-------------------------
     利用者「画面の下の薄いグレーの部分がかなり大きく余白になっているのはなぜか」。
     絵の大きさは CSS で「画面の高さ×係数」と決めていて、その係数は見出し・生のログ・
     LIVE の欄などが全部出ていた頃の、いちばん背の高い場面に合わせてあった。やさしい表示で
     それらを外したぶん、下が空いたままになっていた（実測 1474×757 で 150〜226px）。
     読み込み・画面の大きさの変更・表示の切り替えのたびに、空いている高さを測り、
     そのぶん絵を大きくする（縦横比はそのまま＝横も広がる）。見出しの行が増える場面の
     ために、少し（RESERVE）残しておく。大きさが変わったら絵を描き直す（ぼやけないように）。 */
  var FIT_RESERVE = 62, fitTimer = null, fitting = false;
  function fitCanvas() {
    if (fitting || !el.canvas || !el.canvas.getBoundingClientRect || !document.querySelector) return;
    var main = document.querySelector('main');
    if (!main || !window.innerHeight) return;
    fitting = true;
    /* 下の欄が余りの高さを吸って伸びる作り（css）なので、測る間だけ伸びを止める */
    if (main.classList) main.classList.add('fit-measure');
    var changed = false;
    try {
      var c = el.canvas, prev = c.style.width;
      c.style.width = '';                                   // CSS の既定の大きさ
      var base = c.getBoundingClientRect().width;
      var rawSlack = window.innerHeight - (main.getBoundingClientRect().bottom + 12);
      var slack = rawSlack - FIT_RESERVE;
      c.style.width = '100%';
      var full = c.getBoundingClientRect().width;            // 入る横幅いっぱい
      var W = (AQ.stage.current === 'room') ? AQ.roomWorld : AQ.world;
      var aspect = (W && W.view) ? W.view.cols / W.view.rows : 2.125;
      var target = base;
      if (slack > 8) target = Math.min(full, 1600, base + slack * aspect);
      else if (rawSlack < 50) target = Math.max(320, base + (rawSlack - 50) * aspect);   // 下の欄のぶん、はみ出すなら縮める（見出しが1行増える場面のぶんだけ残す）
      var want = (Math.abs(target - base) > 4) ? Math.floor(target) + 'px' : '';
      c.style.width = want;
      if (want !== prev && Math.abs(parseFloat(want || base) - parseFloat(prev || base)) > 2) {
        changed = true;
        AQ.stage.init(c);
        if (fullBeats) AQ.stage.prepare(fullBeats);
        if (typeof syncFocusPlan === 'function') syncFocusPlan();
        syncSideColHeight();
      }
    } finally {
      if (main.classList) main.classList.remove('fit-measure');
      fitting = false;
    }
    if (changed) frame();       /* 下の欄の伸びを戻してから描き直す（寄り絵の大きさも合う） */
  }
  function fitCanvasSoon() {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(function () { fitTimer = null; fitCanvas(); }, 60);
  }

  /* ---- スマホ（2026-10-03）----------------------------------------------
     幅の狭い画面では、街の画面に映すマス数を減らしてカメラを寄せる。
     幅が境目をまたいだときだけ、絵を作り直す（毎回は作り直さない）。 */
  var wideCityCols = null;
  function cityColsFor() {
    if (wideCityCols == null) wideCityCols = AQ.world.view.cols;
    var narrow = (window.innerWidth || 1200) < (AQ.config.narrowWidth || 700);
    var bc = bodyCls(); if (bc) bc.toggle('narrow', narrow);
    return narrow ? (AQ.config.narrowCityCols || wideCityCols) : wideCityCols;
  }
  function applyViewport(redraw) {
    var cols = cityColsFor();
    if (AQ.world.view.cols === cols) return false;
    AQ.world.view.cols = cols;
    if (redraw) {
      AQ.stage.init(el.canvas);
      if (fullBeats) AQ.stage.prepare(fullBeats);
      if (typeof syncFocusPlan === 'function') syncFocusPlan();
      frame();
    }
    return true;
  }

  function langButtons() {
    var pill = $('langPill');
    return (pill && pill.querySelectorAll) ? Array.prototype.slice.call(pill.querySelectorAll('button')) : [];
  }
  function syncLangPill() {
    langButtons().forEach(function (b) {
      var on = b.getAttribute('data-l') === AQ.i18n.lang;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  /** 表示言語を切り替えて、すべての部品を描き直す。選んだ言語はこのブラウザに覚えておく */
  function setLang(l) {
    l = l === 'en' ? 'en' : 'ja';
    try { localStorage.setItem('aq.lang', l); } catch (e) {}
    if (l === AQ.i18n.lang) { syncLangPill(); return; }
    AQ.i18n.set(l);
    {
      document.documentElement.lang = AQ.i18n.lang;
      AQ.hud.relabel();
      relabelPlaces();
      relabelStart();
      relabelEasy();
      relabelSound();
      syncModeTag();
      relabelShare();
      relabelCmd();
      if (AQ.birth) AQ.birth.relabel();
      if (AQ.robot) AQ.robot.relabel();
      if (AQ.errand) AQ.errand.relabel();
      if (AQ.reputation) AQ.reputation.relabel();
      if (AQ.mailbox) AQ.mailbox.relabel();
      if (AQ.memo) AQ.memo.relabel();
      if (AQ.deal) AQ.deal.relabel();
      if (AQ.quest) AQ.quest.render();
      if (AQ.birth && AQ.birth.relabelDoor) AQ.birth.relabelDoor();
      updateHintLine();
      frame();
      syncLangPill();
    }
  }

  function boot() {
    /* 2026-10-16: 前に選んだ表示言語で始める */
    try { var savedLang = localStorage.getItem('aq.lang'); if (savedLang === 'en' || savedLang === 'ja') AQ.i18n.set(savedLang); } catch (e) {}
    document.documentElement.lang = AQ.i18n.lang;
    applyViewport(false);
    AQ.stage.init(el.canvas);
    AQ.hud.init(el);

    // 速度の選択肢を config から作る
    AQ.config.speeds.forEach(function (s) {
      var o = document.createElement('option');
      o.value = String(s); o.textContent = s + '×';
      if (s === AQ.config.defaultSpeed) o.selected = true;
      el.speed.appendChild(o);
    });

    // 対応チェーンの一覧を data/chains.js から作る
    (AQ.chains || []).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.label;
      if (c.id === AQ.defaultChain) o.selected = true;
      el.chain.appendChild(o);
    });

    // デモの一覧を data/runs から作る
    Object.keys(AQ.runs).forEach(function (key) {
      var o = document.createElement('option');
      o.value = key;
      o.dataset.key = 'run.' + key;
      o.textContent = AQ.i18n.t('run.' + key);
      if (key === AQ.config.defaultRun) o.selected = true;
      el.runSelect.appendChild(o);
    });

    clock = new AQ.Clock({ beats: [], onBeat: onBeat, onFrame: frame });
    AQ.hud.onJobRequest = handleJobClick;      // 依頼一覧の行クリック → その1件に絞る
    AQ.hud.onFocusRequest = handleFocusClick;  // 依頼IDの無いログでは今までどおり1体に絞る
    AQ.hud.onAgentRequest = handleAgentClick;  // エージェント一覧の行クリック
    AQ.hud.onAgentBack    = handleAgentBack;   // ◀ エージェント一覧へ戻る

    bindUI();
    bindRoster();
    bindPlaces();
    bindStart();
    initEasy();
    bindSound();
    bindRecap();
    bindShare();
    bindCmd();
    /* ロボットまわりの部品は1つずつ起こす。どれか1つが壊れた記録などで止まっても、
       ほかの部品とはじめの画面まで道連れにしない（エラーはコンソールに残す）。 */
    ['birth', 'robot', 'errand', 'reputation', 'mailbox', 'memo', 'deal', 'quest'].forEach(function (k) {
      if (!AQ[k] || !AQ[k].init) return;
      try { AQ[k].init(); } catch (e) { if (window.console) console.error('[AQ] ' + k + '.init', e); }
    });
    AQ.hud.relabel();
    relabelPlaces();
    relabelStart();
    relabelEasy();
    relabelShare();
    relabelCmd();
    if (AQ.config.startScreen && el.startScreen) {
      /* はじめの画面の後ろには、入門の街を「家具だけ」で置いておく（誰も選んで
         いないのでロボットは描かれない・再生もしない）。 */
      startBackdrop = true;
      loadRun(AQ.config.defaultRun);
      startBackdrop = false;
      backdropOnly = true;
      showStart();
      lastStageName = AQ.stage.current;
      startFromUrl();
    } else if (AQ.config.defaultRun === INTRO_RUN) startIntro();
    else loadRun(AQ.config.defaultRun);
  }

  /* ---- やさしい表示（2026-10-03）-------------------------------------------
     利用者「初心者向け。文字だけで表すより、デザイン性・アニメ的な表現で」。
     1画面に文字の層が7〜8種類あった（英語の数字・右の説明・生のログ・
     「#1 のみ表示」・コマ数・LIVE の欄…）。常に出すのは「見出し1行」と
     「①〜⑤の段階」だけにし、ほかは ⓘ（詳細）の「いまの場面」へ移す。
     ★ 消すのではなく移す（このアプリの約束：画面から外したものは
       ツールチップか詳細に必ず残す）。見出しにマウスを乗せると生のログも出る。
     ★ 「これは作り話です」の1行（入門）だけは、やさしい表示でも必ず出す。 */
  var EASY_KEY = 'aq.moreText';
  function readMorePref() {
    try { var v = window.localStorage.getItem(EASY_KEY); return v == null ? null : v === '1'; }
    catch (e) { return null; }
  }
  function bodyCls() { return (document.body && document.body.classList) ? document.body.classList : null; }
  function isEasy() { var c = bodyCls(); return c ? c.contains('easy') : false; }
  function setEasy(on, save) {
    var bc = bodyCls(); if (bc) bc.toggle('easy', !!on);
    if (el.moreText) el.moreText.checked = !on;
    if (save) { try { window.localStorage.setItem(EASY_KEY, on ? '0' : '1'); } catch (e) {} }
    lastNowKey = '';
    syncSideColHeight();
    fitCanvasSoon();
  }
  function initEasy() {
    var more = readMorePref();
    setEasy(more == null ? !!AQ.config.easyMode : !more, false);
    if (el.moreText) el.moreText.addEventListener('change', function () {
      setEasy(!el.moreText.checked, true);
      frame();
    });
  }
  function relabelEasy() {
    var t = AQ.i18n.t;
    if (el.moreTextLbl) el.moreTextLbl.textContent = t('ui.moreText');
    if (el.moreText && el.moreText.parentNode) el.moreText.parentNode.title = t('ui.moreTextTitle');
    lastNowKey = '';
  }
  /** やさしい表示で画面から外した文字を、詳細パネルの「いまの場面」に写す。
      パネルが開いているときだけ、中身が変わったときだけ書く（毎フレーム書かない）。 */
  var lastNowKey = '';
  function syncEasyNow() {
    var raw = el.rawLine ? (el.rawLine.textContent || '').trim() : '';
    /* 見出しにマウスを乗せると生のログが出る（やさしい表示でも事実に1手で届く） */
    if (el.win && isEasy()) { if (el.win.title !== raw) el.win.title = raw; }
    else if (el.win && el.win.title) el.win.title = '';
    if (!el.detailNow) return;
    var show = isEasy() && el.detailPanel && !el.detailPanel.hidden;
    if (!show) { if (!el.detailNow.hidden) el.detailNow.hidden = true; lastNowKey = ''; return; }
    var t = AQ.i18n.t, esc2 = AQ.hud.esc;
    var nums = [];
    if (el.hudBar) Array.prototype.forEach.call(el.hudBar.querySelectorAll('span'), function (sp) {
      if (sp.hidden || sp.style.display === 'none') return;
      var tx = (sp.textContent || '').replace(/\s+/g, ' ').trim();
      if (tx && tx !== '—') nums.push(tx);
    });
    var note = (el.sideNote && !el.sideNote.hidden) ? el.sideNote.innerHTML : '';
    var focus = (el.focusStat && !el.focusStat.hidden) ? (el.focusStat.textContent || '').trim() : '';
    var beat = el.beatLbl ? (el.beatLbl.textContent || '').trim() : '';
    var key = [AQ.i18n.lang, nums.join('|'), note, raw, focus, beat].join('\u0001');
    if (key === lastNowKey) { if (el.detailNow.hidden) el.detailNow.hidden = false; return; }
    lastNowKey = key;
    var row = function (k, v, html) {
      return v ? '<div class="drow"><span class="dlabel">' + esc2(t(k)) + '</span><span class="dval">' + (html ? v : esc2(v)) + '</span></div>' : '';
    };
    el.detailNow.innerHTML = '<p class="dhead">' + esc2(t('ui.nowHead')) + '</p>' +
      (note ? '<div class="now-note">' + note + '</div>' : '') +
      row('ui.nowRaw', raw) + row('ui.nowNumbers', nums.join(' · ')) +
      row('ui.nowBeat', [beat, focus].filter(Boolean).join(' · '));
    el.detailNow.hidden = false;
  }

  /* ---- 効果音（2026-10-03）-------------------------------------------------
     絵に「新しく出た演出」を見て、その音を1回鳴らす（絵に無い段階の音は鳴らない）。
     再生中に、前のフレームから続けて進んでいるときだけ鳴らす（止めてコマを選び
     直したり、つまみを動かしたりしたときは鳴らさない）。最初は鳴らさない。 */
  var SFX_KEY = 'aq.sound';
  var SFX_MAP = {
    'fx:paper': 'swish', 'fx:purse-open': 'clasp', 'fx:knock': 'knock', 'fx:lock': 'lock',
    'fx:check-sig': 'tick', 'fx:check-amount': 'tick', 'fx:check-balance': 'tick', 'fx:check-expiry': 'tick', 'fx:gas': 'gas', 'fx:tag402': 'buzz', 'fx:sign': 'sign', 'fx:coin': 'coin',
    'fx:stamp': 'stamp', 'fx:block-land': 'block', 'fx:coin-to-shop': 'coin', 'fx:door-open': 'door',
    'mood:happy': 'happy', 'mood:sad': 'sad',
    'fx:fall': 'fall', 'fx:dust': 'thud', 'fx:scan': 'scan',
    'fx:take': 'swish', 'fx:pickup': 'swish', 'fx:pin': 'clasp', 'fx:write': 'sign',
    'mark:ok': 'ok', 'mark:ng': 'ng', 'phase:boot': 'bootUp', 'phase:end': 'bootDown'
  };
  var sfxPrev = { idx: -1, t: 0, set: {} };
  function sfxTokens() {
    var set = {}, stage = el.canvas && el.canvas.dataset ? el.canvas.dataset.stage : 'city';
    var add = function (k) { set[k] = (set[k] || 0) + 1; };
    var R = (stage === 'room') ? AQ.room : AQ.scene;
    if (R && R.lastFx) (R.lastFx() || []).forEach(function (f) { if (!set['fx:' + f]) add('fx:' + f); });
    /* 画面の下の寄り絵（建物の中）の動きにも音を付ける（立会所の ✓・判・ガスなど） */
    if (stage !== 'room' && AQ.scene && AQ.scene.lastCloseup) (AQ.scene.lastCloseup().fx || []).forEach(function (f) { if (!set['fx:' + f]) add('fx:' + f); });
    if (R && R.lastMood) { var md = R.lastMood(); if (md) add('mood:' + md); }
    if (stage === 'room' && AQ.room && AQ.room.lastMarks) (AQ.room.lastMarks() || []).forEach(function (m) { add(m.ok ? 'mark:ok' : 'mark:ng'); });
    var ph = clock.phase ? clock.phase() : null;
    if (ph && ph.boot != null) add('phase:boot');
    if (ph && ph.end > 0 && ph.end < 1) add('phase:end');
    return set;
  }
  function syncSfx() {
    var now = performance.now();
    var cur = sfxTokens();
    var cont = clock.playing && now - sfxPrev.t < 400 &&
               (clock.index === sfxPrev.idx || clock.index === sfxPrev.idx + 1);
    if (cont && AQ.sfx && AQ.sfx.enabled) {
      var newBeat = clock.index !== sfxPrev.idx;
      Object.keys(cur).forEach(function (k) {
        var was = sfxPrev.set[k] || 0;
        /* 演出・表情はコマが変われば出直す。合否の印は数で数える（板の上に残り続けるため） */
        if (newBeat && k.indexOf('mark:') !== 0) was = 0;
        if (cur[k] > was && SFX_MAP[k]) AQ.sfx.play(SFX_MAP[k]);
      });
    }
    sfxPrev = { idx: clock.index, t: now, set: cur };
  }
  function relabelSound() {
    if (!el.soundBtn || !AQ.sfx) return;
    var on = AQ.sfx.enabled, t = AQ.i18n.t;
    el.soundBtn.textContent = '♪';
    el.soundBtn.classList.toggle('off', !on);
    el.soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.soundBtn.title = t(on ? 'ui.soundOff' : 'ui.soundOn');
    el.soundBtn.setAttribute('aria-label', el.soundBtn.title);
  }
  function bindSound() {
    if (!el.soundBtn || !AQ.sfx) { if (el.soundBtn) el.soundBtn.hidden = true; return; }
    var saved = null;
    try { saved = window.localStorage.getItem(SFX_KEY); } catch (e) {}
    /* 前に鳴らしていた人でも、開いた直後は鳴らさない（ブラウザが最初の操作まで
       音を止めるため）。最初にどこかを押したときに戻す。 */
    if (saved === '1') {
      var once = function () { document.removeEventListener('pointerdown', once, true); if (!AQ.sfx.enabled) { AQ.sfx.setEnabled(true); relabelSound(); } };
      document.addEventListener('pointerdown', once, true);
    }
    el.soundBtn.addEventListener('click', function () {
      AQ.sfx.setEnabled(!AQ.sfx.enabled);
      try { window.localStorage.setItem(SFX_KEY, AQ.sfx.enabled ? '1' : '0'); } catch (e) {}
      if (AQ.sfx.enabled) AQ.sfx.play('coin');
      relabelSound();
    });
    relabelSound();
  }

  /* ---- 振り返り（2026-10-03）-----------------------------------------------
     最後まで再生し終えたら、絵の上に「この子がしたこと」を記号で並べる。
     ・並べるのは、いま再生していたコマ（＝ログにある事）だけ。同じことが続いたら ×N
     ・数字はログから数えたものだけ（払った額の合計・チェーンに載った回数など）
     ・記号を押すと、その場面へ戻る。↺ でもう一度、もう1つのボタンで入口の画面へ
     ・LIVE でつないでいる間は出さない（記録はまだ続くので「終わり」ではない） */
  var RECAP_ICON = {
    start:   '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5" fill="none" stroke="#3ddc84" stroke-width="2"/><rect x="7" y="1.5" width="2" height="7" fill="#3ddc84"/></svg>',
    plan:    '<svg viewBox="0 0 16 16"><circle cx="8" cy="7" r="4.5" fill="#f2f5fa"/><circle cx="4" cy="9" r="3" fill="#f2f5fa"/><circle cx="12" cy="9" r="3" fill="#f2f5fa"/><circle cx="4" cy="14" r="1.3" fill="#f2f5fa"/><rect x="5" y="8" width="1.6" height="1.6" fill="#5a6070"/><rect x="7.4" y="8" width="1.6" height="1.6" fill="#5a6070"/><rect x="9.8" y="8" width="1.6" height="1.6" fill="#5a6070"/></svg>',
    travel:  '<svg viewBox="0 0 16 16"><rect x="3" y="1.5" width="10" height="13" fill="#f4f1e4" stroke="#0d1017"/><rect x="5" y="4" width="6" height="1" fill="#9aa0ae"/><rect x="5" y="7" width="4" height="1" fill="#9aa0ae"/><rect x="5" y="10" width="6" height="1" fill="#9aa0ae"/></svg>',
    require: '<svg viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="10" fill="#ffe08a" stroke="#0d1017"/><text x="8" y="11" font-size="6.5" text-anchor="middle" fill="#c02b1c" font-family="monospace" font-weight="700">402</text></svg>',
    error:   '<svg viewBox="0 0 16 16"><path d="M3 3 L13 13 M13 3 L3 13" stroke="#ff6b5b" stroke-width="3" stroke-linecap="round"/></svg>',
    refused: '<svg viewBox="0 0 16 16"><g transform="rotate(-12 8 8)"><rect x="1" y="3.5" width="13" height="9" fill="#ffe08a" stroke="#0d1017"/><text x="7.5" y="10.6" font-size="6" text-anchor="middle" fill="#c02b1c" font-family="monospace" font-weight="700">402</text></g><path d="M11 1.5 v3 M12.6 2 l-1 2.4 M9.4 2 l1 2.4" stroke="#ffd35c" stroke-width="1"/></svg>',
    pay:     '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="9" height="12" fill="#f4f1e4" stroke="#0d1017"/><path d="M3.5 11 q1.5 -2 3 0 t3 0" stroke="#2753a8" fill="none"/><rect x="7.5" y="9" width="3" height="3" fill="#c02b1c"/><circle cx="12.5" cy="5" r="3" fill="#2775ca"/><rect x="12" y="3.2" width="1" height="3.6" fill="#e8f1ff"/></svg>',
    settle:  '<svg viewBox="0 0 16 16"><rect x="1" y="6" width="4" height="4" fill="#2f6fbd"/><rect x="6" y="6" width="4" height="4" fill="#2f6fbd"/><rect x="11" y="6" width="4" height="4" fill="#3ddc84"/><rect x="5" y="7.5" width="1" height="1" fill="#7fb4ff"/><rect x="10" y="7.5" width="1" height="1" fill="#7fb4ff"/></svg>',
    receive: '<svg viewBox="0 0 16 16"><rect x="2" y="4" width="12" height="10" fill="#c8a06a" stroke="#0d1017"/><rect x="7" y="4" width="2" height="10" fill="#b08c58"/><rect x="2" y="8" width="12" height="1" fill="#a37f4e"/></svg>',
    deliver: '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="8" fill="#c8a06a" stroke="#0d1017"/><path d="M8 1 V6 M5.5 3.8 L8 6.3 L10.5 3.8" stroke="#ffd35c" stroke-width="1.8" fill="none"/></svg>',
    ok:      '<svg viewBox="0 0 16 16"><path d="M2.5 8.5 L6.5 12.5 L13.5 3.5" stroke="#3ddc84" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
    ng:      '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="#ff6b5b" stroke-width="2"/><path d="M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5" stroke="#ff6b5b" stroke-width="2"/></svg>',
    batch:   '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="10" height="3" fill="#f4f4ef" stroke="#0d1017"/><rect x="3" y="6.5" width="10" height="3" fill="#f4f4ef" stroke="#0d1017"/><rect x="3" y="11" width="10" height="3" fill="#f4f4ef" stroke="#0d1017"/></svg>',
    idle:    '<svg viewBox="0 0 16 16"><path d="M3 4 H8 L3 9 H8 M9 8 H13 L9 12 H13" stroke="#cfd6e6" stroke-width="1.5" fill="none"/></svg>',
    end:     '<svg viewBox="0 0 16 16"><rect x="3" y="1.5" width="1.6" height="13" fill="#cfd6e6"/><path d="M4.6 2 H13 L11 5 L13 8 H4.6 Z" fill="#ff6b5b"/></svg>'
  };
  RECAP_ICON.payPlain = RECAP_ICON.pay;
  function recapKindOf(b) {
    var m = (b && b.lead && b.lead.meta) || {};
    if (m.verdict === 'useful') return 'ok';
    if (m.verdict === 'not') return 'ng';
    var k = b.kind;
    /* 402 は「失敗」ではない（払えば通る）。赤い ✗ ではなく、揺れる値札で */
    if (k === 'error' && String((b.lead && b.lead.status) || '') === '402') return 'refused';
    if (k === 'receive' && m.job != null && el.canvas.dataset.stage === 'room') return 'deliver';
    if (k === 'actbatch' || k === 'planbatch') return 'batch';
    /* チェーンの送金の記録で、署名で払う方式と分からない支払いは「許可証に署名した」と言わない */
    if (k === 'pay' && m.tSource === 'chain' && AQ.scene.viaFacilitator && !AQ.scene.viaFacilitator(m)) return 'payPlain';
    return RECAP_ICON[k] ? k : null;
  }
  /** 0..upto のコマで、したことを順に（同じことが続いたら ×N）。振り返りと「きろく」で使う。 */
  function recapRuns(upto) {
    var runs = [];
    clock.beats.forEach(function (b, i) {
      if (i > upto) return;
      var k = recapKindOf(b);
      if (!k) return;
      var n = (b.count && /batch/.test(b.kind)) ? b.count : 1;
      var last = runs[runs.length - 1];
      if (last && last.k === k) { last.n += n; return; }
      runs.push({ k: k, n: n, i: i });
    });
    return runs;
  }
  function recapStepsHtml(runs) {
    var t = AQ.i18n.t, esc2 = AQ.hud.esc;
    return runs.map(function (ru, j) {
      var what = t('recap.kind.' + ru.k);
      return (j ? '<i class="recap-arrow" aria-hidden="true">›</i>' : '') +
        '<button type="button" class="recap-step" data-i="' + ru.i + '" title="' + esc2(t('recap.stepTitle', { n: j + 1, what: what })) + '" aria-label="' + esc2(what) + '">' +
        RECAP_ICON[ru.k] + (ru.n > 1 ? '<b>×' + ru.n + '</b>' : '') + '</button>';
    }).join('');
  }
  var recapKey = '', recapDismissed = '', recapArmed = false;
  function recapShouldShow() {
    if (!hasChosen || backdropOnly || !clock.beats.length) return false;
    if (AQ.live && AQ.live.running) return false;
    /* 再生して最後まで行ったときだけ出す（止めた状態でつまみを最後へ動かして、
       最後の絵をじっくり見たいときには出さない＝絵を覆わない） */
    var lastI = clock.beats.length - 1;
    if (clock.playing && clock.index === lastI) recapArmed = true;
    if (!clock.playing && clock.index !== lastI) recapArmed = false;
    if (!recapArmed) return false;
    if (clock.playing || clock.index !== lastI) return false;
    if (clock.elapsed < clock.durationOf(clock.index) - 1) return false;
    var ph = clock.phase ? clock.phase() : null;
    if (ph && ph.end > 0 && ph.end < 1) return false;   // 終了の動作の途中は待つ
    return true;
  }
  function syncRecap() {
    if (!el.recap) return;
    var show = recapShouldShow();
    var key = show ? [clock.beats.length, clock.beats[0] && clock.beats[0].index, focusActor, focusJob, AQ.i18n.lang, isIntro].join('|') : '';
    if (show && key === recapDismissed) show = false;
    if (!show) {
      if (!el.recap.hidden) el.recap.hidden = true;
      if (clock.index !== clock.beats.length - 1) recapDismissed = '';
      recapKey = '';
      return;
    }
    /* 録画中に最後まで来たら、録画を止めて保存する（振り返りは録らない） */
    if (recorder) { stopRecording(); }
    overCanvas(el.recap);
    if (key === recapKey) { if (el.recap.hidden) el.recap.hidden = false; return; }
    recapKey = key;
    var t = AQ.i18n.t, esc2 = AQ.hud.esc;
    /* したことを順に（同じことが続いたら ×N） */
    el.recapSteps.innerHTML = recapStepsHtml(recapRuns(clock.beats.length - 1));
    /* ログから数えた数字だけ */
    /* 払った額は資産ごとに足す（別のトークンの数を USDC に足さない） */
    var paidBy = {}, settled = 0, got = 0, failed = 0;
    clock.beats.forEach(function (b) {
      (b.events || []).forEach(function (e) {
        if (e.type === 'payment.sent' && e.amount) {
          var as = String(e.amount.asset || 'USDC').toUpperCase();
          paidBy[as] = (paidBy[as] || 0) + (Number(e.amount.value) || 0);
        }
        if (e.type === 'payment.settled') settled++;
        if (e.type === 'result.ok') got++;
        if (e.type === 'result.error' && String(e.status || '') !== '402') failed++;   // 402 は失敗ではない
      });
    });
    var fact = function (icon, val, titleKey) {
      return '<span class="recap-fact" title="' + esc2(t(titleKey)) + '">' + icon + '<b>' + esc2(val) + '</b></span>';
    };
    var COIN = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="#2775ca"/><circle cx="8" cy="8" r="4.2" fill="none" stroke="#e8f1ff"/><rect x="7.4" y="4.5" width="1.2" height="7" fill="#e8f1ff"/></svg>';
    el.recapFacts.innerHTML =
      Object.keys(paidBy).sort(function (a, b) { return a === 'USDC' ? -1 : b === 'USDC' ? 1 : a < b ? -1 : 1; }).map(function (as) {
        var v = paidBy[as];
        if (!(v > 0)) return '';
        return fact(as === 'USDC' ? COIN : COIN.replace('#2775ca', '#8f96a6'), (as === 'USDC' ? v.toFixed(3) : String(+v.toFixed(6))) + ' ' + as, 'recap.paid');
      }).join('') +
      (settled ? fact(RECAP_ICON.settle, '×' + settled, 'recap.settled') : '') +
      (got ? fact(RECAP_ICON.receive, '×' + got, 'recap.got') : '') +
      (failed ? fact(RECAP_ICON.error, '×' + failed, 'recap.failed') : '');
    el.recapAgain.textContent = t('recap.again');
    el.recapNext.textContent = t(isIntro ? 'recap.real' : 'recap.home');
    if (el.recapRec) {
      el.recapRec.hidden = !canRecord();
      el.recapRec.textContent = t('recap.rec');
      el.recapRec.title = t('recap.recTitle');
    }
    el.recapClose.textContent = '×';
    el.recapClose.title = t('recap.close'); el.recapClose.setAttribute('aria-label', t('recap.close'));
    el.recap.hidden = false;
  }
  function bindRecap() {
    if (!el.recap) return;
    el.recapSteps.addEventListener('click', function (ev) {
      var bt = ev.target && ev.target.closest ? ev.target.closest('.recap-step') : null;
      if (!bt) return;
      var i = Number(bt.getAttribute('data-i'));
      recapDismissed = recapKey;
      clock.pause(); clock.seek(i); userPaused = true;
      el.recap.hidden = true; frame();
    });
    el.recapClose.addEventListener('click', function () { recapDismissed = recapKey; el.recap.hidden = true; });
    el.recapAgain.addEventListener('click', function () {
      el.recap.hidden = true; recapDismissed = '';
      clock.restart(); userPaused = false; frame();
    });
    el.recapNext.addEventListener('click', function () { el.recap.hidden = true; showStart(); });
    if (el.recapRec) el.recapRec.addEventListener('click', startRecording);
  }

  /* ---- 絵の上に重ねるもの（振り返り・場面転換・録画の印）を絵にぴったり合わせる ---- */
  function overCanvas(node) {
    if (!node || !el.canvas) return;
    var c = el.canvas, r = node.style;
    var L = c.offsetLeft + 'px', T = c.offsetTop + 'px', Wd = c.offsetWidth + 'px', H = c.offsetHeight + 'px';
    if (r.left !== L) r.left = L; if (r.top !== T) r.top = T; if (r.width !== Wd) r.width = Wd; if (r.height !== H) r.height = H;
  }

  /* ---- 街 ⇔ 部屋の場面転換（2026-10-03）------------------------------------
     街（x402 の支払い）と部屋（kibble の掲示板）が別のアプリに見える、という点への対応。
     画面が切り替わるときに、真ん中から丸く開いていく転換を入れる。真ん中には
     行き先の記号（部屋＝掲示板の扉／街＝通り）。文字は出さない。 */
  var lastStageName = null;
  var WIPE_ICON = {
    room: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="13" fill="#4a5468" stroke="#0d1017"/><rect x="5" y="6" width="6" height="9" fill="#0d1017"/><rect x="5.5" y="6.5" width="5" height="8" fill="#ffe9a0" opacity=".8"/><rect x="3" y="3" width="10" height="2" fill="#c8964f"/></svg>',
    city: '<svg viewBox="0 0 16 16"><rect x="0" y="9" width="16" height="7" fill="#3a3f4a"/><rect x="1" y="12" width="3" height="1" fill="#f2f5fa"/><rect x="7" y="12" width="3" height="1" fill="#f2f5fa"/><rect x="13" y="12" width="3" height="1" fill="#f2f5fa"/><rect x="2" y="2" width="5" height="7" fill="#8f96a6"/><rect x="9" y="4" width="5" height="5" fill="#8f96a6"/><rect x="3" y="3" width="1.5" height="1.5" fill="#7fd4ff"/><rect x="10" y="5" width="1.5" height="1.5" fill="#7fd4ff"/></svg>'
  };
  var wipeTimer = null;
  function noteStageChange() {
    var cur = AQ.stage.current;
    var prev = lastStageName;
    lastStageName = cur;
    if (prev == null || prev === cur || !el.stageWipe || startBackdrop || backdropOnly) return;
    overCanvas(el.stageWipe);
    el.wipeIcon.innerHTML = WIPE_ICON[cur] || '';
    el.stageWipe.hidden = true;
    void el.stageWipe.offsetWidth;          // アニメーションを頭から
    el.stageWipe.hidden = false;
    el.stageWipe.dataset.to = cur;
    if (wipeTimer) clearTimeout(wipeTimer);
    wipeTimer = setTimeout(function () { el.stageWipe.hidden = true; }, 1100);
  }

  /* ---- 短いお知らせ（コピーした・保存した）---- */
  var toastTimer = null;
  function toast(msg, ms) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, ms || 2200);
  }

  /* ---- 共有（2026-10-03）---------------------------------------------------
     ・URL に ?id=0x…（ウォレット）／?id=did:key:…（エージェント）／?demo=1（入門）を
       付けて開くと、はじめの画面を飛ばしてその再生から始まる
     ・⤴ のボタンで、いま見ているものの URL をコピーする */
  var currentShareId = null;      // 入口の画面で入れて、読めた ID
  function shareUrl() {
    var base = String(location.href).split('#')[0].split('?')[0];
    if (isIntro && !currentShareId) return base + '?demo=1';
    var id = currentShareId;
    if (!id && focusActor != null && /^(did:key:|0x[0-9a-fA-F]{40}$)/.test(String(focusActor))) id = String(focusActor);
    return id ? base + '?id=' + encodeURIComponent(id) : null;
  }
  function bindShare() {
    if (!el.shareBtn) return;
    el.shareBtn.addEventListener('click', function () {
      var url = shareUrl(), t = AQ.i18n.t;
      if (!url) { toast(t('share.none'), 3200); return; }
      var done = function () { toast(t('share.copied')); };
      var manual = function () { window.prompt(t('share.manual'), url); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, manual);
        else manual();
      } catch (e) { manual(); }
    });
  }
  function relabelShare() {
    if (!el.shareBtn) return;
    el.shareBtn.textContent = '⤴';
    el.shareBtn.title = AQ.i18n.t('share.title');
    el.shareBtn.setAttribute('aria-label', el.shareBtn.title);
  }
  /** URL の ?id= / ?demo= を読んで、はじめの画面を飛ばす。 */
  function startFromUrl() {
    var q = {};
    if (typeof location === 'undefined' || !location) return false;
    String(location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) {}
    });
    if (q.demo) { hideStart(); startIntro(); return true; }
    if (q.id && el.startId) { el.startId.value = q.id; startWithId(); return true; }
    return false;
  }

  /* ---- 動画で保存（2026-10-03）---------------------------------------------
     最初から再生し直し、絵（canvas）の動きを webm に録って、最後まで行ったら保存する。
     録るのは絵だけ（見出しなどの文字は入らない）＝動きそのものを共有できる。 */
  var recorder = null, recChunks = [];
  function canRecord() {
    return !!(window.MediaRecorder && el.canvas && el.canvas.captureStream);
  }
  function startRecording() {
    if (!canRecord() || recorder) return;
    var stream;
    try { stream = el.canvas.captureStream(30); } catch (e) { return; }
    var type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].filter(function (m) {
      return MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported(m) : true;
    })[0];
    try { recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined); } catch (e) { recorder = null; return; }
    recChunks = [];
    recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
    recorder.onstop = function () {
      var blob = new Blob(recChunks, { type: 'video/webm' });
      recChunks = [];
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'agent-quest.webm';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      toast(AQ.i18n.t('rec.saved'));
    };
    recorder.start(250);
    if (el.recDot) { overCanvas(el.recDot); el.recDot.hidden = false; el.recDot.title = AQ.i18n.t('rec.on'); }
    el.recap.hidden = true; recapDismissed = '';
    clock.restart(); userPaused = false; frame();
  }
  function stopRecording() {
    if (!recorder) return;
    var r = recorder; recorder = null;
    if (el.recDot) el.recDot.hidden = true;
    try { r.stop(); } catch (e) {}
  }

  /* ---- コマンド（2026-10-04）-----------------------------------------------
     利用者「余白を生かして、ユーザーがコマンドを選べるメニューを」。右の列の空いた所に
     ドラクエの枠のようなメニューを置く。選んだ結果は、絵の下のほうに重ねた窓に出る。
       しらべる … いまの行動を、絵（記号）と1行の説明で
       さいふ   … がま口の中身（ログにある支払いだけ。予算が書かれていなければ使った額だけ）
       きろく   … ここまでにしたことを順に（押すとその場面へ）
       つぎへ   … つぎの行動へ（▶| と同じ）
       ほかのエージェント … 入口の画面へ
     ↑↓ で選び、Enter で決める（メニューにフォーカスがあるとき）。 */
  var CMD_KEYS = ['inspect', 'wallet', 'log', 'next', 'others'];
  /* ★ 2026-10-09: はじめから「しらべる」（いまの場面の説明）を出しておく（利用者
     「文字があるほうが分かりやすい。こちらを既定に」）。× で閉じると記号だけの「きろく」。 */
  var cmdOpen = 'inspect';     // いま窓に出しているコマンド（inspect/wallet/log）
  var cmdKey = '';
  function relabelCmd() {
    if (el.scrub && el.scrub.setAttribute) el.scrub.setAttribute('aria-label', AQ.i18n.t('ui.seek'));
    if (el.canvas && el.canvas.setAttribute) el.canvas.setAttribute('aria-label', AQ.i18n.t('ui.sceneLabel'));
    var t = AQ.i18n.t;
    if (!el.cmdMenu || !el.cmdMenu.querySelector) return;
    el.cmdHead.textContent = t('cmd.head');
    CMD_KEYS.forEach(function (k) {
      var b = el.cmdMenu.querySelector('[data-cmd="' + k + '"]');
      if (!b) return;
      b.textContent = t('cmd.' + k);
      b.title = t('cmd.' + k + 'T');
    });
    el.cmdWinClose.textContent = '×';
    el.cmdWinClose.title = t('cmd.close'); el.cmdWinClose.setAttribute('aria-label', t('cmd.close'));
    cmdKey = '';
  }
  function shopOf(target) {
    var tg = String(target || '');
    var m = tg.match(/^[a-z]+:\/\/([^\/?#]+)/i);
    if (m) return m[1];
    if (/^0x[0-9a-fA-F]{40}$/.test(tg)) return tg.slice(0, 6) + '…' + tg.slice(-4);
    return tg || '?';
  }
  function amtOf(b) {
    var a = b && b.lead && b.lead.amount;
    /* 金額が記録に無ければ「金額の記録なし」と書く（空欄のままだと文が欠けて読めない） */
    if (!a || a.value == null || a.value === '' || isNaN(Number(a.value))) return AQ.i18n.t('cmd.amtUnknown');
    return a.value + ' ' + (a.asset || 'USDC');
  }
  /** 送金のしかたを、ふつうの言葉に（分からない番号はそのまま出す＝作らない）。
      0x1fad948c / 0x765e827f … ERC-4337 の handleOps（スマートウォレットからの送金）
      0xa9059cbb … transfer（ふつうの送金） */
  function methodLabel(mt) {
    var t = AQ.i18n.t;
    if (!mt) return t('cmd.methodUnknown');
    var s = String(mt);
    if (/^(handleOps|0x1fad948c|0x765e827f)$/i.test(s)) return t('cmd.methodSmart');
    if (/^(transfer|0xa9059cbb)$/i.test(s)) return t('cmd.methodTransfer');
    return s;
  }
  /** いまのコマの行動の、説明の鍵と記号。 */
  function explainOf(b) {
    var room = el.canvas.dataset.stage === 'room';
    var lead = (b && b.lead) || {}, m = lead.meta || {}, k = b ? b.kind : null;
    var jobName = (m.job != null && AQ.nick && AQ.nick.forJob) ? AQ.nick.forJob(String(m.job)) : (m.job != null ? String(m.job) : '?');
    var vars = { shop: shopOf(lead.target), amt: amtOf(b), status: String(lead.status || '—'), n: b && b.count ? b.count : 1,
                 job: jobName, type: String(lead.type || k || '?'),
                 item: lead.item ? String(lead.item) : AQ.i18n.t('cmd.itemUnknown') };
    /* ★ 2026-10-11: 自分のロボットの「一日」（activity.js）。お店で物を買う場面ではないので、
       「これをください」ではなく、実際にしたこと（書き込み・取引・手紙）を言う */
    if (m.act && (k === 'travel' || k === 'receive')) {
      return { key: 'cmd.why.act.' + m.act + (k === 'travel' ? '.go' : '.done'), icon: k === 'travel' ? 'travel' : 'plan', vars: vars };
    }
    if (room) {
      if (m.verdict === 'useful') return { key: 'cmd.why.r.ok', icon: 'ok', vars: vars };
      if (m.verdict === 'not') return { key: 'cmd.why.r.ng', icon: 'ng', vars: vars };
      if (k === 'plan') return { key: 'cmd.why.r.plan', icon: 'plan', vars: vars };
      /* ★ 2026-10-11: 依頼の番号が無い行（lobby のあいさつ・雑談）は、ただの書き込み。
         「依頼を取った」と言っていたのは誤り（作り話になる）。 */
      if (m.job == null && k === 'travel') return { key: 'cmd.why.r.sayGo', icon: 'travel', vars: vars };
      if (m.job == null && k === 'receive') return { key: 'cmd.why.r.say', icon: 'plan', vars: vars };
      if (k === 'travel') return { key: 'cmd.why.r.claim', icon: 'travel', vars: vars };
      if (k === 'receive') return { key: 'cmd.why.r.deliver', icon: 'deliver', vars: vars };
      if (/batch/.test(k)) {
        /* ★ 2026-10-11: 1件の発言はイベント2つ（見に行く・書いた）になるので、イベント数ではなく
           発言の番号（seq）の種類で数える（2回のあいさつが「4件」と出ていた） */
        var seen = {}, nw = 0;
        ((b && b.events) || []).forEach(function (e) { var q = e && e.meta && e.meta.seq; var key = q != null ? 's' + q : 'e' + (nw + 1000); if (!seen[key]) { seen[key] = 1; nw++; } });
        if (nw) vars.n = nw;
        return { key: 'cmd.why.r.batch', icon: 'batch', vars: vars };
      }
    }
    /* ★ 2026-10-11: 自分で作ったエージェント（ERC-8004 に登録した）の誕生の場面 */
    if (m.born && (k === 'start' || k === 'end')) {
      vars.id = m.agentId;
      return { key: k === 'start' ? 'cmd.why.born' : 'cmd.why.bornRest', icon: k, vars: vars };
    }
    if (k === 'error' && String(lead.status || '') === '402') return { key: 'cmd.why.refused', icon: 'refused', vars: vars };
    /* ★ 2026-10-08: チェーンの送金の記録で、送金のしかたが「署名で払う（x402 と同じ）」と
       分からないときは、立会人の話をしない（絵にも立会人の窓を出していない）。
       記録にある送金のしかたの名前をそのまま見せる。 */
    if ((k === 'pay' || k === 'settle') && m.tSource === 'chain' && AQ.scene.viaFacilitator && !AQ.scene.viaFacilitator(m)) {
      vars.method = methodLabel(m.method);
      /* 送り方が記録に無いときは「立会人を通さなかった」とも言えない */
      if (k === 'settle' && !m.method) return { key: 'cmd.why.settleUnknown', icon: k, vars: vars };
      return { key: 'cmd.why.' + k + 'Plain', icon: k, vars: vars };
    }
    /* 支払いを含まない束は「支払いをまとめた」と言わない */
    if (k === 'actbatch' || k === 'planbatch') return { key: 'cmd.why.' + k, icon: 'batch', vars: vars };
    if (['start', 'plan', 'travel', 'require', 'error', 'pay', 'settle', 'receive', 'batch', 'idle', 'end'].indexOf(k) >= 0)
      return { key: 'cmd.why.' + k, icon: RECAP_ICON[k] ? k : 'plan', vars: vars };
    return { key: 'cmd.why.other', icon: 'plan', vars: vars };
  }
  function renderCmd(force) {
    if (!el.cmdWin) return;
    /* ★ 2026-10-06: 結果の窓は画面の下の欄に常にある。何も選んでいないときは「きろく」（記号だけ） */
    var idle = !cmdOpen;
    var mode = cmdOpen || 'log';
    if (el.cmdWin.classList.contains('idle') !== idle) el.cmdWin.classList.toggle('idle', idle);
    var t = AQ.i18n.t, esc2 = AQ.hud.esc;
    var b = clock.beats[clock.index];
    var walletV = (mode === 'wallet' && AQ.scene.lastPurse && AQ.scene.lastPurse()) ? AQ.scene.lastPurse().value + '/' + AQ.scene.lastPurse().pending : '';
    /* ★ 2026-10-08: 再生しているコマそのもの（本当の位置・種類・誰）と、街か部屋かも鍵に
       入れる。依頼を切り替えてもコマ数と位置が同じだと、前の依頼の説明が残っていた。 */
    var bId = b ? [b.index, b.kind, b.actor, (b.lead && b.lead.meta && b.lead.meta.job) || ''].join(':') : '';
    /* ★ 2026-10-18 利用者の報告「終わった場面でもう一度を押しても何も動かない」「“この場面”がどこまでか分からない」。
       いまの動きが全体の何番目か（動き 3 / 5）を出し、ボタンは2つに分ける：
         ↺ この動き（3/5）だけもう一度 … いまの1つの動き（始動・終了の動作のコマでは出さない）
         ⏮ はじめから全部見る         … 始動から終わりまで。最後まで見終わったら、こちらだけを大きく出す */
    var nB = clock.beats.length, atEnd = !!(b && clock.index === nB - 1 && clock.elapsed >= clock.durationOf(clock.index));
    var key = [mode, idle, hasChosen, clock.index, AQ.i18n.lang, clock.beats.length, walletV, bId,
               el.canvas.dataset.stage || '', focusJob || '', focusActor || '', atEnd].join('|');
    if (!force && key === cmdKey) return;
    cmdKey = key;
    var html = '';
    if (!hasChosen || !b) html = '<p class="cmd-line">' + esc2(t('cmd.none')) + '</p>';
    else if (mode === 'inspect') {
      var ex = explainOf(b);
      /* ウォレット（チェーンの送金の記録）の支払い：受け取った物は記録に無い、と必ず添える */
      var chainSrc = b.lead && b.lead.meta && b.lead.meta.tSource === 'chain' && !b.lead.meta.goodsSeen && (b.kind === 'pay' || b.kind === 'settle');  /* goodsSeen: お使い（errand.js）では受け取った物を実際に見ている */
      html = '<p class="cmd-step">' + esc2(t('cmd.step', { i: clock.index + 1, n: nB })) + '</p>' +
             '<div class="cmd-inspect"><span class="cmd-icon">' + (RECAP_ICON[ex.icon] || '') + '</span>' +
             '<p class="cmd-line">' + esc2(t(ex.key, ex.vars)) + '</p></div>' +
             (chainSrc ? '<p class="cmd-note">' + esc2(t('cmd.chainNote')) + '</p>' : '') +
             replayActs(b, atEnd, nB);
    } else if (mode === 'wallet') {
      var rows = [];
      for (var i = 0; i <= clock.index && i < clock.beats.length; i++) {
        (clock.beats[i].events || []).forEach(function (e) {
          if (e.type === 'payment.sent' && e.amount) rows.push({ amt: e.amount.value + ' ' + (e.amount.asset || 'USDC'), shop: shopOf(e.target), i: i });
        });
      }
      var stNow = st || {};
      /* 街では、絵の財布に出ている数字と同じにする（がま口を閉じるまでは前の額） */
      var shown = (el.canvas.dataset.stage !== 'room' && AQ.scene.lastPurse) ? AQ.scene.lastPurse() : null;
      var head = stNow.hasBudget
        ? '<b>' + esc2(t('cmd.balance')) + '</b> ' + esc2(Number(shown ? shown.value : stNow.usdc).toFixed(3)) + ' USDC'
        : '<b>' + esc2(t('cmd.spent')) + '</b> ' + esc2(Math.abs(Number(shown ? shown.value : (stNow.spent || 0))).toFixed(3)) + ' USDC';
      if (shown && shown.pending > 0) head += '<br><b>' + esc2(t('cmd.pending')) + '</b> -' + esc2(Number(shown.pending).toFixed(3)) + ' USDC';
      html = '<div class="cmd-wallet"><span class="cmd-icon">' + WALLET_ICON + '</span><p class="cmd-line">' + head + '</p></div>' +
             (stNow.hasBudget ? '' : '<p class="cmd-note">' + esc2(t('cmd.walletUnknown')) + '</p>') +
             (rows.length ? '<ul class="cmd-rows">' + rows.slice(-6).map(function (r) {
               return '<li><button type="button" class="cmd-row" data-i="' + r.i + '">' + COIN_SVG + ' ' + esc2(t('cmd.payTo', r)) + '</button></li>';
             }).join('') + '</ul>' : '<p class="cmd-note">' + esc2(t('cmd.walletNone')) + '</p>');
      /* ★ 2026-10-08 総点検：部屋（掲示板）の記録には、お金の動きが1つも無い。
         「つかった額 0.000 USDC」と出すと、払ったのに0円だったように読めてしまう。 */
      if (el.canvas.dataset.stage === 'room') {
        html = '<div class="cmd-wallet"><span class="cmd-icon">' + WALLET_ICON + '</span><p class="cmd-line">' + esc2(t('cmd.walletRoom')) + '</p></div>';
      }
    } else if (mode === 'log') {
      var runs = recapRuns(clock.index);
      html = runs.length ? '<div class="recap-steps cmd-log">' + recapStepsHtml(runs) + '</div>' + (atEnd ? replayActs(b, atEnd, nB) : '') : '<p class="cmd-line">' + esc2(t('cmd.none')) + '</p>';
    }
    el.cmdWinBody.innerHTML = html;
    el.cmdWin.dataset.cmd = mode;
    el.cmdWin.hidden = false;
  }
  function replayActs(b, atEnd, nB) {
    var t = AQ.i18n.t, esc2 = AQ.hud.esc, out = '<div class="cmd-acts">';
    if (atEnd) out += '<p class="cmd-end">' + esc2(t('cmd.ended')) + '</p>';
    if (b && !atEnd && b.kind !== 'start' && b.kind !== 'end' && nB > 1)
      out += '<button type="button" class="ghost" data-act="replay">' + esc2(t('cmd.replayStep', { i: clock.index + 1, n: nB })) + '</button>';
    out += '<button type="button" class="' + (atEnd ? 'go cmd-restart' : 'ghost') + '" data-act="restart">' + esc2(t('cmd.restart')) + '</button>';
    return out + '</div>';
  }
  var WALLET_ICON = '<svg viewBox="0 0 16 16"><path d="M3 6 Q1.5 14 5 15 H11 Q14.5 14 13 6 Z" fill="#2775ca" stroke="#0d1017"/><path d="M3 6 Q4 3 8 3.5 Q12 3 13 6" fill="none" stroke="#e0b84a" stroke-width="1.6"/><circle cx="7" cy="3.4" r="1.2" fill="#ffd35c"/><circle cx="9" cy="3.4" r="1.2" fill="#ffd35c"/><circle cx="8" cy="10" r="2.6" fill="none" stroke="#e8f1ff"/></svg>';
  var COIN_SVG = '<svg class="ic" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="#2775ca"/><circle cx="8" cy="8" r="4.2" fill="none" stroke="#e8f1ff"/><rect x="7.4" y="4.5" width="1.2" height="7" fill="#e8f1ff"/></svg>';
  function runCmd(k) {
    if (k === 'next') { if (el.step) el.step.click(); else { clock.step(); frame(); } if (cmdOpen) renderCmd(true); return; }
    if (k === 'others') { closeCmd(); showStart(); return; }
    if (cmdOpen === k) { closeCmd(); return; }
    cmdOpen = k;
    markCmd();
    renderCmd(true);
  }
  function closeCmd() { cmdOpen = null; cmdKey = ''; markCmd(); renderCmd(true); }
  function markCmd() {
    if (!el.cmdMenu || !el.cmdMenu.querySelectorAll) return;
    Array.prototype.forEach.call(el.cmdMenu.querySelectorAll('.cmd-item'), function (b) {
      var on = b.getAttribute('data-cmd') === cmdOpen;
      if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function bindCmd() {
    if (!el.cmdMenu || !el.cmdMenu.addEventListener || !el.cmdWinClose || !el.cmdWinBody) return;
    markCmd();   // はじめから「しらべる」に ▶ を付ける
    el.cmdMenu.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('.cmd-item') : null;
      if (b) runCmd(b.getAttribute('data-cmd'));
    });
    el.cmdMenu.addEventListener('keydown', function (ev) {
      var items = Array.prototype.slice.call(el.cmdMenu.querySelectorAll('.cmd-item'));
      var i = items.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault(); ev.stopPropagation();
        var j = (i < 0 ? 0 : (i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
        items[j].focus();
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === ' ') ev.stopPropagation();
    });
    el.cmdWinClose.addEventListener('click', closeCmd);
    el.cmdWinBody.addEventListener('click', function (ev) {
      var tgt = ev.target && ev.target.closest ? ev.target.closest('[data-act],[data-i]') : null;
      if (!tgt) return;
      if (tgt.getAttribute('data-act') === 'replay') {
        /* いまの動き（1コマ）を頭から（始動・終了の動作は入れない） */
        var i0 = clock.index;
        clock.pause(); clock.seek(i0); userPaused = false; clock.play(); frame();
        return;
      }
      if (tgt.getAttribute('data-act') === 'restart') {
        /* はじめから全部（始動の動作から） */
        clock.pause(); clock.seek(0); userPaused = false; clock.play(); frame(); renderCmd(true);
        return;
      }
      var i = Number(tgt.getAttribute('data-i'));
      if (!isNaN(i)) { clock.pause(); clock.seek(i); userPaused = true; frame(); renderCmd(true); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && cmdOpen) closeCmd();
    });
  }

  /* ---- はじめの画面（2026-10-02）-------------------------------------------
     利用者の提案「スタートがいきなり x402 の作り話の途中から始まる。エージェントを
     識別する番号などを入れるところから始まるのが良いのでは」。
     入口は3つ：
       ① ID を入れる … 0x…（42文字）なら Base の送金の記録を読み、そのウォレットを
                        追う。did:key:… なら kibble に LIVE でつなぎ、届いたログの中に
                        その ID がいれば、そのエージェントを選んだ状態で始める
       ② いま動いているエージェントから選ぶ … kibble に LIVE でつなぐだけ
       ③ はじめての人 … x402 の入門（作り話のデモ）
     ID を持っていない人がそこで止まらないよう、②③を同じ画面に並べる。 */
  var startBackdrop = false;     // 後ろの絵を読んでいる間は、はじめの画面を閉じない
  var backdropOnly = false;      // まだ後ろの絵（家具だけの街）しか読んでいない
  var pendingAgent = null;       // did:key を入れて LIVE につないだ直後に選ぶエージェント

  function relabelStart() {
    if (!el.startScreen) return;
    var t = AQ.i18n.t;
    el.startTitle.textContent = t('start.title');
    el.startIdLbl.textContent = t('start.idLbl');
    el.startId.placeholder = t('start.idPh');
    el.startGo.textContent = t('start.go');
    el.startIdSub.textContent = t('start.idSub');
    el.startLiveT.textContent = t('start.liveT');
    el.startLiveS.textContent = t('start.liveS');
    el.startDemoT.textContent = t('start.demoT');
    el.startDemoS.textContent = t('start.demoS');
    if (el.homeBtn) {
      el.homeBtn.textContent = '⌂';
      el.homeBtn.title = t('start.home');
      el.homeBtn.setAttribute('aria-label', t('start.home'));
    }
  }
  function startError(key, vars) {
    if (!el.startErr) return;
    el.startErr.textContent = key ? AQ.i18n.t(key, vars || {}) : '';
    el.startErr.hidden = !key;
    el.startErr.classList.toggle('busy', key === 'start.loading');
  }
  function showStart() {
    if (!el.startScreen) return;
    if (clock && clock.playing) { clock.pause(); userPaused = true; frame(); }
    startError(null);
    el.startScreen.hidden = false;
    /* 2026-10-18: クエストが主役。最初のフォーカスは「クエストを始める／続きから」のボタン（画面を下へ動かさない） */
    if (AQ.quest && AQ.quest.renderStart) AQ.quest.renderStart();
    setTimeout(function () {
      var go = document.getElementById('startQuestGo') || el.startId;
      try { go.focus({ preventScroll: true }); } catch (e) { try { go.focus(); } catch (e2) { /* 無視 */ } }
      var card = el.startScreen.querySelector('.start-card'); if (card) card.scrollTop = 0;
    }, 0);
  }
  function hideStart() {
    if (el.startScreen && !el.startScreen.hidden) el.startScreen.hidden = true;
  }

  /** LIVE を kibble につなぐ（つないでいなければ）。 */
  function connectKibble() {
    if (AQ.live.running && AQ.live.room === 'kibble') return false;
    el.room.value = 'kibble';
    if (AQ.live.running) el.connect.click();     // 別の部屋から切り替える
    el.connect.click();
    return true;
  }

  function startWithId() {
    var id = String(el.startId.value || '').trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(id)) {
      startError('start.loading');
      el.startGo.disabled = true;
      AQ.adapters.chainFetch(id, AQ.defaultChain).then(function (res) {
        if (AQ.live.running) el.connect.click();   // LIVE の新着を混ぜない
        loadEvents(res.events);
        el.liveStat.textContent = res.how;
        var first = fullBeats.length ? fullBeats[0].actor : null;
        if (first != null) applyFocus(String(first));
        currentShareId = id;
      }, function (err) {
        var msg = (err && err.message) || String(err);
        var sk = (AQ.adapters.fromChain && AQ.adapters.fromChain.skipped) || 0;
        if (err && err.code === 'notFound' && sk) startError('start.noUsdc', { n: sk });
        else if (err && err.code === 'notFound') startError('start.noTransfers');
        else startError('start.netFail', { msg: /HTTP \d+/.test(msg) ? msg.match(/HTTP \d+/)[0] : 'CORS / network' });
      }).then(function () { el.startGo.disabled = false; });
      return;
    }
    if (/^did:key:z[1-9A-HJ-NP-Za-km-z]{8,}$/.test(id)) {
      /* 届くまで「読み込んでいます…」を出したまま待つ（届いたら閉じて、その子を選ぶ） */
      pendingAgent = id;
      startError('start.loading');
      if (!connectKibble()) {          // もうつながっている＝今あるログから選ぶ
        focusPendingAgent();
      }
      return;
    }
    startError('start.badId');
  }

  /* ★ 2026-10-11: 自分のロボットが書き込んだ部屋を開いて、その仕事（または本人）を選ぶ。
     部屋のログを読み直して出す＝書いたはずの行を足したりはしない。 */
  var pendingWatch = null;
  function watchRoom(room, opts) {
    pendingWatch = opts || {};
    hideStart();
    if (AQ.live.running && AQ.live.room === room) { applyPendingWatch(); return; }
    el.room.value = room;
    if (AQ.live.running) el.connect.click();
    el.connect.click();
  }
  /* ★ 2026-10-11（利用者「ほかのエージェントもいて分かりにくい。作ったエージェントのみに」）:
     部屋全体（lobby は1秒に何百行も流れる）ではなく、自分のロボットの書き込みと、
     ロボットが出した仕事への返事だけを読み込んで見せる。行はどれもサーバーが返した実物。 */
  function showMine(events, opts) {
    stopLiveQuiet();
    hideStart();
    loadEvents(events);
    pendingWatch = opts || {};
    applyPendingWatch();
  }
  function applyPendingWatch() {
    var w = pendingWatch; pendingWatch = null;
    if (!w) return;
    if (w.job && jobIndex.byId && jobIndex.byId[w.job]) { setListMode('jobs'); handleJobClick(w.job); return; }
    if (w.agent && agentIndex && agentIndex.byId && agentIndex.byId[w.agent]) { setListMode('agents'); handleAgentClick(w.agent); return; }
    /* 依頼の無いログ（lobby のあいさつなど）は依頼の索引に載らないので、コマの主役から探す */
    if (w.agent && fullBeats.some(function (b) { return String(b.actor) === w.agent; })) {
      setListMode('agents'); handleAgentClick(w.agent);
      if (!clock.playing && clock.play) clock.play();
      return;
    }
    el.liveStat.textContent = AQ.i18n.t('robot.notInLog');
  }

  /** did:key を入れて LIVE につないだあと、届いたログにその子がいれば選ぶ。 */
  function focusPendingAgent() {
    var who = pendingAgent;
    pendingAgent = null;
    if (!who) return;
    if (agentIndex && agentIndex.byId && agentIndex.byId[who]) { hideStart(); handleAgentClick(who); currentShareId = who; return; }
    /* いなければ、はじめの画面のままそう伝える（作り話のエージェントを足したりしない）。
       LIVE はつないだままなので、閉じれば一覧から選べる。 */
    startError('start.didNotFound');
  }

  function bindStart() {
    if (!el.startScreen) return;
    el.startGo.addEventListener('click', startWithId);
    el.startId.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') startWithId();
      else if (el.startErr && !el.startErr.hidden && !el.startErr.classList.contains('busy')) startError(null);
    });
    el.startLive.addEventListener('click', function () {
      hideStart();
      if (!connectKibble()) { listMode = 'agents'; releaseToChoose(); }
    });
    el.startDemo.addEventListener('click', function () { hideStart(); startIntro(); });
    if (el.homeBtn) el.homeBtn.addEventListener('click', showStart);
    document.addEventListener('keydown', function (ev) {
      /* まだ何も選んでいない（後ろは家具だけの街）ときに閉じても、選ぶものが
         何も無い画面になるだけなので、Esc では閉じない。 */
      if (ev.key === 'Escape' && !el.startScreen.hidden && !backdropOnly) hideStart();
    });
  }

  /* ---- データを差し替える（ここが唯一の入口） ---- */
  var allEvents = [];

  /** focus（task E）は「再生対象のコマ列」を絞るだけのフィルタ。
      レンダラ（scene.js / room.js）にはいつも fullBeats（ログ全体）と
      本当のコマ番号（b.index）を渡す＝街の絵・部屋の板/台/他ロボットの
      最終位置は focus の有無に関わらず本物のまま（README の「レンダラは
      リプレイ専用」という契約を、focus 機能のためだけには壊さない）。 */
  function computePlayBeats() {
    /* エージェントから入ったときは、代表の依頼1件（下の focusJob）を再生する。
       代表の依頼が1件も無い子（依頼に関わっていない）だけ、以前の
       「まとめ」の場面に戻す。 */
    if (focusJob == null && agentFilter != null && agentStory && agentStory.beats.length) return agentStory.beats;
    if (focusJob != null) {
      /* ★ 2026-09-09: 同じ依頼を何体ものエージェントが引き受け・納品する
         （kibble では普通に起きる。利用者の画面では1件に6体が並んでいた）。
         全部そのまま並べると、同じ動きをするロボットが何体も出てきて
         「誰が何をしたのか」が読めない。そこで再生するのは①〜④それぞれの
         代表1コマだけにする。
         ★ 間引くのは画面だけで、記録は1件も捨てない（「詳細」にその依頼の
         全イベントが出る）。このアプリの「間引くのは描画だけ、データは
         全件保持」の原則どおり。 */
      return (jobStory && jobStory.beats.length)
        ? jobStory.beats
        : fullBeats.filter(function (b) { return beatTouchesJob(b, focusJob); });
    }
    if (focusActor == null) return fullBeats;
    return fullBeats.filter(function (b) { return String(b.actor) === focusActor; });
  }

  /** そのコマが、この依頼のイベントを1件でも含むか。 */
  function beatTouchesJob(b, jobId) {
    var evs = (b && b.events) || [];
    for (var i = 0; i < evs.length; i++) {
      var m = evs[i] && evs[i].meta;
      if (m && m.job != null && String(m.job) === String(jobId)) return true;
    }
    return false;
  }

  /** いま選んでいる依頼で「画面に出す」面々（actor 名 → true）。
      ★ その依頼に関わった全員ではなく、①〜④の代表として実際に再生する
      コマに出てくる子だけ。ここを全員にすると、絵の上では同じ動きの
      ロボットが何体も並ぶ（＝直したかった症状そのもの）。 */
  function focusCastMap() {
    if (!jobStory) return null;
    var map = {};
    /* 主役が決まっているとき（エージェントから入ったとき）は、その子だけ。
       ほかの段階の子は「①〜④の行」に名前で出るが、絵には出さない
       ＝選んだ子以外が動いて見える、という報告への対応。 */
    if (jobStory.starring) { map[jobStory.starring] = true; return map; }
    [1, 2, 3, 4].forEach(function (n) {
      if (jobStory.reps[n]) map[jobStory.reps[n]] = true;
    });
    return map;
  }

  /* ---- 依頼1件の「見せる筋書き」（2026-09-09）--------------------------
     ①出された・②引き受けた・③納品・④判定 のそれぞれについて、
     代表イベント（jobs.js が拾う「その段階の最初の1件」）が入っている
     コマを1つずつ選ぶ。同じコマが2段階を兼ねていれば1回だけ入れる。
     others には「その段階を他に何体がやっているか」を正確な数で持つ
     （画面には出さない子の数を黙って消さない＝ここが嘘になったら、
     この間引きは単なる情報の隠蔽になる）。 */
  var jobStory = null;

  /* 依頼の索引 → エージェントの索引。「その子が関わった依頼」を
     jobs.js の cast（＝ログに実際にある行）から作る＝関わっていない
     依頼を勝手に結び付けない。並びは関わった依頼が多い順→新しい順。 */
  function buildAgentIndex(idx) {
    var byId = {}, list = [];
    (idx.list || []).forEach(function (rec) {
      AQ.jobs.castOf(rec).forEach(function (a) {
        var key = String(a);
        var e = byId[key];
        if (!e) { e = byId[key] = { actor: key, jobs: [], lastT: 0 }; list.push(e); }
        e.jobs.push(rec);
        if (rec.lastT > e.lastT) e.lastT = rec.lastT;
      });
    });
    list.sort(function (x, y) {
      if (y.jobs.length !== x.jobs.length) return y.jobs.length - x.jobs.length;
      if (y.lastT !== x.lastT) return y.lastT - x.lastT;
      return x.actor < y.actor ? -1 : 1;
    });
    return { list: list, byId: byId };
  }

  /** そのエージェントの「代表の依頼」。分かっている段階がいちばん多い
      もの（同点なら新しいもの）＝いちばん最後まで見届けられる1件。 */
  function representativeJobOf(actor) {
    var e = agentIndex.byId[String(actor)];
    if (!e || !e.jobs.length) return null;
    var star = String(actor);
    /* 本人の書き込みが実際にコマとして残っている依頼だけを候補にする
       （残っていない依頼を選ぶと、再生するコマが0件になる）。 */
    var cand = e.jobs.filter(function (rec) {
      var st = buildJobStory(rec, star);
      return st && st.beats.length;
    });
    if (!cand.length) cand = e.jobs;
    var best = cand[0];
    cand.forEach(function (rec) {
      if (rec.known > best.known || (rec.known === best.known && rec.lastT > best.lastT)) best = rec;
    });
    return best.id;
  }

  /* ---- エージェントの「まとめ」（2026-09-13）--------------------------
     提案（利用者）:「①〜④の四つの動作はすべて行うのだから、それを
     何件ずつやったか、という表示にしたほうが分かりやすいのでは？」
     そのとおりにする。エージェントから入ったときは、
       ・①〜④それぞれを何件やったかを正確な数で出す（間引きゼロ）
       ・各段階につき「その中の1件」を例として実際に再生する
     ＝時系列の再生ではなく「その子の仕事ぶりのまとめ」。まとめであることは
     画面に必ず書く（リプレイだと思って読まれると嘘になるため）。
     以前の「代表の依頼1件だけを再生」は、なぜその1件なのかに必然性が
     無く、残りの依頼が画面から消えていた。 */
  function stepOfEvent(e) {
    var m = (e && e.meta) || {};
    if (!e || !m.job) return 0;
    if (e.type === 'agent.plan')  return 1;
    if (e.type === 'tool.call')   return 2;
    if (e.type === 'result.ok')   return m.verdict === 'useful' ? 4 : 3;
    if (e.type === 'result.error') return m.verdict === 'not' ? 4 : 0;
    return 0;
  }

  function buildAgentStory(star) {
    if (star == null) return null;
    var who2 = String(star);
    var counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    var jobsOf = { 1: [], 2: [], 3: [], 4: [] };
    var seen = { 1: {}, 2: {}, 3: {}, 4: {} };
    var lastEv = {}, mine = [];
    allEvents.forEach(function (e) {
      if (String(e.actor) !== who2) return;
      var n = stepOfEvent(e);
      if (!n) return;
      counts[n]++;
      if (!seen[n][e.meta.job]) { seen[n][e.meta.job] = true; jobsOf[n].push(e.meta.job); }
      lastEv[n] = e;              // allEvents は時刻順なので、最後が最新
      mine.push(e);               // 「詳細」に出す全記録
    });

    /* 例として再生する1件を段階ごとに選ぶ（いちばん新しいもの）。
       段階の順（①②③④）に並べる＝画面の並びと再生の順が一致する。 */
    var beats = [], sceneStep = {}, leadFor = {}, sceneJob = {};
    [1, 2, 3, 4].forEach(function (n) {
      var e = lastEv[n];
      if (!e) return;
      for (var i = 0; i < fullBeats.length; i++) {
        var evs = fullBeats[i].events || [];
        if (evs.indexOf(e) === -1) continue;
        var b = fullBeats[i];
        if (sceneStep[b.index] == null) {
          beats.push(b); sceneStep[b.index] = n; leadFor[b.index] = e; sceneJob[b.index] = e.meta.job;
        }
        break;
      }
    });

    var jobCount = {};
    [1, 2, 3, 4].forEach(function (n) { jobCount[n] = jobsOf[n].length; });
    return {
      starring: who2, counts: counts, jobCount: jobCount, jobsOf: jobsOf, events: mine,
      beats: beats, sceneStep: sceneStep, leadFor: leadFor, sceneJob: sceneJob,
      total: counts[1] + counts[2] + counts[3] + counts[4]
    };
  }

  /* ★ 2026-09-28: 依頼ID → その依頼に触れるコマ（ログの順）。
     buildJobStory は以前、依頼1件ごとにログ全体のコマをなめていた。
     エージェントを選ぶと、その子の依頼（数百件）それぞれについてこれを
     呼ぶので、選んだ直後に画面が固まり、その間の遅れを取り返そうとして
     ロボットが暴走気味に動いていた。コマ列が変わったときに1回だけ作る。 */
  var beatsByJobCache = { beats: null, n: -1, map: null };
  function beatsOfJob(jobId) {
    if (beatsByJobCache.beats !== fullBeats || beatsByJobCache.n !== fullBeats.length) {
      var map = {};
      fullBeats.forEach(function (b) {
        var evs = b.events || [], seen = null;
        for (var i = 0; i < evs.length; i++) {
          var m = evs[i] && evs[i].meta;
          if (!m || m.job == null) continue;
          var k = String(m.job);
          if (seen && seen[k]) continue;
          (seen || (seen = {}))[k] = true;
          (map[k] || (map[k] = [])).push(b);
        }
      });
      beatsByJobCache = { beats: fullBeats, n: fullBeats.length, map: map };
    }
    return beatsByJobCache.map[String(jobId)] || [];
  }

  function buildJobStory(rec, starring) {
    if (!rec) return null;
    var want = [];
    for (var n = 1; n <= 4; n++) if (rec.steps && rec.steps[n]) want.push({ n: n, e: rec.steps[n] });

    var beats = [], picked = {}, reps = {};
    /* want の行はどれもこの依頼の行＝この依頼に触れるコマだけを見れば足りる
       （順番もログの順のまま）。 */
    var touching = beatsOfJob(rec.id);
    touching.forEach(function (b) {
      var evs = b.events || [];
      for (var i = 0; i < evs.length; i++) {
        for (var k = 0; k < want.length; k++) {
          if (evs[i] !== want[k].e) continue;
          if (!picked[b.index]) { picked[b.index] = true; beats.push(b); }
          /* 代表は「そのコマの見出しになる本人」＝ lead の actor。
             まとめたコマでは実況の見出し・盤面のロボットが lead で決まるので、
             ここを別人（その段階の最初の1件を書いた子）にすると、
             面々の行と画面のロボットが食い違う。全員がその段階をやって
             いるのは事実なので、どちらを代表にしても嘘にはならない＝
             画面と一致するほうを選ぶ。 */
          if (reps[want[k].n] == null) {
            var la = (b.lead && b.lead.actor != null) ? b.lead.actor : evs[i].actor;
            if (la != null) reps[want[k].n] = String(la);
          }
        }
      }
    });

    var lists = {
      1: rec.cast.poster ? [rec.cast.poster] : [],
      2: rec.cast.claimers || [],
      3: rec.cast.deliverers || [],
      4: rec.cast.judges || []
    };
    var others = {};
    for (var n2 = 1; n2 <= 4; n2++) others[n2] = Math.max(0, lists[n2].length - 1);

    var all = touching.filter(function (b) { return beatTouchesJob(b, rec.id); });
    var play = beats.length ? beats : all;

    /* ★ 2026-09-12(2): エージェントを選んで入ったときは、その子がやった
       段階だけを再生する。
       報告:「タヌキを選んだのに違う名前のエージェントが動いている／
       複数のエージェントが入り乱れて動く」。
       依頼1件の①〜④はふつう別々の子が分担するので、依頼まるごとを
       再生すると、選んだ子が出てこないコマまで順に動く＝「選んだ意味が
       無い」状態だった。エージェントから入ったときの主役はその子なので、
       その子が actor のコマだけに絞る。
       ★ ①〜④の行には引き続き全段階を出す（誰がやったかは事実であって、
       隠す理由が無い）。動かさないだけ。全記録は「詳細」にある。 */
    var ownSteps = [], leadFor = {};
    if (starring != null) {
      var star = String(starring);
      /* ★ 2026-09-12(4): 本人のコマだけを拾う。
         以前は「本人が見出しになっているコマ」が1つも無いと依頼まるごとに
         フォールバックしていたため、まとめられたコマ（見出しが別人）の
         依頼では、選んだ子と関係ないエージェントが動き出していた
         （報告「エージェントがいきなり入れ替わる」）。
         見出しが誰であっても、そのコマの中に本人の書き込みがあれば
         本人のコマとして扱い、1つも無ければ何も再生しない
         （他人のコマで埋めない）。 */
      var mine = all.filter(function (b) {
        var evs = b.events || [];
        for (var i = 0; i < evs.length; i++) {
          var e = evs[i];
          if (e && e.meta && e.meta.job === rec.id && String(e.actor) === star) {
            /* 実況の主語・動詞は、そのコマの見出し（別人のことがある）ではなく
               本人が書いた行から作る＝画面の名前と動きが必ず本人になる。 */
            if (!leadFor[b.index]) leadFor[b.index] = e;
            return true;
          }
        }
        return false;
      });
      play = mine;
      var roleOf = {
        1: rec.cast.poster ? [rec.cast.poster] : [],
        2: rec.cast.claimers || [], 3: rec.cast.deliverers || [], 4: rec.cast.judges || []
      };
      [1, 2, 3, 4].forEach(function (n3) {
        if (roleOf[n3].indexOf(String(starring)) !== -1) ownSteps.push(n3);
      });
    }

    return {
      id: rec.id,
      beats: play,
      reps: reps,
      others: others,
      starring: (starring == null) ? null : String(starring),
      ownSteps: ownSteps,
      leadFor: leadFor,
      hiddenActors: others[1] + others[2] + others[3] + others[4],
      totalBeats: all.length,
      totalEvents: (rec.events || []).length
    };
  }

  /** レンダラに渡す絞り込みの説明書き。null＝絞っていない。
      ★ まとめの4場面はそれぞれ別の依頼なので、いま描くコマに合わせて
      「どの依頼の札を出すか」を切り替える（beat を渡してもらう）。 */
  function renderFocus(beat) {
    if (focusJob == null && agentFilter != null && agentStory) {
      var jid = (beat && agentStory.sceneJob[beat.index]) || null;
      var m = {}; m[agentStory.starring] = true;
      /* ★ 2026-09-13: まとめの画面では、その段階の「本当の件数」に応じて
         ロボットが何度も往復する（1件でも232件でも同じ絵だった、という
         指摘への対応）。往復の回数を決めるのはここ＝件数は必ず実数から
         取る。回数の刻み方は room.js の tripsForCount に書いてある。 */
      var stepN = (beat && agentStory.sceneStep[beat.index]) || 0;
      var cnt = stepN ? (agentStory.counts[stepN] || 0) : 0;
      return { job: jid, actors: m,
               trips: (AQ.room && AQ.room.tripsForCount) ? AQ.room.tripsForCount(cnt) : 1 };
    }
    if (focusJob != null) return { job: focusJob, actors: focusCastMap() || {} };
    if (focusActor != null) return { actor: focusActor };
    return null;
  }

  /* ヒントは1行だけ（task 3: 旧・凡例＋2本のヒントを1本に集約）。
     部屋（board/dropoff/inspect の比喩）を描いているときはその読み方を、
     街を描いているときは基本操作を出す＝つねに「いま関係あるほう」
     だけを見せて、無関係な説明で画面を埋めない。 */
  /* ★ 2026-09-14: 画面右の列（名簿＋読み方）が絵より背高になって、
     画面からはみ出していた（1920×1080・依頼40件で実測 179px。文字を
     大きくする前から 78px はみ出していた＝元からの不具合）。
     以前は名簿に min(46vh,460px) という決め打ちの上限を置いていたが、
     同じ列に「読み方」の箱が増えた時点でその決め打ちは合わなくなった。
     絵の高さは CSS の min(1400px, 100%, N vh) から決まり、どの項が
     効くかは画面の縦横で変わる——CSS だけでは「絵と同じ高さ」を
     書けないので、実測した高さをそのまま蓋にする。
     名簿は余ったぶんだけを使い、足りなければ中だけでスクロールする。 */
  function syncSideColHeight() {
    if (!el.sideCol || !el.canvas) return;
    /* 横に並ぶのは 1200px 以上のときだけ（css の @media と同じ境目）。
       それより狭い画面では縦に流れるので、蓋をしてはいけない。 */
    var wide = window.matchMedia && window.matchMedia('(min-width: 1200px)').matches;
    var h = el.canvas.clientHeight;
    var mh = (wide && h > 0) ? (h + 'px') : '';
    if (el.sideCol.style.maxHeight !== mh) el.sideCol.style.maxHeight = mh;
  }
  /* ★ 2026-09-28: 以前は毎フレーム（1秒に60回）絵の高さを測っていた。
     測るたびにブラウザはレイアウトを確定させる必要があり、同じフレームで
     DOM を書き換えていると、そのたびにレイアウトをやり直していた
     （動きがかくかくする原因のひとつ）。絵の大きさが変わったときだけ測る。 */
  var sideColObserved = false;
  function syncSideColHeightIfNeeded() {
    if (sideColObserved) return;
    if (window.ResizeObserver && el.canvas) {
      sideColObserved = true;
      new ResizeObserver(function () { syncSideColHeight(); }).observe(el.canvas);
      syncSideColHeight();
      return;
    }
    syncSideColHeight();
  }

  function updateHintLine() {
    if (!el.hint) return;
    /* 入門は手で書いた作り話なので、そうと必ず書く（本物のログだと
       思われたら、このアプリがいちばん大事にしている約束が崩れる）。 */
    /* ★ 2026-09-27: 部屋のときに出していた長い「この画面の見かた」
       （ui.legend）は外した。掲示板・納品口・検品台という名前は絵の中に
       描いてあるし、札が貼られて運ばれて置かれる流れは動きそのものが
       見せている＝文章は同じことを二度言っているだけだった。
       残すのは、見ただけでは分からない操作の1行だけ。
       （ui.legend は辞書に残してある。戻すならここを1行変えるだけ。） */
    /* ★ 2026-09-28: 操作の説明文（クリックで一時停止・←→でコマ送り）は
       出さない。ボタンは記号になり、言葉はマウスを乗せれば出る。
       入門のときの「これは手で書いた作り話です」だけは必ず残す
       （本物のログだと思わせたら嘘になる）。 */
    el.hint.textContent = isIntro ? AQ.i18n.t('x402.introFake') : '';
    el.hint.hidden = !isIntro;
    syncModeTag();
  }

  /* ★ 2026-11-05（ウォレットなしで試した人「デモの再生と LIVE が見分けにくい」）:
     いま見ているものが ①作り話のデモ ②LIVE（本物の掲示板）③読みこんだ記録 のどれかを、
     絵の左上の角の札で出す（#modeTag。HUD の並びには場所を取らない）。LIVE につながっている間はいつも LIVE。 */
  var dataSrc = 'demo';
  function modeNow() { return (AQ.live && AQ.live.running) ? 'live' : dataSrc; }
  function syncModeTag() {
    var tag = el.modeTag; if (!tag || typeof tag.setAttribute !== 'function') return;
    var m = modeNow(), t = AQ.i18n.t, text = t('mode.' + m), tip = t('mode.' + m + 'Tip');
    if (tag.getAttribute('data-mode') !== m) tag.setAttribute('data-mode', m);
    if (tag.textContent !== text) tag.textContent = text;
    if (tag.title !== tip) tag.title = tip;
  }

  /** コマの「代表の出来事」の目印（組み直しても同じ出来事のコマを探せるように） */
  function sigOf(b) { var l = b && b.lead; return l ? [l.t, l.type, l.actor, (l.meta && l.meta.seq) || ''].join('|') : null; }

  function rebuild(reset) {
    /* LIVE の組み直しで、いま見ているコマの位置がずれないように、その代表の出来事を覚えておく */
    var oldSig = (!reset && clock && clock.beats) ? sigOf(clock.beats[clock.index]) : null;
    var agg = AQ.aggregate.toBeats(allEvents);
    fullBeats = agg.beats;
    stats = agg.stats;
    /* 依頼の索引はコマではなくイベントから作る（間引きの影響を受けない）。
       ここで1回だけ作り、毎フレーム作り直さない。 */
    jobIndex = AQ.jobs ? AQ.jobs.index(allEvents) : { list: [], byId: {} };
    /* 依頼の呼び名を、ログに出てきた順に α, β, γ … と振る（新しい依頼にだけ次の名前）。 */
    if (AQ.nick && AQ.nick.setJobOrder) {
      var order = [], seenJ = {};
      allEvents.forEach(function (e) {
        var j = e && e.meta && e.meta.job;
        if (j == null || j === '' || seenJ[j]) return;
        seenJ[j] = true; order.push(j);
      });
      AQ.nick.setJobOrder(order);
    }
    /* LIVE で新しい行が届くと、同じ依頼の段階が増えることがある＝筋書きも
       作り直す（作り直さないと、④が届いたのに③で終わったままになる）。 */
    agentIndex = buildAgentIndex(jobIndex);
    if (agentFilter != null) agentStory = buildAgentStory(agentFilter);
    syncModeButtons();      // 依頼の無いログでは切り替えボタン自体を隠す
    if (focusJob != null) jobStory = buildJobStory(jobIndex.byId[focusJob] || null, agentFilter);
    AQ.stage.select(allEvents);   // 街か部屋かを決める（常にログ全体で判定）
    noteStageChange();            // 街 ⇔ 部屋が変わったら場面転換
    fitCanvasSoon();              // 空いている高さまで絵を大きく（2026-10-05）
    updateHintLine();
    AQ.stage.prepare(fullBeats);  // 歩く道すじを先に決めておく（常にログ全体）
    playBeats = computePlayBeats();
    syncFocusPlan();
    if (reset) {
      userPaused = false;      // 新しいログを読んだら停止状態は解除
      clock.setBeats(playBeats);
      /* ★ task 1: ここで自動再生しない。読み込み直後は「誰も選んでいない」
         状態のまま、ユーザーが名簿から選ぶのを待つ（frame() が
         hasChosen===false の間は家具だけを描き、ロボットは描かない）。
         以前はここで無条件に clock.play() していた（＝task Aの
         focusMostActive と組み合わさって、選んだ覚えのない1体が
         いきなり動き出して見えていた症状の一因）。
         ただし再生しないことと「何も描かない」ことは別。clock.play() が
         これまで frame() を呼ぶ唯一の入口だったので、それを外した分、
         ここで1回だけ frame() を呼んでおかないと、選ぶ前の「家具だけの
         部屋・選んでくださいの案内・光っている名簿」がいつまでも画面に
         出ない（＝再生しないのではなく、単に何も描かれていないだけ）
         になってしまう。再生は始めず、いまの状態（コマ0・
         hasChosen=false）を1回描くだけ。 */
      frame();
    } else {
      // ライブ追加。いま見ているコマは動かさない
      var keep = Math.min(clock.index, playBeats.length - 1);
      /* ★ 2026-10-08: 届いた行で束ね方が変わると、同じ番号が別のコマを指すことがある。
         同じ出来事のコマを探してそこに留まり、中身が変わったらメーターも計算し直す。 */
      var moved = false;
      if (oldSig) {
        for (var q = 0; q < playBeats.length; q++) if (sigOf(playBeats[q]) === oldSig) { moved = (q !== clock.index); keep = q; break; }
      }
      var beatBefore = clock.beats[clock.index];
      clock.beats = playBeats;
      clock.index = keep < 0 ? 0 : keep;
      if ((moved || sigOf(beatBefore) !== sigOf(playBeats[clock.index])) && typeof clock.onBeat === 'function') clock.onBeat(clock.index);
      /* ★ ユーザーが自分で止めたときは、勝手に再開しない。
         LIVE は1.5秒ごとに組み直すので、ここで無条件に play() して
         いたせいで「停止を押しても止まらない」状態になっていた
         （2026-09-04 の報告）。自動で再開してよいのは、そもそも
         ユーザーが止めていないときだけ。
         ★ task 1: それに加えて、そもそもまだ誰も選んでいない
         （hasChosen===false）ときは、LIVE の新着が届いただけで
         再生を始めてはいけない（＝選ぶ前に接続しただけで動き出して
         見えていた症状そのもの）。ユーザーが選んだあとに限って、
         今までどおりの「自分で止めない限り再開してよい」が働く。 */
      if (hasChosen && !clock.playing && !userPaused) clock.play();
      maybeAutoCatchUp();
      /* ★ 2026-09-30: 止まっているとき（まだ誰も選んでいない・一時停止中）は
         描き直しが走らないので、LIVE で届いた新しい依頼が右の一覧に出て
         こなかった。止まっているときだけ1回描き直す。 */
      if (!clock.playing) frame();
    }
  }

  /* ---- 選ぶまで何も動かない（task 1） ---------------------------------
     以前は「最多行動の1体」を毎回自動で選び、勝手に再生を始めていた
     （focusMostActive）。「接続するといきなりロボットが動いていて、
     どれが動いたのか分からない」「一連の挙動が終わるといきなり次の
     ロボットが動き出す」という報告への対応で、既定を逆にする：
       ・読み込み直後（LIVE接続の最初の1回も含む）は、誰も選ばない・
         再生もしない。名簿を光らせて「選んでください」と伝える。
       ・ユーザーが名簿の行をクリックした瞬間に、その1体だけへ絞って
         再生を始める（applyFocus が常に再生を始める）。
       ・その1体のコマが尽きたら、そこで止まる（絞り込みは
         computePlayBeats() でその1体のコマ列だけになっているので、
         clock 自身が最後のコマで自動的に止まる＝他の誰かへ勝手に
         移ることは構造的に起きない）。実況欄には「#N の記録は
         ここまでです」と出し、名簿はまた選べる状態のまま。
     hasChosen が false の間は focusActor は必ず null（＝まだ何も
     選んでいない、という意味。「すべて表示」を押した後の null とは
     区別するためのフラグ）。 */
  var hasChosen = false;

  function loadEvents(events) {
    /* 新しいログを読んだ＝はじめの画面で何かを選んだ（または別の道で読んだ）。 */
    if (!startBackdrop) backdropOnly = false;
    if (!startBackdrop && !pendingAgent) hideStart();
    /* LIVE のためておいた組み直し（前のログ向け）は捨てる */
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    allEvents = AQ.questlog.load(events);
    /* 呼び名は「そのログの中での通し番号」と同じ性格のラベルなので、
       ログを入れ替えたら白紙に戻す（前のログの呼び名を持ち越さない）。 */
    if (AQ.nick) AQ.nick.reset();
    focusJob = null;            // 新しいログを読んだら絞り込みは解除する
    jobStory = null;
    agentStory = null;
    focusActor = null;
    agentFilter = null;
    listMode = 'agents';        // ★ 2026-09-28: 最初はエージェントから選ぶ
    hasChosen = false;          // ★ task 1: 選び直しが必要な状態に戻す
    /* ★ 2026-09-28: 選ぶまで何も動かないのだから、時計も止めておく。
       以前は前のログ（起動直後の入門など）の再生中のまま時計が進み続け、
       何も描かれていないのにボタンだけが「停止（❚❚）」を示していた。 */
    if (clock && clock.pause) clock.pause();
    /* ★ 2026-09-13(2) 修正: 入門モードは「入門のデータを見ているあいだ」
       だけのもの。ログが差し替わったら必ず解除する。
       ここを忘れていたため、LIVE で kibble につないでも入門の状態が
       残り、一覧（依頼・エージェントを選ぶ欄）が畳まれたままになって
       何も選べなくなった、という報告を受けた。データを入れ替える道は
       4本（デモ・ファイル読み込み・LIVE の初回・最新に追いつく）あるが、
       どれも必ずこの loadEvents を通るので、解除はここ1か所でよい。 */
    isIntro = false;
    dataSrc = 'log';            // 2026-11-05: 何を読んだか（札の出し分け）。デモは loadRun が 'demo' に直す
    liveFollowing = true;
    updateFocusInputUI();
    if (AQ.hud.resetProgressTracking) AQ.hud.resetProgressTracking();
    rebuild(true);
    updateHintLine();           // 「作り話です」の断りも一緒に消す
  }

  /** ライブ用。後ろに足すだけで、レンダラはリプレイのまま */
  /* LIVE 用：届くたびに組み直すと画面がちらつくので、少しためてから1回。 */
  var pendingTimer = null;
  var speedTouched = false;   // ユーザーが速度を自分で選んだか
  function appendEventsThrottled(events) {
    if (!events || !events.length) return;
    allEvents = AQ.questlog.load(allEvents.concat(events));
    if (pendingTimer) return;
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      rebuild(false);
    }, AQ.config.liveRebuildMs);
  }

  function appendEvents(events) {
    if (!events || !events.length) return;
    allEvents = AQ.questlog.load(allEvents.concat(events));
    rebuild(false);
  }

  /* ---- LIVE の追いつき（task B） -----------------------------------
     kibble は毎秒1〜2件届くのに、読める再生速度はそれより遅い。
     未再生の件数が config.liveMaxBehind を超えたら、最新のコマまで
     自動で追いつく。何コマ飛ばしたかは常に正直に出す（数を偽らない）。
     ユーザーが自分でコマ送り／一時停止／スクラブしたときは、次に
     「最新に追いつく」を押すか・追いついた状態から再生を押すまで、
     この自動追いつきを止める（触った直後に勝手にコマを持っていかれると
     操作にならないため）。 ------------------------------------------ */

  /** 最新のコマへ飛ぶ。飛ばした数を返す（0以下なら何もしていない）。 */
  function jumpToLive() {
    if (!clock.beats.length) return 0;
    var target = clock.beats.length - 1;
    var skipped = target - clock.index;
    liveFollowing = true;
    if (skipped <= 0) return 0;
    clock.seek(target);
    liveTotalSkipped += skipped;
    liveSkipMsgUntil = performance.now() + 3200;
    /* 飛ばしたことは隠さない：一時的な文の代わりにランプの title に入れ、
       累計の数は右の »| の数字として出し続ける（updateLiveSkipTotalUI）。 */
    setLiveLamp('ok', AQ.i18n.t('ui.liveSkipped', { n: skipped }));
    updateLiveSkipTotalUI();
    frame();
    return skipped;
  }

  function updateLiveSkipTotalUI() {
    if (!el.liveSkip) return;
    el.liveSkip.textContent = liveTotalSkipped > 0
      ? AQ.i18n.t('ui.liveSkipTotal', { n: liveTotalSkipped })
      : '';
    el.liveSkip.title = liveTotalSkipped > 0
      ? AQ.i18n.t('ui.liveSkipTotalTitle', { n: liveTotalSkipped }) : '';
  }

  /** LIVE のランプ。state: off / ok / behind / wait / err。text は title に。 */
  function setLiveLamp(state, text) {
    var lamp = document.getElementById('liveLamp');
    if (!lamp) return;
    /* 毎フレーム呼ばれる：変わったときだけ書く。 */
    if (state && lamp.className !== 'live-lamp ' + state) lamp.className = 'live-lamp ' + state;
    if (lamp.title !== (text || '')) {
      lamp.title = text || '';
      lamp.setAttribute('aria-label', text || '');
    }
  }

  function maybeAutoCatchUp() {
    if (!(AQ.live && AQ.live.running)) return;
    if (!liveFollowing) return;
    var behind = clock.beats.length - 1 - clock.index;
    if (behind > AQ.config.liveMaxBehind) jumpToLive();
  }

  /** ユーザーが自分でコマ送り／一時停止／スクラブした＝追いつく動作を止める。 */
  function suspendLiveFollow() { liveFollowing = false; }

  /** LIVE の最新コマで再生を始めた＝また追いつく動作を再開してよい、という合図。 */
  function maybeResumeLiveFollow() {
    if (AQ.live && AQ.live.running && clock.index === clock.beats.length - 1) liveFollowing = true;
  }

  /* ---- 1体だけに絞る（task E） --------------------------------------
     16体が入り乱れるログを追うのは原理的に無理なので、1体だけ再生する
     フィルタを掛けられるようにする。フィルタは「再生対象のコマ列」だけを
     絞り、街・部屋のレンダラにはいつもログ全体を渡す（rebuild 参照）。 */

  /** 絞り込み後のコマ列を絵の側にも教える（歩く経路を組み直させる）。
      絞っていないときは null＝今までどおり全体の経路。 */
  function syncFocusPlan() {
    if (!AQ.stage.setFocusPlan) return;
    AQ.stage.setFocusPlan(
      (focusJob != null || focusActor != null || agentFilter != null) ? playBeats : null);
  }

  function trueIndexOfCurrentBeat() {
    var b = clock.beats[clock.index];
    return b ? b.index : 0;
  }

  /** list（再生順のコマ列）の中で、trueIdx 以上の本当の位置を持つ
      最初のコマの添字。無ければ最後のコマ（クランプ）。 */
  function nearestPlayIndex(list, trueIdx) {
    for (var i = 0; i < list.length; i++) if (list[i].index >= trueIdx) return i;
    return Math.max(0, list.length - 1);
  }

  /** actor（null で解除）に絞り込む。いま見ている「本当のコマ番号」に
      一番近い、絞り込んだあとのコマへ飛ぶ（絞り込むたびに0へ戻さない）。

      ★ task 1: ここに来る呼び出しは、すべて「ユーザーが選んだ」
      （名簿の行クリック・「すべて表示」・DIDを貼っての絞り込み・
      テスト／自動操作からの AQ.app.focusOn 系）という明示的な操作。
      「その瞬間に再生が始まる」という約束を守るため、以前のように
      「元から再生中だったときだけ再生を続ける」ではなく、選んだら
      必ず再生する（userPaused も解除する＝選び直しは「もう一時停止は
      していない」という意思表示でもある）。 */
  /** 依頼1件に絞る。依頼は最初から見せたいので、コマ0（＝その依頼の
      いちばん古い記録）から始める。エージェントを追っていた頃は
      「いまの位置に一番近いコマ」へ飛ばしていたが、依頼は①から④への
      1本の物語なので、途中から始めても意味が通らない。 */
  function applyJobFocus(jobId) {
    focusJob = jobId;
    focusActor = null;
    agentStory = null;            // 依頼を選んだら「まとめ」ではなく物語
    jobStory = buildJobStory(jobIndex.byId ? jobIndex.byId[jobId] : null, agentFilter);
    hasChosen = true;
    if (AQ.hud.resetProgressTracking) AQ.hud.resetProgressTracking();
    playBeats = computePlayBeats();
    syncFocusPlan();
    clock.pause();
    clock.beats = playBeats;
    clock.index = 0;
    clock.elapsed = 0;
    clock.onBeat(0);
    updateFocusInputUI();
    userPaused = false;
    frame();
    clock.play();
  }

  function handleJobClick(jobId) {
    if (jobId == null) return;
    applyJobFocus(String(jobId));
  }

  /** エージェント一覧の行クリック。依頼のあるログでは「その子の依頼だけの
      一覧」に切り替え、代表の1件を自動で再生する（1体を選んだ瞬間に
      全部の依頼を並べると、また入り乱れて読めなくなるため）。
      依頼IDを持たないログ（x402 のサンプル）では、従来どおりその1体の
      コマ列をそのまま再生する。 */
  function handleAgentClick(actor) {
    if (actor == null) return;
    var a = String(actor);
    if (!jobIndex.list.length) { applyFocus(a); return; }
    agentFilter = a;
    listMode = 'jobs';
    /* ★ 2026-09-28: エージェントを選んだら、その子の「代表の依頼」1件を
       最初から最後まで再生する（報告「エージェント目線だと取り組んでいる
       仕事がころころ変わってわかりづらい。表示上は1件の仕事をずっと表示
       しておいてほしい」）。以前は ①〜④ の段階ごとに別々の依頼を1つずつ
       例として見せる「まとめ」で、場面ごとに札が入れ替わっていた。
       その子が何件やったか（件数）は、ステータス欄が今までどおり正確に出す
       （agentStory は件数のためだけに作る）。ほかの依頼は右の一覧から選べる。 */
    agentStory = buildAgentStory(a);
    focusJob = representativeJobOf(a);
    jobStory = (focusJob != null) ? buildJobStory(jobIndex.byId[focusJob] || null, a) : null;
    hasChosen = true;
    if (AQ.hud.resetProgressTracking) AQ.hud.resetProgressTracking();
    playBeats = computePlayBeats();
    syncFocusPlan();
    clock.pause();
    clock.beats = playBeats;
    clock.index = 0;
    clock.elapsed = 0;
    if (playBeats.length) clock.onBeat(0);
    userPaused = false;
    syncModeButtons();
    frame();
    if (playBeats.length) clock.play();
  }

  /** 「◀ エージェント一覧へ戻る」。絞り込みだけ解除し、再生はそのまま
      （見ている途中の依頼が勝手に止まったり変わったりしない）。 */
  function handleAgentBack() {
    agentFilter = null;
    agentStory = null;
    listMode = 'agents';
    /* 主役の指定が外れたので筋書きを作り直す（そのまま再生している依頼を
       「依頼まるごと」の見え方に戻す）。 */
    if (focusJob != null) {
      var oldSig = (clock && clock.beats) ? sigOf(clock.beats[clock.index]) : null;
      jobStory = buildJobStory(jobIndex.byId[focusJob] || null, null);
      playBeats = computePlayBeats();
      syncFocusPlan();
      var keep = Math.min(clock.index, playBeats.length - 1);
      /* ★ 2026-10-08: 届いた行で束ね方が変わると、同じ番号が別のコマを指すことがある。
         同じ出来事のコマを探してそこに留まり、中身が変わったらメーターも計算し直す。 */
      var moved = false;
      if (oldSig) {
        for (var q = 0; q < playBeats.length; q++) if (sigOf(playBeats[q]) === oldSig) { moved = (q !== clock.index); keep = q; break; }
      }
      var beatBefore = clock.beats[clock.index];
      clock.beats = playBeats;
      clock.index = keep < 0 ? 0 : keep;
      if ((moved || sigOf(beatBefore) !== sigOf(playBeats[clock.index])) && typeof clock.onBeat === 'function') clock.onBeat(clock.index);
    } else {
      releaseToChoose();
    }
    syncModeButtons();
    frame();
  }

  /* ---- 「誰も選んでいない」状態に戻す（2026-09-27 の不具合対応）-------
     利用者の報告「なぜか急にエージェントがわらわらと現れました。
     エージェントの名前はクリックしていません」。

     再現：依頼またはエージェントを選んだあと、一覧の「依頼から」／
     「エージェントから」や「◀ エージェント一覧へ戻る」を押すと、
     絞り込み（agentFilter・focusJob）は外れるのに hasChosen は true の
     まま残る。この「選んだことになっているが、実際には何も選んで
     いない」状態で computePlayBeats() を呼ぶと、3つとも null なので
     ログ全体（fullBeats）が返る。押した直後は clock.beats が古いままなので
     画面は変わらないが、LIVE の新着が届いた次の rebuild(false) で
     clock.beats がログ全体に差し替わり、その瞬間に全エージェントが
     いっせいに動き出す（実測：2コマ → 126コマ）。

     直し方：絞り込みが全部外れたなら、それは「まだ選んでいない」状態
     そのもの＝このアプリの既定（選ぶまで何も動かない）へ素直に戻す。
     「すべて表示」ボタン（focusShowAll → applyFocus(null)）は、利用者が
     自分でログ全体を選んだ場合なので、こちらは今までどおり動く。 */
  function releaseToChoose() {
    if (focusJob != null || focusActor != null || agentFilter != null) return;
    hasChosen = false;
    jobStory = null;
    agentStory = null;
    if (AQ.hud.resetProgressTracking) AQ.hud.resetProgressTracking();
    playBeats = computePlayBeats();
    syncFocusPlan();
    clock.pause();
    userPaused = false;
    clock.beats = playBeats;
    clock.index = 0;
    clock.elapsed = 0;
  }

  /** 一覧の切り替え（依頼から／エージェントから）。
      ★ どちらを押しても「エージェントで絞っている状態」は解除する。
      「依頼から」を押したのに、直前に選んだ子の依頼だけが並んだままだと、
      押した意味が無い（一覧の件数も画面の中身も変わらない）。 */
  function setListMode(mode) {
    listMode = (mode === 'agents') ? 'agents' : 'jobs';
    var had = (agentFilter != null);
    agentFilter = null;
    agentStory = null;
    if (had && focusJob != null) {
      var oldSig = (clock && clock.beats) ? sigOf(clock.beats[clock.index]) : null;
      jobStory = buildJobStory(jobIndex.byId[focusJob] || null, null);
      playBeats = computePlayBeats();
      syncFocusPlan();
      var keep = Math.min(clock.index, playBeats.length - 1);
      /* ★ 2026-10-08: 届いた行で束ね方が変わると、同じ番号が別のコマを指すことがある。
         同じ出来事のコマを探してそこに留まり、中身が変わったらメーターも計算し直す。 */
      var moved = false;
      if (oldSig) {
        for (var q = 0; q < playBeats.length; q++) if (sigOf(playBeats[q]) === oldSig) { moved = (q !== clock.index); keep = q; break; }
      }
      var beatBefore = clock.beats[clock.index];
      clock.beats = playBeats;
      clock.index = keep < 0 ? 0 : keep;
      if ((moved || sigOf(beatBefore) !== sigOf(playBeats[clock.index])) && typeof clock.onBeat === 'function') clock.onBeat(clock.index);
    } else {
      /* 絞り込みが全部外れたなら「まだ選んでいない」状態へ戻す
         （上の releaseToChoose のコメント参照）。 */
      releaseToChoose();
    }
    syncModeButtons();
    frame();
  }

  function syncModeButtons() {
    var agents = (listMode === 'agents');
    if (el.modeJobs) {
      /* className を丸ごと書き換えると、記号ボタンの見た目（icon-btn）まで
         外れてしまう。付け外しが要る語だけを触る。 */
      el.modeJobs.classList.add('ghost');
      if (el.modeJobs.classList.contains('on') === agents) el.modeJobs.classList.toggle('on', !agents);
      /* 依頼IDを持たないログでは切り替える意味が無いので出さない。 */
      el.modeJobs.hidden = !jobIndex.list.length;
    }
    if (el.modeAgents) {
      el.modeAgents.classList.add('ghost');
      if (el.modeAgents.classList.contains('on') !== agents) el.modeAgents.classList.toggle('on', agents);
      el.modeAgents.hidden = !jobIndex.list.length;
    }
  }

  function applyFocus(actor) {
    var trueIdx = trueIndexOfCurrentBeat();
    focusJob = null;
    jobStory = null;
    agentStory = null;
    /* ★ 2026-09-28 修正: エージェントを選んだあと「すべて表示（◎）」を押すと、
       エージェントの絞り込み（agentFilter）だけが残り、ステータス欄に
       その子の依頼数と「書き込み 0」（件数の元の agentStory は消えている）
       という事実と違う数が出ていた。全体を見るなら絞り込みも外す。 */
    agentFilter = null;
    focusActor = actor;
    hasChosen = true;             // ★ task 1: これでもう「未選択」ではない
    if (AQ.hud.resetProgressTracking) AQ.hud.resetProgressTracking();
    playBeats = computePlayBeats();
    syncFocusPlan();
    clock.pause();
    clock.beats = playBeats;
    clock.index = playBeats.length ? nearestPlayIndex(playBeats, trueIdx) : 0;
    clock.elapsed = 0;
    clock.onBeat(clock.index);
    updateFocusInputUI();
    userPaused = false;           // 選び直した＝一時停止の意思は引き継がない
    maybeResumeLiveFollow();
    frame();
    clock.play();
  }

  function updateFocusInputUI() {
    if (el.focusDid && document.activeElement !== el.focusDid) el.focusDid.value = '';
  }

  function handleFocusClick(actor) {
    if (actor == null) return;
    applyFocus(String(actor));
  }

  function focusShowAll() { applyFocus(null); }

  /* 一覧の絞り込み欄。名前の一部か #番号 で探せる。
     200体を超えると目で探すのは無理なので、これが実質の入口になる。 */
  function bindRoster() {
    if (el.rosterFilter) {
      el.rosterFilter.addEventListener('input', function () {
        AQ.hud.setRosterFilter(el.rosterFilter.value);
        frame();
      });
    }
    if (el.focusAll2) el.focusAll2.addEventListener('click', focusShowAll);
    if (el.modeJobs)   el.modeJobs.addEventListener('click',   function () { setListMode('jobs'); });
    if (el.modeAgents) el.modeAgents.addEventListener('click', function () { setListMode('agents'); });
    /* 行のクリック（と Enter）で、その依頼1件だけに絞る。 */
    if (el.rosterChips) {
      el.rosterChips.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        if (!ev.target || !ev.target.closest) return;
        var jrow = ev.target.closest('.jrow[data-job]');
        if (jrow) { ev.preventDefault(); handleJobClick(jrow.getAttribute('data-job')); return; }
        var agrow = ev.target.closest('.agentrow[data-agent]');
        if (agrow) { ev.preventDefault(); handleAgentClick(agrow.getAttribute('data-agent')); return; }
        var back = ev.target.closest('.backrow[data-back]');
        if (back) { ev.preventDefault(); handleAgentBack(); return; }
        var arow = ev.target.closest('.arow[data-actor]');
        if (arow) { ev.preventDefault(); handleFocusClick(arow.getAttribute('data-actor')); }
      });
    }
  }

  /** DID を貼って絞り込む（この画面の本来の使い道：自分のエージェントを
      見る）。完全一致 → 一意な末尾一致の順で探す。どちらにも当てはまらない
      （見つからない・複数に当てはまって一意に決まらない）ときは、
      画面にそう書いて、何も変えない（分からないものを当てずっぽうで
      選ばない）。 */
  function focusByDid(raw) {
    var needle = String(raw || '').trim();
    if (!needle) return;
    var seen = {}, actors = [];
    fullBeats.forEach(function (b) {
      var a = String(b.actor || 'agent');
      if (!seen[a]) { seen[a] = true; actors.push(a); }
    });
    var exact = actors.filter(function (a) { return a === needle; });
    if (exact.length === 1) { applyFocus(exact[0]); return; }
    var suffix = actors.filter(function (a) {
      return a.length >= needle.length && a.slice(a.length - needle.length) === needle;
    });
    if (suffix.length === 1) { applyFocus(suffix[0]); return; }
    el.liveStat.textContent = AQ.i18n.t('ui.focusNotFound');
  }

  /** 依頼IDか題名の一部で探して、その1件に絞る（「詳しい設定」の入力欄）。
      一意に決まらないときは何も変えず、その旨だけを出す
      （当てずっぽうで別の依頼を開かない）。 */
  function focusByJobText(raw) {
    var needle = String(raw || '').trim();
    if (!needle) return;
    var list = jobIndex.list || [];
    var exact = list.filter(function (r) { return r.id === needle; });
    if (exact.length === 1) { applyJobFocus(exact[0].id); return; }
    var low = needle.toLowerCase();
    var partial = list.filter(function (r) {
      return String(r.id).toLowerCase().indexOf(low) >= 0 ||
             (r.title && String(r.title).toLowerCase().indexOf(low) >= 0);
    });
    if (partial.length === 1) { applyJobFocus(partial[0].id); return; }
    el.liveStat.textContent = AQ.i18n.t('ui.jobNotFound');
  }

  /** 「詳しい設定」の検索欄。依頼のあるログでは依頼を、依頼IDを持たない
      ログ（x402 のサンプルなど）では今までどおり DID を探す。 */
  function focusBySearch(raw) {
    if (jobIndex.list && jobIndex.list.length) focusByJobText(raw);
    else focusByDid(raw);
  }

  /* ★ 2026-10-08: LIVE につないだまま別のログ（デモ・ファイル・アドレス）を読むと、
     LIVE の新着がそのログの後ろに混ざっていた。別のログを読むときは、まず接続を切る。 */
  function stopLiveQuiet() {
    if (AQ.live && AQ.live.running) {
      AQ.live.stop();
      if (el.connect) { AQ.hud.setIcon(el.connect, 'ui.connect'); el.connect.classList.remove('live-on'); }
      if (el.liveStat) el.liveStat.textContent = '';
      if (typeof setLiveLamp === 'function') setLiveLamp('off', 'stopped');
    }
  }

  function loadRun(key) {
    if (!AQ.runs[key]) return;
    stopLiveQuiet();
    loadEvents(AQ.runs[key]);          // ここで isIntro は false に戻る
    isIntro = (key === INTRO_RUN);     // 入門を読んだときだけ、そのあと立てる
    dataSrc = 'demo';                  // 組みこみのデモ（どれも説明用の作り話）
    updateHintLine();
  }

  /* ---- 「x402ってなに？」（2026-09-13）--------------------------------
     このアプリのゴールは Base での x402 の認知向上。ところが起動画面は
     「右の一覧から選んでください」で、x402 の3文字も出ていなかった＝
     いちばん答えてほしい人に何も答えていなかった。
     入門のときだけは自動で再生する。ほかのログでは今までどおり
     「選ぶまで何も動かない」を守る（大勢が一斉に動くと誰が誰だか
     分からない、という報告への対応だったので、1体しか出てこない
     入門には当てはまらない）。 */
  var INTRO_RUN = 'x402intro';
  var isIntro = false;

  function startIntro() {
    currentShareId = null;   // 入門は ?demo=1 で共有する
    /* ★ 2026-09-14: LIVE につないだまま入門を押すと、入門の10コマに
       kibble が後ろから流れ込んで404コマになり、誰が主役なのか分から
       なくなった（利用者の画面で発生）。入門は「1体だけの静かな1本」
       であることが値打ちなので、まず接続を切る。 */
    stopLiveQuiet();
    loadRun(INTRO_RUN);
    if (!isIntro) return;                    // 入門が読み込まれていない＝何もしない
    var first = fullBeats.length ? fullBeats[0].actor : null;
    if (first == null) return;
    applyFocus(String(first));               // hasChosen=true にして最初から再生
    /* 始動の動作（2026-10-04）は「頭から再生を始めるとき」に入る。applyFocus の中で
       もう再生が始まっていると入らないので、いったん止めて頭から始め直す。 */
    clock.pause();
    clock.seek(0);
    syncBootTail();
    userPaused = false;
    clock.play();
  }

  /** 「ログを開く」・ドラッグ＆ドロップ・貼り付け、どれもここを通す。
      形式が分からなければ画面を壊さず、いまのランはそのまま。 */
  function tryLoad(raw) {
    try {
      var found = AQ.adapters.detect(raw);
      stopLiveQuiet();
      loadEvents(found.events);
      el.liveStat.textContent = found.how;
    } catch (err) {
      el.liveStat.textContent = (err && err.message) || String(err);
    }
  }

  /* ---- 毎フレーム ----
     ★ clock.beats は focus 中は絞られた部分列。状態（USDC/CREDITS/…）は
       必ずログ全体（fullBeats）と、そのコマの「本当の位置」（b.index）
       から求める＝1体に絞って見ていても、メーターの値はログ全体の
       本当の値のまま（絞り込みは再生対象を減らすだけで、事実を変えない）。 */
  function onBeat(i) {
    var b = clock.beats[i];
    st = AQ.state.at(fullBeats, b ? b.index : 0);
  }

  /* ★ 2026-09-30: 始動・終了の動作は、選んで（エージェント／依頼）再生して
     いるときだけ。全員表示では入れない。
     ★ 2026-10-04: 入門（街）でも入れる（利用者「こちらも始動するときのアクションを」）。
     始動は少し長く（1.3秒 → 1.8秒）して、電源が入る様子を見えるようにした。 */
  var BOOT_MS = 1800, TAIL_MS = 1700;
  function syncBootTail() {
    var on = hasChosen && (isIntro || focusJob != null || focusActor != null || agentFilter != null);
    clock.bootMs = on ? BOOT_MS : 0;
    clock.tailMs = on ? TAIL_MS : 0;
  }

  function frame() {
    syncBootTail();
    syncModeTag();
    var b = clock.beats[clock.index];
    if (!b) return;
    if (!st) st = AQ.state.at(fullBeats, b.index);

    /* ★ task 1: 「選ぶまで何も動かない」の実体はここ。
       hasChosen===false（まだ誰も選んでいない）の間は、レンダラに
       渡す「本当のコマ番号」として -1 を渡す。scene.js / room.js の
       activeRobots はどちらも「index2 以前に登場した actor」だけを
       ロボットとして選ぶので、-1（＝どのコマより前）を渡すと
       候補が1つも無くなり、ロボットが1体も描かれなくなる（板・納品口・
       検品台などの家具は、beat/beats 自体は本物を渡しているので
       今までどおり描かれる＝「家具は見える、ロボットだけいない」）。
       render() の新しい引数を増やさずに済む、既存の性質を使った実装。 */
    var renderIndex = hasChosen ? b.index : -1;

    /* 選んでいたエージェントの記録をちょうど再生し終えて、かつ
       ユーザーが自分で一時停止したのでもなければ「ここまでです」を出す
       （clock は最後のコマで自動的に止まる＝他の誰かへは進まない）。 */
    var atEnd = hasChosen && (focusJob != null || focusActor != null) && !clock.playing &&
                clock.index === clock.beats.length - 1;
    var prompt = !hasChosen ? 'select' : (atEnd ? 'ended' : null);

    if (AQ.room && AQ.room.setPhase) AQ.room.setPhase(clock.phase());
    if (AQ.scene && AQ.scene.setPhase) AQ.scene.setPhase(clock.phase());   // 2026-10-04 街でも始動・終了
    AQ.stage.render(b, clock.progress(), st, performance.now(), fullBeats, renderIndex, renderFocus(b));
    AQ.hud.update(b, clock.progress(), st, stats, clock,
      { fullBeats: fullBeats, trueIndex: b.index,
        focusActor: focusActor, focusJob: focusJob,
        jobIndex: jobIndex,
        jobRec: (focusJob != null && jobIndex.byId) ? jobIndex.byId[focusJob] : null,
        /* 1件を再生しているときは「まとめ」ではない（agentStory は件数用）。 */
        jobStory: jobStory, agentStory: (focusJob == null) ? agentStory : null,
        agentStats: agentStory,
        listMode: listMode, agentFilter: agentFilter, agentIndex: agentIndex,
        phase: clock.phase(), playing: clock.playing,
        prompt: prompt, isIntro: isIntro });

    /* 入門は1体しか出てこない。一覧に「名前をクリックして選んでください」と
       出ていても選ぶものが無く、このアプリが付けた呼び名（ヤク（仮）など）
       だけが目立って、x402 の話から気を逸らす。だから入門の間は一覧を畳む
       （右の列は「なぜそうなるのか」の説明だけになる）。 */
    if (el.roster && isIntro && !el.roster.hidden) el.roster.hidden = true;
    syncSideColHeightIfNeeded();
    /* 入門を抜けたら（LIVE につないだ・ほかのログを読んだ）、一覧は
       hud が決めた状態にそのまま従う＝ここでは何もしない。上の1行が
       「入門のあいだだけ」であることを、この対の形で分かるようにしておく。 */

    /* LIVE 中は、届いた量に再生が追いつかないことがある。
       追いついているふりをせず、未再生のコマ数をそのまま出す。
       ただし「N コマ飛ばして追いつきました」の一時表示中は上書きしない。 */
    if (AQ.live && AQ.live.running) {
      if (performance.now() >= liveSkipMsgUntil) {
        var behind = clock.beats.length - 1 - clock.index;
        /* ★ 2026-09-28: 「最新に追いついています」の文はやめ、ランプで出す
           （文はマウスを乗せると出る）。遅れているコマ数も title に残す。 */
        setLiveLamp(behind > 1 ? 'behind' : 'ok',
                    behind > 1 ? AQ.i18n.t('ui.behind', { n: behind })
                               : AQ.i18n.t('ui.caughtUp'));
      }
    } else {
      setLiveLamp('off', '');
    }
    AQ.hud.setIcon(el.play, clock.playing ? 'ui.pause' : 'ui.play');
    syncEasyNow();
    /* 画面の下の寄り絵（いま用事をしている建物の中の様子）。街のときだけ（部屋は絵そのものが室内） */
    if (el.closeup && AQ.scene && AQ.scene.renderCloseup) {
      var showCu = hasChosen && AQ.stage.current === 'city';
      if (el.lower && el.lower.classList.contains('no-closeup') === showCu) { el.lower.classList.toggle('no-closeup', !showCu); fitCanvasSoon(); }
      if (showCu) AQ.scene.renderCloseup(el.closeup, b, clock.progress(), st, performance.now());
    }
    syncSfx();
    syncRecap();
    renderCmd(false);
    /* やさしい表示：LIVE の欄は LIVE でつないでいるときだけ出す（入門・ウォレットでは使わない） */
    var liveRow = el.room && el.room.parentNode;
    if (liveRow) {
      var hideLive = isEasy() && !(AQ.live && AQ.live.running);
      if (liveRow.classList.contains('easy-off') !== hideLive) liveRow.classList.toggle('easy-off', hideLive);
    }
  }

  /* ---- 場所（仕事の部屋）の一覧（2026-09-30）------------------------------
     利用者の提案「場所の一覧を作って、地名をクリックするとその場所に飛べる」。
     一覧は engine/places.js が集める（technocore.chat の部屋一覧 → 直近の行を
     実際に見て、ジオラマが動く書式の部屋だけ）。地名を押すと、LIVE の欄に
     その部屋の名前を入れて接続する＝今までの「部屋の名前を打って接続」と
     まったく同じ道を通る。 */
  var PIN_SVG = '<svg class="ic pin" viewBox="0 0 12 12" aria-hidden="true">' +
    '<path d="M6 1 C3.8 1 2.4 2.6 2.4 4.6 C2.4 7.2 6 11 6 11 C6 11 9.6 7.2 9.6 4.6 C9.6 2.6 8.2 1 6 1 Z" fill="currentColor"/>' +
    '<circle cx="6" cy="4.6" r="1.5" fill="#0d1017"/></svg>';
  var BOARD_SVG = '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true">' +
    '<rect x="1" y="2" width="10" height="8" fill="#c8964f"/><rect x="2" y="3" width="3" height="3" fill="#f4f1e4"/>' +
    '<rect x="6" y="3" width="4" height="2" fill="#f4f1e4"/><rect x="6" y="6" width="3" height="3" fill="#f4f1e4"/></svg>';
  var placesState = null;

  function relabelPlaces() {
    var t = AQ.i18n.t;
    if (el.placesPin) el.placesPin.innerHTML = PIN_SVG;
    if (el.placesHead) el.placesHead.textContent = t('places.head');
    if (el.placesWarn) {
      el.placesWarn.title = t('places.warn', { n: 30 });
      el.placesWarn.setAttribute('aria-label', t('places.warn', { n: 30 }));
    }
    if (el.placesRefresh) {
      el.placesRefresh.textContent = '↻';
      el.placesRefresh.title = t('places.refresh');
      el.placesRefresh.setAttribute('aria-label', t('places.refresh'));
    }
    if (placesState) renderPlaces(placesState);
  }

  function renderPlaces(u) {
    placesState = u;
    if (!el.placesList) return;
    var t = AQ.i18n.t, esc2 = AQ.hud.esc;   // 部屋の名前・説明は信用しない文字＝必ず esc() を通す
    var here = (AQ.live && AQ.live.running) ? AQ.live.room : null;
    var rows = (u.places || []).map(function (r) {
      var sec = AQ.places.ageSeconds(r.age);
      var heat = (sec == null) ? 'cold' : (sec < 60 ? 'hot' : (sec < 3600 ? 'warm' : 'cold'));
      var title = (r.seq == null ? t('places.rowTitleKnown', { name: r.name })
                                 : t('places.rowTitle', { name: r.name, age: r.age, seq: r.seq })) +
                  (r.topic ? '\n' + t('places.topic', { topic: r.topic }) : '') +
                  (r.name === here ? '\n' + t('places.here') : '');
      return '<button type="button" class="place-row' + (r.name === here ? ' on' : '') + '" data-room="' + esc2(r.name) + '" ' +
             'title="' + esc2(title) + '">' + BOARD_SVG + '<b>' + esc2(r.name) + '</b>' +
             '<i class="act ' + heat + '" aria-hidden="true"></i></button>';
    }).join('');
    var foot = '';
    if (u.state === 'loading') foot = '<p class="places-note">' + esc2(t('places.loading')) + '</p>';
    else if (u.state === 'probing') foot = '<p class="places-note"><i class="spin" aria-hidden="true"></i>' +
                                         esc2(t('places.probing', { done: u.checked, total: u.total })) + '</p>';
    /* ★ 2026-10-03: 読めなかったときに赤い英語（Failed to fetch）を出さない。
       落ち着いた1行と雲の記号だけにし、詳しい理由はマウスを乗せると出る。 */
    var OFF_SVG = '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 9 H9 A2 2 0 0 0 9 5 A3 3 0 0 0 3.3 4.6 A2.2 2.2 0 0 0 3 9 Z" fill="none" stroke="currentColor"/><path d="M2 2 L10 10" stroke="currentColor"/></svg>';
    var offline = function (detailKey) {
      return '<p class="places-note calm" title="' + esc2(t(detailKey, { msg: u.error || '' })) + '">' + OFF_SVG + ' ' + esc2(t('places.offline')) + '</p>';
    };
    if (u.state === 'loading' || u.state === 'probing') { /* 上で決めた途中経過のまま */ }
    else if (u.state === 'failed') foot = offline('places.failed');
    else if (!rows && !(u.fallback && u.state === 'done')) foot = '<p class="places-note">' + esc2(t('places.none')) + '</p>';
    /* ★ 2026-09-30: 「なぜ1つしか出ないのか」が分かるように、何部屋を確かめて
       何部屋が仕事の部屋だったかを必ず添える。 */
    if (u.state === 'done' && !u.fallback) {
      foot += '<p class="places-note count" title="' + esc2(t('places.countTitle', { n: 30 })) + '">' +
              esc2(t('places.count', { checked: u.checked, found: (u.places || []).length })) + '</p>';
    }
    /* 一覧が読めず、知っている部屋だけ確かめたときは、そうと書く */
    if (u.fallback && u.state === 'done') foot += offline('places.fallback');
    el.placesList.innerHTML = rows + foot;
  }

  function loadPlaces(force) {
    if (!AQ.places || !el.placesList) return;
    if (force) AQ.places.forget();
    renderPlaces(placesState && !force ? placesState : { state: 'loading', places: [] });
    AQ.places.load(renderPlaces);
  }

  /** 地名を押した：その部屋へ LIVE でつなぐ（接続ボタンと同じ道）。 */
  function connectToRoom(room) {
    if (!room) return;
    if (AQ.live.running && AQ.live.room === room) return;   // もうそこにいる
    el.room.value = room;
    if (AQ.live.running) el.connect.click();                // いったん切る
    el.connect.click();                                     // その部屋へつなぐ
    if (placesState) renderPlaces(placesState);             // いまいる部屋の印を付け替える
  }

  function bindPlaces() {
    if (!el.placesPanel || !AQ.places) return;
    el.placesList.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('.place-row') : null;
      if (b) connectToRoom(b.getAttribute('data-room'));
    });
    if (el.placesRefresh) el.placesRefresh.addEventListener('click', function () { loadPlaces(true); });
    /* 右の列に常に出しておく一覧なので、開いたときに1回読む（以後10分は覚えておく）。
       読むのは部屋の一覧1回＋確かめる部屋（最大 AQ.places.MAX_PROBE）だけ。 */
    loadPlaces(false);
  }

  /* ---- 操作 ---- */
  function bindUI() {
    el.play.addEventListener('click', function () {
      /* ★ 2026-09-28 修正: 最後まで再生し終わったあとに ▶ を押しても何も
         起きず、ボタンが ▶ のまま変わらなかった（報告「再生ボタンを押しても
         停止ボタンに切り替わらない」）。時計は最後のコマで止まっていて、
         再生を始めた瞬間にまた「終わり」と判定して止まっていた。
         ふつうのプレーヤーと同じく、終わっていたら頭から再生する。 */
      if (!clock.playing && clock.beats.length &&
          clock.index >= clock.beats.length - 1 &&
          clock.elapsed >= clock.durationOf(clock.index)) {
        clock.seek(0);
      }
      clock.toggle();
      userPaused = !clock.playing;   // 押した結果が「停止」なら、以後こちらから再開しない
      if (clock.playing) maybeResumeLiveFollow(); else suspendLiveFollow();
      frame();
    });
    el.step.addEventListener('click', function () { suspendLiveFollow(); clock.step(); frame(); });
    el.restart.addEventListener('click', function () {
      userPaused = false; clock.restart(); maybeResumeLiveFollow(); frame(); });

    el.speed.addEventListener('change', function () {
      speedTouched = true;                       // 以後こちらから勝手に変えない
      clock.speed = Number(el.speed.value);
    });

    el.runSelect.addEventListener('change', function () { loadRun(el.runSelect.value); });

    el.scrub.addEventListener('input', function () {
      suspendLiveFollow();
      clock.pause();
      clock.seek(Number(el.scrub.value));
      frame();
    });

    /* canvas クリック：一時停止／再生の切り替え。 */
    /** canvas 上のクリック位置を、描画に使っているワールド座標へ直す。
        canvas は CSS で拡大縮小されているので、その比率を掛け戻す。 */
    function canvasPoint(ev) {
      var r = el.canvas.getBoundingClientRect();
      var W = (AQ.stage.current === AQ.stage.ROOM) ? AQ.roomWorld : AQ.world;
      var worldW = W.view.cols * W.tile, worldH = W.view.rows * W.tile;
      return { x: (ev.clientX - r.left) / r.width * worldW,
               y: (ev.clientY - r.top) / r.height * worldH };
    }

    /* ★ 2026-09-28: 絵の中の名札は、マウスを乗せたロボットにだけ出す
       （ジオラマの見た目を優先する。誰が誰かは右の一覧の顔でも分かる）。 */
    el.canvas.addEventListener('mousemove', function (ev) {
      if (AQ.room && AQ.room.setHover) {
        AQ.room.setHover(canvasPoint(ev));
        if (!clock.playing) frame();
      }
      /* ★ 2026-09-30: 絵の中の札にマウスを乗せると「依頼の種類：作る」のように
         出す（金づち・本・吹き出し・星・小包が何の印かを、絵の上でも確かめられる）。 */
      var tip = '';
      var b1 = clock.beats[clock.index];
      if (b1 && AQ.stage.hitTestCard && hasChosen) {
        var pt1 = canvasPoint(ev);
        var jid = AQ.stage.hitTestCard(pt1.x, pt1.y, b1.index, renderFocus(b1));
        if (jid != null) {
          var r1 = jobIndex.byId ? jobIndex.byId[jid] : null;
          tip = AQ.hud.kindTitle ? AQ.hud.kindTitle((r1 && r1.kind) || 'other') : '';
        }
      }
      if (el.canvas.title !== tip) el.canvas.title = tip;
    });
    el.canvas.addEventListener('mouseleave', function () {
      if (el.canvas.title) el.canvas.title = '';
      if (AQ.room && AQ.room.setHover) {
        AQ.room.setHover(null);
        if (!clock.playing) frame();
      }
    });

    el.canvas.addEventListener('click', function (ev) {
      /* 札の上なら、その依頼の経緯を詳細パネルに開く（再生は止めない）。 */
      var b0 = clock.beats[clock.index];
      if (b0 && AQ.stage.hitTestCard) {
        var pt = canvasPoint(ev);
        var jobId = AQ.stage.hitTestCard(pt.x, pt.y, b0.index, renderFocus(b0));
        if (jobId != null) {
          /* いま追っている依頼の札なら、その経緯（全イベント）を詳細へ。
             別の依頼の札なら、その依頼に乗り換える＝札そのものが
             一覧と同じ入口になる（初心者はまず絵をクリックするため）。 */
          if (jobId !== focusJob) { applyJobFocus(jobId); return; }
          var rec = jobIndex.byId ? jobIndex.byId[jobId] : null;
          AQ.hud.showJobDetail(jobId, (rec && rec.events) || [], rec);
          if (el.detailPanel) el.detailPanel.hidden = false;
          return;
        }
      }
      clock.toggle();
      userPaused = !clock.playing;   // 押した結果が「停止」なら、以後こちらから再開しない
      if (clock.playing) maybeResumeLiveFollow(); else suspendLiveFollow();
      frame();
    });

    /* ★ 2026-10-08: 文字を入力している欄・つまみ・ボタンの上では、再生の操作を
       横取りしない（検索欄に空白が打てず、再生が切り替わっていた）。 */
    function typingIn(t) {
      if (!t || !t.tagName) return false;
      var tag = t.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || !!t.isContentEditable;
    }
    document.addEventListener('keydown', function (ev) {
      if (typingIn(ev.target) && ev.key !== 'Escape') return;
      if (ev.key === ' ' && ev.target && ev.target.tagName && /^(button)$/i.test(ev.target.tagName)) return;   // ボタンは空白で押す
      if (ev.key === 'ArrowRight') { suspendLiveFollow(); clock.step(); frame(); }
      if (ev.key === 'ArrowLeft')  { suspendLiveFollow(); clock.stepBack(); frame(); }
      if (ev.key === ' ') {
        ev.preventDefault();
        clock.toggle();
        userPaused = !clock.playing;   // 押した結果が「停止」なら、以後こちらから再開しない
      if (clock.playing) maybeResumeLiveFollow(); else suspendLiveFollow();
        frame();
      }
      // 開いている詳細パネルを Esc で閉じる。
      if (ev.key === 'Escape') {
        if (el.detailPanel && !el.detailPanel.hidden) el.detailPanel.hidden = true;
      }
    });

    // LIVE の追いつき
    if (el.catchup) el.catchup.addEventListener('click', function () { jumpToLive(); });

    // 1体だけに絞る（DID を貼って絞り込む。「すべて表示」は名簿側の
    // ボタン1つだけに統一してある＝同じ操作を2か所に置かない）。
    if (el.focusGo)  el.focusGo.addEventListener('click', function () { focusBySearch(el.focusDid.value); });
    if (el.focusDid) el.focusDid.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') focusBySearch(el.focusDid.value);
    });

    // 詳細パネル：閉じているときはドキュメントの高さに
    // 影響しないよう position:fixed のオーバーレイにしてある（css参照）。
    if (el.detailToggle) el.detailToggle.addEventListener('click', function () {
      el.detailPanel.hidden = !el.detailPanel.hidden;
      syncEasyNow();
    });
    if (el.detailClose) el.detailClose.addEventListener('click', function () {
      el.detailPanel.hidden = true;
    });

    /* ★ 2026-11-05（「押しても目に見える反応がない」）: 再生を頭から始めたうえで、
       「x402 の流れを最初から再生します」と絵の上に出し、絵が画面の外なら見える所まで動かす。 */
    if (el.introBtn) el.introBtn.addEventListener('click', function () {
      startIntro();
      if (!isIntro) return;
      toast(AQ.i18n.t('x402.introStart'), 4000);
      var bz = el.canvas && el.canvas.closest ? el.canvas.closest('.bezel') : null;
      if (bz && bz.getBoundingClientRect) {
        var r = bz.getBoundingClientRect();
        if (r.top < 0 || r.top > (window.innerHeight || 800) * 0.6) { try { bz.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* 無視 */ } }
      }
    });

    el.lang.addEventListener('click', function () { setLang(AQ.i18n.lang === 'ja' ? 'en' : 'ja'); });
    /* 2026-10-16: 右上の「🌐 日本語 / English」。どの画面の上にも出す */
    langButtons().forEach(function (b) {
      b.addEventListener('click', function () { setLang(b.getAttribute('data-l')); });
    });
    syncLangPill();

    // ライブ接続（technocore.chat）
    el.connect.addEventListener('click', function () {
      if (AQ.live.running) {
        AQ.live.stop();
        AQ.hud.setIcon(el.connect, 'ui.connect'); el.connect.classList.remove('live-on');
        el.liveStat.textContent = '';
        setLiveLamp('off', 'stopped');
        if (placesState) renderPlaces(placesState);
        return;
      }
      var room = (el.room.value || 'lobby').trim();
      if (AQ.places) AQ.places.remember(room);
      /* 初見でも追える速さまで落とす。自分で速度を選んでいたらそのまま。 */
      if (!speedTouched) {
        clock.speed = AQ.config.liveSpeed;
        el.speed.value = String(AQ.config.liveSpeed);
      }
      AQ.hud.setIcon(el.connect, 'ui.disconnect'); el.connect.classList.add('live-on');
      liveTotalSkipped = 0;         // 新しい接続＝新しい累計
      liveFollowing = true;
      updateLiveSkipTotalUI();

      /* 最初の1回だけ読み込み直し、以後は後ろに足すだけ。
         ここを run の接頭辞で判定していたため、kibble（run が
         'kibble/…'）では毎回 loadEvents が走り、そのたびに
         再生位置が0に戻っていた。＝速度を落としても効かない、
         という症状の正体。接頭辞ではなく明示的な旗で判定する。 */
      /* 新しい部屋に繋ぐときは、前の部屋で覚えた jobId→題名 を捨てる。 */
      if (AQ.adapters.kibbleForget) AQ.adapters.kibbleForget();
      var firstBatch = true;
      setTimeout(function () { if (placesState) renderPlaces(placesState); }, 0);
      AQ.live.start(room, function (ev) {
        if (firstBatch) { firstBatch = false; loadEvents(ev); if (pendingAgent) focusPendingAgent(); if (pendingWatch) applyPendingWatch(); }
        else appendEventsThrottled(ev);
      }, function (msg) {
        /* つなぐ途中・つながった・つなぎ直し中はランプの色だけで伝える。
           失敗だけは文でも出す（なぜ何も起きないのかが分からなくなるため）。 */
        var m = String(msg || '');
        if (/^failed/i.test(m)) {
          setLiveLamp('err', m); el.liveStat.textContent = m;
          if (pendingAgent) { pendingAgent = null; startError('start.netFail', { msg: m }); }
        }
        else if (/^LIVE/.test(m)) { setLiveLamp('ok', m); el.liveStat.textContent = ''; }
        else { setLiveLamp('wait', m); el.liveStat.textContent = ''; }
      });
    });

    // 準備ゼロの入口：アドレスを貼るだけでそのウォレットの送金を再生する
    function readAddress() {
      var address = (el.addr.value || '').trim();
      var chainId = el.chain.value || AQ.defaultChain;
      el.loadAddr.disabled = true;
      AQ.adapters.chainFetch(address, chainId).then(function (res) {
        stopLiveQuiet();
        loadEvents(res.events);
        el.liveStat.textContent = res.how;
      }, function (err) {
        // 失敗しても、いま再生中のランはそのまま
        el.liveStat.textContent = (err && err.message) || String(err);
      }).then(function () {
        el.loadAddr.disabled = false;
      });
    }
    el.loadAddr.addEventListener('click', readAddress);
    el.addr.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') readAddress();
    });

    // 実データ（.jsonl / .json / .txt）を開く
    el.file.addEventListener('change', function () {
      var f = el.file.files && el.file.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { tryLoad(String(r.result)); };
      r.readAsText(f);
    });

    // ドラッグ＆ドロップ（画面のどこでも）
    window.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    window.addEventListener('drop', function (ev) {
      ev.preventDefault();
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { tryLoad(String(r.result)); };
      r.readAsText(f);
    });

    // Ctrl+V / Cmd+V での貼り付け（部屋名・DID・アドレスの入力欄では素通り）
    window.addEventListener('paste', function (ev) {
      /* 文字を入れる欄への貼り付けは、その欄のためのもの（ログとして読まない） */
      var tg = ev.target, tn = tg && tg.tagName ? tg.tagName.toLowerCase() : '';
      if (tn === 'input' || tn === 'textarea' || (tg && tg.isContentEditable)) return;
      var text = ev.clipboardData && ev.clipboardData.getData('text');
      if (!text) return;
      tryLoad(text);
    });
  }

  /* 外から差し替えたいとき用（アダプタのテスト・Playwright などから） */
  AQ.app = {
    tryLoad: tryLoad,          /* 形式を自動判別して読み込む（D&D・貼り付けと同じ道） */
    loadEvents: loadEvents,
    appendEvents: appendEvents,
    loadRun: loadRun,
    startIntro: startIntro,      /* 「x402ってなに？」（検査・ボタンの両方から） */
    get clock() { return clock; },
    get events() { return allEvents; },
    get beats() { return fullBeats; },              /* ログ全体のコマ列（focus の影響を受けない） */
    get focusActor() { return focusActor; },
    get focusJob() { return focusJob; },
    get jobIndex() { return jobIndex; },
    focusOnJob: handleJobClick,                       /* テスト・自動操作用（実クリックと同じ経路） */
    focusOnAgent: handleAgentClick,                   /* エージェントから入る道（同上） */
    setListMode: setListMode,
    get listMode() { return listMode; },
    get agentFilter() { return agentFilter; },
    get agentIndex() { return agentIndex; },
    get jobStory() { return jobStory; },
    get agentStory() { return agentStory; },
    get hasChosen() { return hasChosen; },            /* task 1: まだ誰も選んでいないか（テスト用） */
    get mode() { return modeNow(); },                 /* 2026-11-05: 札の出し分け（demo / live / log。テスト用） */
    focusOn: handleFocusClick,                        /* テスト・自動操作用（実クリックと同じ経路） */
    focusOnDid: focusByDid,
    watchRoom: watchRoom,                             /* 自分のロボットが書いた部屋を開く（robot.js） */
    showMine: showMine,                               /* 自分のロボットの記録だけを見せる（robot.js） */
    focusClear: focusShowAll,
    jumpToLive: jumpToLive,                           /* 「最新に追いつく」と同じ処理 */
    get liveTotalSkipped() { return liveTotalSkipped; }
  };

  /* 窓の大きさが変わると絵の高さも変わる＝右の列の蓋も測り直す。 */
  window.addEventListener('resize', function () { syncSideColHeight(); applyViewport(true); fitCanvasSoon(); });

  document.addEventListener('DOMContentLoaded', boot);

})(window.AQ = window.AQ || {});
