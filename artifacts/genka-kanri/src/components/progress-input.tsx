import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── 出来高（進捗率）の入力 ──────────────────────────────────────────────────
//
// 5%刻み。1%刻みは考えすぎて手が止まるため。
// 「なんとなく65%」を防ぐため、原価消化率・前回値・予算残を必ず横に出す。
// 前回より下げるときは理由を必須にする（単調増加のガード）。

interface ProgressData {
  yearMonth: string;
  currentRate: number | null;
  previousRate: number | null;
  previousYearMonth: string | null;
  totalBudget: number;
  totalActualCost: number;
  budgetRemaining: number;
  costConsumptionRate: number | null;
}

export function ProgressInput({ projectId, recordedBy }: { projectId: number; recordedBy?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rate, setRate] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [needReason, setNeedReason] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/projects", projectId, "progress"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/projects/${projectId}/progress`);
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<ProgressData>;
    },
  });

  useEffect(() => {
    if (data && rate === null) setRate(data.currentRate ?? data.previousRate ?? 0);
  }, [data, rate]);

  const save = useMutation({
    mutationFn: async (allowDecrease: boolean) => {
      const r = await fetch(`${BASE}/api/projects/${projectId}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progressRate: rate, note: note || null, recordedBy: recordedBy ?? null, allowDecrease }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.requiresReason) { setNeedReason(true); throw new Error(j.message ?? "理由を入力してください"); }
        throw new Error(j.message ?? "保存に失敗しました");
      }
      return j;
    },
    onSuccess: () => {
      toast({ title: "登録しました", description: `今月の出来高を ${rate}% で記録しました。` });
      setNeedReason(false);
      setNote("");
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "progress"] });
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
    },
    onError: (e) => toast({ title: "保存できません", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="py-3 text-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>;
  }

  const shown = rate ?? 0;
  const cost = data.costConsumptionRate;
  // 進捗より原価が先行していれば注意（例：進捗40%で原価60%）
  const behind = cost != null && cost - shown >= 10;
  const decreasing = data.previousRate != null && shown < data.previousRate;
  const alreadySaved = data.currentRate != null && data.currentRate === shown && !save.isPending;

  return (
    <div className="border-t pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-primary" />
          今月の出来高（{data.yearMonth}）
        </span>
        {data.currentRate != null && (
          <span className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />入力済 {data.currentRate}%
          </span>
        )}
      </div>

      {/* スライダー（5%刻み） */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-slate-400">0%</span>
          <span className="text-2xl font-bold tabular-nums text-slate-900">{shown}%</span>
          <span className="text-xs text-slate-400">100%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={shown}
          onChange={(e) => setRate(Number(e.target.value))}
          className="w-full accent-primary h-2 cursor-pointer"
        />
      </div>

      {/* 判断の材料。これが無いと入力が当てずっぽうになる */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs bg-slate-50 rounded-md py-2">
        <div>
          <div className="text-slate-500">前回</div>
          <div className="font-semibold tabular-nums">
            {data.previousRate != null ? `${data.previousRate}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-slate-500">原価消化率</div>
          <div className={`font-semibold tabular-nums ${behind ? "text-amber-600" : ""}`}>
            {cost != null ? `${cost}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-slate-500">予算残</div>
          <div className={`font-semibold tabular-nums ${data.budgetRemaining < 0 ? "text-red-600" : ""}`}>
            {formatCurrency(data.budgetRemaining)}
          </div>
        </div>
      </div>

      {behind && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          出来高{shown}%に対して原価は{cost}%使っています。予算より原価が先行しています。
        </p>
      )}

      {(needReason || decreasing) && (
        <div className="space-y-1">
          <label className="text-xs text-amber-700">
            前回（{data.previousYearMonth}）の{data.previousRate}%より低いため、理由が必要です
          </label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：手直しが発生したため" className="h-9 text-sm" />
        </div>
      )}

      <Button
        className="w-full h-10"
        disabled={save.isPending || alreadySaved || ((needReason || decreasing) && !note.trim())}
        onClick={() => save.mutate(decreasing || needReason)}
      >
        {save.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        {alreadySaved ? "登録済み" : "この出来高で登録"}
      </Button>
    </div>
  );
}
