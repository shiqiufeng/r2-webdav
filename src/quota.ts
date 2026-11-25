import type { Env } from "./types";
import { normalizePath } from "./utils";

/**
 * 容量配额
 *
 * R2 本身没有配额，只能自己算：把桶里的对象全列一遍，把 size 加起来。
 * 这里把「对外宣称的容量」和「实际可用上限」分开：
 *
 *   TOTAL_BYTES = 10 GiB   —— 界面上显示的总额度
 *   LIMIT_BYTES = 9.9 GiB  —— 真正允许写入的天花板
 *
 * 之所以留 0.1 GiB 的余量：进度条永远不会顶到 100%，用户不会以为「还能再塞一点」
 * 然后在上传最后一刻失败；同时给碎片、并发上传留一点缓冲。
 *
 * 成本：全量 list，每页 1000 个对象。桶不大时一页就够；结果在实例内存里缓存 15 秒，
 * 页面每次刷新不会都去扫一遍。
 */

export const TOTAL_BYTES = 10 * 1024 ** 3; // 10 GiB
/** 默认只允许用到总额度的 99%（= 9.9 GiB），留 1% 缓冲 */
export const USABLE_RATIO = 0.99;
export const LIMIT_BYTES = Math.floor(TOTAL_BYTES * USABLE_RATIO); // 9.9 GiB

/**
 * 允许用环境变量调整额度，方便自建实例按需分配，也方便测试：
 *   QUOTA_TOTAL_GB   总额度（GB），默认 10
 *   QUOTA_USABLE_PCT 可用比例（0-1），默认 0.99
 */
export function limits(env: Env): { total: number; limit: number } {
  const gb = Number(env.QUOTA_TOTAL_GB);
  const total =
    Number.isFinite(gb) && gb > 0 ? Math.floor(gb * 1024 ** 3) : TOTAL_BYTES;
  const rawPct = Number(env.QUOTA_USABLE_PCT);
  const ratio =
    Number.isFinite(rawPct) && rawPct > 0 && rawPct <= 1 ? rawPct : USABLE_RATIO;
  return { total, limit: Math.floor(total * ratio) };
}

/** 单次统计最多翻多少页（10 万个对象），防止异常情况下拉爆 subrequest */
const MAX_PAGES = 100;
const CACHE_TTL = 15_000;

export interface Usage {
  /** 已用字节 */
  used: number;
  /** 实际可用上限（9.9 GiB） */
  limit: number;
  /** 对外展示的总额度（10 GiB） */
  total: number;
  /** 文件数（不含目录占位符） */
  files: number;
  /** 目录数 */
  dirs: number;
  /** 统计是否因页数上限被截断（截断时 used 偏小） */
  truncated: boolean;
}

interface CacheEntry {
  at: number;
  usage: Usage;
}

/** 按 isolate 存；跨实例不共享，写操作后前端用 fresh=1 主动绕过 */
let cache: CacheEntry | null = null;
/** 并发去重：UI 一次拖三个文件，三笔 PUT 同时进来，只扫一遍桶 */
let inflight: Promise<Usage> | null = null;

/** 写操作后调用：同一实例上的下一次查询会重新扫 */
export function invalidateUsage(): void {
  cache = null;
}

/** 扫描整个桶，累加所有对象的 size */
export async function getUsage(env: Env, fresh = false): Promise<Usage> {
  if (!fresh) {
    if (cache && Date.now() - cache.at < CACHE_TTL) return cache.usage;
    /* 已经有一笔扫描在跑，直接复用，别重复 list */
    if (inflight) return inflight;
    const p = scanUsage(env);
    inflight = p;
    try {
      return await p;
    } finally {
      if (inflight === p) inflight = null;
    }
  }
  /* fresh 不复用进行中的扫描：那个扫描可能在这次写操作之前就启动了 */
  return scanUsage(env);
}

