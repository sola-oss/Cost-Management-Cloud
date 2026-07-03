import { useQuery } from "@tanstack/react-query";

/**
 * 仕入先（vendors）一覧を取得する共通フック。
 *
 * 重要: アプリ全体で queryKey ["/api/vendors"] を共有しているため、
 * ここで「必ず配列を返す」よう正規化して一元化している。
 * 以前は各ページが個別に useVendors を定義し、ある画面は {items:[...]} を、
 * 別の画面は [...] をキャッシュに書き込んでいたため、共有キャッシュの形が
 * 画面遷移の順番で変わり、配列前提の .map() 側が
 * 「y.map is not a function」でクラッシュしていた（単価マスタが真っ白になる不具合）。
 *
 * API (/api/vendors) は {items:[...], total} を返すが、消費側はほぼ全て配列を
 * 期待しているので、配列に統一する。件数が必要な場合は data.length を使う。
 *
 * 各ページ固有のフィールドは型引数で指定する:
 *   const { data: vendors = [] } = useVendors<VendorItem>();
 */

export interface VendorRow {
  id: number;
  name: string;
  [key: string]: unknown;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function fetchVendors<T = VendorRow>(): Promise<T[]> {
  const res = await fetch(`${BASE}/api/vendors`);
  if (!res.ok) throw new Error("Failed to fetch vendors");
  const data = await res.json();
  return (Array.isArray(data) ? data : (data?.items ?? [])) as T[];
}

export function useVendors<T = VendorRow>() {
  return useQuery({
    queryKey: ["/api/vendors"],
    queryFn: () => fetchVendors<T>(),
    staleTime: 60_000,
  });
}
