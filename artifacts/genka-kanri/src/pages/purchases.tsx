import { useState, useCallback, useRef } from "react";
import { useListProjects, useCreateCostItem, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

// ── 定数 ──────────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().split("T")[0];

// 伝票番号自動採番（ST-YYYYMMDD-連番 形式、localStorage で日付別管理）
function generateSlipNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const key = `slip_seq_${ymd}`;
  const current = parseInt(localStorage.getItem(key) ?? "0", 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));
  return `ST-${ymd}-${String(next).padStart(4, "0")}`;
}

const CATEGORY_MASTER = [
  { code: "610", name: "材料費", value: "material" as const },
  { code: "620", name: "外注費", value: "subcontract" as const },
  { code: "630", name: "労務費", value: "labor" as const },
  { code: "640", name: "経費", value: "expense" as const },
];

const TAX_TYPES = ["課税仕", "非課税", "不課税", "免税"];

// ── 型 ────────────────────────────────────────────────────────────────────────
interface SlipRow {
  id: string;
  attribute: string;
  receiptBook: string;
  categoryCode: string;
  productCode: string;
  productName: string;
  spec: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxType: string;
  taxRate: number;
  amount: number;
  tax: number;
  projectCode: string;
  projectId: number | null;
  projectName: string;
  workTypeCode: string;
  workTypeName: string;
  departmentCode: string;
  departmentName: string;
}

function createRow(): SlipRow {
  return {
    id: crypto.randomUUID(),
    attribute: "通常",
    receiptBook: "",
    categoryCode: "620",
    productCode: "",
    productName: "",
    spec: "",
    unit: "式",
    quantity: "",
    unitPrice: "",
    taxType: "課税仕",
    taxRate: 10,
    amount: 0,
    tax: 0,
    projectCode: "",
    projectId: null,
    projectName: "",
    workTypeCode: "",
    workTypeName: "",
    departmentCode: "",
    departmentName: "",
  };
}

function recalc(row: SlipRow): SlipRow {
  const q = parseFloat(row.quantity) || 0;
  const u = parseFloat(row.unitPrice) || 0;
  const amount = Math.floor(q * u);
  const tax = row.taxType === "課税仕" ? Math.floor(amount * row.taxRate / 100) : 0;
  return { ...row, amount, tax };
}

// ── ヘルパーコンポーネント ─────────────────────────────────────────────────────
function FuncKey({
  label, onClick, disabled = false, variant = "default",
}: {
  label: string; onClick: () => void; disabled?: boolean; variant?: "default" | "primary" | "danger";
}) {
  const cls =
    variant === "primary" ? "bg-teal-600 hover:bg-teal-700 text-white border-teal-700" :
    variant === "danger"  ? "text-red-600 border-red-200 hover:bg-red-50" :
    "bg-white hover:bg-slate-50 text-slate-700";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-8 px-3 text-xs border border-slate-300 rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {label}
    </button>
  );
}

function HCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`border border-slate-300 px-2 py-0.5 bg-teal-700 text-white text-[11px] font-medium whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}

function VCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`border border-slate-300 p-0 ${className}`}>
      {children}
    </td>
  );
}

function CellInput({
  value, onChange, placeholder = "", type = "text", className = "", readOnly = false,
}: {
  value: string; onChange?: (v: string) => void; placeholder?: string;
  type?: string; className?: string; readOnly?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={e => onChange?.(e.target.value)}
      className={`w-full h-6 px-1 text-xs bg-transparent outline-none border-none focus:bg-blue-50 ${className}`}
    />
  );
}

// ── 明細行コンポーネント ────────────────────────────────────────────────────────
function SlipRowView({
  row, idx, selected, projects, onSelect, onChange,
}: {
  row: SlipRow;
  idx: number;
  selected: boolean;
  projects: Array<{ id: number; projectCode: string; name: string }>;
  onSelect: () => void;
  onChange: (field: keyof SlipRow, value: string | number) => void;
}) {
  const bg = selected ? "bg-blue-50" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/50";
  const bdr = "border-slate-200";

  const cat = CATEGORY_MASTER.find(c => c.code === row.categoryCode);

  return (
    <>
      {/* ── Sub-row 1: コード・数値行 ── */}
      <tr className={`${bg} cursor-pointer`} onClick={onSelect}>
        {/* No */}
        <td className={`border ${bdr} text-center text-[11px] text-slate-500 font-mono w-8`} rowSpan={2}>
          {idx + 1}
        </td>
        {/* 属性 */}
        <td className={`border ${bdr} p-0 w-14`}>
          <select
            value={row.attribute}
            onChange={e => onChange("attribute", e.target.value)}
            onClick={onSelect}
            className="w-full h-6 px-1 text-xs bg-transparent outline-none border-none focus:bg-blue-50"
          >
            <option>通常</option>
            <option>入荷</option>
            <option>締</option>
          </select>
        </td>
        {/* 科目コード */}
        <td className={`border ${bdr} p-0 w-16`}>
          <CellInput
            value={row.categoryCode}
            onChange={v => onChange("categoryCode", v)}
            className="font-mono"
          />
        </td>
        {/* 商品コード */}
        <td className={`border ${bdr} p-0 w-28`}>
          <CellInput
            value={row.productCode}
            onChange={v => onChange("productCode", v)}
            className="font-mono"
          />
        </td>
        {/* 単位 */}
        <td className={`border ${bdr} p-0 w-12 text-center`}>
          <CellInput value={row.unit} onChange={v => onChange("unit", v)} className="text-center" />
        </td>
        {/* 単価 */}
        <td className={`border ${bdr} p-0 w-24`}>
          <CellInput
            value={row.unitPrice}
            onChange={v => onChange("unitPrice", v)}
            type="number"
            className="text-right"
          />
        </td>
        {/* 金額 */}
        <td className={`border ${bdr} px-1 w-24 text-right text-xs font-mono text-slate-800`}>
          {row.amount > 0 ? row.amount.toLocaleString() : ""}
        </td>
        {/* 工事コード */}
        <td className={`border ${bdr} p-0 w-32`}>
          <CellInput
            value={row.projectCode}
            onChange={v => onChange("projectCode", v)}
            placeholder="工事コード"
            className="font-mono"
          />
        </td>
        {/* 工事名 */}
        <td className={`border ${bdr} px-1 text-xs text-slate-700 min-w-[120px]`}>
          {row.projectName || <span className="text-slate-300">—</span>}
        </td>
      </tr>

      {/* ── Sub-row 2: 名称・摘要・税行 ── */}
      <tr className={`${bg} cursor-pointer border-b border-slate-300`} onClick={onSelect}>
        {/* 入荷簿 */}
        <td className={`border ${bdr} p-0 w-14`}>
          <CellInput value={row.receiptBook} onChange={v => onChange("receiptBook", v)} placeholder="入荷簿" className="text-slate-500" />
        </td>
        {/* 科目名 */}
        <td className={`border ${bdr} px-1 text-[11px] text-slate-600 w-16`}>
          {cat?.name ?? ""}
        </td>
        {/* 商品名 + 仕様摘要 */}
        <td className={`border ${bdr} p-0 w-28`}>
          <CellInput value={row.productName} onChange={v => onChange("productName", v)} placeholder="商品名" />
          <CellInput value={row.spec} onChange={v => onChange("spec", v)} placeholder="仕様摘要" className="text-slate-400" />
        </td>
        {/* 数量 */}
        <td className={`border ${bdr} p-0 w-12`}>
          <CellInput value={row.quantity} onChange={v => onChange("quantity", v)} type="number" className="text-right" />
        </td>
        {/* 税区分/税率 */}
        <td className={`border ${bdr} p-0 w-24`}>
          <div className="flex items-center gap-0.5 px-0.5">
            <select
              value={row.taxType}
              onChange={e => onChange("taxType", e.target.value)}
              onClick={onSelect}
              className="flex-1 h-6 text-[10px] bg-transparent outline-none border-none focus:bg-blue-50"
            >
              {TAX_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select
              value={row.taxRate}
              onChange={e => onChange("taxRate", Number(e.target.value))}
              onClick={onSelect}
              className="w-10 h-6 text-[10px] bg-transparent outline-none border-none focus:bg-blue-50"
            >
              <option value={10}>10%</option>
              <option value={8}>8%</option>
              <option value={0}>0%</option>
            </select>
          </div>
        </td>
        {/* 消費税 */}
        <td className={`border ${bdr} px-1 w-24 text-right text-[11px] font-mono text-blue-600`}>
          {row.tax > 0 ? row.tax.toLocaleString() : ""}
        </td>
        {/* 工種コード / 部門コード */}
        <td className={`border ${bdr} p-0 w-32`}>
          <CellInput value={row.workTypeCode} onChange={v => onChange("workTypeCode", v)} placeholder="工種コード" className="font-mono text-[10px]" />
          <CellInput value={row.departmentCode} onChange={v => onChange("departmentCode", v)} placeholder="部門コード" className="font-mono text-[10px]" />
        </td>
        {/* 工種名 / 部門名 */}
        <td className={`border ${bdr} px-1 min-w-[120px]`}>
          <div className="text-[10px] text-slate-500">{row.workTypeName || "—"}</div>
          <div className="text-[10px] text-slate-500">{row.departmentName || "—"}</div>
        </td>
      </tr>
    </>
  );
}

// ── メインコンポーネント ───────────────────────────────────────────────────────
export default function Purchases() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: projects } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const createCostItem = useCreateCostItem();
  const [saving, setSaving] = useState(false);

  // ── ヘッダー状態 ──
  const [slipNumber, setSlipNumber] = useState(() => generateSlipNumber());
  const [purchaseDate, setPurchaseDate] = useState(TODAY);
  const [vendorCode, setVendorCode] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [vendorDept, setVendorDept] = useState("");
  const [estimateNumber, setEstimateNumber] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [secondCategory, setSecondCategory] = useState("");
  const [taxCalcType, setTaxCalcType] = useState("外税明細単位");
  const [taxFraction, setTaxFraction] = useState("切捨て");
  const [amountFraction, setAmountFraction] = useState("切捨て");
  const [taxpayerType, setTaxpayerType] = useState("課税事業者");
  const [isDraft, setIsDraft] = useState(false);
  const [noTransfer, setNoTransfer] = useState(false);
  const [transferred, setTransferred] = useState(false);
  const [paymentCopied, setPaymentCopied] = useState(false);
  const [stampKa, setStampKa] = useState("");
  const [stampKakari, setStampKakari] = useState("");
  const [stampTan, setStampTan] = useState("");

  // ── 明細行状態 ──
  const [rows, setRows] = useState<SlipRow[]>([createRow()]);
  const [selectedRow, setSelectedRow] = useState(0);

  // ── 行変更ハンドラ ──
  const handleRowChange = useCallback((idx: number, field: keyof SlipRow, value: string | number) => {
    setRows(prev => {
      const next = [...prev];
      let row: SlipRow = { ...next[idx], [field]: value };

      if (field === "projectCode") {
        const proj = prev[idx]; // current state
        const match = (projects?.items ?? []).find(
          p => p.projectCode?.toLowerCase() === String(value).toLowerCase()
        );
        row.projectId = match?.id ?? null;
        row.projectName = match?.name ?? "";
      }

      if (["quantity", "unitPrice", "taxType", "taxRate"].includes(field as string)) {
        row = recalc(row);
      }

      next[idx] = row;
      return next;
    });
  }, [projects]);

  // ── 行操作 ──
  const insertRow = () => {
    setRows(prev => {
      const next = [...prev];
      next.splice(selectedRow, 0, createRow());
      return next;
    });
  };

  const deleteRow = () => {
    setRows(prev => {
      if (prev.length === 1) return [createRow()];
      const next = prev.filter((_, i) => i !== selectedRow);
      setSelectedRow(s => Math.min(s, next.length - 1));
      return next;
    });
  };

  const duplicateRow = () => {
    setRows(prev => {
      const next = [...prev];
      next.splice(selectedRow + 1, 0, { ...prev[selectedRow], id: crypto.randomUUID() });
      setSelectedRow(selectedRow + 1);
      return next;
    });
  };

  const newSlip = () => {
    setSlipNumber(generateSlipNumber()); setPurchaseDate(TODAY); setVendorCode(""); setVendorName("");
    setPaymentDueDate(""); setVendorDept(""); setEstimateNumber(""); setOrderNumber("");
    setSecondCategory(""); setTaxCalcType("外税明細単位"); setTaxFraction("切捨て");
    setAmountFraction("切捨て"); setTaxpayerType("課税事業者");
    setIsDraft(false); setNoTransfer(false); setTransferred(false); setPaymentCopied(false);
    setStampKa(""); setStampKakari(""); setStampTan("");
    setRows([createRow()]); setSelectedRow(0);
  };

  // ── F12 登録 ──
  const handleRegister = async () => {
    const validRows = rows.filter(r => r.projectId && (r.amount > 0 || r.productName));
    if (validRows.length === 0) {
      toast({ title: "入力エラー", description: "工事コードと金額が入力された明細が必要です。", variant: "destructive" });
      return;
    }

    const categoryMap: Record<string, "material" | "labor" | "subcontract" | "expense"> = {
      "610": "material", "620": "subcontract", "630": "labor", "640": "expense",
    };

    setSaving(true);
    try {
      await Promise.all(
        validRows.map(row =>
          createCostItem.mutateAsync({
            data: {
              projectId: row.projectId!,
              category: categoryMap[row.categoryCode] ?? "expense",
              incurredDate: purchaseDate,
              description: [row.productName, row.spec].filter(Boolean).join(" ") || "（摘要なし）",
              vendor: vendorName || undefined,
              quantity: row.quantity ? parseFloat(row.quantity) : undefined,
              unit: row.unit || undefined,
              unitPrice: row.unitPrice ? parseFloat(row.unitPrice) : undefined,
              amount: row.amount,
              invoiceNumber: slipNumber || undefined,
            },
          })
        )
      );
      toast({ title: "登録完了", description: `${validRows.length}件の仕入明細を登録しました。` });
      queryClient.invalidateQueries({ queryKey: ["/api/cost-items"] });
      newSlip();
    } catch {
      toast({ title: "登録エラー", description: "登録に失敗しました。入力内容を確認してください。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── 合計 ──
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const totalTax    = rows.reduce((s, r) => s + r.tax, 0);
  const totalGross  = totalAmount + totalTax;

  // ── 小コンポーネント (inline) ──
  const Lbl = ({ children, w = "" }: { children: React.ReactNode; w?: string }) => (
    <td className={`border border-slate-300 px-2 py-0.5 bg-teal-700 text-white text-[11px] font-medium whitespace-nowrap ${w}`}>
      {children}
    </td>
  );

  const Cell = ({ children, colSpan = 1, className = "" }: { children: React.ReactNode; colSpan?: number; className?: string }) => (
    <td colSpan={colSpan} className={`border border-slate-300 p-0.5 ${className}`}>
      {children}
    </td>
  );

  const hi = "h-6 text-xs border-none shadow-none p-0.5 focus:bg-blue-50";
  const si = "h-6 text-xs border-none shadow-none p-0 focus:bg-blue-50";

  const FlagCheck = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label className="flex items-center gap-1 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-3 h-3 accent-teal-600"
      />
      <span className="text-[11px]">{label}</span>
    </label>
  );

  return (
    <div className="flex flex-col h-full bg-slate-100 min-h-screen">

      {/* ── ファンクションキーバー ── */}
      <div className="bg-slate-200 border-b border-slate-300 px-3 py-2 flex items-center gap-1.5 flex-wrap shrink-0">
        <span className="text-sm font-bold text-slate-700 mr-2">仕入伝票【新規】</span>
        <FuncKey label="F2 新規"     onClick={newSlip} />
        <FuncKey label="F4 支払"     onClick={() => {}} />
        <FuncKey label="F5 予算確認" onClick={() => {}} />
        <FuncKey label="F6 複写"     onClick={() => {}} disabled />
        <FuncKey label="F7 検索"     onClick={() => {}} disabled />
        <FuncKey label="F8 参照"     onClick={() => {}} disabled />
        <FuncKey label="F9 削除"     onClick={() => {}} disabled variant="danger" />
        <div className="flex-1" />
        <FuncKey
          label={saving ? "登録中…" : "F12 登録"}
          onClick={handleRegister}
          disabled={saving}
          variant="primary"
        />
        <FuncKey label="閉じる" onClick={newSlip} />
      </div>

      {/* ── タイトル ── */}
      <div className="flex justify-center pt-2 pb-1 bg-white border-b shrink-0">
        <div className="border-2 border-teal-600 bg-teal-50 px-16 py-0.5 text-center text-base font-bold text-teal-800 tracking-widest">
          仕入伝票
        </div>
      </div>

      {/* ── ヘッダー ── */}
      <div className="bg-white border-b px-3 py-2 flex gap-3 shrink-0">
        {/* ヘッダーグリッドテーブル */}
        <table className="flex-1 text-xs border-collapse">
          <colgroup>
            <col className="w-[72px]" />
            <col className="w-[130px]" />
            <col className="w-[64px]" />
            <col className="w-[130px]" />
            <col className="w-[64px]" />
            <col />
          </colgroup>
          <tbody>
            {/* Row 1: 伝票番号 / 見積番号 / スタンプ */}
            <tr>
              <Lbl>伝票番号</Lbl>
              <Cell>
                <div className="flex items-center gap-1">
                  <Input
                    value={slipNumber}
                    onChange={e => setSlipNumber(e.target.value)}
                    className={`${hi} font-mono bg-yellow-50`}
                  />
                  <span className="text-[9px] text-slate-400 whitespace-nowrap pr-0.5">自動</span>
                </div>
              </Cell>
              <Lbl>見積番号</Lbl>
              <Cell>
                <Input value={estimateNumber} onChange={e => setEstimateNumber(e.target.value)} className={hi} />
              </Cell>
              <Lbl>スタンプ</Lbl>
              <Cell>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-slate-500">課</span>
                  <Input value={stampKa} onChange={e => setStampKa(e.target.value)} className={`${hi} w-10`} />
                  <span className="text-[10px] text-slate-500">係</span>
                  <Input value={stampKakari} onChange={e => setStampKakari(e.target.value)} className={`${hi} w-10`} />
                  <span className="text-[10px] text-red-500">担</span>
                  <Input value={stampTan} onChange={e => setStampTan(e.target.value)} className={`${hi} w-10`} />
                  <button className="h-6 px-2 text-[10px] border border-slate-300 rounded bg-white hover:bg-slate-50">承認</button>
                  <button className="h-6 px-2 text-[10px] border border-slate-300 rounded bg-white hover:bg-slate-50">履歴</button>
                </div>
              </Cell>
            </tr>
            {/* Row 2: 仕入日 / 注文番号 / 第2区分 */}
            <tr>
              <Lbl>仕入日</Lbl>
              <Cell>
                <Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className={hi} />
              </Cell>
              <Lbl>注文番号</Lbl>
              <Cell>
                <Input value={orderNumber} onChange={e => setOrderNumber(e.target.value)} className={hi} />
              </Cell>
              <Lbl>第2区分</Lbl>
              <Cell>
                <Input value={secondCategory} onChange={e => setSecondCategory(e.target.value)} className={`${hi} w-20`} />
              </Cell>
            </tr>
            {/* Row 3: 仕入先 / 税計算 / 仮伝票 */}
            <tr>
              <Lbl>仕入先</Lbl>
              <Cell colSpan={1}>
                <div className="flex gap-1">
                  <Input value={vendorCode} onChange={e => setVendorCode(e.target.value)} placeholder="コード" className={`${hi} w-16`} />
                  <Input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="仕入先名称" className={`${hi} flex-1`} />
                </div>
              </Cell>
              <Lbl>税計算</Lbl>
              <Cell>
                <select value={taxCalcType} onChange={e => setTaxCalcType(e.target.value)} className="w-full h-6 text-xs px-1 bg-transparent outline-none border-none focus:bg-blue-50">
                  <option>外税明細単位</option>
                  <option>外税伝票単位</option>
                  <option>内税</option>
                  <option>不課税</option>
                </select>
              </Cell>
              <td className="border border-slate-300 p-1.5">
                <FlagCheck checked={isDraft} onChange={setIsDraft} label="仮伝票" />
              </td>
            </tr>
            {/* Row 4: 支払予定日 / 税端数 / 非転記 */}
            <tr>
              <Lbl>支払予定日</Lbl>
              <Cell>
                <Input type="date" value={paymentDueDate} onChange={e => setPaymentDueDate(e.target.value)} className={hi} />
              </Cell>
              <Lbl>税端数</Lbl>
              <Cell>
                <select value={taxFraction} onChange={e => setTaxFraction(e.target.value)} className="w-full h-6 text-xs px-1 bg-transparent outline-none border-none focus:bg-blue-50">
                  <option>切捨て</option>
                  <option>切上げ</option>
                  <option>四捨五入</option>
                </select>
              </Cell>
              <td className="border border-slate-300 p-1.5">
                <FlagCheck checked={noTransfer} onChange={setNoTransfer} label="非転記" />
              </td>
            </tr>
            {/* Row 5: 仕入先部門 / 金額端数 / 転記済 */}
            <tr>
              <Lbl>仕入先部門</Lbl>
              <Cell>
                <Input value={vendorDept} onChange={e => setVendorDept(e.target.value)} className={hi} />
              </Cell>
              <Lbl>金額端数</Lbl>
              <Cell>
                <select value={amountFraction} onChange={e => setAmountFraction(e.target.value)} className="w-full h-6 text-xs px-1 bg-transparent outline-none border-none focus:bg-blue-50">
                  <option>切捨て</option>
                  <option>切上げ</option>
                  <option>四捨五入</option>
                </select>
              </Cell>
              <td className="border border-slate-300 p-1.5">
                <FlagCheck checked={transferred} onChange={setTransferred} label="転記済" />
              </td>
            </tr>
            {/* Row 6: (空) / 事業者種類 / 支払複写済 */}
            <tr>
              <td className="border border-slate-300" />
              <td className="border border-slate-300" />
              <Lbl>事業者種類</Lbl>
              <Cell>
                <select value={taxpayerType} onChange={e => setTaxpayerType(e.target.value)} className="w-full h-6 text-xs px-1 bg-transparent outline-none border-none focus:bg-blue-50">
                  <option>課税事業者</option>
                  <option>免税事業者</option>
                </select>
              </Cell>
              <td className="border border-slate-300 p-1.5">
                <FlagCheck checked={paymentCopied} onChange={setPaymentCopied} label="支払複写済" />
              </td>
            </tr>
          </tbody>
        </table>

        {/* 右サイドパネル */}
        <div className="flex flex-col gap-2 shrink-0 justify-between">
          <div className="flex flex-col gap-1">
            <button className="h-7 px-3 text-xs border border-slate-300 rounded bg-white hover:bg-slate-50 text-left">
              税端数調整
            </button>
            <button className="text-xs text-blue-600 underline text-left px-0.5">税端数調整について</button>
          </div>
          <div className="flex gap-1">
            <button
              onClick={insertRow}
              className="h-7 px-3 text-xs border border-slate-300 rounded bg-white hover:bg-slate-50 font-medium"
            >行挿</button>
            <button
              onClick={deleteRow}
              className="h-7 px-3 text-xs border border-slate-300 rounded bg-white hover:bg-red-50 text-red-600 font-medium"
            >行削</button>
            <button
              onClick={duplicateRow}
              className="h-7 px-3 text-xs border border-slate-300 rounded bg-white hover:bg-slate-50 font-medium"
            >行複</button>
          </div>
        </div>
      </div>

      {/* ── 明細テーブル ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs" style={{ minWidth: "1100px" }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-teal-700 text-white text-center text-[11px]">
              <th className="border border-teal-600 px-1 py-1 w-8">No</th>
              <th className="border border-teal-600 px-1 py-1 w-16">属性<br />入荷簿</th>
              <th className="border border-teal-600 px-1 py-1 w-20">科目コード<br />科目名</th>
              <th className="border border-teal-600 px-1 py-1 w-40">商品コード<br />商品名<br />仕様摘要</th>
              <th className="border border-teal-600 px-1 py-1 w-14">単位<br />数量<br />残</th>
              <th className="border border-teal-600 px-1 py-1 w-24">単価<br />税区分/税率</th>
              <th className="border border-teal-600 px-1 py-1 w-24">金額<br />消費税</th>
              <th className="border border-teal-600 px-1 py-1 w-36">工事コード<br />工種コード<br />部門コード</th>
              <th className="border border-teal-600 px-1 py-1">工事名<br />工種名<br />部門名</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <SlipRowView
                key={row.id}
                row={row}
                idx={idx}
                selected={selectedRow === idx}
                projects={projects?.items ?? []}
                onSelect={() => setSelectedRow(idx)}
                onChange={(field, value) => handleRowChange(idx, field, value)}
              />
            ))}
            {/* 空行クリック → 行追加 */}
            <tr
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => setRows(r => [...r, createRow()])}
            >
              <td colSpan={9} className="border border-slate-200 py-3 text-center text-slate-400 text-xs">
                + クリックして行を追加
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── フッター ── */}
      <div className="bg-white border-t px-4 py-2 flex items-center justify-between shrink-0">
        <button className="text-xs text-blue-600 underline">工事入力形式の切替について</button>
        <div className="flex border border-slate-300 text-xs overflow-hidden rounded">
          <div className="bg-teal-700 text-white px-4 py-1.5 font-medium">税抜金額</div>
          <div className="bg-teal-700 text-white px-4 py-1.5 font-medium border-x border-teal-600">消費税額</div>
          <div className="bg-teal-700 text-white px-4 py-1.5 font-medium">合計金額</div>
          <div className="w-px bg-slate-300" />
          <div className="px-4 py-1.5 text-right font-mono min-w-[90px] bg-white">
            {totalAmount.toLocaleString()}
          </div>
          <div className="px-4 py-1.5 text-right font-mono min-w-[80px] bg-white border-x border-slate-200 text-blue-600">
            {totalTax.toLocaleString()}
          </div>
          <div className="px-4 py-1.5 text-right font-mono min-w-[90px] bg-white font-bold">
            {totalGross.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}
