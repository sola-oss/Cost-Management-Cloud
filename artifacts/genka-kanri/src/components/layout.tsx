import { Link, useLocation } from "wouter";
import { HardHat, LayoutDashboard, FolderKanban, FileSpreadsheet, Building2, ShoppingCart, CreditCard, Calculator, Users, Layers, FileText, Wrench } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarRail, SidebarTrigger, SidebarGroup, SidebarGroupLabel, SidebarGroupContent } from "./ui/sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const mainNav = [
    { title: "ダッシュボード", icon: LayoutDashboard, url: "/" },
    { title: "工事一覧", icon: FolderKanban, url: "/projects" },
  ];

  const operationNav = [
    { title: "見積書", icon: FileText, url: "/estimates" },
    { title: "仕入入力", icon: ShoppingCart, url: "/purchases" },
    { title: "支払管理", icon: CreditCard, url: "/payments" },
    { title: "支払査定", icon: Calculator, url: "/payment-assessment" },
  ];

  const reportNav = [
    { title: "収支レポート", icon: FileSpreadsheet, url: "/reports" },
  ];

  const masterNav = [
    { title: "工種マスタ", icon: Wrench, url: "/master/work-types" },
    { title: "仕入先マスタ", icon: Users, url: "/master/suppliers" },
    { title: "仕入先グループ", icon: Layers, url: "/master/vendor-groups" },
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

            {/* マスタ管理 */}
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs text-slate-400 px-2 py-1">マスタ管理</SidebarGroupLabel>
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
              <span>大成建設工業株式会社</span>
            </div>
          </header>
          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
