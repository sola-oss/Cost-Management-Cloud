import { HardHat } from "lucide-react";
import { SimpleCodeNameMaster } from "@/components/simple-code-name-master";
import { useCraftsmen, CRAFTSMEN_QUERY_KEY } from "@/hooks/use-craftsmen";

// 職人マスタ（温品様の依頼 2026-11-13）。出面に出す、ログインしない人の一覧。担当者マスタとは別。
export default function CraftsmanMaster() {
  const { data: rows = [], isLoading } = useCraftsmen();
  return (
    <SimpleCodeNameMaster
      title="職人マスタ"
      description="出面に出す職人（班）を管理します。工事の「出面」タブで、その現場に入る職人を選んで使います。ログインはしません。"
      icon={HardHat}
      apiPath="/api/craftsmen"
      queryKey={CRAFTSMEN_QUERY_KEY}
      rows={rows}
      isLoading={isLoading}
      entityLabel="職人"
      nameLabel="名前・班名"
      namePlaceholder="例: 内藤 ／ 大屋根"
      statusToggle={{ columnLabel: "状態", activeLabel: "在籍", inactiveLabel: "やめた" }}
    />
  );
}
