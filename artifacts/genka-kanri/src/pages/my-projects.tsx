import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { HardHat, ChevronDown, ChevronUp, AlertTriangle, Loader2 } from "lucide-react";
import { useStaffMembers } from "@/hooks/use-staff-members";
import { ProgressInput } from "@/components/progress-input";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const STORAGE_KEY = "cmc.myProjects.staffName";

// ─── 現場担当者向け「自分の現場の予算残」──────────────────────────────────────
//
// 現場に入力してもらうための仕掛け。入力させられるだけでは続かないが、
// 自分の現場の予算残が見えると自分のために入力するようになる。
// 原価管理の本来の目的（現場が予算を意識する）にも合う。

interface ProjectRow {
  id: number;
  projectCode: string;
  name: string;
  clientName: string;
  status: string;
  siteManager: string | null;
  contractAmount: number;
  totalBudget: number;
  totalActualCost: number;
  budgetUsageRate: number;
}

interface MonitorItem {
  workTypeCode: string;
  workTypeName: string;
  revisedBudget: number;
  orderedAmount: number;
  actualCost: number;
  budgetRemaining: number;
  consumptionRate: number | null;
}

// 消化率に応じた色。100%超＝予算オーバー
function rateTone(rate: number): { bar: string; text: string } {
  if (rate > 100) return { bar: "bg-red-500", text: "text-red-600" };
  if (rate >= 90) return { bar: "bg-amber-500", text: "text-amber-600" };
  return { bar: "bg-emerald-500", text: "text-emerald-600" };
}

