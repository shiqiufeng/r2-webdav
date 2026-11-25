import type { DavRes, Env } from "./types";
import { listMembers, statPath } from "./resources";
import { keyOf } from "./utils";
import { renderShareError, renderSharePage } from "./share-page";
import {
  claimShareDownload,
  createShareRecord,
  getShareRecord,
  hashPassword,
  isDownloadExhausted,
  isExpired,
  listShareRecords,
  newShareId,
  resolveSub,
  revokeShareRecord,
  shareName,
  signAccessToken,
  toView,
  touchShareAccess,
  verifyAccessToken,
  type ShareRecord,
  type ShareView,
} from "./share";

/**
 * 分享相关的路由
 *
 * 分两类：
 * - 公开路径（/s/... 与 /__s/...）：必须绕过 Basic 认证，权限完全由分享记录 + 令牌决定
 * - 管理 API（/__api/shares）：与文件操作同级，走 Basic 认证
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function html(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** 下载额度用尽：浏览器直接打开链接时给 HTML 提示页，脚本调用给 JSON */
function exhaustedResponse(request: Request): Response {
  const accept = request.headers.get("Accept") ?? "";
  if (accept.includes("text/html")) {
    return html(
      410,
      renderShareError("下载次数已用完", "分享者设置的可下载次数已经用完，请联系分享者重新分享。"),
    );
  }
  return json(410, { error: "下载次数已用完" });
}

/** 命中公开分享路径时返回 true，调用方据此在鉴权前分流 */
export function isSharePath(pathname: string): boolean {
  return pathname === "/s" || pathname.startsWith("/s/") || pathname.startsWith("/__s/");
}

export async function handleShareRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  const segments = url.pathname.split("/").filter(Boolean);

  // /s/:id  -> 分享页
  if (segments[0] === "s") {
    if (method !== "GET" && method !== "HEAD") {
      return json(405, { error: "Method Not Allowed" });
    }
    const id = segments[1] ?? "";
    if (!id || !/^[A-Za-z0-9]{4,16}$/.test(id)) {
      return html(404, renderShareError("链接不完整", "这个分享链接看起来少了点什么，请向分享者重新索取。"));
    }
    const rec = await getShareRecord(env, id, true);
    if (!rec) {
      return html(404, renderShareError("分享不存在或已失效", "链接可能已被取消，或者已超过有效期。"));
    }
    if (isExpired(rec)) {
      return html(410, renderShareError("分享已过期", "这个分享已超过有效期，请联系分享者重新分享。"));
    }
    if (isDownloadExhausted(rec)) {
      return html(
        410,
        renderShareError("下载次数已用完", "分享者设置的可下载次数已经用完，请联系分享者重新分享。"),
      );
    }
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return html(200, renderSharePage(rec));
  }

  // /__s/:id/(unlock|list|raw)
  const id = segments[1] ?? "";
  const action = segments[2] ?? "";
  if (!id) return json(404, { error: "not found" });

  const rec = await getShareRecord(env, id, false);
  if (!rec) return json(404, { error: "分享不存在或已失效" });
  if (isExpired(rec)) return json(410, { error: "分享已过期" });

  // 提取码校验：换签名令牌
  if (action === "unlock") {
    if (method !== "POST") return json(405, { error: "Method Not Allowed" });
    let body: { password?: string } = {};
    try {
      body = (await request.json()) as { password?: string };
    } catch {
      return json(400, { error: "请求格式错误" });
    }
    if (rec.needsPassword) {
      const input = (body.password ?? "").trim();
      if (!input) return json(400, { error: "请输入提取码" });
      const hash = await hashPassword(rec.id, input);
      if (!rec.passwordHash || hash !== rec.passwordHash) {
        // 简单节流：错一次就延迟一点，降低暴力枚举速度
        await new Promise((r) => setTimeout(r, 350));
        return json(403, { error: "提取码错误" });
      }
    }
    const signed = await signAccessToken(env, rec.id, 12 * 3600);
    return json(200, { token: signed.token, expiresAt: signed.expiresAt });
  }

  // 以下动作都可能需要令牌
  const token = url.searchParams.get("token") ?? request.headers.get("X-Share-Token") ?? "";
  if (rec.needsPassword) {
    if (!token) return json(401, { error: "需要提取码" });
    const check = await verifyAccessToken(env, token, rec.id);
    if (!check.ok) return json(401, { error: check.reason === "expired" ? "会话已过期" : "需要提取码" });
  }

  if (action === "list") {
    if (method !== "GET") return json(405, { error: "Method Not Allowed" });
    if (!rec.isDir) return json(400, { error: "这不是文件夹分享" });
    const sub = url.searchParams.get("p") ?? "";
    const target = resolveSub(rec.path, sub);
    if (target === null) return json(400, { error: "路径非法" });
    const stat = await statPath(env, target);
    if (!stat || !stat.isDir) return json(404, { error: "文件夹不存在" });
    const members = await listMembers(env, target, 1);
    const items = members.map((m) => ({
      name: m.path.slice(m.path.lastIndexOf("/") + 1),
      rel: relOf(rec.path, m.path),
      isDir: m.isDir,
      size: m.size,
      mtime: m.lastModified,
    }));
    // 目录在前，其次按名称
    items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, "zh") : a.isDir ? -1 : 1));
    return json(200, { items });
  }

  if (action === "raw") {
    if (method !== "GET" && method !== "HEAD") return json(405, { error: "Method Not Allowed" });
    const sub = url.searchParams.get("p") ?? "";
    const target = resolveSub(rec.path, sub);
    if (target === null) return json(400, { error: "路径非法" });
    const inline = url.searchParams.get("inline") === "1";
    /* 预览（inline）与 HEAD 不消耗下载次数，只有真正下载才计数 */
    const counts = !inline && method === "GET";
    if (isDownloadExhausted(rec)) return exhaustedResponse(request);
    if (counts) {
      const claim = await claimShareDownload(env, rec.id);
      if (!claim.ok) {
        if (claim.reason === "expired") {
          return html(410, renderShareError("分享已过期", "这个分享已超过有效期，请联系分享者重新分享。"));
        }
        return exhaustedResponse(request);
      }
    } else {
      await touchShareAccess(env, rec.id);
    }
    const stat = await statPath(env, target);
    if (!stat) return json(404, { error: "文件不存在或已被删除" });
    if (stat.isDir) return json(400, { error: "这是文件夹，请使用页面浏览" });
    return streamFile(env, target, stat, request, method === "HEAD", inline);
  }

  return json(404, { error: "not found" });
}

