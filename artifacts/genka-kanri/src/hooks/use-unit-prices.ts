import { useQuery } from "@tanstack/react-query";

/**
 * 指定した仕入先の単価マスタを取得する共通フック。
 *
 * 単価選択ダイアログ（unit-price-picker）と品名サジェスト（item-name-input）で共有する。
 * queryKey ["/api/unit-prices", "picker", vendorId] は必ずこのフック経由で使い、
 * 「1キー＝1形（配列）」を守ること（use-vendors.ts と同じ方針）。
 */

export interface UnitPriceItem {
  id: number;
  vendorId: number;
  workTypeId: number | null;
  itemName: string;
  unit: string;
  unitPrice: string;
  notes: string | null;
  vendorName: string | null;
  workTypeName: string | null;
  workTypeCode: string | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function vendorUnitPricesQueryKey(vendorId: string) {
  return ["/api/unit-prices", "picker", vendorId];
}

export function useVendorUnitPrices(vendorId: string, enabled = true) {
  return useQuery({
    queryKey: vendorUnitPricesQueryKey(vendorId),
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/unit-prices?vendorId=${vendorId}`);
      if (!res.ok) throw new Error("Failed to fetch unit prices");
      const json = await res.json();
      return (json.items ?? []) as UnitPriceItem[];
    },
    enabled: enabled && !!vendorId && vendorId !== "none",
    staleTime: 30_000,
  });
}
