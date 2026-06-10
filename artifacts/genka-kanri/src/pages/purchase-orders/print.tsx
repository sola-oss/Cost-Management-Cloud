import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PurchaseOrderItem {
  id: number;
  lineNumber: number;
  category: string;
  description: string;
  specification: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  taxRate: number;
  deliveredQuantity: number;
}

interface PurchaseOrder {
  id: number;
  orderNumber: string;
  projectId: number;
  vendorId: number;
  orderDate: string;
  expectedDeliveryDate: string | null;
  status: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  vendorName: string;
  projectCode: string;
  projectName: string;
  items: PurchaseOrderItem[];
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

const CATEGORY_MAP: Record<string, string> = {
  material: "材料費",
  labor: "労務費",
  subcontract: "外注費",
  expense: "経費",
};

function fmtMoney(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${y}年${parseInt(m)}月${parseInt(day)}日`;
}

export default function PurchaseOrderPrint({ id }: { id: number }) {
  const { data: order, isLoading: loadingOrder } = useQuery<PurchaseOrder>({
    queryKey: ["purchase-order-print", id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/purchase-orders/${id}`);
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

  useEffect(() => {
    // 印刷は手動ボタン（「印刷 / PDF」）から実行する。見積書印刷と挙動を統一し、自動でダイアログは開かない
    if (!loadingOrder && !loadingCompany && order) {
      document.title = `発注書_${order.orderNumber}`;
    }
  }, [loadingOrder, loadingCompany, order]);

