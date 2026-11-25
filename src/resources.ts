import type { DavRes, Env } from "./types";
import { dirPrefix, joinPath, keyOf } from "./utils";

/** R2 没有真正的目录，单次 list 最多返回 1000 个 key，这里最多翻 20 页 */
const MAX_LIST_PAGES = 20;

function listOptions(prefix: string, cursor?: string): R2ListOptions {
  const opts: R2ListOptions = { prefix, limit: 1000, cursor };
  // 部分 workers-types 版本未声明 include 字段，运行时支持
  (opts as unknown as Record<string, unknown>).include = ["httpMetadata", "customMetadata"];
  return opts;
}

function fromObject(path: string, obj: R2Object, isDir: boolean): DavRes {
  return {
    path,
    isDir,
    size: obj.size,
    etag: isDir ? null : obj.httpEtag,
    lastModified: obj.uploaded ? obj.uploaded.getTime() : Date.now(),
    created: obj.uploaded ? obj.uploaded.getTime() : Date.now(),
    contentType: obj.httpMetadata?.contentType ?? null,
    contentDisposition: obj.httpMetadata?.contentDisposition ?? null,
    dead: {},
  };
}

function rootResource(): DavRes {
  const now = Date.now();
  return {
    path: "/",
    isDir: true,
    size: 0,
    etag: null,
    lastModified: now,
    created: now,
    contentType: null,
    dead: {},
  };
}

/** 探测集合：目录存在当且仅当有 marker key（"dir/"）或存在任意以 "dir/" 开头的对象 */
async function statDirectory(env: Env, path: string): Promise<DavRes | null> {
  const prefix = dirPrefix(path);
  const marker = await env.BUCKET.head(prefix);
  if (marker) return fromObject(path, marker, true);

  const probe = await env.BUCKET.list({ prefix, limit: 1 });
  const first = probe.objects[0];
  if (!first) return null;
  return {
    path,
    isDir: true,
    size: 0,
    etag: null,
    lastModified: first.uploaded ? first.uploaded.getTime() : Date.now(),
    created: first.uploaded ? first.uploaded.getTime() : Date.now(),
    contentType: null,
    dead: {},
  };
}

/** 取单个资源；不存在返回 null */
export async function statPath(env: Env, path: string): Promise<DavRes | null> {
  if (path === "/") return rootResource();
  const obj = await env.BUCKET.head(keyOf(path));
  if (obj) return fromObject(path, obj, false);
  return statDirectory(env, path);
}

export async function pathExists(env: Env, path: string): Promise<boolean> {
  if (path === "/") return true;
  const head = await env.BUCKET.head(keyOf(path));
  if (head) return true;
  const probe = await env.BUCKET.list({ prefix: dirPrefix(path), limit: 1 });
  return probe.objects.length > 0;
}

interface DirEntry {
  isDir: boolean;
  marker?: R2Object;
  file?: R2Object;
  maxChildTime: number;
}

