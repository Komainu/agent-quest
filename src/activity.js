/* =============================================================
   activity.js — ロボットの「一日」を街で見る（2026-10-11）
   -------------------------------------------------------------
   利用者「部屋の中の動きだけ。町で動いているところもみたい」。
   ロボットがしたこと（掲示板への書き込み・x402 のお使い・身分証の書き換え・評価・手紙）を
   このブラウザに順に控え、街の場面（city）としてまとめて再生する。
     ・お使い … 頼む → 402 → 署名して頼みなおす → 確定（チェーン）→ 受け取る（errand.js と同じ）
     ・掲示板・手紙 … technocore.chat の建物へ行って書き込む
     ・身分証・評価 … ERC-8004 の登録先（Identity / Reputation Registry）へ行って取引を送る
   ★ 作り話をしない
     ・控えるのは、成功を確かめた行動だけ（各モジュールが確かめてから add する）
     ・時刻は、そのとき実際に記録した時刻。並べ替えるだけで足さない
     ・郵便受けの部屋名は「知っている人だけが書ける鍵」なので、街の看板や説明には出さない
   ============================================================= */
(function (AQ) {
  'use strict';

  var STORE = 'aq.myAgent.activity';
  var IDENTITY = 'ERC-8004 Identity';      // 街の建物の看板（Base の Identity Registry）
  var REPUTATION = 'ERC-8004 Reputation';  // 同（Reputation Registry）

  function t(k, v) { return AQ.i18n.t(k, v); }
  function mine() { return (AQ.birth && AQ.birth.mine && AQ.birth.mine()) || null; }
  function load() { try { return JSON.parse(localStorage.getItem(STORE) || '[]') || []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(STORE, JSON.stringify(a.slice(-80))); } catch (e) {} }

  function add(entry) {
    if (!entry || !entry.kind) return null;
    entry.id = entry.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    entry.t = entry.t || Date.now();
    var a = load(); a.push(entry); save(a);
    if (AQ.activity.onChange) AQ.activity.onChange();
    return entry.id;
  }

  function actorKey(d) { return 'agent #' + d.agentId + ' (' + d.name + ')'; }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /** 1つの行動 → 街のイベント（run.start / run.end は付けない。まとめる側で付ける） */
  function eventsOf(e, A, RUN) {
    var M = { tSource: 'local', stage: 'city' };
    function ev(type, t, target, extra) { var o = { v: 1, run: RUN, t: t, actor: A, type: type, meta: Object.assign({}, M, (extra && extra.meta) || {}) }; if (target) o.target = target; if (extra) { Object.keys(extra).forEach(function (k) { if (k !== 'meta') o[k] = extra[k]; }); } return o; }
    var t0 = e.t0 || e.t, t1 = Math.max((e.t1 || t0 + 1), t0 + 1);
    switch (e.kind) {
      case 'errand':
        if (!AQ.errand || !AQ.errand._errandEvents) return [];
        return AQ.errand._errandEvents(e.x, mine()).filter(function (x) { return x.type !== 'run.start' && x.type !== 'run.end'; })
          .map(function (x) { x.run = RUN; x.actor = A; x.meta = Object.assign({}, x.meta || {}, { stage: 'city' }); return x; });
      case 'post':
        return [ev('tool.call', t0, 'https://technocore.chat/r/' + e.room, { meta: { act: 'post' } }),
                ev('result.ok', t1, 'https://technocore.chat/r/' + e.room, { status: '200', item: clip(e.text, 80), meta: { seq: e.seq, act: 'post' } })];
      case 'mail-open':
        return [ev('tool.call', t0, 'https://technocore.chat/r/mailbox', { meta: { act: 'mailOpen' } }),
                ev('result.ok', t1, 'https://technocore.chat/r/mailbox', { status: '200', item: t('act.mailOpen'), meta: { act: 'mailOpen' } })];
      case 'mail-send':
        return [ev('tool.call', t0, 'https://technocore.chat/r/mailbox', { meta: { act: 'mailSend' } }),
                ev('result.ok', t1, 'https://technocore.chat/r/mailbox', { status: '200', item: clip(e.text, 80), meta: { act: 'mailSend' } })];
      case 'mail-recv':
        return [ev('tool.call', t0, 'https://technocore.chat/r/mailbox', { meta: { act: 'mailRecv' } }),
                ev('result.ok', t1, 'https://technocore.chat/r/mailbox', { status: '200', item: clip(e.text, 60), meta: { act: 'mailRecv' } })];
      case 'card':
        return [ev('tool.call', t0, IDENTITY, { meta: { act: 'card' } }),
                ev('result.ok', t1, IDENTITY, { status: '200', item: t('act.card'), meta: { tx: e.tx, act: 'card' } })];
      case 'feedback':
        return [ev('tool.call', t0, REPUTATION, { meta: { act: 'feedback' } }),
                ev('result.ok', t1, REPUTATION, { status: '200', item: t('act.feedback', { stars: e.stars, id: e.agentId, name: clip(e.name, 24) }), meta: { tx: e.tx, act: 'feedback' } })];
      default:
        return [];
    }
  }

  /** いくつかの行動を、1本の街の場面にまとめる */
  function eventsFor(list) {
    var d = mine(); if (!d || !list.length) return [];
    var A = actorKey(d), RUN = 'robot-day/' + d.agentId;
    var out = [];
    list.slice().sort(function (a, b) { return (a.t0 || a.t) - (b.t0 || b.t); }).forEach(function (e) { out = out.concat(eventsOf(e, A, RUN)); });
    if (!out.length) return [];
    out.sort(function (a, b) { return a.t - b.t; });
    out.unshift({ v: 1, run: RUN, t: out[0].t - 1, actor: A, type: 'run.start', meta: { tSource: 'local', stage: 'city' } });
    out.push({ v: 1, run: RUN, t: out[out.length - 1].t + 400, actor: A, type: 'run.end', meta: { tSource: 'local', stage: 'city' } });
    return out;
  }

  function watch(list) {
    var d = mine(); if (!d || !AQ.app || !AQ.app.showMine) return false;
    var ev = eventsFor(list); if (!ev.length) return false;
    if (AQ.nick && AQ.nick.setName) AQ.nick.setName(actorKey(d), d.name + ' #' + d.agentId);
    if (AQ.birth) AQ.birth.close('watch');
    AQ.app.showMine(ev, { agent: actorKey(d) });
    return true;
  }
  function watchOne(id) { return watch(load().filter(function (e) { return e.id === id; })); }
  /** 今日（いまから24時間）の行動をまとめて */
  function watchDay() {
    var since = Date.now() - 24 * 3600 * 1000;
    var list = load().filter(function (e) { return (e.t0 || e.t) >= since; });
    if (!list.length) list = load().slice(-12);
    var ok = watch(list);
    if (ok && AQ.quest) AQ.quest.setFlag('town');
    return ok;
  }

  AQ.activity = { add: add, load: load, watchOne: watchOne, watchDay: watchDay, eventsFor: eventsFor, onChange: null,
                  IDENTITY: IDENTITY, REPUTATION: REPUTATION };
})(window.AQ = window.AQ || {});
