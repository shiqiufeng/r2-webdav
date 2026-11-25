import type { DavRes, Env, LockRecord, PropName } from "./types";
import {
  ALLOW_METHODS,
  DAV_HEADERS,
  baseName,
  checkReadPreconditions,
  checkWritePreconditions,
  emptyResponse,
  encodePath,
  httpDate,
  ifTokens,
  isReadOnly,
  keyOf,
  mimeOf,
  normalizePath,
  parseTimeout,
  textResponse,
  unauthorizedResponse,
} from "./utils";
import {
  createDirectoryMarker,
  createEmptyFile,
  copyTree,
  listMembers,
  removeTree,
  statPath,
} from "./resources";
import {
  NS_DAV,
  buildLockResponse,
  buildMultiStatus,
  renderResponse,
} from "./props";
import {
  acquireLock,
  checkLocks,
  listAllLocks,
  locksForPath,
  refreshLock,
  releaseLock,
  releaseLocksUnder,
} from "./lock";
import { escapeXml, findChild, parseXml, serializeXml, type XmlNode } from "./xml";
import { renderUi } from "./ui";
import { handleShareApi, handleShareRoute, isSharePath } from "./share-api";
import { clearDirStatCache, handleDirStatApi, statDirTree } from "./dirstat";
import { checkSpace, handleQuotaApi, insufficientStorage, invalidateUsage } from "./quota";
import { handlePreviewApi, verifyPreviewToken } from "./preview";
import { isFaststartCandidate, planFaststart, streamVirtualRange } from "./mp4";
import { authenticateAsync } from "./auth";
import { handleAccountApi } from "./account-api";
import { handleDonateAsset } from "./qr";

export { LockDO } from "./lock";
export { ShareDO } from "./share";

/* ================================================================== */
/* 入口                                                               */
/* ================================================================== */

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResponse(500, `Internal Server Error\n${message}`);
    }
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return handleOptions(request);

  /* 预览签名直链：<video>/<audio>/<iframe> 带不上 Authorization 头，
     用短期 HMAC 令牌代替凭据。必须先于 Basic 认证，否则播放器拿到 401 就废了。 */
  if (url.pathname.startsWith("/__p/")) return handleSignedPreview(request, env, url);

  /* 打赏二维码：几十 KB 的图片，公开可读（<img> 带不上 Basic 头），长缓存 */
  const donate = handleDonateAsset(url, method);
  if (donate) return donate;

  /* 外链分享：/s/:id 页面与 /__s/:id/* 数据接口。权限完全由分享记录 + 提取码令牌决定，
     必须先于 Basic 认证处理，否则没凭据的访客会被 401 拦住。 */
  if (isSharePath(url.pathname)) return handleShareRoute(request, env, url);

  /* 浏览器访问根路径 -> 文件管理器单页应用。
     页面本身不含任何数据，匿名可取得；只有凭据校验通过时才会把 base64 注入页面，
     真正的文件读写仍由前端逐次携带 Basic 凭据完成。 */
  if (isUiRequest(url, request, method)) return serveUi(request, env, method);

  const auth = await authenticateAsync(request, env);
  if (auth === "unconfigured") {
    return textResponse(
      500,
      "WebDAV 未配置密码。请先执行：\n  npx wrangler secret put WEBDAV_PASS\n（可选）npx wrangler secret put WEBDAV_USER"
    );
  }
  if (auth === "unauthorized") {
    /* 前端 UI 的请求带 X-DAV-UI 标记：不回 WWW-Authenticate。
       浏览器一旦看到 Basic 质询会尝试自己的认证流程，fetch 会一直挂起直到超时，
       UI 就拿不到 401 去提示“密码错误”。WebDAV 客户端不带该头，行为不变。 */
    if (request.headers.get("X-DAV-UI")) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return unauthorizedResponse();
  }

  /* 分享管理 API（创建 / 列表 / 取消）与文件操作同级，需要 Basic 认证 */
  const shareApi = await handleShareApi(request, env, url);
  if (shareApi) return shareApi;

  /* 目录统计：文件夹的递归大小与条目数，同样需要 Basic 认证 */
  const dirStat = await handleDirStatApi(request, env, url);
  if (dirStat) return dirStat;

  /* 容量配额：已用 / 10 GB，硬上限 9.9 GB */
  const quota = await handleQuotaApi(request, env, url);
  if (quota) return quota;

  /* 账号信息与修改密码（必须带原密码） */
  const account = await handleAccountApi(request, env, url);
  if (account) return account;

  /* 预览直链签发：用 Basic 凭据换一个短期签名地址 */
  const previewApi = await handlePreviewApi(request, env, url);
  if (previewApi) return previewApi;

  const path = normalizePath(url.pathname);

  switch (method) {
    case "PROPFIND":
      return handlePropfind(request, env, path);
    case "PROPPATCH":
      return handleProppatch(request, env, path);
    case "GET":
    case "HEAD":
      return handleGet(request, env, path, method === "HEAD");
    case "PUT":
      return handlePut(request, env, path);
    case "DELETE":
      return handleDelete(request, env, path);
    case "MKCOL":
      return handleMkcol(request, env, path);
    case "COPY":
    case "MOVE":
      return handleCopyMove(request, env, path, method === "MOVE");
    case "LOCK":
      return handleLock(request, env, path);
    case "UNLOCK":
      return handleUnlock(request, env, path);
    default:
      return textResponse(405, "Method Not Allowed", { Allow: ALLOW_METHODS });
  }
}

