/* =============================================================
   nicknames.js — エージェント・依頼につける「呼び名」
   -------------------------------------------------------------
   何のためにあるか:
     画面にはエージェントが「#9 1jjwng」（連番＋did:key の末尾）、
     依頼が「k4147614196」や60文字の英語タイトルとして出てくる。
     初めて見る人にはこれらを見分けることも、さっき追っていたのが
     どれだったか覚えておくこともできない。そこでこのアプリが
     短くて読みやすい「呼び名」を1つずつ割り当てて画面に添える。

   ★ これはこのアプリが勝手に付けたラベルであって、本人（エージェント）
     が名乗った名前でも、ログに書かれている情報でもない。だから
     呼び名を出す場所は必ず「仮の呼び名」だと分かる形にし、詳細パネルには
     必ず本物のID（did / job id）を出す。呼び名を本名であるかのように
     見せてはいけない（roster.note / jobs.note と同じ立場）。

   決め方（決定的＝同じIDなら何度呼んでも同じ結果になる）:
     1. IDの文字列を FNV-1a でハッシュ化し、その値で単語リストの
        何番目の単語を割り当てるかを決める（IDが変わらない限り同じ単語）。
     2. 別のIDが同じ単語に当たったら、先に登録された方はそのまま、
        後から来た方は数字を足す（タヌキ／タヌキ2／タヌキ3…）。
        この「数字を足す順番」は、そのID群を最初に呼んだ順で決まる
        （呼ぶ順序を変えなければ毎回同じ結果になる）。
     3. エージェント用と依頼用は単語リストも登録簿も別。同じIDでも
        エージェントとして呼んだときと依頼として呼んだときで別々に
        割り当てる（片方を呼んでももう片方の登録には影響しない）。
     4. 表示言語（AQ.i18n.lang）ごとにも登録簿を分ける。日本語と
        英語を行き来しても、それぞれの中では同じIDに同じ呼び名が
        戻る（言語をまた切り替えて戻れば元の呼び名に戻る）。

   文字数を短く保つ理由:
     呼び名はキャンバスの小さな札や実況の見出し1行に載る。
       エージェント … ja=2〜5文字（カナのみ・漢字なし＝読み間違い防止）／
                      en=3〜8文字の英単語1語
       依頼         … ギリシャ文字1文字＋衝突時の数字（最大2桁）＝1〜3文字。
                      日本語・英語で同じ表記。
   ============================================================= */
