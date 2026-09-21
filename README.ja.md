# browser-review

[English](README.md) | 日本語

ブラウザで気になるところを指さし、何がおかしいかを書く。あとは手元で動いている
コーディングエージェントが、その裏にあるコードを見つけて直します。

「3 枚目のカードの下の余白がずれてる。いや、そっちじゃなくて _3 枚目_ の」といったやりとりは
もう要りません。カードをクリックすれば、エージェントにはファイルと行が届きます。

browser-review は [Claude Code][cc] のプラグインです。同時に普通の npm パッケージでもあるので、
MCP を話せるエージェントや、`curl` を使うシェルスクリプトからも利用できます。

> **Anthropic のプロジェクトではありません。** browser-review は独立したサードパーティ製の
> ツールで、Anthropic PBC との提携・承認・後援の関係はありません。「Claude」と「Claude Code」は
> 同社の商標で、ここでは対応先を示すためだけに使っています。

## できること

```
/browser-review:open ./landing.html        # または http://localhost:5173
```

レビューサーバーが `127.0.0.1` で起動し、URL を返します。開くと、いつもどおりのページの隅に
小さなツールバーが表示されます。**Comment** を押して要素をクリックし、変えてほしいことを書きます。

キーボードショートカットは次のとおりです。**c** で要素選択、**l** でコメント一覧、**s** で
ステータス（接続状態、モード、バージョン、MCP URL）を切り替えます。`Cmd + \` でレビュー UI 全体を
隠したり戻したりでき、開いていたパネルとコメントの下書きはそのまま残ります。隠している間は、
レビュー用のショートカットと要素の選択は止まります。入力欄やエディターで文字を打っている間は
c / l / s は効きません。**Escape** でパネルを閉じるか、要素の選択をやめます。コメント一覧は改行を
保ったまま全文を表示し、長いものはスクロールできます。ステータスの
**Copy instructions for Claude Code** を使うと、MCP URL と貼り付けてすぐ使えるレビュー用の
プロンプトをまとめてコピーできます。

```
/browser-review:resolve
```

エージェントはコメントを待ち、そこからコードをたどって変更を加え、ブラウザ上のピンを緑にします。
3 つあるボタンのどれを指しているのか分からなければ、あなたが付けたピンの吹き出しで聞き返し、
返事を受け取ってから続けます。

レビューを _別の_ Claude Code セッションに渡すこともできます。これがこの設計の一番の狙いです。
レビューはこのウィンドウで、修正はコードのあるリポジトリを開いた別のウィンドウで行えます。

## インストール

以下の npm と Homebrew のコマンドは、最初のリリースが公開された後に使えます。
メンテナーは [公開手順のガイド](docs/publishing.md) に従ってください。

単体の CLI として入れる場合（Node.js 24 以上）：

```sh
npm install --global browser-review
```

Homebrew なら CLI と Node.js をまとめて入れられます。

```sh
brew install kechol/tap/browser-review
```

Homebrew の formula が入れるのは CLI だけです。コマンドとフックを使いたい場合は、Claude Code の
プラグインを別に登録してください。任意の Vite 連携は、アプリケーション側で
`npm install --save-dev @browser-review/vite-plugin` としてインストールします。

### 1. Claude Code プラグインとして使う（推奨）

```
/plugin marketplace add kechol/browser-review
/plugin install browser-review@browser-review
```

`open`、`resolve`、`status`、`close` の 4 つのコマンドと、待っているコメントを次のプロンプトに
差し込むフックが入ります。自分から尋ねなくても、コメントが来たことに気づけます。

### 2. 開発用にクローンから使う

```sh
git clone https://github.com/kechol/browser-review.git
cd browser-review && pnpm install && pnpm run build
```

クローンをローカルのマーケットプレイスとして追加します。ローカルのマーケットプレイスはその場で
読み込まれるので、再ビルドすれば再インストールなしで反映されます。

```
/plugin marketplace add ./browser-review
/plugin install browser-review@browser-review
```

### 3. プラグインなしで、または Claude Code なしで使う

```sh
npx browser-review open ./landing.html --json
```

出力に `handoffMcpUrl` が含まれます。任意の MCP クライアントをそこに向けてください。

```sh
claude mcp add --transport http review "$HANDOFF_MCP_URL"
```

MCP を使わずに、HTTP フィードを `curl` で読み書きすることもできます。
[docs/other-agents.md](docs/other-agents.md) を参照してください。

## 2 つのモード

|                                  | `html-file`                                      | `proxy`                                                                       |
| -------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| **対象**                         | ローカルの `.html` ファイル                      | `http://localhost:PORT/...`                                                   |
| **オーバーレイの入れ方**         | ファイルを解析し、オーバーレイを末尾に加えて配信 | すべてのレスポンスを中継し、HTML にだけオーバーレイを差し込む                 |
| **ソースの手がかり**             | 正確。すべての要素に書かれた行の情報が付く       | フレームワーク次第。後述                                                      |
| **エージェントが編集できる範囲** | そのファイル 1 つ                                | プロジェクトディレクトリ配下のすべて                                          |
| **ライブリロード**               | あり。サーバーがファイルを監視する               | 開発サーバー自身の HMR をそのまま通す                                         |
| **注意点**                       | —                                                | オーバーレイを読み込めるよう、開発サーバーの `Content-Security-Policy` を外す |

