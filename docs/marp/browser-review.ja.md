---
marp: true
theme: default
paginate: true
size: 16:9
header: "browser-review — Point at it, say what is wrong, let your agent fix it"
style: |
  /*
   * browser-review theme colors (violet).
   * Chosen so the brand never collides with the overlay's status colors:
   * pending #f59e0b, acknowledged #3b82f6, resolved #22c55e,
   * dismissed #9ca3af, error #ef4444 (packages/overlay/src/styles.ts).
   *   --br-primary  #4435b0  headings, emphasis, table headers (8.82:1 on white)
   *   --br-dark     #2f2585  inline code text
   *   --br-ink      #221a63  text on light violet surfaces
   *   --br-tint     #eeecfb  code background, striped rows, flow steps
   *   --br-border   #c9c3ee  borders on tinted surfaces
   * Badge ramp for hint confidence, darkest = most reliable:
   *   #241c6b #4435b0 #6a5dd8 (white text), #8a80e3 #b1aaee #d4d0f7 (ink text)
   */
  section {
    --br-primary: #4435b0;
    --br-dark: #2f2585;
    --br-ink: #221a63;
    --br-tint: #eeecfb;
    --br-border: #c9c3ee;
    font-family: 'Helvetica Neue', 'Hiragino Sans', sans-serif;
    padding: 60px 80px;
    align-content: start;
  }
  section.lead {
    text-align: center;
    align-content: center;
  }
  h1 {
    color: var(--br-primary);
  }
  h2 {
    color: var(--br-primary);
    border-bottom: 2px solid var(--br-primary);
    padding-bottom: 8px;
  }
  strong {
    color: var(--br-primary);
  }
  code {
    background: var(--br-tint);
    color: var(--br-dark);
    padding: 2px 6px;
    border-radius: 4px;
  }
  pre {
    background: #0f172a;
    color: #e2e8f0;
    border-radius: 6px;
    padding: 16px;
    font-size: 0.75em;
  }
  pre code {
    background: transparent;
    color: inherit;
  }
  pre .hljs-string,
  pre .hljs-variable,
  pre .hljs-template-variable {
    color: #86efac;
  }
  pre .hljs-comment {
    color: #94a3b8;
  }
  pre .hljs-keyword,
  pre .hljs-built_in {
    color: #fda4af;
  }
  pre .hljs-title,
  pre .hljs-attr,
  pre .hljs-property {
    color: #93c5fd;
  }
  header {
    color: #94a3b8;
    font-size: 0.7em;
  }
  .install-hero {
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 1.1em;
    font-weight: bold;
    white-space: nowrap;
    color: var(--br-primary);
    text-align: center;
    padding: 24px;
    margin: 16px 0;
    letter-spacing: 0.02em;
  }
  .cta-heading {
    font-size: 1.1em;
    color: #475569;
    text-align: center;
    margin: 0 0 16px;
    font-weight: normal;
  }
  .links {
    font-size: 1.1em;
    line-height: 2.2;
    text-align: center;
  }
  .icon-inline {
    width: 24px;
    height: 24px;
    vertical-align: -6px;
    margin-right: 8px;
  }
  .note {
    font-size: 0.7em;
    color: #64748b;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.78em;
    margin-top: 12px;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: var(--br-primary);
    color: white;
  }
  tbody tr:nth-child(even) {
    background: var(--br-tint);
  }
  td code {
    font-size: 0.92em;
  }
  td:first-child {
    white-space: nowrap;
  }
  .flow-h {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 28px;
    flex-wrap: wrap;
  }
  .flow-step {
    padding: 10px 16px;
    border-radius: 8px;
    background: var(--br-tint);
    color: var(--br-dark);
    border: 1px solid var(--br-border);
    text-align: center;
    font-weight: 600;
    font-size: 0.9em;
    white-space: nowrap;
  }
  .flow-step.bad {
    background: #fdecec;
    color: #7f1d1d;
    border-color: #f5c2c2;
  }
  .flow-arrow {
    font-size: 1.3em;
    color: #94a3b8;
    line-height: 1;
  }
  .pipe {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 16px;
  }
  .pipe-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pipe-badge {
    flex: 0 0 190px;
    padding: 6px 12px;
    border-radius: 6px;
    color: white;
    font-weight: bold;
    font-size: 0.8em;
    text-align: center;
  }
  .pipe-95 { background: #241c6b; }
  .pipe-90 { background: var(--br-primary); }
  .pipe-80 { background: #6a5dd8; }
  .pipe-70 { background: #8a80e3; color: var(--br-ink); }
  .pipe-60 { background: #b1aaee; color: var(--br-ink); }
  .pipe-40 { background: #d4d0f7; color: var(--br-ink); }
  .pipe-desc {
    font-size: 0.8em;
    color: #334155;
  }
  .diagram {
    display: grid;
    grid-template-columns: 1fr 150px 1fr 150px 1fr;
    grid-template-rows: auto 64px auto;
    align-items: center;
    margin-top: 12px;
  }
  .node {
    position: relative;
    background: var(--br-tint);
    border: 1.5px solid var(--br-border);
    border-radius: 10px;
    padding: 14px 8px;
    text-align: center;
    font-weight: 700;
    font-size: 0.8em;
    line-height: 1.3;
    color: var(--br-ink);
  }
  .node-sub {
    display: block;
    margin-top: 4px;
    font-weight: 400;
    font-size: 0.8em;
    color: #475569;
  }
  .node-main {
    background: var(--br-primary);
    border-color: var(--br-primary);
    color: #ffffff;
  }
  .node-main .node-sub {
    color: #e4e1fb;
  }
  .link {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-size: 0.6em;
    color: #334155;
  }
  .vlink {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 0.6em;
    color: #334155;
  }
  .link-arrow {
    font-size: 1.9em;
    line-height: 1;
    color: #94a3b8;
  }
  .d-num {
    display: inline-block;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--br-dark);
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    line-height: 24px;
    text-align: center;
  }
  .at-r1c1 { grid-row: 1; grid-column: 1; }
  .at-r1c2 { grid-row: 1; grid-column: 2; }
  .at-r1c3 { grid-row: 1; grid-column: 3; }
  .at-r1c4 { grid-row: 1; grid-column: 4; }
  .at-r1c5 { grid-row: 1; grid-column: 5; }
  .at-r2c3 { grid-row: 2; grid-column: 3; }
  .at-r3c1 { grid-row: 3; grid-column: 1; }
  .at-r3c2 { grid-row: 3; grid-column: 2; }
  .at-r3c3 { grid-row: 3; grid-column: 3; }
  section.modes p {
    font-size: 0.85em;
  }
  section.modes table {
    font-size: 0.72em;
  }
  section.modes th,
  section.modes td {
    padding: 6px 12px;
  }
  .ui-demo {
    display: grid;
    grid-template-columns: 640px 1fr;
    gap: 32px;
    align-items: start;
    margin-top: 14px;
  }
  .mock {
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 8px 24px rgb(15 23 42 / 0.12);
  }
  .mock-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 12px;
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
  }
  .mock-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #cbd5e1;
  }
  .mock-url {
    margin-left: 10px;
    padding: 3px 12px;
    border-radius: 999px;
    background: #ffffff;
    color: #64748b;
    font-size: 12px;
  }
  .mock-page {
    position: relative;
    height: 380px;
    background: #ffffff;
  }
  .mp {
    position: absolute;
  }
  .mp-header { top: 0; left: 0; right: 0; height: 44px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
  .mp-logo { top: 14px; left: 20px; width: 72px; height: 16px; border-radius: 4px; background: #cbd5e1; }
  .mp-nav { top: 17px; right: 20px; width: 170px; height: 10px; border-radius: 4px; background: #e2e8f0; }
  .mp-h1 { top: 66px; left: 32px; width: 300px; height: 22px; border-radius: 4px; background: #94a3b8; }
  .mp-text { top: 100px; left: 32px; width: 420px; height: 10px; border-radius: 4px; background: #e2e8f0; }
  .mp-text2 { top: 118px; left: 32px; width: 340px; height: 10px; border-radius: 4px; background: #e2e8f0; }
  .mp-card { top: 152px; width: 176px; height: 118px; border-radius: 8px; background: #f1f5f9; border: 1px solid #e2e8f0; }
  .mp-c1 { left: 32px; }
  .mp-c2 { left: 222px; }
  .mp-c3 { left: 416px; }
  .mp-hl { top: 148px; left: 412px; width: 184px; height: 126px; border: 2px solid #3b82f6; border-radius: 4px; background: rgb(59 130 246 / 0.1); }
  .mp-label { top: 128px; left: 412px; padding: 2px 6px; border-radius: 3px 3px 3px 0; background: #3b82f6; color: #ffffff; font-size: 11px; }
  .mp-pin { width: 24px; height: 24px; border-radius: 50% 50% 50% 2px; border: 2px solid #ffffff; box-shadow: 0 2px 6px rgb(0 0 0 / 0.3); color: #ffffff; font-size: 11px; font-weight: 700; text-align: center; line-height: 20px; }
  .mp-pin-pending { top: 138px; left: 584px; background: #f59e0b; }
  .mp-pin-resolved { top: 56px; left: 322px; background: #22c55e; }
  .mp-composer { top: 188px; left: 236px; width: 300px; padding: 10px; border-radius: 10px; background: #ffffff; border: 1px solid #e5e7eb; box-shadow: 0 12px 32px rgb(0 0 0 / 0.22); font-size: 12px; color: #111827; }
  .mc-input { padding: 8px; min-height: 48px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; }
  .mc-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  .mc-hint { flex: 1; color: #6b7280; font-size: 11px; }
  .mc-btn { padding: 4px 10px; border-radius: 6px; background: #f3f4f6; color: #374151; font-size: 12px; }
  .mc-send { background: #3b82f6; color: #ffffff; }
  .mp-toolbar { right: 12px; bottom: 12px; display: flex; align-items: center; gap: 4px; padding: 5px 8px; border-radius: 999px; background: #16181d; border: 2px solid #ffffff; box-shadow: 0 6px 24px rgb(0 0 0 / 0.28); color: #f3f4f6; font-size: 12px; }
  .tb-dot { width: 8px; height: 8px; margin: 0 4px; border-radius: 50%; background: #22c55e; }
  .tb-btn { padding: 5px 10px; border-radius: 999px; }
  .tb-on { background: #3b82f6; color: #ffffff; }
  .ui-points {
    margin: 0;
    padding-left: 1.1em;
    font-size: 0.72em;
    line-height: 1.55;
  }
  .ui-points li {
    margin-bottom: 10px;
  }
  .swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin: 0 3px 0 6px;
    border-radius: 50% 50% 50% 2px;
    vertical-align: -1px;
  }
  .sw-pending { background: #f59e0b; }
  .sw-ack { background: #3b82f6; }
  .sw-resolved { background: #22c55e; }
  .pain {
    margin-top: 8px;
  }
  .pain li {
    margin: 6px 0;
  }
  .node .d-num {
    position: absolute;
    top: -12px;
    left: -12px;
  }
  .steps {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    grid-auto-flow: column;
    gap: 6px 28px;
    margin-top: 28px;
    font-size: 0.74em;
    line-height: 1.45;
  }
  .step {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  .step-num {
    flex: none;
    width: 1.6em;
    height: 1.6em;
    border-radius: 50%;
    background: var(--br-dark);
    color: #ffffff;
    font-weight: 700;
    text-align: center;
    line-height: 1.6em;
  }
---

<!-- _class: lead -->
<!-- _paginate: false -->
<!-- _header: '' -->

# 指さして直す<br>UI レビューツール `browser-review`

<br>

### Point at it, say what is wrong, let your agent fix it

<br>

指さすだけで、エージェントが直す。

---

## ブラウザとターミナルを往復しながらの修正は面倒

Claude Code などのエージェントに UI の修正を頼むとき、いまはたいてい次の手順を踏みます。

<ol class="pain">
  <li>ブラウザで気になる箇所を見つける</li>
  <li>ターミナルの Claude Code に切り替える</li>
  <li>「ヘッダー右上の青いボタンの余白が……」と文章で説明する</li>
  <li>ブラウザに戻って確かめる。違う場所が直っていたら、2 からやり直し</li>
</ol>

<br>

**ブラウザとターミナルを行き来するのも、場所を文章で説明するのも手間です。**

---

## browser-review：ブラウザから修正を頼めるツール

`browser-review` は、ブラウザに表示した UI に直接コメントを残し、
その修正を Claude Code などのコーディングエージェントに任せるツールです。

```text
/browser-review:open http://localhost:5173   # レビューを始める（.html ファイルも可）
/browser-review:resolve                      # 届いたコメントを直してもらう
```

表示された URL を開き、要素をクリックして直したいことを書くだけ。
エージェントには**そのファイルと行**が届くので、ブラウザを離れずに済みます。

Claude Code のプラグインです。MCP 対応のエージェントや `curl` からも使えます。

---

## ページ内のオーバーレイ UI から要素を選択して修正依頼

<div class="ui-demo">
<div class="mock">
<div class="mock-bar"><span class="mock-dot"></span><span class="mock-dot"></span><span class="mock-dot"></span><span class="mock-url">127.0.0.1:53211/r/…/</span></div>
<div class="mock-page">
<div class="mp mp-header"></div><div class="mp mp-logo"></div><div class="mp mp-nav"></div>
<div class="mp mp-h1"></div><div class="mp mp-text"></div><div class="mp mp-text2"></div>
<div class="mp mp-card mp-c1"></div><div class="mp mp-card mp-c2"></div><div class="mp mp-card mp-c3"></div>
<div class="mp mp-hl"></div><div class="mp mp-label">div.card</div>
<div class="mp mp-pin mp-pin-resolved">1</div><div class="mp mp-pin mp-pin-pending">2</div>
<div class="mp mp-composer"><div class="mc-input">カード下の余白をもう少し広げたい</div><div class="mc-row"><span class="mc-hint">⌘/Ctrl + Enter to send</span><span class="mc-btn">Cancel</span><span class="mc-btn mc-send">Send</span></div></div>
<div class="mp mp-toolbar"><span class="tb-dot"></span><span class="tb-btn tb-on">Comment</span><span class="tb-btn">Comments 2</span><span class="tb-btn">Status</span></div>
</div>
</div>
<ol class="ui-points">
<li><strong>Comment</strong> を押して要素をクリック</li>
<li>直したいことを書いて <strong>Send</strong></li>
<li>ピンの色で進み具合がわかる<br><span class="swatch sw-pending"></span>待機中<span class="swatch sw-ack"></span>対応中<span class="swatch sw-resolved"></span>修正済み</li>
<li>キー操作にも対応<br><code>c</code> 選択、<code>l</code> 一覧、<code>s</code> ステータス</li>
</ol>
</div>

---

<!-- _class: modes -->

## ローカルの HTML ファイルも開発サーバーもそのままレビュー

`open` に渡すのがファイルなら `html-file`、`http://localhost` の URL なら `proxy` で動きます。

|                                  | `html-file`                  | `proxy`                               |
| -------------------------------- | ---------------------------- | ------------------------------------- |
| **対象**                         | ローカルの `.html` ファイル  | `http://localhost:PORT/...`           |
| **オーバーレイ UI の入れ方**     | 解析し、末尾に差し込んで配信 | 中継し、HTML にだけ差し込む           |
| **ソースの手がかり**             | 正確（全要素に行番号）       | フレームワーク次第                    |
| **エージェントが編集できる範囲** | そのファイル 1 つ            | プロジェクトディレクトリ配下          |
| **ライブリロード**               | あり（ファイルを監視）       | 開発サーバーの HMR をそのまま通す     |
| **注意点**                       | —                            | 開発サーバーの CSP ヘッダーは外される |

どちらのモードでも、ディスク上のファイルは書き換えません。

---

## ローカル server を経由してエージェントとやりとり

<div class="diagram">
  <div class="node at-r1c1">ブラウザ<span class="node-sub">ページ＋オーバーレイ UI</span></div>
  <div class="link at-r1c2"><span>WebSocket</span><span class="link-arrow">↔</span><span class="d-num">3</span></div>
  <div class="node node-main at-r1c3"><span class="d-num">1</span>review server<span class="node-sub">127.0.0.1 の空きポート</span></div>
  <div class="link at-r1c4"><span>中継して包む</span><span class="link-arrow">↔</span><span class="d-num">2</span></div>
  <div class="node at-r1c5">あなたのページ<span class="node-sub">開発サーバーか .html</span></div>
  <div class="vlink at-r2c3"><span class="link-arrow">↕</span><span>読み書き</span></div>
  <div class="node at-r3c1">Claude Code<span class="node-sub">stdio MCP・フック</span></div>
  <div class="link at-r3c2"><span>MCP</span><span class="link-arrow">↔</span><span class="d-num">4</span></div>
  <div class="node at-r3c3">セッション<span class="node-sub">$XDG_STATE_HOME の JSON</span></div>
</div>

<div class="steps">
  <div class="step"><span class="step-num">1</span><span><code>/browser-review:open</code> で review server が起動し、セッションが作られる</span></div>
  <div class="step"><span class="step-num">2</span><span>サーバーがページを中継し、HTML にオーバーレイ UI を差し込んで返す</span></div>
  <div class="step"><span class="step-num">3</span><span>クリックしたコメントは WebSocket でサーバーに届き、セッションに保存される</span></div>
  <div class="step"><span class="step-num">4</span><span><code>/browser-review:resolve</code> でエージェントが MCP から受け取り、直すとピンが緑になる</span></div>
</div>

---

## エージェントは MCP ツールでコメントを受け取り修正を報告

コーディングエージェントは、MCP 経由でコメントを読み取ります。

| ツール                       | 役割                                                      |
| ---------------------------- | --------------------------------------------------------- |
| `review_status`              | セッションのモード、対象、編集範囲、待機中のコメント数    |
| `review_wait`                | 新しいコメントを最大 90 秒待つ。各コメントは 1 回だけ渡す |
| `review_list` / `review_get` | 一覧と詳細（コメント、要素のマークアップ、手がかり）      |
| `review_resolve`             | 修正済みにする。ピンが緑になり、要約が表示される          |
| `review_ask`                 | ピンの吹き出しで質問する。回答は次の `review_wait` で届く |
| `review_dismiss`             | コードを変えずに閉じ、理由をレビュアーに見せる            |
| `review_screenshot`          | ページか要素の PNG。Playwright があるときだけ使える       |

どの要素を指しているかわからなければ、エージェントは推測せずに聞き返します。

---

## 修正は別の Claude Code セッションに引き継げる

browser-review のコメントは、リポジトリを開いた別の Claude Code にも渡せます。

```text
Watch this browser-review session and fix the code for each comment that arrives.
Work in the repository that owns the reviewed page.

MCP server URL: http://127.0.0.1:53211/r/<token>/__br/mcp
claude mcp add --transport http review 'http://127.0.0.1:53211/r/<token>/__br/mcp'
...
```

依頼文は、MCP URL 付きでオーバーレイ UI からコピーできます。
MCP を使わないエージェントやシェルスクリプトは、HTTP フィードを `curl` で読めば同じコメントを受け取れます。

---

## 確度の高い手がかりから順に修正箇所を特定

オーバーレイ UI が要素の手がかりを集め、ソースに近い順に並べます。
エージェントはその順に試し、最初に当たったところで止まります。

<div class="pipe">
  <div class="pipe-row"><div class="pipe-badge pipe-95">0.95 loc</div><div class="pipe-desc"><code>data-review-src</code> 属性。html-file サーバーか Vite プラグインが付ける</div></div>
  <div class="pipe-row"><div class="pipe-badge pipe-90">0.90 loc</div><div class="pipe-desc">Svelte の <code>__svelte_meta</code>、React の <code>_debugSource</code></div></div>
  <div class="pipe-row"><div class="pipe-badge pipe-80">0.80 component</div><div class="pipe-desc">要素を囲む React / Vue のコンポーネント階層</div></div>
  <div class="pipe-row"><div class="pipe-badge pipe-70">0.70 data</div><div class="pipe-desc"><code>data-testid</code>、<code>data-cy</code>、<code>id</code> など</div></div>
  <div class="pipe-row"><div class="pipe-badge pipe-60">0.60 css</div><div class="pipe-desc">要素にマッチするスタイルシートのルール</div></div>
  <div class="pipe-row"><div class="pipe-badge pipe-40">0.40 selector</div><div class="pipe-desc">生成した CSS セレクター、表示テキスト、位置と大きさ</div></div>
</div>

<br>

`loc` はファイルと行なので直接開けます。それより下は grep の手がかりです。

---

## React 19 は Vite プラグインで行番号を補完

React 19 では `_debugSource` がなくなり、DOM から出どころをたどれません。

```ts
import browserReview from "@browser-review/vite-plugin";

export default defineConfig({
  plugins: [browserReview(), react()],
});
```

- JSX 要素に `data-review-src` を付け、確度 0.95 の手がかりにする
- コードは再生成しないので**行番号がずれない**。ビルドにも影響しない
- 入れなくても動く。そのときはセレクターなど確度の低い手がかりから探す

---

<!-- _class: lead -->

<p class="cta-heading">ぜひ使ってみてください</p>

<div class="install-hero">/plugin marketplace add kechol/browser-review<br>/plugin install browser-review@browser-review</div>

CLI だけ使うなら次のどちらか

`npm install --global browser-review`

`brew install kechol/tap/browser-review`

<div class="links">

<img class="icon-inline" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/github/github-original.svg" alt="GitHub" /> https://github.com/kechol/browser-review

</div>

---

## Appendix：コマンド早見表

| 分類            | コマンド                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| **Claude Code** | `/browser-review:open` / `:resolve` / `:status` / `:close`                 |
| **CLI**         | `browser-review open <file.html \| URL> [--port] [--project-dir] [--json]` |
|                 | `browser-review status [--session] [--json]`                               |
|                 | `browser-review close [--session <id\|latest>]`                            |
|                 | `browser-review mcp [--session <id\|latest>]`（stdio MCP）                 |
| **HTTP**        | `GET /pending` / `GET /feed`（SSE）/ `POST /resolve` / `/ask` / `/dismiss` |
| **Vite**        | `npm install --save-dev @browser-review/vite-plugin`                       |

**前提**：Node.js 24 以上、macOS または Linux（Windows は非対応）。

<p class="note">browser-review は Anthropic とは無関係の独立したサードパーティ製ツールです。
「Claude」「Claude Code」は Anthropic PBC の商標で、対応先を示すためだけに使っています。</p>
