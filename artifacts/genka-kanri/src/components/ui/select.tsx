"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { searchMatch } from "@/lib/search"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

// ─── プルダウン内検索 ─────────────────────────────────────────────────────────
// 選択肢がこの件数以上の SelectContent には自動で検索欄が付く。
// searchable={false} で個別に無効化、searchable={true} で件数に関わらず有効化できる。
const SEARCH_THRESHOLD = 10

// SelectItem の表示テキストを再帰的に取り出す（<span>コード</span>名称 のような入れ子にも対応）
function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join("")
  if (React.isValidElement(node))
    return nodeText((node.props as { children?: React.ReactNode }).children)
  return ""
}


const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & {
    searchable?: boolean
    searchPlaceholder?: string
  }
>(({ className, children, position = "popper", searchable, searchPlaceholder, ...props }, ref) => {
  const [search, setSearch] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  // 中身のDOMは ref ではなく state で持つ。
  // Radixは閉じている間も子要素を画面外（DocumentFragment）に描いていて、そのときref は null。
  // ref のままだと「開いた瞬間」に処理を走らせられず、下のフォーカス合わせが一度も動かなかった。
  const [contentEl, setContentEl] = React.useState<HTMLDivElement | null>(null)
  // ref のコールバックは毎描画で作り直すと null→要素 の往復で無限ループになるため固定する
  const setContentNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      setContentEl(node)
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
    },
    [ref]
  )

  const flat = React.Children.toArray(children)
  const isItem = (c: React.ReactNode): boolean =>
    React.isValidElement(c) && c.type === SelectItem
  const itemCount = flat.filter(isItem).length
  const showSearch = searchable ?? itemCount >= SEARCH_THRESHOLD

  const q = search.trim()
  let visible: React.ReactNode[] = flat
  let matched = itemCount
  if (showSearch && q) {
    const hits = flat.filter((c) => {
      if (!isItem(c)) return true
      // 表示テキストに加え、data-search-text（読みがな等の追加検索語）も対象にする
      const props = (c as React.ReactElement).props as Record<string, unknown>
      const extra = typeof props["data-search-text"] === "string" ? (props["data-search-text"] as string) : ""
      return searchMatch(nodeText(c) + " " + extra, q)
    })
    // 絞り込みの結果、後ろに項目が残らなかったグループ見出しは落とす
    // （見出しだけが宙に浮いて、該当があるように見えるのを防ぐ）
    visible = hits.filter((c, i) => (isItem(c) ? true : isItem(hits[i + 1])))
    matched = visible.filter(isItem).length
  }

  // 開いた直後に必ず検索欄が見える位置（先頭）へスクロールする
  // （Radixが選択中の項目まで自動スクロールし、検索欄が画面外に出てしまうため）。
  React.useEffect(() => {
    if (!showSearch || !contentEl) return
    const t = setTimeout(() => contentEl.scrollTo({ top: 0 }), 60)
    return () => clearTimeout(t)
  }, [showSearch, contentEl])

  // 閉じたら検索文字列を消す。Radixは閉じている間も中身を画面外に描き続けるので、
  // 何もしないと前回の絞り込みが残ったまま次に開き、「1件しか出ない」ように見える。
  React.useEffect(() => {
    if (!contentEl) setSearch("")
  }, [contentEl])

  // 矢印キーで選択肢へ移動している間だけ、下のフォーカス戻しを止める
  const navigatingRef = React.useRef(false)

  // 検索欄が開いている間、フォーカスを検索欄に置き続ける。
  // 日本語入力（IME）は焦点のある入力欄にしか付かないので、選択肢側にフォーカスがあると
  // 1文字目が半角英数で入ってしまう。Radixは (1) 開いた直後 (2) 絞り込みで選択中の項目が
  // 変わったとき (3) マウスが項目に乗ったとき に選択肢へフォーカスを移す。
  //
  // 大事なのは「奪われたら即座に取り返す」をやらないこと。即座に取り返すと Radix と
  // 奪い合いになり、1ミリ秒の間に焦点が4〜5回動く。その直後は画面と日本語入力の間で
  // 焦点の伝達が追いつかず、やはり1文字目だけ英数で入る（工事登録の画面で再現）。
  // そこで、移すのは必ず1拍おいてから・まとめて1回だけにする。
  React.useEffect(() => {
    if (!showSearch || !contentEl) return
    const input = searchInputRef.current
    if (!input) return
    navigatingRef.current = false

    let timer: number | undefined
    const focusSearchSoon = () => {
      if (timer !== undefined) return // すでに予約済みなら二重に動かさない
      timer = window.setTimeout(() => {
        timer = undefined
        if (navigatingRef.current) return
        if (document.activeElement !== input) input.focus({ preventScroll: true })
      }, 0)
    }
    const onFocusIn = (e: FocusEvent) => {
      if (navigatingRef.current || e.target === input) return
      focusSearchSoon()
    }
    contentEl.addEventListener("focusin", onFocusIn)
    // Radixが選択肢へフォーカスを移さなかったとき（該当なし等）の保険。
    // 移した場合は上のfocusinで先に検索欄へ入っているので、ここは何もしない。
    const fallback = window.setTimeout(() => {
      if (document.activeElement !== input) input.focus({ preventScroll: true })
    }, 150)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      window.clearTimeout(fallback)
      contentEl.removeEventListener("focusin", onFocusIn)
    }
  }, [showSearch, contentEl])

  // 矢印キーで選択肢へ移ったあとに文字を打った場合の受け皿。
  // ここで拾える文字はIMEを通っていない（＝かなを打っても英数で届く）ので、
  // 検索欄へ入れずに捨て、フォーカスだけ検索欄へ戻す。打ち直しは1文字で済む。
  const handleContentKeyDown = (e: React.KeyboardEvent) => {
    if (!showSearch) return
    if (e.target === searchInputRef.current) return // 検索欄自身の入力はそのまま
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
    if (printable || e.key === "Backspace") {
      e.preventDefault()
      e.stopPropagation()
      navigatingRef.current = false
      searchInputRef.current?.focus({ preventScroll: true })
    }
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={setContentNode}
        className={cn(
          "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          // 件数が多いときは高さを一定に固定する：巨大リストが画面を覆うのを防ぎ、
          // 絞り込みで高さが変わって開く向きがパタパタ切り替わるのも防ぐ。
          // 少ない件数で固定すると、下半分が空っぽの大きな箱に見えるので付けない
          showSearch &&
            itemCount >= SEARCH_THRESHOLD &&
            "h-[min(360px,var(--radix-select-content-available-height))]",
          className
        )}
        position={position}
        {...props}
        onKeyDownCapture={(e) => {
          // 選択肢側のタイプアヘッドより先に（キャプチャ段階で）文字を検索欄へ流す
          handleContentKeyDown(e)
          props.onKeyDownCapture?.(e)
        }}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
          )}
        >
          {showSearch && (
            <div className="px-2 py-1.5 border-b border-slate-100 sticky -top-1 bg-popover z-10">
              <input
                ref={searchInputRef}
                className="w-full text-sm outline-none bg-transparent placeholder:text-slate-400"
                placeholder={searchPlaceholder ?? "検索..."}
                value={search}
                onChange={(e) => {
                  navigatingRef.current = false
                  setSearch(e.target.value)
                }}
                onKeyDown={(e) => {
                  // 矢印キーは選択肢の移動に渡す（この間だけフォーカス戻しを止める）
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    navigatingRef.current = true
                    return
                  }
                  // それ以外はRadixのタイプアヘッドに奪われないよう止める
                  if (e.key !== "Escape") e.stopPropagation()
                }}
              />
            </div>
          )}
          {visible}
          {showSearch && q && matched === 0 && (
            <div className="px-2 py-3 text-sm text-slate-400 text-center">該当がありません</div>
          )}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      // hover: は検索欄からフォーカスを離さないため（IME対策）。マウスを乗せた項目が
      // フォーカスを得なくなったので、見た目の強調はCSSのhoverで出す
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
