/**
 * 轻量 XML 解析器 / 序列化器。
 *
 * Workers 运行时没有 DOMParser，而 WebDAV 请求体需要保留命名空间信息
 * （区分 DAV:getetag 与 urn:schemas-microsoft-com:Win32LastModifiedTime），
 * 因此这里实现一个只覆盖 XML 子集（元素 / 属性 / 文本 / CDATA / 注释 /
 * 处理指令）的递归下降扫描器，足够处理 PROPFIND / PROPPATCH / LOCK 的 body。
 */

export interface XmlNode {
  qname: string;
  prefix: string;
  local: string;
  /** 解析后的命名空间 URI（无命名空间时为 ""） */
  uri: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** 直接文本内容（已解码实体），含子元素时为空白字符 */
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

export function decodeEntities(input: string): string {
  if (input.indexOf("&") === -1) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const hit = NAMED_ENTITIES[body];
    return hit === undefined ? m : hit;
  });
}

export function escapeXml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

/**
 * 元素文本内容转义：只处理 & < >，保留原始引号。
 * getetag 等值里含双引号，若转义成 &quot; 部分客户端比对会失败。
 */
export function escapeText(input: string): string {
  return input.replace(/[&<>]/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      default:
        return "&gt;";
    }
  });
}

function isNameBreak(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "/" || ch === ">" || ch === "=";
}

export function parseXml(input: string): XmlNode | null {
  const s = input;
  const n = s.length;
  let i = 0;
  let root: XmlNode | null = null;
  const stack: XmlNode[] = [];
  const nsStack: Array<Record<string, string>> = [{}];

  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt === -1) break;

    if (stack.length > 0) {
      const raw = s.slice(i, lt);
      if (raw) stack[stack.length - 1].text += decodeEntities(raw);
    }

    if (s.startsWith("<!--", lt)) {
      const e = s.indexOf("-->", lt + 4);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (s.startsWith("<![CDATA[", lt)) {
      const e = s.indexOf("]]>", lt + 9);
      const cdata = s.slice(lt + 9, e === -1 ? n : e);
      if (stack.length > 0) stack[stack.length - 1].text += cdata;
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (s.startsWith("<?", lt)) {
      const e = s.indexOf("?>", lt + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (s.startsWith("<!", lt)) {
      const e = s.indexOf(">", lt + 2);
      i = e === -1 ? n : e + 1;
      continue;
    }
    if (s.startsWith("</", lt)) {
      const e = s.indexOf(">", lt + 2);
      stack.pop();
      nsStack.pop();
      i = e === -1 ? n : e + 1;
      continue;
    }

    // ---- 起始标签 ----
    let p = lt + 1;
    let nameEnd = p;
    while (nameEnd < n && !isNameBreak(s[nameEnd])) nameEnd++;
    const qname = s.slice(p, nameEnd);
    if (!qname) {
      i = lt + 1;
      continue;
    }
    p = nameEnd;

    const attrs: Record<string, string> = {};
    let selfClose = false;
    while (p < n) {
      while (p < n && /\s/.test(s[p])) p++;
      if (p >= n) break;
      if (s[p] === "/") {
        selfClose = true;
        p++;
        continue;
      }
      if (s[p] === ">") {
        p++;
        break;
      }
      let aEnd = p;
      while (aEnd < n && !isNameBreak(s[aEnd])) aEnd++;
      const attrName = s.slice(p, aEnd);
      if (!attrName) {
        p++;
        continue;
      }
      p = aEnd;
      while (p < n && /\s/.test(s[p])) p++;
      let value = "";
      if (s[p] === "=") {
        p++;
        while (p < n && /\s/.test(s[p])) p++;
        const q = s[p];
        if (q === '"' || q === "'") {
          const close = s.indexOf(q, p + 1);
          value = s.slice(p + 1, close === -1 ? n : close);
          p = close === -1 ? n : close + 1;
        }
      }
      attrs[attrName] = decodeEntities(value);
    }
    i = p;

    const parentNs = nsStack[nsStack.length - 1];
    let ns = parentNs;
    for (const key of Object.keys(attrs)) {
      if (key === "xmlns") {
        if (ns === parentNs) ns = { ...parentNs };
        ns[""] = attrs[key];
      } else if (key.startsWith("xmlns:")) {
        if (ns === parentNs) ns = { ...parentNs };
        ns[key.slice(6)] = attrs[key];
      }
    }

    const colon = qname.indexOf(":");
    const prefix = colon === -1 ? "" : qname.slice(0, colon);
    const local = colon === -1 ? qname : qname.slice(colon + 1);
    const node: XmlNode = {
      qname,
      prefix,
      local,
      uri: ns[prefix] ?? "",
      attrs,
      children: [],
      text: "",
    };

    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else if (!root) root = node;

    if (!selfClose) {
      stack.push(node);
      nsStack.push(ns);
    }
  }

  return root;
}

export function serializeXml(node: XmlNode): string {
  const attrs = Object.keys(node.attrs)
    .map((k) => ` ${k}="${escapeXml(node.attrs[k])}"`)
    .join("");
  if (node.children.length === 0 && !node.text) return `<${node.qname}${attrs}/>`;
  const inner =
    node.children.length > 0
      ? node.children.map(serializeXml).join("")
      : escapeXml(node.text);
  return `<${node.qname}${attrs}>${inner}</${node.qname}>`;
}

/** 取第一个同 localName（可选同命名空间）的子元素 */
export function findChild(node: XmlNode | null, local: string, uri?: string): XmlNode | null {
  if (!node) return null;
  for (const c of node.children) {
    if (c.local === local && (uri === undefined || c.uri === uri)) return c;
  }
  return null;
}

export function findDescendant(node: XmlNode | null, local: string): XmlNode | null {
  if (!node) return null;
  for (const c of node.children) {
    if (c.local === local) return c;
    const deep = findDescendant(c, local);
    if (deep) return deep;
  }
  return null;
}
