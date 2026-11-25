import type { Env, LockRecord, LockScope } from "./types";
import { isUnder } from "./utils";

/* ================================================================== */
/* Durable Object：全局唯一实例持有所有 LOCK 状态                       */
/* ================================================================== */

const LOCK_KEY_PREFIX = "lock:";

interface AcquireRequest {
  op: "acquire";
  path: string;
  depth: -1 | 0;
  scope: LockScope;
  owner: string;
  timeout: number;
  tokens: string[];
}

interface RefreshRequest {
  op: "refresh";
  path: string;
  timeout: number;
  tokens: string[];
}

interface ReleaseRequest {
  op: "release";
  path: string;
  token: string;
}

interface CheckRequest {
  op: "check";
  path: string;
  tokens: string[];
  /** 操作是否会波及子树（DELETE/MOVE 集合） */
  affectsSubtree: boolean;
}

interface ListRequest {
  op: "list";
}

/** 释放某个路径及其全部子孙上的锁（DELETE / MOVE 之后清理孤立锁） */
interface ReleaseTreeRequest {
  op: "release-tree";
  path: string;
}

type DoRequest =
  | AcquireRequest
  | RefreshRequest
  | ReleaseRequest
  | CheckRequest
  | ListRequest
  | ReleaseTreeRequest;

interface DoResponse {
  ok: boolean;
  lock?: LockRecord;
  created?: boolean;
  conflict?: LockRecord;
  locks?: LockRecord[];
  reason?: string;
}

function newToken(): string {
  const uuid = crypto.randomUUID();
  return `opaquelocktoken:${uuid}`;
}

export class LockDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    let payload: DoRequest;
    try {
      payload = (await request.json()) as DoRequest;
    } catch {
      return this.json({ ok: false, reason: "bad-request" });
    }

    try {
      switch (payload.op) {
        case "acquire":
          return this.json(await this.acquire(payload));
        case "refresh":
          return this.json(await this.refresh(payload));
        case "release":
          return this.json(await this.release(payload));
        case "check":
          return this.json(await this.check(payload));
        case "list":
          return this.json({ ok: true, locks: await this.activeLocks() });
        case "release-tree":
          return this.json(await this.releaseTree(payload.path));
        default:
          return this.json({ ok: false, reason: "unknown-op" });
      }
    } catch (err) {
      return this.json({ ok: false, reason: String(err) });
    }
  }

  private json(value: DoResponse): Response {
    return new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json" },
    });
  }

  /** 读取所有未过期锁，顺带清理过期记录 */
  private async activeLocks(): Promise<LockRecord[]> {
    const stored = await this.state.storage.list<LockRecord>({ prefix: LOCK_KEY_PREFIX });
    const now = Date.now();
    const alive: LockRecord[] = [];
    const expiredKeys: string[] = [];
    for (const [key, value] of stored) {
      if (!value || typeof value !== "object") {
        expiredKeys.push(key);
        continue;
      }
      if (value.expiresAt <= now) {
        expiredKeys.push(key);
        continue;
      }
      alive.push(value);
    }
    if (expiredKeys.length > 0) {
      await this.state.storage.delete(expiredKeys);
    }
    return alive;
  }

  /** 判断某把锁是否覆盖 path（自身或 depth=infinity 的祖先） */
  private covers(lock: LockRecord, path: string): boolean {
    if (lock.path === path) return true;
    if (lock.depth === -1 && isUnder(path, lock.path)) return true;
    return false;
  }

  /** 锁根节点是否仍然存在于桶中（用于清理外部删除留下的孤立锁） */
  private async targetExists(path: string): Promise<boolean> {
    if (path === "/") return true;
    const key = path.replace(/^\//, "");
    const head = await this.env.BUCKET.head(key);
    if (head) return true;
    const probe = await this.env.BUCKET.list({ prefix: key + "/", limit: 1 });
    return probe.objects.length > 0;
  }

  /** 过滤掉根节点已消失的锁，并顺带从存储中删除 */
  private async pruneOrphans(locks: LockRecord[]): Promise<LockRecord[]> {
    const alive: LockRecord[] = [];
    for (const lock of locks) {
      if (await this.targetExists(lock.path)) {
        alive.push(lock);
      } else {
        await this.state.storage.delete(LOCK_KEY_PREFIX + lock.token);
      }
    }
    return alive;
  }

  private async acquire(req: AcquireRequest): Promise<DoResponse> {
    const locks = await this.activeLocks();

    // 1) 提交了已有锁令牌 -> 视为刷新（同一持有者重入）
    for (const token of req.tokens) {
      const existing = locks.find((l) => l.token === token);
      if (existing && this.covers(existing, req.path)) {
        existing.expiresAt = Date.now() + existing.timeout * 1000;
        await this.state.storage.put(LOCK_KEY_PREFIX + existing.token, existing);
        return { ok: true, lock: existing, created: false };
      }
    }

    // 2) 冲突检测（忽略根节点已被外部删除的孤立锁）
    const candidates = await this.pruneOrphans(locks);
    const conflicts = candidates.filter((l) => {
      const onSelf = l.path === req.path;
      const onAncestor = l.depth === -1 && isUnder(req.path, l.path);
      const onDescendant = req.depth === -1 && isUnder(l.path, req.path);
      return onSelf || onAncestor || onDescendant;
    });

    if (conflicts.length > 0) {
      const allShared = req.scope === "shared" && conflicts.every((c) => c.scope === "shared");
      if (!allShared) {
        return { ok: false, reason: "locked", conflict: conflicts[0] };
      }
    }

    // 3) 新建锁
    const lock: LockRecord = {
      token: newToken(),
      path: req.path,
      depth: req.depth,
      scope: req.scope,
      owner: req.owner ?? "",
      timeout: req.timeout,
      expiresAt: Date.now() + req.timeout * 1000,
      createdAt: Date.now(),
    };
    await this.state.storage.put(LOCK_KEY_PREFIX + lock.token, lock);
    return { ok: true, lock, created: true };
  }

  private async refresh(req: RefreshRequest): Promise<DoResponse> {
    const locks = await this.activeLocks();
    for (const token of req.tokens) {
      const lock = locks.find((l) => l.token === token);
      if (lock && (lock.path === req.path || isUnder(req.path, lock.path))) {
        lock.timeout = req.timeout;
        lock.expiresAt = Date.now() + req.timeout * 1000;
        await this.state.storage.put(LOCK_KEY_PREFIX + lock.token, lock);
        return { ok: true, lock };
      }
    }
    return { ok: false, reason: "no-matching-lock" };
  }

  private async release(req: ReleaseRequest): Promise<DoResponse> {
    const key = LOCK_KEY_PREFIX + req.token;
    const lock = await this.state.storage.get<LockRecord>(key);
    if (!lock) return { ok: false, reason: "not-found" };
    if (lock.path !== req.path && !isUnder(req.path, lock.path)) {
      return { ok: false, reason: "path-mismatch" };
    }
    await this.state.storage.delete(key);
    return { ok: true, lock };
  }

  /** 释放 path 自身及其子孙上的所有锁 */
  private async releaseTree(path: string): Promise<DoResponse> {
    const locks = await this.activeLocks();
    const doomed = locks.filter((l) => l.path === path || isUnder(l.path, path));
    for (const lock of doomed) {
      await this.state.storage.delete(LOCK_KEY_PREFIX + lock.token);
    }
    return { ok: true, locks: doomed };
  }

  private async check(req: CheckRequest): Promise<DoResponse> {
    const locks = await this.activeLocks();
    const submitted = new Set(req.tokens);
    const blocking: LockRecord[] = [];
    for (const lock of locks) {
      const onSelf = lock.path === req.path;
      const onAncestor = lock.depth === -1 && isUnder(req.path, lock.path);
      const onDescendant = req.affectsSubtree && isUnder(lock.path, req.path);
      if (!onSelf && !onAncestor && !onDescendant) continue;
      if (!(await this.targetExists(lock.path))) {
        await this.state.storage.delete(LOCK_KEY_PREFIX + lock.token);
        continue;
      }
      blocking.push(lock);
    }
    if (blocking.length === 0) return { ok: true };
    const unsatisfied = blocking.find((l) => !submitted.has(l.token));
    if (unsatisfied) return { ok: false, reason: "locked", conflict: unsatisfied };
    return { ok: true };
  }
}

