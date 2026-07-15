import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer, Trash2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useWorkTypes } from "@/hooks/use-work-types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PurchaseOrderItem {
  id: number;
  lineNumber: number;
  category: string;
  workTypeId: number | null;
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
  items: PurchaseOrderItem[];
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

const CATEGORY_MAP: Record<string, string> = {
  material: "材料費",
  labor: "労務費",
  subcontract: "外注費",
  expense: "経費",
};

function fmt(n: number): string {
  return n.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${y}/${m}/${day}`;
}

export default function PurchaseOrderDetail({ id }: { id: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const { data: order, isLoading } = useQuery<PurchaseOrder>({
    queryKey: ["/api/purchase-orders", id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/purchase-orders/${id}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const { data: workTypes = [] } = useWorkTypes<{ id: number; name: string }>();
  const workTypeName = (id: number | null) =>
    id ? workTypes.find((w) => w.id === id)?.name ?? "—" : "—";

  const handleStatusChange = async (status: string) => {
    setUpdatingStatus(true);
    try {
      const res = await fetch(`${BASE}/api/purchase-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "ステータスを更新しました" });
    } catch {
      toast({ title: "更新失敗", variant: "destructive" });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDelete = async () => {
    if (!order) return;
    const linkedInvoices = (order as any).linkedInvoiceCount ?? 0;
    const message = linkedInvoices > 0
      ? `この発注書には仕入伝票が ${linkedInvoices} 件紐づいています。\n削除すると仕入伝票との紐付けが外れます（仕入伝票・実績原価は残ります）。\n\n発注書 ${order.orderNumber} を削除しますか？`
      : `発注書 ${order.orderNumber} を削除しますか？`;
    if (!window.confirm(message)) return;
    try {
      await fetch(`${BASE}/api/purchase-orders/${id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "削除しました" });
      navigate("/purchase-orders");
    } catch {
      toast({ title: "削除失敗", variant: "destructive" });
    }
  };

  const handlePrint = () => {
    window.open(`${BASE}/purchase-orders/${id}/print`, "_blank");
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center text-slate-400">
        読み込み中…
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6 flex items-center justify-center text-red-500">
        発注書が見つかりません
      </div>
    );
  }

  const items = order.items ?? [];
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxAmount = items.reduce((s, i) => s + Math.floor(i.amount * i.taxRate / 100), 0);
  const total = subtotal + taxAmount;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/purchase-orders">
            <button className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 text-sm">
              <ArrowLeft className="w-4 h-4" />
              一覧に戻る
            </button>
          </Link>
          <ClipboardList className="w-5 h-5 text-teal-700" />
          <h1 className="text-xl font-bold text-slate-900">{order.orderNumber}</h1>
          <Badge variant="outline" className={`text-xs ${STATUS_COLORS[order.status] ?? ""}`}>
            {STATUS_LABELS[order.status] ?? order.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-teal-300 text-teal-700 hover:bg-teal-50"
            onClick={handlePrint}
          >
            <Printer className="w-4 h-4" />
            印刷 / PDF
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-500 hover:bg-red-50 gap-1.5"
            onClick={handleDelete}
          >
            <Trash2 className="w-4 h-4" />
            削除
          </Button>
        </div>
      </div>

      {/* 基本情報 */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-semibold text-slate-700">発注情報</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm">
            <div>
              <div className="text-xs text-slate-500 mb-0.5">発注番号</div>
              <div className="font-mono font-medium text-teal-700">{order.orderNumber}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">工事</div>
              <div>
                <span className="font-medium">{order.projectCode}</span>
                <span className="text-slate-500 ml-1 text-xs">{order.projectName}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">仕入先</div>
              <div className="font-medium">{order.vendorName}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">発注日</div>
              <div>{fmtDate(order.orderDate)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">納期予定</div>
              <div>{fmtDate(order.expectedDeliveryDate)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">ステータス</div>
              <div className="flex items-center gap-2">
                <Select
                  value={order.status}
                  onValueChange={handleStatusChange}
                  disabled={updatingStatus}
                >
                  <SelectTrigger className="h-7 text-xs w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {order.notes && (
              <div className="col-span-2 md:col-span-3">
                <div className="text-xs text-slate-500 mb-0.5">備考</div>
                <div className="text-slate-700 whitespace-pre-wrap">{order.notes}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 明細 */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-semibold text-slate-700">
            発注明細
            <span className="ml-2 text-xs font-normal text-slate-400">{items.length}件</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 text-xs">
                  <TableHead className="w-10 text-center font-medium">No.</TableHead>
                  <TableHead className="font-medium w-24">科目</TableHead>
                  <TableHead className="font-medium w-24">工種</TableHead>
                  <TableHead className="font-medium">品名・摘要</TableHead>
                  <TableHead className="font-medium text-right w-20">数量</TableHead>
                  <TableHead className="font-medium text-center w-14">単位</TableHead>
                  <TableHead className="font-medium text-right w-28">単価</TableHead>
                  <TableHead className="font-medium text-center w-16">税率</TableHead>
                  <TableHead className="font-medium text-right w-28">金額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-slate-400 text-sm">
                      明細がありません
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item, idx) => (
                    <TableRow key={item.id} className={idx % 2 === 1 ? "bg-slate-50/50" : ""}>
                      <TableCell className="text-center text-xs text-slate-400">{item.lineNumber}</TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {CATEGORY_MAP[item.category] ?? item.category}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {workTypeName(item.workTypeId)}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{item.description}</div>
                        {item.specification && (
                          <div className="text-xs text-slate-400">{item.specification}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm">{item.quantity.toLocaleString()}</TableCell>
                      <TableCell className="text-center text-sm">{item.unit}</TableCell>
                      <TableCell className="text-right text-sm">{item.unitPrice.toLocaleString()}</TableCell>
                      <TableCell className="text-center text-xs text-slate-500">{item.taxRate}%</TableCell>
                      <TableCell className="text-right text-sm font-medium">{item.amount.toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* 合計 */}
          <div className="border-t bg-slate-50 px-4 py-3">
            <div className="flex justify-end gap-8 text-sm">
              <div className="space-y-1 text-right">
                <div className="flex gap-6">
                  <span className="text-slate-500">小計</span>
                  <span className="font-medium w-28 text-right">{subtotal.toLocaleString()}</span>
                </div>
                <div className="flex gap-6">
                  <span className="text-slate-500">消費税</span>
                  <span className="font-medium w-28 text-right">{taxAmount.toLocaleString()}</span>
                </div>
                <div className="flex gap-6 border-t pt-1 mt-1">
                  <span className="font-semibold text-slate-700">合計（税込）</span>
                  <span className="font-bold text-teal-700 w-28 text-right">{fmt(total)}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
