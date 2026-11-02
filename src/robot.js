/* =============================================================
   robot.js — 生まれたロボットを掲示板（technocore.chat）に出勤させる（2026-10-11）
   -------------------------------------------------------------
   利用者「このロボットに何かさせる方向で」→「掲示板に出勤」を選択。

   ロボットは自分専用の鍵（Ed25519）を持ち、その鍵の名前（did:key）で署名して書き込む。
   technocore.chat の取り決め（/llms.txt の SIGNING）どおり:
     POST /r/<room> {"did","sig","nonce","text"}
     sig = Ed25519( "<room>|<nonce>|<text>" を UTF-8 ) を base64url（= なし、86文字）
     text は「1行に掃除したあと」の文字（改行などの見えない文字 → 空白、両端を削る）
     nonce は数字。その部屋でその鍵が前に使った数より大きければよい（ミリ秒時計で足りる）
   書き込みは無料（ガス代もお金もかからない）。サーバーは誰の書き込みかを署名で確かめる。

   できること（第1歩）
     ・あいさつ   … lobby に名乗る（llms.txt / skill.md が「最初の一歩」として勧めている部屋）
     ・仕事を頼む … kibble に JOB v1 の行を貼る。kibble ではほかのエージェントが
                    実際に CLAIM（引き受け）・DELIVER（納品）している（2026-10-11 に確認）
     ・名刺       … 最初の書き込みの前に、DID のノート（/kv/did-<2>/<14>）に
                    「ERC-8004 の何番か・持ち主」を書く（llms.txt の IDENTITY の慣習）。
                    ノートは誰でも上書きできる＝証明ではなく自己申告、と画面でも言う。

   ★ 作り話をしない
     ・「貼れた」と言うのは、サーバーが返した記録（posted）が自分の DID・本文・nonce と
       一致したときだけ。
     ・部屋の絵は、その部屋の実際のログを読み直して出す（貼ったはずの行を足したりしない）。
   ★ 鍵
     ロボットの鍵はこのブラウザの中（localStorage）にだけ置く。お金は持たない鍵
     （掲示板での名前にだけ使う）。ウォレットの秘密鍵とは無関係。
   ============================================================= */
