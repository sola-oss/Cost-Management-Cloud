"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

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

// 検索用正規化：全角/半角・大文字小文字・カタカナ/ひらがな・スペースや記号の揺れを吸収する。
// 例）「ＣＥＲＡ」→「cera」、「ｻﾝﾖｳｹﾝｾﾂｻ-ﾋﾞｽ」→「さんようけんせつさびす」
function normalizeForSearch(s: string): string {
  return s
    .normalize("NFKC") // 全角英数→半角、半角ｶﾅ→全角カナ、㈱→(株) など
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)) // カタカナ→ひらがな
    .replace(/[\s　ー\-‐‑–—−･・．.,、。()（）]/g, "") // スペース・長音・記号の揺れを除去
}

// ローマ字→ひらがな（IMEと同じ規則の簡易版。変換しきれない場合は null）
const ROMAJI_TABLE: Record<string, string> = {
  kya: "きゃ", kyu: "きゅ", kyo: "きょ", sha: "しゃ", shu: "しゅ", sho: "しょ",
  sya: "しゃ", syu: "しゅ", syo: "しょ", cha: "ちゃ", chu: "ちゅ", cho: "ちょ",
  tya: "ちゃ", tyu: "ちゅ", tyo: "ちょ", nya: "にゃ", nyu: "にゅ", nyo: "にょ",
  hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ", mya: "みゃ", myu: "みゅ", myo: "みょ",
  rya: "りゃ", ryu: "りゅ", ryo: "りょ", gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ",
  jya: "じゃ", jyu: "じゅ", jyo: "じょ", bya: "びゃ", byu: "びゅ", byo: "びょ",
  pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ", shi: "し", chi: "ち", tsu: "つ",
  thi: "てぃ", dhi: "でぃ",
  ja: "じゃ", ju: "じゅ", jo: "じょ", ji: "じ",
  fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ", fu: "ふ",
  va: "ゔぁ", vi: "ゔぃ", vu: "ゔ", ve: "ゔぇ", vo: "ゔぉ",
  wi: "うぃ", we: "うぇ",
  a: "あ", i: "い", u: "う", e: "え", o: "お",
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ",
  sa: "さ", si: "し", su: "す", se: "せ", so: "そ",
  ta: "た", ti: "ち", tu: "つ", te: "て", to: "と",
  na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
  ha: "は", hi: "ひ", hu: "ふ", he: "へ", ho: "ほ",
  ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
  ya: "や", yu: "ゆ", yo: "よ",
  ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ",
  wa: "わ", wo: "を",
  ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
  za: "ざ", zi: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
  ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ",
  pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
}

function romajiToHiragana(input: string): string | null {
  let s = input
  let out = ""
  while (s.length > 0) {
    if (s.startsWith("nn")) { out += "ん"; s = s.slice(2); continue }
    if (s[0] === "n" && s.length > 1 && !"aiueoyn".includes(s[1])) { out += "ん"; s = s.slice(1); continue }
    if (s === "n") { out += "ん"; break }
    if (s.length > 1 && s[0] === s[1] && s[0] !== "n" && /[bcdfghjklmpqrstvwxyz]/.test(s[0])) {
      out += "っ"; s = s.slice(1); continue
    }
    let hit = false
    for (const len of [3, 2, 1]) {
      const chunk = s.slice(0, len)
      const kana = ROMAJI_TABLE[chunk]
      if (kana) { out += kana; s = s.slice(len); hit = true; break }
    }
    if (!hit) return null // 変換できない綴り
  }
  return out
}

// 検索一致判定：正規化した上で部分一致。クエリが英字だけならローマ字→かな変換も試す。
function searchMatch(text: string, query: string): boolean {
  const t = normalizeForSearch(text)
  const q = normalizeForSearch(query)
  if (q === "") return true
  if (t.includes(q)) return true
  if (/^[a-z]+$/.test(q)) {
    const hira = romajiToHiragana(q)
    if (hira && t.includes(hira)) return true
  }
  return false
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & {
    searchable?: boolean
    searchPlaceholder?: string
  }
>(({ className, children, position = "popper", searchable, searchPlaceholder, ...props }, ref) => {
  // 閉じると SelectContent はアンマウントされるので、検索文字列は自動でリセットされる
  const [search, setSearch] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const flat = React.Children.toArray(children)
  const isItem = (c: React.ReactNode): boolean =>
    React.isValidElement(c) && c.type === SelectItem
  const itemCount = flat.filter(isItem).length
  const showSearch = searchable ?? itemCount >= SEARCH_THRESHOLD

  const q = search.trim()
  let visible: React.ReactNode[] = flat
  let matched = itemCount
  if (showSearch && q) {
    visible = flat.filter((c) => {
      if (!isItem(c)) return true
      // 表示テキストに加え、data-search-text（読みがな等の追加検索語）も対象にする
      const props = (c as React.ReactElement).props as Record<string, unknown>
      const extra = typeof props["data-search-text"] === "string" ? (props["data-search-text"] as string) : ""
      return searchMatch(nodeText(c) + " " + extra, q)
    })
    matched = visible.filter(isItem).length
  }

  // 検索欄にフォーカスを移す（IME入力は焦点のある編集要素にしか入らないため必須）。
  // Radixは開く過程で何度か選択肢へフォーカスを移すため、開いてから一定時間は
  // フォーカスが選択肢側に行くたびに検索欄へ戻す（安定したら手を引く）。
  React.useEffect(() => {
    if (!showSearch) return
    let cancelled = false
    let attempt = 0
    let stable = 0
    const tick = () => {
      if (cancelled) return
      const el = searchInputRef.current
      if (el) {
        if (document.activeElement === el) {
          stable++
          if (stable >= 3) return // 3tick連続で保持できたら終了
        } else {
          stable = 0
          el.focus({ preventScroll: true })
        }
      }
      if (++attempt < 30) setTimeout(tick, 50)
    }
    const t = setTimeout(tick, 50)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [showSearch])

  // フォーカスがまだ選択肢側にある間に打たれた文字も検索欄に流し込む（取りこぼし防止）。
  const handleContentKeyDown = (e: React.KeyboardEvent) => {
    if (!showSearch) return
    if (e.target === searchInputRef.current) return // 検索欄自身の入力はそのまま
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
    if (printable) {
      e.preventDefault()
      e.stopPropagation()
      setSearch((s) => s + e.key)
      searchInputRef.current?.focus({ preventScroll: true })
    } else if (e.key === "Backspace") {
      e.preventDefault()
      e.stopPropagation()
      setSearch((s) => s.slice(0, -1))
      searchInputRef.current?.focus({ preventScroll: true })
    }
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
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
                  // 矢印キーは選択肢の移動に渡し、それ以外はRadixのタイプアヘッドに奪われないよう止める
                  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") {
                    e.stopPropagation()
                  }
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
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
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
