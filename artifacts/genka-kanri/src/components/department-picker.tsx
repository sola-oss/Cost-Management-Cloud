import { cn } from "@/lib/utils";
import { DEPARTMENTS } from "@/lib/departments";

/**
 * 部門の選択。選択肢が2つしかないので、プルダウンではなく並んだボタンにする
 * （開かなくても両方が見え、押し間違いに気づきやすい）。
 * 登録後は変えられないことを、選ぶ場所で必ず伝える。
 */
export function DepartmentPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-2">
        {DEPARTMENTS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onChange(d)}
            aria-pressed={value === d}
            className={cn(
              "rounded-md border px-3 py-2 text-sm transition-colors",
              value === d
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : "border-slate-200 text-slate-700 hover:border-primary/50",
            )}
          >
            {d}
          </button>
        ))}
      </div>
      <p className="text-xs text-amber-700 mt-1">
        登録後は変更できません（会計ソフトの仕訳に使うため）。
      </p>
    </div>
  );
}
