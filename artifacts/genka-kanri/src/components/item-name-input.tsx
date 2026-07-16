import { useState, useMemo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Package } from "lucide-react";
import { searchMatch } from "@/lib/search";
import { useVendorUnitPrices, type UnitPriceItem } from "@/hooks/use-unit-prices";
import type { UnitPriceSelection } from "@/components/unit-price-picker";

/**
 * 品名入力欄 — 打ちながらその仕入先の単価マスタから候補を出す。
 *
 * 目的は重複登録の予防：既存品目を「打って選ぶ」流れにすることで、
 * 同じ品目を新規で打ち込んで単価マスタが濁るのを防ぐ。
 * 候補の絞り込みは表記ゆれ・ローマ字にも対応（lib/search）。
 */

const MAX_SUGGESTIONS = 8;

export function ItemNameInput({
  vendorId,
  value,
  onChange,
  onSelect,
  className,
  placeholder,
}: {
  /** 仕入先ID（未選択なら候補は出さず、ただの入力欄として動く） */
  vendorId: string;
  value: string;
  onChange: (v: string) => void;
  onSelect: (sel: UnitPriceSelection) => void;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasVendor = !!vendorId && vendorId !== "none";

  const { data: items = [] } = useVendorUnitPrices(vendorId, hasVendor);

  const suggestions = useMemo(() => {
    const q = value.trim();
    if (!hasVendor || q === "") return [];
    // 完全一致の品目しか無い場合は候補を出さない（選び終わった後に出続けるのを防ぐ）
    const hits = items.filter((it) => searchMatch(it.itemName, q));
    if (hits.length === 1 && hits[0].itemName === q) return [];
    return hits.slice(0, MAX_SUGGESTIONS);
  }, [items, value, hasVendor]);

  const showList = open && suggestions.length > 0;

  const pick = (item: UnitPriceItem) => {
    onSelect({
      itemName: item.itemName,
      unit: item.unit,
      unitPrice: item.unitPrice,
      workTypeCode: item.workTypeCode,
      workTypeId: item.workTypeId,
    });
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      // IME変換確定のEnterでは選択しない
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      const item = suggestions[activeIdx];
      if (item) pick(item);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Popover open={showList} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setActiveIdx(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)} // 候補クリックを拾うため少し待つ
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={className}
          autoComplete="off"
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={2}
        className="p-0 w-[380px] max-h-[260px] overflow-y-auto"
        // 入力欄からフォーカスを奪わない（打ちながら候補を見るため）
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-2 py-1 text-[10px] text-slate-400 border-b bg-slate-50 flex items-center gap-1">
          <Package className="w-3 h-3" />
          単価マスタの候補（選ぶと単価・単位・工種が入ります）
        </div>
        {suggestions.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 ${
              i === activeIdx ? "bg-indigo-50" : "hover:bg-slate-50"
            }`}
            onMouseEnter={() => setActiveIdx(i)}
            onMouseDown={(e) => e.preventDefault()} // blurより先にクリックを成立させる
            onClick={() => pick(item)}
          >
            <span className="flex-1 truncate font-medium text-slate-800">{item.itemName}</span>
            {item.workTypeName && (
              <span className="text-[10px] text-slate-400 shrink-0">{item.workTypeName}</span>
            )}
            <span className="text-slate-400 shrink-0">{item.unit}</span>
            <span className="font-mono text-slate-800 shrink-0">
              {Number(item.unitPrice).toLocaleString("ja-JP")}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
