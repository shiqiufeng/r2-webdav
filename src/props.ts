import type { DavRes, LockRecord, PropName } from "./types";
import { baseName, encodePath, httpDate, isoDate } from "./utils";
import { escapeText, escapeXml } from "./xml";
import { remainingSeconds } from "./lock";

export const NS_DAV = "DAV:";
export const NS_MS = "urn:schemas-microsoft-com:";
export const NS_APACHE = "http://apache.org/dav/props/";

const ALLPROP: PropName[] = [
  { uri: NS_DAV, name: "resourcetype" },
  { uri: NS_DAV, name: "displayname" },
  { uri: NS_DAV, name: "getcontentlength" },
  { uri: NS_DAV, name: "getcontenttype" },
  { uri: NS_DAV, name: "getetag" },
  { uri: NS_DAV, name: "getlastmodified" },
  { uri: NS_DAV, name: "creationdate" },
  { uri: NS_DAV, name: "supportedlock" },
  { uri: NS_DAV, name: "lockdiscovery" },
  { uri: NS_MS, name: "Win32FileAttributes" },
  { uri: NS_MS, name: "Win32LastModifiedTime" },
  { uri: NS_MS, name: "Win32CreationTime" },
];

const SUPPORTED_LOCK =
  "<D:supportedlock>" +
  "<D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>" +
  "<D:lockentry><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>" +
  "</D:supportedlock>";

/** 虚拟配额，避免 macOS Finder 把 0 可用空间当成只读 */
const VIRTUAL_QUOTA_AVAILABLE = 1099511627776;

function tagName(prop: PropName): string {
  if (prop.uri === NS_DAV || prop.uri === "") return `D:${prop.name}`;
  if (prop.uri === NS_MS) return `Z:${prop.name}`;
  return `X:${prop.name}`;
}

function nsDeclFor(prop: PropName): string {
  if (prop.uri === NS_DAV || prop.uri === "" || prop.uri === NS_MS) return "";
  return ` xmlns:X="${escapeXml(prop.uri)}"`;
}

export function renderActiveLock(lock: LockRecord): string {
  const depth = lock.depth === -1 ? "infinity" : "0";
  const owner = lock.owner && lock.owner.trim() ? `<D:owner>${lock.owner}</D:owner>` : "";
  return (
    "<D:activelock>" +
    "<D:locktype><D:write/></D:locktype>" +
    `<D:lockscope><D:${lock.scope}/></D:lockscope>` +
    `<D:depth>${depth}</D:depth>` +
    owner +
    `<D:timeout>Second-${remainingSeconds(lock)}</D:timeout>` +
    `<D:locktoken><D:href>${escapeText(lock.token)}</D:href></D:locktoken>` +
    `<D:lockroot><D:href>${encodePath(lock.path)}</D:href></D:lockroot>` +
    "</D:activelock>"
  );
}

export function renderLockDiscovery(locks: LockRecord[]): string {
  return `<D:lockdiscovery>${locks.map(renderActiveLock).join("")}</D:lockdiscovery>`;
}

interface RenderedProp {
  available: boolean;
  xml: string;
}

