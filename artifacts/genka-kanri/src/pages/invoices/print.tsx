import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { useCompanyBankAccounts } from "@/hooks/use-company-bank-accounts";
import { Printer } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// 様式の塗りつぶし色（支給Excelの実測値）
const TITLE_BG = "#A4C2F4";   // 「御請求書」の帯
const AMOUNT_BG = "#9FC5E8";  // 「御請求金額」の帯
const HEAD_BG = "#EDEDED";    // 明細の見出し行

// 様式は明細4行ぶんの枠があるので、少ないときは空行で埋めて見た目を合わせる
const MIN_ITEM_ROWS = 4;

interface InvoiceItem {
  id?: number;
  rowIndex: number;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxRate: number;
  amount: number;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  clientName: string;
  clientHonorific: string;
  clientAddress: string;
  projectName: string;
  projectId?: number | null;
  invoiceRegistrationNumber: string;
  billingType: "full" | "progress";
  taxExcludedAmount10: number;
  taxAmount10: number;
  taxExcludedAmount8: number;
  taxAmount8: number;
  taxExcludedTotal: number;
  taxTotal: number;
  totalAmount: number;
  notes: string;
  contractAmount?: number;
  billedToDate?: number;
  items: InvoiceItem[];
}

interface CompanySettings {
  companyName: string;
  postalCode: string;
  address: string;
  tel: string;
  fax: string;
  invoiceRegistrationNumber: string;
  representativeName: string;
  constructionLicense: string;
  staffName: string;
  staffMobile: string;
  staffEmail: string;
  bankName: string;
  bankBranch: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

function fmtMoney(n: number) {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

/** 様式が和暦なので「令和8年5月29日」の形にする。令和より前は西暦のまま */
function fmtWareki(d: string | null) {
  if (!d) return "";
  const [ys, ms, ds] = d.split("-");
  const y = parseInt(ys), m = parseInt(ms), day = parseInt(ds);
  const reiwaYear = y - 2018;
  if (reiwaYear < 1 || (y === 2019 && m < 5)) return `${y}年${m}月${day}日`;
  return `令和${reiwaYear === 1 ? "元" : reiwaYear}年${m}月${day}日`;
}

export default function InvoicePrint({ id }: { id: number }) {
  const { data: invoice, isLoading: loadingInvoice } = useQuery<Invoice>({
    queryKey: ["invoice-print", id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/invoices/${id}`);
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
  });

  const { data: company, isLoading: loadingCompany } = useCompanySettings<CompanySettings>();
  const { data: bankAccounts = [], isLoading: loadingBanks } = useCompanyBankAccounts();

  useEffect(() => {
    // 印刷は手動ボタンから実行する。見積・発注の印刷と挙動を統一し、自動でダイアログは開かない
    if (!loadingInvoice && !loadingCompany && invoice) {
      document.title = `請求書_${invoice.invoiceNumber}`;
    }
  }, [loadingInvoice, loadingCompany, invoice]);

  if (loadingInvoice || loadingCompany || loadingBanks) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-500">
        読み込み中…
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex items-center justify-center h-screen text-red-500">
        請求書が見つかりません
      </div>
    );
  }

  const isProgress = invoice.billingType === "progress";
  const items: InvoiceItem[] = invoice.items ?? [];

  const contractAmount = invoice.contractAmount ?? 0;
  const billedToDate = invoice.billedToDate ?? 0;
  const progressRemainder = contractAmount - billedToDate - invoice.totalAmount;

  // 明細は様式の枠数（4行）に満たなければ空行を足す
  const printRows: (InvoiceItem | null)[] = [
    ...items,
    ...Array(Math.max(0, MIN_ITEM_ROWS - items.length)).fill(null),
  ];

  const registrationNumber =
    company?.invoiceRegistrationNumber || invoice.invoiceRegistrationNumber;

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body { margin: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* 画面表示時のみ印刷ボタン */}
      <div className="no-print fixed top-4 right-4 z-50 flex gap-2">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded shadow"
        >
          <Printer className="w-4 h-4" />
          印刷 / PDFで保存
        </button>
        <button
          onClick={() => window.close()}
          className="flex items-center gap-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium px-4 py-2 rounded shadow"
        >
          閉じる
        </button>
      </div>

      {/* 印刷コンテンツ */}
      <div className="text-black font-sans text-[11px]">
        {/* 支給テンプレート「請求書A_縦【おおつか】2025(2).02.13～.xlsx」の寸法をそのまま写している。
            横位置の % は元Excelの列位置（A〜AGの33列を100%とした割合）。 */}
        <div className="print-page w-[210mm] min-h-[297mm] px-[12mm] py-[10mm] box-border">

          {/* 請求日（和暦・右上） */}
          <div className="text-right text-[10pt]">請求日　{fmtWareki(invoice.invoiceDate)}</div>

          {/* タイトル（水色の帯） */}
          <h1
            className="mt-2 py-1 text-center text-[18pt] tracking-[0.4em]"
            style={{ backgroundColor: TITLE_BG }}
          >
            御請求書
          </h1>

          {/* 宛名（左）・ロゴ＋社印＋自社情報（右） */}
          <div className="mt-5 flex">
            <div className="w-[57.6%] shrink-0">
              {/* 得意先名＋敬称 */}
              <div className="flex items-end">
                <span className="flex-1 border-b border-black text-[14pt] pb-1 min-h-[24pt]">
                  {invoice.clientName}
                </span>
                <span className="w-[16%] shrink-0 border-b border-black text-[14pt] pb-1 text-center">
                  {invoice.clientHonorific ?? "御中"}
                </span>
              </div>

              {/* 工事名 */}
              <div className="mt-6 flex items-end">
                <span className="w-[21%] shrink-0 border-b border-black text-[12pt] pb-1">工事名</span>
                <span className="flex-1 border-b border-black text-[12pt] pb-1 pl-2">
                  {invoice.projectName}
                </span>
              </div>

              <div className="mt-5 text-[11pt]">下記の通り、御請求申し上げます。</div>
            </div>

            <div className="w-[3%] shrink-0" />

            {/* 会社名はロゴ画像に入っているので文字では出さない（様式どおり） */}
            <div className="flex-1 text-[10pt] leading-snug">
              <div className="relative mb-1.5">
                <img src={`${BASE}/otsuka-logo.png`} alt="株式会社おおつか" className="w-[80%]" />
                <img
                  src={`${BASE}/otsuka-seal.png`}
                  alt="社印"
                  className="absolute right-0 -top-[26%] w-[26%]"
                />
              </div>
              {company?.postalCode && <div>〒{company.postalCode}</div>}
              {company?.address && <div>{company.address}</div>}
              {company?.tel && <div>TEL {company.tel}</div>}
              {company?.fax && <div>FAX {company.fax}</div>}
              {registrationNumber && <div>登録番号：{registrationNumber}</div>}
              {company?.staffName && <div>担当者：{company.staffName}</div>}
            </div>
          </div>

          {/* 御請求金額（水色の帯） */}
          <div className="mt-6 flex text-[14pt]" style={{ backgroundColor: AMOUNT_BG }}>
            <div className="w-[15.2%] shrink-0 text-center py-1.5">御請求金額</div>
            <div className="w-[42.4%] shrink-0 text-center py-1.5">{fmtMoney(invoice.totalAmount)}-</div>
          </div>

          {/* お振込先口座（会社設定の「振込先口座」に登録した順） */}
          <div className="mt-4 text-[10pt]">
            <div>＜お振込先口座＞</div>
            {bankAccounts.length > 0 ? (
              bankAccounts.map((a) => (
                <div key={a.id} className="flex">
                  <span className="w-[9.1%] shrink-0">{a.bankName}</span>
                  <span className="w-[9.1%] shrink-0">{a.bankBranch}</span>
                  <span className="w-[6.1%] shrink-0">{a.accountType}</span>
                  <span className="w-[9.1%] shrink-0">{a.accountNumber}</span>
                  <span>{a.accountHolder}</span>
                </div>
              ))
            ) : (
              <div className="text-slate-400">（会社設定＞振込先口座 が未登録です）</div>
            )}
          </div>

          {/* 明細（様式は5列。税率の列は無く、消費税を表の行として出す） */}
          <table className="mt-5 w-full border-collapse text-[11pt]">
            <colgroup>
              <col style={{ width: "45.45%" }} />
              <col style={{ width: "9.09%" }} />
              <col style={{ width: "9.09%" }} />
              <col style={{ width: "18.18%" }} />
              <col style={{ width: "18.18%" }} />
            </colgroup>
            <thead>
              <tr className="text-[10pt] font-bold" style={{ backgroundColor: HEAD_BG }}>
                <th className="border border-black py-1">御請求内容</th>
                <th className="border border-black py-1">数　量</th>
                <th className="border border-black py-1">単　位</th>
                <th className="border border-black py-1">単　価</th>
                <th className="border border-black py-1">金　額</th>
              </tr>
            </thead>
            <tbody>
              {printRows.map((it, idx) => (
                <tr key={idx}>
                  <td className="border border-black px-2 py-1 h-[28pt]">{it?.itemName ?? ""}</td>
                  <td className="border border-black px-2 py-1 text-center">
                    {it ? it.quantity.toLocaleString() : ""}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">{it?.unit ?? ""}</td>
                  <td className="border border-black px-2 py-1 text-right">
                    {it ? fmtMoney(it.unitPrice) : ""}
                  </td>
                  <td className="border border-black px-2 py-1 text-right">
                    {it ? fmtMoney(it.amount) : ""}
                  </td>
                </tr>
              ))}

              {/* 10%（様式にある行） */}
              <tr>
                <td className="border border-black px-2 py-1">小計（10％対象）</td>
                <td className="border border-black" />
                <td className="border border-black" />
                <td className="border border-black" />
                <td className="border border-black px-2 py-1 text-right">
                  {fmtMoney(invoice.taxExcludedAmount10)}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2 py-1">消費税</td>
                <td className="border border-black px-2 py-1 text-center">1</td>
                <td className="border border-black px-2 py-1 text-center">式</td>
                <td className="border border-black px-2 py-1 text-right">10.00%</td>
                <td className="border border-black px-2 py-1 text-right">
                  {fmtMoney(invoice.taxAmount10)}
                </td>
              </tr>

              {/* 8%（軽減税率。様式には無いが CMC は対応しているので、ある時だけ出す） */}
              {invoice.taxExcludedAmount8 > 0 && (
                <>
                  <tr>
                    <td className="border border-black px-2 py-1">小計（8％対象）</td>
                    <td className="border border-black" />
                    <td className="border border-black" />
                    <td className="border border-black" />
                    <td className="border border-black px-2 py-1 text-right">
                      {fmtMoney(invoice.taxExcludedAmount8)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">消費税</td>
                    <td className="border border-black px-2 py-1 text-center">1</td>
                    <td className="border border-black px-2 py-1 text-center">式</td>
                    <td className="border border-black px-2 py-1 text-right">8.00%</td>
                    <td className="border border-black px-2 py-1 text-right">
                      {fmtMoney(invoice.taxAmount8)}
                    </td>
                  </tr>
                </>
              )}

              <tr>
                <td className="border border-black px-2 py-1">合　計</td>
                <td className="border border-black" />
                <td className="border border-black" />
                <td className="border border-black" />
                <td className="border border-black px-2 py-1 text-right">
                  {fmtMoney(invoice.totalAmount)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* 出来高状況（様式には無いCMC独自。出来高請求のときだけ） */}
          {isProgress && (
            <div className="mt-4 border border-black text-[10pt]">
              <div className="px-2 py-1 font-bold border-b border-black" style={{ backgroundColor: HEAD_BG }}>
                出来高状況
              </div>
              <div className="grid grid-cols-4 divide-x divide-black">
                {[
                  { label: "請負金額", value: fmtMoney(contractAmount) },
                  { label: "前回迄累計", value: fmtMoney(billedToDate) },
                  { label: "今回請求額", value: fmtMoney(invoice.totalAmount) },
                  { label: "今後請求残高", value: fmtMoney(Math.max(0, progressRemainder)) },
                ].map(({ label, value }) => (
                  <div key={label} className="px-2 py-1.5 text-center">
                    <div className="text-[8pt] mb-0.5">{label}</div>
                    <div className="font-bold">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 備考 */}
          <div className="mt-6 flex text-[11pt]">
            <span className="w-[12.1%] shrink-0">備考</span>
            <span className="flex-1 whitespace-pre-wrap">{invoice.notes}</span>
          </div>
        </div>
      </div>
    </>
  );
}
