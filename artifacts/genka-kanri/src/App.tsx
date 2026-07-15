import { Switch, Route, Router as WouterRouter, useRoute } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import AccountPage from "@/pages/account";
import { useAuthStatus } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

// Pages
import Dashboard from "@/pages/dashboard";
import Projects from "@/pages/projects";
import NewProject from "@/pages/projects/new";
import ProjectDetail from "@/pages/projects/detail";
import BudgetManagement from "@/pages/projects/budgets";
import Reports from "@/pages/reports";
import Purchases from "@/pages/purchases";
import Payments from "@/pages/payments";
import VendorGroups from "@/pages/vendor-groups";
import Vendors from "@/pages/vendors";
import PaymentAssessment from "@/pages/payment-assessment";
import EstimateList from "@/pages/estimates/index";
import NewEstimate from "@/pages/estimates/new";
import EstimateDetail from "@/pages/estimates/detail";
import EstimatePrint from "@/pages/estimates/print";
import WorkTypeMaster from "@/pages/master/work-types";
import UnitPriceMaster from "@/pages/master/unit-prices";
import ClientMaster from "@/pages/master/clients";
import CompanySettings from "@/pages/settings/index";
import InvoiceList from "@/pages/invoices/index";
import NewInvoice from "@/pages/invoices/new";
import InvoiceDetail from "@/pages/invoices/detail";
import InvoicePrint from "@/pages/invoices/print";
import ConstructionHistory from "@/pages/projects/history";
import ProjectLedger from "@/pages/projects/ledger";
import PurchaseOrders from "@/pages/purchase-orders/index";
import PurchaseOrderDetail from "@/pages/purchase-orders/detail";
import PurchaseOrderPrint from "@/pages/purchase-orders/print";
import { Redirect } from "wouter";

const queryClient = new QueryClient();

function Router() {
  const [isEstimatePrint] = useRoute("/estimates/:id/print");
  const [isInvoicePrint] = useRoute("/invoices/:id/print");
  const [isPurchaseOrderPrint] = useRoute("/purchase-orders/:id/print");

  if (isEstimatePrint) {
    return (
      <Switch>
        <Route path="/estimates/:id/print">
          {(params) => <EstimatePrint id={parseInt(params.id)} />}
        </Route>
      </Switch>
    );
  }

  if (isInvoicePrint) {
    return (
      <Switch>
        <Route path="/invoices/:id/print">
          {(params) => <InvoicePrint id={parseInt(params.id)} />}
        </Route>
      </Switch>
    );
  }

  if (isPurchaseOrderPrint) {
    return (
      <Switch>
        <Route path="/purchase-orders/:id/print">
          {(params) => <PurchaseOrderPrint id={parseInt(params.id)} />}
        </Route>
      </Switch>
    );
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/projects" component={Projects} />
        <Route path="/projects/new" component={NewProject} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/projects/:id/budgets" component={BudgetManagement} />
        <Route path="/projects/:id/history" component={ConstructionHistory} />
        <Route path="/projects/:id/ledger" component={ProjectLedger} />
        <Route path="/reports" component={Reports} />
        <Route path="/purchases" component={Purchases} />
        <Route path="/payments" component={Payments} />
        <Route path="/payment-assessment" component={PaymentAssessment} />
        <Route path="/estimates" component={EstimateList} />
        <Route path="/estimates/new" component={NewEstimate} />
        <Route path="/estimates/:id" component={EstimateDetail} />
        <Route path="/vendors" component={Vendors} />
        <Route path="/master/suppliers" component={Vendors} />
        <Route path="/vendor-groups" component={VendorGroups} />
        <Route path="/master/vendor-groups" component={VendorGroups} />
        <Route path="/master/work-types" component={WorkTypeMaster} />
        <Route path="/master/unit-prices" component={UnitPriceMaster} />
        <Route path="/master/clients" component={ClientMaster} />
        <Route path="/settings" component={CompanySettings} />
        <Route path="/account" component={AccountPage} />
        <Route path="/invoices" component={InvoiceList} />
        <Route path="/invoices/new" component={NewInvoice} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route path="/purchase-orders" component={PurchaseOrders} />
        <Route path="/purchase-orders/:id">
          {(params) => <PurchaseOrderDetail id={parseInt(params.id)} />}
        </Route>
        <Route path="/purchase-invoices"><Redirect to="/purchases" /></Route>
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

// 認証ガード。AUTH_REQUIRED がONかつ未ログインならログイン画面だけを表示する。
// 状態取得に失敗した場合はアプリを表示する（本当に認証必須ならAPI側が401を返すため締め出しにならない）。
function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useAuthStatus();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (data?.authRequired && !data.user) {
    return <LoginPage />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthGate>
            <Router />
          </AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