/* ================================================================== */
/* 客户端封装                                                          */
/* ================================================================== */

async function callDo(env: Env, payload: DoRequest): Promise<DoResponse> {
  const id = env.LOCKS.idFromName("global-lock-table");
  const stub = env.LOCKS.get(id);
  const res = await stub.fetch("https://lock.internal/do", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as DoResponse;
}

export function acquireLock(
  env: Env,
  path: string,
  depth: -1 | 0,
  scope: LockScope,
  owner: string,
  timeout: number,
  tokens: string[]
): Promise<DoResponse> {
  return callDo(env, { op: "acquire", path, depth, scope, owner, timeout, tokens });
}

export function refreshLock(
  env: Env,
  path: string,
  timeout: number,
  tokens: string[]
): Promise<DoResponse> {
  return callDo(env, { op: "refresh", path, timeout, tokens });
}

export function releaseLock(env: Env, path: string, token: string): Promise<DoResponse> {
  return callDo(env, { op: "release", path, token });
}

export function checkLocks(
  env: Env,
  path: string,
  tokens: string[],
  affectsSubtree: boolean
): Promise<DoResponse> {
  return callDo(env, { op: "check", path, tokens, affectsSubtree });
}

export async function listAllLocks(env: Env): Promise<LockRecord[]> {
  const res = await callDo(env, { op: "list" });
  return res.locks ?? [];
}

/** 删除资源后清理其自身及子孙上的锁，避免出现指向不存在路径的孤立锁 */
export async function releaseLocksUnder(env: Env, path: string): Promise<number> {
  const res = await callDo(env, { op: "release-tree", path });
  return (res.locks ?? []).length;
}

/** 某资源上应当出现在 lockdiscovery 里的锁 */
export function locksForPath(path: string, locks: LockRecord[]): LockRecord[] {
  return locks.filter((l) => l.path === path || (l.depth === -1 && isUnder(path, l.path)));
}

export function remainingSeconds(lock: LockRecord): number {
  return Math.max(1, Math.round((lock.expiresAt - Date.now()) / 1000));
}
