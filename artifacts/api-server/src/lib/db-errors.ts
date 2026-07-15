/**
 * PostgreSQLの一意制約違反(23505)かどうかを判定する。
 * drizzle-ormはDBエラーをラップして投げることがあるため、cause側のcodeも見る。
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}