function relOf(root: string, full: string): string {
  if (root === "/") return full.replace(/^\//, "");
  const prefix = root + "/";
  return full.startsWith(prefix) ? full.slice(prefix.length) : full;
}

/** 单文件流出：支持 Range、ETag、正确的中文文件名 */
async function streamFile(
  env: Env,
  path: string,
  stat: DavRes,
  request: Request,
  headOnly: boolean,
  inline = false,
): Promise<Response> {
  const key = keyOf(path);
  const name = path.slice(path.lastIndexOf("/") + 1);
  const headers: Record<string, string> = {
    "Content-Type": stat.contentType ?? "application/octet-stream",
    "Content-Disposition": inline ? contentDisposition(name, true) : contentDisposition(name),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
  if (stat.etag) headers["ETag"] = stat.etag;
  headers["Last-Modified"] = new Date(stat.lastModified).toUTCString();

  const rangeHeader = request.headers.get("Range");
  const range = rangeHeader ? parseRangeHeader(rangeHeader, stat.size) : null;
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${stat.size}` },
    });
  }
  if (headOnly) return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(stat.size) } });

  if (range) {
    const part = await env.BUCKET.get(key, { range: { offset: range.offset, length: range.length } });
    if (!part || !("body" in part)) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
    }
    return new Response(part.body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(range.length),
        "Content-Range": `bytes ${range.offset}-${range.end}/${stat.size}`,
      },
    });
  }

  const obj = await env.BUCKET.get(key);
  if (!obj || !("body" in obj)) return new Response("文件不存在", { status: 404 });
  return new Response(obj.body, { status: 200, headers: { ...headers, "Content-Length": String(stat.size) } });
}

function parseRangeHeader(
  header: string,
  size: number,
): { offset: number; length: number; end: number } | null | "invalid" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (!startStr && !endStr) return "invalid";
  let start: number;
  let end: number;
  if (!startStr) {
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr ? Number(endStr) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  if (start >= size || start > end) return "invalid";
  if (end >= size) end = size - 1;
  return { offset: start, length: end - start + 1, end };
}

/** RFC 5987 / 6266：中文文件名同时给 ASCII 回退与 UTF-8 编码 */
export function contentDisposition(filename: string, inline = false): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/* ================================================================== */
/* 管理 API（需要 Basic 认证，由 index.ts 在鉴权后调用）               */
/* ================================================================== */

export async function handleShareApi(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/__api/shares")) return null;
  const method = request.method.toUpperCase();
  const rest = url.pathname.slice("/__api/shares".length).replace(/^\//, "");
  const origin = url.origin;

  // POST /__api/shares  创建
  if (!rest && method === "POST") {
    let body: {
      path?: string;
      password?: string;
      expiresIn?: number | null;
      maxDownloads?: number | null;
    } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json(400, { error: "请求格式错误" });
    }
    const path = typeof body.path === "string" ? body.path : "";
    if (!path.startsWith("/")) return json(400, { error: "路径必须以 / 开头" });

    const stat = await statPath(env, path);
    if (!stat) return json(404, { error: "文件不存在" });

    const id = newShareId();
    const rawPassword = typeof body.password === "string" ? body.password.trim() : "";
    const needsPassword = rawPassword.length > 0;
    const ttl = body.expiresIn;
    let expiresAt: number | null = null;
    if (typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0) {
      // 上限 10 年，防止误填天文数字把 Date 溢出成 Invalid Date
      expiresAt = Date.now() + Math.min(Math.floor(ttl), 3650 * 24 * 3600) * 1000;
    }

    /* 下载次数上限：留空 / 0 / 负数 = 不限；上限 100 万次 */
    const rawMax = body.maxDownloads;
    let maxDownloads: number | null = null;
    if (typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 1) {
      maxDownloads = Math.min(Math.floor(rawMax), 1_000_000);
    }

    const rec: ShareRecord = {
      id,
      path: stat.path,
      isDir: stat.isDir,
      name: shareName(stat.path),
      size: stat.isDir ? 0 : stat.size,
      contentType: stat.isDir ? null : stat.contentType,
      createdAt: Date.now(),
      expiresAt,
      passwordHash: needsPassword ? await hashPassword(id, rawPassword) : null,
      needsPassword,
      downloads: 0,
      maxDownloads,
      lastAccess: null,
    };
    await createShareRecord(env, rec);
    const view: ShareView = toView(rec, origin);
    return json(201, { share: view, password: needsPassword ? rawPassword : null });
  }

  // GET /__api/shares  列表
  if (!rest && method === "GET") {
    const records = await listShareRecords(env);
    // 顺手清理源文件已不存在的分享，避免列表里挂着死链接
    const alive: ShareView[] = [];
    const dead: string[] = [];
    for (const rec of records) {
      const stat = await statPath(env, rec.path);
      if (!stat) {
        dead.push(rec.id);
        continue;
      }
      alive.push(toView(rec, origin));
    }
    for (const id of dead) await revokeShareRecord(env, id);
    return json(200, { shares: alive, pruned: dead.length });
  }

  // DELETE /__api/shares  批量删除（body: { ids: string[] }）
  if (!rest && method === "DELETE") {
    let body: { ids?: unknown } = {};
    try {
      body = (await request.json()) as { ids?: unknown };
    } catch {
      return json(400, { error: "请求格式错误" });
    }
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (!ids.length) return json(400, { error: "没有选中要删除的分享" });
    let removed = 0;
    for (const id of ids) {
      if (await revokeShareRecord(env, id)) removed++;
    }
    return json(200, { ok: true, removed });
  }

  // DELETE /__api/shares/:id  取消
  if (rest && method === "DELETE") {
    const removed = await revokeShareRecord(env, rest);
    if (!removed) return json(404, { error: "分享不存在" });
    return json(200, { ok: true });
  }

  return json(405, { error: "Method Not Allowed" });
}
