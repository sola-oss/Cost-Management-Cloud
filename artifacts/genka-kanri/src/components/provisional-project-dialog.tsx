import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MasterSelect } from "@/components/master-select";
import { useStaffMembers } from "@/hooks/use-staff-members";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface ProvisionalProject {
  id: number;
  name: string;
  projectCode: string;
  siteManager: string | null;
}

/**
 * 工事の仮登録ダイアログ。
 *
 * 正式に工事を登録する前に書類が届いたとき（例：工事が決まる前の下請見積書）、
 * 書類を紐づける先がその場で作れるようにする。聞くのは工事名と担当者だけ。
 * 請負金額・部門・工期は、あとで「本登録する」から入れる。
 */
export function ProvisionalProjectDialog({
  open,
  onClose,
  onCreated,
  defaultSiteManager,
  defaultName,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProvisionalProject) => void;
  defaultSiteManager?: string;
  // 書類から読んだ工事名があれば最初から入れておく
  defaultName?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: staffMembers = [] } = useStaffMembers();
  const staffNames = staffMembers.filter((s) => s.isActive !== false).map((s) => s.name);

  const [name, setName] = useState("");
  const [siteManager, setSiteManager] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName ?? "");
      setSiteManager(defaultSiteManager ?? "");
    }
  }, [open, defaultSiteManager, defaultName]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "工事名を入力してください", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/projects/provisional`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), siteManager: siteManager || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "仮登録に失敗しました");
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("/projects") });
      toast({ title: "工事を仮登録しました", description: name.trim() });
      onCreated(body as ProvisionalProject);
      onClose();
    } catch (err) {
      toast({ title: "仮登録できませんでした", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>工事の仮登録</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-slate-500 bg-slate-50 rounded px-2.5 py-2 leading-relaxed">
            まだ登録していない工事の書類を、先に受け付けるための登録です。
            工事名だけで作れます。請負金額・部門・工期は、あとで「本登録する」から入れてください。
            仮登録のあいだは、会社全体の合計・粗利には入りません。
          </p>
          <div>
            <Label>工事名 <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: ○○様邸 新築工事"
              className="mt-1"
              autoFocus
            />
          </div>
          <div>
            <Label>担当者</Label>
            <MasterSelect
              className="mt-1 text-sm"
              value={siteManager}
              onChange={setSiteManager}
              options={staffNames}
              placeholder="担当者を選択"
            />
            <p className="text-xs text-slate-400 mt-1">
              選んでおくと、本登録を担当者の「自分の現場」から進められます。
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            仮登録
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
