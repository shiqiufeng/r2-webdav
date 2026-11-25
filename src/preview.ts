import type { Env } from "./types";
import { keyOf, normalizePath, textResponse } from "./utils";
import { b64url, b64urlDecode } from "./share";

/**
 * 预览直链（签名 URL）
 *
 * 为什么需要它：<img> / <video> / <audio> / <iframe> 无法携带 Authorization 头，
 * 前端只能把整个文件读成 Blob 再塞进 blob: URL。视频一旦上几百 MB 就会把标签页内存打爆，
 * 而且播放器无法用 Range 拖进度条。
 *
 * 方案：文件管理器用 Basic 凭据换一个短期 HMAC 令牌，把令牌拼进 URL，
 * 浏览器原生播放器就能边下边播、任意 seek，服务端仍然只认签名不认 cookie。
 * 令牌与 WebDAV 密码绑定派生，改密码即全部失效；默认 2 小时过期。
 */

const enc = new TextEncoder();

function previewKey(env: Env): string {
  return `preview-token-v1:${env.WEBDAV_PASS ?? ""}:${env.WEBDAV_USER ?? "admin"}`;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

function b64urlEncodeText(input: string): string {
  return b64url(enc.encode(input));
}

function b64urlDecodeText(input: string): string | null {
  try {
    return new TextDecoder().decode(b64urlDecode(input));
  } catch {
    return null;
  }
}

/** 生成 `<path>.<exp>.<sig>` 形式的令牌，path 段是 UTF-8 路径的 base64url */
export async function signPreviewToken(
  env: Env,
  path: string,
  ttlSeconds = 7200,
): Promise<{ token: string; expiresAt: number }> {
  const exp = Date.now() + ttlSeconds * 1000;
  const payload = `${b64urlEncodeText(path)}.${exp}`;
  const sig = await hmac(previewKey(env), payload);
  return { token: `${payload}.${sig}`, expiresAt: exp };
}

/** 校验令牌并取回路径；失败返回 null（不区分原因，避免给探测者额外信息） */
export async function verifyPreviewToken(env: Env, token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [payloadPath, expStr, sig] = parts;
  const expect = await hmac(previewKey(env), `${payloadPath}.${expStr}`);
  if (expect.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const path = b64urlDecodeText(payloadPath);
  if (path === null || !path.startsWith("/")) return null;
  return normalizePath(path);
}

/**
 * POST /__api/preview  { path }
 * 需要 Basic 认证（在 route 里认证之后才调用）。
 * 返回可直接塞进 src 的相对地址。
 */
export async function handlePreviewApi(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== "/__api/preview") return null;
  if (request.method !== "POST") {
    return textResponse(405, "Method Not Allowed", { Allow: "POST" });
  }
  let body: { path?: string };
  try {
    body = (await request.json()) as { path?: string };
  } catch {
    return textResponse(400, "Bad Request");
  }
  const raw = typeof body.path === "string" ? body.path : "";
  if (!raw || !raw.startsWith("/")) return textResponse(400, "Bad path");
  const path = normalizePath(raw);

  const head = await env.BUCKET.head(keyOf(path));
  if (!head) return textResponse(404, "Not Found");

  const { token, expiresAt } = await signPreviewToken(env, path);
  return new Response(JSON.stringify({ url: `/__p/${token}`, expiresAt }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
