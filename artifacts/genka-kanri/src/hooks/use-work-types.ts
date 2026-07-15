import { useQuery } from "@tanstack/react-query";

/**
 * 工種（work-types）一覧を取得する共通フック。
 *
 * 重要: アプリ全体で queryKey ["/api/work-types"] を共有しているため、
 * ここで「必ず配列を返す」よう正規化して一元化している。
 * 同じキーに別の形（{items:[...]} と [...]）を書き込むと、共有キャッシュの形が
 * 画面遷移の順番で変わり、配列前提の .map() 側がクラッシュする
 * （vendors で実際に起きた「単価マスタが真っ白」不具合と同じ構造）。
 *
 * API (/api/work-types) は現在素の配列を返すが、将来 {items, total} 形式へ
 * 変わっても壊れないよう両対応で正規化する。件数が必要な場合は data.length を使う。
 *
 * 各ページ固有のフィールドは型引数で指定する:
 *   const { data: workTypes = [] } = useWorkTypes<WorkTypeItem>();
 */

export interface WorkTypeRow {
  id: number;
  code: string;
  name: string;
  [key: string]: unknown;
}

export const WORK_TYPES_QUERY_KEY = ["/api/work-types"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function fetchWorkTypes<T = WorkTypeRow>(): Promise<T[]> {
  const res = await fetch(`${BASE}/api/work-types`);
  if (!res.ok) throw new Error("Failed to fetch work types");
  const data = await res.json();
  return (Array.isArray(data) ? data : (data?.items ?? [])) as T[];
}

export function useWorkTypes<T = WorkTypeRow>() {
  return useQuery({
    queryKey: WORK_TYPES_QUERY_KEY,
    queryFn: () => fetchWorkTypes<T>(),
    staleTime: 60_000,
  });
}
