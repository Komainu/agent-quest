# Dispatch Log v1

エージェントの1回の実行を、1行1件の JSON（JSONL）で表す小さな形式です。
**この形式さえ出せば、どのエージェントでも Agent Dispatch で見られる**ようにするためのもの。
可視化アプリはデモで、貢献の本体はこちらです。

## 1件の形

```json
{
  "v": 1,
  "run": "0x7c3f…a1",
  "t": 1758000123456,
  "actor": "scout",
  "type": "payment.sent",
  "target": "https://api.example.dev/news",
  "amount": { "asset": "USDC", "value": "0.010", "chain": "arc" },
  "tx": "0x9be2…04",
  "status": "",
  "item": "",
  "say": "今日の見出しを取りに行く",
  "meta": {}
}
```

| 項目 | 必須 | 内容 |
|---|---|---|
| `v` | ○ | 形式のバージョン。今は `1` |
| `run` | ○ | 実行の識別子。同じ実行のイベントは同じ値 |
| `t` | ○ | 発生時刻（UNIXミリ秒） |
| `actor` | ○ | エージェント名。複数いる場合はこれが1体ずつのロボットになる |
| `type` | ○ | 下の9種類のいずれか |
| `target` |  | URL、エンドポイント、モデル名など「相手」 |
| `amount` |  | `{asset, value, chain}`。`value` は**文字列**（丸め防止） |
| `tx` |  | オンチェーンの取引ハッシュ |
| `status` |  | HTTP ステータスなど（`"502"`） |
| `item` |  | 受け取ったもの（`"news.json"`） |
| `say` |  | エージェントの一言。あれば実況に活かせる |
| `meta` |  | 自由。`{attempt, backoff, bytes, payTo, batched, budget, credits, retries}` などを見ます |

## type（9種類）

| type | 意味 | 画面 |
|---|---|---|
| `run.start` | 実行の開始 | 起動して出発 |
| `agent.plan` | 思考・計画（依頼板への投稿もここ） | 少なければ1件ずつ、多ければまとめて表示 |
| `tool.call` | 外部を呼びに行く | 移動 |
| `payment.required` | HTTP 402 を受けた | 入口の決済端末が赤く光る |
| `payment.sent` | 署名して支払った | 端末にかざして支払う |
| `payment.settled` | オンチェーンで確定した | 街頭ビジョンに SETTLED |
| `result.ok` | 結果を受け取った | 荷物を受け取る |
| `result.error` | 失敗した | シャッターが閉じた店先（寄りの画面） |
| `run.end` | 実行の終了 | 拠点に帰着 |

未知の `type` は `tool.call` として扱われます（落とさない）。

## 描く／描かないの階層

| 階層 | 対象 | 扱い |
|---|---|---|
| 1 | `run.start` `run.end` `payment.settled` `result.error` | **必ず1コマ描く。1件も間引かない** |
| 2 | `payment.required` `payment.sent` `result.ok` `tool.call` `agent.plan` | 少なければ1件1コマ、多ければ1コマにまとめる |
| 3 | `cache.hit` `poll` | コマにしない（密度としてだけ扱う） |

この割り当ては `src/config.js` の `tier` で変えられます。

`agent.plan` は元々ここが Tier3（描かない）でした。しかし kibble のような
公開の依頼ボードでは JOB の投稿は「実在の参加者が実在の仕事を board に
置いた」という出来事そのものであり、しかもその参加者が二度と他の種別の
メッセージを書かないことも普通にあります。Tier3 のままだと、動いている
はずの参加者が画面から構造的に消えてしまうため、2026-08-31 に Tier2 へ
上げました（少なければ1件ずつ描き、依頼板が混んでいれば通常どおり
まとめられるので、帯域の予算は崩れません）。

### まとめて1コマにするときの文言（2026-09-03 追加）

Tier2 が `aggregateMin` 件を超えてまとまるとき、中身によって別のコマ種別
（beat kind）・別の文言になります（`src/engine/aggregate.js` の
`familyOf()`）。

| 束の中身 | beat kind | 文言 |
|---|---|---|
| `payment.required` / `payment.sent` だけ | `batch` | 「支払いをまとめて記録した」＋合計金額 |
| `agent.plan` だけ | `planbatch` | 「依頼が立て続けに届いた」（金額なし） |
| それ以外（`tool.call` / `result.ok` など、payment.\* を1件も含まない） | `actbatch` | 「書き込みをまとめて記録した」＋種別ごとの内訳（金額・「支払い」の語は一切使わない） |

kibble のようなログ（payment.\* が無い）で Tier2 が集約されるときは
必ず `actbatch` になります。以前はここが `payment.*` の束と同じ
`batch`（支払いの文言）に混ざっており、支払いが1件も無いログで
「まとめて支払った」と表示してしまう不具合がありました。

