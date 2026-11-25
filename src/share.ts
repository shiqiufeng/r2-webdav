import type { DavRes, Env } from "./types";
import { escapeText } from "./xml";

/**
 * 分享记录（类似网盘的外链分享）
 *
 * 设计要点：
 * - 记录存在单独的 Durable Object 里（单实例），因为需要「创建/查询/撤销/计数」
 *   这类强一致的小状态；放 KV 会有最终一致延迟，撤销后仍能下载会很难受。
 * - 密码只存哈希（SHA-256(password:shareId)），明文不落库、不回传前端。
 * - 密码校验通过后签发一个短期 token（HMAC-SHA256），下载与列目录都校验 token，
 *   这样浏览器地址栏里的链接本身不含密码。
 */
export interface ShareRecord {
  id: string;
  /** 源资源的规范化路径，根为 "/" */
  path: string;
  isDir: boolean;
  name: string;
  size: number;
  createdAt: number;
  /** null = 永久有效 */
  expiresAt: number | null;
  /** null = 无提取码 */
  passwordHash: string | null;
  /** 是否要求提取码 */
  needsPassword: boolean;
  /** 文件 MIME，用于分享页决定是否内联预览 */
  contentType?: string | null;
  /** 下载次数 */
  downloads: number;
  /** 最近一次访问时间 */
  lastAccess: number | null;
}

/** 对外暴露给前端的视图，去掉哈希 */
export interface ShareView {
  id: string;
  path: string;
  isDir: boolean;
  name: string;
  size: number;
  createdAt: number;
  expiresAt: number | null;
  needsPassword: boolean;
  downloads: number;
  lastAccess: number | null;
  url: string;
}

export function toView(rec: ShareRecord, origin: string): ShareView {
  return {
    id: rec.id,
    path: rec.path,
    isDir: rec.isDir,
    name: rec.name,
    size: rec.size,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    needsPassword: rec.needsPassword,
    downloads: rec.downloads,
    lastAccess: rec.lastAccess,
    url: `${origin}/s/${rec.id}`,
  };
}

/* ================================================================== */
/* 编码 / 哈希 / 签名                                                 */
/* ================================================================== */

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 8 位 base62 分享 id，用 CSPRNG 生成 */
export function newShareId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export async function hashPassword(shareId: string, password: string): Promise<string> {
  return sha256Hex(`${shareId}:${password}`);
}

/** token 签名密钥由 WebDAV 密码派生，无需额外配置 secret */
function tokenKey(env: Env): string {
  return `share-token-v1:${env.WEBDAV_PASS ?? ""}:${env.WEBDAV_USER ?? "admin"}`;
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

/**
 * 签发访问令牌。payload 里带 shareId 与过期时间，
 * 也把 sub（子路径）绑进去，避免用一个 token 越权访问同分享内的其它目录。
 */
export async function signAccessToken(
  env: Env,
  shareId: string,
  ttlSeconds = 3600,
): Promise<{ token: string; expiresAt: number }> {
  const exp = Date.now() + ttlSeconds * 1000;
  const payload = `${shareId}.${exp}`;
  const sig = await hmac(tokenKey(env), payload);
  return { token: `${payload}.${sig}`, expiresAt: exp };
}

export interface TokenCheck {
  ok: boolean;
  reason?: "malformed" | "expired" | "mismatch";
}

export async function verifyAccessToken(
  env: Env,
  token: string,
  shareId: string,
): Promise<TokenCheck> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [id, expStr, sig] = parts;
  if (id !== shareId) return { ok: false, reason: "mismatch" };
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  const expect = await hmac(tokenKey(env), `${id}.${expStr}`);
  // 定长比较，避免时序侧信道泄露签名
  if (expect.length !== sig.length) return { ok: false, reason: "mismatch" };
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "mismatch" };
  if (Date.now() > exp) return { ok: false, reason: "expired" };
  return { ok: true };
}

/* ================================================================== */
/* Durable Object                                                     */
/* ================================================================== */

const KEY_PREFIX = "s:";

type DoRequest =
  | { op: "create"; record: ShareRecord }
  | { op: "get"; id: string; touch?: boolean }
  | { op: "list" }
  | { op: "revoke"; id: string }
  | { op: "hit"; id: string };

interface DoResponse {
  ok: boolean;
  record?: ShareRecord | null;
  records?: ShareRecord[];
  error?: string;
}

