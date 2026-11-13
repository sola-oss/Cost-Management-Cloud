import { UserRound } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { SimpleCodeNameMaster } from "@/components/simple-code-name-master";
import { useStaffMembers, STAFF_MEMBERS_QUERY_KEY } from "@/hooks/use-staff-members";
import { useRole, ROLE_LABELS, toRole } from "@/lib/permissions";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// 担当者マスタでは「ログインがあるか」を見るだけ。作る・直すのはユーザー管理だけにする
// （以前は鍵のボタンからユーザー登録を開けたが、同じことが2か所でできて分かりにくかった。2026-11-13 アイさん）
export default function StaffMemberMaster() {
  const { data: rows = [], isLoading } = useStaffMembers();
  const role = useRole();
  const canOpenUsers = role === "admin";

  const { data: logins } = useQuery({
    queryKey: ["/api/staff-members/logins"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/staff-members/logins`);
      if (!r.ok) throw new Error("failed");
      return (await r.json()) as { items: { staffMemberId: number; role: string }[] };
    },
  });
  const loginOf = (id: number) => logins?.items.filter((l) => l.staffMemberId === id) ?? [];

  return (
    <SimpleCodeNameMaster
      title="担当者マスタ"
      description="工事担当者（原価を付ける担当者）を管理します。工事の登録・編集で選択できます。ログインの作成・変更はユーザー管理で行います。"
      icon={UserRound}
      apiPath="/api/staff-members"
      queryKey={STAFF_MEMBERS_QUERY_KEY}
      rows={rows}
      isLoading={isLoading}
      entityLabel="担当者"
      nameLabel="名前"
      namePlaceholder="例: 山口 太郎"
      statusToggle={{ columnLabel: "状態", activeLabel: "在職", inactiveLabel: "退職" }}
      extraColumn={{
        label: "ログイン",
        className: "w-40",
        render: (row) => {
          const ls = loginOf(row.id);
          if (ls.length === 0) return <span className="text-sm text-slate-400">なし</span>;
          const label = `あり（${ls.map((l) => ROLE_LABELS[toRole(l.role)]).join("・")}）`;
          const badge = <Badge variant="outline" className="font-normal">{label}</Badge>;
          return canOpenUsers ? (
            <Link href="/master/users" title="ユーザー管理で確認・変更する" className="hover:opacity-70">{badge}</Link>
          ) : badge;
        },
      }}
    />
  );
}
