import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, ArrowLeft, Save, FileDown, Download, Printer } from "lucide-react";
import { Link } from "wouter";
import { generateInvoicePDF } from "./pdf";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Client { id: number; name: string; address: string | null; }
interface Project { id: number; name: string; projectCode: string; }
interface CompanySettings {
  companyName: string; postalCode: string; address: string; tel: string; fax: string;
  invoiceRegistrationNumber: string; representativeName: string; department: string;
  bankName: string; bankBranch: string; bankAccountType: string; bankAccountNumber: string; bankAccountName: string;
}

interface BudgetItem {
  id: number;
  workTypeCode: string;
  workTypeName: string;
  revisedBudget: number;
}

interface InvoiceItem {
  id?: number;
  rowIndex: number;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxRate: number;
  amount: number;
  budgetItemId?: number | null;
}

interface InvoicePayment {
  id: number;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  notes: string;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  clientId: number | null;
  clientName: string;
  clientAddress: string;
  projectId: number | null;
  projectName: string;
  invoiceRegistrationNumber: string;
  billingType: "full" | "progress";
  taxExcludedAmount10: number;
  taxAmount10: number;
  taxExcludedAmount8: number;
  taxAmount8: number;
  taxExcludedTotal: number;
  taxTotal: number;
  totalAmount: number;
  paidAmount: number;
  status: "unpaid" | "partial" | "paid";
  notes: string;
  items: InvoiceItem[];
  payments: InvoicePayment[];
  contractAmount?: number;
  billedToDate?: number;
}

const newItem = (idx: number): InvoiceItem => ({
  rowIndex: idx,
  itemName: "",
  quantity: 1,
  unit: "式",
  unitPrice: 0,
  taxRate: 10,
  amount: 0,
  budgetItemId: null,
});

function calcTotals(items: InvoiceItem[]) {
  let taxExcludedAmount10 = 0;
  let taxExcludedAmount8 = 0;
  for (const it of items) {
    if (it.taxRate === 10) taxExcludedAmount10 += it.amount;
    else if (it.taxRate === 8) taxExcludedAmount8 += it.amount;
  }
  const taxAmount10 = Math.floor(taxExcludedAmount10 * 0.1);
  const taxAmount8 = Math.floor(taxExcludedAmount8 * 0.08);
  const taxExcludedTotal = taxExcludedAmount10 + taxExcludedAmount8;
  const taxTotal = taxAmount10 + taxAmount8;
  const totalAmount = taxExcludedTotal + taxTotal;
  return { taxExcludedAmount10, taxAmount10, taxExcludedAmount8, taxAmount8, taxExcludedTotal, taxTotal, totalAmount };
}

function fmt(v: number) { return "¥" + Math.round(v).toLocaleString("ja-JP"); }

interface PaymentFormState {
  paymentDate: string;
  amount: string;
  paymentMethod: string;
  notes: string;
}

interface Props { id?: number; }

