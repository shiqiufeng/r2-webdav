import type { Env } from "./types";

/**
 * mp4 快启动（faststart）虚拟重排
 *
 * 为什么需要：手机 / 抖音导出的 mp4 普遍把 moov（索引）放在文件末尾。
 * 浏览器拿到首字节后发现没有 moov，会立刻再发一个指向文件尾部的 Range 请求。
 * 这条「并发尾部请求」在部分代理 / 链路上会永久挂住，播放器就停在缓冲态转圈不动。
 *
 * 做法：预览时把 [ftyp][mdat…][moov] 重排成 [ftyp][moov'][mdat…]。
 * moov 体量通常只有几 KB 到几十 KB，可以整块读进内存；重排只改 chunk 偏移表
 * （stco / co64），盒内其它结构长度不变，所以 moov 自身大小不变、文件总大小也不变。
 * 之后按虚拟布局映射 Range 请求即可，浏览器一次顺序下载就能边下边播、任意 seek。
 *
 * 任何一步不符合预期（多 mdat、fragmented、saio/iloc、超出 32 位偏移…）都直接
 * 返回 null，调用方回退到原始字节流，绝不冒险改动数据。
 */

const MAX_MOOV_BYTES = 16 * 1024 * 1024; // 索引超过 16 MB 直接放弃重排
const MAX_SCAN_BOXES = 24;

/** 同一文件在播放期间的多次 Range 请求复用同一份方案（键含大小，覆盖同名文件时自然失效） */
const PLAN_CACHE = new Map<string, Mp4Plan>();

export interface Mp4Plan {
  /** 原始文件大小 */
  size: number;
  /** mdat 起始（= 虚拟布局里 moov' 的起点） */
  preLen: number;
  /** moov 大小 */
  moovLen: number;
  /** 已修正偏移的 moov 字节 */
  moov: Uint8Array;
}

function u32(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function u64(b: Uint8Array, off: number): number {
  return u32(b, off) * 4294967296 + u32(b, off + 4);
}

function boxType(b: Uint8Array, off: number): string {
  return String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
}

/** 返回 [总长度, 头部长度]；size=0 表示「到文件末尾」 */
function boxExtent(b: Uint8Array, off: number, avail: number): [number, number] | null {
  if (avail < 8) return null;
  const size32 = u32(b, off);
  if (size32 === 1) {
    if (avail < 16) return null;
    return [u64(b, off + 8), 16];
  }
  if (size32 === 0) return [0, 8];
  if (size32 < 8) return null;
  return [size32, 8];
}

async function readRange(
  env: Env,
  key: string,
  offset: number,
  length: number,
): Promise<Uint8Array | null> {
  if (length <= 0) return new Uint8Array(0);
  const obj = await env.BUCKET.get(key, { range: { offset, length } });
  if (!obj || !("body" in obj)) return null;
  return new Uint8Array(await obj.arrayBuffer());
}

const CONTAINER_BOXES = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "dinf", "edts", "udta", "mvex", "mfra",
]);
const BAIL_BOXES = new Set(["saio", "sais", "iloc", "moof", "traf", "sidx"]);

/**
 * 在 moov 内递归定位 stco / co64 并原地加上 delta。
 * 返回 false 表示遇到无法安全改写的结构。
 */
function shiftOffsets(buf: Uint8Array, start: number, end: number, delta: number): boolean {
  let off = start;
  while (off + 8 <= end) {
    const ext = boxExtent(buf, off, end - off);
    if (!ext) return false;
    const [len, hdr] = ext;
    const type = boxType(buf, off);
    if (BAIL_BOXES.has(type)) return false;
    let boxLen = len === 0 ? end - off : len;
    if (boxLen < hdr || off + boxLen > end) return false;

    if (type === "stco" || type === "co64") {
      const p = off + hdr;
      if (p + 8 > off + boxLen) return false;
      const count = u32(buf, p + 4);
      const entrySize = type === "co64" ? 8 : 4;
      const tableStart = p + 8;
      if (tableStart + count * entrySize > off + boxLen) return false;
      for (let i = 0; i < count; i++) {
        const at = tableStart + i * entrySize;
        if (entrySize === 4) {
          const v = u32(buf, at) + delta;
          if (v > 0xffffffff) return false;
          buf[at] = (v >>> 24) & 0xff;
          buf[at + 1] = (v >>> 16) & 0xff;
          buf[at + 2] = (v >>> 8) & 0xff;
          buf[at + 3] = v & 0xff;
        } else {
          const v = u64(buf, at) + delta;
          const hi = Math.floor(v / 4294967296);
          const lo = v % 4294967296;
          buf[at] = (hi >>> 24) & 0xff;
          buf[at + 1] = (hi >>> 16) & 0xff;
          buf[at + 2] = (hi >>> 8) & 0xff;
          buf[at + 3] = hi & 0xff;
          buf[at + 4] = (lo >>> 24) & 0xff;
          buf[at + 5] = (lo >>> 16) & 0xff;
          buf[at + 6] = (lo >>> 8) & 0xff;
          buf[at + 7] = lo & 0xff;
        }
      }
    } else if (CONTAINER_BOXES.has(type)) {
      if (!shiftOffsets(buf, off + hdr, off + boxLen, delta)) return false;
    }
    off += boxLen;
  }
  return off === end;
}

/** 计算重排方案；不适用时返回 null */
export async function planFaststart(env: Env, key: string, size: number): Promise<Mp4Plan | null> {
  const cached = PLAN_CACHE.get(key);
  if (cached && cached.size === size) return cached;
  const plan = await computePlan(env, key, size);
  if (plan) {
    if (PLAN_CACHE.size >= 16) {
      const first = PLAN_CACHE.keys().next();
      if (!first.done) PLAN_CACHE.delete(first.value);
    }
    PLAN_CACHE.set(key, plan);
  }
  return plan;
}

