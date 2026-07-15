import { useQuery } from "@tanstack/react-query";

/**
 * 工事分類マスタの共通フック。
 * queryKey ["/api/construction-categories"] はアプリ全体で共有するため、
 * 必ずこのフック経由で取得し「1キー＝1形（配列）」を守ること（use-vendors.ts と同じ方針）。
 */

export interface ConstructionCategoryRow {
  id: number;
  code: string;
  name: string;
}

export const CONSTRUCTION_CATEGORIES_QUERY_KEY = ["/api/construction-categories"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function fetchConstructionCategories(): Promise<ConstructionCategoryRow[]> {
  const res = await fetch(`${BASE}/api/construction-categories`);
  if (!res.ok) throw new Error("Failed to fetch construction categories");
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.items ?? []);
}

export function useConstructionCategories() {
  return useQuery({
    queryKey: CONSTRUCTION_CATEGORIES_QUERY_KEY,
    queryFn: fetchConstructionCategories,
    staleTime: 60_000,
  });
}
