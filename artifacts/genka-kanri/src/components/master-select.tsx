import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * マスタの名称一覧から1つ選ぶプルダウン（値は名称の文字列をそのまま保存する用途）。
 * - プルダウン内の検索欄で絞り込みできる（仕入入力の工種セレクトと同じ操作感）
 * - 現在値がマスタに無い場合も選択肢に残す（マスタを後から変更した旧データを壊さないため）
 */

const NONE = "__none__";

export function MasterSelect({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  className,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const current = (value ?? "").trim();
  // 同姓同名などで名称が重複していても選択肢は1つにする（値=名称なのでキー重複を防ぐ）
  const opts = [...new Set(current && !options.includes(current) ? [current, ...options] : options)];
  const q = search.trim().toLowerCase();
  const filtered = q ? opts.filter((o) => o.toLowerCase().includes(q)) : opts;

  return (
    <Select
      value={current === "" ? NONE : current}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      onOpenChange={(open) => {
        if (!open) setSearch("");
      }}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder ?? "選択してください"} />
      </SelectTrigger>
      <SelectContent className="max-h-[320px]">
        <div className="px-2 py-1.5 border-b border-slate-100 sticky top-0 bg-white z-10">
          <input
            autoFocus
            className="w-full text-sm outline-none bg-transparent placeholder:text-slate-400"
            placeholder={searchPlaceholder ?? "名前で検索..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <SelectItem value={NONE} className="text-slate-400">
          （未選択）
        </SelectItem>
        {filtered.length === 0 ? (
          <div className="px-2 py-3 text-sm text-slate-400 text-center">該当がありません</div>
        ) : (
          filtered.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