async function computePlan(env: Env, key: string, size: number): Promise<Mp4Plan | null> {
  if (size < 2048) return null;

  let off = 0;
  let mdatOffset = -1;
  let mdatLen = 0;

  for (let i = 0; i < MAX_SCAN_BOXES && off + 8 <= size; i++) {
    const head = await readRange(env, key, off, Math.min(16, size - off));
    if (!head || head.length < 8) return null;
    const ext = boxExtent(head, 0, head.length);
    if (!ext) return null;
    const [len, hdr] = ext;
    const type = boxType(head, 0);
    if (type === "moof" || type === "sidx") return null;
    let boxLen = len === 0 ? size - off : len;
    if (boxLen < hdr) return null;

    if (type === "mdat") {
      if (mdatOffset >= 0) return null; // 多个 mdat：音频/视频分离写入，放弃
      mdatOffset = off;
      mdatLen = boxLen;
      break;
    }
    off += boxLen;
  }

  if (mdatOffset <= 0 || mdatLen <= 0) return null;
  const moovOffset = mdatOffset + mdatLen;
  if (moovOffset + 8 > size) return null;

  const mh = await readRange(env, key, moovOffset, Math.min(16, size - moovOffset));
  if (!mh || mh.length < 8) return null;
  if (boxType(mh, 0) !== "moov") return null; // mdat 后面不是 moov，说明布局不同
  const mext = boxExtent(mh, 0, mh.length);
  if (!mext) return null;
  const [mlen] = mext;
  const moovLen = mlen === 0 ? size - moovOffset : mlen;
  if (moovLen <= 0 || moovOffset + moovLen !== size) return null; // moov 必须正好收尾
  if (moovLen > MAX_MOOV_BYTES) return null;

  const moovRaw = await readRange(env, key, moovOffset, moovLen);
  if (!moovRaw || moovRaw.length !== moovLen) return null;

  const moov = new Uint8Array(moovRaw);
  // 虚拟布局：[0, mdatOffset) 原样 + moov' + [mdatOffset, size)
  // mdat 数据整体后移 moovLen 字节
  const rootExt = boxExtent(moov, 0, moov.length);
  if (!rootExt) return null;
  const [, rootHdr] = rootExt;
  if (!shiftOffsets(moov, rootHdr, moov.length, moovLen)) return null;

  return { size, preLen: mdatOffset, moovLen, moov };
}

type Part =
  | { kind: "src"; start: number; end: number }
  | { kind: "buf"; bytes: Uint8Array };

function planParts(plan: Mp4Plan, offset: number, length: number): Part[] {
  const { preLen, moovLen, size, moov } = plan;
  const from = Math.max(0, offset);
  const to = Math.min(size, offset + length);
  const parts: Part[] = [];
  if (to <= from) return parts;

  const moovStart = preLen;
  const moovEnd = preLen + moovLen;
  const mdatStart = moovEnd;
  const shift = moovLen; // 原始 mdat 段整体后移

  if (from < moovStart) {
    const e = Math.min(to, moovStart);
    parts.push({ kind: "src", start: from, end: e });
  }
  if (to > moovStart && from < moovEnd) {
    const a = Math.max(from, moovStart) - moovStart;
    const b = Math.min(to, moovEnd) - moovStart;
    parts.push({ kind: "buf", bytes: moov.subarray(a, b) });
  }
  if (to > mdatStart) {
    const a = Math.max(from, mdatStart) - shift;
    const b = to - shift;
    parts.push({ kind: "src", start: a, end: b });
  }
  return parts;
}

/** 按虚拟布局流式输出指定区间；失败返回 null（调用方回退原始字节） */
export async function streamVirtualRange(
  env: Env,
  key: string,
  plan: Mp4Plan,
  offset: number,
  length: number,
): Promise<ReadableStream<Uint8Array> | null> {
  const parts = planParts(plan, offset, length);
  if (parts.length === 0) return null;
  let produced = 0;
  // 先验证需要读取的原始区间都真实存在，且总字节数正好等于请求长度，避免流开始后才出错
  for (const p of parts) {
    if (p.kind === "src" && (p.start < 0 || p.end > plan.size || p.end <= p.start)) return null;
    produced += p.kind === "src" ? p.end - p.start : p.bytes.byteLength;
  }
  const expected = Math.min(plan.size, offset + length) - Math.max(0, offset);
  if (produced !== expected) return null;

  let idx = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (reader) {
          const r = await reader.read();
          if (!r.done) {
            controller.enqueue(r.value);
            return;
          }
          reader = null;
          idx++;
          continue;
        }
        if (idx >= parts.length) {
          controller.close();
          return;
        }
        const p = parts[idx];
        if (p.kind === "buf") {
          controller.enqueue(p.bytes);
          idx++;
          continue;
        }
        const obj = await env.BUCKET.get(key, {
          range: { offset: p.start, length: p.end - p.start },
        });
        if (!obj || !("body" in obj)) {
          controller.error(new Error("range read failed"));
          return;
        }
        reader = (obj.body as ReadableStream<Uint8Array>).getReader();
      }
    },
    cancel(reason) {
      if (reader) void reader.cancel(reason);
    },
  });
}

/** 只有常见的 mp4 系后缀才尝试重排 */
export function isFaststartCandidate(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return ext === "mp4" || ext === "m4v" || ext === "mov";
}
