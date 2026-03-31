# 原価管理クラウド (Construction Cost Management Cloud)

## Overview

建設業向けクラウド原価管理システム。工事管理・原価入力・予算管理・収支レポートを一元管理する。

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (Wouter routing, React Query, shadcn/ui, Recharts)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── genka-kanri/        # React + Vite frontend (previewPath: /)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/
│           ├── projects.ts     # 工事テーブル
│           ├── cost-items.ts   # 原価項目テーブル
│           ├── budgets.ts      # 予算テーブル（旧4区分固定・後方互換のため保持）
│           ├── budget-items.ts # 実行予算明細テーブル（工種コード・仕入先管理）
│           └── payments.ts     # 支払管理テーブル
├── scripts/                # Utility scripts
└── ...
```

## Features

- **ダッシュボード** — KPI概要、原価項目別構成（PieChart）、月別原価推移（AreaChart）
- **工事一覧** — 工事のCRUD、ステータスフィルタ、得意先名列、予算消化率バー、粗利率
- **工事詳細（タブ付き）** — 4タブ構成：基本情報・実行予算・原価明細・収支状況
  - **基本情報タブ** — 工事情報の表示・インライン編集
  - **実行予算タブ** — 工種コード・仕入先・請負金額・当初予算・実行予算のグリッド表示。行の追加・インライン編集・削除。予定利益率サマリーKPI表示。20種の工種マスタ選択対応
  - **原価明細タブ** — 原価明細一覧（モーダル追加・削除）、カテゴリ別フィルタ・テキスト検索、件数・合計表示
  - **収支状況タブ** — KPI、工種別予算実績グラフ（BarChart）、収支明細テーブル
- **収支レポート** — 工事間比較BarChart、要注意工事リスト
- **仕入入力** (/purchases) — 全工事共通の原価計上フォーム（数量×単価自動計算）、直近50件の全工事仕入一覧、カテゴリフィルタ
- **支払管理** (/payments) — 支払一覧・KPI（総額・未払・支払済・支払率）、ステータスフィルタ、工事別絞り込み、支払済マーク・取消・削除

## API Routes

- `GET /api/projects` — 工事一覧
- `POST /api/projects` — 工事登録
- `GET /api/projects/:id` — 工事詳細（原価・予算含む）
- `PUT /api/projects/:id` — 工事更新
- `DELETE /api/projects/:id` — 工事削除
- `GET /api/projects/:id/summary` — 工事収支サマリ
- `GET /api/projects/:id/budget-items` — 実行予算明細一覧
- `POST /api/projects/:id/budget-items` — 実行予算明細登録
- `PUT /api/projects/:id/budget-items/:itemId` — 実行予算明細更新
- `DELETE /api/projects/:id/budget-items/:itemId` — 実行予算明細削除
- `GET /api/cost-items?projectId=` — 原価項目一覧
- `POST /api/cost-items` — 原価項目登録
- `PUT /api/cost-items/:id` — 原価項目更新
- `DELETE /api/cost-items/:id` — 原価項目削除
- `GET /api/budgets?projectId=` — 予算一覧
- `POST /api/budgets` — 予算登録
- `PUT /api/budgets/:id` — 予算更新
- `GET /api/dashboard/overview` — ダッシュボード概要
- `GET /api/dashboard/cost-by-category` — カテゴリ別原価集計
- `GET /api/dashboard/monthly-costs` — 月別原価推移
- `GET /api/dashboard/budget-vs-actual` — 予算実績対比

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only emit `.d.ts` files during typecheck
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in `references`

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly`

## Database

Production migrations are handled by Replit when publishing. In development, use:
- `pnpm --filter @workspace/db run push` — push schema changes
- `pnpm --filter @workspace/db run push-force` — force push

## Codegen

Run after OpenAPI spec changes:
```bash
pnpm --filter @workspace/api-spec run codegen
```

## Seed Data

5 construction projects pre-seeded with budgets and cost items for demonstration.