/* ================================================================== */
/* 浏览器文件管理器                                                    */
/* ================================================================== */

/** 只在浏览器直接打开根路径时命中；WebDAV 客户端的 PROPFIND/GET 不受影响 */
function isUiRequest(url: URL, request: Request, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const p = url.pathname;
  if (p !== "/" && p !== "/index.html" && p !== "/__ui") return false;
  return (request.headers.get("Accept") ?? "").includes("text/html");
}

async function serveUi(request: Request, env: Env, method: string): Promise<Response> {
  let initAuth = "";
  if ((await authenticateAsync(request, env)) === "ok") {
    const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec((request.headers.get("Authorization") ?? "").trim());
    if (m) initAuth = m[1];
  }
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    // 只有注入凭据时才禁止缓存，公开的登录页允许短缓存
    "Cache-Control": initAuth ? "no-store" : "no-cache",
  };
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(renderUi(initAuth, (env.WEBDAV_USER ?? "admin").trim()), { status: 200, headers });
}

/* ================================================================== */
/* OPTIONS                                                            */
/* ================================================================== */

function handleOptions(request: Request): Response {
  const headers: Record<string, string> = {
    ...DAV_HEADERS,
    Allow: ALLOW_METHODS,
    "Content-Length": "0",
    "Accept-Ranges": "bytes",
    "MS-Author-Via": "DAV",
  };
  const origin = request.headers.get("Origin");
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Access-Control-Allow-Methods"] = ALLOW_METHODS;
    headers["Access-Control-Allow-Headers"] =
      "Authorization, Content-Type, Depth, Destination, If, Lock-Token, Overwrite, Timeout, Range, X-Requested-With";
    headers["Access-Control-Expose-Headers"] = "DAV, ETag, Lock-Token, Content-Length, Content-Range";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(null, { status: 200, headers });
}

/* ================================================================== */
/* 预览签名直链                                                        */
/* ================================================================== */

/**
 * GET /__p/<token>
 *
 * 令牌把路径本身也签进去，所以拿不到别人的文件；过期时间 2 小时。
 * 这里直接复用 handleGet，Range / ETag / 206 全部照旧，
 * 只额外把 Content-Disposition 改成 inline —— 即使上传时被标成 attachment，
 * 在预览器里也要内联渲染而不是触发下载。
 *
 * mp4 系先尝试 faststart 重排：moov 在文件尾部时浏览器必会再发一条尾部 Range，
 * 该并发请求在部分代理链路上会挂死，播放器就一直转圈。重排成 moov 在前可彻底避免。
 */