function WorkTypeBreakdown({ projectId }: { projectId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/projects", projectId, "budget-items", "monitor"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/projects/${projectId}/budget-items/monitor`);
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<{ items: MonitorItem[] }>;
    },
  });

  if (isLoading) {
    return <div className="py-3 text-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>;
  }
  const items = (data?.items ?? []).filter((i) => i.revisedBudget !== 0 || i.actualCost !== 0);
  if (items.length === 0) {
    return <div className="py-3 text-center text-sm text-slate-400">実行予算がまだ登録されていません</div>;
  }

  return (
    <div className="border-t pt-3 space-y-2">
      {items.map((it) => {
        const rate = it.revisedBudget > 0 ? (it.actualCost / it.revisedBudget) * 100 : 0;
        const tone = rateTone(rate);
        const over = it.budgetRemaining < 0;
        return (
          <div key={it.workTypeName} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{it.workTypeName}</span>
              <span className={`tabular-nums whitespace-nowrap ${over ? "text-red-600 font-semibold" : "text-slate-600"}`}>
                残り {formatCurrency(it.budgetRemaining)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, rate)}%` }} />
              </div>
              <span className="text-xs text-slate-400 tabular-nums w-24 text-right">
                {formatCurrency(it.actualCost)} / {formatCurrency(it.revisedBudget)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MyProjects() {
  const { data: staff = [] } = useStaffMembers();
  const [name, setName] = useState<string>("");
  const [open, setOpen] = useState<Record<number, boolean>>({});

  // 毎回選ばせないよう、選んだ担当者を端末に覚えておく
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setName(saved);
  }, []);
  useEffect(() => {
    if (name) localStorage.setItem(STORAGE_KEY, name);
  }, [name]);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/projects", { siteManager: name }],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/projects?siteManager=${encodeURIComponent(name)}&limit=200`);
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<{ items: ProjectRow[] }>;
    },
    enabled: name !== "",
  });

  const projects = (data?.items ?? []).filter((p) => p.status !== "completed");
  const totalBudget = projects.reduce((s, p) => s + p.totalBudget, 0);
  const totalActual = projects.reduce((s, p) => s + p.totalActualCost, 0);
  const totalRemaining = totalBudget - totalActual;
  const overCount = projects.filter((p) => p.totalBudget > 0 && p.totalActualCost > p.totalBudget).length;

  const activeStaff = staff.filter((s) => s.isActive);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <HardHat className="w-6 h-6 text-primary" />
          自分の現場
        </h1>
        <p className="text-sm text-slate-500 mt-1">担当している工事の予算と、使った金額・残りを確認できます。</p>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">担当者</Label>
        <Select value={name} onValueChange={setName}>
          <SelectTrigger className="h-11"><SelectValue placeholder="自分の名前を選んでください" /></SelectTrigger>
          <SelectContent className="max-h-[300px]" searchPlaceholder="名前で検索">
            {activeStaff.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {name === "" ? (
        <Card><CardContent className="py-10 text-center text-slate-400 text-sm">
          名前を選ぶと、担当している工事が表示されます
        </CardContent></Card>
      ) : isLoading ? (
        <div className="py-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : projects.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-slate-400 text-sm">
          担当している施工中の工事がありません
        </CardContent></Card>
      ) : (
        <>
          {/* 合計 */}
          <Card className="bg-slate-50 border-none">
            <CardContent className="p-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-xs text-slate-500">実行予算</div>
                  <div className="text-base sm:text-lg font-bold tabular-nums">{formatCurrency(totalBudget)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">使った</div>
                  <div className="text-base sm:text-lg font-bold tabular-nums text-slate-700">{formatCurrency(totalActual)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">残り</div>
                  <div className={`text-base sm:text-lg font-bold tabular-nums ${totalRemaining < 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {formatCurrency(totalRemaining)}
                  </div>
                </div>
              </div>
              {overCount > 0 && (
                <div className="mt-3 flex items-center gap-1.5 text-xs text-red-600">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  予算を超えている工事が{overCount}件あります
                </div>
              )}
            </CardContent>
          </Card>

          {/* 工事ごと */}
          <div className="space-y-3">
            {projects.map((p) => {
              const rate = p.totalBudget > 0 ? (p.totalActualCost / p.totalBudget) * 100 : 0;
              const remaining = p.totalBudget - p.totalActualCost;
              const tone = rateTone(rate);
              const isOpen = open[p.id] ?? false;
              const noBudget = p.totalBudget === 0;
              return (
                <Card key={p.id} className={`border-l-4 ${noBudget ? "border-l-slate-300" : remaining < 0 ? "border-l-red-500" : "border-l-emerald-500"}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 leading-snug">{p.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          <span className="font-mono">{p.projectCode}</span>
                          {p.clientName ? ` ・ ${p.clientName}` : ""}
                        </div>
                      </div>
                      {noBudget ? (
                        <Badge variant="outline" className="text-xs shrink-0">予算未設定</Badge>
                      ) : (
                        <div className="text-right shrink-0">
                          <div className="text-xs text-slate-500">残り</div>
                          <div className={`font-bold tabular-nums ${remaining < 0 ? "text-red-600" : "text-emerald-600"}`}>
                            {formatCurrency(remaining)}
                          </div>
                        </div>
                      )}
                    </div>

                    {!noBudget && (
                      <div className="space-y-1">
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${tone.bar}`} style={{ width: `${Math.min(100, rate)}%` }} />
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 tabular-nums">
                          <span>使った {formatCurrency(p.totalActualCost)}</span>
                          <span className={rate > 100 ? tone.text + " font-semibold" : ""}>{Math.round(rate * 10) / 10}%</span>
                          <span>予算 {formatCurrency(p.totalBudget)}</span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [p.id]: !isOpen }))}
                        className="text-xs text-primary hover:underline underline-offset-2 flex items-center gap-1"
                      >
                        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        工種ごとの内訳を{isOpen ? "閉じる" : "見る"}
                      </button>
                      <Link href={`/projects/${p.id}/ledger`}>
                        <span className="text-xs text-slate-400 hover:text-primary underline underline-offset-2">工事台帳</span>
                      </Link>
                    </div>

                    <ProgressInput projectId={p.id} recordedBy={name} />

                    {isOpen && <WorkTypeBreakdown projectId={p.id} />}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
