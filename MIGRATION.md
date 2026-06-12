# Replit → Supabase + Railway 移行手順

このアプリを Replit から **Supabase（DB）＋ Railway（実行環境）** に移行するための手順書。

## 構成（移行後）

- **Railway に1サービス**：Express が API（`/api/*`）と、ビルドしたフロント（SPA）を**同一ドメインで配信**する。
  - フロントは API を相対パス `/api/...` で呼ぶため、別ドメインに分けると CORS 対応が必要。**1サービスが最も簡単**。
- **Supabase**：PostgreSQL（マネージド）。
- これで Replit は不要になる（Replit 固有機能は未使用）。

```
[ブラウザ] ──→ [Railway: Express]
                   ├─ /api/*      → API（DBへ）
                   └─ それ以外     → フロント(dist/public/index.html)
                          │
                          └──→ [Supabase: PostgreSQL]
```

---

## 1. Supabase（DB）を用意する

1. supabase.com でプロジェクト作成（リージョンは東京/大阪推奨）。DBパスワードを控える。
2. 接続文字列を取得：**Project Settings → Database → Connection string**。
   - **常駐サーバー（Railway）なので「Direct connection」または「Session pooler」を使う**（ポート 5432）。
   - ⚠ 「Transaction pooler（ポート 6543）」は prepared statement と相性が悪く Drizzle/pg で不具合が出ることがある。**避ける**。
3. データを流し込む（このリポジトリの `migration/db_full.sql` に スキーマ＋データ がある）：
   ```bash
   psql "<SupabaseのDirect接続URL>" -f migration/db_full.sql
   ```
   - 代替：スキーマだけ Drizzle で作る場合 → `DATABASE_URL=<Supabase> pnpm --filter @workspace/db push` の後、`migration/db_data_only.sql` を流す。
   - ※ `migration/*.sql` は最新ローカルDBのダンプ。古ければ `pg_dump --no-owner --no-privileges --clean --if-exists <ローカルDB> > migration/db_full.sql` で取り直す。

## 2. Railway（実行環境）を用意する

1. railway.app で New Project → **Deploy from GitHub repo**（`sola-oss/Cost-Management-Cloud`）。
2. **環境変数**を設定（Variables）：
   | 変数 | 値 |
   |---|---|
   | `DATABASE_URL` | Supabaseの接続URL（Direct/Session, ポート5432） |
   | `NODE_ENV` | `production` |
   | `LOG_LEVEL` | `info`（任意） |
   | `PORT` | **設定不要**（Railwayが自動で与える。アプリはそれを読む） |
   - フロントのビルドに環境変数は不要（base は `/`、PORTも不要に修正済み）。
3. **ビルド/起動コマンド**（Settings → Build/Deploy。nixpacks 自動検出でも可）：
   - Build: `pnpm install && pnpm run build`
     - ルートの `build` が「型チェック → 全パッケージのビルド（lib/db → api-server → フロント）」を依存順で実行する。
   - Start: `pnpm run start`
     - = api-server を起動。api-server が `genka-kanri/dist/public` を検出してフロントも配信する。
4. Node バージョンは `.nvmrc`（22）と `engines` で固定済み。

## 3. 動作確認

- Railway が払い出す URL を開く → ログイン無しでダッシュボードが出る。
- `/api/work-types` が JSON を返す（200）。
- 工事台帳・PDF出力（日本語フォント `/fonts/...`）・全銀CSVが動く。

## 4. 切替（カットオーバー）

- 問題なければ Replit を停止。GitHub と Replit の連携を切る（以後は Railway が GitHub から自動デプロイ）。
- 独自ドメインを使う場合は Railway の Custom Domain に設定。

---

## ✅ 実デプロイ済み（2026-06-12）

- 本番URL：**https://cost-management-cloud-production.up.railway.app**
- Railwayプロジェクト：`cost-management-cloud`（GitHub `main` 連携・push で自動デプロイ）
- DB：Supabase（プロジェクト ref `rnysqjnqdpdmaylojwqr`、Tokyo）

### 実デプロイで判明した重要ポイント（再現時の必須設定）

1. **DBは「Session pooler（IPv4）」を使う**（最重要）
   - Supabaseの **Direct connection（`db.xxx.supabase.co`）は IPv6 専用**で、**RailwayはIPv6に出られず `ENETUNREACH` で接続不可**。
   - 正解は **Session pooler**：`postgresql://postgres.<ref>:<PW>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`
     - ユーザー名が `postgres.<ref>`、ホストが `pooler.supabase.com`、**ポート5432（session mode）**。
     - ⚠ ポート6543（transaction mode）はDrizzleのprepared statementと相性が悪いので使わない。
   - 東京は `aws-1-ap-northeast-1`（`aws-0` ではない場合がある。Supabaseの Connect → Session pooler の表示が正）。
2. **install を `--no-frozen-lockfile` にする**
   - lockfileとoverridesの不一致でnixpacksの `pnpm i --frozen-lockfile` が失敗する。
   - 環境変数 `NIXPACKS_INSTALL_CMD=pnpm install --no-frozen-lockfile` を設定。
3. **本番ビルドは必要パッケージだけ**（`railway.json` 設定済み）
   - `pnpm run build`（全パッケージ）だと `mockup-sandbox` 等のビルドで落ちる。
   - `pnpm --filter "@workspace/api-server..." --filter "@workspace/genka-kanri..." run build` で依存込みの本番分のみビルド。
4. Railway の環境変数（最終形）：`DATABASE_URL`（Session pooler）/ `NODE_ENV=production` / `LOG_LEVEL=info` / `NIXPACKS_INSTALL_CMD`。`PORT` はRailway自動。

## 補足・既知の注意点

- **同一ドメイン配信のコード**：`artifacts/api-server/src/app.ts` で、`genka-kanri/dist/public` が存在すれば静的配信＋SPAフォールバックを行う（開発時は dist が無いので Vite が配信）。配信先を変えたい場合は `FRONTEND_DIST` 環境変数で上書き可能。
- **フロントのビルド出力**：`genka-kanri/dist/public`（vite.config.ts の `build.outDir`）。
- **Replit固有プラグイン**：`vite.config.ts` に `@replit/*` プラグインが残っているが、`REPL_ID` 未設定では無効化される（runtime-error-modal は dev のみ動作）。将来的に外してよい。
- **PDF日本語フォント・全銀Shift_JIS**：Node/Linux でそのまま動作（同梱フォントは静的配信される）。
- **ローカル開発は従来どおり**：api-server は `DATABASE_URL=... PORT=3000 pnpm run dev`、フロントは `PORT=5173 BASE_PATH=/ pnpm run dev`。
