/**
 * ログインアカウントの作成・パスワードリセット兼用スクリプト。
 * 既存メールアドレスなら パスワード（と名前）を更新、無ければ新規作成する。
 *
 * 使い方:
 *   DATABASE_URL=... pnpm --filter @workspace/scripts run set-user -- <email> <名前> <パスワード>
 * 例:
 *   DATABASE_URL=... pnpm --filter @workspace/scripts run set-user -- nukushina@example.com "温品 恵" "初期パスワード123"
 */
import crypto from "node:crypto";
import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const [email, name, password] = args;
  if (!email || !name || !password) {
    console.error("使い方: set-user -- <email> <名前> <パスワード>");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("パスワードは8文字以上にしてください");
    process.exit(1);
  }
  const normalized = email.trim().toLowerCase();
  const passwordHash = hashPassword(password);

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, normalized));
  if (existing.length > 0) {
    await db
      .update(usersTable)
      .set({ name, passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.email, normalized));
    console.log(`更新しました: ${normalized}（${name}）のパスワードを再設定`);
  } else {
    await db.insert(usersTable).values({ email: normalized, name, passwordHash, role: "admin" });
    console.log(`作成しました: ${normalized}（${name}）`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
