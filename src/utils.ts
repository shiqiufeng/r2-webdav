import type { Env, LockRecord } from "./types";

export const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n';

export const ALLOW_METHODS =
  "OPTIONS, GET, HEAD, POST, PROPFIND, PROPPATCH, MKCOL, PUT, DELETE, COPY, MOVE, LOCK, UNLOCK";

/* ------------------------------------------------------------------ */
/* 路径处理                                                            */
/* ------------------------------------------------------------------ */

/** 把 URL pathname 解码为内部规范化路径：无尾斜杠（根除外）、无重复斜杠 */
export function normalizePath(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* 保留原始值 */
  }
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** 内部路径 -> 用于 href 的百分号编码路径 */
export function encodePath(p: string): string {
  if (p === "/") return "/";
  return p
    .split("/")
    .map((seg, idx) => (idx === 0 ? "" : encodeURIComponent(seg)))
    .join("/");
}

/** 内部路径 -> R2 key（根为空串） */
export function keyOf(p: string): string {
  return p === "/" ? "" : p.replace(/^\//, "");
}

/** 内部路径 -> R2 目录前缀（一定以 "/" 结尾；根为 ""） */
export function dirPrefix(p: string): string {
  const k = keyOf(p);
  return k ? k + "/" : "";
}

export function baseName(p: string): string {
  if (p === "/") return "/";
  return p.slice(p.lastIndexOf("/") + 1);
}

export function parentPath(p: string): string {
  if (p === "/") return "/";
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

export function joinPath(parent: string, name: string): string {
  return parent === "/" ? "/" + name : parent + "/" + name;
}

/** child 是否位于 parent 之下（严格子级或相等） */
export function isUnder(child: string, parent: string): boolean {
  if (parent === "/") return child !== "/";
  return child === parent || child.startsWith(parent + "/");
}

/* ------------------------------------------------------------------ */
/* 日期 / 头                                                           */
/* ------------------------------------------------------------------ */

export function httpDate(ms: number): string {
  return new Date(ms).toUTCString();
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

export function parseHttpDate(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** 解析 Timeout 头，返回秒数。默认值取 env.LOCK_TIMEOUT，上限 604800 (7d) */
export function parseTimeout(header: string | null, env: Env): number {
  const fallback = clampTimeout(parseInt(env.LOCK_TIMEOUT ?? "3600", 10) || 3600);
  if (!header) return fallback;
  let best = -1;
  for (const raw of header.split(",")) {
    const t = raw.trim().toLowerCase();
    if (t === "infinite") return 604800;
    const m = /^second-(\d+)$/.exec(t);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > best) best = v;
    }
  }
  if (best < 0) return fallback;
  return clampTimeout(best);
}

export function clampTimeout(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 3600;
  return Math.min(Math.max(Math.floor(seconds), 60), 604800);
}

/* ------------------------------------------------------------------ */
/* If 头 / 条件请求                                                     */
/* ------------------------------------------------------------------ */

const LOCK_TOKEN_PREFIXES = ["opaquelocktoken:", "urn:uuid:"];

/** 从 If 头里抽出所有提交的锁令牌 */
export function ifTokens(req: Request): string[] {
  const header = req.headers.get("If");
  if (!header) return [];
  const out: string[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header)) !== null) {
    const v = m[1].trim();
    if (LOCK_TOKEN_PREFIXES.some((p) => v.toLowerCase().startsWith(p))) out.push(v);
  }
  // Lock-Token 头（UNLOCK / 某些客户端的 PUT）也算提交
  const lt = req.headers.get("Lock-Token");
  if (lt) {
    const v = lt.replace(/[<>]/g, "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** HTTP ETag 比较（兼容 W/ 弱校验前缀） */
function normalizeEtag(tag: string): string {
  let t = tag.trim();
  if (t.startsWith("W/")) t = t.slice(2).trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1);
  return t;
}

function etagListMatches(header: string, etag: string | null): boolean {
  if (header.trim() === "*") return etag !== null;
  if (!etag) return false;
  const want = normalizeEtag(etag);
  return header
    .split(",")
    .map((t) => normalizeEtag(t))
    .some((t) => t === want);
}

export interface ConditionalState {
  etag: string | null;
  lastModified: number | null;
  exists: boolean;
}

/**
 * 写操作前置条件检查（If-Match / If-None-Match / If-Unmodified-Since）。
 * 返回非 null 表示应当直接以此响应终止。
 */
export function checkWritePreconditions(req: Request, state: ConditionalState): Response | null {
  const ifMatch = req.headers.get("If-Match");
  if (ifMatch !== null) {
    if (ifMatch.trim() === "*") {
      if (!state.exists) return new Response("Precondition Failed", { status: 412 });
    } else if (!etagListMatches(ifMatch, state.etag)) {
      return new Response("Precondition Failed", { status: 412 });
    }
  }

  const ifNoneMatch = req.headers.get("If-None-Match");
  if (ifNoneMatch !== null) {
    if (ifNoneMatch.trim() === "*") {
      if (state.exists) return new Response("Precondition Failed", { status: 412 });
    } else if (etagListMatches(ifNoneMatch, state.etag)) {
      return new Response("Precondition Failed", { status: 412 });
    }
  }

  const ifUnmodified = parseHttpDate(req.headers.get("If-Unmodified-Since"));
  if (ifUnmodified !== null && state.lastModified !== null && state.exists) {
    // HTTP 日期精度为秒
    if (Math.floor(state.lastModified / 1000) > Math.floor(ifUnmodified / 1000)) {
      return new Response("Precondition Failed", { status: 412 });
    }
  }

  return null;
}

/** 读操作条件检查，命中返回 304 */
export function checkReadPreconditions(req: Request, state: ConditionalState): Response | null {
  const ifNoneMatch = req.headers.get("If-None-Match");
  if (ifNoneMatch !== null && etagListMatches(ifNoneMatch, state.etag)) {
    return new Response(null, {
      status: 304,
      headers: { ETag: state.etag ?? "" },
    });
  }
  const ifModified = parseHttpDate(req.headers.get("If-Modified-Since"));
  if (ifModified !== null && state.lastModified !== null) {
    if (Math.floor(state.lastModified / 1000) <= Math.floor(ifModified / 1000)) {
      return new Response(null, { status: 304, headers: { ETag: state.etag ?? "" } });
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 鉴权                                                                */
/* ------------------------------------------------------------------ */

function constantTimeEqual(a: string, b: string): boolean {
  // 先对齐长度，再做定长遍历比较，避免长度/前缀时间侧信道
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

export type AuthResult = "ok" | "unauthorized" | "unconfigured";

/** 默认账号密码都是 admin；部署后建议立刻用 wrangler secret 改掉 */
export const DEFAULT_USER = "admin";
export const DEFAULT_PASS = "admin";

export function authenticate(req: Request, env: Env): AuthResult {
  const user = (env.WEBDAV_USER ?? "").trim() || DEFAULT_USER;
  /* 只有显式把 WEBDAV_PASS 设成空串才算「未配置」 */
  const pass = env.WEBDAV_PASS ?? DEFAULT_PASS;
  if (!pass) return "unconfigured";

  const header = req.headers.get("Authorization") ?? "";
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!m) return "unauthorized";

  let decoded = "";
  try {
    decoded = atob(m[1]);
  } catch {
    return "unauthorized";
  }
  const idx = decoded.indexOf(":");
  const gotUser = idx === -1 ? decoded : decoded.slice(0, idx);
  const gotPass = idx === -1 ? "" : decoded.slice(idx + 1);

  const ok = constantTimeEqual(gotUser, user) && constantTimeEqual(gotPass, pass);
  return ok ? "ok" : "unauthorized";
}

export function unauthorizedResponse(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="WebDAV", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
      "MS-Author-Via": "DAV",
    },
  });
}

/* ------------------------------------------------------------------ */
/* 通用响应                                                            */
/* ------------------------------------------------------------------ */

export const DAV_HEADERS: Record<string, string> = {
  DAV: "1, 2",
  "MS-Author-Via": "DAV",
  "Accept-Ranges": "bytes",
};

export function textResponse(status: number, body: string, extra?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...DAV_HEADERS,
      ...(extra as Record<string, string> | undefined),
    },
  });
}

