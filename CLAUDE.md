# Cost Management Cloud 開発引き継ぎ（大塚さん案件）

このメモを最初に読んで、現状を把握してから開発を進めてください。

## プロジェクトの目的

- **クライアント**: 大塚さん向けの建設業向けクラウド原価管理システム
- **参考ソフト**: レッツ原価管理Go2（発注書→仕入伝票→原価明細の3層構造）。ただし設計思想は「人がやる必要のない手順は省く」
- **Claude Codeに移行した理由**: Replitのランニングコストが高いため、開発環境をローカル+Claude Codeに移したい
- **最終目的**: 大塚さんが実運用できる状態に仕上げる

## 技術構成

- pnpm workspace モノレポ
  - `artifacts/api-server` … Express 5（API）
  - `artifacts/genka-kanri` … React + Vite（フロント、Wouter / React Query / shadcn/ui / Recharts）
  - `lib/db` … Drizzle ORM + PostgreSQL スキーマ・接続
  - `lib/api-spec` / `lib/api-client-react` / `lib/api-zod` … OpenAPI + Orval codegen
- GitHub: `sola-oss/Cost-Management-Cloud`（**push するとReplit本番にも反映されるので注意**）

## ローカル起動方法（今日セットアップ済み）

- **DB**: ローカルPostgres。`DATABASE_URL=postgresql://i@localhost:5432/costmanagement`
  - Replitの本番DB(heliumdb)からダンプを移行済み（大塚邸データ入り、cost_itemsは0件）
- **api-server起動**: `artifacts/api-server` で
  `DATABASE_URL=postgresql://i@localhost:5432/costmanagement NODE_ENV=development PORT=3000 pnpm run dev`
- **フロント起動**: `artifacts/genka-kanri` で
  `PORT=5173 BASE_PATH=/ NODE_ENV=development pnpm run dev`
- `vite.config.ts` に `/api` → `localhost:3000` のプロキシ追加済み
- **注意**: Replit発祥のため `pnpm-workspace.yaml` で darwin系モジュールが overrides 除外されている。ローカルで足りないネイティブモジュール（例: `@rollup/rollup-darwin-arm64`）は都度入れる必要あり

## 開発の現状

画面作成はほぼ完了。以下すべて実装済み：
- 見積書、実行予算（見積取込ボタンあり）、仕入入力（実績原価入力・発注書取込あり）
- 予実管理（収支状況・予算残・粗利率）、工事台帳
- 粗利率は3階層で表示確認済み：ダッシュボード（平均）／工事一覧・工事台帳（工事ごと）／実行予算画面（行ごとの予定利益率）
- 仕入先マスタは登録済み（東北建材株式会社 など）
- 工種マスタ — 21件シード済み（建築・土木・設備・その他）
- **単価マスタ** — DB(`unit_prices`)・API(`/api/unit-prices`)・管理画面(`/master/unit-prices`) 新規実装済み
  - 仕入先 × 工種 × 品目 → 単価 の構造
  - テストデータ3件登録済み（東北建材: 構造用合板, 杉KD材, 石膏ボード）
- ※ 現状はダミーデータ。精度検証は実データ投入後

### 2025-06-05 実装分

**単価マスタ（②）**
- `lib/db/src/schema/unit-prices.ts` — テーブルスキーマ
- `artifacts/api-server/src/routes/unit-prices.ts` — CRUD API + フィルタ
- `artifacts/genka-kanri/src/pages/master/unit-prices.tsx` — 管理画面

**単価ピッカー（③入力改善）**
- `artifacts/genka-kanri/src/components/unit-price-picker.tsx` — 共通コンポーネント
- 適用先: 仕入入力(`purchases.tsx`)、発注書(`purchase-orders/index.tsx`)、実行予算(`budgets.tsx`)
- フロー: 仕入先選択 → 「単価選択」ボタン → 品目一覧から選択 → 品名・単位・単価・工種を自動補完

**仕入入力画面のUI改善**
- ヘッダー整理: 主要3項目（工事・仕入先・仕入日）のみ常時表示、残りは「詳細設定」折りたたみ
- 工事を先頭（最重要フィールド）に配置
- 仕入先未選択時は「単価選択」ボタン非表示
- 科目はコードなし名前のみ表示（外注費 / 材料費）
- 行の複製ボタン追加
- 単価ピッカー選択後に数量フィールドへ自動フォーカス
- 数量・単価フィールドにカンマ区切り表示（`NumberInput`コンポーネント）
- サイドバーのマスタ管理をデフォルト折りたたみ

## 残To Do

1. ~~単価マスタ~~ → ✅ 完了
2. ~~工種マスタのデータ登録~~ → ✅ 完了（21件シード済み）
3. ~~入力画面の操作性改善~~ → ✅ 完了（単価ピッカー + UI改善）
4. **テスト（実データ投入後）**: サンプル5件入力／見積→予算→実績の流れ確認／予実比較・粗利率の精度確認／使いにくい点の洗い出し
5. **単価マスタへの実データ投入** — 大塚さんからの単価表（Excel/CSV）を受け取り次第、登録する（CSV一括インポート機能は未実装、必要に応じて作る）

## ボトルネック

開発側の主要機能は完了。**最大のボトルネックは大塚側のデータ提供待ち**：
- 材料・外注業者の単価表の提供（未対応・最優先）→ 単価マスタに投入する
- サンプル工事5件（100万円以上）のデータ準備（現状ダミー1件のみ）
- レッツ原価の過去データ抽出

## 進め方の好み

- 確認質問は最小限、まとめて一気に進めたい
- 細かい確認のために手を止めず、必要な調査は自分で済ませて包括的に出力する
