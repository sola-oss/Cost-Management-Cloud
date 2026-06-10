import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

interface Project {
  id: number;
  name: string;
  location: string;
  startDate: string;
  endDate: string;
}

function fmtMoney(n: number) {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function fmtDate(d: string | null) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${y}/${m}/${day}`;
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

  const { data: company, isLoading: loadingCompany } = useQuery<CompanySettings>({
    queryKey: ["company-settings-print"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/company-settings`);
      if (!r.ok) return null;
      return r.json();
    },
  });

  const projectId = invoice?.projectId ?? null;
  const { data: project, isLoading: loadingProject } = useQuery<Project>({
    queryKey: ["project-print", projectId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/projects/${projectId}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!projectId,
  });

  useEffect(() => {
    // 印刷は手動ボタンから実行する。見積・発注の印刷と挙動を統一し、自動でダイアログは開かない
    if (!loadingInvoice && !loadingCompany && !loadingProject && invoice) {
      document.title = `請求書_${invoice.invoiceNumber}`;
    }
  }, [loadingInvoice, loadingCompany, invoice]);

  if (loadingInvoice || loadingCompany || (projectId && loadingProject)) {
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

  const bankLine = company?.bankName
    ? [
        company.bankName,
        company.bankBranch,
        company.bankAccountType,
        company.bankAccountNumber,
        company.bankAccountName,
      ]
        .filter(Boolean)
        .join("　")
    : "";

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
        <div className="print-page w-[210mm] min-h-[297mm] p-[15mm] box-border">

          {/* ヘッダー：請求番号（左）・日付（右） */}
          <div className="flex justify-between text-[10px] text-slate-500 mb-4">
            <span>請求番号: {invoice.invoiceNumber}</span>
            <div className="text-right space-y-0.5">
              <div>請求日: {fmtDate(invoice.invoiceDate)}</div>
              {invoice.dueDate && <div>入金期限: {fmtDate(invoice.dueDate)}</div>}
            </div>
          </div>

          {/* タイトル */}
          <div className="text-center mb-5">
            <h1 className="text-3xl font-bold tracking-widest text-slate-900">請　求　書</h1>
          </div>

          {/* 2カラム：得意先（左）・自社情報（右） */}
          <div className="flex gap-6 mb-5">
            {/* 左：得意先 */}
            <div className="flex-1">
              <div className="flex items-end mb-2">
                <span className="text-xl font-bold flex-1 border-b-2 border-black pb-1">
                  {invoice.clientName || "\u3000\u3000\u3000\u3000\u3000\u3000\u3000"}
                </span>
                <span className="text-base font-bold ml-2 pb-1">御中</span>
              </div>
              {invoice.clientAddress && (
                <div className="text-[10px] text-slate-600 mt-1">{invoice.clientAddress}</div>
              )}
              <div className="text-xs mt-3">下記の通り、ご請求申し上げます。</div>

              {/* 請求金額ボックス */}
              <div className="mt-5 flex items-center">
                <span className="text-sm font-medium w-28 shrink-0">ご請求金額</span>
                <span className="text-xl font-extrabold text-slate-900 border border-black px-5 py-1 leading-tight">
                  {fmtMoney(invoice.totalAmount)}
                </span>
              </div>
              <div className="flex gap-10 text-xs text-slate-600 mt-1 pl-28">
                <span>税抜合計　{fmtMoney(invoice.taxExcludedTotal)}-</span>
                <span>消費税　{fmtMoney(invoice.taxTotal)}-</span>
              </div>

              {/* 工事情報 */}
              {[
                { label: "工事名", value: invoice.projectName },
                { label: "工事場所", value: project?.location },
                { label: "工事期間", value: project?.startDate && project?.endDate
                  ? `${fmtDate(project.startDate)}〜${fmtDate(project.endDate)}`
                  : project?.startDate ? fmtDate(project.startDate) : undefined },
              ].filter(({ value }) => !!value).map(({ label, value }) => (
                <div key={label} className="mt-2 flex border-b border-slate-400 py-2 min-h-[28px] text-xs">
                  <span className="font-medium w-20 shrink-0">{label}</span>
                  <span className="flex-1 pl-2">{value}</span>
                </div>
              ))}
            </div>

            {/* 右：自社情報（見積書と同じスタイル） */}
            <div className="w-52 shrink-0 text-[10px] self-start leading-relaxed">
              <img src={`${BASE}/otsuka-logo.png`} alt="会社ロゴ" className="w-40 mb-2" />
              {company?.companyName && (
                <div className="font-bold mb-0.5">{company.companyName}</div>
              )}
              {company?.representativeName && (
                <div>代表取締役　{company.representativeName}</div>
              )}
              {(company?.postalCode || company?.address) && (
                <div>
                  {company.postalCode ? `〒${company.postalCode} ` : ""}
                  {company.address}
                </div>
              )}
              {company?.tel && <div>TEL：{company.tel}</div>}
              {company?.fax && <div>FAX：{company.fax}</div>}
              {company?.constructionLicense && (
                <div className="mt-1">建設業許可 {company.constructionLicense}</div>
              )}
              {company?.staffName && (
                <div className="mt-1">担当者：{company.staffName}</div>
              )}
              {company?.staffMobile && <div>携帯番号：{company.staffMobile}</div>}
              {company?.staffEmail && <div>MAIL：{company.staffEmail}</div>}
              {registrationNumber && (
                <div className="mt-1">登録番号：{registrationNumber}</div>
              )}
            </div>
          </div>

          {/* 出来高請求: 出来高状況サマリー */}
          {isProgress && (
            <div className="mb-4 border border-slate-300 rounded">
              <div className="bg-slate-100 px-3 py-1.5 text-xs font-semibold border-b border-slate-300">
                出来高状況
              </div>
              <div className="grid grid-cols-4 divide-x divide-slate-300">
                {[
                  { label: "今回出来高", value: fmtMoney(invoice.totalAmount) },
                  { label: "前回迄累計", value: fmtMoney(billedToDate) },
                  { label: "今回請求額", value: fmtMoney(invoice.totalAmount) },
                  { label: "今後請求残高", value: fmtMoney(Math.max(0, progressRemainder)) },
                ].map(({ label, value }) => (
                  <div key={label} className="px-3 py-2 text-center">
                    <div className="text-[9px] text-slate-500 mb-0.5">{label}</div>
                    <div className="font-bold text-xs">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 明細テーブル */}
          {!isProgress ? (
            <table className="w-full border-collapse text-[10px] mb-4">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-400 px-2 py-2 text-center w-8">No.</th>
                  <th className="border border-slate-400 px-3 py-2 text-left">品名・内容</th>
                  <th className="border border-slate-400 px-2 py-2 text-right w-14">数量</th>
                  <th className="border border-slate-400 px-2 py-2 text-center w-10">単位</th>
                  <th className="border border-slate-400 px-2 py-2 text-right w-24">単価</th>
                  <th className="border border-slate-400 px-2 py-2 text-center w-12">税率</th>
                  <th className="border border-slate-400 px-2 py-2 text-right w-24">金額</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? "bg-slate-50" : ""}>
                    <td className="border border-slate-300 px-1 py-1.5 text-center text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5">{it.itemName}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right">
                      {it.quantity.toLocaleString()}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center">{it.unit}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right">
                      {fmtMoney(it.unitPrice)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center">
                      {it.taxRate}%
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right font-medium">
                      {fmtMoney(it.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="mb-4 border border-slate-300 rounded text-[10px]">
              <div className="bg-slate-100 px-3 py-1.5 text-xs font-semibold border-b border-slate-300">
                請求内容
              </div>
              <div className="px-4 py-3 text-slate-700">
                出来高請求（今回請求額: {fmtMoney(invoice.totalAmount)}）
              </div>
            </div>
          )}

          {/* 税区分別内訳（右寄せ） */}
          <div className="flex justify-end mb-6">
            <div className="w-64">
              {invoice.taxExcludedAmount10 > 0 && (
                <>
                  <div className="flex justify-between py-1 text-[10px] text-slate-600">
                    <span>10%対象額</span>
                    <span>{fmtMoney(invoice.taxExcludedAmount10)}</span>
                  </div>
                  <div className="flex justify-between py-1 text-[10px] text-slate-600">
                    <span>消費税（10%）</span>
                    <span>{fmtMoney(invoice.taxAmount10)}</span>
                  </div>
                </>
              )}
              {invoice.taxExcludedAmount8 > 0 && (
                <>
                  <div className="flex justify-between py-1 text-[10px] text-slate-600">
                    <span>8%対象額（軽減税率）</span>
                    <span>{fmtMoney(invoice.taxExcludedAmount8)}</span>
                  </div>
                  <div className="flex justify-between py-1 text-[10px] text-slate-600">
                    <span>消費税（8%）</span>
                    <span>{fmtMoney(invoice.taxAmount8)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between py-1 text-[10px] text-slate-600 border-t border-slate-200 mt-1">
                <span>税抜合計</span>
                <span>{fmtMoney(invoice.taxExcludedTotal)}</span>
              </div>
              <div className="flex justify-between py-1 text-[10px] text-slate-600">
                <span>消費税合計</span>
                <span>{fmtMoney(invoice.taxTotal)}</span>
              </div>
              <div className="flex justify-between py-2 text-sm font-bold text-slate-800 border-t-2 border-slate-800 mt-1">
                <span>税込合計</span>
                <span>{fmtMoney(invoice.totalAmount)}</span>
              </div>
            </div>
          </div>

          {/* 備考 */}
          {invoice.notes && (
            <div className="mb-4 border-t border-slate-200 pt-3">
              <div className="text-[10px] text-slate-500 font-medium mb-1">備考</div>
              <div className="text-[10px] text-slate-700 whitespace-pre-wrap">{invoice.notes}</div>
            </div>
          )}

          {/* 振込先 */}
          {bankLine && (
            <div className="border-t border-slate-200 pt-3">
              <div className="text-[10px] text-slate-500 font-medium mb-1">お振込先</div>
              <div className="text-[10px] text-slate-700">{bankLine}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
