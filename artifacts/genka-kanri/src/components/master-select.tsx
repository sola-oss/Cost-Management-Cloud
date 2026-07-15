import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * マスタの名称一覧から1つ選ぶプルダウン（値は名称の文字列をそのまま保存する用途）。
 * 現在値がマスタに無い場合も選択肢に残す（マスタを後から変更した旧データを壊さないため）。
 */

const NONE = "__none__";

export function MasterSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const current = (value ?? "").trim();
  // 同姓同名などで名称が重複していても選択肢は1つにする（値=名称なのでキー重複を防ぐ）
  const opts = [...new Set(current && !options.includes(current) ? [current, ...options] : options)];
  return (
    <Select
      value={current === "" ? NONE : current}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder ?? "選択してください"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>（未選択）</SelectItem>
        {opts.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