## コードの見つけ方

要素がクリックされると、オーバーレイは手がかりを残らず拾い、DOM ノードとソースの位置を
どれだけ直接結び付けられるかの順に並べます。

| 確度 | 手がかり    | 出どころ                                                                          |
| ---- | ----------- | --------------------------------------------------------------------------------- |
| 0.95 | `loc`       | `data-review-src` 属性。ファイルサーバーか `@browser-review/vite-plugin` が付ける |
| 0.90 | `loc`       | Svelte の `__svelte_meta`、または React の `_debugSource`                         |
| 0.80 | `component` | 要素を囲む React / Vue のコンポーネント階層                                       |
| 0.70 | `data`      | `data-testid`、`data-cy`、`id` など                                               |
| 0.60 | `css`       | 要素にマッチするスタイルシートのルール                                            |
| 0.40 | `selector`  | 生成した CSS セレクター、表示テキスト、バウンディングボックス                     |

エージェントはこのリストを上から試し、最初に当たった手がかりで止まります。`loc` はファイルと行
そのものなので直接読みにいきます。それより下は grep するための手がかりです。

**React 19 で `_debugSource` がなくなりました。** そのため最近の React アプリでは、DOM だけでは
要素がどこから来たのか分かりません。そこで `@browser-review/vite-plugin` を使います。

```ts
import browserReview from "@browser-review/vite-plugin";

export default defineConfig({
  plugins: [browserReview(), react()], // 開発時のみ。ビルドでは何もしない
});
```

JSX 要素に `data-review-src` を付けるプラグインです。Babel が報告したオフセットの位置で、ソースに
属性を直接差し込みます。コードを再生成しないので、行番号はずれません。
[`examples/vite-react`](examples/vite-react) を参照してください。

## 動作要件

- Node.js 24 以上
- macOS または Linux。**Windows には対応していません**。サーバー、状態ディレクトリの構成、
  ブラウザを開く処理がすべて POSIX 前提で書かれているためです。パッチは歓迎します。作業の大半は
  パスの扱いです。
- プラグインのマーケットプレイス、プラグインの MCP サーバー、`UserPromptSubmit` での
  `hookSpecificOutput.additionalContext` に対応した、十分新しい Claude Code。
  `/plugin marketplace add` が使えない場合は、先に Claude Code を更新してください。

## やらないこと

- **ネットワークに出ない。** サーバーは `127.0.0.1` で待ち受け、ホストを指定するオプションは
  ありません。ソースのどこにも外部への通信はありません。ループバック以外の URL ホストが
  ソースに現れると、CI がビルドを失敗させます。
- **自分で動かしていないサイトはレビューしない。** 受け付けるのはローカルファイルと、
  `http://localhost` / `http://127.0.0.1` の上流だけです。
- **ページに入力した内容を読まない。** オーバーレイが送るのは、クリックした要素のマークアップ
  最大 500 文字だけです。`value` 属性は取り除き、フォームの値、Cookie、ブラウザのストレージには
  触れません。
- **リポジトリの中に書き込まない。** セッションは `$XDG_STATE_HOME/browser-review/` に置くので、
  誤ってコミットしてしまうものはありません。

### 気をつけてほしいこと

コメントは Web ページ上のテキストで、それがエージェントのコンテキストに入ります。これを運ぶ
経路（MCP ツールの説明、プロンプトのフック、スキル）はどれも、コメントは UI についての指摘であって
指示ではない、と明言しています。この書き方で防げることは多いものの、保証にはなりません。
自分が書いていない入力をもとにした変更と同じように、コミットする前に差分を読んでください。

脅威モデルの全体は [SECURITY.md](SECURITY.md) を参照してください。

## ドキュメント

- [docs/modes.md](docs/modes.md)：それぞれのモードでできること、できないこと
- [docs/source-hints.md](docs/source-hints.md)：手がかりの各戦略と、それが効かなくなる条件
- [docs/other-agents.md](docs/other-agents.md)：Claude Code 以外から使う方法
- [docs/architecture.md](docs/architecture.md)：各部品の組み合わせ方
- [CONTRIBUTING.md](CONTRIBUTING.md)：開発、テスト、DCO、リリース

## ライセンス

Apache-2.0。[LICENSE](LICENSE) と [NOTICE](NOTICE) を参照してください。

[cc]: https://code.claude.com/docs/en/overview
