# CMC 引き継ぎメモ（2026-07-27 時点）

新しいチャットでこのファイルを読ませれば続きから作業できます。

## プロジェクト
- **CMC = 原価管理クラウド**（建設業向け）／ `/Users/i/アプリ開発/Cost-Management-Cloud`（pnpm モノレポ）
  - フロント `artifacts/genka-kanri`（Vite + React + wouter + TanStack Query + Tailwind）
  - API `artifacts/api-server`（Express + Drizzle）／ スキーマ `lib/db/src/schema`
- DB: Supabase（プロジェクト "Cost Management Cloud" = `rnysqjnqdpdmaylojwqr`）
- デプロイ: Railway。**main への push で自動デプロイ**
- 本番: `cost-management-cloud-production.up.railway.app` ／ repo: `github.com/sola-oss/Cost-Management-Cloud`

## 重要な前提
- **おおつか様が本番を実利用中**。本番には実案件名・仕入先197社・社員27名の**実名**が入っている。
- **商談デモに本番URLを使わない**（守秘）。デモは必ずローカル（下記）。
- 標準手順：実装 → typecheck/build → ローカル確認 → デプロイ → URL確認

## デモ環境（商談用）
- デスクトップの **`CMCデモ起動.command`**（起動）と **`CMCデモ初期化.command`**（データ作り直し）
- DB `cmc_demo` ／ 投入スクリプト `lib/db/seed-demo.mjs`
- 架空の「株式会社みらい建設」。工事4件を意図的に4状態（順調／原価先行／出来高未入力／予算超過）に。
  全体で予定粗利 3,420万 → 着地見込み 1,876万 と落差が出るよう金額を設計。
- ログイン `demo@mirai-kensetsu.example` / `MiraiDemo2026`
- 起動時に出る LAN URL で**同じWi-Fiのスマホから開ける**（「自分の現場」を客先の携帯で触ってもらえる）
- **デモの原価はすべて仕入伝票から発生させてある。** CMCには原価の直接入力UIが無く、自社職人の
  出面入力も未実装。相手先のない原価を出すと「どうやって入れるのか」に答えられなくなるため。

## この期間に作ったもの（すべて main にコミット済み）
### 仕入の振り分け（旧「仮デジタル請求書」）
下請から届く請求書・納品書を先にデータ化し、現場担当者が**納品書のかたまり単位**で工事を選ぶ仕組み。
手書きで工事名を書く運用を置き換えるのが目的（見込み客の保留理由がここだった）。

- 事務：アップロード → AI読み取り（`claude-sonnet-5`）→ 送り先を複数選択 → 送信
- 現場：`自分の現場` の「届いている書類」から開く → ブロックごとに工事を選ぶ → 事務に返す
- 事務：確定 → **工事ごとに仕入伝票を生成** → 原価に計上
- AIが読めない書類用に**手入力**の逃げ道あり（※科目が全部「材料費」固定＝未修正）
- 入金・繰越などの行は `isNonPurchase` で原価から除外。返品・値引きはマイナスの仕入行として計上。
- 主なファイル: `artifacts/api-server/src/routes/{ai-extract,received-invoices}.ts`、
  `artifacts/genka-kanri/src/pages/received-invoices/*`、`lib/db/src/schema/received-invoices.ts`

### ダッシュボード（`/`）
- 旧「ダッシュボード」と「経営ダッシュボード」を1つに統合（`pages/executive.tsx`）
- 着地見込み ＝ 請負 −（実績原価 ÷ 出来高）。出来高未入力／原価消化率5%未満のときは出さない
- 注意が要る工事（予算超過／原価が進捗より15pt以上先行／赤字見込み）を上に出す
- 粗利は**金額（大）＋率（小）**で全画面統一
- 未請求の発注残、数字の鮮度も表示

### 出来高（進捗率）入力
5%刻みスライダー。判断材料として前回・原価消化率・予算残を併記。前回より下げるときは理由必須。
月次履歴を `project_progress_records` に保存。

### 自分の現場（`/my-projects`）
現場担当者向け・スマホ前提。届いている書類／担当工事の予算残／工種ごとの内訳／出来高入力。

### その他
- 支払機能は**非表示**（支払は会計ソフト＝MFへ移行）。支払査定は「仕入集計」に作り替え
- 直近の修正：担当者の記憶が外れる不具合、仕入入力で品名が26pxに潰れる不具合

## 未対応・保留
| 件 | 状態 |
|---|---|
| **出面入力**（自社職人の人工） | Q15〜Q19の回答待ち。特に**職人単価をマスタに持ち現場に見せてよいか**が社内確認待ち |
| 手入力の科目が「材料費」固定 | 不具合。約20分で直せる。本人判断で保留中 |
| 仕入の振り分け画面で科目を変更できない | 確定後に仕入入力から編集する運用でカバー |
| 大田鋼管PDFの再検証 | 返品行(-3,532)の修正が実データで効くか未確認 |
| 現場担当者が本番にログインできない | `staff_members` と `users` が別。(A)アカウント作成 (B)トークンURL の未決 |
| Railway の環境変数 | `ANTHROPIC_API_KEY` / `SUPABASE_*` が本番未設定（AI・画像保存を本番で使うなら必要） |
| 実行予算の自動化2件 | 顧客マスタ到着後 |
| MF会計への仕訳連携 | MF側で工事をどう持つか（部門/補助科目/セグメント）が未確認 |
| 提案資料 | 未着手 |

## 既知の注意点・地雷
- **共有 queryKey の形不一致**：vendors は共通フックで解消済み。マスタ系を複数ページで共有するときは
  必ず共通フックで「**1キー=1形**」に統一する。`/api/vendors` は `{items,total}` を返す（配列ではない）。
- **Railwayビルドがたまに失敗**（`tsc: not found`）。install が `NODE_ENV=production` で devDependencies を
  飛ばすのが原因。`railway.json` の buildCommand を `NODE_ENV=development pnpm install --no-frozen-lockfile --force && …`
  にして対処済み。再発したらまずこの行を確認。
- **`preview_start` が別アプリ（genka-cloud:3001）を掴む**ことがある。
- **ローカルの `vite build` が失敗する**：`pnpm-workspace.yaml` で darwin 用ネイティブモジュールを除外して
  いるため（Replit/Linux時代の名残）。Railway（Linux）は影響なし。
- **`git stash` を使わない**：`attached_assets` の未追跡PDFと衝突して pop が失敗する事故が起きた。
- shadcn の `Input` は `display:flex`。`flex-1` と併用すると `min-width` 未指定で0まで潰れる。

## 作業のやり方（このプロジェクトのルール）
- 変更後は必ず typecheck ＋ build（フロント `artifacts/genka-kanri`、API `pnpm --filter @workspace/api-server run build`）。
- デプロイ = main へ push。反映確認はバンドルハッシュの変化や非破壊のAPIプローブで行う。
- 実顧客が本番利用中のため、DBを壊す操作・大きな変更は特に慎重に。

## 次にやること
**2026-07-27 のおおつか様との打ち合わせで出た改善点への対応。**（内容は新しいチャットで確認）
