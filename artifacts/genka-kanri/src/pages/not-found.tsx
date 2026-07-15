import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-2 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">ページが見つかりません</h1>
          </div>

          <p className="mt-2 text-sm text-gray-600 leading-relaxed">
            お探しのページは移動または削除された可能性があります。
            左のメニューから目的のページを開いてください。
          </p>

          <Button asChild className="mt-5">
            <Link href="/">
              <Home className="w-4 h-4 mr-2" />
              ダッシュボードへ戻る
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
