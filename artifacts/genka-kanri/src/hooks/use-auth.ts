import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * 認証状態の共通フック。
 * /api/auth/status が { authRequired, user } を返す。
 * - authRequired=false（サーバ側フラグOFF）の間は誰でも利用可
 * - authRequired=true かつ user=null ならログイン画面を表示（AuthGate）
 */

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export interface AuthStatus {
  authRequired: boolean;
  user: AuthUser | null;
}

export const AUTH_STATUS_QUERY_KEY = ["/api/auth/status"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useAuthStatus() {
  return useQuery({
    queryKey: AUTH_STATUS_QUERY_KEY,
    queryFn: async (): Promise<AuthStatus> => {
      const res = await fetch(`${BASE}/api/auth/status`);
      if (!res.ok) throw new Error("Failed to fetch auth status");
      return res.json();
    },
    staleTime: 60_000,
    retry: 1,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "ログインに失敗しました");
      return body as AuthUser;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY });
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/auth/logout`, { method: "POST" });
    },
    onSuccess: () => {
      // キャッシュに残った業務データごと確実に破棄するため全リロードする
      // （AuthGateが再評価され、ログイン画面に戻る）
      window.location.assign(`${BASE}/`);
    },
  });
}