async function handleSignedPreview(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(405, "Method Not Allowed", { Allow: "GET, HEAD" });
  }
  const token = url.pathname.slice("/__p/".length);
  const path = await verifyPreviewToken(env, token);
  if (!path) return textResponse(403, "预览链接已过期，请刷新页面后重试");

  if (isFaststartCandidate(baseName(path))) {
    const fast = await handleFaststartPreview(request, env, path);
    if (fast) return fast;
  }

  const res = await handleGet(request, env, path, request.method === "HEAD");
  if (!res.ok) return res;

  const headers = new Headers(res.headers);
  const name = baseName(path);
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  headers.set("Cache-Control", "private, max-age=600");
  if (!headers.get("Content-Type") || headers.get("Content-Type") === "application/octet-stream") {
    headers.set("Content-Type", mimeOf(name));
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * 用 FixedLengthStream 包一层，让运行时保留 Content-Length（否则会退化成 chunked）。
 * 播放器拿到准确长度后拖进度条、判断缓冲更稳；运行时不支持时原样返回。
 */
function fixedLengthBody(stream: ReadableStream<Uint8Array>, length: number): ReadableStream {
  const Ctor = (globalThis as unknown as { FixedLengthStream?: new (n: number) => {
    readable: ReadableStream;
    writable: WritableStream;
  } }).FixedLengthStream;
  if (typeof Ctor !== "function") return stream;
  const { readable, writable } = new Ctor(length);
  void stream.pipeTo(writable).catch(() => {});
  return readable;
}

/**
 * mp4 / m4v / mov 的 faststart 预览。
 * 返回 null 表示不适用（布局异常、索引过大、读取失败…），调用方回退原始字节流。
 */
async function handleFaststartPreview(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  const key = keyOf(path);
  const obj = await env.BUCKET.head(key);
  if (!obj || obj.size < 2048) return null;

  const plan = await planFaststart(env, key, obj.size);
  if (!plan) return null;

  const name = baseName(path);
  const headers: Record<string, string> = {
    ...DAV_HEADERS,
    ETag: obj.httpEtag,
    "Last-Modified": httpDate(obj.uploaded.getTime()),
    "Content-Type": obj.httpMetadata?.contentType ?? mimeOf(name),
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, max-age=600",
    "Accept-Ranges": "bytes",
  };
  if (!headers["Content-Type"] || headers["Content-Type"] === "application/octet-stream") {
    headers["Content-Type"] = mimeOf(name);
  }

  const notModified = checkReadPreconditions(request, {
    etag: obj.httpEtag,
    lastModified: obj.uploaded.getTime(),
    exists: true,
  });
  if (notModified) return notModified;

  const rangeHeader = request.headers.get("Range");
  const range = rangeHeader ? parseRange(rangeHeader, obj.size) : null;
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${obj.size}` },
    });
  }

  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { ...headers, "Content-Length": String(obj.size) },
    });
  }

  if (range) {
    const body = await streamVirtualRange(env, key, plan, range.offset, range.length);
    if (!body) return null;
    return new Response(fixedLengthBody(body, range.length), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(range.length),
        "Content-Range": `bytes ${range.offset}-${range.end}/${obj.size}`,
      },
    });
  }

  const body = await streamVirtualRange(env, key, plan, 0, obj.size);
  if (!body) return null;
  return new Response(fixedLengthBody(body, obj.size), {
    status: 200,
    headers: { ...headers, "Content-Length": String(obj.size) },
  });
}

/* ================================================================== */
/* PROPFIND                                                           */
/* ================================================================== */

interface PropfindBody {
  requested: PropName[] | null; // null = allprop
  propname: boolean;
}

function parsePropfindBody(body: string): PropfindBody {
  if (!body.trim()) return { requested: null, propname: false };
  const root = parseXml(body);
  if (!root || root.local.toLowerCase() !== "propfind") return { requested: null, propname: false };

  for (const node of root.children) {
    const name = node.local.toLowerCase();
    if (name === "propname") return { requested: [], propname: true };
    if (name === "allprop") return { requested: null, propname: false };
    if (name === "prop") {
      const props: PropName[] = node.children.map((c) => ({
        uri: c.uri,
        name: c.local,
      }));
      return { requested: props, propname: false };
    }
  }
  return { requested: null, propname: false };
}

async function handlePropfind(request: Request, env: Env, path: string): Promise<Response> {
  const depthHeader = (request.headers.get("Depth") ?? "1").trim().toLowerCase();
  const depth = depthHeader === "0" ? 0 : depthHeader === "infinity" ? Infinity : 1;

  const body = await request.text();
  const { requested, propname } = parsePropfindBody(body);

  const self = await statPath(env, path);
  if (!self) return textResponse(404, "Not Found");

  const members: DavRes[] = [self];
  if (self.isDir && depth > 0) {
    members.push(...(await listMembers(env, path, depth)));
  }

  const locks = await listAllLocks(env);
  const responses = members.map((res) =>
    renderResponse(res, requested, propname, locksForPath(res.path, locks))
  );

  return new Response(buildMultiStatus(responses), {
    status: 207,
    headers: {
      ...DAV_HEADERS,
      "Content-Type": 'application/xml; charset="utf-8"',
    },
  });
}

/* ================================================================== */
/* PROPPATCH                                                          */
/* ================================================================== */

async function handleProppatch(request: Request, env: Env, path: string): Promise<Response> {
  if (isReadOnly(env)) return textResponse(403, "Read-only mount");

  const self = await statPath(env, path);
  if (!self) return textResponse(404, "Not Found");

  const lock = await checkLocks(env, path, ifTokens(request), false);
  if (!lock.ok && lock.conflict) return lockedResponse(lock.conflict);

  const body = await request.text();
  const root = parseXml(body);
  if (!root) return textResponse(400, "Bad Request");

  // 收集 set/remove 中出现的属性名，统一按 200 OK 回执（R2 无 dead-property 持久层，
  // 但对 Win32* 等客户端属性返回成功可避免 Office/资源管理器反复重试）
  const props: PropName[] = [];
  for (const op of root.children) {
    const propNode = findChild(op, "prop");
    if (!propNode) continue;
    for (const c of propNode.children) props.push({ uri: c.uri, name: c.local });
  }

  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<D:multistatus xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:">' +
    `<D:response><D:href>${encodePath(self.path)}${self.isDir && self.path !== "/" ? "/" : ""}</D:href>` +
    `<D:propstat><D:prop>${props
      .map((p) => {
        const prefix = p.uri === NS_DAV ? "D:" : "Z:";
        return `<${prefix}${p.name}/>`;
      })
      .join("")}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>` +
    "</D:response></D:multistatus>";

  return new Response(xml, {
    status: 207,
    headers: { ...DAV_HEADERS, "Content-Type": 'application/xml; charset="utf-8"' },
  });
}

/* ================================================================== */
/* GET / HEAD                                                         */
/* ================================================================== */

interface RangeSpec {
  offset: number;
  length: number;
  end: number;
}

function parseRange(header: string, size: number): RangeSpec | null | "invalid" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const rawStart = m[1];
  const rawEnd = m[2];
  if (!rawStart && !rawEnd) return "invalid";

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd ? parseInt(rawEnd, 10) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  if (start > end || start >= size) return "invalid";
  if (end > size - 1) end = size - 1;
  return { offset: start, length: end - start + 1, end };
}

async function handleGet(
  request: Request,
  env: Env,
  path: string,
  headOnly: boolean
): Promise<Response> {
  const key = keyOf(path);

  if (path !== "/") {
    const obj = await env.BUCKET.head(key);
    if (obj) {
      const headers: Record<string, string> = {
        ...DAV_HEADERS,
        ETag: obj.httpEtag,
        "Last-Modified": httpDate(obj.uploaded.getTime()),
        "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
        "Content-Length": String(obj.size),
      };
      if (obj.httpMetadata?.contentDisposition) {
        headers["Content-Disposition"] = obj.httpMetadata.contentDisposition;
      }
      if (obj.httpMetadata?.cacheControl) headers["Cache-Control"] = obj.httpMetadata.cacheControl;
      if (obj.httpMetadata?.contentEncoding) {
        headers["Content-Encoding"] = obj.httpMetadata.contentEncoding;
      }

      const notModified = checkReadPreconditions(request, {
        etag: obj.httpEtag,
        lastModified: obj.uploaded.getTime(),
        exists: true,
      });
      if (notModified) return notModified;

      const rangeHeader = request.headers.get("Range");
      const range = rangeHeader ? parseRange(rangeHeader, obj.size) : null;
      if (range === "invalid") {
        return new Response(null, {
          status: 416,
          headers: { ...headers, "Content-Range": `bytes */${obj.size}` },
        });
      }

      if (headOnly) return new Response(null, { status: 200, headers });

      if (range) {
        const partial = await env.BUCKET.get(key, {
          range: { offset: range.offset, length: range.length },
        });
        if (!partial || !("body" in partial)) {
          return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${obj.size}` } });
        }
        return new Response(partial.body, {
          status: 206,
          headers: {
            ...headers,
            "Content-Length": String(range.length),
            "Content-Range": `bytes ${range.offset}-${range.end}/${obj.size}`,
          },
        });
      }

      const full = await env.BUCKET.get(key);
      if (!full || !("body" in full)) return textResponse(404, "Not Found");
      return new Response(full.body, { status: 200, headers });
    }
  }

  // 集合：返回 HTML 目录页，便于浏览器直接访问验证
  const dir = await statPath(env, path);
  if (!dir || !dir.isDir) return textResponse(404, "Not Found");

  const members = await listMembers(env, path, 1);
  const html = renderHtmlListing(path, members);
  if (headOnly) {
    return new Response(null, {
      status: 200,
      headers: {
        ...DAV_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(new TextEncoder().encode(html).byteLength),
      },
    });
  }
  return new Response(html, {
    status: 200,
    headers: { ...DAV_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

function renderHtmlListing(path: string, members: DavRes[]): string {
  const rows = members
    .slice()
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.path.localeCompare(b.path, "zh-CN");
    })
    .map((m) => {
      const name = encodeURIComponent(baseName(m.path)) + (m.isDir ? "/" : "");
      const icon = m.isDir ? "&#128193;" : "&#128196;";
      const size = m.isDir ? "-" : formatSize(m.size);
      const time = new Date(m.lastModified).toLocaleString("zh-CN", { hour12: false });
      return `<tr><td>${icon} <a href="${name}">${escapeXml(baseName(m.path))}${m.isDir ? "/" : ""}</a></td><td>${size}</td><td>${time}</td></tr>`;
    })
    .join("");

  const parent = path === "/" ? "" : `<p><a href="../">../ 上级目录</a></p>`;

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(path)}</title>
<style>
:root{color-scheme:light}
body{font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,"Microsoft YaHei",sans-serif;margin:0;padding:28px;background:#f7f8fa;color:#1f2328}
h1{font-size:18px;font-weight:600;margin:0 0 4px}
.meta{color:#6b7280;font-size:13px;margin-bottom:18px}
table{border-collapse:collapse;width:100%;max-width:900px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:9px 14px;border-bottom:1px solid #f0f1f3;font-size:14px}
th{background:#fafbfc;color:#57606a;font-weight:600;font-size:13px}
tr:last-child td{border-bottom:none}
a{color:#0969da;text-decoration:none}
a:hover{text-decoration:underline}
td:nth-child(2){width:110px;color:#6b7280}
td:nth-child(3){width:190px;color:#6b7280}
</style></head><body>
<h1>${escapeXml(path)}</h1>
<div class="meta">WebDAV over Cloudflare R2 &middot; DAV Class 1 / 2</div>
${parent}
<table><thead><tr><th>名称</th><th>大小</th><th>修改时间</th></tr></thead><tbody>${rows || '<tr><td colspan="3" style="color:#9ca3af">空目录</td></tr>'}</tbody></table>
</body></html>`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

/* ================================================================== */
/* PUT                                                                */
/* ================================================================== */

async function handlePut(request: Request, env: Env, path: string): Promise<Response> {
  if (isReadOnly(env)) return textResponse(403, "Read-only mount");
  if (path === "/") return textResponse(405, "Method Not Allowed");

  const key = keyOf(path);
  const existing = await env.BUCKET.head(key);

  const precondition = checkWritePreconditions(request, {
    etag: existing?.httpEtag ?? null,
    lastModified: existing?.uploaded.getTime() ?? null,
    exists: existing !== null,
  });
  if (precondition) return precondition;

  const lock = await checkLocks(env, path, ifTokens(request), false);
  if (!lock.ok && lock.conflict) return lockedResponse(lock.conflict);

  /* ---------- 容量检查 ----------
     覆盖已有文件时只算增量；Content-Length 缺失（chunked）就写完再核一次。 */
  const existingSize = existing?.size ?? 0;
  const rawLen = request.headers.get("Content-Length");
  const declaredLen = rawLen === null || rawLen === "" ? NaN : Number(rawLen);
  let verifyAfterWrite = false;
  if (Number.isFinite(declaredLen) && declaredLen >= 0) {
    const space = await checkSpace(env, declaredLen - existingSize);
    if (!space.ok) return insufficientStorage(space);
  } else {
    verifyAfterWrite = true;
  }

  /* 客户端没给有效 Content-Type 时按扩展名推断 —— 否则图片/视频会存成
     application/octet-stream，分享页与浏览器都无法内联预览。 */
  const declared = (request.headers.get("Content-Type") ?? "").trim();
  const contentType =
    !declared || declared === "application/octet-stream" ? mimeOf(path) : declared;
  const httpMetadata: R2HTTPMetadata = { contentType };
  const cacheControl = request.headers.get("Cache-Control");
  if (cacheControl) httpMetadata.cacheControl = cacheControl;
  const contentDisposition = request.headers.get("Content-Disposition");
  if (contentDisposition) httpMetadata.contentDisposition = contentDisposition;

  const put = await env.BUCKET.put(key, request.body, { httpMetadata });
  clearDirStatCache(); // 父目录的大小/条目数变了
  invalidateUsage();

  /* 没有 Content-Length 时无法事前判断，只能写完后核一遍；超了就回滚 */
  if (verifyAfterWrite) {
    const space = await checkSpace(env, 0, true);
    if (space.usage.used > space.usage.limit) {
      await env.BUCKET.delete(key);
      clearDirStatCache();
      invalidateUsage();
      return insufficientStorage({
        ok: false,
        usage: space.usage,
        after: space.usage.used,
        lacking: space.usage.used - space.usage.limit,
      });
    }
  }

  return new Response(null, {
    status: existing ? 204 : 201,
    headers: {
      ...DAV_HEADERS,
      ETag: put.httpEtag,
      "Last-Modified": httpDate(put.uploaded.getTime()),
      "Content-Length": "0",
    },
  });
}

/* ================================================================== */
/* DELETE                                                             */
/* ================================================================== */

async function handleDelete(request: Request, env: Env, path: string): Promise<Response> {
  if (isReadOnly(env)) return textResponse(403, "Read-only mount");
  if (path === "/") return textResponse(403, "Cannot delete root collection");

  const target = await statPath(env, path);
  if (!target) return textResponse(404, "Not Found");

  const precondition = checkWritePreconditions(request, {
    etag: target.etag,
    lastModified: target.lastModified,
    exists: true,
  });
  if (precondition) return precondition;

  const lock = await checkLocks(env, path, ifTokens(request), target.isDir);
  if (!lock.ok && lock.conflict) return lockedResponse(lock.conflict);

  await removeTree(env, path);
  await releaseLocksUnder(env, path);
  clearDirStatCache();
  invalidateUsage();
  return emptyResponse(204);
}

/* ================================================================== */
/* MKCOL                                                              */
/* ================================================================== */

async function handleMkcol(request: Request, env: Env, path: string): Promise<Response> {
  if (isReadOnly(env)) return textResponse(403, "Read-only mount");
  if (path === "/") return textResponse(405, "Method Not Allowed");

  const body = await request.text();
  if (body.trim().length > 0) return textResponse(415, "MKCOL with body is not supported");

  const existing = await env.BUCKET.head(keyOf(path));
  if (existing) return textResponse(405, "Resource already exists");

  const probe = await env.BUCKET.list({ prefix: `${keyOf(path)}/`, limit: 1 });
  if (probe.objects.length > 0) return textResponse(405, "Collection already exists");

  const lock = await checkLocks(env, path, ifTokens(request), false);
  if (!lock.ok && lock.conflict) return lockedResponse(lock.conflict);

  await createDirectoryMarker(env, path);
  clearDirStatCache();
  invalidateUsage();
  return emptyResponse(201);
}

/* ================================================================== */
/* COPY / MOVE                                                        */
/* ================================================================== */

function destinationPath(request: Request): string | null {
  const header = request.headers.get("Destination");
  if (!header) return null;
  try {
    const url = new URL(header, "https://placeholder.invalid/");
    return normalizePath(url.pathname);
  } catch {
    return null;
  }
}

async function handleCopyMove(
  request: Request,
  env: Env,
  srcPath: string,
  isMove: boolean
): Promise<Response> {
  if (isReadOnly(env)) return textResponse(403, "Read-only mount");

  const dstPath = destinationPath(request);
  if (!dstPath) return textResponse(400, "Destination header required");
  if (dstPath === srcPath) return textResponse(403, "Source and destination are identical");
  if (dstPath === "/") return textResponse(403, "Cannot overwrite root collection");
  if (isMove && dstPath.startsWith(srcPath + "/")) {
    return textResponse(409, "Cannot move a collection into itself");
  }

  const src = await statPath(env, srcPath);
  if (!src) return textResponse(404, "Source not found");

  const tokens = ifTokens(request);
  if (isMove) {
    const srcLock = await checkLocks(env, srcPath, tokens, src.isDir);
    if (!srcLock.ok && srcLock.conflict) return lockedResponse(srcLock.conflict);
  }

  const dst = await statPath(env, dstPath);
  const overwrite = (request.headers.get("Overwrite") ?? "T").trim().toUpperCase() !== "F";
  if (dst && !overwrite) return textResponse(412, "Destination exists and Overwrite is F");

  const dstLock = await checkLocks(env, dstPath, tokens, !!dst);
  if (!dstLock.ok && dstLock.conflict) return lockedResponse(dstLock.conflict);

  /* COPY 会让桶里多一份数据，需要配额；MOVE 只是改 key，总量不变 */
  if (!isMove) {
    const incoming = src.isDir ? (await statDirTree(env, srcPath)).size : src.size;
    const replaced = dst ? (dst.isDir ? (await statDirTree(env, dstPath)).size : dst.size) : 0;
    const space = await checkSpace(env, incoming - replaced);
    if (!space.ok) return insufficientStorage(space);
  }

  if (dst) await removeTree(env, dstPath);

  const ok = await copyTree(env, srcPath, dstPath);
  if (!ok) return textResponse(500, "Copy failed");
  clearDirStatCache();
  invalidateUsage();

  if (isMove) {
    await removeTree(env, srcPath);
    // 锁不随资源迁移：源 URL 消失后释放其上的锁
    await releaseLocksUnder(env, srcPath);
  }

  return emptyResponse(dst ? 204 : 201);
}

/* ================================================================== */
/* LOCK / UNLOCK                                                      */
/* ================================================================== */

function parseLockInfo(root: XmlNode | null): {
  scope: "exclusive" | "shared";
  owner: string;
} | null {
  if (!root) return null;
  const scopeNode = findChild(root, "lockscope");
  if (!scopeNode) return null;
  const shared = findChild(scopeNode, "shared");
  const exclusive = findChild(scopeNode, "exclusive");
  if (!shared && !exclusive) return null;

  const ownerNode = findChild(root, "owner");
  let owner = "";
  if (ownerNode) {
    owner = ownerNode.children.length > 0
      ? ownerNode.children.map(serializeXml).join("")
      : escapeXml(ownerNode.text.trim());
  }
  return { scope: shared ? "shared" : "exclusive", owner };
}

function lockedResponse(lock: LockRecord): Response {
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<D:error xmlns:D="DAV:"><D:lock-token-submitted><D:href>' +
    encodePath(lock.path) +
    "</D:href></D:lock-token-submitted></D:error>";
  return new Response(xml, {
    status: 423,
    headers: { ...DAV_HEADERS, "Content-Type": 'application/xml; charset="utf-8"' },
  });
}

async function handleLock(request: Request, env: Env, path: string): Promise<Response> {
  const tokens = ifTokens(request);
  const timeout = parseTimeout(request.headers.get("Timeout"), env);
  const depthHeader = (request.headers.get("Depth") ?? "infinity").trim().toLowerCase();
  const depth: -1 | 0 = depthHeader === "0" ? 0 : -1;

  const body = await request.text();

  // 空 body -> 刷新已有锁（RFC 4918 9.10.2）
  if (!body.trim()) {
    const refreshed = await refreshLock(env, path, timeout, tokens);
    if (!refreshed.ok || !refreshed.lock) {
      return new Response(
        '<?xml version="1.0" encoding="utf-8"?>\n<D:error xmlns:D="DAV:"><D:precondition-failed/></D:error>',
        { status: 412, headers: { ...DAV_HEADERS, "Content-Type": 'application/xml; charset="utf-8"' } }
      );
    }
    return new Response(buildLockResponse(refreshed.lock), {
      status: 200,
      headers: {
        ...DAV_HEADERS,
        "Content-Type": 'application/xml; charset="utf-8"',
        "Lock-Token": `<${refreshed.lock.token}>`,
      },
    });
  }

  const root = parseXml(body);
  if (!root || root.local.toLowerCase() !== "lockinfo") {
    return textResponse(400, "Malformed LOCK body");
  }

  const info = parseLockInfo(root);
  if (!info) return textResponse(400, "Unsupported lockscope");

  const locktype = findChild(root, "locktype");
  if (locktype && !findChild(locktype, "write")) {
    return textResponse(400, "Only write locks are supported");
  }

  // 资源不存在时创建空资源（lock-null resource）
  const existing = await statPath(env, path);
  let created = false;
  if (!existing) {
    if (path === "/" || path.endsWith("/")) return textResponse(409, "Parent collection missing");
    await createEmptyFile(env, path);
    created = true;
  }

  const result = await acquireLock(env, path, depth, info.scope, info.owner, timeout, tokens);
  if (!result.ok || !result.lock) {
    return result.conflict ? lockedResponse(result.conflict) : textResponse(423, "Lock conflict");
  }

  return new Response(buildLockResponse(result.lock), {
    status: created ? 201 : 200,
    headers: {
      ...DAV_HEADERS,
      "Content-Type": 'application/xml; charset="utf-8"',
      "Lock-Token": `<${result.lock.token}>`,
    },
  });
}

async function handleUnlock(request: Request, env: Env, path: string): Promise<Response> {
  const raw = request.headers.get("Lock-Token");
  if (!raw) return textResponse(400, "Lock-Token header required");
  const token = raw.replace(/[<>]/g, "").trim();
  if (!token) return textResponse(400, "Lock-Token header required");

  const result = await releaseLock(env, path, token);
  if (!result.ok) return textResponse(409, "Lock token does not match any lock on this resource");
  return emptyResponse(204);
}

/* ================================================================== */
/* 保留：集合创建辅助（供后续扩展，当前 PUT 依赖前缀即可推导目录）      */
/* ================================================================== */
