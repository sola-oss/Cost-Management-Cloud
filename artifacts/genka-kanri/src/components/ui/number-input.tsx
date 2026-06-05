/**
 * NumberInput — フォーカスアウト時にカンマ区切り表示する数値入力フィールド
 *
 * フォーカス中は生の数値を表示（入力しやすい）
 * フォーカスを外すとカンマ区切りで表示（読みやすい）
 */
import { useState, useRef, useEffect, forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: string;
  onChange: (value: string) => void;
  /** 小数を許可するか (default: true) */
  allowDecimal?: boolean;
}

function formatWithCommas(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n) || val === "") return "";
  // 小数点がある場合は小数部分を保持
  if (val.includes(".")) {
    const [intPart, decPart] = val.split(".");
    const formatted = parseInt(intPart || "0").toLocaleString("ja-JP");
    return `${formatted}.${decPart}`;
  }
  return n.toLocaleString("ja-JP");
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onChange, allowDecimal = true, className, ...props }, forwardedRef) => {
    const [focused, setFocused] = useState(false);
    const innerRef = useRef<HTMLInputElement | null>(null);

    // Merge forwarded ref with inner ref
    const setRef = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };

    const displayValue = focused ? value : formatWithCommas(value);

    return (
      <input
        ref={setRef}
        type={focused ? "number" : "text"}
        inputMode="decimal"
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        {...props}
      />
    );
  }
);

NumberInput.displayName = "NumberInput";
