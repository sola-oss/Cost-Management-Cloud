import * as React from "react"

import { cn } from "@/lib/utils"

function getFocusableInputs(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])'
    )
  ).filter((el) => {
    const style = window.getComputedStyle(el)
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null
  })
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onKeyDown, ...props }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(e)

      if (e.defaultPrevented) return

      if (e.nativeEvent.isComposing || e.keyCode === 229) return

      if (e.key === "Enter") {
        e.preventDefault()
        const focusables = getFocusableInputs()
        const idx = focusables.indexOf(e.currentTarget)
        if (idx !== -1 && idx < focusables.length - 1) {
          focusables[idx + 1].focus()
        }
      } else if (e.key === "ArrowLeft") {
        if (e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
          e.preventDefault()
          const focusables = getFocusableInputs()
          const idx = focusables.indexOf(e.currentTarget)
          if (idx > 0) {
            const prev = focusables[idx - 1] as HTMLInputElement
            prev.focus()
            if (typeof prev.selectionStart === "number") {
              const len = prev.value?.length ?? 0
              prev.setSelectionRange(len, len)
            }
          }
        }
      }
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        onKeyDown={handleKeyDown}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
