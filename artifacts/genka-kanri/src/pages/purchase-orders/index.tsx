import { useState, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Plus, Trash2, Save, FileText, ChevronRight } from "lucide-react";

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
  createdAt: string;
  items?: PurchaseOrderItem[];
}

interface VendorItem {
  id: number;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  ordered: "発注済",
  partial: "一部納品",
  completed: "完納",
  cancelled: "キャンセル",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  ordered: "bg-blue-100 text-blue-700 border-blue-200",
  partial: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

const CATEGORY_OPTIONS = [
  { code: "620", name: "外注費", value: "subcontract" },
  { code: "610", name: "材料費", value: "material" },
  { code: "630", name: "労務費", value: "labor" },
  { code: "640", name: "経費",   value: "expense" },
];

function fmt(n: number): string {
  return n.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
}

function usePurchaseOrders(projectId: string, status: string) {
  const params = new URLSearchParams();
  const pId = projectId !== "__all__" ? projectId : "";
  const pStatus = status !== "__all__" ? status : "";
  if (pId) params.set("projectId", pId);
  if (pStatus) params.set("status", pStatus);
  return useQuery({
    queryKey: ["/api/purchase-orders", projectId, status],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/purchase-orders?${params.toString()}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ items: PurchaseOrder[]; total: number }>;
    },
  });
}

