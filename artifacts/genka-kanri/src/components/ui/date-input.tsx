import { Input } from "./input";
import { type ComponentProps } from "react";

function clampDateYear(value: string): string {
  if (!value) return value;
  const parts = value.split("-");
  if (parts[0] && parts[0].length > 4) {
    parts[0] = parts[0].slice(0, 4);
    return parts.join("-");
  }
  return value;
}

export function DateInput({
  onChange,
  ...props
}: ComponentProps<typeof Input>) {
  return (
    <Input
      type="date"
      {...props}
      onChange={(e) => {
        const clamped = clampDateYear(e.target.value);
        if (clamped !== e.target.value) {
          e.target.value = clamped;
        }
        onChange?.(e);
      }}
    />
  );
}
