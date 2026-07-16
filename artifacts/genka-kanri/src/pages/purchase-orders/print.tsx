import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { Printer } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * 注文書 / 注文請書の印刷
 *
 * おおつか様支給のExcel（☆注文書・控え・請負書）をそのまま写した様式。
 * A4横・2ページ（1枚目=注文書／2枚目=注文請書）。
 * 明細は載せない（様式に「注文内容内訳はお見積書のとおりです。」とあるため）。
 * 支払条件は様式で固定の値（現金100％・請求締切・支払・運送・労災保険）を印字し、
 * 手書き前提の欄（前金払の額・手形％・サイト・遅延利息・かし担保期間）は空欄のままにする。
 */

interface PurchaseOrder {
  id: number;
  orderNumber: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  startDate: string | null;
  orderName: string | null;
  recyclingLawApplicable: boolean;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  vendorName: string;
  vendorAddress: string;
  projectCode: string;
  projectName: string;
  projectLocation: string;
}

interface CompanySettings {
  companyName: string;
  address: string;
  representativeName: string;
}

function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}

function fmtDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${y}年${parseInt(m)}月${parseInt(day)}日`;
}

/** Excelの列幅をそのまま比率にしたもの（A〜O） */
const COL_WIDTHS = [7.59, 3.21, 8.31, 4.71, 7.52, 3.79, 11.19, 11.91, 10.21, 6.28, 4.32, 2.55, 6.28, 6.07, 6.07];

const B = "border border-black";

/** 当事者欄（住所・氏名）。注文請書では受注者側を空欄にして先方に記入・押印してもらう */
function Party({
  role,
  address,
  name,
  subName,
  honorific,
}: {
  role: string;
  address?: string;
  name?: string;
  subName?: string;
  honorific?: boolean;
}) {
  return (
    <div className="flex-1">
      <div className="text-[10px] mb-0.5">{role}</div>
      <div className="flex gap-2 items-end">
        <span className="w-12 shrink-0 text-[10px]">住　所</span>
        <span className="flex-1 border-b border-black text-[10px] pb-0.5 min-h-[16px]">{address}</span>
      </div>
      <div className="flex gap-2 items-end mt-1.5">
        <span className="w-12 shrink-0 text-[10px]">氏　名</span>
        <span className="flex-1 border-b border-black text-xs font-medium pb-0.5 min-h-[18px]">{name}</span>
        {honorific && <span className="text-[10px] shrink-0 pb-0.5">御中</span>}
      </div>
      {subName && <div className="text-[10px] mt-1 pl-14">{subName}</div>}
    </div>
  );
}

function OrderSheet({
  order,
  company,
  mode,
}: {
  order: PurchaseOrder;
  company?: CompanySettings;
  mode: "order" | "acceptance";
}) {
  const otsukaAddress = company?.address ?? "";
  const otsukaName = company?.companyName ?? "";
  const otsukaRep = company?.representativeName ? `代表取締役　${company.representativeName}` : "";

  // 注文書：左=受注者（仕入先）／右=発注者（おおつか）
  // 注文請書：左右が入れ替わり、受注者欄は先方記入のため空欄
  const left =
    mode === "order" ? (
      <Party role="(受注者)" address={order.vendorAddress} name={order.vendorName} honorific />
    ) : (
      <Party role="(発注者)" address={otsukaAddress} name={otsukaName} honorific />
    );
  const right =
    mode === "order" ? (
      <Party role="(発注者)" address={otsukaAddress} name={otsukaName} subName={otsukaRep} />
    ) : (
      <Party role="(受注者)" />
    );

  const checked = order.recyclingLawApplicable;

  return (
    <div className="print-page w-[297mm] h-[210mm] px-[10mm] py-[8mm] box-border flex flex-col text-black">
      {/* 契約日 */}
      <div className="text-right text-[10px] h-4">{fmtDate(order.orderDate)}</div>

      {/* タイトル */}
      <div className="text-center mb-3">
        <h1 className="text-2xl font-bold tracking-[0.5em]">
          {mode === "order" ? "注文書" : "注文請書"}
        </h1>
      </div>

      {/* 当事者 */}
      <div className="flex gap-12 mb-3">
        {left}
        {right}
      </div>

      {/* 前文 */}
      <div className="text-[9px] leading-[1.6] mb-2">
        {mode === "order" ? (
          <>
            <p>下記のとおり注文いたしますから、お引受の際は別紙注文請書をご提出下さい。なお、注文内容内訳はお見積書のとおりです。</p>
            <p>
              　下請負契約の場合、この注文書に記載のない条件については、工事下請(基本)契約約款の定めによります。ただし、立替払などがあるときは、工事支払金と相殺することがあります。なお、金額欄の工事価格には解体工事に要する費用及び再資源化等に要する費用がある場合にはその費用を含みます。
            </p>
            <p>　施工条件のとおりです。</p>
          </>
        ) : (
          <>
            <p>貴注文を下記条項承諾のうえ、お請けいたします。ただし、金額欄の工事価格には解体工事に要する費用及び再資源化等に要する費用がある場合にはその費用を含みます。</p>
            <p>　なお、この契約の履行に当っては、工事下請(基本)契約約款、契約条件を遵守します。</p>
          </>
        )}
      </div>

      {/* 本表 */}
      <table className="w-full border-collapse table-fixed text-[9px] leading-tight">
        <colgroup>
          {COL_WIDTHS.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <tbody>
          {/* ── 見出し行 ── */}
          <tr className="h-[25px]">
            <td colSpan={6} className={`${B} text-center font-bold tracking-[0.4em]`}>注文内容</td>
            <td colSpan={2} className={`${B} text-center font-bold tracking-[0.4em]`}>金額</td>
            <td colSpan={7} className={`${B} text-center font-bold tracking-[0.4em]`}>支払条件</td>
          </tr>

          {/* ── 件名 ── */}
          <tr className="h-[25px]">
            <td className={`${B} text-center`}>件　　名</td>
            <td colSpan={5} className={`${B} px-1`}>{order.projectName}</td>
            {/* 金額欄は16〜21行が罫線なしの1ブロック（Excel同様） */}
            <td colSpan={2} rowSpan={6} className={`${B} p-0 align-top`}>
              <div className="flex flex-col h-full">
                <div className="text-center py-0.5">請　負　代　金　額</div>
                <div className="text-right px-2 py-0.5 text-[11px] font-bold">{fmtMoney(order.totalAmount)} 円</div>
                <div className="py-0.5 pl-2">　うち工　事　価　格</div>
                <div className="text-right px-2 py-0.5">{fmtMoney(order.subtotal)} 円</div>
                <div className="py-0.5 pl-2">　取引に係る消費税及び<br />地方消費税の額</div>
                <div className="text-right px-2 py-0.5">{fmtMoney(order.taxAmount)} 円</div>
              </div>
            </td>
            <td rowSpan={2} className={`${B} text-center`}>前金払</td>
            <td colSpan={2} rowSpan={2} className={B} />
            <td className={`${B} text-center border-b-0`}>円</td>
            <td rowSpan={2} className={`${B} text-center`}>部分払</td>
            <td colSpan={2} className="border-t border-l border-r border-black whitespace-nowrap">出来高・納入額の</td>
          </tr>

          {/* ── 場所 ── */}
          <tr className="h-[25px]">
            <td rowSpan={2} className={`${B} text-center`}>場　　所</td>
            <td colSpan={5} rowSpan={2} className={`${B} px-1`}>{order.projectLocation}</td>
            <td className="border-l border-r border-b border-black" />
            <td className="border-l border-black" />
            <td className="border-r border-b border-black text-right pr-2">100 ％</td>
          </tr>

          {/* ── 部分払（現金100％） ── */}
          <tr className="h-[25px]">
            <td className={`${B} text-center`}>部分払</td>
            <td colSpan={6} rowSpan={2} className={`${B} px-1`}>
              現金　100　％、手形　　　　％(サイト　　　日)
            </td>
          </tr>

          {/* ── 施工内容・施工条件 ── */}
          <tr className="h-[25px]">
            <td rowSpan={3} className={`${B} text-center leading-tight`}>施工内容<br />施工条件</td>
            <td colSpan={5} className="border-l border-r border-t border-black px-1">発注ID{order.orderNumber}</td>
            <td className={`${B} text-center`}>完成払</td>
          </tr>

          {/* ── 発注名 ── */}
          <tr className="h-[25px]">
            <td colSpan={5} className="border-l border-r border-black px-1 font-medium">{order.orderName ?? ""}</td>
            <td className="border-l border-black text-center">履行遅滞の</td>
            <td rowSpan={2} className={`${B} text-center`}>年</td>
            <td colSpan={2} className="border-t border-r border-black" />
            <td className="border-l border-black text-center">過払の</td>
            <td rowSpan={2} className={`${B} text-center`}>年</td>
            <td rowSpan={2} className="border-t border-b border-r border-black" />
          </tr>

          {/* ── （施工内容の空き行） ── */}
          <tr className="h-[25px]">
            <td colSpan={5} className="border-l border-r border-b border-black" />
            <td className="border-l border-b border-black text-center">遅延利息(注)</td>
            <td colSpan={2} className="border-r border-b border-black" />
            <td className="border-l border-b border-black text-center">返還利息</td>
          </tr>

          {/* ── 建設リサイクル法 ── */}
          <tr className="h-[25px]">
            <td colSpan={6} rowSpan={2} className={`${B} text-center`}>建設リサイクル法の対象建設工事に該当有無</td>
            <td className="border-t border-black text-center">{checked ? "■" : "□"}該当する</td>
            <td className="border-t border-black text-center">{checked ? "□" : "■"}該当しない</td>
            <td colSpan={2} className={`${B} text-center`}>運　　　　送</td>
            <td colSpan={3} className={`${B} text-center`}>労　災　保　険</td>
            <td colSpan={2} className={`${B} text-center`}>か し 担 保</td>
          </tr>
          <tr className="h-[25px]">
            <td colSpan={2} className="border-b border-black text-center text-[8px]">該当する場合は別紙(Ⅰ～Ⅲ)に記入する</td>
            <td className={`${B} text-center`}>受注者</td>
            <td className={`${B} text-center`}>注文者</td>
            <td colSpan={2} className={`${B} text-center`}>受注者</td>
            <td className={`${B} text-center`}>注文者</td>
            <td colSpan={2} className={`${B} text-center`}>期　　　　間</td>
          </tr>

          {/* ── 工期・納期 見出し ── */}
          <tr className="h-[25px]">
            <td colSpan={6} className={`${B} text-center`}>工　　　　期　　 ・　　納　　　　期</td>
            <td className={`${B} text-center`}>請求締切</td>
            <td className={`${B} text-center`}>支　　払</td>
            <td className={`${B} text-center`}>負　 担</td>
            <td className={`${B} text-center`}>負 　担</td>
            <td colSpan={2} className={`${B} text-center`}>加　 入</td>
            <td className={`${B} text-center`}>加　 入</td>
            <td className="border-l border-black text-center">令和　　  年</td>
            <td className="border-r border-black" />
          </tr>

          {/* ── 工期の日付 ── */}
          <tr className="h-[25px]">
            <td rowSpan={2} className={B} />
            <td colSpan={2} rowSpan={2} className={`${B} text-center`}>{fmtDate(order.startDate)}</td>
            <td rowSpan={2} className={`${B} text-center`}>～</td>
            <td colSpan={2} rowSpan={2} className={`${B} text-center`}>{fmtDate(order.expectedDeliveryDate)}</td>
            <td rowSpan={2} className={`${B} text-center`}>毎月　　末日</td>
            <td rowSpan={2} className={`${B} text-center`}>翌月　　末日</td>
            <td rowSpan={2} className={`${B} text-center`}>〇</td>
            <td rowSpan={2} className={B} />
            <td colSpan={2} rowSpan={2} className={B} />
            <td rowSpan={2} className={`${B} text-center`}>〇</td>
            <td className="border-l border-black" />
            <td className="border-r border-black" />
          </tr>
          <tr className="h-[25px]">
            <td className="border-l border-b border-black" />
            <td className="border-r border-b border-black text-center">月　　  日まで</td>
          </tr>
        </tbody>
      </table>

      {/* 注記 */}
      <div className="text-[7.5px] leading-tight mt-1">
        <p>（注）　特定建設業者でない個人又は資本の額が建設業法施行令第7条の2に定める金額未満の業者との契約の完成払いにおいては、完成検査に合格した日又は引渡しの日から起算して50日を</p>
        <p>経過した日からの率は14.6％とする〔建設業法第24条の5第4項〕</p>
      </div>

      {order.notes && (
        <div className="text-[8px] mt-1">備考：{order.notes}</div>
      )}
    </div>
  );
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

  const { data: company, isLoading: loadingCompany } = useCompanySettings<CompanySettings>();

  useEffect(() => {
    if (!loadingOrder && !loadingCompany && order) {
      document.title = `注文書_${order.orderNumber}`;
    }
  }, [loadingOrder, loadingCompany, order]);

  if (loadingOrder || loadingCompany) {
    return <div className="flex items-center justify-center h-screen text-slate-500">読み込み中…</div>;
  }

  if (!order) {
    return <div className="flex items-center justify-center h-screen text-red-500">注文書が見つかりません</div>;
  }

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 0; }
          body { margin: 0; }
          .no-print { display: none !important; }
          .print-page { break-after: page; }
          .print-page:last-child { break-after: auto; }
        }
      `}</style>

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

      <div className="font-sans bg-white">
        <OrderSheet order={order} company={company} mode="order" />
        <OrderSheet order={order} company={company} mode="acceptance" />
      </div>
    </>
  );
}
