import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

// ─── 出面表（でづらひょう）────────────────────────────────────────────────────
//
// 現行のExcel（工事ごとのシート）と同じ形：縦に社員、横に日、マスに人工。
// 早出・残業は既定では隠しておき、必要なときだけ出す（毎日は使わないため）。
//
// 金額は出さない。職人単価をシステムに持ってよいかが未確定のため（温品様へ確認中）。
// 日数さえ入っていれば、単価が決まった時点で金額は足せる。

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

type Staff = { id: number; code: string; name: string };
type Item = {
  staffMemberId: number;
  workDate: string;
  manDays: number;
  earlyCount: number;
  overtimeCount: number;
};
type Sheet = { month: string; days: number; staff: Staff[]; items: Item[] };

type Kind = "manDays" | "earlyCount" | "overtimeCount";
const KIND_LABEL: Record<Kind, string> = { manDays: "工数", earlyCount: "早出", overtimeCount: "残業" };

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const shiftMonth = (month: string, diff: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + diff, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const dateOf = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}`;
/** 数値だけ出す。0 は空欄にする（Excelと同じで、入っている日だけ見えるように） */
const show = (v: number) => (v === 0 ? "" : String(v));

export function AttendanceSheet({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [showExtra, setShowExtra] = useState(false);
  // 画面で編集中の値。キーは "社員ID|日付|種類"
  const [edits, setEdits] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["/api/attendances", projectId, month],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/attendances?projectId=${projectId}&month=${month}`);
      if (!r.ok) throw new Error("読み込みに失敗しました");
      return (await r.json()) as Sheet;
    },
    enabled: !!projectId,
  });

  // 工事全体（全期間）の合計。月をまたいで「誰が何日入ったか」を見るため
  const { data: summary } = useQuery({
    queryKey: ["/api/attendances/summary", projectId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/attendances/summary?projectId=${projectId}`);
      if (!r.ok) throw new Error("読み込みに失敗しました");
      return (await r.json()) as {
        items: Array<{ staffMemberId: number; name: string; manDays: number; earlyCount: number; overtimeCount: number }>;
        total: { manDays: number; earlyCount: number; overtimeCount: number };
      };
    },
    enabled: !!projectId,
  });

  // 月を替えたら編集中の値は捨てる（保存していないものを持ち越すと事故になる）
  useEffect(() => setEdits({}), [month, projectId]);

  const byCell = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of data?.items ?? []) m.set(`${it.staffMemberId}|${it.workDate}`, it);
    return m;
  }, [data]);

  const staff = data?.staff ?? [];
  const days = data?.days ?? 0;
  const [y, mo] = month.split("-").map(Number);

  const cellValue = (staffId: number, day: number, kind: Kind) => {
    const key = `${staffId}|${dateOf(month, day)}|${kind}`;
    if (key in edits) return edits[key];
    const it = byCell.get(`${staffId}|${dateOf(month, day)}`);
    return show(it ? it[kind] : 0);
  };

  const rowTotal = (staffId: number, kind: Kind) => {
    let sum = 0;
    for (let d = 1; d <= days; d++) sum += Number(cellValue(staffId, d, kind) || 0);
    return sum;
  };
  const dayTotal = (day: number) => {
    let sum = 0;
    for (const s of staff) sum += Number(cellValue(s.id, day, "manDays") || 0);
    return sum;
  };
  const grandTotal = staff.reduce((s, st) => s + rowTotal(st.id, "manDays"), 0);

  const save = useMutation({
    mutationFn: async () => {
      // 触ったマスだけをまとめて送る（1人・1日ぶんを1件にする）
      const touched = new Set(Object.keys(edits).map((k) => k.split("|").slice(0, 2).join("|")));
      const items = [...touched].map((key) => {
        const [staffId, workDate] = key.split("|");
        const day = Number(workDate.slice(-2));
        return {
          staffMemberId: Number(staffId),
          workDate,
          manDays: Number(cellValue(Number(staffId), day, "manDays") || 0),
          earlyCount: Number(cellValue(Number(staffId), day, "earlyCount") || 0),
          overtimeCount: Number(cellValue(Number(staffId), day, "overtimeCount") || 0),
        };
      });
      const r = await fetch(`${BASE}/api/attendances`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, items }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "保存に失敗しました");
      return items.length;
    },
    onSuccess: (n) => {
      setEdits({});
      qc.invalidateQueries({ queryKey: ["/api/attendances", projectId, month] });
      qc.invalidateQueries({ queryKey: ["/api/attendances/summary", projectId] });
      toast({ title: "保存しました", description: `${n}日ぶんを保存しました。` });
    },
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const dirty = Object.keys(edits).length > 0;
  const kinds: Kind[] = showExtra ? ["manDays", "earlyCount", "overtimeCount"] : ["manDays"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="text-sm font-semibold tabular-nums w-[92px] text-center">
          {y}年{mo}月
        </div>
        <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setMonth(thisMonth())} className="text-slate-500">
          今月
        </Button>

        <label className="flex items-center gap-1.5 text-xs text-slate-600 ml-2 cursor-pointer">
          <input type="checkbox" checked={showExtra} onChange={(e) => setShowExtra(e.target.checked)} />
          早出・残業も入力する
        </label>

        <Badge variant="outline" className="ml-auto bg-slate-50">
          この月の合計 {grandTotal} 人工
        </Badge>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          保存
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="sticky left-0 z-10 bg-slate-50 border-b border-r px-3 py-2 text-left font-medium w-[140px]">
                    社員
                  </th>
                  {showExtra && <th className="border-b border-r px-2 py-2 font-medium w-[52px]">種類</th>}
                  {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
                    const w = new Date(y, mo - 1, d).getDay();
                    return (
                      <th
                        key={d}
                        className={`border-b border-r px-0 py-1 w-[30px] font-normal ${
                          w === 0 ? "text-red-500 bg-red-50/40" : w === 6 ? "text-blue-500 bg-blue-50/40" : "text-slate-500"
                        }`}
                      >
                        <div className="tabular-nums">{d}</div>
                        <div className="text-[10px]">{WEEK[w]}</div>
                      </th>
                    );
                  })}
                  <th className="border-b px-2 py-2 font-medium w-[56px] bg-slate-100">合計</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={days + 3} className="px-3 py-6 text-center text-slate-400">
                      読み込んでいます…
                    </td>
                  </tr>
                )}
                {!isLoading && staff.length === 0 && (
                  <tr>
                    <td colSpan={days + 3} className="px-3 py-6 text-center text-slate-500">
                      社員が登録されていません。マスタ管理の「担当者マスタ」から登録してください。
                    </td>
                  </tr>
                )}
                {staff.map((st) =>
                  kinds.map((kind, ki) => (
                    <tr key={`${st.id}-${kind}`} className="hover:bg-slate-50/40">
                      {ki === 0 && (
                        <td
                          rowSpan={kinds.length}
                          className="sticky left-0 z-10 bg-white border-b border-r px-3 py-1.5 align-middle"
                        >
                          {st.name}
                        </td>
                      )}
                      {showExtra && (
                        <td className="border-b border-r px-2 py-1 text-[11px] text-slate-500 text-center">
                          {KIND_LABEL[kind]}
                        </td>
                      )}
                      {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
                        const w = new Date(y, mo - 1, d).getDay();
                        const key = `${st.id}|${dateOf(month, d)}|${kind}`;
                        return (
                          <td
                            key={d}
                            className={`border-b border-r p-0 ${w === 0 ? "bg-red-50/40" : w === 6 ? "bg-blue-50/40" : ""}`}
                          >
                            <input
                              inputMode="decimal"
                              value={cellValue(st.id, d, kind)}
                              onChange={(e) => {
                                const v = e.target.value;
                                // 数字と小数点だけ。かなが混ざると保存で落ちるため入口で弾く
                                if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
                                setEdits((prev) => ({ ...prev, [key]: v }));
                              }}
                              className={`w-[30px] h-7 text-center tabular-nums outline-none bg-transparent focus:bg-primary/10 ${
                                key in edits ? "text-primary font-semibold" : ""
                              }`}
                            />
                          </td>
                        );
                      })}
                      <td className="border-b px-2 py-1 text-right tabular-nums bg-slate-50 font-medium">
                        {rowTotal(st.id, kind) || ""}
                      </td>
                    </tr>
                  )),
                )}
                {staff.length > 0 && (
                  <tr className="bg-slate-100 font-medium">
                    <td className="sticky left-0 z-10 bg-slate-100 border-r px-3 py-1.5">合計（人工）</td>
                    {showExtra && <td className="border-r" />}
                    {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
                      <td key={d} className="border-r px-0 py-1 text-center tabular-nums text-xs">
                        {dayTotal(d) || ""}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums">{grandTotal || ""}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {summary && summary.items.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-slate-700 mb-2">
              この工事の合計（全期間） {summary.total.manDays} 人工
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {summary.items.map((it) => (
                <div key={it.staffMemberId} className="text-sm">
                  <span className="text-slate-600">{it.name}</span>
                  <span className="ml-1.5 font-medium tabular-nums">{it.manDays}</span>
                  <span className="text-xs text-slate-400 ml-0.5">人工</span>
                  {(it.earlyCount > 0 || it.overtimeCount > 0) && (
                    <span className="text-xs text-slate-400 ml-1">
                      （早出{it.earlyCount}・残業{it.overtimeCount}）
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-slate-500">
        1日を「1」、半日を「0.5」で入れます。空欄は0です。
        金額（人工 × 単価）は、職人単価の扱いが決まってから足します。
      </p>
    </div>
  );
}
