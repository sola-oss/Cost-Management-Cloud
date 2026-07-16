import { Link, useLocation } from "wouter";
import { HardHat, LayoutDashboard, FolderKanban, FileSpreadsheet, Building2, ShoppingCart, CreditCard, Calculator, Users, FileText, Wrench, Settings, Receipt, ClipboardList, DollarSign, KeyRound, LogOut, UserCircle, Tags, UserRound, UserCog } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarRail, SidebarTrigger, SidebarGroup, SidebarGroupLabel, SidebarGroupContent } from "./ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { useAuthStatus, useLogout } from "@/hooks/use-auth";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();

  const { data: companySettings } = useCompanySettings<{ companyName?: string }>();
  const { data: auth } = useAuthStatus();
  const logout = useLogout();

  const companyDisplayName = companySettings?.companyName || "会社名未設定";

  const mainNav = [
    { title: "ダッシュボード", icon: LayoutDashboard, url: "/" },
    { title: "工事一覧", icon: FolderKanban, url: "/projects" },
  ];

  const operationNav = [
    { title: "見積書", icon: FileText, url: "/estimates" },
    { title: "注文書", icon: ClipboardList, url: "/purchase-orders" },
    { title: "仕入入力", icon: ShoppingCart, url: "/purchases" },
    { title: "支払査定", icon: Calculator, url: "/payment-assessment" },
    { title: "支払管理", icon: CreditCard, url: "/payments" },
    { title: "請求管理", icon: Receipt, url: "/invoices" },
  ];

  const reportNav = [
    { title: "収支レポート", icon: FileSpreadsheet, url: "/reports" },
  ];

  const masterNav = [
    { title: "得意先マスタ", icon: Users, url: "/master/clients" },
    { title: "工事分類マスタ", icon: Tags, url: "/master/construction-categories" },
    { title: "担当者マスタ", icon: UserRound, url: "/master/staff" },
    { title: "工種マスタ", icon: Wrench, url: "/master/work-types" },
    { title: "単価マスタ", icon: DollarSign, url: "/master/unit-prices" },
    { title: "仕入先マスタ", icon: Building2, url: "/master/suppliers" },
    { title: "ユーザー管理", icon: UserCog, url: "/master/users" },
    { title: "会社設定", icon: Settings, url: "/settings" },
  ];

  const isActive = (url: string) =>
    url === "/" ? location === "/" : location.startsWith(url);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-slate-50">
        <Sidebar className="border-r shadow-sm">
          <SidebarHeader className="border-b p-4">
            <Link href="/">
              <div className="flex items-center gap-2 font-bold text-lg text-primary hover:opacity-80 transition-opacity cursor-pointer">
                <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
                  <HardHat className="w-5 h-5" />
                </div>
                <span>原価管理クラウド</span>
              </div>
            </Link>
          </SidebarHeader>

          <SidebarContent className="p-2 space-y-1">
            {/* メイン */}
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {mainNav.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)}>
                        <Link href={item.url} className="flex items-center gap-3">
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* 日次業務 */}
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs text-slate-400 px-2 py-1">日次業務</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {operationNav.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)}>
                        <Link href={item.url} className="flex items-center gap-3">
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* レポート */}
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs text-slate-400 px-2 py-1">レポート</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {reportNav.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)}>
                        <Link href={item.url} className="flex items-center gap-3">
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* マスタ管理（デフォルト折りたたみ、マスタ画面表示中は開く） */}
            <SidebarGroup>
              <details open={masterNav.some((item) => isActive(item.url))} className="group/master">
                <summary className="flex items-center gap-1 text-xs text-slate-400 px-2 py-1 cursor-pointer select-none hover:text-slate-600 list-none [&::-webkit-details-marker]:hidden">
                  <svg className="w-3 h-3 transition-transform group-open/master:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                  マスタ管理
                </summary>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {masterNav.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isActive(item.url)}>
                          <Link href={item.url} className="flex items-center gap-3">
                            <item.icon className="w-4 h-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </details>
            </SidebarGroup>
          </SidebarContent>

          <SidebarRail />
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-2 px-4 border-b bg-white shadow-sm shrink-0">
            <SidebarTrigger />
            <div className="flex-1" />
            <div className="flex items-center gap-2 text-sm font-medium text-slate-600 border px-3 py-1.5 rounded-full bg-slate-50">
              <Building2 className="w-4 h-4" />
              <span>{companyDisplayName}</span>
            </div>
            {auth?.user && (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1.5 text-sm font-medium text-slate-600 border px-3 py-1.5 rounded-full bg-slate-50 hover:bg-slate-100">
                  <UserCircle className="w-4 h-4" />
                  <span>{auth.user.name}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs text-slate-400 font-normal">
                    {auth.user.email}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/account")}>
                    <KeyRound className="w-4 h-4 mr-2" />
                    パスワード変更
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => logout.mutate()}>
                    <LogOut className="w-4 h-4 mr-2" />
                    ログアウト
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </header>
          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