  if (loadingOrder || loadingCompany) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-500">
        読み込み中…
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex items-center justify-center h-screen text-red-500">
        発注書が見つかりません
      </div>
    );
  }

  const items = order.items ?? [];
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxAmount10 = items
    .filter((i) => i.taxRate === 10)
    .reduce((s, i) => s + Math.floor(i.amount * 0.1), 0);
  const taxAmount8 = items
    .filter((i) => i.taxRate === 8)
    .reduce((s, i) => s + Math.floor(i.amount * 0.08), 0);
  const totalTax = taxAmount10 + taxAmount8;
  const total = subtotal + totalTax;

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
          className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded shadow"
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

          {/* ヘッダー：発注番号（左）・日付（右） */}
          <div className="flex justify-between text-[10px] text-slate-500 mb-4">
            <span>発注番号: {order.orderNumber}</span>
            <div className="text-right space-y-0.5">
              <div>発注日: {fmtDate(order.orderDate)}</div>
              {order.expectedDeliveryDate && (
                <div>納期: {fmtDate(order.expectedDeliveryDate)}</div>
              )}
            </div>
          </div>

          {/* タイトル */}
          <div className="text-center mb-5">
            <h1 className="text-3xl font-bold tracking-widest text-slate-900">発　注　書</h1>
          </div>

          {/* 2カラム：仕入先（左）・自社情報（右） */}
          <div className="flex gap-6 mb-5">
            {/* 左：仕入先 */}
            <div className="flex-1">
              <div className="flex items-end mb-2">
                <span className="text-xl font-bold flex-1 border-b-2 border-black pb-1">
                  {order.vendorName || "\u3000\u3000\u3000\u3000\u3000\u3000\u3000"}
                </span>
                <span className="text-base font-bold ml-2 pb-1">御中</span>
              </div>
              <div className="text-xs mt-3">下記の通り、発注申し上げます。</div>

              {/* 発注金額ボックス */}
              <div className="mt-5 flex items-center">
                <span className="text-sm font-medium w-28 shrink-0">発注金額</span>
                <span className="text-xl font-extrabold text-slate-900 border border-black px-5 py-1 leading-tight">
                  {fmtMoney(total)}
                </span>
              </div>
              <div className="flex gap-10 text-xs text-slate-600 mt-1 pl-28">
                <span>税抜合計　{fmtMoney(subtotal)}-</span>
                <span>消費税　{fmtMoney(totalTax)}-</span>
              </div>

              {/* 工事情報 */}
              <div className="mt-4 space-y-0">
                {[
                  { label: "工事名", value: order.projectName },
                  { label: "工事番号", value: order.projectCode },
                  { label: "納期", value: order.expectedDeliveryDate ? fmtDate(order.expectedDeliveryDate) : "" },
                ].filter(({ value }) => !!value).map(({ label, value }) => (
                  <div key={label} className="flex border-b border-slate-400 py-1.5 min-h-[26px] text-xs">
                    <span className="font-medium w-20 shrink-0">{label}</span>
                    <span className="flex-1 pl-2">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 右：自社情報 */}
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
            </div>
          </div>

          {/* 明細テーブル */}
          <table className="w-full border-collapse text-[10px] mb-4">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-400 px-2 py-2 text-center w-8">No.</th>
                <th className="border border-slate-400 px-2 py-2 text-left w-20">科目</th>
                <th className="border border-slate-400 px-3 py-2 text-left">品名・摘要</th>
                <th className="border border-slate-400 px-2 py-2 text-right w-16">数量</th>
                <th className="border border-slate-400 px-2 py-2 text-center w-10">単位</th>
                <th className="border border-slate-400 px-2 py-2 text-right w-24">単価</th>
                <th className="border border-slate-400 px-2 py-2 text-center w-12">税率</th>
                <th className="border border-slate-400 px-2 py-2 text-right w-24">金額</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} className={idx % 2 === 1 ? "bg-slate-50" : ""}>
                  <td className="border border-slate-300 px-1 py-1.5 text-center text-slate-500">
                    {item.lineNumber}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-slate-600">
                    {CATEGORY_MAP[item.category] ?? item.category}
                  </td>
                  <td className="border border-slate-300 px-3 py-1.5">
                    <div>{item.description}</div>
                    {item.specification && (
                      <div className="text-[9px] text-slate-400">{item.specification}</div>
                    )}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right">
                    {item.quantity.toLocaleString()}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center">{item.unit}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right">
                    {fmtMoney(item.unitPrice)}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center">
                    {item.taxRate}%
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right font-medium">
                    {fmtMoney(item.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 税区分別内訳（右寄せ） */}
          <div className="flex justify-end mb-6">
            <div className="w-64">
              {taxAmount10 > 0 && (
                <>
                  <div className="flex justify-between py-1 text-[10px] text-slate-600">
                    <span>10%対象額</span>
                    <span>{fmtMoney(subtotal - items.filter(i => i.taxRate !== 10).reduce((s, i) => s + i.amount, 0))}</span>
                  </div>
                  <div className="flex justify-between py-1 text-[10px] text-slate-600">
                    <span>消費税（10%）</span>
                    <span>{fmtMoney(taxAmount10)}</span>
                  </div>
                </>
              )}
              {taxAmount8 > 0 && (
                <>
                  <div className="flex justify-between py-1 text-[10px] text-slate-600">
                    <span>8%対象額（軽減税率）</span>
                    <span>{fmtMoney(items.filter(i => i.taxRate === 8).reduce((s, i) => s + i.amount, 0))}</span>
                  </div>
                  <div className="flex justify-between py-1 text-[10px] text-slate-600">
                    <span>消費税（8%）</span>
                    <span>{fmtMoney(taxAmount8)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between py-1 text-[10px] text-slate-600 border-t border-slate-200 mt-1">
                <span>税抜合計</span>
                <span>{fmtMoney(subtotal)}</span>
              </div>
              <div className="flex justify-between py-1 text-[10px] text-slate-600">
                <span>消費税合計</span>
                <span>{fmtMoney(totalTax)}</span>
              </div>
              <div className="flex justify-between py-2 text-sm font-bold text-slate-800 border-t-2 border-slate-800 mt-1">
                <span>税込合計</span>
                <span>{fmtMoney(total)}</span>
              </div>
            </div>
          </div>

          {/* 備考 */}
          {order.notes && (
            <div className="mb-4 border-t border-slate-200 pt-3">
              <div className="text-[10px] text-slate-500 font-medium mb-1">備考</div>
              <div className="text-[10px] text-slate-700 whitespace-pre-wrap">{order.notes}</div>
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