export function emptyResponse(status: number, extra?: Record<string, string>): Response {
  return new Response(null, {
    status,
    headers: { ...DAV_HEADERS, "Content-Length": "0", ...extra },
  });
}

export function isReadOnly(env: Env): boolean {
  return (env.READ_ONLY ?? "0").trim() === "1";
}

/* ------------------------------------------------------------------ */
/* MIME 推断                                                          */
/* ------------------------------------------------------------------ */

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
  ico: "image/x-icon",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  aac: "audio/aac",
  pdf: "application/pdf", json: "application/json", xml: "application/xml",
  zip: "application/zip", gz: "application/gzip", tar: "application/x-tar",
  "7z": "application/x-7z-compressed", rar: "application/vnd.rar",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv",
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
  mjs: "text/javascript", ts: "text/plain", jsx: "text/plain", tsx: "text/plain",
  yml: "text/plain", yaml: "text/plain", toml: "text/plain", ini: "text/plain",
  sh: "text/x-shellscript", py: "text/x-python", go: "text/plain", rs: "text/plain",
  java: "text/plain", c: "text/plain", cpp: "text/plain", h: "text/plain",
  log: "text/plain", sql: "text/plain",
};

/** 按扩展名推断 MIME；未知类型返回 application/octet-stream */
export function mimeOf(path: string): string {
  const idx = path.lastIndexOf(".");
  if (idx === -1 || idx < path.lastIndexOf("/")) return "application/octet-stream";
  const ext = path.slice(idx + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
