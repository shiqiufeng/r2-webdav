import type { Env } from "./types";
import { dirPrefix, normalizePath } from "./utils";

/**
 * 目录统计
 *
 * R2 是平面 KV，没有「目录大小」这个概念 —— 一个 key 只有自己的 size。
 * 想要显示文件夹的总大小与条目数，只能把该前缀下的所有对象列一遍累加。
 *
 * 成本控制：
 * - 单次最多翻 10 页（1 万个对象），超出标记 truncated，前端显示「≥」；
 * - 结果在实例内存里缓存 20 秒，重复进出同一目录不会反复 list；
 * - 写操作（PUT/DELETE/MKCOL/MOVE/COPY）后由 index.ts 调用 clearDirStatCache()
 *   把缓存整体清掉，避免「刚传完还显示旧大小」。
 *
 * 前端每次最多带 4 个路径：4 × 10 页 = 40 次 list，压在免费版 50 subrequest 的线内。
 */

export interface DirStat {
  /** 目录路径 */
  path: string;
  /** 递归总字节数 */
  size: number;
  /** 递归文件数 */
  files: number;
  /** 递归子目录数（不含自身） */
  dirs: number;
  /** 直接子项数（文件 + 目录），对应界面上「N 项」 */
  items: number;
  /** 是否因为页数上限没有统计完 */
  truncated: boolean;
}

const CACHE_TTL = 20_000;
const MAX_PAGES = 10;
const MAX_PATHS = 4;
const MAX_CACHE_ENTRIES = 400;

const cache = new Map<string, { at: number; stat: DirStat }>();

/** 有任何写操作时调用，命中同一实例时立刻失效 */
export function clearDirStatCache(): void {
  cache.clear();
}

function cacheGet(path: string): DirStat | null {
  const hit = cache.get(path);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(path);
    return null;
  }
  return hit.stat;
}

function cachePut(stat: DirStat): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const cutoff = Date.now() - CACHE_TTL;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
    // 还是满就丢掉最早插入的一批
    if (cache.size >= MAX_CACHE_ENTRIES) {
      let drop = 100;
      for (const k of cache.keys()) {
        cache.delete(k);
        if (--drop <= 0) break;
      }
    }
  }
  cache.set(stat.path, { at: Date.now(), stat });
}

/** 递归统计一个目录 */
export async function statDirTree(env: Env, path: string, fresh = false): Promise<DirStat> {
  if (!fresh) {
    const hit = cacheGet(path);
    if (hit) return hit;
  }

  const prefix = dirPrefix(path);
  let cursor: string | undefined;
  let pages = 0;
  let size = 0;
  let files = 0;
  let truncated = false;

  const allDirs = new Set<string>();
  const topFiles = new Set<string>();
  const topDirs = new Set<string>();

  do {
    const page = await env.BUCKET.list({ prefix, limit: 1000, cursor });
    for (const obj of page.objects) {
      const rel = obj.key.slice(prefix.length);
      if (!rel) continue;

      /* 目录段：rel 为 "a/b/c.txt" 时依次累积 "a"、"a/b"（末段是文件或目录 marker，不入集合） */
      const segs = rel.split("/");
      let acc = "";
      for (let i = 0; i < segs.length - 1; i++) {
        if (!segs[i]) continue;
        acc = acc ? acc + "/" + segs[i] : segs[i];
        allDirs.add(acc);
      }
      if (segs.length > 1 && segs[0]) topDirs.add(segs[0]);

      const isMarker = rel.endsWith("/");
      if (!isMarker) {
        files++;
        size += obj.size;
        if (segs.length === 1) topFiles.add(rel);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages++;
    if (cursor && pages >= MAX_PAGES) truncated = true;
  } while (cursor && pages < MAX_PAGES);

  const stat: DirStat = {
    path,
    size,
    files,
    dirs: allDirs.size,
    items: topFiles.size + topDirs.size,
    truncated,
  };
  cachePut(stat);
  return stat;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isSafePath(p: string): boolean {
  if (p === "/") return true;
  return !p.split("/").includes("..");
}

/**
 * POST /__api/dirstat   body: { paths: string[], fresh?: boolean }
 * 返回 { stats: DirStat[] }
 *
 * 走 Basic 认证（与 /__api/shares 同级），在 index.ts 里认证之后调用。
 */
export async function handleDirStatApi(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (url.pathname !== "/__api/dirstat") return null;
  if (request.method !== "POST") return json(405, { error: "POST required" });

  let body: { paths?: unknown; fresh?: unknown };
  try {
    body = (await request.json()) as { paths?: unknown; fresh?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }

  const raw = Array.isArray(body.paths) ? body.paths : [];
  const paths = raw
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .slice(0, MAX_PATHS)
    .map((p) => normalizePath(p))
    .filter(isSafePath);

  if (paths.length === 0) return json(400, { error: "paths required" });

  const fresh = body.fresh === true || body.fresh === "1";
  /* 并行算各路径：subrequest 总量不变，但墙钟时间由最慢的一个决定 */
  const stats = await Promise.all(
    paths.map(async (p): Promise<DirStat> => {
      try {
        return await statDirTree(env, p, fresh);
      } catch {
        return { path: p, size: 0, files: 0, dirs: 0, items: 0, truncated: true };
      }
    })
  );
  return json(200, { stats });
}
