import crypto from "node:crypto";

/**
 * 認証まわりの共通処理。
 * - パスワードは Node 標準の scrypt でハッシュ化（外部依存なし）
 * - セッションは HMAC 署名付きトークンを httpOnly Cookie に保存
 *
 * AUTH_REQUIRED=true のときだけ認証必須になる（段階的ロールアウト用）。
 * SESSION_SECRET はトークン署名鍵。本番では必ず環境変数で設定する。
 */

const SCRYPT_KEYLEN = 64;
const SESSION_DAYS = 30;

export const SESSION_COOKIE = "cmc_session";
export const SESSION_MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

export function isAuthRequired(): boolean {
  return process.env["AUTH_REQUIRED"] === "true";
}

function sessionSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (secret) return secret;
  if (process.env["NODE_ENV"] === "production" && isAuthRequired()) {
    throw new Error("SESSION_SECRET must be set when AUTH_REQUIRED=true in production");
  }
  return "cmc-dev-secret";
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expected] = parts;
  const actual = crypto.scryptSync(password, salt!, SCRYPT_KEYLEN).toString("hex");
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected!, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type SessionPayload = {
  uid: number;
  exp: number; // epoch ms
};

function sign(data: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(data).digest("base64url");
}

export function createSessionToken(userId: number): string {
  const payload: SessionPayload = { uid: userId, exp: Date.now() + SESSION_MAX_AGE_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof payload.uid !== "number" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
