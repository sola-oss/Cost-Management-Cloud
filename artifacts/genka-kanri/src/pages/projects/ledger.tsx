import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ContractLine {
  contractDate: string | null;
  taxExcludedAmount: number | null;
}

interface ProjectData {
  id: number;
  projectCode: string;
  name: string;
  clientName: string;
  clientCode: string | null;
  location: string;
  contractAmount: number;
  taxExcludedAmount: number | null;
  taxAmount: number | null;
  taxIncludedAmount: number | null;
  status: string;
  orderType: string | null;
  orderDate: string | null;
  startDate: string;
  endDate: string;
  startDateActual: string | null;
  endDateActual: string | null;
  handoverDate: string | null;
  handoverDateActual: string | null;
  progressRate: number | null;
  recognitionBasis: string | null;
  department: string | null;
  salesStaff: string | null;
  siteManager: string | null;
  category1: string | null;
  category2: string | null;
  category3: string | null;
  floorAreaTsubo: number | null;
  floorAreaSqm: number | null;
  overview: string | null;
  memo: string | null;
  contractLines: ContractLine[] | null;
  publicPrivateType: string | null;
  constructionHistoryType: string | null;
  constructionHistoryEngineer: string | null;
}

interface ConstructionHistory {
  constructionType: string | null;
  contractType: string | null;
  primeContractorName: string | null;
  engineer1Category: string | null;
  engineer1Name: string | null;
  engineer1Qualification: string | null;
  engineer1LicenseNumber: string | null;
  specialist1WorkContent: string | null;
  specialist1Name: string | null;
  remarks: string | null;
}

interface Payment {
  id: number;
  paymentDate: string | null;
  amount: number;
}

interface Invoice {
  id: number;
  invoiceDate: string | null;
  totalAmount: number;
  paidAmount: number;
  payments: Payment[];
}

interface CompanySettings {
  companyName: string;
  address: string | null;
  tel: string | null;
}

interface LedgerSummary {
  totalBudget: number;
  totalActualCost: number;
  grossProfit: number;
  grossProfitRate: number;
  totalInvoiced: number;
  totalPaid: number;
  totalUnpaid: number;
}

interface LedgerData {
  project: ProjectData;
  constructionHistory: ConstructionHistory | null;
  invoices: Invoice[];
  companySettings: CompanySettings | null;
  summary: LedgerSummary;
}

function toJpDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y) return "";
  if (y >= 2019) return `令和${y - 2018}年${m}月${d}日`;
  if (y >= 1989) return `平成${y - 1988}年${m}月${d}日`;
  return `${y}/${m}/${d}`;
}

function toJpShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const [, m, d] = dateStr.split("-").map(Number);
  if (!m) return "";
  return `${m}/${d}`;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "";
  return n.toLocaleString("ja-JP");
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  return n.toLocaleString("ja-JP");
}

const BLANK = "\u00A0";

