import type { Env } from "./types";
import { DEFAULT_PASS, DEFAULT_USER, constantTimeEqual, type AuthResult } from "./utils";
import { getStoredAuthHash, setStoredAuthHash, sha256Hex } from "./share";

/**
 * 密码校验
 *
 * 两套来源，优先级从高到低：
 *   1. Durable Object 里存的自定义哈希 —— 「个人信息 → 修改密码」写进去的
 *   2. env.WEBDAV_PASS（wrangler secret）—— 部署时设的初始密码
 *
 * 为什么放 DO 而不是 KV：改完密码要立刻生效。KV 是最终一致，改完还能用旧密码
 * 登录几十秒，放在「必须输原密码才能改」的场景里很别扭；DO 单实例强一致，
 * 而且这个项目本来就有 SHARES 绑定，不用新增任何资源。
 *
 * 哈希格式 v1$<salt>$<hex>，盐 16 字节随机。用 SHA-256 单次而不是 PBKDF2：
 * WebDAV 客户端每个请求都带 Basic 凭据，每次校验都要跑一遍，PBKDF2 的
 * 10 万次迭代会把 PROPFIND 拖成几百毫秒。盐 + 定长比较能挡住彩虹表和侧信道，
 * 对「一个人用的网盘」是合适的取舍。
 *
 * 忘记密码的兜底：把 env 里的 AUTH_RESET 设为 "1" 重新部署，
 * 此时忽略 DO 里的自定义哈希，用 WEBDAV_PASS 登录，进去改完密码再把这个变量删掉。
 */

const HASH_PREFIX = "v1";
const HASH_PEPPER = "r2-webdav";

export interface Creds {
  user: string;
  pass: string;
}

/** 从 Authorization: Basic 头解出用户名和密码 */
export function readCreds(req: Request): Creds | null {
  const header = req.headers.get("Authorization") ?? "";
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!m) return null;
  let decoded = "";
  try {
    decoded = atob(m[1]);
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  return idx === -1
    ? { user: decoded, pass: "" }
    : { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

function randomSalt(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, "0");
  return out;
}

export async function hashPassword(password: string, salt?: string): Promise<string> {
  const s = salt ?? randomSalt();
  const hex = await sha256Hex(`${s}:${password}:${HASH_PEPPER}`);
  return `${HASH_PREFIX}$${s}$${hex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX || !parts[1]) return false;
  const hex = await sha256Hex(`${parts[1]}:${password}:${HASH_PEPPER}`);
  return constantTimeEqual(hex, parts[2]);
}

/** 面板里改过的密码（null = 从没改过，用 env 里的） */
export async function customPasswordHash(env: Env): Promise<string | null> {
  try {
    return await getStoredAuthHash(env);
  } catch {
    /* DO 不可用时不能让整个站点挂掉，回落到 env 密码 */
    return null;
  }
}

export function usingCustomPassword(env: Env, hash: string | null): boolean {
  return !!hash && env.AUTH_RESET !== "1";
}

/**
 * 校验一个请求的 Basic 凭据。
 * 与老的同步 authenticate() 相比多了一次 DO 读取（同 colo 内 1-3ms）。
 */
export async function authenticateAsync(req: Request, env: Env): Promise<AuthResult> {
  const creds = readCreds(req);
  if (!creds) return "unauthorized";

  const user = (env.WEBDAV_USER ?? "").trim() || DEFAULT_USER;
  if (!constantTimeEqual(creds.user, user)) return "unauthorized";

  const stored = await customPasswordHash(env);
  if (usingCustomPassword(env, stored)) {
    return (await verifyPassword(creds.pass, stored!)) ? "ok" : "unauthorized";
  }

  const pass = env.WEBDAV_PASS ?? DEFAULT_PASS;
  if (!pass) return "unconfigured";
  return constantTimeEqual(creds.pass, pass) ? "ok" : "unauthorized";
}

/** 旧密码是否就是「当前生效的密码」 */
export async function verifyCurrentPassword(env: Env, input: string): Promise<boolean> {
  const stored = await customPasswordHash(env);
  if (usingCustomPassword(env, stored)) return verifyPassword(input, stored!);
  const pass = env.WEBDAV_PASS ?? DEFAULT_PASS;
  return !!pass && constantTimeEqual(input, pass);
}

export async function saveCustomPassword(env: Env, password: string): Promise<void> {
  await setStoredAuthHash(env, await hashPassword(password));
}
