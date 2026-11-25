/**
 * 把 docs/donate-wx.jpg 与 docs/donate-zfb.jpg 编进 src/qr.ts
 *
 * 用法：npm run gen:qr
 * 换收款码：把两张图替换掉（建议宽度 620 左右、质量 80 的 JPEG，一张 50-70 KB），
 * 然后跑一次这个脚本再 wrangler deploy 即可。图片太大只会拖慢 Worker 首次加载。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = {
  WX: "docs/donate-wx.jpg",
  ZFB: "docs/donate-zfb.jpg",
};

const parts = [];
let total = 0;
for (const [name, rel] of Object.entries(files)) {
  const buf = readFileSync(resolve(root, rel));
  total += buf.byteLength;
  parts.push(`const ${name} = "${buf.toString("base64")}";`);
  console.log(`${rel} -> ${(buf.byteLength / 1024).toFixed(1)} KB`);
}

const out = `/**
 * 打赏二维码（微信 / 支付宝）
 *
 * 这个文件由 scripts/gen-qr.mjs 生成，不要手改：
 *   1. 替换 docs/donate-wx.jpg 与 docs/donate-zfb.jpg
 *   2. npm run gen:qr
 *   3. npm run deploy
 *
 * 图片只有几十 KB，直接以 base64 编进 Worker 包，避免为两张图再挂一个存储源。
 * 前端 <img src="/__asset/donate-wx.jpg"> 取，浏览器按长缓存存起来，只在第一次加载时占带宽。
 */

${parts.join("\n\n")}

function bytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const CACHE = "public, max-age=2592000, immutable";

/** GET /__asset/donate-wx.jpg | /__asset/donate-zfb.jpg —— 公开，不需要凭据 */
export function handleDonateAsset(url: URL, method: string): Response | null {
  const names: Record<string, string> = {
    "/__asset/donate-wx.jpg": WX,
    "/__asset/donate-zfb.jpg": ZFB,
  };
  const data = names[url.pathname];
  if (!data) return null;
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const body = bytes(data);
  const headers: Record<string, string> = {
    "Content-Type": "image/jpeg",
    "Content-Length": String(body.byteLength),
    "Cache-Control": CACHE,
    "X-Content-Type-Options": "nosniff",
  };
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(body, { status: 200, headers });
}
`;

writeFileSync(resolve(root, "src/qr.ts"), out);
console.log(`src/qr.ts 已更新，图片合计 ${(total / 1024).toFixed(1)} KB`);
