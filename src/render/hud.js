/* =============================================================
   render/hud.js — 実況（上段）と生ログ（下段）
   -------------------------------------------------------------
   ここが「二層で見せる」の実装です。
     上段 … 何をしているかを日本語で
     下段 … 実際の HTTP とオンチェーンの1行
   どちらか片方だけを出すことは、仕様として禁止。

   ★ なぜ毎回 esc() を通すか
     ここに出す文字の出どころは、いずれ technocore.chat という
     誰でも書き込める公開の部屋になります。あの部屋自身が「見えない文字が
     他のエージェントの文脈に指示を紛れ込ませる手口になる」と警告している
     とおり、他人が書いた文字列は常に「データ」であって「マークアップ」
     ではありません。イベントに由来する値（actor・target・item・tx…）は
     すべて信用せず、innerHTML に渡す直前で必ずエスケープします。
     hud.js 自身が書く `<b>` や `<span>` はこちらの意図した装飾なので、
     そこは素通しのままにします。
   ============================================================= */
(function (AQ) {
  'use strict';

  var el = {};

  var DASH = '—';   // 分からないときはこの文字だけを出す（他で組み立てない）
  /* 「運んでいる最中」の区切り。render/room.js の WALK_UNTIL と同じ値。
     ここより手前は進行形（納品中）、以降は完了形（納品した）。 */
  var WALK_UNTIL_HUD = 0.7;

  /** HTML の特殊文字をエンティティに変換する。null/undefined は空文字。
      innerHTML に渡す「データ」は、必ずこれを通してから連結すること。 */
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trunc(v, n) {
    var x = String(v == null ? '' : v);
    return x.length > n ? x.slice(0, n - 1) + '…' : x;
  }

  function fmt(n, d) { return Number(n || 0).toFixed(d == null ? 3 : d); }
  function money(a) { return a ? (fmt(a.value) + ' ' + (a.asset || '')) : ''; }
  function shortHash(h) { return h ? (h.length > 14 ? h.slice(0, 8) + '…' + h.slice(-2) : h) : ''; }
  function host(u) { try { return String(u).replace(/^https?:\/\//, '').split('/')[0]; } catch (e) { return u; } }

  /* 'actbatch'（支払いを含まない Tier2 の束）の内訳を「N 呼び出し・N 応答」
     のように組み立てる。訳語が無い種別（今後 tier が増えたときの保険）は
     種別名をそのまま出す（分からない語を勝手な日本語に化けさせない）。
     金額・「支払い」の語はここには一切登場しない。 */
  /** ★ 2026-09-18: そのコマが表している「書き込みの回数」。
      kibble のただの発言は、アダプタが tool.call と result.ok の対に
      するので、イベント数を数えると本当の倍になる。同じ発言は同じ
      seq を持つので、seq の種類数が本当の回数（推定ではなく実数）。
      「130 件（65応答・65呼び出し）」は事実ではあるが、起きたことは
      「65回 書き込んだ」——数え方の内訳より、そちらを出す。 */
  function writeCountOf(b) {
    var evs = (b && b.events) || (b && b.lead ? [b.lead] : []);
    var seen = {}, n = 0;
    evs.forEach(function (e) {
      var k = (e && e.meta && e.meta.seq != null) ? String(e.meta.seq) : null;
      if (k == null) { n++; return; }
      if (!seen[k]) { seen[k] = true; n++; }
    });
    return n || 1;
  }

  function actbatchDetail(b) {
    var t = AQ.i18n.t, byKind = b.byKind || {};
    return Object.keys(byKind).sort().map(function (k) {
      var label = t('noun.' + k);
      if (label === 'noun.' + k) label = k;   // 未知の種別はそのまま（捏造しない）
      return byKind[k] + label;
    }).join('・');
  }

  /* ---- 上段: 何をしているか ------------------------------------
     1コマ＝1つの行動。文章で流すと読み切る前に次へ行ってしまうので、
       誰が （番号バッジ・ロボットと同じ色）
       何を （動詞だけ。大きく）
       どれを（仕事ID・相手・金額など）
     の3つに分けて出す。ここが読めれば下段の生ログは確認用で済む。 --- */

  /* コマ → 動詞キー。kibble の JOB/CLAIM/DELIVER/ATTEST は
     meta を見て専用の語を選ぶ（「考えた」では何も伝わらないため）。 */
  function verbKey(b) {
    var e = b.lead || {}, m = e.meta || {};
    switch (b.kind) {
      case 'plan':    return m.job ? 'act.post' : 'act.plan';
      case 'travel':  return m.job ? 'act.claim' : 'act.travel';
      case 'receive':
        if (m.verdict === 'useful') return 'act.attestOk';
        return m.job ? 'act.deliver' : 'act.receive';
      case 'error':
        if (m.verdict === 'not') return 'act.attestNo';
        return String(e.status || '') === '402' ? 'act.error402' : 'act.error';
      default:        return 'act.' + b.kind;
    }
  }

  /* コマ → 「どれを」の1行（エージェント一覧の「what」列で使う。
     実況の見出し（story()）は job のときこれを使わず、専用の大きな
     3行組み立てを自分で行う＝下の isJobBeat()/progressRow() 参照）。 */
  function object(b, st) {
    var t = AQ.i18n.t, e = b.lead || {}, m = e.meta || {};
    if (m.job) {
      /* 「納品した kee8d00deea」では何を納品したのか分からない、という
         報告（2026-09-04）への対応。仕事IDは人には読めないので、
         分かっているなら依頼の題名を主語として出す。
         ★ 題名はその JOB 行を実際に見たときだけ引き継がれる。
         取得範囲より前に投稿された依頼は題名を知りようがないので、
         そのときは今までどおり ID だけ（＝推測で埋めない）。
         ★ 2026-09-06: kind（build/research/… の自称スラッグ）は
           ここにはもう出さない。「仕事とは何の仕事か」の答えは題名が
           担い、kind は技術的な分類語として詳細パネル（ui.detail）
           だけに出す（main view には出さない、という区分け）。 */
      if (m.title) return '<b class="title">' + esc(trunc(m.title, 44)) + '</b>';
      return esc(m.job) + ' <span class="sub">' + esc(t('story.titleOutOfRange')) + '</span>';
    }
    switch (b.kind) {
      case 'start':
      case 'travel':  return t('obj.to', { target: esc(host(e.target)) || '—' });
      case 'require':
      case 'pay':     return esc(money(e.amount));
      case 'settle': {
        /* ★ 2026-10-08 総点検：1件だけのときに「1 件を1本の取引に」と出ていて、意味が
           通らなかった。2件以上をまとめたときだけ件数を言い、1件なら金額を出す。 */
        var nSet = Number(m.batched || b.count || 1);
        if (nSet > 1) return t('obj.settle', { count: nSet });
        return e.amount ? esc(money(e.amount)) : '';
      }
      case 'receive': return esc(e.item || host(e.target)) || '—';
      case 'error':   return t('obj.code', { target: esc(host(e.target)),
                                             code: esc(e.status || '502') });
      case 'batch':   return t('obj.batch', { count: b.count,
                                              total: fmt(b.total) + ' ' + esc(b.asset || '') });
      case 'actbatch': return t('obj.writes', { n: writeCountOf(b) });
      case 'planbatch': return t('obj.count', { count: b.count });
      case 'idle':    return t('obj.idle', { sec: Math.round((b.gapMs || 0) / 1000) });
      case 'end':
        /* ★ 分からないことは描かない：支払いが1件も無いログ（kibble など）で
           「支払い合計 0.000 USDC」と出すのは、無い決済をあったかのように
           見せる嘘になる。支払いの形跡（宣言された予算 or 実際の支払い）が
           あるときだけ、金額つきの終了メッセージにする。 */
        if (st.hasBudget || st.paid > 0) return t('obj.end', { spent: fmt(st.spent) + ' USDC' });
        return t('obj.endNoPay');
      default:        return '';
    }
  }

  /* ---- 依頼の進み具合（task 3） ------------------------------
     job のある beat（plan/travel/receive/error）が、依頼の一生の
     どの段階にあたるかを 1〜4 の数字で返す（0＝job が無い＝対象外）。
       1 出された（JOB＝agent.plan）
       2 引き受けた（CLAIM＝tool.call）
       3 納品（DELIVER＝result.ok・verdict無し）
       4 判定（ATTEST useful/not＝result.ok(verdict=useful) / result.error(verdict=not)）
     kibble の書式（JOB→CLAIM→DELIVER→ATTEST の順でしか書けない）に
     素直に乗っているだけで、ここで何かを推測して埋めてはいない。 */
  function jobStepOf(b) {
    var m = (b.lead && b.lead.meta) || {};
    if (!m.job) return 0;
    switch (b.kind) {
      case 'plan':    return 1;
      case 'travel':  return 2;
      case 'receive': return (m.verdict === 'useful') ? 4 : 3;
      case 'error':   return (m.verdict === 'not') ? 4 : 0;
      /* ★ 2026-09-07: まとめたコマでも進み具合を消さない。
         束は同じ依頼のイベントだけで作られる（aggregate.js の
         groupKeyOf）ので、代表イベントの種別から段階を決められる。
         以前はここで 0 を返していたため、まとめたコマになった瞬間に
         ①〜④の行が消え、「フローが消える」と報告されていた。 */
      case 'actbatch':
      case 'planbatch': {
        var lead = b.lead || {};
        if (lead.type === 'agent.plan') return 1;
        if (lead.type === 'tool.call')  return 2;
        if (lead.type === 'result.ok')  return (m.verdict === 'useful') ? 4 : 3;
        if (lead.type === 'result.error') return (m.verdict === 'not') ? 4 : 0;
        return 0;
      }
      default:        return 0;
    }
  }

  /* ---- このアプリが付ける「呼び名」（2026-09-11）--------------------
     did:key:z6Mk… の末尾6文字や k4147614196 では、人は誰が誰だか・
     どの依頼だか覚えられない。そこで src/nicknames.js が短い呼び名を
     割り当てる。ただしこれは表示のためにこちらが勝手に付けたラベルで、
     本人が名乗った名前でも、ログに書いてある文字でもない。
     だから画面では必ず（仮）を添え、本物のIDは「詳細」に必ず出す。 */
  function nickActor(actor) {
    return (AQ.nick && actor != null) ? AQ.nick.forActor(String(actor)) : '';
  }
  function nickJob(jobId) {
    return (AQ.nick && jobId != null) ? AQ.nick.forJob(String(jobId)) : '';
  }
  /** 呼び名＋（仮）。呼び名が取れないときは空文字（何も足さない）。 */
  function nickTag(name, cls) {
    if (!name) return '';
    return '<span class="' + (cls || 'nick') + '">' + esc(name) +
             '<i class="prov">' + esc(AQ.i18n.t('nick.mark')) + '</i></span>';
  }

  /* 依頼の kind（build/research/…）の全角語訳。ここに無い kind は
     捏造せず、そのままの文字列を返す（自由文字列なので何でも来る）。 */
  /** 絵の中の札にマウスを乗せたときの説明（main.js から使う）。 */
  function kindTitle(kind) {
    var w = kindLabel(kind);
    return w ? AQ.i18n.t('kind.chipTitle', { k: w }) : '';
  }

  function kindLabel(kind) {
    if (kind == null || kind === '') return null;
    var t = AQ.i18n.t, key = 'kind.' + kind, v = t(key);
    return (v !== key) ? v : kind;
  }

  /* ---- task 3: この行がどの依頼の話か・依頼が変わったこと ----------
     「①②③④の並びが行ったり来たりして見える」という報告は、データが
     壊れているのではなく、コマごとに主語（依頼）が違うのに、行の見た目
     だけを見ると同じ1本の進捗バーが逆走しているように読めてしまう、
     という「読み方」の問題だった。直すのはデータではなく表示:
       ・この行がどの依頼の話かをキャプションで必ず明示する。
       ・直前に表示していたコマと依頼IDが変わっていたら、それを
         はっきり注記する（バーが巻き戻ったのではなく、主語が
         変わっただけだと分かるように）。
     直前の「依頼を持つコマ」の記憶は、コマの本当の位置（b.index）を
     キーに更新する＝同じコマを何度描き直しても（アニメーションの
     1フレームごとに story() が呼ばれるため）誤検出しない。 */
  var progressLastBeatIndex = null;
  var progressLastJobId = null;
  var progressLastJobLabel = null;
  var progressSwitchedFlag = false;
  var progressPrevLabel = null;

  /** beatIndex（ログ全体での本当のコマ番号）が前回と変わったときだけ、
      直前に表示していた「依頼を持つコマ」の jobId と見比べて判定し直す。
      同じコマを指している間（再描画のたび）は前回の判定を使い回す。
      ★ 2026-09-07: 「切り替わりました」だけでは何が起きたのか分からない
      という報告への対応で、直前の依頼の見出し（jobLabel）も覚えておき、
      「前：◯◯ → 今：△△」と並べて出せるようにした。 */
  function computeJobSwitch(beatIndex, jobId, step, jobLabel) {
    if (beatIndex !== progressLastBeatIndex) {
      progressLastBeatIndex = beatIndex;
      if (step > 0) {
        progressSwitchedFlag = (progressLastJobId != null && progressLastJobId !== jobId);
        progressPrevLabel = progressSwitchedFlag ? progressLastJobLabel : null;
        progressLastJobId = jobId;
        progressLastJobLabel = jobLabel;
      } else {
        progressSwitchedFlag = false;
        progressPrevLabel = null;
      }
    }
    return { switched: progressSwitchedFlag, prev: progressPrevLabel };
  }

  /** 新しいログを読み込んだ・別のエージェントを選び直したときに呼ぶ。
      呼ばないと「切り替わりました」の注記が、無関係な前のログ／前の
      選択の job id と比べて誤発火することがある。 */
  function resetProgressTracking() {
    progressLastBeatIndex = null;
    progressLastJobId = null;
    progressLastJobLabel = null;
    progressSwitchedFlag = false;
    progressPrevLabel = null;
  }

  /* ---- ①はどこにあるのか（2026-09-07 の報告）---------------------
     「最初から再生しても ②引き受けた から始まる」。これはバーが壊れて
     いるのではなく、①（＝JOB を掲示板に出した行）を書いたのが
     たいてい別のエージェントで、1体に絞って見ている間はその行が
     再生対象に入らないため。データは正しいので、直すのは表示のほう＝
     ①がどこにあるのかを、分かる範囲だけ書く。
       ・ログ全体に JOB 行がある → 出したエージェントの番号を出す
       ・ログ全体を探しても無い   → 「取れた記録より前」とだけ書く
     どちらも fullBeats（＝絞り込み前のログ全体）を実際に探した結果で、
     推測で埋めることはしない。 */
  function jobPosterOf(jobId, fullBeats) {
    if (!jobId || !fullBeats) return null;
    for (var i = 0; i < fullBeats.length; i++) {
      var evs = (fullBeats[i] && fullBeats[i].events) || [];
      for (var j = 0; j < evs.length; j++) {
        var e = evs[j];
        if (e && e.type === 'agent.plan' && e.meta && e.meta.job === jobId) {
          return e.actor == null ? null : String(e.actor);
        }
      }
    }
    return null;
  }

  /** 「①はこのエージェントの記録に無い」ときだけ、その理由を1行返す。
      無いときは null（＝何も足さない）。 */
  function step1Note(step, jobId, actor, fullBeats) {
    if (step < 2 || !jobId) return null;
    var t = AQ.i18n.t;
    var poster = jobPosterOf(jobId, fullBeats);
    if (poster == null) return { text: t('progress.step1Missing'), elsewhere: true };
    if (poster === String(actor)) return null;    // 本人が出している＝注記不要
    return { text: t('progress.step1By', { who: who(poster) }), elsewhere: true };
  }

  /* ①出された › ②引き受けた › ③納品 › ④判定、の4段階の行＋注記。
     現在の段階（step）より前は「起きたこと」として通常表示、
     step 自体は強調、それより後ろは薄く（＝まだ起きていない）。
     jobLabel はキャプションに出す「どの依頼か」の短い文字列
     （呼び出し側で esc 前提。ここでまとめて esc する）。switched が
     真なら、直前と依頼が変わったことを行の上に強調して出す。 */
  function progressRow(step, jobLabel, sw, note, storyInfo, known) {
    var t = AQ.i18n.t;
    var switched = !!(sw && sw.switched);
    var glyphs = ['①', '②', '③', '④'];
    var keys   = ['progress.step1', 'progress.step2', 'progress.step3', 'progress.step4'];
    /* ★ 2026-09-11: 誰がその段階をやったかを、段階そのものに付ける。
       以前は下に「この依頼に出てくるのは 出した人 #11 ／ …」という行を
       別に出していたが、①〜④と同じ情報を2か所に分けて書いていただけで、
       行数が増えるほど読みにくくなっていた（利用者の指摘）。
       ＋N は「同じ段階をやった他のエージェントの数」。正確な数だけを出し、
       名前は出さない（全員は「詳細」にある）。 */
    var reps   = (storyInfo && storyInfo.reps) || null;
    /* ★ 2026-09-12(3): エージェントから入ったときは、その子がやった段階
       にだけ名前を出す。報告「関係のないエージェントの名前が表示されて
       いる」への対応で、他の段階を誰がやったかは「詳細」に譲る。
       ＋N（同じ段階をやった他の人数）も画面からは外した（数字が増える
       ほど読めなくなる。全員は「詳細」の関係者一覧にある）。 */
    var own  = (storyInfo && storyInfo.ownSteps) || [];
    var star = (storyInfo && storyInfo.starring) || null;
    /* ★ 2026-09-13: エージェントの「まとめ」では、段階ごとに
       「何件やったか」を出す（利用者の提案）。0件の段階は薄いまま。 */
    var counts = (storyInfo && storyInfo.counts) || null;
    /* 「Xエージェント」を1つでも出したら、その意味を足もとに1行そえる。 */
    var unknownSeen = false;
    var parts = keys.map(function (key, i) {
      var n = i + 1;
      var cls = (n < step) ? 'step done' : (n === step) ? 'step current' : 'step pending';
      /* ①がこのエージェントの記録に無いときは「済み」と同じ見た目にしない。
         見た目まで済みにすると「この子が出した」と読めてしまう。 */
      if (n === 1 && note && note.elsewhere) cls = 'step elsewhere';
      if (own.indexOf(n) !== -1) cls += ' mine';
      var now = (n === step) ? ('<b class="now">▲ ' + esc(t('progress.now')) + '</b>') : '';
      /* 「誰が」を出すのは、もう起きた段階（＝いまのコマまで）だけ。
         まだ来ていない段階に名前を出すと、これから誰が納品するかを
         先に教えることになる（＝この先の話を描いてしまう）。
         エージェントから入ったときは、さらに「その子の段階」だけ。 */
      var whoTag = '';
      var cn = counts ? (counts[n] || 0) : 0;
      if (counts) {
        cls = (n === step) ? 'step current' : (cn > 0 ? 'step done' : 'step none');
      }
      /* ★ 2026-09-17: 段階の主語を「役割の言葉」から「本人」に差し替える。
         これまでは「やる人が引き受けた #2」で、#2 が誰なのかはこの行だけ
         では分からなかった（呼び名はロボットの頭の上にしか出ていない）。
           ・もう起きていて、誰かが分かる     → 「#2 ツグミ が引き受けた」
           ・もう起きているが、その行が無い   → 「Xエージェント が…」
                （数学の不明な変数 X と同じ扱い。詳細では「不明」と明記）
           ・まだ来ていない                   → will{n}（誰がやるかは先に
                教えない。ここに名前を出すと、この先の話を描いてしまう）
         「起きたかどうか」は今までどおり n <= step で判断する。 */
      var labText;
      if (counts) {
        /* ★ 2026-09-26: まとめ（件数）の画面では、その4段階を全部やって
           いるのは「いま選んでいる1体」だけ。それなのに主語が
           「やる人」という一般名詞のままで、「やる人が引き受けた 101件」
           と出ていた——誰のことか分からない、という指摘。
           主語がひとりに決まっているのだから、その子の呼び名を入れる。
             やった段階   → 「トラ が 依頼を 101件 引き受けた」
             0件の段階    → 「トラ は 引き受けていません」
           （0件を「0件」と数字で書くより、していない と書くほうが短く
             はっきりする。どちらも事実は同じ。）
           呼び名は #番号 を付けない——すぐ上の主語に「#3 トラ（仮）」と
           出ていて、同じ番号を4回くり返すだけになるため。 */
        var star2 = (storyInfo && storyInfo.starring) || null;
        var starName = star2 ? (nickActor(star2) || who(star2)) : '';
        labText = t((cn > 0 ? 'progress.did' : 'progress.none') + n,
                    { who: starName, n: cn });
      } else if (n > step) {
        labText = t('progress.will' + n);
      } else {
        /* 誰がその段階をやったか。順に、
             1) 依頼1件を追っているときの代表（reps）
             2) いまのコマ本人（今まさに描いている段階は必ず分かる）
             3) ①だけは、ログ全体から JOB を書いた本人を探す
                （★ 依頼を追っていないときは reps が無いので、
                  ここが無いと分かっているのに X と書いてしまう）
           どれでも分からなければ X。 */
        var repActor = (reps && reps[n]) ||
                       ((n === step && known && known.curActor != null) ? known.curActor : null) ||
                       ((n === 1 && known && known.poster != null) ? known.poster : null);
        var subject = repActor ? whoName(repActor) : t('progress.unknownWho');
        labText = t('progress.act' + n, { who: subject });
        if (!repActor) unknownSeen = true;
      }
      var inner = glyphs[i] + ' ' + esc(labText);
      /* 段階の語と「誰が」は必ず同じ行に置く（.step は縦並びなので、
         包まずに並べると #番号 が下の行へ落ちて行数が増える）。 */
      return '<span class="' + cls + '">' +
               '<span class="lab">' + inner + '</span>' +
               now +
             '</span>';
    });

    /* 依頼が切り替わった瞬間だけ出す説明。1語の警告では「なぜ①に戻った
       のか」が伝わらなかったので、前の依頼と今の依頼を並べたうえで、
       理由（＝1体が複数の依頼を並行して進めている）まで書く。 */
    var switchBox = '';
    if (switched) {
      switchBox =
        '<div class="progress-switch">' +
          '<b>⚠ ' + esc(t('progress.switchedTitle')) + '</b>' +
          (sw.prev
            ? '<span class="pair">' +
                esc(t('progress.switchedPair', { prev: sw.prev, now: jobLabel })) +
              '</span>'
            : '') +
          '<span class="why">' + esc(t('progress.switchedWhy')) + '</span>' +
        '</div>';
    }

    /* ★ 2026-09-11: 依頼1件を追っているとき（storyInfo あり）は、
       「この依頼（題名…）の進み具合」という見出しを出さない。
       題名はすぐ上の見出しに大きく出ているので、同じ題名をもう一度
       小さく繰り返しているだけだった。依頼を追っていないログ
       （x402 のサンプルなど）では、どの依頼の話か分からなくなるので残す。 */
    var head = storyInfo ? ''
      : '<div class="progress-head"><span class="progress-job">' +
          esc(t('progress.forJob', { job: jobLabel })) + '</span></div>';
    var rowCls = switched ? 'progress switched' : 'progress';
    /* 足もとの注記は「今このコマで本当に必要なものだけ」。
       ★ 2026-09-12(3): ＋N の読み方の1行は削除（＋N 自体を外したため）。
       誰が何をしたかの正確な一覧は「詳細」の関係者一覧に移した。 */
    var footBits = '';
    /* ★ 2026-09-17: X の説明と「①は取れた記録より前にあります」は
       同じことを2通りに言っているだけなので、X を出したほうだけにする。 */
    if (unknownSeen) footBits += '<span class="where">' + esc(t('progress.unknownWhy')) + '</span>';
    else if (note) footBits += '<span class="where">' + esc(note.text) + '</span>';
    /* ★ 2026-09-13: まとめでは、0件の段階がなぜ0件なのかを1行で書く。
       ①〜④は「依頼1件が通る道すじ」であって、1体のエージェントの
       行動一覧ではない。多くの子は〈やる係〉だけをやるので、
       ①出された・④判定は当たり前に0件になる——それが伝わらないと
       「壊れている／使っていない項目」に見えてしまう。 */
    /* ★ 2026-09-26: 「この子がしたのは ②引き受けた・③納品 だけです
       （①出された・④判定 はしていません）」の1行は外した。帯そのものが
       段階ごとに「トラ は 判定していません」と言うようになり、同じことを
       2か所に書いているだけになったため。①〜④の一般の説明は今までどおり
       画面右（el.sideNote）にある。 */
    if (!storyInfo) footBits += '<span class="gray">' + esc(t('progress.caption')) + '</span>';
    var foot = footBits ? ('<p class="progress-note">' + footBits + '</p>') : '';
    return switchBox + head +
           '<div class="' + rowCls + '">' + parts.join('<span class="arrow">›</span>') + '</div>' +
           foot;
  }

  /* ---------------------------------------------------------------
     x402 の進み具合（2026-09-13）
     -----------------------------------------------------------------
     1回の有料リクエストは、いつも同じ5段階を通る。

       ① 頼んだ         GET …                  （tool.call）
       ② 402が返った     中身の代わりに請求書    （payment.required）
       ③ ハンコを押した   許可証への署名を返した  （payment.sent）
                        ※この時点ではチェーンに何も乗っていない
       ④ 立会人が確定     ファシリテータが載せた  （payment.settled）
       ⑤ 受け取れた       ようやく中身が来た      （result.ok）

     段階はコマの種類から決める（ログに書いていない値を作らない）。
     ひとつだけ順番を見ないと決まらないものがある：確定より後の
     tool.call は「もう一度取りに行った」＝⑤の手前なので、①に
     戻さず⑤側に置く（①〜⑤が後戻りして見えると道すじが読めない）。
     --------------------------------------------------------------- */
  var X402_KEYS = ['x402.step1', 'x402.step2', 'x402.step3', 'x402.step4', 'x402.step5'];
  var X402_GLYPH = ['①', '②', '③', '④', '⑤'];

  /** そのログに支払いが1件でもあるか。
      ★ 2026-09-19 重大な修正: これを見ずに x402 の①〜⑤を判定していたので、
      支払いが1件も無い kibble の部屋でも「③納品」のコマが x402 の⑤と
      判定され、押してもいない「x402ってなに？」の解説が画面右に
      割り込んでいた（利用者の報告）。x402 の道すじは、支払いのある
      ログにしか存在しない。 */
  var payCache = null;
  function hasPayments(beats) {
    if (!beats || !beats.length) return false;
    if (payCache && payCache.beats === beats) return payCache.yes;
    var yes = false;
    for (var i = 0; i < beats.length; i++) {
      var k = beats[i] && beats[i].kind;
      if (k === 'require' || k === 'pay' || k === 'settle' || k === 'batch') { yes = true; break; }
    }
    payCache = { beats: beats, yes: yes };
    return yes;
  }

  /** そのコマが5段階のどれか。0＝この道すじの外（描かない）。 */
  function x402StepOf(b, beats) {
    if (!b) return 0;
    if (!hasPayments(beats)) return 0;      // 支払いの無いログに x402 の道すじは無い
    /* ★ 2026-10-08: チェーンの送金の記録で、署名で払う方式（transferWithAuthorization）と
       分からない支払いは、③署名・④立会人の段階として点けない（記録からは言えない）。 */
    var bm = (b.lead && b.lead.meta) || {};
    if ((b.kind === 'pay' || b.kind === 'settle') && AQ.scene && AQ.scene.viaFacilitator && !AQ.scene.viaFacilitator(bm)) return 0;
    switch (b.kind) {
      case 'require': return 2;
      case 'pay':     return 3;
      case 'batch':   return 3;   // 支払いをまとめたコマも「払った」段階
      case 'settle':  return 4;
      case 'receive': return 5;
      /* 402 で断られたコマ。②の直後に起きる「払っていないので
         もらえなかった」場面なので、②のまま留める。 */
      case 'error':   return (String((b.lead && b.lead.status) || '') === '402') ? 2 : 0;
      case 'travel':  return settledBefore(b, beats) ? 5 : 1;
      default:        return 0;
    }
  }

  /** このログに記録されている x402 の段階（1..5 → true）。コマ列ごとに1回だけ数える。 */
  var x402SeenCache = { beats: null, n: -1, seen: null };
  function x402Seen(beats) {
    if (x402SeenCache.beats === beats && x402SeenCache.n === beats.length) return x402SeenCache.seen;
    var seen = {};
    for (var i = 0; i < beats.length; i++) { var k = x402StepOf(beats[i], beats); if (k) seen[k] = true; }
    x402SeenCache = { beats: beats, n: beats.length, seen: seen };
    return seen;
  }
  /** チェーンの送金履歴から作ったログか（ウォレットを入れたとき）。 */
  function fromChainLog(beats) {
    for (var i = 0; i < beats.length && i < 5; i++) {
      var evs = beats[i].events || [];
      for (var j = 0; j < evs.length; j++) if (evs[j] && evs[j].meta && evs[j].meta.tSource === 'chain') return true;
    }
    return false;
  }
  /** その子の支払いの件数（payment.sent の行の数＝ログに書かれている数そのもの）。 */
  var payCountCache = { beats: null, n: -1, actor: null, count: 0 };
  function paymentsOf(beats, actor) {
    if (payCountCache.beats === beats && payCountCache.n === beats.length && payCountCache.actor === actor) return payCountCache.count;
    var c = 0;
    beats.forEach(function (b) {
      (b.events || []).forEach(function (e) { if (e && e.type === 'payment.sent' && String(e.actor) === String(actor)) c++; });
    });
    payCountCache = { beats: beats, n: beats.length, actor: actor, count: c };
    return c;
  }

  /** このコマより前に、同じランで確定（settle）が起きているか。 */
  function settledBefore(b, beats) {
    if (!beats || b.index == null) return false;
    for (var i = 0; i < beats.length && i < b.index; i++) {
      if (beats[i] && beats[i].kind === 'settle') return true;
    }
    return false;
  }

  /** その段階の「なぜ」の文。同じ段階でもコマが2つある場所が2か所あり、
      そこは文を分ける（起きていないことを先に書かないため）。
        ②：402が返ったコマ／その直後の「払っていないので断られた」コマ
        ⑤：もう一度取りに行くコマ／実際に受け取ったコマ */
  function x402WhyKey(b, step) {
    if (step === 2 && b.kind === 'error')  return 'x402.why2b';
    if (step === 5 && b.kind === 'travel') return 'x402.why5a';
    return 'x402.why' + step;
  }

  /** ①〜⑤の帯。依頼の progressRow と同じ見た目・同じ読み方。 */
  function x402Row(step) {
    var t = AQ.i18n.t;
    var parts = X402_KEYS.map(function (key, i) {
      var n = i + 1;
      var cls = (n < step) ? 'step done' : (n === step) ? 'step current' : 'step pending';
      var now = (n === step) ? ('<b class="now">▲ ' + esc(t('progress.now')) + '</b>') : '';
      return '<span class="' + cls + '" title="' + esc(t(key)) + '">' +
               '<span class="lab"><i class="g">' + X402_GLYPH[i] + '</i> <span class="tx">' + esc(t(key)) + '</span></span>' + now +
             '</span>';
    });
    return '<div class="progress x402">' + parts.join('<span class="arrow">›</span>') + '</div>';
  }

  /** ★ 2026-09-12(4): エージェントを選んでいるときは、そのコマの見出し
      （まとめたコマだと別人のことがある）ではなく、本人が書いた行から
      主語・動詞・段階を作る。画面の名前と動きが必ず本人になる。 */
  function eventView(ev) {
    var m = (ev && ev.meta) || {};
    if (!ev) return null;
    if (ev.type === 'agent.plan')  return { step: 1, verb: 'act.post' };
    if (ev.type === 'tool.call')   return { step: 2, verb: 'act.claim' };
    if (ev.type === 'result.ok')   return (m.verdict === 'useful')
      ? { step: 4, verb: 'act.attestOk' } : { step: 3, verb: 'act.deliver' };
    if (ev.type === 'result.error') return (m.verdict === 'not')
      ? { step: 4, verb: 'act.attestNo' } : { step: 0, verb: 'act.error' };
    return null;
  }

  function story(b, st, ctx) {
    ctx = ctx || {};
    var t = AQ.i18n.t;
    /* 本人の行があればそれを代表にする（無ければ今までどおりコマの見出し）。 */
    var lf = (ctx.agentStory && ctx.agentStory.leadFor) ||
             (ctx.jobStory && ctx.jobStory.leadFor) || null;
    var mine = lf ? lf[b.index] : null;
    var view = mine ? eventView(mine) : null;
    var e = mine || b.lead || {}, m = e.meta || {};
    var actor = e.actor || st.actor;
    var col   = (AQ.roster && AQ.roster.colorFor) ? AQ.roster.colorFor(actor) : '#8fd0ff';
    var actorStr = String(actor);
    var tail = actorStr.length > 8 ? actorStr.slice(-6) : actorStr;
    var thumbUrl = spriteThumb(actor);
    var pic = thumbUrl
      ? '<img class="thumb" width="16" height="20" alt="" src="' + esc(thumbUrl) + '">'
      : '<i class="dot" style="background:' + esc(col) + '"></i>';
    var subjectParticle = t('story.subjectParticle');

    /* ---- 1行目: 誰が（サムネイル・#番号・呼び名・主語の助詞） ----
       ★ 2026-09-11: DIDの末尾6文字（1jjwng など）をやめ、呼び名に
       差し替えた。末尾6文字は「読めるが覚えられない」いちばん役に
       立たない情報で、正確なIDが要るときは詳細を見るのが正しい。 */
    var line1 =
      '<div class="subject">' + pic +
        '<span class="who" style="border-color:' + esc(col) + ';color:' + esc(col) + '">' +
          esc(who(actor)) + '</span>' +
        nickTag(nickActor(actor), 'nick who-nick') +
        (subjectParticle ? '<span class="particle">' + esc(subjectParticle) + '</span>' : '') +
      '</div>';

    var vKey = view ? view.verb : verbKey(b);
    var step = view ? view.step : jobStepOf(b);
    /* ★ 2026-09-13:「納品しているときは納品中と表示させてください」。
       札を持って歩いている最中（コマの前半70%＝room.js の WALK_UNTIL と
       同じ区切り）は進行形、置き終わってから完了形に変える。絵と文字が
       食い違っていた（歩いている最中に「納品した」と書いてあった）。
       進行形の語が辞書に無い動詞は、そのまま完了形のまま（捏造しない）。 */
    if (step > 0 && ctx.p != null && ctx.p < WALK_UNTIL_HUD) {
      var ingKey = vKey + '.ing';
      if (t(ingKey) !== ingKey) vKey = ingKey;
    }
    var line2, line3 = '<div class="verb">' + t(vKey) + '</div>';

    /* ★ 2026-09-06:「書き込みをまとめて記録した — で、何を？」という
       指摘への対応。まとめたコマは中身の内訳（種別ごとの件数）が
       分かっているのに、曖昧な総称だけを出していた。動詞のすぐ横に
       内訳を添える。数えたものだけを出す（byKind が無ければ何も足さない）。 */
    if (b.kind === 'planbatch' || b.kind === 'batch') {
      var brk = actbatchDetail(b);
      if (brk) {
        line3 = '<div class="verb">' + t(vKey) +
                '<span class="brk">' + esc(t('obj.breakdown', { count: b.count, detail: brk })) +
                '</span></div>';
      }
    }
    /* ★ 2026-09-18: 書き込みのコマは「130 件の内訳：65応答・65呼び出し」
       ではなく「65 回」。応答／呼び出しはアダプタが発言1件を2つの
       イベントに開いた内訳で、起きたことそのものではない。正確な
       イベント数と種別の内訳は今までどおり「詳細」に全部出る。 */

    if (step > 0) {
      /* ---- 2行目: 依頼の題名（大きく）＋目的語の助詞 ----
         「仕事を掲示板に出した」では画面でいちばん大きい文字が
         "仕事" という一般名詞で、実際の依頼の中身がいちばん小さい
         グレー文字だった、という報告への対応。ここを見出しの主役にする。 */
      var objectParticle = t('story.objectParticle');
      /* ★ 2026-09-13: 依頼の英語の題名を見出しから外した。
         「Handling split-brain scenarios in a case-insens…」のような
         英文が毎コマ画面のいちばん大きい場所を占めていて、日本語話者の
         初心者には読めない・読む必要もない、という指摘を何度も受けた。
         どの依頼かは呼び名（このアプリが付けた短い日本語）で分かるので、
         見出しは呼び名だけにする。題名の全文は「詳細」に必ず出る
         （関係者一覧のすぐ下・依頼IDと並べて）。 */
      var titleInner = '<span class="jobtitle">' + esc(nickJob(m.job)) +
                         '<i class="prov">' + esc(t('nick.mark')) + '</i></span>';
      line2 = '<div class="headline">' + titleInner +
              (objectParticle ? '<span class="particle">' + esc(objectParticle) + '</span>' : '') +
              '</div>';
    } else {
      /* ---- job の無い beat（街／x402）は今までどおり：小さい「どれを」 ---- */
      var obj = object(b, st);
      line2 = obj ? '<div class="objline">' + obj + '</div>' : '';
    }

    /* ★ 2026-09-19: 「誰が」「どれを」「何をした」を1行にまとめる。
       3つを別々のブロックにしていたので実況欄が縦に伸び、そのぶん
       盤面（＝いちばん見てほしいもの）が小さくなっていた（利用者の報告）。
       横に並べれば1文として読め、縦は3行ぶんから1行ぶんに縮む。
       入りきらない画面では flex-wrap で折り返すので、狭くても壊れない。 */
    var line = '<div class="sayline">' + line1 + line2 + line3 + '</div>';

    /* ---- 依頼の①〜④の帯は、2026-09-27 に実況から外した。
       利用者の指摘「①②③④と説明がありますが、これも削除してみて下さい。
       極力文字は使わない方向でシンプルに」。①〜④は
         ・一覧の各行の丸（jobStepDots）＝文字を使わない形で残っている
         ・「詳細」パネル（jobWhoBlock）＝誰がどの段階をやったかを正確に
       の2か所に残るので、事実は失われない（＝正確さは「詳細」に譲る）。
       progressRow() 自体は消していない（x402 の帯と対の作りで、戻すときに
       1行で戻せるようにしてある）。 */
    if (step === 0) {
      /* ★ 2026-09-13: x402（支払いのあるログ）の進み具合。
         依頼の①〜④とまったく同じ作りで、こちらは「1回の有料リクエストが
         通る道すじ」を5段階で出す。
           ① 頼んだ ② 402が返った ③ ハンコを押した ④ 立会人が確定 ⑤ 受け取れた
         「x402ってなに？」に画面だけで答えるための一本目。 */
      var xs = x402StepOf(b, ctx.fullBeats);
      if (xs) line += x402Row(xs);
    }

    /* 動詞1語だけでは「何が起きたか」が伝わらない人のための、控えめな
       補足1行。act.* と対になる act.*.explain が無ければ何も足さない
       （辞書に無いキーは t() がキー名そのものを返すので、それで判定する）。
       ★ 2026-09-04: 「主語がぬけている」という報告への対応で、
       act.*.explain は必ず {actor} を先頭に持つ文になった。バッジと
       同じ who(actor)（#N ラベル）を渡して埋める＝バッジの数字と
       文の主語は常に一致する。 */
    /* ★ 2026-09-05: この補足文は削除した。
       見出しが「#3 が / 『題名』を / 納品した」になり、その下に
       ①〜④ の進み具合が出るようになった時点で、
       「#3 が、引き受けた依頼の成果物を提出しました」は
       見出しの言い換えでしかなく、情報が1つも増えていなかった。
       （利用者から「注釈も不完全」と繰り返し指摘されていた箇所。）
       act.*.explain のキー自体は詳細パネル側で使うので i18n には残す。 */

    /* 本人が書いた文字列。
       ★ 2026-09-12(4): 出すのは「④判定のとき」だけにした。
       ①は題名そのもの（すぐ上に大きく出ている）、②はほぼ空、③は
       成果物の英文——どれも見出しと二重か、読めない英文が増えるだけで、
       「英文が混じる・ごちゃごちゃする」という報告の主因になっていた。
       いっぽう④の講評・却下理由は「なぜ合格／不合格か」であって、
       ほかのどこにも出ていない（2026-09-04 の報告）。だから④だけ残す。
       全部の本文は今までどおり「詳細」にある。 */
    if (step === 4) {
      var body = m.reason || e.item || e.say || '';
      if (body) {
        line += '<span class="say">' + esc(t('story.quoteOpen')) +
                esc(trunc(body, 60)) + esc(t('story.quoteClose')) + '</span>';
      }
    }
    return line;
  }

  /* ---- 下段: 実際に起きたこと ---- */
  function raw(b, st) {
    var t = AQ.i18n.t, e = b.lead || {}, m = e.meta || {};
    var s;
    switch (b.kind) {
      case 'start':
        /* ★ 2026-09-06: actor の DID を全文そのまま出していた（Task 2）。
           DID の全文は詳細パネル（detail.actor）で見られるので、ここは
           実況の見出しと同じ #番号ラベルにそろえる（who() は名簿が
           まだ無ければ末尾6文字までしか出さない＝ここでも全文は出ない）。 */
        s = 'run ' + esc(e.run || '') + ' · actor ' + esc(who(e.actor)) +
            (m.budget != null ? ' · budget ' + fmt(m.budget) + ' USDC' : '');
        break;
      case 'travel':
        /* job のある beat（kibble の CLAIM）は、URLもjobIDも main view には
           出さない（Task 2＝詳細パネルだけに残す）。 */
        s = m.job ? '<span class="dim">' + t('raw.jobNote') + '</span>' : 'GET ' + esc(e.target);
        break;
      case 'require':
        s = '<span class="err">← 402 Payment Required</span> · price ' + esc(money(e.amount)) +
            (m.payTo ? ' · pay-to ' + esc(shortHash(m.payTo)) : '');
        break;
      case 'pay':
        s = 'sign EIP-3009 → POST <b>X-PAYMENT</b> · ' + esc(money(e.amount)) + ' · ' + esc(e.target);
        break;
      case 'settle':
        s = '<b>settled</b> on ' + esc((e.amount && e.amount.chain) || 'arc') + ' · tx ' + esc(shortHash(e.tx)) +
            (m.batched ? ' · ' + esc(m.batched) + ' authorizations in one tx' : '');
        break;
      case 'receive':
        s = m.job
          ? '<span class="dim">' + t('raw.jobNote') + '</span>'
          : '<b>← 200 OK</b> · ' + esc(e.item || 'response') + (m.bytes ? ' · ' + esc(m.bytes) : '') + ' · ' + esc(e.target);
        break;
      case 'error':
        /* job のある beat（kibble の ATTEST not）は、理由（reason）が
           もう実況の見出し（story() の「say」引用）に出ているので、
           ここで URL・job id を重ねて出す必要はない（Task 2）。 */
        s = m.job
          ? '<span class="dim">' + t('raw.jobNote') + '</span>'
          : '<span class="err">← ' + esc(e.status || '502') + '</span> · ' + esc(e.target) +
            (m.attempt ? ' · attempt ' + esc(m.attempt) : '') + (m.backoff ? ' · backoff ' + esc(m.backoff) : '') +
            /* 却下の理由は生ログにも必ず載せる（実況が要約でも、
               ここは相手が書いた原文であることが分かるように）。 */
            (m.reason ? ' · ' + esc(m.reason) : '');
        break;
      case 'batch':
        /* ★ この文言（authorizations / total）が出てよいのは、この束の
           中身が本当に payment.* だけのとき（aggregate.js の family 分け
           で保証されている）。それ以外の Tier2 の束は下の 'actbatch' へ
           行くので、ここに来る時点で b.total / b.asset は本物の合計。 */
        s = b.count + ' authorizations · total ' + fmt(b.total) + ' ' + esc(b.asset || '') +
            ' <span class="dim">' + t('raw.aggregated', { count: b.count }) + '</span>';
        break;
      case 'actbatch': {
        /* payment.* を1件も含まない束。金額・authorizations・total の
           語は出さず、実際に起きたイベント種別（type そのまま）の内訳だけ
           正直に出す。 */
        var byType = {};
        (b.events || []).forEach(function (ev) { byType[ev.type] = (byType[ev.type] || 0) + 1; });
        s = Object.keys(byType).sort().map(function (k) { return esc(k) + ' ×' + byType[k]; }).join(' · ') +
            ' <span class="dim">' + t('raw.aggregated', { count: b.count }) + '</span>';
        break;
      }
      case 'plan':
        /* ★ 2026-09-06: job があるとき、以前はここに「POST /jobs · id …
           · kind …」という擬似HTTP風の1行を出していた。job id・kind は
           main view には出さない（Task 2）＝詳細パネル（ui.detail）に
           全部残る。job が無い（デモの独り言のような target の無い plan）
           場合は今までどおり、say をそのまま出す注記にする
           （＝ Dispatch Log の say フィールドの値そのもの。捏造しない）。 */
        s = m.job
          ? '<span class="dim">' + t('raw.jobNote') + '</span>'
          : '<span class="dim">' + t('raw.note') + ' “' + esc(e.say || '') + '”</span>';
        break;
      case 'planbatch':
        s = t('raw.jobsQueued', { count: b.count }) +
            ' <span class="dim">' + t('raw.aggregated', { count: b.count }) + '</span>';
        break;
      case 'idle':
        s = '<span class="dim">' + t('raw.compressed', { sec: Math.round((b.gapMs || 0) / 1000) }) + '</span>';
        break;
      case 'end':
        /* ★ 分からないことは描かない：支払いの形跡が無いログでは
           「paid」「USDC spent」を出さない（kibble に払った額など無い）。 */
        if (st.hasBudget || st.paid > 0) {
          s = 'run end · ' + st.paid + ' paid calls · ' + fmt(st.spent) +
              ' USDC spent · ' + st.failed + ' failed';
        } else {
          s = 'run end · ' + st.ok + ' ok · ' + st.failed + ' failed';
        }
        break;
      default:
        s = '';
    }

    /* 時刻が推定のときだけ「推定」を添える。サーバの実時刻があるときは何も足さない。 */
    if (m.tSource === 'estimated') {
      s += ' <span class="dim">' + t('raw.estimated') + '</span>';
    }
    return s;
  }

  /* ---- 名簿：番号・色・DID の対応表 ----------------------------
     番号は roster.js が初登場順に振ったもの。DID は他人が書いた
     文字列なので、必ず esc() を通してから DOM に入れる。 --------- */
  var rosterKey = null;   // 同じログなら作り直さない
  var numberOf  = {};     // actor名 → 表示番号。story() もここから引く
  var numCache  = { beats: null, n: -1 };  // numberOf を作ったときのコマ列
  var lastWinKey = null;                   // 隠れている実況の枠を最後に作ったコマ

  /* 実況に出す呼び名。DID は64文字あって読めないので番号にする。
     番号の対応は画面下の名簿チップに出ているので、追跡できる。 */
  /** ★ 2026-09-17: 「#2」だけでは誰なのか分からない、という指摘への対応。
      帯（①〜④）の主語に使う「#番号 呼び名」。呼び名が取れないときは
      番号だけ（捏造しない）。 */
  function whoName(actor) {
    var a = String(actor || 'agent');
    var nick = nickActor(a);
    var n = who(a);
    return nick ? (n + ' ' + nick) : n;
  }

  function who(actor) {
    var a = String(actor || 'agent');
    var n = numberOf[a];
    if (n) return '#' + n;
    return a.length > 12 ? '…' + a.slice(-6) : a;   // 名簿が未構築のときだけ
  }

  /* 一覧の1行に出す、そのエージェントだけの小さなドット絵（task D）。
     見た目は sprites.js の 'down' 向きを、roster.colorFor と同じ色で
     塗ったもの。canvas の無い環境（Node のテストハーネスなど）では
     例外を投げずに空文字を返す＝呼び出し側はドットにフォールバックする。 */
  var thumbCache = {};
  function spriteThumb(actor) {
    /* ★ 2026-09-28 修正: 絵の作り方（sprites.js）が、文字の配列を塗る方式から
       図形を組み立てる方式（figureFor / drawFigure）に変わったのに、ここは
       古い AQ.sprites.build を呼んだままだった。build が無いので空の絵が
       返り、一覧の「顔」がずっと透明だった（誰が誰かを一覧の顔で見分ける、
       という前提が成り立っていなかった）。ロボット本体と同じ関数・同じ色で
       描く。描けなかったときは空文字を返し、キャッシュしない（呼び出し側は
       色の丸にフォールバックする）。 */
    var key = String(actor || 'agent');
    if (Object.prototype.hasOwnProperty.call(thumbCache, key)) return thumbCache[key];
    var url = '';
    try {
      if (AQ.sprites && AQ.sprites.figureFor && AQ.sprites.drawFigure) {
        var fig = AQ.sprites.figureFor(key);
        var pal = (AQ.room && AQ.room.paletteFor) ? AQ.room.paletteFor(key) : null;
        if (!pal) {
          pal = {};
          Object.keys(AQ.config.palette).forEach(function (k) { pal[k] = AQ.config.palette[k]; });
          pal['2'] = AQ.roster.colorFor(key);
        }
        var c = document.createElement('canvas');
        c.width = 32; c.height = 40;
        AQ.sprites.drawFigure(c.getContext('2d'), fig, 0, 0, 32, 40, 'down', pal);
        url = c.toDataURL();
      }
    } catch (e) { url = ''; }
    if (url) thumbCache[key] = url;
    return url;
  }

  /* 各エージェントが「いま何をしているか」の一覧。
     実況は1コマ1行なので、7体が入り混じると誰も追えない。
     ここで1体1行にして、最後にやったことを残しておく。

     ★ beats / index は常に「全コマ」「本当の位置」を渡すこと（focus で
       絞っていても、番号・色・見た目・最後の行動はログ全体から決める＝
       絞り込みは再生対象を減らすだけで、名簿の正しさを変えない）。
     ★ focusActor が付いていれば、その行を目立たせる。クリックで
       絞り込み・解除できる（main.js が AQ.hud.onFocusRequest を設定する）。 */
  /* 各エージェントの一覧。
     kibble を長く繋ぐと 200 体を超える。全部並べると、実況が画面の
     はるか下まで押し下げられて何も読めなくなるので、
       ・行動が多い順に並べる（＝見て面白い順）
       ・出す行数に上限を置き、溢れた分は「他 N 体」と正確に出す
       ・絞り込み欄で名前の一部から探せる
     クリックすると、その1体だけを再生する（main.js の applyFocus）。 */
  var MAX_ROWS = 40;
  var rosterFilter = '';
  /* 右の欄がいま何の一覧か。'jobs'＝依頼一覧（kibble のように依頼IDを
     持つログ）、'agents'＝エージェント一覧（x402 のサンプルなど、依頼と
     いう概念が無いログ）。文言（見出し・注記・絞り込み欄）はこの区別で
     選ぶ＝依頼の無いログに「依頼をクリック」と出して詰ませない。 */
  var listMode = 'jobs';

  function setRosterFilter(q) { rosterFilter = String(q || '').toLowerCase(); rosterKey = null; listInputKey = null; }

  /* ---- 依頼一覧（2026-09-08）------------------------------------
     追う対象をエージェント1体から依頼1件に変えた。理由は報告そのもの:
     1体を追うと、その子が同時に抱えている複数の依頼が入り乱れ、
     ①〜④が行ったり来たりして人間には追えない。依頼1件なら
     ①→②→③→④は必ず一方通行で、登場人物も2〜3体に減る。

     ①〜④の丸は「その段階の記録が、取得できたログの中にあるか」だけを
     表す。無い段階は灰色のまま＝これから起きる予測ではないし、
     あったことにもしない（分からないことは描かない）。 */
  /* ---- 小さな絵（2026-09-28）----------------------------------------
     右の一覧・ステータス行・HUD で使うドット絵風の SVG。文字の代わり。 */
  var SVG = {
    /* 硬貨＝支払いの件数 */
    coin: '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true">' +
          '<circle cx="6" cy="6" r="5" fill="#2775ca"/><circle cx="6" cy="6" r="3.6" fill="none" stroke="#e8f1ff" stroke-width="1"/>' +
          '<rect x="5.4" y="3.6" width="1.2" height="4.8" fill="#e8f1ff"/></svg>',
    /* 羊皮紙＝依頼の題名（押すと詳細で読める） */
    scroll: '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true">' +
            '<rect x="2" y="2" width="8" height="8" fill="#f1e6c8"/>' +
            '<rect x="1" y="1" width="10" height="2" fill="#c9a86a"/>' +
            '<rect x="1" y="9" width="10" height="2" fill="#c9a86a"/>' +
            '<rect x="3" y="4.5" width="6" height="1" fill="#8a7650"/>' +
            '<rect x="3" y="6.5" width="4.5" height="1" fill="#8a7650"/></svg>',
    /* 羽ペン＝書き込み */
    quill:  '<svg class="ic" viewBox="0 0 12 12" aria-hidden="true">' +
            '<path d="M10.5 1 L4 7.5 L3 10.5 L6 9.5 L11.5 3 Z" fill="#e8eef8"/>' +
            '<path d="M4 7.5 L6 9.5" stroke="#8fa3c0" stroke-width="1"/>' +
            '<rect x="1" y="10.5" width="4" height="1" fill="#8fd0ff"/></svg>',
    /* 札のスタンプと同じ ✗（不合格・失敗）。「×50（50倍）」と読まれないよう、
       スタンプの形の中に入れる。 */
    /* ★ 2026-09-28: 失敗の数の絵を「ひびの入った札＋✗」にする。絵の中の
       不合格の札（黒ずみ＋ひび＋✗）と同じ見た目＝「何が何個か」が、
       文字を読まなくても画面の中の品物と結びつく。 */
    stamp:  '<svg class="ic stamp" viewBox="0 0 14 14" aria-hidden="true">' +
            '<rect x="0.5" y="0.5" width="10" height="12" fill="#8a7f6c" stroke="#14161f"/>' +
            '<rect x="0.5" y="0.5" width="10" height="12" fill="rgba(20,10,8,.45)"/>' +
            '<path d="M3.5 0.5 L5 4 L3.2 6.5 L5.4 9.8 L4.6 12.5 M5 4 L8.4 5.2" ' +
            'stroke="#0a0604" stroke-width="1" fill="none"/>' +
            '<rect x="6.8" y="6.8" width="6.7" height="6.7" fill="#3a1512" stroke="#14161f" stroke-width=".6"/>' +
            '<path d="M8.4 8.4 L11.9 11.9 M11.9 8.4 L8.4 11.9" stroke="#ff6b57" ' +
            'stroke-width="1.4" stroke-linecap="round"/></svg>'
  };

  /** 仕事の種類の小さな札（札と同じ色・同じ絵。形は config.kindIcons）。 */
  function kindChip(kind) {
    var cfg = AQ.config || {};
    var table = cfg.kindIcons || {};
    var colors = cfg.cardColors || {};
    var key = table[kind] ? kind : 'other';
    var col = colors[kind] || colors.other || { fill: '#c6b3ff', ink: '#241a3a' };
    var ink = col.ink, out = '';
    (table[key] || []).forEach(function (sh) {
      if (sh.r) {
        out += '<rect x="' + sh.r[0] + '" y="' + sh.r[1] + '" width="' + sh.r[2] +
               '" height="' + sh.r[3] + '" fill="' + (sh.c ? col.fill : ink) + '"/>';
      } else if (sh.p) {
        var pts = sh.p.map(function (q) { return q[0] + ',' + q[1]; }).join(' ');
        out += '<polygon points="' + pts + '" ' + (sh.s
          ? 'fill="none" stroke="' + ink + '" stroke-width="1.4" stroke-linejoin="round"'
          : 'fill="' + ink + '"') + '/>';
      } else if (sh.l) {
        out += '<line x1="' + sh.l[0] + '" y1="' + sh.l[1] + '" x2="' + sh.l[2] + '" y2="' +
               sh.l[3] + '" stroke="' + ink + '" stroke-width="1.4" stroke-linecap="round"/>';
      }
    });
    /* ★ 2026-09-30: 「星印やハンマーのマークは何を意味していますか？」という
       質問。マウスを乗せたときの説明を、語だけ（「作る」）から
       「依頼の種類：作る」にする＝何の分類なのかまで分かる。 */
    var word = kindLabel(kind) ? AQ.i18n.t('kind.chipTitle', { k: kindLabel(kind) }) : '';
    return '<span class="kchip" style="background:' + esc(col.fill) + '" data-kind="' + esc(key) +
           '" title="' + esc(word) + '"><svg class="ic" viewBox="0 0 12 12" aria-hidden="true">' +
           out + '</svg></span>';
  }

  /** 詳細パネルの先頭に1回だけ置く断り。画面からは（仮）を外したので、
      呼び名がこのアプリの付けたものであることは、ここで必ず言う。 */
  function nickNoteHtml() {
    return '<p class="dnote nicknote">' + esc(AQ.i18n.t('detail.nickNote')) + '</p>';
  }

  /* ---- 記号ボタン（2026-09-28）-------------------------------------
     操作ボタンの文字ラベル（再生・1コマ進む・最初から・詳細・すべて表示・
     依頼から／エージェントから …）をやめ、記号だけにする。
     言葉は捨てない：title（マウスを乗せると出る）と aria-label（読み上げ）
     に移す。見た目から文字は消えるが、迷ったら指を乗せれば読める。 */
  var ICON = {
    'ui.play': '▶', 'ui.pause': '❚❚', 'ui.step': '▶|', 'ui.restart': '↺',
    'ui.connect': '●', 'ui.disconnect': '■', 'ui.catchup': '»|',
    'ui.detail': 'ⓘ', 'ui.focusAll': '◎', 'ui.advanced': '⚙',
    'agents.modeJobs': '▤', 'agents.modeAgents': '☻'
  };
  /** 辞書の値から、先頭の記号（▶ や ＋）を落とした「言葉」だけを取り出す。 */
  function wordOf(key) {
    return String(AQ.i18n.t(key)).replace(/^[^\p{L}\p{N}]+/u, '').trim();
  }
  /* ★ 2026-09-28: 「動きがかくかくする」への対応。
     hud.update() は毎フレーム（1秒に60回）呼ばれ、中身が変わっていなくても
     innerHTML / textContent を書き直していた。DOM を書き換えるたびに
     ブラウザはレイアウトをやり直すので、依頼の多いエージェントほど
     フレームが重くなっていた。前回と同じ中身なら書かない。 */
  function setHTML(node, html) {
    if (!node) return;
    var k = 'h' + html;
    if (node.__aq === k) return;
    node.__aq = k;
    node.innerHTML = html;
  }
  function setText(node, text) {
    if (!node) return;
    var k = 't' + text;
    if (node.__aq === k) return;
    node.__aq = k;
    node.textContent = text;
  }
  function setHidden(node, v) {
    if (!node) return;
    v = !!v;
    if (node.hidden !== v) node.hidden = v;
  }

  function setIcon(node, key) {
    if (!node) return;
    /* 再生ボタンは毎フレーム呼ばれる。同じ絵・同じ言語なら何もしない。 */
    var ik = key + '|' + AQ.i18n.lang;
    if (node.__aqIcon === ik) {
      /* 他の処理が className を丸ごと書き換えることがある（切り替えボタン）。
         見た目の型だけは必ず付け直す（付いていれば何もしない＝DOM は触らない）。 */
      if (node.classList && !node.classList.contains('icon-btn')) node.classList.add('icon-btn');
      return;
    }
    node.__aqIcon = ik;
    node.__aq = null;
    node.textContent = ICON[key] || AQ.i18n.t(key);
    var w = wordOf(key);
    node.title = w;
    node.setAttribute('aria-label', w);
    if (node.classList) node.classList.add('icon-btn');
  }

  /* ①〜④は数字の丸ではなく、点いたり消えたりするランプにする
     （丸数字は「読む」記号、ランプは「見る」記号）。段階の名前は
     マウスを乗せると出る。点いているランプ＝その段階の記録がログにある。 */
  /* ★ 2026-09-28: 4つ並んだ金色の丸が「星4つの評価」「レアリティ」に見える、
     という指摘。線でつないだ道のり（●━●━○━○）にして、点いていない段階は
     中空の輪にする＝左から順に進む「工程」として読める。色も評価を連想する
     金ではなく、進み具合の青にする（緑は画面全体で「合格」の意味なので
     使わない：④が点いていても不合格のことがある）。
     点いている＝その段階の記録がログにある。 */
  function jobStepDots(rec) {
    var t = AQ.i18n.t, s = '';
    for (var n = 1; n <= 4; n++) {
      var on = !!(rec.steps && rec.steps[n]);
      if (n > 1) {
        var prevOn = !!(rec.steps && rec.steps[n - 1]);
        s += '<i class="jlink' + (on && prevOn ? ' has' : '') + '"></i>';
      }
      s += '<i class="jd lamp' + (on ? ' has' : '') + '" title="' +
           esc(t('progress.short' + n)) + '"></i>';
    }
    return '<span class="jdots lamps stepper">' + s + '</span>';
  }

  /** 一覧まわりの文言（注記・絞り込み欄・検索欄）だけを、いまの
      listMode に合わせて入れ替える。relabel() 全体を呼ぶと、テスト
      ハーネスのように一部の要素しか用意していない環境で落ちるので、
      ここに触る要素は必ず個別に存在確認する。 */
  function relabelList() {
    var t = AQ.i18n.t;
    var noteKey = listMode === 'agents' ? 'agents.note'
                : listMode === 'roster' ? 'roster.note' : 'jobs.note';
    var findKey = listMode === 'agents' ? 'agents.find'
                : listMode === 'roster' ? 'roster.find' : 'jobs.find';
    var jobs = (listMode === 'jobs' || listMode === 'agents');
    if (el.rosterNote)   el.rosterNote.textContent = t(noteKey);
    if (el.rosterFilter) {
      el.rosterFilter.placeholder = '⌕';
      el.rosterFilter.title = t(findKey);
      el.rosterFilter.setAttribute('aria-label', t(findKey));
    }
    if (el.focusDid)     el.focusDid.placeholder = t(jobs ? 'ui.jobFind' : 'ui.focusDidPh');
    if (el.focusGo)      el.focusGo.textContent = t(jobs ? 'ui.jobFindGo' : 'ui.focusDidGo');
    setIcon(el.modeJobs, 'agents.modeJobs');
    setIcon(el.modeAgents, 'agents.modeAgents');
  }

  /* ---- エージェントから入る道（2026-09-12）--------------------------
     依頼から入る道（依頼一覧）に加えて、「この子は何をしていたのか」
     から入りたい、という要望。ただし1体は複数の依頼を同時に抱えている
     ので、選んだ瞬間に全部を並べると元の「入り乱れて読めない」画面に
     逆戻りする。だから：
       エージェントを選ぶ → その子が関わった依頼だけの一覧に切り替え、
       代表の1件（分かっている段階がいちばん多いもの）を自動で再生する。
     再生されるのは今までどおり依頼1件なので、画面の作りは1本のまま。 */
  /* ★ 2026-09-28: 一覧は毎フレーム呼ばれる。以前は毎回、全件を絞り込んで
     行の HTML を組み立て、前回の文字列と比べていた（依頼が数百件あると、
     それだけで1フレームが重くなり、動きがかくかくした）。一覧の中身を
     決める入力が同じなら、組み立て自体をしない。 */
  var listSeq = 0;
  function tokenOf(obj) {
    if (!obj) return 'none';
    if (!obj.__aqTok) { try { Object.defineProperty(obj, '__aqTok', { value: 'L' + (++listSeq) }); } catch (e) { return 'L?' + Math.random(); } }
    return obj.__aqTok;
  }
  var listInputKey = null;
  function listKey(parts) {
    return parts.concat([rosterFilter || '', AQ.i18n.lang, numCache.n, listMode]).join('\u0001');
  }

  /** いま扱っている依頼の行に 'now' を付ける（行の作り直しはしない）。 */
  var nowShown = null;
  function markNow(curJob, rebuilt) {
    if (!el.rosterChips || !el.rosterChips.querySelectorAll) return;
    var want = (curJob != null) ? String(curJob) : null;
    if (!rebuilt && want === nowShown) return;
    nowShown = want;
    var prev = el.rosterChips.querySelectorAll('.jrow.now');
    for (var i = 0; i < prev.length; i++) {
      if (prev[i].getAttribute('data-job') !== want) prev[i].classList.remove('now');
    }
    if (want == null) return;
    var rows = el.rosterChips.querySelectorAll('.jrow[data-job]');
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].getAttribute('data-job') === want) { rows[j].classList.add('now'); break; }
    }
  }

  function drawAgentList(agentIndex, focusActor) {
    if (!el.roster) return;
    var t = AQ.i18n.t;
    var list = (agentIndex && agentIndex.list) || [];
    if (!list.length) { setHidden(el.roster, true); return; }
    setHidden(el.roster, false);
    var ik = listKey(['agents', tokenOf(agentIndex), list.length, String(focusActor)]);
    if (ik === listInputKey) return;
    listInputKey = ik;

    var q = rosterFilter;
    var matched = q
      ? list.filter(function (a) {
          var nk = nickActor(a.actor);
          return String(a.actor).toLowerCase().indexOf(q) >= 0 ||
                 (nk && nk.toLowerCase().indexOf(q) >= 0) ||
                 ('#' + numberOf[a.actor]) === q;
        })
      : list;

    var shown = matched.slice(0, MAX_ROWS);
    var hidden = matched.length - shown.length;

    var rows = shown.map(function (a) {
      var actor = a.actor;
      var col = AQ.roster.colorFor(actor);
      var cls = 'jrow agentrow' + ((focusActor != null && actor === focusActor) ? ' focused' : '');
      var thumbUrl = spriteThumb(actor);
      var pic = thumbUrl
        ? '<img class="thumb" width="16" height="20" alt="" src="' + esc(thumbUrl) + '">'
        : '<i class="dot" style="background:' + esc(col) + '"></i>';
      return '<div class="' + cls + '" data-agent="' + esc(actor) + '" ' +
                  'title="' + esc(actor) + '" role="button" tabindex="0">' +
               /* 行が押せることを、文章ではなく印（▶）で示す（変更C）。 */
               '<div class="jline1"><span class="gomark">▶</span>' + pic +
                 '<b class="num" style="color:' + esc(col) + '">#' + (numberOf[actor] || '?') + '</b>' +
                 nickTag(nickActor(actor), 'nick') +
                 '<span class="cnt">' + esc(t('agents.jobCount', { n: a.jobs.length })) + '</span>' +
               '</div>' +
             '</div>';
    }).join('');

    if (hidden > 0) rows += '<div class="jrow more">' + esc(t('agents.more', { n: hidden })) + '</div>';
    if (!matched.length) rows = '<div class="jrow more">' + esc(t('agents.noMatch')) + '</div>';

    var head = esc(t('agents.head', { n: list.length }));
    if (rows + head !== rosterKey) {
      rosterKey = rows + head;
      el.rosterChips.innerHTML = rows;
      if (el.rosterHead) {
        el.rosterHead.textContent = head;
        el.rosterHead.title = t('agents.headTitle', { n: list.length });
      }
      el.rosterNote.textContent = t('agents.note');
    }
  }

  function byIdIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function drawJobList(jobIndex, focusJob, agentFilter, curJob) {
    if (!el.roster) return;
    var t = AQ.i18n.t;
    var list = (jobIndex && jobIndex.list) || [];
    var ik = listKey(['jobs', tokenOf(jobIndex), list.length, String(focusJob), String(agentFilter)]);
    if (ik === listInputKey) { markNow(curJob, false); return; }
    listInputKey = ik;
    /* エージェントで絞っているときは、その子が関わった依頼だけ。
       件数はここで数え直す＝「52件」のような全体の数を出したまま
       中身だけ絞る、という嘘をつかない。 */
    if (agentFilter != null) {
      list = list.filter(function (rec) {
        return AQ.jobs.castOf(rec).indexOf(agentFilter) !== -1;
      });
    }
    if (!list.length) { setHidden(el.roster, true); return; }
    setHidden(el.roster, false);

    var q = rosterFilter;
    var matched = q
      ? list.filter(function (rec) {
          return String(rec.id).toLowerCase().indexOf(q) >= 0 ||
                 (rec.title && String(rec.title).toLowerCase().indexOf(q) >= 0);
        })
      : list;

    var shown = matched.slice(0, MAX_ROWS);
    /* ★ 2026-09-30(2): 選んだ依頼は、一覧の上限（MAX_ROWS）の外へ押し出されても
       必ず行として出す。LIVE で依頼が増えると並び（分かっている段階の数→新しさ）
       が入れ替わり、選んだ行が一覧から消えてしまっていた。 */
    if (focusJob != null && shown.indexOf(byIdIn(matched, focusJob)) === -1 && byIdIn(matched, focusJob)) {
      shown = shown.slice(0, MAX_ROWS - 1).concat([byIdIn(matched, focusJob)]);
    }
    var hidden = matched.length - shown.length;

    var rows = shown.map(function (rec) {
      var state = AQ.jobs.stateOf(rec);
      /* ★ 2026-09-28: いまロボットが扱っている依頼の行を光らせる印（now）は
         行を組み立てたあとで markNow() が付け外しする（コマが変わるたびに
         一覧を丸ごと作り直さないため）。 */
      var cls = 'jrow' + ((focusJob != null && rec.id === focusJob) ? ' focused' : '');
      /* 題名は捏造しない。JOB 行が取得範囲の外だった依頼は、
         IDと「題名は取得範囲の外」だけを出す。 */
      /* ★ 2026-09-28: 題名の英文はそのまま並べず、羊皮紙の絵にする。
         題名はマウスを乗せると出るし、押せば「詳細」で読める
         （＝調べたい人が自分で開く）。題名がログに無い依頼は、羊皮紙を
         灰色にして「取得範囲の外」だと分かるようにする（捏造しない）。 */
      /* ★ 2026-09-28: 呼び名（α4 など）は行に出さず、マウスを乗せたときの
         説明にだけ入れる（「解読不能なコードに見える」という指摘）。 */
      var titleText = (nickJob(rec.id) ? nickJob(rec.id) + ' · ' : '') +
                      (rec.title ? String(rec.title) : (rec.id + ' ' + t('jobs.noTitle')));
      var titleHtml = '<span class="jscroll' + (rec.title ? '' : ' none') + '">' + SVG.scroll + '</span>';
      /* 種類は札と同じ色・同じ絵（金づち・本・吹き出し・星）。 */
      var kindHtml = rec.kind ? kindChip(rec.kind) : '';
      /* 右の欄は横幅が狭い（盤面を優先しているため）。1行に詰め込むと
         題名が数文字で切れて何の依頼か分からなくなるので、2行に分ける:
           1行目 ①〜④の丸・どこまで進んだか・分かっている段階の数
           2行目 種類・題名（ここがいちばん読みたい行なので幅を全部渡す） */
      return '<div class="' + cls + '" data-job="' + esc(rec.id) + '" ' +
                  'title="' + esc(titleText) + '" role="button" tabindex="0">' +
               /* 行が押せることを、文章ではなく印（▶）で示す（変更C）。 */
               /* ★ 2026-09-28: 「判定まで終わっている」「4/4」の文字は外した。
                  4つのランプの点き方が同じことを言っている。 */
               '<div class="jline1"><span class="gomark">▶</span>' + jobStepDots(rec) +
                 /* ★ 2026-10-09: どこまで進んだかを短い言葉でも出す（利用者「文字があるほうが
                    分かりやすい。こちらも既定に」）。丸の点き方と同じことを言う。 */
                 '<span class="jstate jtext" title="' + esc(t('jobs.state.' + state)) + '">' + esc(t('jobs.row.' + state)) + '</span>' +
               '</div>' +
               /* ★ 2026-09-30: 依頼の呼び名（ログに出てきた順の α, β, γ …）を
                  行に戻す（利用者の要望「仕事には名前がついていたと思いますが、
                  これも右の欄に記載してください」）。本物の依頼 ID はマウスを
                  乗せたときの説明と「詳細」にある。 */
               '<span class="jline2">' + kindHtml +
                 (nickJob(rec.id) ? '<b class="jnick">' + esc(nickJob(rec.id)) + '</b>' : '') +
                 titleHtml + '</span>' +
             '</div>';
    }).join('');

    if (hidden > 0) {
      rows += '<div class="jrow more">' + esc(t('jobs.more', { n: hidden })) + '</div>';
    }
    if (!matched.length) {
      rows = '<div class="jrow more">' + esc(t('jobs.noMatch')) + '</div>';
    }

    /* エージェントで絞っているときは、誰で絞っているかと戻り道を上に。 */
    if (agentFilter != null) {
      rows = '<div class="backrow" data-back="1" role="button" tabindex="0">' +
               /* 2026-09-28: 「エージェント一覧へ戻る」の文は ◀ だけにする
                  （言葉はマウスを乗せると出る）。 */
               '<span title="' + esc(t('agents.back')) + '" aria-label="' + esc(t('agents.back')) + '">◀</span>' +
               '<b>' + esc(who(agentFilter)) + ' ' + esc(nickActor(agentFilter)) +
                 esc(t('nick.mark')) + '</b>' +
             '</div>' + rows;
    }

    var head = esc(agentFilter != null
      ? t('agents.jobsHead', { who: who(agentFilter), n: list.length })
      : t('jobs.head', { n: list.length }));
    if (rows + head !== rosterKey) {   // 中身が変わったときだけ書き換える
      rosterKey = rows + head;
      el.rosterChips.innerHTML = rows;
      if (el.rosterHead) {
        el.rosterHead.textContent = head;
        el.rosterHead.title = (agentFilter != null)
          ? t('agents.jobsHeadTitle', { who: who(agentFilter), n: list.length })
          : t('jobs.headTitle', { n: list.length });
      }
      el.rosterNote.textContent = t('jobs.note');
      listRebuilt = true;
    }
    markNow(curJob, true);
  }

  /* ★ 2026-09-30: 選んだ依頼の行を、一覧の中でもっと目立たせ、始動と終了を
     行の中でも見せる（利用者の提案）。ロボットの始動・終了（engine/clock.js の
     phase）と同じ時に、行へ印（class）を付け外しするだけ。
       始動中 … booting（光が行を走り、4つのランプが1つずつ点く）
       終了中 … ending（行とランプが数回光る）
       終了後 … ended（行の右にチェッカーフラッグ。再生がここまで、という印）
     フラッグは「再生がここまで」であって、依頼が終わった・うまくいった、
     という意味ではない（どこまで進んだかはランプが言う）。説明にそう書く。
     状態が変わったときだけ DOM に触る（毎フレームは触らない）。 */
  var listRebuilt = false, phaseKey = null, lastFocusScrolled = null;
  var FLAG_SVG = '<svg class="ic flag" viewBox="0 0 12 12" aria-hidden="true">' +
    '<rect x="1.5" y="1" width="1.2" height="10.5" fill="#cfd6e6"/>' +
    '<rect x="2.7" y="1.5" width="8" height="5.5" fill="#f4f1e4"/>' +
    '<rect x="2.7" y="1.5" width="2" height="1.8" fill="#14161f"/><rect x="6.7" y="1.5" width="2" height="1.8" fill="#14161f"/>' +
    '<rect x="4.7" y="3.3" width="2" height="1.9" fill="#14161f"/><rect x="8.7" y="3.3" width="2" height="1.9" fill="#14161f"/>' +
    '<rect x="2.7" y="5.2" width="2" height="1.8" fill="#14161f"/><rect x="6.7" y="5.2" width="2" height="1.8" fill="#14161f"/></svg>';
  function markFocusPhase(focusJob, phase, playing) {
    if (!el.rosterChips || !el.rosterChips.querySelector) return;
    /* ★ 2026-10-01: 再生中（始動・終了以外で時計が進んでいる間）は active。
       「いまここを処理している」ことを、行の背景の明滅で見せる（止めたら止まる）。 */
    var state = (focusJob == null || !phase) ? 'none'
              : (phase.boot != null) ? 'boot'
              : (phase.end >= 1) ? 'ended'
              : (phase.end > 0) ? 'ending'
              : playing ? 'active' : 'play';
    var key = String(focusJob) + '|' + state + '|' + AQ.i18n.lang;
    if (!listRebuilt && key === phaseKey) return;
    /* LIVE で一覧が作り直されただけ（状態は同じ）なら、印は付け直すが演出は
       繰り返さない（1.5秒ごとに光が走ったり旗が跳ねたりしないように）。 */
    var reapply = (key === phaseKey);
    listRebuilt = false; phaseKey = key;
    var old = el.rosterChips.querySelectorAll('.jrow.booting, .jrow.ending, .jrow.ended, .jrow.steady, .jrow.active');
    for (var i = 0; i < old.length; i++) {
      old[i].classList.remove('booting', 'ending', 'ended', 'steady', 'active');
      var f = old[i].querySelector('.jend'); if (f) f.parentNode.removeChild(f);
    }
    var row = el.rosterChips.querySelector('.jrow.focused');
    if (!row) return;
    if (reapply) row.classList.add('steady');
    /* 選んだ行が一覧の外（スクロールの先）にあると目立たせても見えない。
       選び直したときだけ、行が見えるところまで一覧をスクロールする。 */
    if (lastFocusScrolled !== String(focusJob)) {
      lastFocusScrolled = String(focusJob);
      var box = el.roster;
      if (box && box.getBoundingClientRect && row.getBoundingClientRect) {
        var br = box.getBoundingClientRect(), rr = row.getBoundingClientRect();
        if (rr.top < br.top) box.scrollTop -= (br.top - rr.top) + 6;
        else if (rr.bottom > br.bottom) box.scrollTop += (rr.bottom - br.bottom) + 6;
      }
    }
    if (state === 'boot') row.classList.add('booting');
    else if (state === 'active') row.classList.add('active');
    else if (state === 'ending') row.classList.add('ending');
    else if (state === 'ended') {
      row.classList.add('ended');
      var l1 = row.querySelector('.jline1') || row;
      var sp = document.createElement('span');
      sp.className = 'jend';
      sp.title = AQ.i18n.t('jobs.replayEnded');
      sp.setAttribute('aria-label', AQ.i18n.t('jobs.replayEnded'));
      sp.innerHTML = FLAG_SVG;
      l1.appendChild(sp);
    }
  }


  function drawRoster(beats, index, activeActor, focusActor) {
    if (!el.roster || !AQ.roster) return;
    var t = AQ.i18n.t;
    var r = AQ.roster.build(beats);
    numberOf = r.numberOf;

    if (!r.order.length) { el.roster.hidden = true; return; }
    el.roster.hidden = false;

    /* いまのコマまでを見て、各 actor の最後の行動と行動回数を数える。
       まだ何もしていない actor は「—」。先の話は書かない。 */
    var last = {}, count = {};
    for (var i = 0; i <= index && i < beats.length; i++) {
      var bt = beats[i];
      var who2 = (bt && bt.actor) || 'agent';
      last[who2] = bt;
      count[who2] = (count[who2] || 0) + 1;
    }

    /* 行動が多い順。同数なら登場が早い順（＝番号順）で安定させる。 */
    var sorted = r.order.slice().sort(function (x, y) {
      var d = (count[y] || 0) - (count[x] || 0);
      return d !== 0 ? d : (r.numberOf[x] - r.numberOf[y]);
    });

    var matched = rosterFilter
      ? sorted.filter(function (actor) {
          return String(actor).toLowerCase().indexOf(rosterFilter) >= 0 ||
                 ('#' + r.numberOf[actor]) === rosterFilter;
        })
      : sorted;

    var shown = matched.slice(0, MAX_ROWS);
    var hidden = matched.length - shown.length;

    var rows = shown.map(function (actor) {
      var n    = r.numberOf[actor];
      var col  = AQ.roster.colorFor(actor);
      var tail = String(actor).length > 8 ? String(actor).slice(-6) : String(actor);
      var bt   = last[actor];
      var act  = bt ? t(verbKey(bt)) : DASH;
      var obj  = bt ? object(bt, AQ.state.at(beats, beats.indexOf(bt))) : '';
      var on   = (actor === String(activeActor)) ? ' on' : '';
      var isFocused = (focusActor != null && String(actor) === String(focusActor));
      var cls = 'arow' + on + (isFocused ? ' focused' : '');
      var thumbUrl = spriteThumb(actor);
      var pic = thumbUrl
        ? '<img class="thumb" width="16" height="20" alt="" src="' + esc(thumbUrl) + '">'
        : '<i class="dot" style="background:' + esc(col) + '"></i>';
      return '<div class="' + cls + '" data-actor="' + esc(actor) + '" title="' + esc(actor) + '" ' +
                  'role="button" tabindex="0">' +
               pic +
               '<b class="num" style="color:' + esc(col) + '">#' + n + '</b>' +
               nickTag(nickActor(actor), 'nick') +
               '<span class="doing">' + act + '</span>' +
               '<span class="what">' + obj + '</span>' +
               '<span class="cnt">' + (count[actor] || 0) + '</span>' +
             '</div>';
    }).join('');

    if (hidden > 0) {
      rows += '<div class="arow more">' + esc(t('roster.more', { n: hidden })) + '</div>';
    }
    if (!matched.length) {
      rows = '<div class="arow more">' + esc(t('roster.noMatch')) + '</div>';
    }

    /* ★ 2026-10-02: 見出しの文（「エージェント 1 体 ／ 名前をクリックすると…」）は
       記号と数（☻ 1）にし、文はマウスを乗せると出す（依頼・エージェントの一覧と同じ）。 */
    var head = t('agents.head', { n: r.order.length });

    if (rows + head !== rosterKey) {   // 中身が変わったときだけ書き換える
      rosterKey = rows + head;
      el.rosterChips.innerHTML = rows;
      if (el.rosterHead) {
        el.rosterHead.textContent = head;
        el.rosterHead.title = t('roster.head', { n: r.order.length });
      }
      el.rosterNote.textContent = t('roster.note');
    }
  }

  function detailField(labelKey, rawValue) {
    var t = AQ.i18n.t;
    var v = (rawValue == null || rawValue === '') ? t('detail.none') : esc(String(rawValue));
    return '<div class="drow"><span class="dlabel">' + esc(t(labelKey)) + '</span>' +
           '<span class="dval">' + v + '</span></div>';
  }

  function detailEvent(e, n) {
    var t = AQ.i18n.t, m = e.meta || {};
    var tSrc = (m.tSource === 'server') ? t('detail.tServer')
             : (m.tSource === 'estimated') ? t('detail.tEstimated')
             : t('detail.none');
    /* 2026-09-11: 括弧まで日本語（全角）で組み立てていたので、英語画面に
       日本語の記号が混ざっていた。囲み方も辞書に持たせる。 */
    var tVal = e.t ? t('detail.tWrap', { iso: new Date(e.t).toISOString(), src: tSrc }) : tSrc;
    var signed = (m.signed === true) ? t('detail.signedYes')
               : (m.signed === false) ? t('detail.signedNo')
               : t('detail.none');
    /* 本文は「持っている中で一番長い、切り詰めていないもの」を出す。
       kibble のアダプタは meta.raw に元行を丸ごと残しているので、
       それがあれば最優先（DELIVER/ATTEST は表の item/say を60文字で
       切り詰めているため）。無ければ say → item の順にフォールバック。 */
    var text = (m.raw != null && m.raw !== '') ? m.raw : (e.say || e.item || '');
    return '<div class="devent"><p class="dhead">#' + n + ' <code>' + esc(e.type) + '</code></p>' +
      detailField('detail.t', tVal) +
      /* ★ 2026-09-11: 画面に出している「呼び名（仮）」と、本物のIDを
         必ず並べて出す。呼び名はこのアプリが付けたラベルなので、
         それが何のIDを指しているのかを確かめる場所がここしかない。 */
      detailField('detail.nickActor', nickActor(e.actor)) +
      detailField('detail.actor', e.actor) +
      detailField('detail.target', e.target) +
      detailField('detail.nickJob', m.job ? nickJob(m.job) : null) +
      detailField('detail.job', m.job) +
      /* 2026-09-06: 生の kind スラッグ（build 等）は ja 画面でも
         英単語のまま出ていた（i18n 原則からの逸脱）。訳語があれば
         それを、無い（自由文字列で未知の）kind はそのまま出す。 */
      detailField('detail.kind', kindLabel(m.kind)) +
      detailField('detail.seq', m.seq) +
      detailField('detail.signed', signed) +
      detailField('detail.text', text) +
      '</div>';
  }

  var lastDetailBeat = null;   // 同じコマの間は作り直さない
  var detailJobKey = null;     // いま詳細に出している依頼（と件数）

  function renderDetail(b, jobRec, agentStory2, agentStats) {
    if (!el.detailBody) return;
    /* ★ 2026-09-28: エージェントを選ぶと、その子の代表の依頼1件を再生する
       ようになった。詳細には、その子の段階ごとの内訳（正確な件数と依頼ID）を
       先に、いま再生している依頼の関係者（呼び名と本物のID）をその下に出す。
       画面から ID を消したぶん、ここで必ず確かめられるようにする。 */
    if (!agentStory2 && jobRec && agentStats) {
      var ckey = 'agent+job/' + agentStats.starring + '/' + (agentStats.events || []).length +
                 '/' + jobRec.id + '/' + (jobRec.events || []).length;
      if (ckey === detailJobKey) return;
      detailJobKey = ckey;
      lastDetailBeat = null;
      showAgentDetail(agentStats, agentStats.starring, jobRec);
      return;
    }
    /* エージェントの「まとめ」を見ているときは、その子の全記録を出す。 */
    if (agentStory2) {
      var akey = 'agent/' + agentStory2.starring + '/' + (agentStory2.events || []).length;
      if (akey === detailJobKey) return;
      detailJobKey = akey;
      lastDetailBeat = null;
      showAgentDetail(agentStory2, agentStory2.starring);
      return;
    }
    /* ★ 2026-09-09: 依頼を追っている間、詳細は「その依頼の全記録」を出す。
       画面のほうは各段階の代表1体しか出さなくなったので、落とした分を
       確かめる場所が要る。ここを毎コマ「このコマの中身」で上書きすると、
       その確かめる場所が無くなる（再生中は1秒で消えていた）。 */
    if (jobRec) {
      var key = jobRec.id + '/' + ((jobRec.events || []).length);
      if (key === detailJobKey) return;
      detailJobKey = key;
      lastDetailBeat = null;
      showJobDetail(jobRec.id, jobRec.events || [], jobRec);
      return;
    }
    detailJobKey = null;
    if (b === lastDetailBeat) return;
    lastDetailBeat = b;
    var t = AQ.i18n.t;
    var events = (b && b.events) || [];
    if (el.detailTitle) el.detailTitle.textContent = t('ui.detailTitle', { n: events.length });
    el.detailBody.innerHTML = nickNoteHtml() + (events.length
      ? events.map(function (e, i) { return detailEvent(e, i + 1); }).join('')
      : '<p class="dempty">' + esc(t('ui.detailEmpty')) + '</p>');
  }

  /** ★ 2026-09-06: 札クリック用。ある仕事（jobId）に関わる全イベントを
      詳細パネルに時系列で出す。events は main.js が渡す（描画側は
      ログ全体を持っていないため）。無い段階は作らない＝拾えたものだけ。 */
  /** ★ 2026-09-12(3): 画面（実況）から外した「正確なところ」を、ここに
      まとめて出す。段階ごとに、やった人を全員（#番号・呼び名・DID全体）。
      画面には代表1体しか出さない・エージェントを選んだときはその子の
      段階しか出さないので、その分を確かめる場所がここになる。 */
  function jobWhoBlock(rec) {
    if (!rec || !rec.cast) return '';
    var t = AQ.i18n.t, c = rec.cast;
    var roles = [
      { n: 1, list: c.poster ? [c.poster] : [] },
      { n: 2, list: c.claimers || [] },
      { n: 3, list: c.deliverers || [] },
      { n: 4, list: c.judges || [] }
    ];
    var glyphs = ['①', '②', '③', '④'];
    var rows = roles.map(function (r) {
      /* ラベルは短い形。帯（①〜④）の「{who} が引き受けた」を
         ここに並べると、値（本人）と二重になって読めない。 */
      var label = glyphs[r.n - 1] + ' ' + t('progress.short' + r.n);
      var val = r.list.length
        ? r.list.map(function (a) {
            return esc(who(a)) + ' ' + esc(nickActor(a)) + esc(t('nick.mark')) +
                   ' <code>' + esc(a) + '</code>';
          }).join('<br>')
        /* ★ 2026-09-17: 「—」ではなく「不明」と書く。画面の帯で
           「Xエージェント」と出した段階が、詳細でどう扱われているかを
           はっきりさせる（推測で埋めていないことを見せる）。 */
        : '<span class="dunknown">' + esc(t('jobs.detailUnknown')) + '</span>';
      return '<div class="drow"><span class="dlabel">' + esc(label) + '</span>' +
             '<span class="dval">' + val + '</span></div>';
    }).join('');
    return '<div class="devent whoblock"><p class="dhead">' + esc(t('jobs.detailWho')) + '</p>' +
             rows +
             detailField('detail.nickJob', nickJob(rec.id)) +
             detailField('detail.job', rec.id) +
             detailField('jobs.detailTitle', rec.title) +
             detailField('jobs.detailCounts',
               t('jobs.detailCountsVal', { events: (rec.events || []).length, known: rec.known })) +
           '</div>';
  }

  /** エージェントの「まとめ」の裏側（正確なところ）。段階ごとに
      何件・どの依頼か、そしてその子の全記録。画面のほうは件数と例だけ
      なので、確かめる場所はここになる。 */
  function agentDetailBlock(story2, actor) {
    if (!story2) return '';
    var t = AQ.i18n.t;
    var glyphs = ['①', '②', '③', '④'];
    var rows = [1, 2, 3, 4].map(function (n) {
      var ids = (story2.jobsOf && story2.jobsOf[n]) || [];
      var val = ids.length
        ? esc(t('agents.count', { n: story2.counts[n] })) + '　' +
          ids.map(function (id) {
            return esc(nickJob(id)) + '<code>' + esc(id) + '</code>';
          }).join('、')
        : esc(t('detail.none'));
      return '<div class="drow"><span class="dlabel">' +
               esc(glyphs[n - 1] + ' ' + t('progress.step' + n)) + '</span>' +
             '<span class="dval">' + val + '</span></div>';
    }).join('');
    return '<div class="devent whoblock"><p class="dhead">' +
             esc(t('agents.detailHead')) + '</p>' +
             detailField('detail.nickActor', nickActor(actor)) +
             detailField('detail.actor', actor) +
             rows +
           '</div>';
  }

  function showAgentDetail(story2, actor, playingRec) {
    if (!el.detailBody) return;
    var t = AQ.i18n.t;
    lastDetailBeat = null;
    if (el.detailTitle) {
      el.detailTitle.textContent = t('agents.detailTitle',
        { who: who(actor) + ' ' + nickActor(actor) + t('nick.mark'),
          n: (story2.events || []).length });
    }
    el.detailBody.innerHTML = nickNoteHtml() + agentDetailBlock(story2, actor) +
      (playingRec ? jobWhoBlock(playingRec) : '') +
      (story2.events || []).map(function (e, i) { return detailEvent(e, i + 1); }).join('');
  }

  function showJobDetail(jobId, events, rec) {
    if (!el.detailBody) return;
    var t = AQ.i18n.t;
    lastDetailBeat = null;           // 通常の「このコマの中身」表示と競合させない
    /* 見出しにも「呼び名（仮）」と本物のIDの両方を出す。 */
    if (el.detailTitle) {
      el.detailTitle.textContent = t('ui.jobDetailTitle', {
        nick: nickJob(jobId) + t('nick.mark'), job: jobId
      });
    }
    el.detailBody.innerHTML = nickNoteHtml() + (rec ? jobWhoBlock(rec) : '') + (events.length
      ? events.map(function (e, i) { return detailEvent(e, i + 1); }).join('')
      : '<p class="dempty">' + esc(t('ui.detailEmpty')) + '</p>');
  }

  AQ.hud = {
    /** 札クリックから呼ぶ（main.js）。 */
    showJobDetail: showJobDetail,

    /** 一覧の絞り込み欄（main.js が input で呼ぶ）。 */
    setRosterFilter: setRosterFilter,

    /** 新しいログを読み込んだ・エージェントを選び直したとき（task 3）に
        main.js から呼ぶ。「別の依頼に切り替わりました」の判定が、無関係な
        前回の記憶と誤って比べないようにする。 */
    resetProgressTracking: resetProgressTracking,

    /** クリックで1件に絞り込みたいとき、main.js がここへ関数を差し込む
        （依頼IDを1つ受け取る）。既定は何もしない。 */
    onJobRequest: null,

    /** 依頼IDを持たないログ用（従来の名簿の行クリック）。 */
    onFocusRequest: null,

    /** エージェント一覧の行クリック（依頼のあるログ）。 */
    onAgentRequest: null,
    /** 「◀ エージェント一覧へ戻る」のクリック。 */
    onAgentBack: null,

    init: function (map) {
      el = map;
      /* 描き先が替わった＝「前回と同じなら書かない」の記憶は捨てる。 */
      lastWinKey = null; listInputKey = null; nowShown = null; rosterKey = null;
      phaseKey = null; lastFocusScrolled = null; listRebuilt = true;
      if (el.rosterChips) {
        el.rosterChips.addEventListener('click', function (ev) {
          if (!ev.target || !ev.target.closest) return;
          var jrow = ev.target.closest('.jrow[data-job]');
          if (jrow) {
            var job = jrow.getAttribute('data-job');
            if (job != null && AQ.hud.onJobRequest) AQ.hud.onJobRequest(job);
            return;
          }
          var back = ev.target.closest('.backrow[data-back]');
          if (back) { if (AQ.hud.onAgentBack) AQ.hud.onAgentBack(); return; }
          var agrow = ev.target.closest('.agentrow[data-agent]');
          if (agrow) {
            var ag = agrow.getAttribute('data-agent');
            if (ag != null && AQ.hud.onAgentRequest) AQ.hud.onAgentRequest(ag);
            return;
          }
          var arow = ev.target.closest('.arow[data-actor]');
          if (arow) {
            var actor = arow.getAttribute('data-actor');
            if (actor != null && AQ.hud.onFocusRequest) AQ.hud.onFocusRequest(actor);
          }
        });
      }
    },

    /**
     * @param b       いま表示するコマ（beat）
     * @param p       このコマの進捗（0〜1）
     * @param st      AQ.state.at() の戻り値
     * @param stats   aggregate.js の { shown, total }
     * @param clock   AQ.Clock（再生対象＝focus中は絞られた beats を持つ）
     * @param ctx     省略可。{ fullBeats, trueIndex, focusActor, prompt }
     *   focus（task E）中は clock.beats が絞られた部分列になるため、
     *   名簿の番号付け・「最後の行動」・コマ番号の表示は必ずログ全体
     *   （fullBeats）とその中での本当の位置（trueIndex）から作る。
     *   指定が無ければ clock からそのまま補う（focus していないとき）。
     *   prompt（task 1）: 'select'＝まだ誰も選んでいない、'ended'＝
     *   選んでいたエージェントの記録を再生し終えた。どちらも実況欄を
     *   通常の story()/raw() の代わりに呼びかけの文言に差し替え、
     *   名簿を光らせる（css の .roster.awaiting）。main.js がいつ
     *   どちらを渡すか決める＝ここは受け取った状態を表示するだけ。
     */
    update: function (b, p, st, stats, clock, ctx) {
      if (!b) return;
      var t = AQ.i18n.t;
      ctx = ctx || {};
      var fullBeats  = ctx.fullBeats || clock.beats;
      var trueIndex  = (ctx.trueIndex != null) ? ctx.trueIndex : clock.index;
      var focusActor = (ctx.focusActor != null) ? ctx.focusActor : null;
      var focusJob   = (ctx.focusJob != null) ? ctx.focusJob : null;
      var prompt     = ctx.prompt || null;

      /* #番号（見出し・面々の行で使う）はログ全体から決める。一覧の
         中身は依頼になったが、番号の割り当て規則は今までどおり
         「ログ全体での登場順」＝画面のどこを見ても同じ番号。 */
      /* ★ 2026-09-28: 毎フレーム全コマをなめて番号を作り直していた（数千コマの
         ログでは、それだけでフレームが重くなる）。コマ列が変わったときだけ。 */
      if (AQ.roster && (numCache.beats !== fullBeats || numCache.n !== fullBeats.length)) {
        numCache = { beats: fullBeats, n: fullBeats.length };
        numberOf = AQ.roster.build(fullBeats).numberOf;
      }
      /* 依頼IDを持たないログ（x402 のサンプルなど）では依頼一覧が空になる。
         そのときは今までどおりエージェント一覧を出す＝選ぶ手段が
         画面から消えて何も再生できなくなる、という詰みを作らない。 */
      var hasJobs = !!(ctx.jobIndex && ctx.jobIndex.list && ctx.jobIndex.list.length);
      /* 一覧に何を出すか。'jobs'＝依頼一覧（エージェントで絞っていれば
         その子の依頼だけ）、'agents'＝エージェント一覧、
         'roster'＝依頼IDを持たないログ用の従来の名簿。 */
      var mode = !hasJobs ? 'roster' : (ctx.listMode === 'agents' ? 'agents' : 'jobs');
      if (listMode !== mode) {
        listMode = mode;
        rosterKey = null;                       // 一覧の作り替えを強制する
        listInputKey = null;
        relabelList();                          // 一覧まわりの文言だけ入れ替える
      }
      var curJobNow = (!prompt && b && b.lead && b.lead.meta && b.lead.meta.job != null)
        ? b.lead.meta.job : null;
      if (mode === 'jobs') { drawJobList(ctx.jobIndex, focusJob, ctx.agentFilter, curJobNow); markFocusPhase(focusJob, ctx.phase, ctx.playing); }
      else if (mode === 'agents') drawAgentList(ctx.agentIndex, ctx.agentFilter);
      else drawRoster(fullBeats, trueIndex, prompt ? null : b.actor, focusActor);

      if (el.roster) {
        /* classList.remove は、付いていなくても属性を書き直す（＝毎フレームの
           DOM 書き換えになる）。付け外しが要るときだけ触る。 */
        var aw = !!prompt;
        if (el.roster.classList && el.roster.classList.contains('awaiting') !== aw) {
          el.roster.classList.toggle('awaiting', aw);
        }
      }

      /* 実況の枠が隠れているとき（支払いの無いログ）は、中身をコマが変わった
         ときだけ作る（毎フレーム作り直しても誰にも見えない）。 */
      /* ★ 2026-10-02: 実況の枠（①〜⑤の帯と文）は入門（作り話のデモ＝説明が目的）
         のときだけ。本物の支払いのログ（ウォレットを入れたとき等）では出さない
         （報告「ウォレットを入れてみたが、文字での説明になる」）。段階は下の
         ステータス欄の5つのランプが言い、言葉はマウスを乗せると出る。 */
      var keepWin0 = !!ctx.isIntro;
      /* 実況の文は「運んでいる最中（p < WALK_UNTIL_HUD）」かどうかでだけ p に
         左右される（進行形／完了形）。その境目もキーに入れる。 */
      var winKey = b.index + '|' + prompt + '|' + AQ.i18n.lang + '|' + String(ctx.focusJob) + '|' +
                   String(ctx.agentFilter) + '|' + (p != null && p < WALK_UNTIL_HUD ? 'w' : 'd') + '|' + String(st && st.failed);
      var doWin = keepWin0 || winKey !== lastWinKey;
      lastWinKey = winKey;
      if (!doWin) {
        /* 何もしない */
      } else if (prompt === 'select') {
        var selKey = (listMode === 'jobs') ? 'ui.chooseJob' : 'ui.chooseAgent';
        var selRaw = (listMode === 'jobs') ? 'ui.chooseJobRaw' : 'ui.chooseAgentRaw';
        setHTML(el.win, '<div class="prompt-select">' + esc(t(selKey)) + '</div>');
        setHTML(el.raw, '<span class="dim">' + esc(t(selRaw)) + '</span>');
      } else if (prompt === 'ended') {
        /* ★ 2026-09-08: 最後のコマを「ここまでです」で置き換えない。
           依頼を追っていると、最後のコマは④判定＝いちばん見たい場面
           そのもの。以前はここで実況ごと差し替えていたため、判定が
           出た瞬間に画面から消えていた。実況はそのまま出し、
           「記録はここまで」は下に1行そえるだけにする。 */
        /* エージェントから入っているときは「この子の出番はここまで」。
           「別の依頼を選んでください」だけだと、その子の他の依頼が
           右の一覧にあることが伝わらない。 */
        /* ★ 2026-09-13: 入門は1体しか出てこないので「別のエージェントを
           選んでください」では次にすることが分からない。 */
        var endKey = ctx.isIntro ? 'x402.introEnd'
                   : (listMode !== 'jobs') ? 'ui.actorEnded'
                   : (ctx.agentStory) ? 'agents.summaryEnd'
                   : (ctx.agentFilter != null) ? 'agents.ended' : 'ui.jobEnded';
        var endedN = (focusActor != null && numberOf[focusActor]) || '?';
        setHTML(el.win, story(b, st, { fullBeats: fullBeats, jobRec: ctx.jobRec, p: p,
                                          jobStory: ctx.jobStory, agentStory: ctx.agentStory }) +
          '<p class="prompt-ended">' +
            esc(t(endKey, { n: endedN,
                            who: (ctx.agentFilter != null)
                              ? (who(ctx.agentFilter) + ' ' + nickActor(ctx.agentFilter) + t('nick.mark'))
                              : '' })) + '</p>');
        /* 生ログ側はこのコマの事実だけ（「ここまでです」は実況側に1行
           出ているので、下段まで増やすと縦が伸びるだけで情報は増えない）。 */
        setHTML(el.raw, raw(b, st));
      } else {
        setHTML(el.win, story(b, st, { fullBeats: fullBeats, jobRec: ctx.jobRec, p: p,
                                          jobStory: ctx.jobStory, agentStory: ctx.agentStory }));
        setHTML(el.raw, raw(b, st));
      }
      renderDetail(b, ctx.jobRec, ctx.agentStory, ctx.agentStats);

      /* ★ 2026-09-28: 画面下の黒いテロップ枠を撤廃。
         「画面の中でいちばん強く自己主張している、読ませる要素」という
         指摘。何をしているかは、ロボットの頭上の絵（向かう先の家具の
         看板と同じ絵）と進み具合のゲージが伝える（render/room.js の
         drawStatusBadge）。誰が・どの依頼か・ログの原文は「詳細」に
         全部残っている（renderDetail は今までどおり毎コマ更新する）。
         ただし支払いのあるログ（x402 の入門・街）では残す。そこでは枠の
         中に x402 の①〜⑤の道すじが出る＝このアプリの目的そのもので、
         絵だけでは「402 が返って、署名して、立会人が確定した」は伝わらない。 */
      /* ★ 2026-10-05 確認: ウォレットでは出さない（2026-10-02 の利用者の指摘「ウォレットを入れたら
         文字での説明になる」への対応を守る）。説明はコマンドの「しらべる」で1行ずつ見られる。 */
      var keepWin = !!ctx.isIntro;
      if (el.win) setHidden(el.win, !keepWin);
      if (el.raw) setHidden(el.raw, !keepWin);

      /* ★ 2026-09-13: 画面右（一覧の下）の読み方メモ。
         まとめ（件数）を出しているときだけ、「①〜④は依頼1件が通る
         道すじで、1体が4つ全部をやるとはかぎらない」を置く。
         実況の足もとに置いていたときは、①〜④の行の直下に長い一文が
         並んで肝心の段階が読めなくなっていた（利用者の指摘）。 */
      if (el.sideNote) {
        var sideHtml = '';
        /* ★ 2026-09-13: x402 の段階の「なぜ」。①〜⑤の帯は何が起きたかを
           言うだけなので、初心者がいちばん知りたい「なぜそうなるのか」を
           ここに1つだけ置く（画面の文字を増やさないため、いまの段階の
           ぶんだけ）。「x402ってなに？」への答えは実質ここにある。 */
        /* 右の「なぜ」の説明も入門のときだけ（本物のログでは文字を出さない）。 */
        var xs2 = (prompt === 'select' || !ctx.isIntro) ? 0 : x402StepOf(b, fullBeats);
        if (!xs2 && ctx.isIntro && b.kind === 'end') {
          /* 最後のコマは「で、結局なんだったのか」を1つだけ置く。
             ここで画面を空にすると、通して見た人が持ち帰るものが無い。 */
          sideHtml = '<b>' + esc(t('x402.recapHead')) + '</b>' + esc(t('x402.recap'));
        } else if (xs2) {
          sideHtml = '<b>' + esc(X402_GLYPH[xs2 - 1] + ' ' + t(X402_KEYS[xs2 - 1])) + '</b>' +
                     esc(t(x402WhyKey(b, xs2)));
        }
        /* ★ 2026-09-27: 「①〜④の読み方」のメモはここから外した
           （利用者の指摘「右に余計な説明がありますが、それも削除して
           ください」）。①〜④の帯そのものを実況から外したので、その
           読み方を説明する相手がもう画面に無い。この欄に残るのは
           x402 の「なぜ」だけ＝押したときにだけ文字が出る。 */
        setHidden(el.sideNote, !sideHtml);
        setHTML(el.sideNote, sideHtml);
      }

      if (el.focusStat) {
        if (focusJob != null || ctx.agentFilter != null) {
          setHidden(el.focusStat, false);
          /* 代表だけを再生しているときは、その事実と、この依頼が本当は
             何コマ・何件あるのかを必ず並べて出す（数を小さく見せない）。 */
          /* ★ 2026-09-12(3): ここは1行の短い説明だけにする。
             コマ数・件数の内訳は「詳細」に移した（数字が並ぶほど
             読まれなくなる、という報告への対応）。 */
          /* ★ 2026-09-28: 依頼1件のときの「この依頼だけを再生中」は出さない。
             右の一覧で金色に光っている行が同じことを言っている。
             エージェントのまとめのときだけは残す：まとめは時系列の再生では
             ないので、それを書かないと実際の順番だと誤解させる。 */
          var statText = '';
          if (ctx.agentFilter != null && ctx.agentIndex && ctx.agentIndex.byId) {
            var ent = ctx.agentIndex.byId[ctx.agentFilter];
            if (ent) {
              /* まとめであることを必ず書く（時系列の再生ではない）。 */
              /* ★ 2026-09-28: 文の羅列をやめ、RPG のステータス欄の形にする：
                   顔（右の一覧と同じ姿）＋ #番号 呼び名 ＋ 羊皮紙×依頼数 ＋ 羽ペン×書き込み数。
                 数そのものは今までと同じ（事実は変えない）。「これはまとめで
                 時系列の再生ではない」という断りは、欄の形（ステータス表）が
                 言う＋マウスを乗せると文で出る。 */
              var stats2 = ctx.agentStats || ctx.agentStory;
              var nJobs = ent.jobs.length, nWrites = (stats2 ? stats2.total : 0);
              var thumb = spriteThumb(ctx.agentFilter);
              /* ★ 2026-09-28: いまこのコマで扱っている札（種類の絵＋呼び名）を
                 顔の横に添える。頭上の吹き出し・札の下の呼び名と同じもの。
                 依頼に属さないコマ（書き込み）では出さない。 */
              var heldHtml = '';
              var bmeta = (b && b.lead && b.lead.meta) || {};
              if (bmeta.job != null) {
                var hrec = (ctx.jobIndex && ctx.jobIndex.byId) ? ctx.jobIndex.byId[bmeta.job] : null;
                var hnick = nickJob(bmeta.job);
                /* 持ち物（装備枠）：四角い枠の中に札を1枚ポンと置く。呼び名（ID）は
                   出さない（マウスを乗せると出る）。 */
                heldHtml = '<span class="held slot" title="' + esc(t('agents.statHeld') +
                  (hnick ? ' · ' + hnick : '')) + '">' +
                  kindChip(hrec ? hrec.kind : null) + '</span>';
              }
              statText = t('agents.summaryLine', {
                who: who(ctx.agentFilter) + ' ' + nickActor(ctx.agentFilter),
                jobs: nJobs, n: nWrites
              });
              var statHtml = '<span class="statcard" title="' + esc(statText) + '">' +
                (thumb ? '<img class="thumb" width="16" height="20" alt="" src="' + esc(thumb) + '">' : '') +
                '<b class="num">' + esc(who(ctx.agentFilter)) + '</b>' +
                '<span class="nick">' + esc(nickActor(ctx.agentFilter)) + '</span>' +
                heldHtml +
                '<span class="stat" title="' + esc(t('agents.statJobs')) + '">' + SVG.scroll +
                  '<b>' + nJobs + '</b></span>' +
                '<span class="stat" title="' + esc(t('agents.statWrites')) + '">' + SVG.quill +
                  '<b>' + nWrites + '</b></span>' +
              '</span>';
            }
          }
          if (typeof statHtml === 'string' && statHtml) setHTML(el.focusStat, statHtml);
          else setText(el.focusStat, statText);
          setHidden(el.focusStat, !statText);
        } else if (focusActor != null && hasPayments(fullBeats) && !ctx.isIntro) {
          /* ★ 2026-10-02: 支払いのログ（ウォレット）を追っているときのステータス欄。
             顔 ＋ #番号 ＋ 名前（ウォレットなら短いアドレスそのもの）＋
             x402 の5つの段階のランプ ＋ 支払いの件数。文の羅列はしない。
             ランプ：点いている＝その段階がこのログに記録されている。
                     輪で囲んだランプ＝いまのコマの段階。
             記録の無い段階は中空のまま（起きたかどうか分からないことは点けない）。 */
          setHidden(el.focusStat, false);
          var fnP = numberOf[focusActor] || '?';
          var seenSteps = x402Seen(fullBeats);
          var curStep = prompt ? 0 : x402StepOf(b, fullBeats);
          var lamps = '';
          for (var si = 1; si <= 5; si++) {
            if (si > 1) lamps += '<i class="jlink' + (seenSteps[si] && seenSteps[si - 1] ? ' has' : '') + '"></i>';
            lamps += '<i class="jd lamp' + (seenSteps[si] ? ' has' : '') + (curStep === si ? ' cur' : '') +
                     '" title="' + esc(X402_GLYPH[si - 1] + ' ' + t(X402_KEYS[si - 1]) +
                       (seenSteps[si] ? '' : ' — ' + t('x402.notInLog'))) + '"></i>';
          }
          var nPay = paymentsOf(fullBeats, focusActor);
          var thumbP = spriteThumb(focusActor);
          var payHtml = '<span class="statcard paycard" title="' + esc(t('x402.statTitle', { who: '#' + fnP + ' ' + nickActor(focusActor) })) + '">' +
            (thumbP ? '<img class="thumb" width="16" height="20" alt="" src="' + esc(thumbP) + '">' : '') +
            '<b class="num">#' + esc(String(fnP)) + '</b>' +
            '<span class="nick">' + esc(nickActor(focusActor)) + '</span>' +
            '<span class="jdots lamps stepper x402steps" title="' + esc(t('x402.stepsTitle') +
              (fromChainLog(fullBeats) ? '\n' + t('x402.chainNote') : '')) + '">' + lamps + '</span>' +
            '<span class="stat" title="' + esc(t('x402.payCount')) + '">' + SVG.coin + '<b>' + nPay + '</b></span>' +
          '</span>';
          setHTML(el.focusStat, payHtml);
        } else if (focusActor != null) {
          var fn = numberOf[focusActor] || '?';
          setHidden(el.focusStat, false);
          setText(el.focusStat, t('ui.focusStat',
            { n: fn, shown: clock.beats.length, total: fullBeats.length }));
        } else {
          setHidden(el.focusStat, true);
          setText(el.focusStat, '');
        }
      }

      /* 支払いの記録が1件も無いログ（掲示板だけのログ）で USDC・CREDITS
         を出しても、意味の無い語が並ぶだけで初心者の邪魔にしかならない。
         x402 の道すじを出すかどうかと同じ判定でまとめて隠す。 */
      var hasPay = hasPayments(fullBeats);
      if (el.hudUsdc)    setHidden(el.hudUsdc, !hasPay);
      if (el.hudCredits) setHidden(el.hudCredits, !hasPay);
      /* RETRIES は「上限が宣言されているとき」だけ意味を持つ語。
         宣言が無いログでは語だけ落として、失敗の件数という事実は残す。 */
      if (el.retriesLbl) setHidden(el.retriesLbl, !st.hasRetries);
      if (el.hudRetries) setHidden(el.hudRetries, (!st.hasRetries && !(st.failed > 0)));

      /* USDC: 宣言された予算があれば残高。無くても支払いがあれば「使った額」だけ。
         どちらも無ければ分からないので — 。 */
      if (st.hasBudget) {
        setText(el.usdc, fmt(st.usdc));
      } else if (st.paid > 0) {
        setText(el.usdc, '-' + fmt(st.spent));
      } else {
        setText(el.usdc, DASH);
      }

      /* CREDITS: 宣言が無ければ何も数えない。 */
      setText(el.credits, st.hasCredits ? st.credits : DASH);

      /* RETRIES: 宣言された上限があれば「残り/上限」。無くても失敗があれば件数だけ。 */
      if (st.hasRetries) {
        setText(el.retries, st.retries + '/' + AQ.state.start.retries);
      } else if (st.failed > 0) {
        /* ★ 2026-09-28: 「✗ 50」は「×50（50倍）」とも読める。札のスタンプと
           同じ形の中に✗を入れて、失敗の印だと分かるようにする。 */
        setHTML(el.retries, SVG.stamp + '<span class="n">' + st.failed + '</span>');
      } else {
        setText(el.retries, DASH);
      }
      /* ★ 2026-09-27: 合否の色を画面の隅まで同じにする。失敗の件数は
         札の✗と同じ赤にする（緑＝合格・赤＝不合格を、絵の中でも
         HUD でも1つの決まりにする）。 */
      if (el.hudRetries) {
        var hrc = (!st.hasRetries && st.failed > 0) ? 'bad' : '';
        if (el.hudRetries.className !== hrc) el.hudRetries.className = hrc;
        var hrt = t('hud.failedTitle');
        if (el.hudRetries.title !== hrt) el.hudRetries.title = hrt;
      }

      setText(el.showing, t('ui.showing', { shown: stats.shown, total: stats.total }));
      /* コマ番号は「ログ全体の中での本当の位置」を出す（focus 中でも
         b.index は常にログ全体（fullBeats）での位置なので、これだけで
         focus の有無に関わらず正しい）。何体ぶんだけ再生しているかは
         上の focusStat が別に正直に出す。 */
      setText(el.beat, t('ui.beat', { i: b.index + 1, n: fullBeats.length }));

      if (el.scrub && document.activeElement !== el.scrub) {
        // scrub バーは「いま再生している列（clock.beats）」の上の位置。
        // focus 中は絞られた列なので、b.index（ログ全体での位置）ではなく
        // clock.index（その列の中での位置）を使う。
        var smax = String(Math.max(0, clock.beats.length - 1)), sval = String(clock.index);
        if (el.scrub.max !== smax) el.scrub.max = smax;
        if (el.scrub.value !== sval) el.scrub.value = sval;
      }
    },

    setIcon: setIcon,
    kindTitle: kindTitle,
    esc: esc,

    relabel: function () {
      var t = AQ.i18n.t;
      setIcon(el.step, 'ui.step');
      setIcon(el.restart, 'ui.restart');
      /* 速度の選択欄は「0.5×」と数字で出るので、見出しの文字は要らない。 */
      el.speedLbl.textContent = '';
      el.speedLbl.title = t('ui.speed');
      el.openLbl.textContent  = t('ui.open');
      el.runLbl.textContent   = t('ui.run');
      relabelList();
      setIcon(el.focusAll2, 'ui.focusAll');
      if (el.drophint) el.drophint.textContent = t('ui.drop');
      setIcon(el.advancedSummary, 'ui.advanced');
      el.liveLbl.textContent  = t('ui.live');
      if (el.liveHelp) el.liveHelp.textContent = t('ui.liveHelp');
      if (!AQ.live || !AQ.live.running) setIcon(el.connect, 'ui.connect');
      if (el.addrLbl)  el.addrLbl.textContent  = t('ui.address');
      if (el.loadAddr) el.loadAddr.textContent = t('ui.read');
      /* 言語切り替え（task E）。「日本語 / EN」は常に両方出したままにして、
         いま選ばれていない方を CSS 側で薄くする（data-active）。ボタン
         自体には title/aria-label を付け、見た目だけでなく読み上げでも
         「言語を切り替えるボタンだ」と分かるようにする。 */
      if (el.lang) {
        el.lang.title = t('ui.langTitle');
        el.lang.setAttribute('aria-label', t('ui.langTitle'));
        el.lang.setAttribute('data-active', AQ.i18n.lang);
      }
      /* 「x402ってなに？」の文を、問いの記号に縮める。「x402」の語だけは
         残す：何についての「？」なのかが分からない記号には、誰も好奇心を
         持てない。文そのものはマウスを乗せると出る。 */
      if (el.introBtn) {
        el.introBtn.textContent = 'x402 ?';
        el.introBtn.title = t('x402.introBtn');
        el.introBtn.setAttribute('aria-label', t('x402.introBtn'));
      }
      if (el.langJa) el.langJa.textContent = t('ui.langJa');
      if (el.langEn) el.langEn.textContent = t('ui.langEn');
      el.usdcLbl.textContent    = t('hud.usdc');
      el.creditsLbl.textContent = t('hud.credits');
      el.retriesLbl.textContent = t('hud.retries');
      /* ★ 2026-11-05（「USDC / CREDITS / RETRIES が何の数値か分からない」）:
         押すか指（マウス）を乗せると、短い説明が HUD のすぐ下に出る（css の .hud [data-tip]）。 */
      [[el.hudUsdc, 'hud.usdcTip'], [el.hudCredits, 'hud.creditsTip'], [el.hudRetries, 'hud.retriesTip']].forEach(function (p) {
        var n = p[0]; if (!n || typeof n.setAttribute !== 'function' || typeof n.getAttribute !== 'function') return;
        n.setAttribute('data-tip', t(p[1]));
        n.setAttribute('aria-label', t(p[1]));
        if (n.getAttribute('tabindex') == null) n.setAttribute('tabindex', '0');
        if (n.getAttribute('role') == null) n.setAttribute('role', 'button');
        if (!n._aqTip && n.addEventListener) {
          n._aqTip = true;
          n.addEventListener('click', function () {
            var on = !n.classList.contains('tip-on');
            [el.hudUsdc, el.hudCredits, el.hudRetries].forEach(function (o) { if (o) o.classList.remove('tip-on'); });
            n.classList.toggle('tip-on', on);
          });
          n.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); n.click(); } else if (ev.key === 'Escape') n.classList.remove('tip-on'); });
          n.addEventListener('blur', function () { n.classList.remove('tip-on'); });
        }
      });
      Array.prototype.forEach.call(el.runSelect.options, function (o) {
        if (o.dataset.key) o.textContent = t(o.dataset.key);
      });

      /* LIVE 追いつき（task B） */
      setIcon(el.catchup, 'ui.catchup');

      /* 詳細パネル（生ログの内訳。分からないことは描かない、の確認用） */
      setIcon(el.detailToggle, 'ui.detail');
      if (el.detailClose)  el.detailClose.textContent  = t('ui.detailClose');

      /* 1体に絞る */

    }
  };

})(window.AQ = window.AQ || {});
