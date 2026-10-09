import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DepartmentPicker } from "@/components/department-picker";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * 仮登録の工事を本登録にするダイアログ。
 *
 * 新しく作り直さずに格上げするので、仮登録中に紐づけた書類・原価はそのまま残る。
 * 部門は現場担当者が決める（追加依頼4）。ここで部門を選ぶことが本登録の条件。
 * 得意先・工事場所などの細かい項目は、本登録のあと通常の「編集」から足す。
 */
export function PromoteProjectDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  // ①元請注文書から入った値（請負金額・工期）があれば最初から入れておく。打ち直させない
  project: { id: number; name: string; contractAmount?: number | null; startDate?: string | null; endDate?: string | null };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [managementType, setManagementType] = useState<"normal" | "small">("normal");
  const [department, setDepartment] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  const fromOrder = (project.contractAmount ?? 0) > 0;

  useEffect(() => {
    if (open) {
      const amount = project.contractAmount ?? 0;
      // 区分の線引きは税込100万（新規工事登録と同じ）。決め切らず、選び直せる初期値にする
      setManagementType(fromOrder && amount <= 1_000_000 ? "small" : "normal");
      setDepartment("");
      setContractAmount(fromOrder ? String(amount) : "");
      setStartDate(fromOrder && project.startDate ? project.startDate : today);
      setEndDate(fromOrder && project.endDate ? project.endDate : "");
    }
  }, [open]);

  const handleSave = async () => {
    if (!department) {
      toast({ title: "部門を選んでください", variant: "destructive" });
      return;
    }
    const amount = parseFloat(contractAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "請負金額を入力してください", variant: "destructive" });
      return;
    }
    if (managementType === "normal" && (!startDate || !endDate)) {
      toast({ title: "着工日と竣工予定日を入力してください", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/projects/${project.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department,
          managementType,
          contractAmount: amount,
          startDate: managementType === "normal" ? startDate : undefined,
          endDate: managementType === "normal" ? endDate : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "本登録に失敗しました");
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("/projects") });
      toast({ title: "本登録しました", description: `工事番号 ${body.projectCode}` });
      onClose();
    } catch (err) {
      toast({ title: "本登録できませんでした", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>本登録する</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-slate-500 bg-slate-50 rounded px-2.5 py-2 leading-relaxed">
            「{project.name}」を正式な工事にします。仮登録中に紐づけた書類・原価はそのまま残ります。
            工事番号は正式な番号に変わり、会社全体の合計・粗利に入るようになります。
          </p>
          {fromOrder && (
            <p className="text-xs text-teal-700">
              請負金額と工期は注文書から入れてあります。違っていれば直してください。
            </p>
          )}
          <div>
            <Label>区分</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {([
                ["normal", "通常の工事", "100万円を超える"],
                ["small", "小口工事", "100万円以下"],
              ] as const).map(([v, label, hint]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setManagementType(v)}
                  aria-pressed={managementType === v}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors",
                    managementType === v
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-200 text-slate-700 hover:border-primary/50",
                  )}
                >
                  <div className="text-sm font-semibold">{label}</div>
                  <div className="text-xs text-slate-500">{hint}（税込）</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>部門 <span className="text-destructive">*</span></Label>
            <DepartmentPicker className="mt-1" value={department} onChange={setDepartment} />
          </div>
          <div>
            <Label>請負金額（税込） <span className="text-destructive">*</span></Label>
            <NumberInput
              value={contractAmount}
              onChange={(v) => setContractAmount(v)}
              className="mt-1 text-right"
              placeholder="0"
            />
          </div>
          {managementType === "normal" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>着工日 <span className="text-destructive">*</span></Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>竣工予定日 <span className="text-destructive">*</span></Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}
          <p className="text-xs text-slate-400">得意先・工事場所などは、本登録のあと「編集」から入れられます。</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            本登録する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