function useVendors() {
  return useQuery({
    queryKey: ["/api/vendors"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/vendors`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ items: VendorItem[] }>;
    },
  });
}

interface ItemRow {
  id: string;
  categoryValue: string;
  description: string;
  specification: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: number;
  taxRate: number;
}

function createItemRow(): ItemRow {
  return {
    id: crypto.randomUUID(),
    categoryValue: "subcontract",
    description: "",
    specification: "",
    quantity: "1",
    unit: "式",
    unitPrice: "",
    amount: 0,
    taxRate: 10,
  };
}

function recalcItem(row: ItemRow): ItemRow {
  const q = parseFloat(row.quantity) || 0;
  const u = parseFloat(row.unitPrice) || 0;
  return { ...row, amount: Math.floor(q * u) };
}

export default function PurchaseOrders() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterProject, setFilterProject] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: projectsData } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = projectsData?.items ?? [];
  const { data: vendorsData } = useVendors();
  const vendors = vendorsData?.items ?? [];
  const { data: ordersData, isLoading } = usePurchaseOrders(filterProject, filterStatus);
  const orders = ordersData?.items ?? [];

  const [formProjectId, setFormProjectId] = useState("");
  const [formVendorId, setFormVendorId] = useState("");
  const [formOrderDate, setFormOrderDate] = useState(new Date().toISOString().split("T")[0]);
  const [formDeliveryDate, setFormDeliveryDate] = useState("");
  const [formStatus, setFormStatus] = useState("ordered");
  const [formNotes, setFormNotes] = useState("");
  const [formRows, setFormRows] = useState<ItemRow[]>([createItemRow()]);

  const handleRowChange = useCallback((idx: number, field: keyof ItemRow, value: string | number) => {
    setFormRows((prev) => {
      const next = [...prev];
      let row: ItemRow = { ...next[idx], [field]: value };
      if (["quantity", "unitPrice"].includes(field as string)) row = recalcItem(row);
      next[idx] = row;
      return next;
    });
  }, []);

  const addRow = () => setFormRows((p) => [...p, createItemRow()]);
  const delRow = (idx: number) => setFormRows((p) => p.length === 1 ? [createItemRow()] : p.filter((_, i) => i !== idx));

  const totalAmount = formRows.reduce((s, r) => s + r.amount, 0);
  const totalTax    = formRows.reduce((s, r) => s + Math.floor(r.amount * r.taxRate / 100), 0);

  const resetForm = () => {
    setFormProjectId("");
    setFormVendorId("");
    setFormOrderDate(new Date().toISOString().split("T")[0]);
    setFormDeliveryDate("");
    setFormStatus("ordered");
    setFormNotes("");
    setFormRows([createItemRow()]);
  };

  const handleCreate = async () => {
    if (!formProjectId || !formVendorId) {
      toast({ title: "入力エラー", description: "工事と仕入先は必須です。", variant: "destructive" });
      return;
    }
    const validRows = formRows.filter((r) => r.description.trim());
    if (validRows.length === 0) {
      toast({ title: "入力エラー", description: "明細を1件以上入力してください。", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/purchase-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: parseInt(formProjectId),
          vendorId: parseInt(formVendorId),
          orderDate: formOrderDate,
          expectedDeliveryDate: formDeliveryDate || null,
          status: formStatus,
          notes: formNotes || null,
          items: validRows.map((r, idx) => ({
            lineNumber: idx + 1,
            category: r.categoryValue,
            description: r.description,
            specification: r.specification || null,
            quantity: parseFloat(r.quantity) || 1,
            unit: r.unit,
            unitPrice: parseFloat(r.unitPrice) || 0,
            amount: r.amount,
            taxRate: r.taxRate,
          })),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const order = await res.json() as PurchaseOrder;
      toast({ title: "登録完了", description: `発注書 ${order.orderNumber} を登録しました。` });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      setCreateOpen(false);
      resetForm();
    } catch {
      toast({ title: "登録エラー", description: "登録に失敗しました。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number, num: string) => {
    e.stopPropagation();
    if (!window.confirm(`発注書 ${num} を削除しますか？`)) return;
    try {
      await fetch(`${BASE}/api/purchase-orders/${id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "削除しました" });
    } catch {
      toast({ title: "削除失敗", variant: "destructive" });
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-5 h-5 text-teal-700" />
          <h1 className="text-xl font-bold text-slate-900">発注書一覧</h1>
          {ordersData && (
            <span className="text-sm text-slate-500">{ordersData.total}件</span>
          )}
        </div>
        <Button
          size="sm"
          className="bg-teal-600 hover:bg-teal-700 text-white"
          onClick={() => { resetForm(); setCreateOpen(true); }}
        >
          <Plus className="w-4 h-4 mr-1" />
          新規発注書
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">工事</Label>
              <Select value={filterProject} onValueChange={setFilterProject}>
                <SelectTrigger className="w-56 text-sm h-8">
                  <SelectValue placeholder="すべての工事" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">すべての工事</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.projectCode} {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">ステータス</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36 text-sm h-8">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">すべて</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 text-xs">
                <TableHead className="font-medium">発注番号</TableHead>
                <TableHead className="font-medium">工事</TableHead>
                <TableHead className="font-medium">仕入先</TableHead>
                <TableHead className="font-medium">発注日</TableHead>
                <TableHead className="font-medium">状態</TableHead>
                <TableHead className="font-medium text-right">合計金額</TableHead>
                <TableHead className="font-medium text-center w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-400">読み込み中...</TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-400">発注書がありません</TableCell>
                </TableRow>
              ) : (
                orders.map((order) => (
                  <TableRow
                    key={order.id}
                    className="hover:bg-slate-50/60 cursor-pointer group"
                    onClick={() => { window.location.href = `${BASE}/purchase-orders/${order.id}`; }}
                  >
                    <TableCell className="font-mono text-sm text-teal-700 font-medium">
                      {order.orderNumber}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{order.projectCode}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[160px]">{order.projectName}</div>
                    </TableCell>
                    <TableCell className="text-sm">{order.vendorName}</TableCell>
                    <TableCell className="text-sm text-slate-600">{order.orderDate}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[order.status] ?? ""}`}>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-sm">
                      {fmt(order.totalAmount)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleDelete(e, order.id, order.orderNumber)}
                          className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                          title="削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <Link href={`/purchase-orders/${order.id}`} onClick={(e) => e.stopPropagation()}>
                          <button className="p-1.5 rounded hover:bg-teal-50 text-slate-400 hover:text-teal-600">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              新規発注書
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">工事 <span className="text-red-500">*</span></Label>
                <Select value={formProjectId} onValueChange={setFormProjectId}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="工事を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.projectCode} {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">仕入先 <span className="text-red-500">*</span></Label>
                <Select value={formVendorId} onValueChange={setFormVendorId}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="仕入先を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">発注日</Label>
                <Input type="date" value={formOrderDate} onChange={(e) => setFormOrderDate(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">納期予定</Label>
                <Input type="date" value={formDeliveryDate} onChange={(e) => setFormDeliveryDate(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">ステータス</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">下書き</SelectItem>
                    <SelectItem value="ordered">発注済</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">備考</Label>
                <Input value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="備考" className="text-sm" />
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="bg-teal-700 px-4 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-white">明細</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-white hover:bg-teal-600 text-xs" onClick={addRow}>
                  <Plus className="w-3 h-3 mr-1" />行を追加
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b">
                      <th className="px-2 py-2 text-center w-8">No</th>
                      <th className="px-2 py-2 text-left w-28">科目</th>
                      <th className="px-2 py-2 text-left">品名・摘要</th>
                      <th className="px-2 py-2 text-right w-20">数量</th>
                      <th className="px-2 py-2 text-center w-14">単位</th>
                      <th className="px-2 py-2 text-right w-28">単価</th>
                      <th className="px-2 py-2 text-right w-28">金額</th>
                      <th className="px-2 py-2 text-center w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formRows.map((row, idx) => (
                      <tr key={row.id} className="border-b border-slate-100">
                        <td className="px-2 py-1 text-center text-slate-400">{idx + 1}</td>
                        <td className="px-1 py-1">
                          <Select value={row.categoryValue} onValueChange={(v) => handleRowChange(idx, "categoryValue", v)}>
                            <SelectTrigger className="h-7 text-xs border-slate-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORY_OPTIONS.map((c) => (
                                <SelectItem key={c.value} value={c.value} className="text-xs">
                                  {c.code} {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            value={row.description}
                            onChange={(e) => handleRowChange(idx, "description", e.target.value)}
                            placeholder="品名"
                            className="h-7 text-xs mb-0.5"
                          />
                          <Input
                            value={row.specification}
                            onChange={(e) => handleRowChange(idx, "specification", e.target.value)}
                            placeholder="仕様"
                            className="h-6 text-xs text-slate-500"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            type="number"
                            value={row.quantity}
                            onChange={(e) => handleRowChange(idx, "quantity", e.target.value)}
                            className="h-7 text-xs text-right"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            value={row.unit}
                            onChange={(e) => handleRowChange(idx, "unit", e.target.value)}
                            className="h-7 text-xs text-center"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            type="number"
                            value={row.unitPrice}
                            onChange={(e) => handleRowChange(idx, "unitPrice", e.target.value)}
                            className="h-7 text-xs text-right"
                          />
                        </td>
                        <td className="px-2 py-1 text-right font-medium">
                          {row.amount.toLocaleString()}
                        </td>
                        <td className="px-1 py-1 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-slate-400 hover:text-red-500"
                            onClick={() => delRow(idx)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t bg-slate-50 px-4 py-2 flex justify-end gap-6 text-sm">
                <span className="text-slate-500">小計</span>
                <span className="font-medium">{totalAmount.toLocaleString()}</span>
                <span className="text-slate-500">消費税</span>
                <span className="font-medium">{totalTax.toLocaleString()}</span>
                <span className="text-slate-700 font-semibold">合計</span>
                <span className="font-bold text-teal-700">{fmt(totalAmount + totalTax)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>キャンセル</Button>
              <Button
                className="bg-teal-600 hover:bg-teal-700 text-white"
                onClick={handleCreate}
                disabled={saving}
              >
                {saving ? "登録中..." : (
                  <><Save className="w-4 h-4 mr-1" />登録</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
