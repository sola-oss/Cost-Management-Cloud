import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, FileText, Receipt, Printer } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  clientName: string;
  projectName: string;
  totalAmount: number;
  paidAmount: number;
  status: "unpaid" | "partial" | "paid";
}

async function fetchInvoices(): Promise<{ items: Invoice[] }> {
  const res = await fetch(`${BASE}/api/invoices`);
  if (!res.ok) throw new Error("Failed to fetch invoices");
  return res.json();
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
  if (status === "paid") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">入金済</Badge>;
  if (status === "partial") return <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">一部入金</Badge>;
  return <Badge className="bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100">未入金</Badge>;
}

function formatAmount(v: number) {
  return "¥" + v.toLocaleString("ja-JP");
}

function formatDate(v: string | null) {
  if (!v) return "—";
  return v.replace(/-/g, "/");
}

export default function InvoiceList() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/invoices"],
    queryFn: fetchInvoices,
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 p-2 rounded-lg">
            <Receipt className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">請求管理</h1>
            <p className="text-sm text-slate-500">請求書の発行・入金管理</p>
          </div>
        </div>
        <Link href="/invoices/new">
          <Button className="gap-2">
            <Plus className="w-4 h-4" />
            新規請求書
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : !data?.items.length ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">請求書がありません</p>
          <p className="text-slate-400 text-sm mt-1">「新規請求書」ボタンから作成してください</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>請求番号</TableHead>
                <TableHead>工事名</TableHead>
                <TableHead>得意先</TableHead>
                <TableHead>請求日</TableHead>
                <TableHead className="text-right">請求金額</TableHead>
                <TableHead>入金期限</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((inv) => (
                <TableRow key={inv.id} className="cursor-pointer hover:bg-slate-50">
                  <TableCell>
                    <Link href={`/invoices/${inv.id}`} className="text-primary font-medium hover:underline">
                      {inv.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{inv.projectName || "—"}</TableCell>
                  <TableCell className="text-slate-600">{inv.clientName || "—"}</TableCell>
                  <TableCell className="text-slate-600">{formatDate(inv.invoiceDate)}</TableCell>
                  <TableCell className="text-right font-medium">{formatAmount(inv.totalAmount)}</TableCell>
                  <TableCell className="text-slate-600">{formatDate(inv.dueDate)}</TableCell>
                  <TableCell><StatusBadge status={inv.status} /></TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-400 hover:text-slate-700"
                      title="印刷"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`${BASE}/invoices/${inv.id}/print`, "_blank");
                      }}
                    >
                      <Printer className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
