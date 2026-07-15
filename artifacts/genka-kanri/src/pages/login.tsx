import { useState } from "react";
import { HardHat, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useLogin } from "@/hooks/use-auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (login.isPending) return;
    login.mutate({ email, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm shadow-md">
        <CardHeader className="items-center text-center space-y-3 pb-2">
          <div className="flex items-center gap-2 font-bold text-xl text-primary justify-center">
            <div className="bg-primary text-primary-foreground p-2 rounded-md">
              <HardHat className="w-6 h-6" />
            </div>
            <span>原価管理クラウド</span>
          </div>
          <p className="text-sm text-slate-500">メールアドレスとパスワードでログインしてください</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {login.isError && (
              <p className="text-sm text-red-600">{(login.error as Error).message}</p>
            )}

            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              ログイン
            </Button>
          </form>

          <p className="text-xs text-slate-400 text-center mt-6 leading-relaxed">
            パスワードをお忘れの場合は、管理者（合同会社RYDEEN）までご連絡ください。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
