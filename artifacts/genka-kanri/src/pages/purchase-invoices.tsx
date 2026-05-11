import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Plus } from "lucide-react";

// ── 型定義 ──────────────────────────────────────────────────────────────────
interface PurchaseInvoice {
  id: number;
  voucherNumber: string;
  projectId: number;
  vendorId: number;
  purchaseDate: string;
  paymentDueDate: string | null;
  status: string;
  isProvisional: boolean;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  vendorName: string;
  projectCode: string;
  projectName: string;
  createdAt: string;
}

interface VendorItem {
  id: number;
  name: string;
}

// ── 定数 ────────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  provisional: "仮確定",
  confirmed: "確定",
  assessed: "査定済",
  paid: "支払済",
  cancelled: "キャンセル",
};

const STATUS_COLORS: Record<string, string> = {
  provisional: "bg-amber-100 text-amber-700 border-amber-200",
  confirmed:   "bg-blue-100 text-blue-700 border-blue-200",
  assessed:    "bg-purple-100 text-purple-700 border-purple-200",
  paid:        "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled:   "bg-red-100 text-red-700 border-red-200",
};

function fmt(n: number): string {
  return n.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
}

// ── hooks ───────────────────────────────────────────────────────────────────
function usePurchaseInvoices(projectId: string, status: string) {
  const params = new URLSearchParams();
  const pId = projectId !== "__all__" ? projectId : "";
  const pStatus = status !== "__all__" ? status : "";
  if (pId) params.set("projectId", pId);
  if (pStatus) params.set("status", pStatus);
  return useQuery({
    queryKey: ["/api/purchase-invoices", projectId, status],
    queryFn: async () => {
      const res = await fetch(`/api/purchase-invoices?${params.toString()}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ items: PurchaseInvoice[]; total: number }>;
    },
  });
}

function useVendors() {
  return useQuery({
    queryKey: ["/api/vendors"],
    queryFn: async () => {
      const res = await fetch("/api/vendors");
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ items: VendorItem[] }>;
    },
  });
}

// ── メインコンポーネント ──────────────────────────────────────────────────────
export default function PurchaseInvoices() {
  const [filterProject, setFilterProject] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");

  const { data: projectsData } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = projectsData?.items ?? [];
  const { data: invoicesData, isLoading } = usePurchaseInvoices(filterProject, filterStatus);
  const invoices = invoicesData?.items ?? [];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-teal-700" />
          <h1 className="text-xl font-bold text-slate-900">仕入伝票一覧</h1>
          {invoicesData && (
            <span className="text-sm text-slate-500">{invoicesData.total}件</span>
          )}
        </div>
        <Link href="/purchases">
          <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white">
            <Plus className="w-4 h-4 mr-1" />
            仕入入力
          </Button>
        </Link>
      </div>

      {/* フィルター */}
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

      {/* 一覧テーブル */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 text-xs">
                <TableHead className="font-medium">伝票番号</TableHead>
                <TableHead className="font-medium">工事</TableHead>
                <TableHead className="font-medium">仕入先</TableHead>
                <TableHead className="font-medium">仕入日</TableHead>
                <TableHead className="font-medium">支払予定日</TableHead>
                <TableHead className="font-medium">状態</TableHead>
                <TableHead className="font-medium text-right">合計金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-400">読み込み中...</TableCell>
                </TableRow>
              ) : invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-400">
                    仕入伝票がありません。仕入入力から登録してください。
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((inv) => (
                  <TableRow key={inv.id} className="hover:bg-slate-50/60">
                    <TableCell className="font-mono text-sm text-teal-700 font-medium">
                      {inv.voucherNumber}
                      {inv.isProvisional && (
                        <Badge variant="outline" className="ml-2 text-[10px] text-amber-600 border-amber-400 bg-amber-50">仮</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{inv.projectCode}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[160px]">{inv.projectName}</div>
                    </TableCell>
                    <TableCell className="text-sm">{inv.vendorName}</TableCell>
                    <TableCell className="text-sm text-slate-600">{inv.purchaseDate}</TableCell>
                    <TableCell className="text-sm text-slate-500">{inv.paymentDueDate ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[inv.status] ?? ""}`}>
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-sm">
                      {fmt(inv.totalAmount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
