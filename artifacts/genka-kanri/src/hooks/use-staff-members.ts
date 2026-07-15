import { useQuery } from "@tanstack/react-query";

/**
 * 担当者マスタの共通フック。
 * queryKey ["/api/staff-members"] はアプリ全体で共有するため、
 * 必ずこのフック経由で取得し「1キー＝1形（配列）」を守ること（use-vendors.ts と同じ方針）。
 */

export interface StaffMemberRow {
  id: number;
  code: string;
  name: string;
}

export const STAFF_MEMBERS_QUERY_KEY = ["/api/staff-members"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function fetchStaffMembers(): Promise<StaffMemberRow[]> {
  const res = await fetch(`${BASE}/api/staff-members`);
  if (!res.ok) throw new Error("Failed to fetch staff members");
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.items ?? []);
}

export function useStaffMembers() {
  return useQuery({
    queryKey: STAFF_MEMBERS_QUERY_KEY,
    queryFn: fetchStaffMembers,
    staleTime: 60_000,
  });
}
