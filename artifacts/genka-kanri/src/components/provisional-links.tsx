import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { AlertTriangle, Link2, Link2Off } from "lucide-react";

// ─── 納品書（仮原価）と請求書（確定原価）の紐づけ ────────────────────────────
//
// 納品書が先に届いて仮原価を入れたあと、同じ仕事の請求書が届く。紐づけないと
// 仮原価がいつまでも「請求書待ち」のまま残る。金額はどちらも消さずに残し、
// 違っていたら差額を出す（おおつか様の依頼 4-1）。

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Candidate = {
  id: number;
  voucherNumber: string;
  vendorName: string;
  purchaseDate: string;
  totalAmount: number;
  sameVendor: boolean;
  difference: number;
};

type LinkRow = {
  id: number;
  voucherNumber: string;
  vendorName: string;
  purchaseDate: string;
  totalAmount: number;
  settledByInvoiceId: number | null;
  settledBy: {
    id: number;
    voucherNumber: string;
    purchaseDate: string;
    totalAmount: number;
    difference: number;
  } | null;
  candidates: Candidate[];
};

const NONE = "__none__";

export function ProvisionalLinks({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["/api/cost-stage-links", projectId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/cost-stage-links?projectId=${projectId}`);
      if (!r.ok) throw new Error("読み込みに失敗しました");
      return (await r.json()) as { items: LinkRow[] };
    },
    enabled: !!projectId,
  });

  const link = useMutation({
    mutationFn: async ({ id, target }: { id: number; target: number | null }) => {
      const r = await fetch(`${BASE}/api/cost-stage-links/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settledByInvoiceId: target }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "紐づけに失敗しました");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cost-stage-links", projectId] });
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/summary`] });
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
    },
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const rows = data?.items ?? [];
  if (rows.length === 0) return null;

  return (
    <Card className="border-amber-200">
      <CardHeader className="py-3 border-b bg-amber-50/50">
        <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-amber-600" />
          納品書と請求書の紐づけ
        </CardTitle>
        <p className="text-xs text-slate-500 mt-1">
          請求書が届いたら、どの納品書のものかを選びます。選ぶと「請求書待ち」から外れます。
          金額はどちらも記録に残ります。
        </p>
      </CardHeader>
      <CardContent className="p-0 divide-y">
        {rows.map((row) => (
          <div key={row.id} className="p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200">納品書</Badge>
              <span className="font-mono text-xs text-slate-400">{row.voucherNumber}</span>
              <span className="text-sm font-medium text-slate-800">{row.vendorName}</span>
              <span className="text-xs text-slate-500">{row.purchaseDate}</span>
              <span className="ml-auto text-sm font-semibold tabular-nums">{formatCurrency(row.totalAmount)}</span>
              <span className="text-[11px] text-slate-400">税抜</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 shrink-0">紐づける請求書</span>
              <Select
                value={row.settledByInvoiceId ? String(row.settledByInvoiceId) : NONE}
                onValueChange={(v) => link.mutate({ id: row.id, target: v === NONE ? null : Number(v) })}
              >
                <SelectTrigger className="text-sm max-w-[420px]">
                  <SelectValue placeholder="請求書を選ぶ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-slate-400">（まだ紐づけない）</SelectItem>
                  {row.candidates.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.vendorName} ／ {c.purchaseDate} ／ {formatCurrency(c.totalAmount)}
                      {c.difference !== 0 ? `（差額 ${c.difference > 0 ? "+" : ""}${formatCurrency(c.difference)}）` : "（同額）"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {row.settledByInvoiceId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-500"
                  onClick={() => link.mutate({ id: row.id, target: null })}
                >
                  <Link2Off className="w-3.5 h-3.5 mr-1" />
                  外す
                </Button>
              )}
            </div>

            {row.candidates.length === 0 && !row.settledByInvoiceId && (
              <p className="text-xs text-slate-400">
                この工事に、まだ紐づけられる請求書がありません。請求書を登録すると候補に出ます。
              </p>
            )}

            {row.settledBy && (
              row.settledBy.difference === 0 ? (
                <p className="text-xs text-emerald-700">
                  請求書（{row.settledBy.voucherNumber}）と同額です。
                </p>
              ) : (
                <p className="text-xs text-destructive flex items-start gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                  <span>
                    納品書 {formatCurrency(row.totalAmount)} に対して、請求書は{" "}
                    {formatCurrency(row.settledBy.totalAmount)}。
                    <b className="ml-1">
                      差額 {row.settledBy.difference > 0 ? "+" : ""}
                      {formatCurrency(row.settledBy.difference)}
                    </b>
                    （工事の原価に入るのは請求書の金額です）
                  </span>
                </p>
              )
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