(function (AQ) {
  'use strict';

  /* ---- 単語リスト -------------------------------------------
     ja.actor  … 動物（エージェント用・カタカナ）
     ja.job    … ギリシャ文字（依頼用。2026-09-14 に植物名から変更）
     en.actor  … 同じ発想の英語（動物）
     en.job    … ja.job と同じギリシャ文字（訳さない）
     ブランド名・実在の人名・政治色・悪い意味に読める語は使わない。
     ja は漢字を含めない（読み間違い防止のため）、4文字以内にして
     衝突時の数字（最大2桁）を足しても5文字に収まるようにしている。 */
  var WORDS = {
    ja: {
      /* すべて3文字以内に揃えてある。衝突したときに足す数字（最大2桁）
         を足しても 3+2=5文字 に収まり、「ja は2〜5文字」を必ず守れる。 */
      actor: [
        'タヌキ','キツネ','ウサギ','リス','パンダ','コアラ','ラッコ','イルカ',
        'クジラ','ゾウ','キリン','トラ','ヒョウ','クマ','ヤギ','ヒツジ',
        'ウマ','シカ','サル','ネコ','イヌ','ハト','スズメ','ツバメ',
        'カラス','ワシ','タカ','サギ','ツル','カメ','カエル','トカゲ',
        'ヤモリ','セミ','トンボ','チョウ','ハチ','アリ','カニ','エビ',
        'タコ','イカ','サメ','クラゲ','ヒトデ','ラマ','バク','ラクダ',
        'カモ','トド','モグラ','イタチ','ヤク','テン','ヒバリ','ツグミ',
        'モズ','キジ','トキ','メジロ','シギ','チドリ','カモメ','クイナ',
        'バン'
      ],
      /* ★ 2026-09-14: 依頼の呼び名を「花・自然の和語」からギリシャ文字へ。
         理由（実測）: 語彙58語では、依頼40件で28%・100件で52%・200件で
         73% が数字付き（「きく10」）になっていた。つまり花の名前は実データの
         規模ではもう機能しておらず、花の名前としても記号としても中途半端
         だった。どうせ数字が付くなら、最初からそれを前提にした体系にする。
           ・常に1〜3文字（「α」「α2」）＝盤面の小さな札にも見出しにも入る
           ・「α2」は壊れた名前ではなく、そういう体系に見える
           ・本物のデータと絶対に見間違えない（このアプリの約束に素直）
           ・日本語と英語で同じ表記＝言語を切り替えても呼び名が変わらない
         エージェント側は動物のまま。動物（動くもの）と記号（物）で、
         「どっちがエージェントでどっちが仕事か」が形で分かる。
         ο（オミクロン）と ι（イオタ）は外してある——前者はラテン文字の o
         や数字の 0 と、後者は縦棒1本と見分けが付かないため（22文字）。 */
      job: [
        'α','β','γ','δ','ε','ζ','η','θ','κ','λ',
        'μ','ν','ξ','π','ρ','σ','τ','υ','φ','χ','ψ','ω'
      ]
    },
    en: {
      /* すべて6文字以内に揃えてある。衝突時の数字（最大2桁）を足しても
         6+2=8文字 に収まり、「en は3〜8文字」を必ず守れる。 */
      actor: [
        'Otter','Falcon','Badger','Fox','Rabbit','Panda','Koala',
        'Lemur','Owl','Whale','Zebra','Lion',
        'Tiger','Wolf','Bear','Goat','Sheep','Horse',
        'Deer','Boar','Monkey','Crow','Eagle','Hawk',
        'Heron','Crane','Turtle','Lizard','Gecko','Cicada','Shrimp','Squid',
        'Shark','Llama','Tapir','Puffin','Ferret','Weasel','Marten','Bison',
        'Moose','Lynx','Puma','Jaguar','Mole','Skunk',
        'Wombat','Toucan','Parrot','Stork','Robin','Wren','Finch'
      ],
      /* 依頼は日本語と同じギリシャ文字（訳す必要が無い＝言語を
         切り替えても呼び名が変わらない）。 */
      job: [
        'α','β','γ','δ','ε','ζ','η','θ','κ','λ',
        'μ','ν','ξ','π','ρ','σ','τ','υ','φ','χ','ψ','ω'
      ]
    }
  };

  /* IDが無い（null/undefined/空文字）ときのための、レジストリを
     消費しない固定の呼び名。空文字を返して「何も無い」ように
     見せない＝呼び名らしい体裁は保つ。 */
  var FALLBACK = { ja: 'なまえなし', en: 'Unnamed' };

  /** FNV-1a（32bit）。ID文字列 → ハッシュ値。単語選びだけに使う軽い
      ハッシュで十分（暗号用途ではない）。 */
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0; // ×16777619 を >>>0 で計算
    }
    return h >>> 0;
  }

  /* レジストリ本体。kind: 'actor' | 'job'、lang: 'ja' | 'en' の
     組み合わせごとに、以下を別々に持つ:
       byId     … id(文字列化) → すでに割り当てた呼び名
       baseUsed … 単語（数字を足す前の形）→ これまでに割り当てた回数
     エージェントと依頼は kind が違うので registry も分かれ、
     片方を呼んでももう片方の byId / baseUsed には触れない。 */
  function freshRegistry() {
    return {
      ja: { actor: { byId: {}, baseUsed: {} }, job: { byId: {}, baseUsed: {} } },
      en: { actor: { byId: {}, baseUsed: {} }, job: { byId: {}, baseUsed: {} } }
    };
  }
  var registry = freshRegistry();

  /* stats() 用に「実際にIDとして呼んだ回数」を kind ごとに数える
     （null/undefined/空文字は数えない＝そもそも登録していないため）。
     言語を跨いで同じIDを2回呼んでも、ここは「見た文字列IDの種類数」
     を数えたいので、言語非依存の集合を別に持つ。 */
  var seen = { actor: {}, job: {} };
  var seenCount = { actor: 0, job: 0 };

  function currentLang() {
    var i18n = AQ.i18n;
    return (i18n && i18n.lang === 'en') ? 'en' : 'ja';
  }

  /* ★ 2026-09-30: 依頼の呼び名は「ログに出てきた順」に α, β, γ … と振る
     （利用者の要望「アルファ、ベータという感じに順番に名前を振ってください」）。
     以前は ID のハッシュで文字を選んでいたので、最初の依頼が μ、次が γ …
     と順番がばらばらで、名前から「何番目の依頼か」が読めなかった。
     22文字（ο・ι は除く）を使い切ったら α2, β2, … と2周目に入る。
     一度振った名前は変えない（LIVE で依頼が増えても、既存の依頼の名前は
     そのまま・新しい依頼に次の名前が付く）。ログを読み直すと振り直す。
     順番を教えてもらっていない ID（検査用に単体で呼ばれたときなど）は
     今までどおりハッシュで決める。 */
  var jobSeq = { byId: {}, n: 0 };
  function seqJobName(n) {
    var list = WORDS.ja.job;
    var cycle = Math.floor(n / list.length);
    return list[n % list.length] + (cycle > 0 ? String(cycle + 1) : '');
  }

  /* ★ 2026-10-02: ウォレット（0x…）には動物の呼び名を付けない。
     報告「ウォレットを入れたら勝手に『コアラ』という名前が割り振られた。いきなり
     なのでユーザーが混乱する」。自分で入れたアドレスが、知らない動物の名前に
     化けて見えた。0x の短いアドレス（0x1234…78）はそれだけで読めて見分けも
     付くので、そのまま名前として出す。did:key のように長くて読めない ID には、
     今までどおり呼び名を付ける。 */
  function isAddressLike(s) {
    return /^0x[0-9a-fA-F]{2,}(?:…|\.\.\.)?[0-9a-fA-F]*$/.test(s);
  }

  function shortActorId(key) {
    var m = key.match(/^did:[a-z0-9]+:(.+)$/i);
    /* ★ 2026-10-07: 先頭のいくつか＋…＋末尾のいくつか（利用者の希望）。
       did:key の ID 部分の先頭6文字と末尾4文字。 */
    if (m) return m[1].length <= 12 ? m[1] : m[1].slice(0, 6) + '…' + m[1].slice(-4);
    if (/^0x[0-9a-fA-F]{12,}$/.test(key)) return key.slice(0, 6) + '…' + key.slice(-4);
    if (key.length <= 12) return key;
    return key.slice(0, 5) + '…' + key.slice(-4);
  }

  function nicknameFor(kind, id) {
    if (id === null || id === undefined || id === '') {
      return FALLBACK[currentLang()];
    }
    var key = String(id);
    /* もう縮めてある 0x（0x1234…78 など）はそのまま。長いままの 0x は下で縮める。 */
    if (kind === 'actor' && isAddressLike(key) && !/^0x[0-9a-fA-F]{12,}$/.test(key)) return key;
    /* ★ 2026-10-07: エージェントには動物の呼び名を付けない（利用者「動物の名前はやめて、
       アドレスなどを短縮したものに」）。ID そのものを短く縮めて出す：
         did:key:z6Mk…（長い） → z6Mkha…2doK（ID 部分の先頭6文字＋末尾4文字）
         0x…（長い）           → 0x1234…5678
         短い ID（agent・scout など） → そのまま
       作り物の名前ではなく本物の ID の一部なので、ログの ID と照らし合わせられる。 */
    /* ★ 2026-10-11: 自分で作ったロボットだけは、持ち主が付けた名前（ERC-8004 に登録した名前と番号）で出す */
    if (kind === 'actor' && Object.prototype.hasOwnProperty.call(ownNames, key)) return ownNames[key];
    if (kind === 'actor') {
      if (!Object.prototype.hasOwnProperty.call(seen.actor, key)) { seen.actor[key] = true; seenCount.actor++; }
      return shortActorId(key);
    }
    if (kind === 'job' && Object.prototype.hasOwnProperty.call(jobSeq.byId, key)) return jobSeq.byId[key];
    var lang = currentLang();
    var slot = registry[lang][kind];

    if (Object.prototype.hasOwnProperty.call(slot.byId, key)) {
      return slot.byId[key];
    }

    if (!Object.prototype.hasOwnProperty.call(seen[kind], key)) {
      seen[kind][key] = true;
      seenCount[kind]++;
    }

    var list = WORDS[lang][kind];
    var base = list[hash(key) % list.length];

    var count = slot.baseUsed[base] || 0; // これまで同じ単語に当たった回数
    var name = (count === 0) ? base : (base + (count + 1));
    slot.baseUsed[base] = count + 1;
    slot.byId[key] = name;
    return name;
  }

  var ownNames = {};
  AQ.nick = {
    /** 自分のロボットの did:key に、持ち主が付けた名前を結び付ける */
    setName: function (id, label) { if (id && label) ownNames[String(id)] = String(label); },

    /** エージェントIDに割り当てた短い呼び名（例: 'カワウソ' / 'Otter'）。
        本名ではない＝表示側は必ず「仮の呼び名」と分かる見せ方にすること。 */
    forActor: function (id) { return nicknameFor('actor', id); },

    /** 依頼IDに割り当てた短い呼び名（例: 'さくら' / 'Cedar'）。 */
    forJob: function (id) { return nicknameFor('job', id); },

    /** 依頼 ID を「ログに出てきた順」で渡す。まだ名前の無い ID にだけ、
        次の名前（α, β, …, ω, α2, …）を振る。 */
    setJobOrder: function (ids) {
      (ids || []).forEach(function (id) {
        if (id === null || id === undefined || id === '') return;
        var key = String(id);
        if (Object.prototype.hasOwnProperty.call(jobSeq.byId, key)) return;
        jobSeq.byId[key] = seqJobName(jobSeq.n++);
        if (!Object.prototype.hasOwnProperty.call(seen.job, key)) { seen.job[key] = true; seenCount.job++; }
      });
    },

    /** 新しいログを読み込んだときに呼ぶ。割り当てを全部忘れる
        （＝IDと呼び名の対応関係は保存しない。ログが変われば無意味
        になるものを持ち続けても、混乱の元にしかならないため）。 */
    reset: function () {
      registry = freshRegistry();
      jobSeq = { byId: {}, n: 0 };
      seen = { actor: {}, job: {} };
      seenCount = { actor: 0, job: 0 };
    },

    /** ハーネス／デバッグ用: いくつのIDに呼び名を割り当て済みか。 */
    stats: function () {
      return { actors: seenCount.actor, jobs: seenCount.job };
    }
  };

})(window.AQ = window.AQ || {});
