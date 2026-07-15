import { Tags } from "lucide-react";
import { SimpleCodeNameMaster } from "@/components/simple-code-name-master";
import {
  useConstructionCategories,
  CONSTRUCTION_CATEGORIES_QUERY_KEY,
} from "@/hooks/use-construction-categories";

export default function ConstructionCategoryMaster() {
  const { data: rows = [], isLoading } = useConstructionCategories();
  return (
    <SimpleCodeNameMaster
      title="工事分類マスタ"
      description="工事の分類（受注先・市場の種類）を管理します。工事の登録・編集で選択できます。"
      icon={Tags}
      apiPath="/api/construction-categories"
      queryKey={CONSTRUCTION_CATEGORIES_QUERY_KEY}
      rows={rows}
      isLoading={isLoading}
      entityLabel="工事分類"
      nameLabel="名称"
      namePlaceholder="例: 戸建住宅"
    />
  );
}
