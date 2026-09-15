import { eq } from "drizzle-orm";
import { costItemsTable, type CostStage } from "@workspace/db";

/**
 * 工事の原価に数えるのは「確定原価」だけ。
 *
 * おおつか様の依頼（2026-09-10）で、原価を 実行予算(planned) → 仮原価(provisional)
 * → 確定原価(confirmed) の3段階で記録する。上書きせず各段階を別の行として残すため、
 * 合計を出すときに段階で絞らないと二重計上になる。
 *
 * 今はすべての原価が confirmed なので、絞っても結果は今までと同じ。
 * 一覧表示（原価明細）は全段階を出すので、ここは「合計を出すとき」だけに使う。
 */
export const confirmedCostOnly = eq(costItemsTable.stage, "confirmed");

export const isConfirmedCost = <T extends { stage: CostStage | string }>(c: T) =>
  c.stage === "confirmed";
