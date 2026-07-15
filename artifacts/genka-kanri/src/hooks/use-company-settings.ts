import { useQuery } from "@tanstack/react-query";

/**
 * 会社設定（company-settings）を取得する共通フック。
 *
 * 重要: 以前は同じ /api/company-settings を
 *   ["/api/company-settings"] / ["company-settings"] / ["company-settings-print"]
 * の3種類のキーで別々にキャッシュしていたため、設定画面で保存しても
 * ヘッダーの社名や見積・請求書・発注書の印刷ページに旧情報が残ることがあった。
 * ここで queryKey を1つに統一し、保存時の invalidate が全画面に届くようにする。
 *
 * 各ページ固有の型は型引数で指定する:
 *   const { data: company } = useCompanySettings<CompanySettings>();
 */

export interface CompanySettingsRow {
  id?: number;
  companyName?: string;
  [key: string]: any;
}

export const COMPANY_SETTINGS_QUERY_KEY = ["/api/company-settings"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function fetchCompanySettings<T = CompanySettingsRow>(): Promise<T> {
  const res = await fetch(`${BASE}/api/company-settings`);
  if (!res.ok) throw new Error("Failed to fetch company settings");
  return res.json() as Promise<T>;
}

export function useCompanySettings<T = CompanySettingsRow>() {
  return useQuery({
    queryKey: COMPANY_SETTINGS_QUERY_KEY,
    queryFn: () => fetchCompanySettings<T>(),
    staleTime: 60_000,
  });
}