async function scanUsage(env: Env): Promise<Usage> {
  let cursor: string | undefined;
  let used = 0;
  let files = 0;
  let pages = 0;
  let truncated = false;
  const dirs = new Set<string>();

  do {
    const page = await env.BUCKET.list({ cursor, limit: 1000 });
    for (const obj of page.objects) {
      const key = obj.key;
      /* 目录占位符（以 / 结尾）不占空间，但要算进目录数 */
      if (key.endsWith("/")) {
        const p = key.slice(0, -1);
        if (p) dirs.add(p);
        continue;
      }
      files++;
      used += obj.size;
      const segs = key.split("/");
      let acc = "";
      for (let i = 0; i < segs.length - 1; i++) {
        if (!segs[i]) continue;
        acc = acc ? acc + "/" + segs[i] : segs[i];
        dirs.add(acc);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages++;
    if (cursor && pages >= MAX_PAGES) truncated = true;
  } while (cursor && pages < MAX_PAGES);

  const { total, limit } = limits(env);
  const usage: Usage = {
    used,
    limit,
    total,
    files,
    dirs: dirs.size,
    truncated,
  };
  cache = { at: Date.now(), usage };
  return usage;
}

export interface SpaceCheck {
  ok: boolean;
  usage: Usage;
  /** 这次操作后预计占用的字节 */
  after: number;
  /** 还差多少（ok 为 false 时有意义） */
  lacking: number;
}

/**
 * 检查写入 delta 字节后是否仍然在 LIMIT 以内。
 * delta 可以是负数（删除/覆盖成更小的文件），此时必然通过。
 */
export async function checkSpace(env: Env, delta: number, fresh = false): Promise<SpaceCheck> {
  const usage = await getUsage(env, fresh);
  const after = usage.used + Math.max(0, delta);
  if (delta <= 0 || after <= usage.limit) {
    return { ok: true, usage, after, lacking: 0 };
  }
  return { ok: false, usage, after, lacking: after - usage.limit };
}

function fmtBytes(n: number): string {
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + " " + units[i];
}

/** 507 Insufficient Storage —— WebDAV 对「空间不够」的标准状态码 */
export function insufficientStorage(check: SpaceCheck): Response {
  const body = JSON.stringify({
    error: "insufficient_storage",
    message:
      "云盘空间不足：可用上限 " +
      fmtBytes(check.usage.limit) +
      "，已用 " +
      fmtBytes(check.usage.used) +
      "，还差 " +
      fmtBytes(check.lacking),
    used: check.usage.used,
    limit: check.usage.limit,
    total: check.usage.total,
    lacking: check.lacking,
  });
  return new Response(body, {
    status: 507,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      /* 让 WebDAV 客户端也能读到具体数字 */
      "X-Quota-Used": String(check.usage.used),
      "X-Quota-Limit": String(check.usage.limit),
      "X-Quota-Total": String(check.usage.total),
    },
  });
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * GET /__api/quota[?fresh=1]
 * 返回 { used, limit, total, files, dirs, percent, remaining, nearLimit, full }
 */
export async function handleQuotaApi(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (url.pathname !== "/__api/quota") return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "GET required" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const fresh = url.searchParams.get("fresh") === "1";
  const usage = await getUsage(env, fresh);
  const percent = usage.limit > 0 ? (usage.used / usage.limit) * 100 : 0;
  const remaining = Math.max(0, usage.limit - usage.used);

  return new Response(
    JSON.stringify({
      ...usage,
      percent: Math.min(100, Math.round(percent * 100) / 100),
      remaining,
      /* 85% 起提醒，95% 起算「快满了」 */
      nearLimit: percent >= 85,
      full: usage.used >= usage.limit,
    }),
    { status: 200, headers: JSON_HEADERS }
  );
}

/** 供其它模块复用的路径规范化（保持与 dirstat 一致的越权过滤） */
export function isSafeQuotaPath(p: string): boolean {
  const n = normalizePath(p);
  return n === "/" || !n.split("/").includes("..");
}