export default function InvoiceEditor({ id }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const today = new Date().toISOString().slice(0, 10);

  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientAddress, setClientAddress] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([newItem(0)]);
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({ paymentDate: today, amount: "", paymentMethod: "振込", notes: "" });
  const [addingPayment, setAddingPayment] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);

  // Billing type
  const [billingType, setBillingType] = useState<"full" | "progress">("full");
  // Progress billing specific fields
  const [contractAmount, setContractAmount] = useState(0);
  const [billedToDate, setBilledToDate] = useState(0);
  const [progressAmount, setProgressAmount] = useState("");
  const [loadingBudget, setLoadingBudget] = useState(false);

  const { data: clients } = useQuery<{ items: Client[] }>({
    queryKey: ["/api/clients"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/clients`); return r.json(); },
  });

  const { data: projects } = useQuery<{ items: Project[] }>({
    queryKey: ["/api/projects"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/projects`); return r.json(); },
  });

  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ["/api/company-settings"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/company-settings`); return r.json(); },
  });

  const { data: existingInvoice, isLoading } = useQuery<Invoice>({
    queryKey: ["/api/invoices", id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/invoices/${id}`);
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (existingInvoice) {
      setInvoiceDate(existingInvoice.invoiceDate || today);
      setDueDate(existingInvoice.dueDate || "");
      setClientId(existingInvoice.clientId);
      setClientAddress(existingInvoice.clientAddress || "");
      setProjectId(existingInvoice.projectId);
      setProjectName(existingInvoice.projectName || "");
      setRegistrationNumber(existingInvoice.invoiceRegistrationNumber || "");
      setNotes(existingInvoice.notes || "");
      setItems(existingInvoice.items.length > 0 ? existingInvoice.items : [newItem(0)]);
      setPayments(existingInvoice.payments || []);
      setInvoice(existingInvoice);
      setBillingType(existingInvoice.billingType || "full");
      setContractAmount(existingInvoice.contractAmount ?? 0);
      setBilledToDate(existingInvoice.billedToDate ?? 0);
      if (existingInvoice.billingType === "progress") {
        setProgressAmount(String(existingInvoice.totalAmount ?? ""));
      }
    }
  }, [existingInvoice]);

  useEffect(() => {
    if (!id && companySettings?.invoiceRegistrationNumber) {
      setRegistrationNumber(companySettings.invoiceRegistrationNumber);
    }
  }, [companySettings, id]);

  const selectedClient = clients?.items.find((c) => c.id === clientId);

  const handleClientChange = (val: string) => {
    const cid = parseInt(val);
    setClientId(cid);
    const c = clients?.items.find((x) => x.id === cid);
    if (c) setClientAddress(c.address || "");
  };

  const handleProjectChange = (val: string) => {
    const pid = parseInt(val);
    setProjectId(pid);
    const p = projects?.items.find((x) => x.id === pid);
    if (p) setProjectName(p.name || "");
    // Auto-load budget items for new invoices
    if (!id) {
      loadBudgetItemsForProject(pid, { silent: true });
    } else {
      fetchBillingSummary(pid);
    }
  };

  const fetchBillingSummary = async (pid: number) => {
    try {
      const r = await fetch(`${BASE}/api/projects/${pid}/budget-items`);
      if (!r.ok) return;
      const data: { items: BudgetItem[]; totalRevisedBudget: number } = await r.json();
      setContractAmount(data.totalRevisedBudget ?? 0);
    } catch {
      // ignore, billing summary is best-effort
    }
  };

  const loadBudgetItemsForProject = async (pid: number, opts?: { silent?: boolean }) => {
    setLoadingBudget(true);
    try {
      const r = await fetch(`${BASE}/api/projects/${pid}/budget-items`);
      if (!r.ok) throw new Error("Failed to load");
      const data: { items: BudgetItem[]; totalRevisedBudget: number } = await r.json();
      setContractAmount(data.totalRevisedBudget ?? 0);
      if (data.items.length === 0) {
        if (!opts?.silent) {
          toast({ title: "実行予算明細がありません", description: "工事の実行予算タブから明細を登録してください", variant: "destructive" });
        }
        return;
      }
      const loadedItems: InvoiceItem[] = data.items.map((bi, idx) => ({
        rowIndex: idx,
        itemName: bi.workTypeName,
        quantity: 1,
        unit: "式",
        unitPrice: bi.revisedBudget,
        taxRate: 10,
        amount: bi.revisedBudget,
        budgetItemId: bi.id,
      }));
      setItems(loadedItems);
      if (!opts?.silent) {
        toast({ title: "実行予算を読み込みました", description: `${loadedItems.length}件の明細を展開しました` });
      }
    } catch {
      if (!opts?.silent) {
        toast({ title: "読み込みに失敗しました", variant: "destructive" });
      }
    } finally {
      setLoadingBudget(false);
    }
  };

  const handleLoadBudgetItems = async () => {
    if (!projectId) {
      toast({ title: "工事を選択してください", variant: "destructive" });
      return;
    }
    await loadBudgetItemsForProject(projectId);
  };

  const updateItem = (idx: number, field: keyof InvoiceItem, value: string | number) => {
    setItems((prev) => {
      const next = [...prev];
      const it = { ...next[idx], [field]: value };
      if (field === "quantity" || field === "unitPrice") {
        it.amount = Math.round(Number(it.quantity) * Number(it.unitPrice));
      }
      next[idx] = it;
      return next;
    });
  };

  const addItem = () => setItems((prev) => [...prev, newItem(prev.length)]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const totals = calcTotals(items);

  // For progress billing, totalAmount is the manual entry (今回請求額 incl. tax)
  const progressAmountNum = parseFloat(progressAmount) || 0;

  const getEffectiveTotals = () => {
    if (billingType === "progress") {
      const taxExcluded = Math.round(progressAmountNum / 1.1);
      const tax = progressAmountNum - taxExcluded;
      return {
        taxExcludedAmount10: taxExcluded,
        taxAmount10: tax,
        taxExcludedAmount8: 0,
        taxAmount8: 0,
        taxExcludedTotal: taxExcluded,
        taxTotal: tax,
        totalAmount: progressAmountNum,
      };
    }
    return totals;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const effectiveTotals = getEffectiveTotals();
      const body = {
        invoiceDate,
        dueDate: dueDate || null,
        clientId,
        clientName: selectedClient?.name || "",
        clientAddress,
        projectId,
        projectName,
        invoiceRegistrationNumber: registrationNumber,
        notes,
        billingType,
        ...effectiveTotals,
      };

      let savedInvoice: Invoice;
      if (id) {
        const r = await fetch(`${BASE}/api/invoices/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error("Failed to update");
        savedInvoice = await r.json();
      } else {
        const r = await fetch(`${BASE}/api/invoices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error("Failed to create");
        savedInvoice = await r.json();
      }

      const itemsToSave = items.map((it, idx) => ({ ...it, rowIndex: idx }));

      const itemsR = await fetch(`${BASE}/api/invoices/${savedInvoice.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsToSave }),
      });
      if (!itemsR.ok) throw new Error("Failed to save items");

      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: id ? "更新しました" : "作成しました", description: `請求書 ${savedInvoice.invoiceNumber}` });
      if (!id) navigate(`/invoices/${savedInvoice.id}`);
    } catch {
      toast({ title: "保存に失敗しました", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddPayment = async () => {
    if (!id) return;
    if (!paymentForm.paymentDate || !paymentForm.amount) {
      toast({ title: "入金日と入金金額を入力してください", variant: "destructive" });
      return;
    }
    setAddingPayment(true);
    try {
      const r = await fetch(`${BASE}/api/invoices/${id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentDate: paymentForm.paymentDate,
          amount: parseFloat(paymentForm.amount),
          paymentMethod: paymentForm.paymentMethod,
          notes: paymentForm.notes,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      const result = await r.json();
      setPayments(result.payments);
      setInvoice(result.invoice);
      setPaymentForm({ paymentDate: today, amount: "", paymentMethod: "振込", notes: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "入金を登録しました" });
    } catch {
      toast({ title: "入金登録に失敗しました", variant: "destructive" });
    } finally {
      setAddingPayment(false);
    }
  };

  const handleDeletePayment = async (pid: number) => {
    if (!id) return;
    try {
      const r = await fetch(`${BASE}/api/invoices/${id}/payments/${pid}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      const result = await r.json();
      setPayments(result.payments);
      setInvoice(result.invoice);
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "入金を削除しました" });
    } catch {
      toast({ title: "削除に失敗しました", variant: "destructive" });
    }
  };

  const handlePDF = async () => {
    if (!invoice || !companySettings) {
      toast({ title: "PDFを生成できません", variant: "destructive" });
      return;
    }
    try {
      await generateInvoicePDF(invoice, items, companySettings);
    } catch {
      toast({ title: "PDF生成に失敗しました", variant: "destructive" });
    }
  };

  if (id && isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const currentInvoice = invoice || existingInvoice;
  const paidAmount = currentInvoice?.paidAmount ?? 0;
  const effectiveTotals = getEffectiveTotals();
  const totalAmount = effectiveTotals.totalAmount;
  const balance = totalAmount - paidAmount;

  // Progress billing KPI
  const progressRemainder = contractAmount - billedToDate - progressAmountNum;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/invoices">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              {id ? (currentInvoice?.invoiceNumber || "請求書詳細") : "新規請求書"}
            </h1>
            {registrationNumber && (
              <p className="text-xs text-slate-500">登録番号: {registrationNumber}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {id && (
            <>
              <Button
                variant="outline"
                onClick={() => window.open(`${BASE}/invoices/${id}/print`, "_blank")}
                className="gap-2"
              >
                <Printer className="w-4 h-4" />
                印刷
              </Button>
              <Button variant="outline" onClick={handlePDF} className="gap-2">
                <FileDown className="w-4 h-4" />
                PDF出力
              </Button>
            </>
          )}
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {id ? "更新する" : "作成する"}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* 基本情報 */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2 mb-4">基本情報</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>請求日 <span className="text-red-500">*</span></Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>入金期限</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <Label>請求先（得意先）</Label>
              <Select value={clientId ? String(clientId) : ""} onValueChange={handleClientChange}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="得意先を選択..." />
                </SelectTrigger>
                <SelectContent>
                  {clients?.items.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>請求先住所</Label>
              <Input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className="mt-1" placeholder="住所" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <Label>関連工事</Label>
              <Select value={projectId ? String(projectId) : ""} onValueChange={handleProjectChange}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="工事を選択..." />
                </SelectTrigger>
                <SelectContent>
                  {projects?.items.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.projectCode} - {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>工事名（手動入力）</Label>
              <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="mt-1" placeholder="工事名" />
            </div>
          </div>
          <div className="mt-4">
            <Label>適格請求書発行事業者登録番号</Label>
            <Input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} className="mt-1" placeholder="T1234567890123" />
          </div>
        </section>

        {/* 請求タイプ */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2 mb-4">請求タイプ</h2>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="billingType"
                value="full"
                checked={billingType === "full"}
                onChange={() => setBillingType("full")}
                className="w-4 h-4 text-primary"
              />
              <span className="text-sm font-medium text-slate-700">一括請求</span>
              <span className="text-xs text-slate-500">明細単位で金額を自由に編集できます</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="billingType"
                value="progress"
                checked={billingType === "progress"}
                onChange={() => setBillingType("progress")}
                className="w-4 h-4 text-primary"
              />
              <span className="text-sm font-medium text-slate-700">出来高請求</span>
              <span className="text-xs text-slate-500">契約金額に対する今回請求額を入力します</span>
            </label>
          </div>

          {/* Budget load button */}
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleLoadBudgetItems}
              disabled={!projectId || loadingBudget}
            >
              {loadingBudget ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              実行予算を読み込む
            </Button>
            {!projectId && (
              <p className="text-xs text-slate-400 mt-1">工事を選択すると実行予算明細を請求明細に展開できます</p>
            )}
          </div>
        </section>

        {/* 明細 */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2 mb-4">明細</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="min-w-[200px]">品名</TableHead>
                  <TableHead className="w-20 text-right">数量</TableHead>
                  <TableHead className="w-16">単位</TableHead>
                  <TableHead className="w-28 text-right">単価</TableHead>
                  <TableHead className="w-20">税率</TableHead>
                  <TableHead className="w-28 text-right">金額</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Input
                        value={it.itemName}
                        onChange={(e) => updateItem(idx, "itemName", e.target.value)}
                        placeholder="品名・内容"
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={it.quantity}
                        onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                        className="h-8 text-right"
                        min="0"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={it.unit}
                        onChange={(e) => updateItem(idx, "unit", e.target.value)}
                        className="h-8"
                        placeholder="式"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={it.unitPrice}
                        onChange={(e) => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                        className="h-8 text-right"
                        min="0"
                      />
                    </TableCell>
                    <TableCell>
                      <Select value={String(it.taxRate)} onValueChange={(v) => updateItem(idx, "taxRate", parseFloat(v))}>
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10%</SelectItem>
                          <SelectItem value="8">8%</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {fmt(it.amount)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-red-500"
                        onClick={() => removeItem(idx)}
                        disabled={items.length === 1}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={addItem}>
            <Plus className="w-3.5 h-3.5" />
            行を追加
          </Button>

          {/* 一括請求: 税率別集計 */}
          {billingType === "full" && (
            <div className="mt-6 border-t pt-4 space-y-2 max-w-sm ml-auto">
              {totals.taxExcludedAmount10 > 0 && (
                <>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>10%対象額</span>
                    <span>{fmt(totals.taxExcludedAmount10)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>消費税（10%）</span>
                    <span>{fmt(totals.taxAmount10)}</span>
                  </div>
                </>
              )}
              {totals.taxExcludedAmount8 > 0 && (
                <>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>8%対象額（軽減税率）</span>
                    <span>{fmt(totals.taxExcludedAmount8)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>消費税（8%）</span>
                    <span>{fmt(totals.taxAmount8)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-sm text-slate-600 border-t pt-2">
                <span>税抜合計</span>
                <span>{fmt(totals.taxExcludedTotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600">
                <span>消費税合計</span>
                <span>{fmt(totals.taxTotal)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-slate-800 border-t pt-2">
                <span>税込合計</span>
                <span className="text-primary">{fmt(totals.totalAmount)}</span>
              </div>
            </div>
          )}

          {/* 出来高請求: KPI パネル */}
          {billingType === "progress" && (
            <div className="mt-6 border-t pt-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">出来高状況</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">契約金額（実行予算総額）</p>
                  <p className="text-lg font-bold text-blue-700">{fmt(contractAmount)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">既請求額（累計）</p>
                  <p className="text-lg font-bold text-slate-700">{fmt(billedToDate)}</p>
                </div>
              </div>

              <div className="border rounded-lg p-4 bg-amber-50">
                <Label className="text-sm font-semibold text-slate-700">
                  今回請求額（税込） <span className="text-red-500">*</span>
                </Label>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-slate-500 text-sm">¥</span>
                  <Input
                    type="number"
                    value={progressAmount}
                    onChange={(e) => setProgressAmount(e.target.value)}
                    placeholder="0"
                    className="max-w-[200px]"
                    min="0"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">税込金額を直接入力してください（10%税率として計算されます）</p>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="bg-white border rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">今回請求額</p>
                  <p className="text-base font-bold text-amber-700">{fmt(progressAmountNum)}</p>
                </div>
                <div className={`border rounded-lg p-3 text-center ${progressRemainder >= 0 ? "bg-white" : "bg-red-50"}`}>
                  <p className="text-xs text-slate-500">残額</p>
                  <p className={`text-base font-bold ${progressRemainder >= 0 ? "text-slate-700" : "text-red-600"}`}>
                    {fmt(progressRemainder)}
                  </p>
                </div>
                <div className="bg-white border rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">出来高率</p>
                  <p className="text-base font-bold text-slate-700">
                    {contractAmount > 0 ? Math.round(((billedToDate + progressAmountNum) / contractAmount) * 100) : 0}%
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 備考 */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2 mb-4">備考</h2>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="備考・特記事項など" />
        </section>

        {/* 入金管理（詳細ページのみ） */}
        {id && (
          <section className="bg-white rounded-xl border p-6">
            <h2 className="text-base font-semibold text-slate-700 border-b pb-2 mb-4">入金管理</h2>

            {/* 残高サマリ */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">請求金額</p>
                <p className="text-lg font-bold text-slate-800">{fmt(totalAmount)}</p>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">入金済合計</p>
                <p className="text-lg font-bold text-emerald-700">{fmt(paidAmount)}</p>
              </div>
              <div className={`rounded-lg p-3 ${balance === 0 ? "bg-emerald-50" : "bg-amber-50"}`}>
                <p className="text-xs text-slate-500">残高</p>
                <p className={`text-lg font-bold ${balance === 0 ? "text-emerald-700" : "text-amber-700"}`}>{fmt(balance)}</p>
              </div>
            </div>

            {/* 入金履歴 */}
            {payments.length > 0 && (
              <div className="mb-4 overflow-hidden border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>入金日</TableHead>
                      <TableHead>入金方法</TableHead>
                      <TableHead className="text-right">金額</TableHead>
                      <TableHead>備考</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm">{p.paymentDate}</TableCell>
                        <TableCell className="text-sm">{p.paymentMethod}</TableCell>
                        <TableCell className="text-sm text-right font-medium">{fmt(p.amount)}</TableCell>
                        <TableCell className="text-sm text-slate-500">{p.notes}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-red-500"
                            onClick={() => handleDeletePayment(p.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* 入金登録フォーム */}
            <div className="border rounded-lg p-4 bg-slate-50">
              <p className="text-sm font-medium text-slate-700 mb-3">入金を登録する</p>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">入金日 <span className="text-red-500">*</span></Label>
                  <Input
                    type="date"
                    value={paymentForm.paymentDate}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, paymentDate: e.target.value }))}
                    className="mt-1 h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">金額 <span className="text-red-500">*</span></Label>
                  <Input
                    type="number"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                    className="mt-1 h-8"
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label className="text-xs">入金方法</Label>
                  <Select value={paymentForm.paymentMethod} onValueChange={(v) => setPaymentForm((f) => ({ ...f, paymentMethod: v }))}>
                    <SelectTrigger className="mt-1 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="振込">振込</SelectItem>
                      <SelectItem value="現金">現金</SelectItem>
                      <SelectItem value="手形">手形</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">備考</Label>
                  <Input
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                    className="mt-1 h-8"
                    placeholder="任意"
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button onClick={handleAddPayment} disabled={addingPayment} size="sm" className="gap-1.5">
                  {addingPayment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  入金登録
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
