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
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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
}

function fmtMoney(v: string | number): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("ja-JP");
}

export function UnitPricePicker({ vendorId, onSelect, trigger, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

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

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (it) =>
        it.itemName.toLowerCase().includes(q) ||
        (it.workTypeName ?? "").toLowerCase().includes(q) ||
        (it.notes ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

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

          {/* 検索 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
            <Input
              className="pl-8 text-sm"
              placeholder="品目名・工種で検索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
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
