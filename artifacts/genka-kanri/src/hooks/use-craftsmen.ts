import { useQuery } from "@tanstack/react-query";

/** 職人マスタの共通フック（use-staff-members.ts と同じ方針：1キー＝1形（配列）） */

export interface CraftsmanRow {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

export const CRAFTSMEN_QUERY_KEY = ["/api/craftsmen"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function fetchCraftsmen(): Promise<CraftsmanRow[]> {
  const res = await fetch(`${BASE}/api/craftsmen`);
  if (!res.ok) throw new Error("Failed to fetch craftsmen");
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.items ?? []);
}

export function useCraftsmen() {
  return useQuery({ queryKey: CRAFTSMEN_QUERY_KEY, queryFn: fetchCraftsmen, staleTime: 60_000 });
}
