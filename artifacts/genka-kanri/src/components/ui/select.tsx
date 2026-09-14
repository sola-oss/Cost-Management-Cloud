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

  // 矢印キーで選択肢へ移っている最中か。移っている間だけ選択肢を「焦点を受け取れる」状態に戻す。
  const [navigating, setNavigating] = React.useState(false)

  // 検索中は選択肢から tabindex を外し、そもそも焦点を受け取れなくする。
  // Radixは開いた直後・絞り込み・マウスが乗ったとき等に選択肢へ焦点を移そうとするが、
  // tabindex が無い要素は .focus() を呼ばれても焦点を持てないため、何も起きなくなる。
  if (showSearch && !navigating) {
    visible = visible.map((c) =>
      isItem(c)
        ? React.cloneElement(c as React.ReactElement<{ tabIndex?: number }>, { tabIndex: undefined })
        : c
    )
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

  // 検索欄へ焦点を置き、そこから動かさない。
  //
  // 日本語入力は焦点のある入力欄にしか付かない。以前は「Radixに奪われたら取り返す」
  // 方式にしていたが、工事登録のように一覧の上にマウスが乗る配置だと、
  // 検索欄⇄リスト の間で焦点が1フレームごとに往復し続ける（実機のログで確認）。
  // 打った瞬間にリスト側へ行っていると、1文字目が変換されず英数で入ってしまう。
  //
  // そこで取り返すのをやめ、上で選択肢の tabindex を外して「焦点が動かない」ようにした。
  // ここでやるのは、開いたときに一度だけ検索欄へ焦点を置くことだけ。
  React.useEffect(() => {
    if (!showSearch || !contentEl) return
    const input = searchInputRef.current
    if (!input) return
    setNavigating(false)
    // Radixはリスト本体（listbox）にも焦点を移そうとする。こちらは要素が1つなので
    // focus() を無効にして防ぐ（閉じるときに元へ戻す）。
    const realFocus = contentEl.focus
    contentEl.focus = () => {}
    input.focus({ preventScroll: true })
    return () => {
      contentEl.focus = realFocus
    }
  }, [showSearch, contentEl])

  // 選択肢へ焦点が渡っている（矢印キー操作中）ときに文字を打った場合の受け皿。
  // ここで拾える文字は日本語入力を通っていないので、検索欄へ入れずに捨て、焦点だけ戻す。
  const handleContentKeyDown = (e: React.KeyboardEvent) => {
    if (!showSearch) return
    if (e.target === searchInputRef.current) return // 検索欄自身の入力はそのまま
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
    if (printable || e.key === "Backspace") {
      e.preventDefault()
      e.stopPropagation()
      setNavigating(false)
      searchInputRef.current?.focus({ preventScroll: true })
    }
  }

  // 矢印キーで選択肢へ移る。選択肢は tabindex を外してあるので、
  // まず戻す（navigating を立てる）→ 描き直されたあとに焦点を渡す、の順で行う。
  const pendingNavRef = React.useRef<"down" | "up" | null>(null)
  const startNavigating = (dir: "down" | "up") => {
    pendingNavRef.current = dir
    setNavigating(true)
  }
  React.useEffect(() => {
    if (!navigating || !pendingNavRef.current || !contentEl) return
    const dir = pendingNavRef.current
    pendingNavRef.current = null
    const items = contentEl.querySelectorAll<HTMLElement>('[role="option"]')
    if (items.length === 0) return
    ;(dir === "down" ? items[0] : items[items.length - 1]).focus()
  }, [navigating, contentEl])

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
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  // 矢印キーで選択肢へ移る。以降の上下移動と決定はRadixに任せる
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault()
                    e.stopPropagation()
                    startNavigating(e.key === "ArrowDown" ? "down" : "up")
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