export class ShareDO implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    let req: DoRequest;
    try {
      req = (await request.json()) as DoRequest;
    } catch {
      return this.json({ ok: false, error: "bad request" });
    }
    try {
      switch (req.op) {
        case "create":
          return this.json(await this.create(req.record));
        case "get":
          return this.json(await this.get(req.id, req.touch === true));
        case "list":
          return this.json(await this.list());
        case "revoke":
          return this.json(await this.revoke(req.id));
        case "hit":
          return this.json(await this.hit(req.id));
        default:
          return this.json({ ok: false, error: "unknown op" });
      }
    } catch (err) {
      return this.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private json(body: DoResponse): Response {
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async create(record: ShareRecord): Promise<DoResponse> {
    await this.state.storage.put(KEY_PREFIX + record.id, record);
    return { ok: true, record };
  }

  /**
   * 读取记录。这里故意不删过期项 —— 上层需要区分「不存在」(404) 与「已过期」(410)，
   * 一读就删会让过期链接看起来像从来没存在过。真正的回收放在 list 里做。
   */
  private async get(id: string, touch: boolean): Promise<DoResponse> {
    const rec = await this.state.storage.get<ShareRecord>(KEY_PREFIX + id);
    if (!rec) return { ok: true, record: null };
    const expired = rec.expiresAt !== null && Date.now() > rec.expiresAt;
    if (touch && !expired) {
      rec.lastAccess = Date.now();
      await this.state.storage.put(KEY_PREFIX + id, rec);
    }
    return { ok: true, record: rec };
  }

  private async list(): Promise<DoResponse> {
    const map = await this.state.storage.list<ShareRecord>({ prefix: KEY_PREFIX });
    const now = Date.now();
    const garbageLife = 7 * 24 * 3600 * 1000;
    const records: ShareRecord[] = [];
    const garbage: string[] = [];
    for (const [key, rec] of map) {
      if (rec.expiresAt !== null && now > rec.expiresAt) {
        // 过期 7 天后才真正回收，保证期间访问仍能明确告知「已过期」而不是「不存在」
        if (now - rec.expiresAt > garbageLife) garbage.push(key);
        continue;
      }
      records.push(rec);
    }
    if (garbage.length > 0) await this.state.storage.delete(garbage);
    records.sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true, records };
  }

  private async revoke(id: string): Promise<DoResponse> {
    const existed = await this.state.storage.get<ShareRecord>(KEY_PREFIX + id);
    await this.state.storage.delete(KEY_PREFIX + id);
    return { ok: true, record: existed ?? null };
  }

  private async hit(id: string): Promise<DoResponse> {
    const rec = await this.state.storage.get<ShareRecord>(KEY_PREFIX + id);
    if (!rec) return { ok: false, error: "not found" };
    rec.downloads += 1;
    rec.lastAccess = Date.now();
    await this.state.storage.put(KEY_PREFIX + id, rec);
    return { ok: true, record: rec };
  }
}

/* ================================================================== */
/* DO 客户端                                                          */
/* ================================================================== */

function stub(env: Env): DurableObjectStub {
  const ns = env.SHARES;
  return ns.get(ns.idFromName("shares-v1"));
}

async function call(env: Env, req: DoRequest): Promise<DoResponse> {
  const res = await stub(env).fetch("https://share-do/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as DoResponse;
}

export async function createShareRecord(env: Env, record: ShareRecord): Promise<void> {
  const res = await call(env, { op: "create", record });
  if (!res.ok) throw new Error(res.error ?? "create share failed");
}

export async function getShareRecord(
  env: Env,
  id: string,
  touch = false,
): Promise<ShareRecord | null> {
  const res = await call(env, { op: "get", id, touch });
  return res.record ?? null;
}

export async function listShareRecords(env: Env): Promise<ShareRecord[]> {
  const res = await call(env, { op: "list" });
  return res.records ?? [];
}

export async function revokeShareRecord(env: Env, id: string): Promise<ShareRecord | null> {
  const res = await call(env, { op: "revoke", id });
  return res.record ?? null;
}

export async function bumpShareHit(env: Env, id: string): Promise<void> {
  await call(env, { op: "hit", id });
}

/* ================================================================== */
/* 分享页 / 已废弃                                                    */
/* ================================================================== */

export function shareName(path: string, fallback = "未命名"): string {
  if (path === "/") return "根目录";
  const seg = path.slice(path.lastIndexOf("/") + 1);
  return seg || fallback;
}

export function isExpired(rec: ShareRecord): boolean {
  return rec.expiresAt !== null && Date.now() > rec.expiresAt;
}

export function fmtSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

export function escapeHtml(input: string): string {
  return escapeText(input);
}

/** 把相对子路径拼到分享根路径下，并阻止 .. 越权 */
export function resolveSub(sharePath: string, sub: string): string | null {
  if (!sub) return sharePath;
  if (sub.includes("\u0000") || sub.includes("..")) return null;
  const clean = sub.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) return sharePath;
  for (const part of clean.split("/")) {
    if (!part || part === "." || part === "..") return null;
  }
  return sharePath === "/" ? `/${clean}` : `${sharePath}/${clean}`;
}

export type { DavRes };