なぜ分けるか：画面は帯域の決まったチャンネルで、人が受け取れるのは
だいたい毎秒1〜2コマです。全部を同じ粒度で描こうとすると必ず溺れます。
とくに Arc のナノペイメントは、**オフチェーンの承認が高頻度・オンチェーンの
確定が低頻度**という2つのリズムを持つので、この階層はプロトコルの構造に
そのまま対応します。

## 約束

1. **表示を間引いても、データは全件保持する。** 画面には `表示 9 / 全 114 件` を常時出す。
2. **推測を書かない。** 送金履歴しか無いなら「払った／確定した」だけを出す。
3. **金額は文字列。** `0.0004` を数値で持つと丸めで壊れます。

## メーターに数字を出すには

画面上段の USDC / CREDITS / RETRIES は、`run.start` の `meta` に書かれた
ことしか表示しません。

| メーター | 数字が出る条件 |
|---|---|
| USDC | `meta.budget`（初期残高）を宣言したとき。無くても `payment.sent` が1件でもあれば、代わりに使った合計額だけを `-` 付きで出します（残高は分からないので） |
| CREDITS | `meta.credits`（推論クレジットの初期値）を宣言したとき |
| RETRIES | `meta.retries`（再試行の上限）を宣言したとき。無くても `result.error` が1件でもあれば、代わりに失敗件数だけを出します |

どの条件にも当てはまらなければ、そのメーターは `—` のままです。
これは不具合ではなく仕様です。**分からない初期値を作って出すことはしません。**

## 最小の例

```jsonl
{"v":1,"run":"r1","t":1758000000000,"actor":"scout","type":"run.start","meta":{"budget":5.0}}
{"v":1,"run":"r1","t":1758000000900,"actor":"scout","type":"tool.call","target":"https://api.example.dev/news"}
{"v":1,"run":"r1","t":1758000001200,"actor":"scout","type":"payment.required","target":"https://api.example.dev/news","amount":{"asset":"USDC","value":"0.010","chain":"arc"}}
{"v":1,"run":"r1","t":1758000001600,"actor":"scout","type":"payment.sent","target":"https://api.example.dev/news","amount":{"asset":"USDC","value":"0.010","chain":"arc"}}
{"v":1,"run":"r1","t":1758000002100,"actor":"scout","type":"payment.settled","tx":"0x9be2…04","amount":{"asset":"USDC","value":"0.010","chain":"arc"},"meta":{"batched":1}}
{"v":1,"run":"r1","t":1758000002400,"actor":"scout","type":"result.ok","target":"https://api.example.dev/news","item":"news.json","meta":{"bytes":"12.4 KB"}}
{"v":1,"run":"r1","t":1758000002600,"actor":"scout","type":"run.end"}
```

このファイルを `.jsonl` として保存し、アプリの「ログを ひらく」で読み込めます。

## おまけ: kibble（technocore.chat の一室）からの取り込み

`kibble` は technocore.chat 上の、誰でも書き込める1部屋です。所有者はおらず、
サーバ側が強制するルールもありません。その部屋で自然発生的に使われている
パイプ区切りの書式（ここでは便宜上「自称 kibble-v1」と呼びます）を
`src/adapters/fromKibble.js` が Dispatch Log に翻訳します。これは観測した
慣習であって、公式仕様でも Flop Labs のお墨付きでもありません。

| kibble の行 | 対応する Dispatch Log |
|---|---|
| `JOB v1 \| <jobId> \| <kind> \| <title> \| <detail>` | `agent.plan`、`say`=title、`meta.job` `meta.kind` `meta.detail` |
| `CLAIM v1 \| <jobId> \| <role>` | `tool.call`、`meta.job` `meta.role` |
| `DELIVER v1 \| <jobId> \| <text>`（`RESULT v1` も同義） | `result.ok`、`item`=text を60文字＋…に切り詰め、`status`='200'、`meta.job` |
| `ATTEST v1 \| <jobId> \| useful \| …` | `result.ok`、`item`=末尾のコメントを切り詰め、`meta.job` `meta.verdict`='useful' |
| `ATTEST v1 \| <jobId> \| not \| <reason>` | `result.error`、`status`='ATTEST not'、`meta.job` `meta.reason` `meta.verdict`='not' |
| それ以外（未知の行） | 既存の `tool.call` + `result.ok` の組（fromTechnocore.js と同じ扱い）。落とさない |

kibble は無料の部屋なので、`payment.*` は一切作らず `run.start` にも
`meta.budget` を乗せません。USDC・CREDITS・RETRIES のメーターが `—` の
ままなのが正しい表示です。
