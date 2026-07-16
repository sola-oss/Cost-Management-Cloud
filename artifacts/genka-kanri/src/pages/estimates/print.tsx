import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { Printer } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchEstimate(id: number) {
  const r = await fetch(`${BASE}/api/estimates/${id}`);
  if (!r.ok) throw new Error("not found");
  return r.json();
}
function fmtMoney(n: number) {
  return `¥${n.toLocaleString()}`;
}
function fmtDate(d: string) {
  if (!d) return "";
  // YYYY-MM-DD 形式なら YYYY/MM/DD に整形。それ以外（「見積日より1ヶ月」等の文章）はそのまま表示
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(d.trim());
  if (!m) return d;
  return `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
}

interface Item {
  rowIndex: number;
  level: number;
  workType: string;
  itemName: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  amount: number;
  rowType: string;
  notes: string;
}
interface Group {
  name: string;
  rows: Item[];
  subtotal: number;
}

export default function EstimatePrint({ id }: { id: number }) {
  const { data: est, isLoading: loadingEst } = useQuery({
    queryKey: ["estimate", id],
    queryFn: () => fetchEstimate(id),
  });
  const { data: cs, isLoading: loadingCs } = useCompanySettings();

  useEffect(() => {
    if (!loadingEst && !loadingCs && est) {
      document.title = `見積書_${est.estNumber ?? id}`;
    }
  }, [loadingEst, loadingCs, est, id]);

  if (loadingEst || loadingCs) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-500">
        読み込み中…
      </div>
    );
  }
  if (!est) {
    return (
      <div className="flex items-center justify-center h-screen text-red-500">
        見積書が見つかりません
      </div>
    );
  }

  const items: Item[] = est.items ?? [];

  // 工種グループ化（pagebreak/total/tax 除外）
  const groups: Group[] = [];
  const groupMap = new Map<string, Group>();
  for (const item of items) {
    if (item.rowType === "pagebreak" || item.rowType === "total" || item.rowType === "tax") continue;
    const wt = (item.workType ?? "").replace(/\s+/g, " ").trim() || "（未分類）";
    if (!groupMap.has(wt)) {
      const g: Group = { name: wt, rows: [], subtotal: 0 };
      groupMap.set(wt, g);
      groups.push(g);
    }
    const g = groupMap.get(wt)!;
    const qty = item.quantity;
    const up = item.unitPrice;
    const amt = qty != null && up != null ? Math.round(qty * up) : (item.amount ?? 0);
    g.rows.push(item);
    g.subtotal += item.rowType === "discount" ? -Math.abs(amt) : amt;
  }

  const miscRate = Number(est.miscExpensesRate ?? 0);
  const discountAmt = Number(est.discountAmount ?? 0);
  const itemsSubtotal = groups.reduce((s, g) => s + g.subtotal, 0);
  const miscExpensesAmt = miscRate > 0 ? Math.round(itemsSubtotal * (miscRate / 100)) : 0;
  const finalSubtotal = itemsSubtotal + miscExpensesAmt - discountAmt;
  const taxRate = Number(est.taxRate ?? 10);
  const taxAmt = Math.round(finalSubtotal * (taxRate / 100));
  const taxIncluded = finalSubtotal + taxAmt;

  const estNumber = est.estimateNumber ?? `EST-${id}`;
  const issueDate = fmtDate(est.estimateDate ?? "");

  // 会社情報（見積書に保存されているものを優先、なければ会社設定から補完）
  const representativeName = est.representativeName || cs?.representativeName || "";
  const companyAddress = est.companyAddress || [
    cs?.postalCode ? `〒${cs.postalCode}` : "",
    cs?.address ?? "",
  ].filter(Boolean).join(" ");
  const companyTel = est.companyTel || cs?.tel || "";
  const companyFax = est.companyFax || cs?.fax || "";
  const constructionLicense = est.constructionLicense || cs?.constructionLicense || "";
  const companyStaff = est.companyStaff || cs?.staffName || "";
  const staffMobile = est.staffMobile || cs?.staffMobile || "";
  const staffEmail = est.staffEmail || cs?.staffEmail || "";

  const pageHeader = (
    <div className="flex justify-between text-[9px] text-slate-500 mb-3 pb-1 border-b border-slate-300">
      <span>見積番号: {estNumber}</span>
      <span>発行日: {issueDate}</span>
    </div>
  );

  return (
    <>
      {/* 表紙だけA4横・明細はA4縦。名前付き@pageで用紙の向きをページ単位で変える */}
      <style>{`
        @media print {
          @page cover-a4-landscape { size: A4 landscape; margin: 0; }
          .cover-page {
            page: cover-a4-landscape;
            page-break-after: always;
            break-after: page;
          }
        }
      `}</style>

      {/* 画面表示時のみ印刷ボタン */}
      <div className="print:hidden fixed top-4 right-4 z-50 flex gap-2">
        <button
          onClick={async () => {
            // 印刷履歴を記録（失敗しても印刷は妨げない）
            try {
              await fetch(`${BASE}/api/estimates/${id}/print-logs`, { method: "POST" });
            } catch {
              /* noop */
            }
            window.print();
          }}
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
        {/* ===== PAGE 1: 御見積書（表紙・おおつか様の様式／A4横） ===== */}
        {/* 支給テンプレート「【おおつか】見積書_横 R7.07.21～.xlsx」の寸法・文字サイズをそのまま写している。
            横位置の % は元Excelの列位置（A〜AOの41列を100%とした割合）。 */}
        <div className="cover-page w-[297mm] h-[210mm] px-[10mm] py-[8mm] box-border flex flex-col">
          {/* 見積NO（左）・発行日（右） */}
          <div className="flex justify-between text-[9pt]">
            <span>見積NO　{estNumber}</span>
            <span>発行日 {issueDate}</span>
          </div>

          {/* タイトル */}
          <h1 className="text-center text-[22pt] font-bold tracking-[0.4em] mt-[4mm] mb-[6mm]">御見積書</h1>

          {/* 顧客名＋敬称（法人は御中／個人は様） */}
          <div className="flex items-end w-[54%]">
            <span className="flex-1 border-b border-black text-[18pt] pb-0.5 min-h-[26pt]">
              {est.clientName}
            </span>
            <span className="border-b border-black text-[14pt] pb-1 pl-3 pr-1 shrink-0">
              {est.clientHonorific ?? "御中"}
            </span>
          </div>
          <div className="text-[11pt] mt-[2mm]">下記の通り、御見積申し上げます。</div>

          {/* 御見積金額 */}
          <div className="mt-[13mm] flex items-end text-[16pt]">
            <span className="w-[26.8%] shrink-0" />
            <span className="w-[14.7%] shrink-0 text-center">御見積金額</span>
            <span className="w-[31.7%] shrink-0 text-center border-b border-black pb-0.5">
              {fmtMoney(taxIncluded)}
            </span>
          </div>
          <div className="mt-[3mm] flex text-[12pt]">
            <span className="w-[43.9%] shrink-0" />
            <span className="w-[22%] shrink-0">税抜合計</span>
            <span className="w-[19%] shrink-0 text-right">{fmtMoney(finalSubtotal)}-</span>
          </div>
          <div className="flex text-[12pt]">
            <span className="w-[43.9%] shrink-0" />
            <span className="w-[22%] shrink-0">消費税({taxRate}%)</span>
            <span className="w-[19%] shrink-0 text-right">{fmtMoney(taxAmt)}-</span>
          </div>

          {/* 下段：工事情報（左）・自社情報（右） */}
          <div className="flex mt-[17mm] flex-1">
            {/* 左：工事情報 */}
            <div className="w-[46.3%] shrink-0 text-[14pt]">
              {[
                { label: "工事名",   value: est.subject ?? "" },
                { label: "工事場所", value: est.location ?? "" },
                { label: "工事期間", value: est.constructionPeriod ?? "" },
                { label: "有効期限", value: est.validityPeriod ? fmtDate(est.validityPeriod) : "" },
              ].map(({ label, value }) => (
                <div key={label} className="flex border-b border-black py-1 min-h-[12.7mm] items-center">
                  <span className="w-[22%] shrink-0">{label}</span>
                  <span className="flex-1 pl-2 whitespace-pre-wrap">{value}</span>
                </div>
              ))}
              {/* 備考は複数行入るので高さを取る（元様式も F26:S30 と広い） */}
              <div className="flex border-b border-black py-1 min-h-[31mm]">
                <span className="w-[22%] shrink-0">備考</span>
                <span className="flex-1 pl-2 whitespace-pre-wrap">{est.notes ?? ""}</span>
              </div>
            </div>

            {/* 中央の余白（元様式の T〜Z 列） */}
            <div className="w-[17.1%] shrink-0" />

            {/* 右：ロゴ＋社印＋自社情報。会社名はロゴに入っているので文字では出さない */}
            <div className="flex-1 text-[11pt] leading-snug">
              <div className="relative mb-2 mt-[6mm]">
                <img src={`${BASE}/otsuka-logo.png`} alt="株式会社おおつか" className="w-[78%]" />
                <img
                  src={`${BASE}/otsuka-seal.png`}
                  alt="社印"
                  className="absolute right-[8%] -top-[18%] w-[22%]"
                />
              </div>
              {representativeName && <div>代表取締役　{representativeName}</div>}
              {companyAddress && <div>{companyAddress}</div>}
              {companyTel && <div>TEL：{companyTel}</div>}
              {companyFax && <div>FAX：{companyFax}</div>}
              {constructionLicense && <div>建設業許可　{constructionLicense}</div>}
              {companyStaff && <div>担当者：{companyStaff}</div>}
              {staffMobile && <div>携帯番号：{staffMobile}</div>}
              {staffEmail && <div>MAIL：{staffEmail}</div>}
            </div>
          </div>
        </div>

        {/* ===== PAGE 2: 見積内訳書 ===== */}
        <div className="print-page w-[210mm] p-[15mm] box-border">
          {pageHeader}
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold tracking-wider">見　積　内　訳　書</h2>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-400 px-2 py-2 text-center w-10">No.</th>
                <th className="border border-slate-400 px-3 py-2 text-left">分類</th>
                <th className="border border-slate-400 px-3 py-2 text-right w-40">見積額</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={i}>
                  <td className="border border-slate-400 px-2 py-1.5 text-center">{i + 1}</td>
                  <td className="border border-slate-400 px-3 py-1.5">{g.name}</td>
                  <td className="border border-slate-400 px-3 py-1.5 text-right">{g.subtotal.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="bg-slate-50">
                <td colSpan={2} className="border border-slate-400 px-3 py-1.5 text-right font-medium">小計</td>
                <td className="border border-slate-400 px-3 py-1.5 text-right font-medium">{itemsSubtotal.toLocaleString()}</td>
              </tr>
              {miscExpensesAmt > 0 && (
                <tr>
                  <td colSpan={2} className="border border-slate-400 px-3 py-1.5 text-right">
                    諸経費{miscRate > 0 ? `（${miscRate}%）` : ""}
                  </td>
                  <td className="border border-slate-400 px-3 py-1.5 text-right">{miscExpensesAmt.toLocaleString()}</td>
                </tr>
              )}
              {discountAmt > 0 && (
                <tr>
                  <td colSpan={2} className="border border-slate-400 px-3 py-1.5 text-right">お値引き</td>
                  <td className="border border-slate-400 px-3 py-1.5 text-right">-{discountAmt.toLocaleString()}</td>
                </tr>
              )}
              <tr className="bg-slate-100 font-bold">
                <td colSpan={2} className="border border-slate-400 px-3 py-2 text-right">税抜合計</td>
                <td className="border border-slate-400 px-3 py-2 text-right">{finalSubtotal.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ===== PAGE 3+: 見積明細書（工種ごと） ===== */}
        {groups.map((group, gi) => (
          <div
            key={gi}
            className={`print-page w-[210mm] p-[15mm] box-border${gi === groups.length - 1 ? " last-print-page" : ""}`}
          >
            {pageHeader}
            <div className="text-center mb-3">
              <h2 className="text-xl font-bold tracking-wider">見　積　明　細　書</h2>
              <div className="text-xs text-slate-600 mt-0.5">（{gi + 1}. {group.name}）</div>
            </div>
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-400 px-1 py-1.5 text-center w-8">No.</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left">摘要</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left w-28">備考</th>
                  <th className="border border-slate-400 px-1 py-1.5 text-center w-20">数量・単位</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right w-20">見積単価</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right w-24">見積額</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((item, idx) => {
                  const qty = item.quantity;
                  const up = item.unitPrice;
                  const amt = qty != null && up != null ? Math.round(qty * up) : (item.amount ?? 0);
                  const isDiscount = item.rowType === "discount";
                  return (
                    <tr key={idx} className={idx % 2 === 1 ? "bg-slate-50" : ""}>
                      <td className="border border-slate-300 px-1 py-1 text-center text-slate-500">{idx + 1}</td>
                      <td className="border border-slate-300 px-2 py-1">{item.itemName}</td>
                      <td className="border border-slate-300 px-2 py-1 text-slate-600">{item.notes}</td>
                      <td className="border border-slate-300 px-1 py-1 text-center">
                        {qty != null ? `${qty.toLocaleString()}${item.unit}` : item.unit}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-right">
                        {up != null ? up.toLocaleString() : ""}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-right">
                        {isDiscount ? `-${Math.abs(amt).toLocaleString()}` : amt > 0 ? amt.toLocaleString() : ""}
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-bold">
                  <td colSpan={5} className="border border-slate-400 px-2 py-1.5 text-right">
                    {group.name}　小計
                  </td>
                  <td className="border border-slate-400 px-2 py-1.5 text-right">
                    {group.subtotal.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
