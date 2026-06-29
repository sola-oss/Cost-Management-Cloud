/**
 * 採番（伝票番号・見積番号・請求番号など）の競合対策。
 *
 * これらの番号は「当日分の最大連番 + 1」をアプリ側で計算して採番しているため、
 * 2件がほぼ同時に作成されると同じ番号を計算してしまう競合がありうる。
 * 対象カラムには unique 制約があるので重複 INSERT は Postgres が拒否する（エラーコード 23505）。
 * そこで 23505 を捕まえたら番号を採り直して再挿入し、競合を吸収する。
 */
import { db } from "@workspace/db";

/** db.transaction のコールバックが受け取るトランザクション実行子の型 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 再衝突を避けるためのランダムな短い待機 */
function collisionBackoff(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 40)));
}

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
        await collisionBackoff();
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * `withUniqueNumberRetry` のトランザクション版。
 * 採番した番号で `run` 内の一連の書き込みを **1つのトランザクション**として実行する。
 * 途中で番号重複(23505)が起きるとトランザクション全体がロールバックされるため、
 * その場合は番号を採り直してトランザクションごと再実行する（中途半端な書き込みは残らない）。
 *
 * @param generate 採番関数
 * @param run      採番した番号とトランザクション実行子 tx を受け取り、全書き込みを行う関数
 */
export async function withUniqueNumberTransaction<T>(
  generate: () => Promise<string>,
  run: (num: string, tx: Tx) => Promise<T>,
  maxAttempts = 20,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const num = await generate();
    try {
      return await db.transaction((tx) => run(num, tx));
    } catch (e) {
      lastErr = e;
      if (isUniqueViolation(e) && attempt < maxAttempts) {
        await collisionBackoff();
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
