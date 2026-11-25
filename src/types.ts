export interface Env {
  BUCKET: R2Bucket;
  LOCKS: DurableObjectNamespace;
  SHARES: DurableObjectNamespace;
  WEBDAV_USER?: string;
  WEBDAV_PASS?: string;
  LOCK_TIMEOUT?: string;
  READ_ONLY?: string;
  /** 总额度（GB），默认 10 */
  QUOTA_TOTAL_GB?: string;
  /** 可用比例（0-1），默认 0.99，即 10 GB 的额度最多写 9.9 GB */
  QUOTA_USABLE_PCT?: string;
}

export type LockScope = "exclusive" | "shared";

export interface LockRecord {
  /** 形如 opaquelocktoken:xxxx-... */
  token: string;
  /** 已解码的规范化路径，不带尾斜杠，根为 "/" */
  path: string;
  /** -1 = infinity, 0 = 仅自身 */
  depth: -1 | 0;
  scope: LockScope;
  /** 原始 owner 元素内层 XML（已转义），可为空串 */
  owner: string;
  /** 客户端请求的超时（秒） */
  timeout: number;
  /** epoch ms */
  expiresAt: number;
  createdAt: number;
}

export interface PropName {
  uri: string;
  name: string;
}

/** 一个 DAV 资源（文件或集合）的视图 */
export interface DavRes {
  /** 解码后的路径，根为 "/" */
  path: string;
  isDir: boolean;
  size: number;
  etag: string | null;
  lastModified: number;
  created: number;
  contentType: string | null;
  contentDisposition?: string | null;
  /** 失效属性（dead property），key = `${uri}\u0000${name}` */
  dead: Record<string, string>;
}
