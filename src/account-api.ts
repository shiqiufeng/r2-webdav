import type { Env } from "./types";
import { DEFAULT_USER } from "./utils";
import { getUsage } from "./quota";
import { listShareRecords } from "./share";
import { isExpired } from "./share";
import {
  customPasswordHash,
  saveCustomPassword,
  usingCustomPassword,
  verifyCurrentPassword,
} from "./auth";
import { APP_NAME, APP_VERSION, LICENSE_NAME, REPO_URL } from "./meta";

/**
 * 账号接口
 *
 *   GET  /__api/account           当前账号信息（用户名、密码来源、容量、分享统计）
 *   POST /__api/account/password  修改密码，必须带原密码
 *
 * 只有这一个账号（WEBDAV_USER），所以没有用户列表，也没有找回流程 ——
 * 忘记新密码时看 auth.ts 顶部的 AUTH_RESET 兜底说明。
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const MIN_LEN = 5;
const MAX_LEN = 128;

/** 连续输错原密码的保护：同一实例内 5 次失败锁 5 分钟，避免被在线穷举 */
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
let fails = 0;
let lockUntil = 0;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleAccountApi(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/__api/account" && path !== "/__api/account/password") return null;

  if (path === "/__api/account") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(405, { error: "GET required" });
    }
    return accountInfo(env, url);
  }

  if (request.method !== "POST") return json(405, { error: "POST required" });
  return changePassword(request, env);
}

async function accountInfo(env: Env, url: URL): Promise<Response> {
  /* 不用 fresh：quota.ts 的 15 秒缓存已经够，且写操作会主动失效，
     否则每点一次头像就全量扫一遍桶 */
  const usage = await getUsage(env);
  const records = await listShareRecords(env);
  let downloads = 0;
  let active = 0;
  for (const r of records) {
    downloads += r.downloads || 0;
    if (!isExpired(r)) active++;
  }

  const hash = await customPasswordHash(env);
  const custom = usingCustomPassword(env, hash);

  return json(200, {
    ok: true,
    user: (env.WEBDAV_USER ?? "").trim() || DEFAULT_USER,
    role: "管理员",
    /** custom = 密码是面板里改过的；env = 还是部署时设的初始密码 */
    passwordSource: custom ? "custom" : "env",
    resetMode: env.AUTH_RESET === "1",
    app: { name: APP_NAME, version: APP_VERSION, license: LICENSE_NAME, repo: REPO_URL },
    webdav: url.origin + "/",
    quota: {
      used: usage.used,
      total: usage.total,
      limit: usage.limit,
      files: usage.files,
      dirs: usage.dirs,
      truncated: usage.truncated,
    },
    shares: { count: records.length, active, downloads },
  });
}

async function changePassword(request: Request, env: Env): Promise<Response> {
  let body: { oldPassword?: unknown; newPassword?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "请求格式错误" });
  }

  const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!oldPassword) return json(400, { error: "请输入原密码" });
  if (!newPassword) return json(400, { error: "请输入新密码" });
  if (newPassword.length < MIN_LEN) return json(400, { error: `新密码至少 ${MIN_LEN} 位` });
  if (newPassword.length > MAX_LEN) return json(400, { error: `新密码最多 ${MAX_LEN} 位` });
  if (newPassword.trim() !== newPassword) {
    return json(400, { error: "新密码不能以空格开头或结尾" });
  }

  const now = Date.now();
  if (lockUntil > now) {
    const sec = Math.ceil((lockUntil - now) / 1000);
    return json(429, { error: `原密码错误次数过多，请 ${sec} 秒后再试` });
  }

  const ok = await verifyCurrentPassword(env, oldPassword);
  if (!ok) {
    fails++;
    if (fails >= MAX_FAILS) {
      lockUntil = now + LOCK_MS;
      fails = 0;
      return json(429, { error: "原密码错误次数过多，请 5 分钟后再试" });
    }
    return json(403, { error: `原密码不正确，还可以再试 ${MAX_FAILS - fails} 次` });
  }
  fails = 0;

  if (newPassword === oldPassword) return json(400, { error: "新密码不能和原密码相同" });

  await saveCustomPassword(env, newPassword);
  return json(200, { ok: true, message: "密码已更新，下次登录请使用新密码" });
}
