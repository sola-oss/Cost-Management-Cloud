import { UserRound } from "lucide-react";
import { SimpleCodeNameMaster } from "@/components/simple-code-name-master";
import { useStaffMembers, STAFF_MEMBERS_QUERY_KEY } from "@/hooks/use-staff-members";

export default function StaffMemberMaster() {
  const { data: rows = [], isLoading } = useStaffMembers();
  return (
    <SimpleCodeNameMaster
      title="担当者マスタ"
      description="工事担当者（原価を付ける担当者）を管理します。工事の登録・編集で選択できます。"
      icon={UserRound}
      apiPath="/api/staff-members"
      queryKey={STAFF_MEMBERS_QUERY_KEY}
      rows={rows}
      isLoading={isLoading}
      entityLabel="担当者"
      nameLabel="名前"
      namePlaceholder="例: 山口 太郎"
    />
  );
}
