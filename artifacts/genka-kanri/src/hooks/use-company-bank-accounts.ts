import { useQuery } from "@tanstack/react-query";

/**
 * 振込先口座（見積書・請求書に印刷する、入金してもらう口座）を取得する共通フック。
 *
 * 会社設定の「振込元情報（全銀フォーマット用）」とは別物。あちらは総合振込CSVの
 * 引落口座（こちらが支払うときの出金元）で、こちらは得意先に振り込んでもらう先。
 * おおつか様は振込先が2口座あるため、1件しか持てない会社設定とは分けている。
 *
 * queryKey は1つに統一する（[[cmc-shared-querykey-shape]] と同じ理由。設定画面で
 * 保存したときの invalidate が印刷ページまで届くようにするため）。
 */

export interface CompanyBankAccount {
  id: number;
  displayOrder: number;
  bankName: string;
  bankBranch: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
}

export const COMPANY_BANK_ACCOUNTS_QUERY_KEY = ["/api/company-bank-accounts"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useCompanyBankAccounts() {
  return useQuery({
    queryKey: COMPANY_BANK_ACCOUNTS_QUERY_KEY,
    queryFn: async (): Promise<CompanyBankAccount[]> => {
      const res = await fetch(`${BASE}/api/company-bank-accounts`);
      if (!res.ok) throw new Error("Failed to fetch company bank accounts");
      const json = (await res.json()) as { items: CompanyBankAccount[] };
      return json.items ?? [];
    },
    staleTime: 60_000,
  });
}

/** 「山口銀行　光支店　当座　0080106　株式会社おおつか」の形に整える */
export function formatBankAccount(a: CompanyBankAccount): string {
  return [a.bankName, a.bankBranch, a.accountType, a.accountNumber, a.accountHolder]
    .filter(Boolean)
    .join("　");
}
