/**
 * UnitPricePicker — 仕入先を指定して品目を選択し、単価を自動補完するコンポーネント
 *
 * 使い方:
 *   <UnitPricePicker
 *     vendorId={vendorId}        // 必須: 仕入先ID (string)
 *     onSelect={(item) => { ... }} // 選択時コールバック
 *     trigger={<Button>品目選択</Button>}  // 任意: トリガー要素
 *   />
 */
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Package, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface UnitPriceItem {
  id: number;
  vendorId: number;
  workTypeId: number | null;
  itemName: string;
  unit: string;
  unitPrice: string;
  notes: string | null;
  vendorName: string | null;
  workTypeName: string | null;
  workTypeCode: string | null;
}

export interface UnitPriceSelection {
  itemName: string;
  unit: string;
  unitPrice: string;
  workTypeCode: string | null;
  workTypeId: number | null;
}

interface Props {
  vendorId: string;
  onSelect: (item: UnitPriceSelection) => void;
  trigger?: React.ReactNode;
  disabled?: boolean;
  /** 開いたときに初期表示する工種コード（行で選択中の工種で絞り込む） */
  initialWorkTypeCode?: string | null;
}

function fmtMoney(v: string | number): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("ja-JP");
}

export function UnitPricePicker({ vendorId, onSelect, trigger, disabled, initialWorkTypeCode }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [workTypeFilter, setWorkTypeFilter] = useState<string>("__all__");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/unit-prices", "picker", vendorId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/unit-prices?vendorId=${vendorId}`);
      if (!res.ok) throw new Error("Failed to fetch unit prices");
      const json = await res.json();
      return (json.items ?? []) as UnitPriceItem[];
    },
    enabled: open && !!vendorId,
  });

  const items = data ?? [];

  // 開いたら、行で選択中の工種で初期絞り込み（未指定なら「すべて」）
  useEffect(() => {
    if (open) setWorkTypeFilter(initialWorkTypeCode || "__all__");
  }, [open, initialWorkTypeCode]);

  // 初期絞り込みした工種にこの仕入先の商品が無ければ「すべて」にフォールバック
  useEffect(() => {
    if (!open || workTypeFilter === "__all__") return;
    if (items.length > 0 && !items.some((it) => it.workTypeCode === workTypeFilter)) {
      setWorkTypeFilter("__all__");
    }
  }, [open, items, workTypeFilter]);

  // この仕入先が実際に持っている工種だけを絞り込み候補にする
  const workTypeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) {
      if (it.workTypeCode) map.set(it.workTypeCode, it.workTypeName ?? it.workTypeCode);
    }
    return Array.from(map, ([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (workTypeFilter !== "__all__") {
      list = list.filter((it) => it.workTypeCode === workTypeFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (it) =>
          it.itemName.toLowerCase().includes(q) ||
          (it.workTypeName ?? "").toLowerCase().includes(q) ||
          (it.notes ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, workTypeFilter, search]);

  function handleSelect(item: UnitPriceItem) {
    onSelect({
      itemName: item.itemName,
      unit: item.unit,
      unitPrice: item.unitPrice,
      workTypeCode: item.workTypeCode,
      workTypeId: item.workTypeId,
    });
    setOpen(false);
    setSearch("");
    setWorkTypeFilter("__all__");
  }

  function handleOpen() {
    if (!vendorId || disabled) return;
    setOpen(true);
  }

  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1 text-xs h-7 px-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
      onClick={handleOpen}
      disabled={!vendorId || disabled}
      title={!vendorId ? "先に仕入先を選択してください" : "単価マスタから品目を選択"}
    >
      <Package className="w-3 h-3" />
      単価選択
    </Button>
  );

  return (
    <>
      {trigger ? (
        <span onClick={handleOpen} className={!vendorId || disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}>
          {trigger}
        </span>
      ) : (
        defaultTrigger
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-indigo-700 flex items-center gap-2">
              <Package className="w-5 h-5" />
              品目を選択
            </DialogTitle>
          </DialogHeader>

          {/* 工種フィルタ＋検索 */}
          <div className="flex items-center gap-2">
            <Select value={workTypeFilter} onValueChange={setWorkTypeFilter}>
              <SelectTrigger className="w-[180px] text-sm shrink-0">
                <SelectValue placeholder="工種で絞り込み" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-sm">すべての工種</SelectItem>
                {workTypeOptions.map((wt) => (
                  <SelectItem key={wt.code} value={wt.code} className="text-sm">
                    <span className="font-mono text-slate-400 mr-1">{wt.code}</span>
                    {wt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <Input
                className="pl-8 text-sm"
                placeholder="品目名で検索..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          {/* 一覧 */}
          <div className="flex-1 overflow-y-auto border rounded-lg">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                読み込み中...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">
                {items.length === 0
                  ? "この仕入先の単価マスタが登録されていません。"
                  : workTypeFilter !== "__all__"
                    ? "この工種の品目がありません。「すべての工種」で他を表示できます。"
                    : "該当する品目が見つかりません。"}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 text-xs">
                    <TableHead className="font-semibold text-slate-600">品目名</TableHead>
                    <TableHead className="w-[100px] font-semibold text-slate-600">工種</TableHead>
                    <TableHead className="w-[60px] font-semibold text-slate-600">単位</TableHead>
                    <TableHead className="w-[100px] font-semibold text-slate-600 text-right">単価</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-indigo-50 transition-colors"
                      onClick={() => handleSelect(item)}
                    >
                      <TableCell className="text-sm font-medium text-slate-800">
                        {item.itemName}
                        {item.notes && (
                          <span className="ml-2 text-xs text-slate-400">{item.notes}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.workTypeName ? (
                          <Badge variant="outline" className="text-xs bg-slate-50">
                            {item.workTypeName}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{item.unit}</TableCell>
                      <TableCell className="text-sm font-mono text-right font-medium text-slate-800">
                        {fmtMoney(item.unitPrice)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="text-xs text-slate-400 text-right">
            {filtered.length} / {items.length} 件
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