(function (AQ) {
  'use strict';

  var BASE = 'https://technocore.chat';
  var KEY_STORE = 'aq.myAgent.key';
  var JOBS_STORE = 'aq.myAgent.jobs';
  var POSTS_STORE = 'aq.myAgent.posts';
  var TITLE_MAX = 120, DETAIL_MAX = 400;
  /* ★ 2026-10-11（利用者「三択＋自由に書く枠に」）: よく使う頼みごとを3つ用意。
     掲示板のエージェントは英語で読むことが多いので、貼るのは英文（画面には日本語の見出し）。
     種類（research / explain）は kibble で実際に使われている言葉から。 */
  var PRESETS = [
    { key: 'x402',    kind: 'explain',  title: 'Explain how x402 payments work in 3 short sentences',
      detail: 'Success: plain words a beginner understands, with one real example' },
    { key: 'erc8004', kind: 'explain',  title: 'Explain what ERC-8004 agent identity is and why it matters',
      detail: 'Success: under 100 words, plain words' },
    { key: 'base',    kind: 'research', title: 'Summarize 3 recent notable things happening on the Base network',
      detail: 'Success: each item has a source link' }
  ];
  var FREE_KIND = 'research';

  function t(k, v) { return AQ.i18n.t(k, v); }
  function $(id) { return document.getElementById(id); }

  /* ---- 文字と符号 ---- */
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58(bytes) {
    var zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    var n = 0n; for (var i = 0; i < bytes.length; i++) n = n * 256n + BigInt(bytes[i]);
    var out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    return '1'.repeat(zeros) + out;
  }
  function b64urlFromBytes(u8) {
    var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function bytesFromB64url(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  /** 公開鍵（32バイト）→ did:key:z6Mk…（multicodec ed25519-pub = 0xed 0x01、base58btc） */
  function didFromPub(raw) {
    var p = new Uint8Array(34); p[0] = 0xed; p[1] = 0x01; p.set(raw, 2);
    return 'did:key:z' + base58(p);
  }
  /** サーバーと同じ掃除（Cc Cf Cs Co Zl Zp → 空白、両端を削る）。署名はこのあとの文字に対して。 */
  var INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;
  function sweep(s) { return String(s == null ? '' : s).replace(INVISIBLE, ' ').trim(); }
  /** kibble の欄に入れる文字：1行に掃除し、区切りの | は / にする（欄がずれないように） */
  function field(s, max) { return Array.from(sweep(s).replace(/\|/g, '/')).slice(0, max).join(''); }
  var lastNonce = 0;
  function nextNonce() { lastNonce = Math.max(Date.now(), lastNonce + 1); return String(lastNonce); }

  function supported() {
    return typeof window !== 'undefined' && !!window.isSecureContext && !!(window.crypto && crypto.subtle);
  }

  /* ---- ロボットの鍵（このブラウザの中だけ） ---- */
  var keyP = null;
  function loadOrMakeKey() {
    if (keyP) return keyP;
    keyP = Promise.resolve().then(function () {
      if (!supported()) { var e = new Error('no crypto'); e.aq = 'robot.noCrypto'; throw e; }
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem(KEY_STORE) || 'null'); } catch (e) {}
      if (saved && saved.d && saved.x) {
        return crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', d: saved.d, x: saved.x, ext: true },
          { name: 'Ed25519' }, false, ['sign']).then(function (priv) {
          return { did: didFromPub(bytesFromB64url(saved.x)), priv: priv, fresh: false };
        });
      }
      return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']).then(function (kp) {
        return crypto.subtle.exportKey('jwk', kp.privateKey).then(function (jwk) {
          var did = didFromPub(bytesFromB64url(jwk.x));
          try { localStorage.setItem(KEY_STORE, JSON.stringify({ d: jwk.d, x: jwk.x, did: did })); } catch (e) {}
          return { did: did, priv: kp.privateKey, fresh: true };
        });
      });
    }).catch(function (e) {
      keyP = null;
      if (!e.aq) e.aq = 'robot.noCrypto';
      throw e;
    });
    return keyP;
  }
  function savedDid() {
    try { var s = JSON.parse(localStorage.getItem(KEY_STORE) || 'null'); return s && s.did || null; } catch (e) { return null; }
  }

  function signText(priv, payload) {
    return crypto.subtle.sign('Ed25519', priv, new TextEncoder().encode(payload)).then(function (sig) {
      return b64urlFromBytes(new Uint8Array(sig));
    });
  }

  function firstLine(s) { return String(s || '').split('\n')[0].slice(0, 140); }

  /** 署名して1行書き込む。サーバーが返した記録が自分のものと一致したら、その記録を返す。 */
  function say(room, text) {
    var body = sweep(text);
    return loadOrMakeKey().then(function (k) {
      var nonce = nextNonce();
      return signText(k.priv, room + '|' + nonce + '|' + body).then(function (sig) {
        return fetch(BASE + '/r/' + room + '?format=json', {
          method: 'POST', mode: 'cors',
          headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
          body: JSON.stringify({ did: k.did, sig: sig, nonce: nonce, text: body })
        }).then(function (r) {
          return r.text().then(function (txt) {
            if (!r.ok) {
              var e = new Error(firstLine(txt) || ('HTTP ' + r.status)); e.status = r.status;
              e.aq = r.status === 422 ? 'robot.dupe' : (r.status === 429 ? 'robot.busy' : 'robot.refused');
              throw e;
            }
            var j = null; try { j = JSON.parse(txt); } catch (e2) {}
            var p = j && j.posted;
            if (!p || p.from !== k.did || p.text !== body || String(p.nonce) !== nonce || !(p.seq > 0)) {
              var e3 = new Error('posted record mismatch'); e3.aq = 'robot.unconfirmed'; throw e3;
            }
            return { did: k.did, seq: p.seq, room: room, text: body, ts: p.ts, sig: p.sig };
          });
        });
      });
    });
  }

  /** DID の名刺（ノート）。誰でも上書きできる自己申告。失敗しても書き込み自体は続ける。 */
  function publishCard(d) {
    return loadOrMakeKey().then(function (k) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(k.did)).then(function (h) {
        var hex = Array.from(new Uint8Array(h)).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('').slice(0, 16);
        var reg = (AQ.birth && AQ.birth.REGISTRY) || '';
        /* ★ 2026-10-11: technocore の慣習（/patterns.md の 3）どおり、先頭に自分の did:key、
           郵便受けがあれば mailbox:<部屋名>。そのあとに ERC-8004 の番号などの自己申告。 */
        var mb = '';
        try { mb = localStorage.getItem('aq.myAgent.mailbox') || ''; } catch (e) {}
        var value = sweep(k.did + (mb ? ' mailbox:' + mb : '') + ' erc8004:eip155:' + (d.chain || 8453) + ':' + reg + ':' + d.agentId +
          ' owner:' + d.owner + ' app:agent-quest name:' + d.name);
        return fetch(BASE + '/kv/did-' + hex.slice(0, 2) + '/' + hex.slice(2), {
          method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ value: value })
        }).then(function (r) { return r.ok; });
      });
    }).catch(function () { return false; });
  }

  function loadJobs() { try { return JSON.parse(localStorage.getItem(JOBS_STORE) || '[]') || []; } catch (e) { return []; } }
  function saveJob(j) { var a = loadJobs(); a.push(j); try { localStorage.setItem(JOBS_STORE, JSON.stringify(a.slice(-20))); } catch (e) {} }
  function newJobId() {
    var b = new Uint8Array(5); crypto.getRandomValues(b);
    return 'k' + Array.from(b).map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }

  /* ---- 画面 ---- */
  var ui = { busy: false, last: null, carded: false };
  function agent() { return (AQ.birth && AQ.birth.mine && AQ.birth.mine()) || null; }
  function status(key, vars, kind) {
    var el = $('robotStatus'); if (!el) return;
    el.textContent = key ? t(key, vars) : '';
    el.className = 'birth-status' + (kind ? ' ' + kind : '');
  }
  function sync() {
    ['robotHello', 'robotJobOpen', 'robotJobsOpen', 'robotRepOpen'].forEach(function (id) { if ($(id)) $(id).disabled = ui.busy; });
    Array.prototype.forEach.call(document.querySelectorAll('#robotJobsList button'), function (b) { b.disabled = ui.busy; });
    if ($('robotJobGo')) $('robotJobGo').disabled = ui.busy || !currentJob();
    /* 「部屋で見る」は、今回書いたか、前に書いた記録があれば出す */
    if ($('robotWatch')) $('robotWatch').hidden = !(ui.last || loadPosts().length);
    if ($('robotTown')) $('robotTown').hidden = !(AQ.activity && AQ.activity.load().length);
  }
  function nameTag(d) { return d.name + ' #' + d.agentId; }
  function rememberName(did, d) { if (did && d && AQ.nick && AQ.nick.setName) AQ.nick.setName(did, nameTag(d)); }

  function run(room, text, onDone) {
    var d = agent();
    if (!d || ui.busy) return;
    ui.busy = true; ui.last = null; sync();
    status('robot.signing');
    var tStart = Date.now();
    var first = ui.carded ? Promise.resolve(true) : publishCard(d).then(function (ok) { ui.carded = ok; return ok; });
    first.then(function () {
      status('robot.posting', { room: room });
      return say(room, text);
    }).then(function (res) {
      rememberName(res.did, d);
      addPosts([{ room: res.room, seq: res.seq, from: res.did, text: res.text, ts: res.ts, sig: res.sig }]);
      if (AQ.activity && !/^mb-/.test(res.room) && !/^p-/.test(res.room)) AQ.activity.add({ kind: 'post', t0: tStart, t1: Date.now(), room: res.room, text: res.text, seq: res.seq });
      ui.last = res;
      if (onDone) onDone(res);
      showDid();
    }).catch(function (e) {
      status((e && e.aq) || 'robot.failed', { msg: (e && e.message) || '' }, 'bad');
    }).then(function () { ui.busy = false; sync(); });
  }

  function hello() {
    var d = agent(); if (!d) return;
    var owner = String(d.owner || ''); owner = owner.slice(0, 6) + '…' + owner.slice(-4);
    var text = 'hello from ' + d.name + ' (ERC-8004 agent #' + d.agentId + ' on Base, owner ' + owner + ') - born in Agent Quest';
    run('lobby', text, function (res) {
      res.watch = { agent: res.did };
      status('robot.helloDone', { seq: res.seq }, 'good');
    });
  }

  var choice = PRESETS[0].key;   // いま選んでいる頼みごと（'free' = 自分で書く）
  function pickChoice(key) {
    choice = key;
    Array.prototype.forEach.call(document.querySelectorAll('#robotChoices .robot-choice'), function (b) {
      var on = b.getAttribute('data-key') === key;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if ($('robotFree')) $('robotFree').hidden = key !== 'free';
    if (key === 'free' && $('robotJobTitle')) $('robotJobTitle').focus();
    sync();
  }
  function currentJob() {
    if (choice === 'free') {
      var title = field($('robotJobTitle') && $('robotJobTitle').value, TITLE_MAX);
      return title ? { kind: FREE_KIND, title: title, detail: '' } : null;
    }
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === choice) return PRESETS[i];
    return null;
  }

  function postJob() {
    var j = currentJob();
    if (!j) return;
    var id = newJobId();
    var text = 'JOB v1 | ' + id + ' | ' + j.kind + ' | ' + field(j.title, TITLE_MAX) + ' | ' + field(j.detail, DETAIL_MAX);
    run('kibble', text, function (res) {
      res.watch = { job: id, agent: res.did };
      saveJob({ id: id, kind: j.kind, title: j.title, key: j.key || null, seq: res.seq, t: Date.now() });
      startTrack(res.did);
      if ($('robotJobTitle')) $('robotJobTitle').value = '';
      $('robotJobForm').hidden = true;
      status('robot.jobDone', { seq: res.seq }, 'good');
    });
  }

  /* ---- 自分のロボットの記録（書き込みと、出した仕事への返事）---- */
  function loadPosts() { try { return JSON.parse(localStorage.getItem(POSTS_STORE) || '[]') || []; } catch (e) { return []; } }
  function addPosts(list) {
    var a = loadPosts(), have = {};
    a.forEach(function (m) { have[m.room + '#' + m.seq] = true; });
    list.forEach(function (m) { if (!have[m.room + '#' + m.seq]) { a.push(m); have[m.room + '#' + m.seq] = true; } });
    a.sort(function (x, y) { return x.room === y.room ? x.seq - y.seq : (x.room < y.room ? -1 : 1); });
    try { localStorage.setItem(POSTS_STORE, JSON.stringify(a.slice(-300))); } catch (e) {}
    return a;
  }
  function eventsFor(room) {
    var msgs = loadPosts().filter(function (m) { return m.room === room; })
      .map(function (m) { var o = { seq: m.seq, from: m.from, text: m.text }; if (m.ts) o.ts = m.ts; if (m.did) o.did = m.did; if (m.sig) o.sig = m.sig; return o; });
    if (!msgs.length) return [];
    var ev;
    if (room === 'kibble') {
      if (AQ.adapters.kibbleForget) AQ.adapters.kibbleForget(room);
      ev = AQ.adapters.fromKibble(msgs, { room: room, observedAt: Date.now() });
    } else ev = AQ.adapters.fromTechnocore(msgs, { room: room, observedAt: Date.now() });
    /* 読み込みの始まり・終わり（見ている人＝observer）は、自分のロボットの出勤・退勤として見せる
       （ほかの子を1体も混ぜない。時刻や中身はそのまま） */
    var did = savedDid();
    if (did) ev.forEach(function (e) { if (e.actor === 'observer') e.actor = did; });
    return ev;
  }

  /* 出した仕事への返事（CLAIM / DELIVER / RESULT / ATTEST で、その仕事の番号を名指しした行）だけを拾う。
     kibble は1分に何十行も流れるので、番号で絞る。拾った行はそのまま（書き換えない）。 */
  var track = { timer: null, cursor: 0, did: null, until: 0, missed: 0, gen: 0, running: false };
  function myJobIds() { var o = {}; loadJobs().forEach(function (j) { o[j.id] = true; }); return o; }
  function replyTo(text, ids) {
    var m = String(text || '').match(/^(CLAIM|DELIVER|RESULT|ATTEST) v1 \| ([^|\s]+)/);
    return m && ids[m[2]] ? m[2] : null;
  }
  function stillMine() {
    if (AQ.live && AQ.live.running) return false;          // 部屋全体の LIVE に切り替えた
    var ev = (AQ.app && AQ.app.events) || [];
    for (var i = 0; i < ev.length; i++) if (String(ev[i].actor) === track.did) return true;
    return false;
  }
  function stopTrack() { if (track.timer) { clearTimeout(track.timer); track.timer = null; } track.running = false; track.gen++; }
  /* ★ 2026-10-11 直し: technocore の since= は「その番号より後の、新しいほうから最大200件」を返す
     （実測: since=最新-1000, limit=200 → 最新の200件だけ。古いほうへはさかのぼれない）。
     kibble は1分に100件ほど流れるので、窓を開いていなくても、頼んだ仕事がまだ動いている間
     （貼ってから2時間）は、4秒ごとに読んで返事を控えておく。見逃した区間があれば数えておく。 */
  /* ★ 2026-10-11 総点検: 読みに行っている途中で startTrack が呼ばれると、追いかけが2本になり、
     同じ返事が2回足されていた。何本目の追いかけかの番号（gen）で、古い追いかけを止める。 */
  function pollReplies(gen) {
    if (gen !== track.gen) return;
    track.timer = null;
    if (Date.now() > track.until) { track.running = false; return; }
    var ids = myJobIds();
    fetch(BASE + '/r/kibble?format=json&limit=200&since=' + track.cursor, { mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : { messages: [] }; })
      .then(function (j) {
        var msgs = (j && j.messages) || [];
        if (j && j.first_seq && track.cursor && j.first_seq > track.cursor + 1) track.missed += j.first_seq - track.cursor - 1;
        var got = [];
        if (gen !== track.gen) return;
        msgs.forEach(function (m) {
          if (m.seq > track.cursor) track.cursor = m.seq;
          if (m.from !== track.did && replyTo(m.text, ids)) got.push({ room: 'kibble', seq: m.seq, from: m.from, text: m.text, ts: m.ts, sig: m.sig });
        });
        if (got.length) {
          addPosts(got);
          if (stillMine() && AQ.app.appendEvents) {
            AQ.app.appendEvents(AQ.adapters.fromKibble(got.map(function (m) { return { seq: m.seq, from: m.from, text: m.text, ts: m.ts, sig: m.sig }; }),
              { room: 'kibble', observedAt: Date.now() }).filter(function (e) { return e.type !== 'run.start' && e.type !== 'run.end'; }));
          }
        }
        if (gen === track.gen) track.timer = setTimeout(function () { pollReplies(gen); }, 4000);
      })
      .catch(function () { if (gen === track.gen) track.timer = setTimeout(function () { pollReplies(gen); }, 8000); });
  }
  function startTrack(did) {
    did = did || savedDid();
    var recent = loadJobs().filter(function (j) { return j.t && Date.now() - j.t < 2 * 3600 * 1000; });
    if (!did || !recent.length) return;
    var posts = loadPosts().filter(function (m) { return m.room === 'kibble'; });
    var last = posts.length ? posts[posts.length - 1].seq : 0;
    var first = Math.min.apply(null, recent.map(function (j) { return j.seq || 0; }));
    track.until = Math.max.apply(null, recent.map(function (j) { return j.t; })) + 2 * 3600 * 1000;   // いつも計算しなおす
    if (track.running && track.did === did) return;                                                    // もう追いかけている
    track.did = did; track.cursor = Math.max(track.cursor || 0, first, last); track.missed = track.missed || 0;
    track.running = true; track.gen++;
    pollReplies(track.gen);
  }

  /* =============================================================
     ★ 2026-10-11 依頼主の仕上げ（利用者が選択）
     kibble の決まり（kibble.world/llms.txt と kibble.world の画面のつくり）:
       ・依頼主（Poster）は、納品のあとに「受け取る（Accept）」か「だめ」を付けられる
       ・その行は ATTEST v1 | <job_id> | useful|not | rh:<result_hash> | <理由1文>
         （kibble.world の画面の「Accept」ボタンも、依頼主が出す ATTEST useful と同じ行）
       ・result_hash は https://kibble.world/api/board の jobs[].result_hash
       ・決まり文句の理由は数えられないことがある。「だめ」には理由が必須
     評判（スコア）は https://kibble.world/api/score?did=<did> がそのまま返す数字だけを出す。
     ============================================================= */
  var KIBBLE = 'https://kibble.world';
  var JUDGED_STORE = 'aq.myAgent.judged';
  /* 掲示板（kibble）は英語でやりとりする決まりなので、送る文は英語。画面には表示言語の言い方で出す（robot.reason.*） */
  var REASONS = {
    useful: [{ k: 'clear', en: 'Meets the success condition: clear, correct and in plain words' },
             { k: 'exact', en: 'Answers exactly what was asked, with a usable example' }],
    not:    [{ k: 'missing', en: 'Does not meet the success condition: the answer is missing or off-topic' },
             { k: 'thin', en: 'Too thin or templated to check against the success condition' }]
  };
  var board = { at: 0, byId: {}, p: null };
  function loadBoard(force) {
    if (!force && board.p && Date.now() - board.at < 15000) return board.p;
    board.p = fetch(KIBBLE + '/api/board', { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var by = {};
      ((j && j.jobs) || []).forEach(function (x) { if (x && x.job_id) by[x.job_id] = x; });
      board.byId = by; board.at = Date.now();
      return by;
    }).catch(function (e) { board.p = null; throw e; });
    return board.p;
  }
  function loadJudged() { try { return JSON.parse(localStorage.getItem(JUDGED_STORE) || '{}') || {}; } catch (e) { return {}; } }
  function saveJudged(id, v) { var o = loadJudged(); o[id] = v; try { localStorage.setItem(JUDGED_STORE, JSON.stringify(o)); } catch (e) {} }
  function short(did) { did = String(did || ''); var m = did.match(/^did:key:(.+)$/); var b = m ? m[1] : did; return b.length > 12 ? b.slice(0, 6) + '…' + b.slice(-4) : b; }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /** 自分の判定（ボードに載っていればそれ、無ければこのブラウザの控え） */
  function myVerdict(job, did) {
    var a = ((job && job.attestations) || []).filter(function (x) { return x && x.did === did; })[0];
    if (a) return a.verdict === 'useful' ? 'useful' : 'not';
    return loadJudged()[job.job_id] || null;
  }

  /* ★ 2026-10-16 kibble.world の一覧（最近の約80件）から外れた仕事でも、ロボットが掲示板で
     控えていた納品（DELIVER / RESULT の行・本人の署名つき）があれば、それを判定できるようにする。
     控えにあるのは行の文だけ。result_hash は分からないので rh: は付けない（作らない）。 */
  function localJob(lj, did) {
    var hit = null;
    loadPosts().forEach(function (m) {
      if (!m || m.room !== 'kibble' || (did && m.from === did)) return;
      var r = String(m.text || '').match(/^(?:DELIVER|RESULT) v1 \| ([^|\s]+) \| ([\s\S]+)$/);
      if (r && r[1] === lj.id && r[2].trim()) hit = { job_id: lj.id, status: 'delivered', result: r[2].trim(), worker_did: m.from, attestations: [], local: true };
    });
    return hit;
  }
  /** 一覧を描き直し、判定できる数などを返す（クエスト帳の案内に使う） */
  /** 頼んだ仕事の題名。決まった3択から頼んだものは表示言語の言い方で出す（掲示板には英語で貼ってある） */
  function jobTitle(lj) {
    var p = PRESETS.filter(function (x) { return x.key === lj.key || x.title === lj.title; })[0];
    return p ? t('robot.pick.' + p.key) : lj.title;
  }
  function renderJobs() {
    var box = $('robotJobsList');
    var jobs = loadJobs().slice().reverse().slice(0, 6);
    var sum = { total: jobs.length, judgeable: 0, waiting: 0, missing: 0, judged: 0, fail: false };
    if (!box) return Promise.resolve(sum);
    box.innerHTML = '';
    if (!jobs.length) { box.appendChild(mk('p', 'robot-empty', t('robot.jobs.none'))); return Promise.resolve(sum); }
    box.appendChild(mk('p', 'robot-empty', t('robot.jobs.loading')));
    var did = savedDid();
    return loadBoard(false).then(function (by) {
      box.innerHTML = '';
      var rows = jobs.map(function (lj) { return { lj: lj, job: by[lj.id] || localJob(lj, did) }; });
      rows.forEach(function (r) {
        var job = r.job, st = job ? String(job.status || 'open') : 'missing';
        if (!job) sum.missing++;
        else if (myVerdict(job, did)) sum.judged++;
        else if (job.result && ['delivered', 'attested', 'rejected'].indexOf(st) >= 0) { sum.judgeable++; r.judgeable = true; }
        else sum.waiting++;
      });
      /* ★ 2026-10-19「1画面に1ステップ」：② 判定する に進んだ仕事があれば、その1枚だけを出す（ほかの仕事は ◀ で戻ると出る） */
      var focus = rows.filter(function (r) { return r.judgeable && judgeStep[r.job.job_id] === 'judge'; })[0];
      if (focus) { box.appendChild(jobCard(focus.lj, focus.job, did)); return sum; }
      /* ★ 2026-10-19 判定のクエストは1件でクリア（利用者「やはり一件だけでよい」）。判定した仕事があれば、
         それ（いちばん新しいもの）だけを出し、ほかの仕事は「くわしく」に畳む（判定するかは任意） */
      var judged = rows.filter(function (r) { return r.job && myVerdict(r.job, did); })[0];
      if (!judged) { rows.forEach(function (r) { box.appendChild(jobCard(r.lj, r.job, did)); }); return sum; }
      box.appendChild(jobCard(judged.lj, judged.job, did));
      var rest = rows.filter(function (r) { return r !== judged; });
      if (rest.length) {
        var det = mk('details', 'robot-more-info robot-jobs-rest');
        det.appendChild(mk('summary', null, t('robot.jobs.rest', { n: rest.length })));
        rest.forEach(function (r) { det.appendChild(jobCard(r.lj, r.job, did)); });
        box.appendChild(det);
      }
      return sum;
    }, function (e) {
      box.innerHTML = '';
      box.appendChild(mk('p', 'robot-empty bad', t('robot.jobs.netFail', { msg: (e && e.message) || '' })));
      sum.fail = true;
      return sum;
    });
  }

  /* ★ 2026-10-19 判定は2段階（利用者「ごちゃごちゃしている。納品までで窓を分けては」）：
     ① 届いた納品を読む → 「判定へ進む」 → ② 判定する（理由と、受け取る／だめ だけ）。
     どちらの段階にいるかは仕事ごとに覚える（一覧を描き直しても戻らない）。 */
  var judgeStep = {};   // job_id → 'judge'（無ければ ①読む）
  function goStep(jobId, step) {
    if (step) judgeStep[jobId] = step; else delete judgeStep[jobId];
    renderJobs().then(function () {
      var el = document.querySelector('[data-job-card="' + jobId + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
    });
  }
  function stepTag(n, key) { return mk('p', 'robot-step', t('robot.step', { n: n }) + ' ' + t(key)); }

  function jobCard(lj, job, did) {
    var card = mk('div', 'robot-job');
    if (job && job.job_id) card.setAttribute('data-job-card', job.job_id);
    var head = mk('div', 'robot-job-head');
    var tb = mk('b', null, jobTitle(lj)); if (tb.textContent === lj.title && !PRESETS.some(function (x) { return x.title === lj.title; })) tb.setAttribute('data-user', '');   // 自分で書いた題名はそのまま
    head.appendChild(tb);
    var st = job ? String(job.status || 'open') : 'missing';
    /* ★ 2026-10-19 自分が判定したのに、kibble の一覧がまだ「納品ずみ・判定待ち」のままで紛らわしかった（利用者の報告）。
       自分の判定があれば、それを札に出す */
    var mv = job ? myVerdict(job, did) : null;
    if (mv) head.appendChild(mk('span', 'robot-job-st st-' + (mv === 'useful' ? 'attested' : 'rejected'), t(mv === 'useful' ? 'robot.st.mineOk' : 'robot.st.mineNg')));
    else head.appendChild(mk('span', 'robot-job-st st-' + st, t('robot.st.' + (['open', 'claimed', 'delivered', 'attested', 'rejected'].indexOf(st) >= 0 ? st : 'missing'))));
    card.appendChild(head);
    /* ★ 2026-10-19 同じ題名で何度か頼むと、見分けが付かずに「同じものが2回出ている」ように
       見えた（利用者の報告）。頼んだ日時と仕事の番号を添えて、別の仕事だと分かるようにする。 */
    var when = '';
    if (lj.t) { var d = new Date(lj.t); when = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
    card.appendChild(mk('small', 'robot-job-sub robot-job-id', t('robot.jobs.idLine', { when: when || '—', id: String(lj.id || '').slice(0, 7) })));
    if (!job) { card.appendChild(mk('small', 'robot-job-sub', t('robot.jobs.notOnBoard'))); return card; }
    var who = job.worker_did || job.worker_nick;
    var judgeable = !!(job.result && ['delivered', 'attested', 'rejected'].indexOf(st) >= 0 && !myVerdict(job, did));
    if (judgeable && judgeStep[job.job_id] === 'judge') {
      /* ② 判定する：読んだ納品は1行で示すだけ */
      card.appendChild(stepTag(2, 'robot.step.judge'));
      card.appendChild(mk('p', 'robot-job-sub', t('robot.judge.of', { who: who ? short(who) : '?' })));
      var back = mk('button', 'robot-more', t('robot.step.back')); back.type = 'button';
      back.addEventListener('click', function () { goStep(job.job_id, null); });
      card.appendChild(back);
      card.appendChild(judgeUI(job));
      return card;
    }
    if (judgeable) card.appendChild(stepTag(1, 'robot.step.read'));
    if (who) card.appendChild(mk('small', 'robot-job-sub', t('robot.jobs.worker', { who: short(who) })));
    var att = (job.attestations || []).filter(function (a) { return a && a.did !== did; });
    var ok = att.filter(function (a) { return a.verdict === 'useful'; }).length, ng = att.length - ok;
    if (att.length) card.appendChild(mk('small', 'robot-job-sub', t('robot.jobs.others', { ok: ok, ng: ng })));
    if (job.result) {
      var res = mk('div', 'robot-job-result');
      res.appendChild(mk('span', 'robot-job-lbl', t('robot.jobs.result')));
      var txt = String(job.result);
      var body = mk('p', 'robot-job-text', txt.length > 280 ? txt.slice(0, 280) + '…' : txt);   // 他のエージェントの文＝ただの文字として出す（訳さない＝作り話をしない）
      body.setAttribute('data-foreign', ''); body.setAttribute('translate', 'no');
      res.appendChild(body);
      if (txt.length > 280) {
        var more = mk('button', 'robot-more', t('robot.jobs.more')); more.type = 'button';
        more.addEventListener('click', function () { body.textContent = txt; more.remove(); });
        res.appendChild(more);
      }
      res.appendChild(mk('small', 'robot-job-warn', t('robot.jobs.untrusted')));   // 本文のすぐ下に1行
      var trBar = mk('div', 'tr-bar'); res.appendChild(trBar);
      if (AQ.translate) AQ.translate.decorate([{ text: txt, after: body }], trBar);   // 日本語の表示では訳を添える（原文はそのまま）
      card.appendChild(res);
    }
    /* 一覧から外れた控えの説明は技術的なので、たたんでおく */
    if (job.local) {
      var det = mk('details', 'robot-more-info');
      det.appendChild(mk('summary', null, t('robot.jobs.localMore')));
      det.appendChild(mk('small', 'robot-job-warn', t('robot.jobs.local')));
      card.appendChild(det);
    }
    var mine = myVerdict(job, did);
    if (mine) { card.appendChild(mk('p', 'robot-job-mine ' + mine, t(mine === 'useful' ? 'robot.jobs.mineOk' : 'robot.jobs.mineNg'))); return card; }
    if (judgeable) {
      var go = mk('button', 'go robot-step-go', t('robot.step.next')); go.type = 'button';
      go.addEventListener('click', function () { goStep(job.job_id, 'judge'); });
      card.appendChild(go);
    }
    else if (st === 'open' || st === 'claimed') card.appendChild(mk('small', 'robot-job-sub', t('robot.jobs.wait')));
    return card;
  }

  function judgeUI(job) {
    var wrap = mk('div', 'robot-judge');
    wrap.appendChild(mk('span', 'robot-job-lbl', t('robot.judge.q')));
    var input = mk('input'); input.type = 'text'; input.maxLength = 200; input.placeholder = t('robot.judge.ph');
    var chips = mk('div', 'robot-chips robot-reasons');
    var picked = null;   // 選んだ決まり文句（送るのは英語の文）
    ['useful', 'not'].forEach(function (v) {
      REASONS[v].forEach(function (r) {
        var c = mk('button', 'robot-chip ' + v, (v === 'useful' ? '👍 ' : '👎 ') + t('robot.reason.' + r.k)); c.type = 'button';
        c.setAttribute('aria-pressed', 'false');
        c.addEventListener('click', function () {
          picked = picked === r ? null : r;
          Array.prototype.forEach.call(chips.children, function (x) { var on = x === c && picked === r; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
          if (picked) input.value = '';
        });
        chips.appendChild(c);
      });
    });
    input.addEventListener('input', function () { if (input.value) { picked = null; Array.prototype.forEach.call(chips.children, function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); } });
    wrap.appendChild(chips);
    wrap.appendChild(mk('small', 'robot-job-sub', t('robot.judge.own')));
    wrap.appendChild(input);
    wrap.appendChild(mk('small', 'robot-job-warn', t('robot.judge.hint')));
    var row = mk('div', 'robot-acts');
    var yes = mk('button', 'go robot-yes', t('robot.judge.yes')); yes.type = 'button';
    var no = mk('button', 'ghost birth-wallet robot-no', t('robot.judge.no')); no.type = 'button';
    yes.addEventListener('click', function () { judge(job, 'useful', input.value || (picked && picked.en) || ''); });
    no.addEventListener('click', function () { judge(job, 'not', input.value || (picked && picked.en) || ''); });
    row.appendChild(yes); row.appendChild(no);
    wrap.appendChild(row);
    return wrap;
  }

  function judge(job, verdict, reasonRaw) {
    var reason = field(reasonRaw, 300);
    if (!reason) { status('robot.judge.needReason', null, 'bad'); return; }
    var rh = String(job.result_hash || '').replace(/[^0-9a-f]/gi, '');
    var line = 'ATTEST v1 | ' + job.job_id + ' | ' + verdict + ' | ' + (rh ? 'rh:' + rh + ' | ' : '') + reason;
    run('kibble', line, function (res) {
      res.watch = { job: job.job_id, agent: res.did };
      saveJudged(job.job_id, verdict);
      delete judgeStep[job.job_id];
      status(verdict === 'useful' ? 'robot.judge.doneOk' : 'robot.judge.doneNg', { seq: res.seq }, 'good');
      board.at = 0;
      renderJobs();
    });
  }

  /* ---- 評判（kibble のスコア）---- */
  var TERMS = ['jobs_posted', 'results_delivered', 'useful_attestations_received', 'poster_accepts_received',
               'not_useful_attestations_received', 'attestations_given'];
  function renderRep() {
    var box = $('robotRepBody'); if (!box) return;
    var did = savedDid();
    box.innerHTML = '';
    if (!did) { box.appendChild(mk('p', 'robot-empty', t('robot.rep.noKey'))); return; }
    box.appendChild(mk('p', 'robot-empty', t('robot.jobs.loading')));
    fetch(KIBBLE + '/api/score?did=' + encodeURIComponent(did), { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      box.innerHTML = '';
      var top = mk('div', 'robot-rep-top');
      top.appendChild(mk('b', 'robot-rep-score', String(j.score != null ? j.score : 0)));
      top.appendChild(mk('span', null, j.found && j.rank ? t('robot.rep.rank', { rank: j.rank }) : t('robot.rep.notYet')));
      box.appendChild(top);
      var terms = (j.breakdown && j.breakdown.terms) || {};
      var ul = mk('ul', 'robot-rep-terms');
      TERMS.forEach(function (k) {
        var x = terms[k]; if (!x) return;
        var li = mk('li', x.points < 0 ? 'neg' : (x.count ? '' : 'zero'));
        li.appendChild(mk('span', null, t('robot.rep.t.' + k)));
        li.appendChild(mk('b', null, x.count + ' × ' + x.weight + ' = ' + x.points));
        ul.appendChild(li);
      });
      box.appendChild(ul);
      var b = j.breakdown || {};
      if (b.own_terms_quarantined || (b.own_actions != null && b.quarantine_own_actions != null && b.own_actions < b.quarantine_own_actions)) {
        box.appendChild(mk('small', 'robot-job-warn', t('robot.rep.quarantine', { n: b.own_actions || 0, need: b.quarantine_own_actions || 3 })));
      }
      box.appendChild(mk('small', 'robot-job-warn', t('robot.rep.note')));
    }, function (e) {
      box.innerHTML = '';
      box.appendChild(mk('p', 'robot-empty bad', t('robot.jobs.netFail', { msg: (e && e.message) || '' })));
    });
  }

  function togglePanel(id, render) {
    ['robotJobForm', 'robotJobs', 'robotRep', 'robotErrand', 'robotCard', 'robotFeedback', 'robotMail', 'robotMemo', 'robotDeal'].forEach(function (x) { if (x !== id && $(x)) $(x).hidden = true; });
    var el = $(id); if (!el) return;
    el.hidden = !el.hidden;
    if (!el.hidden && render) render();
  }

  function watch() {
    var room = ui.last ? ui.last.room : (loadJobs().length ? 'kibble' : 'lobby');
    var did = savedDid();
    var ev = eventsFor(room);
    if (!ev.length || !AQ.app || !AQ.app.showMine) return;
    if (AQ.birth) AQ.birth.close('watch');
    /* ★ 2026-10-19: ページを開き直すと ui.last が消え、「エージェント（自分のロボット）を見る」
       モードで始まっていた。このモードは本人のコマだけを再生するので、仕事を引き受けた
       ほかのエージェントが出てこなかった（利用者の報告）。kibble では、ほかのエージェントの
       返事が届いている最新の仕事を「仕事を見る」モードで開く（無ければ最新の仕事）。 */
    var w = (ui.last && ui.last.watch) || null;
    if (!w && room === 'kibble') {
      var jobs = loadJobs(), pick = null;
      for (var i = jobs.length - 1; i >= 0 && !pick; i--) {
        var jid = jobs[i] && jobs[i].id;
        if (jid && ev.some(function (e) { return e.meta && e.meta.job === jid && String(e.actor) !== String(did); })) pick = jid;
      }
      if (!pick && jobs.length) pick = jobs[jobs.length - 1].id;
      if (pick) w = { job: pick, agent: did };
    }
    w = w || { agent: did };
    AQ.app.showMine(ev, w);
    if (room === 'kibble') startTrack(did);
  }

  function showDid() {
    var el = $('robotDid'); if (!el) return;
    var did = savedDid();
    el.textContent = did ? t('robot.didIs', { did: did.slice(8, 14) + '…' + did.slice(-4) }) : t('robot.didNone');
    el.title = did || '';
  }

  function relabel() {
    var map = { robotTitle: 'robot.title', robotLead: 'robot.lead', robotHello: 'robot.hello', robotJobOpen: 'robot.jobOpen',
                robotJobsOpen: 'robot.jobsOpen', robotRepOpen: 'robot.repOpen', robotJobsTitle: 'robot.jobs.title', robotRepTitle: 'robot.rep.title',
                robotTown: 'robot.town', robotPickLbl: 'robot.pickLbl', robotHint: 'robot.hint', robotJobGo: 'robot.jobGo', robotJobStep2: 'robot.jobStep2', robotWatch: 'robot.watch', robotNote: 'robot.note' };
    Object.keys(map).forEach(function (id) { if ($(id)) $(id).textContent = t(map[id]); });
    Array.prototype.forEach.call(document.querySelectorAll('#robotChoices .robot-choice'), function (b) {
      var k = b.getAttribute('data-key'), p = null;
      PRESETS.forEach(function (x) { if (x.key === k) p = x; });
      b.querySelector('b').textContent = t('robot.pick.' + k);
      b.querySelector('small').textContent = p ? t('robot.pickSub.' + p.key) : t('robot.pick.freeSub');
    });
    if ($('robotJobTitle')) $('robotJobTitle').placeholder = t('robot.titlePh');
    showDid();
    sync();
  }

  /** 生まれた子がいるときだけ、窓の中に「ロボットに頼む」を出す。 */
  function refresh() {
    var box = $('robotBox'); if (!box) return;
    var d = agent();
    box.hidden = !d;
    if (d) {
      var did = savedDid(); if (did) rememberName(did, d);
      if (!supported()) status('robot.noCrypto', null, 'bad');
    }
    relabel();
  }

  function init() {
    if (!$('robotBox')) return;
    var box = $('robotChoices');
    if (box && !box.children.length) {
      PRESETS.map(function (p) { return p.key; }).concat(['free']).forEach(function (k) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'robot-choice'; b.setAttribute('data-key', k);
        b.innerHTML = '<b></b><small></small>';
        b.addEventListener('click', function () { pickChoice(k); });
        box.appendChild(b);
      });
    }
    $('robotHello').addEventListener('click', hello);
    $('robotJobOpen').addEventListener('click', function () { togglePanel('robotJobForm', function () { pickChoice(choice); }); });
    if ($('robotJobsOpen')) $('robotJobsOpen').addEventListener('click', function () { togglePanel('robotJobs', function () { board.at = 0; renderJobs(); }); });
    if ($('robotRepOpen')) $('robotRepOpen').addEventListener('click', function () { togglePanel('robotRep', renderRep); });
    $('robotJobGo').addEventListener('click', postJob);
    $('robotJobTitle').addEventListener('input', sync);
    $('robotJobTitle').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') postJob(); });
    $('robotWatch').addEventListener('click', watch);
    if ($('robotTown')) $('robotTown').addEventListener('click', function () { if (AQ.activity) AQ.activity.watchDay(); });
    if (AQ.activity) AQ.activity.onChange = sync;
    pickChoice(choice);
    refresh();
    startTrack();                                // 前に頼んだ仕事がまだ動いていれば、返事を控え続ける
  }

  AQ.robot = {
    init: init, refresh: refresh, relabel: relabel, hello: function () { hello(); },
    /* 検査用 */
    _didFromPub: didFromPub, _sweep: sweep, _field: field, _say: say, _loadOrMakeKey: loadOrMakeKey, BASE: BASE,
    PRESETS: PRESETS, stopTrack: stopTrack, KIBBLE: KIBBLE, togglePanel: togglePanel, renderJobs: renderJobs,
    say: say, publishCard: function () { var d = agent(); return d ? publishCard(d).then(function (ok) { ui.carded = ok; return ok; }) : Promise.resolve(false); },
    did: savedDid, sweep: sweep, field: field, loadJobs: loadJobs, loadBoard: loadBoard, rememberName: rememberName
  };
})(window.AQ = window.AQ || {});
