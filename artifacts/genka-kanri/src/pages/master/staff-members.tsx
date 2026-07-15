import { useState } from "react";
import { UserRound, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleCodeNameMaster, type CodeNameRow } from "@/components/simple-code-name-master";
import { UserFormDialog } from "@/pages/master/users";
import { useStaffMembers, STAFF_MEMBERS_QUERY_KEY } from "@/hooks/use-staff-members";

export default function StaffMemberMaster() {
  const { data: rows = [], isLoading } = useStaffMembers();
  // 「ログイン発行」: この担当者の名前を初期セットしてユーザー登録ダイアログを開く
  const [issuingFor, setIssuingFor] = useState<CodeNameRow | null>(null);

  return (
    <>
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
        renderExtraAction={(row) => (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="この担当者にログインを発行"
            onClick={() => setIssuingFor(row)}
          >
            <KeyRound className="w-3.5 h-3.5" />
          </Button>
        )}
      />
      <UserFormDialog
        open={issuingFor !== null}
        onClose={() => setIssuingFor(null)}
        initialName={issuingFor?.name}
      />
    </>
  );
}