/** Depth: 1 的成员列表 */
async function listDepthOne(env: Env, parent: string): Promise<DavRes[]> {
  const prefix = dirPrefix(parent);
  const entries = new Map<string, DirEntry>();
  let cursor: string | undefined;
  let pages = 0;

  do {
    const page = await env.BUCKET.list(listOptions(prefix, cursor));
    for (const obj of page.objects) {
      const rel = obj.key.slice(prefix.length);
      if (!rel) continue;
      const slash = rel.indexOf("/");
      if (slash === -1) {
        const existing = entries.get(rel);
        if (existing) existing.file = obj;
        else entries.set(rel, { isDir: false, file: obj, maxChildTime: 0 });
        continue;
      }
      const name = rel.slice(0, slash);
      let entry = entries.get(name);
      if (!entry) {
        entry = { isDir: true, maxChildTime: 0 };
        entries.set(name, entry);
      }
      if (rel.length === slash + 1) {
        // 正好是目录 marker "name/"
        entry.marker = obj;
      } else {
        const t = obj.uploaded ? obj.uploaded.getTime() : 0;
        if (t > entry.maxChildTime) entry.maxChildTime = t;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages++;
  } while (cursor && pages < MAX_LIST_PAGES);

  const now = Date.now();
  const out: DavRes[] = [];
  for (const [name, entry] of entries) {
    const childPath = joinPath(parent, name);
    if (entry.isDir) {
      const isDirWithoutContent = !!entry.marker && !entry.marker.uploaded && entry.maxChildTime === 0;
      const base = entry.marker ?? null;
      out.push({
        path: childPath,
        isDir: true,
        size: 0,
        etag: null,
        lastModified: base?.uploaded
          ? base.uploaded.getTime()
          : entry.maxChildTime || (isDirWithoutContent ? now : now),
        created: base?.uploaded ? base.uploaded.getTime() : entry.maxChildTime || now,
        contentType: null,
        dead: {},
      });
    } else if (entry.file) {
      out.push(fromObject(childPath, entry.file, false));
    }
  }
  return out;
}

/** Depth: infinity 的完整子树 */
async function listRecursive(env: Env, parent: string): Promise<DavRes[]> {
  const prefix = dirPrefix(parent);
  const out: DavRes[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const page = await env.BUCKET.list(listOptions(prefix, cursor));
    for (const obj of page.objects) {
      const rel = obj.key.slice(prefix.length);
      if (!rel) continue;
      const isDir = rel.endsWith("/");
      const cleanRel = isDir ? rel.slice(0, -1) : rel;
      const fullPath = joinPath(parent, cleanRel);
      out.push(fromObject(fullPath, obj, isDir));
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages++;
  } while (cursor && pages < MAX_LIST_PAGES);

  return out;
}

export async function listMembers(env: Env, parent: string, depth: number): Promise<DavRes[]> {
  if (depth === 0) return [];
  if (depth === Infinity) return listRecursive(env, parent);
  return listDepthOne(env, parent);
}

/** 递归删除（文件或集合） */
export async function removeTree(env: Env, path: string): Promise<boolean> {
  if (path === "/") return false;

  const head = await env.BUCKET.head(keyOf(path));
  if (head) {
    await env.BUCKET.delete(keyOf(path));
    return true;
  }

  const prefix = dirPrefix(path);
  let cursor: string | undefined;
  let removedAny = false;
  do {
    const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length > 0) {
      await env.BUCKET.delete(keys);
      removedAny = true;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return removedAny;
}

/** 复制单个 key（R2 无服务端 CopyObject，只能读后写） */
export async function copyKey(env: Env, fromKey: string, toKey: string): Promise<boolean> {
  const obj = await env.BUCKET.get(fromKey);
  if (!obj) return false;
  await env.BUCKET.put(toKey, obj.body, {
    httpMetadata: obj.httpMetadata,
    customMetadata: obj.customMetadata,
  });
  return true;
}

/** 递归复制（文件或集合） */
export async function copyTree(env: Env, srcPath: string, dstPath: string): Promise<boolean> {
  if (srcPath === "/") return false;

  const head = await env.BUCKET.head(keyOf(srcPath));
  if (head) {
    return copyKey(env, keyOf(srcPath), keyOf(dstPath));
  }

  const srcPrefix = dirPrefix(srcPath);
  const dstPrefix = dirPrefix(dstPath);

  // 先建目标目录 marker，保证空目录也能复制
  await env.BUCKET.put(dstPrefix, new Uint8Array(0), {
    httpMetadata: { contentType: "application/x-directory" },
  });

  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: srcPrefix, cursor, limit: 200 });
    for (const obj of page.objects) {
      const rel = obj.key.slice(srcPrefix.length);
      await copyKey(env, obj.key, dstPrefix + rel);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return true;
}

export async function createDirectoryMarker(env: Env, path: string): Promise<void> {
  await env.BUCKET.put(dirPrefix(path), new Uint8Array(0), {
    httpMetadata: { contentType: "application/x-directory" },
  });
}

export async function createEmptyFile(env: Env, path: string): Promise<void> {
  await env.BUCKET.put(keyOf(path), new Uint8Array(0), {
    httpMetadata: { contentType: "application/octet-stream" },
  });
}
