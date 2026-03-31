import { Link, useLocation } from "wouter";
import { HardHat, LayoutDashboard, FolderKanban, FileSpreadsheet, Building2 } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarRail, SidebarTrigger } from "./ui/sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navigation = [
    { title: "ダッシュボード", icon: LayoutDashboard, url: "/" },
    { title: "工事一覧", icon: FolderKanban, url: "/projects" },
    { title: "収支レポート", icon: FileSpreadsheet, url: "/reports" },
  ];

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
          <SidebarContent className="p-2">
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}
                  >
                    <Link href={item.url} className="flex items-center gap-3">
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
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
