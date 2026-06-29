/**
 * 採番（伝票番号・見積番号・請求番号など）の競合対策。
 *
 * これらの番号は「当日分の最大連番 + 1」をアプリ側で計算して採番しているため、
 * 2件がほぼ同時に作成されると同じ番号を計算してしまう競合がありうる。
 * 対象カラムには unique 制約があるので重複 INSERT は Postgres が拒否する（エラーコード 23505）。
 * そこで 23505 を捕まえたら番号を採り直して再挿入し、競合を吸収する。
 */

/**
 * Postgres の unique_violation(23505) かどうか。
 * Drizzle は元の pg エラーを _DrizzleQueryError でラップし、コードを `cause` 側に持つため、
 * cause を再帰的にたどって判定する。
 */
function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  if ((e as { code?: string }).code === "23505") return true;
  const cause = (e as { cause?: unknown }).cause;
  return cause != null && cause !== e && isUniqueViolation(cause);
}

/**
 * `generate` で番号を採番し `insert` で挿入する。
 * unique 制約違反（同番号の同時挿入）が起きたら番号を採り直して再試行する。
 *
 * @param generate 採番関数（呼ぶたびに最新の最大連番+1を返す想定）
 * @param insert   採番した番号で実際の挿入を行い、挿入結果を返す関数
 */
export async function withUniqueNumberRetry<T>(
  generate: () => Promise<string>,
  insert: (num: string) => Promise<T>,
  maxAttempts = 20,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const num = await generate();
    try {
      return await insert(num);
    } catch (e) {
      lastErr = e;
      if (isUniqueViolation(e) && attempt < maxAttempts) {
        // 同時リクエストの「最大連番の読み取り」が同期して再衝突するのを防ぐため、
        // 競合時はごく短いランダム待機を挟んでタイミングをばらけさせてから採り直す。
        await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 40)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