function renderOne(prop: PropName, res: DavRes, locks: LockRecord[]): RenderedProp {
  const isDav = prop.uri === NS_DAV || prop.uri === "";
  const empty = `<${tagName(prop)}${nsDeclFor(prop)}/>`;

  if (isDav) {
    switch (prop.name) {
      case "resourcetype":
        return {
          available: true,
          xml: res.isDir ? "<D:resourcetype><D:collection/></D:resourcetype>" : "<D:resourcetype/>",
        };
      case "displayname":
        return {
          available: true,
          xml: `<D:displayname>${escapeText(baseName(res.path))}</D:displayname>`,
        };
      case "getcontentlength":
        return res.isDir
          ? { available: false, xml: empty }
          : { available: true, xml: `<D:getcontentlength>${res.size}</D:getcontentlength>` };
      case "getcontenttype":
        return res.isDir
          ? { available: false, xml: empty }
          : {
              available: true,
              xml: `<D:getcontenttype>${escapeText(res.contentType ?? "application/octet-stream")}</D:getcontenttype>`,
            };
      case "getetag":
        return res.isDir || !res.etag
          ? { available: false, xml: empty }
          : { available: true, xml: `<D:getetag>${escapeText(res.etag)}</D:getetag>` };
      case "getlastmodified":
        return {
          available: true,
          xml: `<D:getlastmodified>${httpDate(res.lastModified)}</D:getlastmodified>`,
        };
      case "creationdate":
        return { available: true, xml: `<D:creationdate>${isoDate(res.created)}</D:creationdate>` };
      case "supportedlock":
        return { available: true, xml: SUPPORTED_LOCK };
      case "lockdiscovery":
        return { available: true, xml: renderLockDiscovery(locks) };
      case "quota-available-bytes":
        return {
          available: res.isDir,
          xml: res.isDir
            ? `<D:quota-available-bytes>${VIRTUAL_QUOTA_AVAILABLE}</D:quota-available-bytes>`
            : empty,
        };
      case "quota-used-bytes":
        return {
          available: res.isDir,
          xml: res.isDir ? `<D:quota-used-bytes>${res.size}</D:quota-used-bytes>` : empty,
        };
      default:
        return { available: false, xml: empty };
    }
  }

  if (prop.uri === NS_MS) {
    switch (prop.name) {
      case "Win32FileAttributes":
        return {
          available: true,
          xml: `<Z:Win32FileAttributes>${res.isDir ? "00000010" : "00000020"}</Z:Win32FileAttributes>`,
        };
      case "Win32LastModifiedTime":
        return {
          available: true,
          xml: `<Z:Win32LastModifiedTime>${httpDate(res.lastModified)}</Z:Win32LastModifiedTime>`,
        };
      case "Win32CreationTime":
        return {
          available: true,
          xml: `<Z:Win32CreationTime>${httpDate(res.created)}</Z:Win32CreationTime>`,
        };
      case "Win32LastAccessTime":
        return {
          available: true,
          xml: `<Z:Win32LastAccessTime>${httpDate(res.lastModified)}</Z:Win32LastAccessTime>`,
        };
      default:
        return { available: false, xml: empty };
    }
  }

  const dead = res.dead[`${prop.uri}\u0000${prop.name}`];
  if (dead !== undefined) {
    const tag = tagName(prop);
    return {
      available: true,
      xml: `<${tag}${nsDeclFor(prop)}>${escapeText(dead)}</${tag}>`,
    };
  }
  return { available: false, xml: empty };
}

export function renderResponse(
  res: DavRes,
  requested: PropName[] | null,
  propnameMode: boolean,
  locks: LockRecord[]
): string {
  const href = encodePath(res.path) + (res.isDir && res.path !== "/" ? "/" : "");
  const list = requested ?? ALLPROP;

  const found: string[] = [];
  const missing: string[] = [];

  for (const prop of list) {
    const rendered = renderOne(prop, res, locks);
    if (!rendered.available) {
      missing.push(rendered.xml);
      continue;
    }
    if (propnameMode) {
      found.push(`<${tagName(prop)}${nsDeclFor(prop)}/>`);
    } else {
      found.push(rendered.xml);
    }
  }

  let body = `<D:response><D:href>${href}</D:href>`;
  if (found.length > 0) {
    body += `<D:propstat><D:prop>${found.join("")}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`;
  }
  if (missing.length > 0) {
    body += `<D:propstat><D:prop>${missing.join("")}</D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>`;
  }
  body += "</D:response>";
  return body;
}

export function buildMultiStatus(responses: string[]): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<D:multistatus xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:" ' +
    'xmlns:A="http://apache.org/dav/props/">' +
    responses.join("") +
    "</D:multistatus>"
  );
}

export function buildLockResponse(lock: LockRecord): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<D:prop xmlns:D="DAV:">${renderLockDiscovery([lock])}</D:prop>`
  );
}

export function buildPropStat(propXml: string[], status: string): string {
  return `<D:propstat><D:prop>${propXml.join("")}</D:prop><D:status>${status}</D:status></D:propstat>`;
}

export function buildStatusResponse(href: string, status: string): string {
  return `<D:response><D:href>${href}</D:href><D:status>${status}</D:status></D:response>`;
}