function CellTh({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`border border-gray-600 bg-gray-100 text-center text-[10px] font-semibold px-1 py-0.5 whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}

function CellTd({ children, className = "", colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={`border border-gray-600 text-[10px] px-1 py-0.5 ${className}`}>
      {children || BLANK}
    </td>
  );
}

export default function ProjectLedger() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0");

  const { data, isLoading, error } = useQuery<LedgerData>({
    queryKey: [`/api/projects/${projectId}/ledger`],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/projects/${projectId}/ledger`);
      if (!res.ok) throw new Error("台帳データの取得に失敗しました");
      return res.json();
    },
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-slate-500">工事台帳データを読み込めませんでした。</p>
        <Button variant="link" asChild className="mt-2 px-0">
          <Link href={`/projects/${projectId}`}>← 工事詳細へ戻る</Link>
        </Button>
      </div>
    );
  }

  const { project, constructionHistory, invoices, companySettings, summary } = data;
  const today = new Date().toISOString().slice(0, 10);

  const contractLines: ContractLine[] = (project.contractLines || []).filter(l => l.taxExcludedAmount);
  const CONTRACT_ROWS = 10;

  const grossProfitPct = summary.grossProfitRate.toFixed(1);

  const allPayments = invoices.flatMap(inv => inv.payments);
  const TABLE_ROWS = 10;

  const prefecture = constructionHistory
    ? ""
    : (project.location || "").replace(/[市区町村郡].+/, "");

  return (
    <div className="ledger-wrapper bg-gray-50">
      {/* ── Screen controls ── */}
      <div className="print:hidden flex items-center gap-3 p-4 bg-white border-b shadow-sm">
        <Button variant="outline" size="icon" asChild>
          <Link href={`/projects/${projectId}`}>
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <span className="font-semibold text-slate-700">工事台帳</span>
        <span className="text-sm text-slate-500 flex-1">{project.name}</span>
        <Button onClick={() => window.print()} className="bg-teal-700 hover:bg-teal-800 text-white gap-2">
          <Printer className="w-4 h-4" />
          印刷
        </Button>
      </div>

      {/* ── Print area ── */}
      <div className="ledger-page p-4 print:p-0 bg-white mx-auto" style={{ maxWidth: "210mm" }}>

        {/* ── Title ── */}
        <div className="flex items-start justify-between mb-1">
          <div className="text-[10px] text-transparent">.</div>
          <div className="text-center">
            <div className="text-xl font-bold tracking-widest">工　事　台　帳</div>
          </div>
          <div className="text-right text-[10px]">
            <div>Page: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 1</div>
            <div>作成日&nbsp; {toJpDate(today)}</div>
          </div>
        </div>

        {/* ── Company / Order date row ── */}
        <div className="flex justify-between text-[10px] mb-1">
          <div>会社名&nbsp; {companySettings?.companyName || BLANK}</div>
          <div className="border border-gray-600 px-6 py-0.5 text-center">
            受　注　日&nbsp;&nbsp; {toJpDate(project.orderDate)}
          </div>
        </div>

        {/* ── Project info table ── */}
        <table className="w-full border-collapse text-[10px] mb-0" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "88%" }} />
          </colgroup>
          <tbody>
            <tr>
              <CellTh>工事名称</CellTh>
              <CellTd>
                [{project.projectCode}]&nbsp;{project.name}
                {project.constructionHistoryType ? `（${project.constructionHistoryType}）` : ""}
              </CellTd>
            </tr>
            <tr>
              <CellTh>工事場所</CellTh>
              <CellTd>{project.location}</CellTd>
            </tr>
            <tr>
              <CellTh>得意先名</CellTh>
              <CellTd>
                {project.clientCode ? `[${project.clientCode}]` : ""}
                &nbsp;{project.clientName}
                {constructionHistory?.contractType === "下請" && constructionHistory.primeContractorName
                  ? `　/　発注者（${constructionHistory.primeContractorName}）`
                  : ""}
              </CellTd>
            </tr>
            <tr>
              <CellTh>受注区分</CellTh>
              <td className="border border-gray-600 text-[10px]">
                <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "5%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "5%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "5%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "5%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "8%" }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <td className="border-r border-gray-600 px-1 py-0.5">{project.orderType || BLANK}</td>
                      <td className="border-r border-gray-600 px-1 py-0.5 text-center bg-gray-100 font-semibold">坪</td>
                      <td className="border-r border-gray-600 px-1 py-0.5 text-right">{fmt(project.floorAreaTsubo)}</td>
                      <td className="border-r border-gray-600 px-1 py-0.5 text-center bg-gray-100 font-semibold">坪単価</td>
                      <td className="border-r border-gray-600 px-1 py-0.5 text-right">
                        {project.floorAreaTsubo && project.contractAmount
                          ? fmt(Math.round(project.contractAmount / project.floorAreaTsubo))
                          : BLANK}
                      </td>
                      <td className="border-r border-gray-600 px-1 py-0.5 text-center bg-gray-100 font-semibold">㎡</td>
                      <td className="border-r border-gray-600 px-1 py-0.5 text-right">{fmt(project.floorAreaSqm)}</td>
                      <td className="border-r border-gray-600 px-1 py-0.5 text-center bg-gray-100 font-semibold">㎡単価</td>
                      <td className="px-1 py-0.5 text-right">
                        {project.floorAreaSqm && project.contractAmount
                          ? fmt(Math.round(project.contractAmount / project.floorAreaSqm))
                          : BLANK}
                      </td>
                      <td className="px-1 py-0.5">{BLANK}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <CellTh>工事概要</CellTh>
              <CellTd className="py-1">{project.overview}</CellTd>
            </tr>
          </tbody>
        </table>

        {/* ── Contract lines + Right info ── */}
        <table className="w-full border-collapse text-[10px] mb-0" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "5%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "31%" }} />
          </colgroup>
          <thead>
            <tr>
              <CellTh className="text-center">No</CellTh>
              <CellTh>契約日付</CellTh>
              <CellTh className="text-right">請負金額</CellTh>
              <CellTh className="text-right">消費税10%</CellTh>
              <CellTh className="text-right">税込金額</CellTh>
              <CellTh className="text-center">　</CellTh>
              <CellTh className="text-left">工事情報</CellTh>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: CONTRACT_ROWS }, (_, i) => {
              const line = contractLines[i];
              const excluded = line?.taxExcludedAmount ?? null;
              const tax = excluded != null ? Math.round(excluded * 0.1) : null;
              const included = excluded != null && tax != null ? excluded + tax : null;

              const isFirstRow = i === 0;
              const RIGHT: Record<number, [string, string]> = {
                0: ["グループ", ""],
                1: ["工事部門", project.department || ""],
                2: ["営業担当", project.salesStaff || ""],
                3: ["工事担当", project.siteManager || ""],
                4: ["工事分類1", project.category1 || ""],
                5: ["工事分類2", project.category2 || ""],
                6: ["工事分類3", project.category3 || ""],
              };

              const scheduleRows: Record<number, [string, string, string]> = {
                7: ["着工日", toJpShort(project.startDate), toJpShort(project.startDateActual)],
                8: ["竣工", toJpShort(project.endDate), toJpShort(project.endDateActual)],
                9: ["引渡日", toJpShort(project.handoverDate), toJpShort(project.handoverDateActual)],
              };

              const isScheduleRow = i >= 7 && i <= 9;
              const isInfoRow = i in RIGHT;

              return (
                <tr key={i}>
                  <CellTd className="text-center">{i + 1}</CellTd>
                  <CellTd className="text-center">{line?.contractDate ? toJpShort(line.contractDate) : BLANK}</CellTd>
                  <CellTd className="text-right">{fmtCurrency(excluded)}</CellTd>
                  <CellTd className="text-right">{fmtCurrency(tax)}</CellTd>
                  <CellTd className="text-right">{fmtCurrency(included)}</CellTd>

                  {isFirstRow ? (
                    <>
                      <td rowSpan={7} className="border border-gray-600 text-center text-[9px] bg-gray-100 font-semibold align-middle">
                        工事<br />情報
                      </td>
                      <td className="border border-gray-600 px-1 py-0.5">
                        <span className="text-gray-500 mr-1">{RIGHT[0][0]}</span>{RIGHT[0][1] || BLANK}
                      </td>
                    </>
                  ) : isInfoRow && i < 7 ? (
                    <td className="border border-gray-600 px-1 py-0.5">
                      <span className="text-gray-500 mr-1">{RIGHT[i][0]}</span>{RIGHT[i][1] || BLANK}
                    </td>
                  ) : isScheduleRow ? (
                    i === 7 ? (
                      <>
                        <td rowSpan={3} className="border border-gray-600 text-center text-[9px] bg-gray-100 font-semibold align-middle">
                          工事<br />日程
                        </td>
                        <td className="border border-gray-600 px-0.5 py-0.5">
                          <div className="flex justify-between text-[9px]">
                            <span className="w-8 text-gray-500">{scheduleRows[7][0]}</span>
                            <span className="flex-1 text-center">{scheduleRows[7][1] || BLANK}</span>
                            <span className="flex-1 text-center">{scheduleRows[7][2] || BLANK}</span>
                          </div>
                        </td>
                      </>
                    ) : (
                      <td className="border border-gray-600 px-0.5 py-0.5">
                        <div className="flex justify-between text-[9px]">
                          <span className="w-8 text-gray-500">{scheduleRows[i][0]}</span>
                          <span className="flex-1 text-center">{scheduleRows[i][1] || BLANK}</span>
                          <span className="flex-1 text-center">{scheduleRows[i][2] || BLANK}</span>
                        </div>
                      </td>
                    )
                  ) : (
                    <CellTd>{BLANK}</CellTd>
                  )}
                </tr>
              );
            })}

            {/* 合計 row */}
            <tr>
              <td colSpan={2} className="border border-gray-600 text-center text-[10px] bg-gray-100 font-semibold px-1 py-0.5">合　計</td>
              <CellTd className="text-right font-semibold">
                {fmtCurrency(contractLines.reduce((s, l) => s + (l.taxExcludedAmount ?? 0), 0) || null)}
              </CellTd>
              <CellTd className="text-right font-semibold">
                {fmtCurrency(contractLines.reduce((s, l) => s + Math.round((l.taxExcludedAmount ?? 0) * 0.1), 0) || null)}
              </CellTd>
              <CellTd className="text-right font-semibold">
                {fmtCurrency(contractLines.reduce((s, l) => {
                  const ex = l.taxExcludedAmount ?? 0;
                  return s + ex + Math.round(ex * 0.1);
                }, 0) || null)}
              </CellTd>
              {/* Progress info spans remaining */}
              <td className="border border-gray-600 text-center text-[9px] bg-gray-100 font-semibold px-1 py-0.5 whitespace-nowrap">進捗</td>
              <td className="border border-gray-600 px-1 py-0.5 text-[10px]">
                <span className="text-gray-500 mr-1">計上基準</span>{project.recognitionBasis || BLANK}
                &nbsp;&nbsp;
                <span className="text-gray-500 mr-1">進捗率</span>{project.progressRate != null ? `${project.progressRate}%` : BLANK}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Construction History / 工事経歴 section ── */}
        <table className="w-full border-collapse text-[10px] mb-0" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "8%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "33%" }} />
          </colgroup>
          <thead>
            <tr>
              <CellTh>都道府県</CellTh>
              <CellTh>市区町村</CellTh>
              <CellTh>種類</CellTh>
              <CellTh>配置技術者（監理技術者）</CellTh>
              <CellTh>公共・民間</CellTh>
              <CellTh>公共・JV</CellTh>
              <CellTh>元請・下請</CellTh>
              <CellTh>進行基準完成工事高</CellTh>
            </tr>
          </thead>
          <tbody>
            <tr>
              <CellTd className="text-center">{prefecture}</CellTd>
              <CellTd className="text-center">{BLANK}</CellTd>
              <CellTd>{constructionHistory?.constructionType || project.constructionHistoryType}</CellTd>
              <CellTd>
                {constructionHistory
                  ? [constructionHistory.engineer1Category, constructionHistory.engineer1Name].filter(Boolean).join("　")
                  : project.constructionHistoryEngineer}
              </CellTd>
              <CellTd className="text-center">{project.publicPrivateType}</CellTd>
              <CellTd className="text-center">{BLANK}</CellTd>
              <CellTd className="text-center">{constructionHistory?.contractType}</CellTd>
              <CellTd className="text-right">{BLANK}</CellTd>
            </tr>
          </tbody>
        </table>

        {/* ── 備考 ── */}
        <table className="w-full border-collapse text-[10px] mb-0" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "8%" }} />
            <col />
          </colgroup>
          <tbody>
            <tr>
              <CellTh className="align-top py-1">備　考</CellTh>
              <CellTd className="py-1 min-h-[2rem]">{project.memo}</CellTd>
            </tr>
          </tbody>
        </table>

        {/* ── Financial summary ── */}
        <table className="w-full border-collapse text-[10px] mb-0" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "8%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "34%" }} />
          </colgroup>
          <tbody>
            <tr>
              <CellTh className="text-right">請負金額</CellTh>
              <CellTd className="text-right">{fmt(project.contractAmount)}</CellTd>
              <CellTh className="text-right">売上金額＊</CellTh>
              <CellTd className="text-right">{fmt(summary.totalInvoiced) || BLANK}</CellTd>
              <CellTh className="text-right whitespace-nowrap">請負未収金＊</CellTh>
              <CellTd className="text-right">{fmt(summary.totalUnpaid) || BLANK}</CellTd>
              <CellTd>{BLANK}</CellTd>
            </tr>
            <tr>
              <CellTh className="text-right">原　価</CellTh>
              <CellTd className="text-right">{fmt(summary.totalActualCost) || BLANK}</CellTd>
              <CellTh className="text-right">売上金額＊</CellTh>
              <CellTd className="text-right">{BLANK}</CellTd>
              <CellTh className="text-right">未　完　工</CellTh>
              <CellTd className="text-right">{BLANK}</CellTd>
              <CellTd>{BLANK}</CellTd>
            </tr>
            <tr>
              <CellTh className="text-right">利益（%）</CellTh>
              <CellTd className="text-right">
                {fmt(summary.grossProfit)}&nbsp;（{grossProfitPct}%）
              </CellTd>
              <CellTh className="text-right whitespace-nowrap">売上未収金＊</CellTh>
              <CellTd className="text-right">{fmt(summary.totalUnpaid) || BLANK}</CellTd>
              <CellTd colSpan={3}>{BLANK}</CellTd>
            </tr>
          </tbody>
        </table>

        {/* ── Sales/Payment table ── */}
        <table className="w-full border-collapse text-[10px] mb-0" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr>
              <CellTh>No</CellTh>
              <CellTh>売上日</CellTh>
              <CellTh className="text-right">売上金額＊</CellTh>
              <CellTh>入金日</CellTh>
              <CellTh className="text-right">入金金額＊</CellTh>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: TABLE_ROWS }, (_, i) => {
              const inv = invoices[i];
              const payment = allPayments[i];
              return (
                <tr key={i}>
                  <CellTd className="text-center">{i + 1}</CellTd>
                  <CellTd className="text-center">{inv ? toJpShort(inv.invoiceDate) : BLANK}</CellTd>
                  <CellTd className="text-right">{inv ? fmt(inv.totalAmount) : BLANK}</CellTd>
                  <CellTd className="text-center">{payment ? toJpShort(payment.paymentDate) : BLANK}</CellTd>
                  <CellTd className="text-right">{payment ? fmt(payment.amount) : BLANK}</CellTd>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── Footer ── */}
        <div className="text-right text-[9px] mt-1">注）＊は税込金額です。</div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          .print\\:hidden { display: none !important; }
          html, body {
            height: auto !important;
            min-height: 0 !important;
            background: white !important;
          }
          .ledger-wrapper {
            min-height: 0 !important;
            height: auto !important;
            background: white !important;
          }
          .ledger-page { max-width: 100% !important; padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}
