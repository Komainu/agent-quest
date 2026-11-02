# 自分のエージェントを見る

## いちばん簡単な方法（コードを書かない）

あなたのエージェントが既に JSON ファイルを出しているなら、その形式はそのまま使えるかもしれません。

エージェントが出力する JSON ファイル（APIログ、ツールの出力、取引履歴など）を、アプリの「ログをひらく」からドラッグ＆ドロップするか Ctrl+V で貼り付けてください。アプリが自動で判定して読み込みます。

判定が当たれば「Dispatch Log として読み込みました」と表示されます。当たらないときは「推定」（推測）で読み込むことになります。**推定ラベルは、自動で推測しているだけで、正確な記録ではありません**。正しく見るには、次の方法できちんと記録してください。

## きちんと記録する（10行くらい）

エージェントが動く場所に、コピペで動かせる小さなレコーダーを置きます。どちらか選んでください。

### Python

`dispatch.py` として保存：

```python
import json
import time

run_id = 'run-' + str(int(time.time() * 1000))
actor = 'agent'

def log(type_, **kw):
    event = {'v': 1, 'run': run_id, 't': int(time.time() * 1000), 'actor': actor, 'type': type_}
    for k in ['target', 'amount', 'tx', 'status', 'item', 'say', 'meta']:
        if k in kw: event[k] = kw[k]
    if 'meta' not in event: event['meta'] = {}
    with open('dispatch.jsonl', 'a') as f:
        f.write(json.dumps(event, ensure_ascii=False) + '\n')
```

使い方：

```python
from dispatch import log

log('run.start', meta={'budget': 5.0})
log('tool.call', target='https://api.example.dev/news')
log('payment.required', target='https://api.example.dev/news', 
    amount={'asset': 'USDC', 'value': '0.010', 'chain': 'arc'})
log('payment.sent', target='https://api.example.dev/news',
    amount={'asset': 'USDC', 'value': '0.010', 'chain': 'arc'})
log('result.ok', target='https://api.example.dev/news', item='news.json')
log('run.end')
```

実行すると `dispatch.jsonl` ファイルが出来ます。それをアプリにドラッグ＆ドロップしてください。

### JavaScript (Node)

`dispatch.mjs` として保存：

```javascript
import fs from 'fs';

const runId = 'run-' + Date.now();
const actor = 'agent';

function log(type_, kw = {}) {
    const event = {v: 1, run: runId, t: Date.now(), actor: actor, type: type_};
    ['target', 'amount', 'tx', 'status', 'item', 'say', 'meta'].forEach(k => {
        if (k in kw) event[k] = kw[k];
    });
    if (!event.meta) event.meta = {};
    fs.appendFileSync('dispatch.jsonl', JSON.stringify(event) + '\n');
}
```

使い方：

```javascript
import {log} from './dispatch.mjs';

log('run.start', {meta: {budget: 5.0}});
log('tool.call', {target: 'https://api.example.dev/news'});
log('payment.required', {target: 'https://api.example.dev/news',
    amount: {asset: 'USDC', value: '0.010', chain: 'arc'}});
log('payment.sent', {target: 'https://api.example.dev/news',
    amount: {asset: 'USDC', value: '0.010', chain: 'arc'}});
log('result.ok', {target: 'https://api.example.dev/news', item: 'news.json'});
log('run.end');
```

実行すると `dispatch.jsonl` が出来ます。

## 複数のエージェントを出す

同じ `dispatch.jsonl` に複数のロボットを混ぜたいときは、`actor` を変えてください。

```python
log('run.start', actor='scout')     # 偵察役
log('tool.call', actor='courier')  # 配送役
```

`actor` フィールドが異なるイベントは、画面上では別々のロボットキャラとして表示されます。

## 気をつけること

- **`t` はミリ秒**。秒だと 1970 年になってしまいます。Python なら `int(time.time() * 1000)`、JavaScript なら `Date.now()`。
- **金額は文字列で**。`"0.010"` のように書いてください。数値だと丸め誤差で壊れます。
- **分からないことは書かない**。推測を混ぜると、データが嘘になります。
- **支払いなしなら payment.* は不要**。USDC が動かないなら、そのイベントは出さない。
- `type` の値は [dispatch-log.md](./dispatch-log.md) に書いてある 9 種類のいずれかにしてください。
