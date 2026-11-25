import type { ShareRecord } from "./share";
import { escapeHtml, fmtSize } from "./share";
import { mimeOf } from "./utils";

/**
 * 公开分享页
 *
 * 与文件管理器不同，这个页面不持有任何凭据 —— 它的全部权限来自分享记录本身：
 * - 无提取码的分享：直接给出下载入口
 * - 有提取码：先 POST 换 token，token 存 sessionStorage，随后的下载/列目录请求带上
 *
 * 页面只输出分享记录里已有的元信息（文件名、大小、时间），不含目录内其它内容。
 */
export function renderSharePage(rec: ShareRecord): string {
  const name = escapeHtml(rec.name || "未命名");
  const sizeText = rec.isDir ? "文件夹" : fmtSize(rec.size);
  const created = fmtDateTime(rec.createdAt);
  const expireText =
    rec.expiresAt === null ? "长期有效" : `有效期至 ${fmtDateTime(rec.expiresAt)}`;
  const max = rec.maxDownloads ?? null;
  const left = max === null ? null : Math.max(0, max - rec.downloads);
  const quotaText =
    max === null ? "下载次数不限" : `已下载 ${rec.downloads} / ${max} 次`;
  const kind = rec.isDir ? "dir" : "file";
  /* 老数据可能存的是 application/octet-stream，用扩展名兜底一次，
     否则图片/视频分享页不会出现预览 */
  const mime =
    rec.contentType && rec.contentType !== "application/octet-stream"
      ? rec.contentType
      : mimeOf(rec.name);

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex,nofollow">
<title>${name} · 文件分享</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234f46e5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'/%3E%3C/svg%3E">
<style>
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#f6f7fb; --panel:#fff; --text:#12141a; --text2:#5b6472; --text3:#8b94a3;
  --border:#e6e9f0; --border2:#eef1f6; --brand:#4f46e5; --brand-weak:#eef0ff;
  --ok:#0f9d58; --shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.06);
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0d0f14; --panel:#151922; --text:#e8eaed; --text2:#9aa4b0; --text3:#7b8592;
    --border:#242a35; --border2:#1d222b; --brand:#8b87ff; --brand-weak:#20233a;
    --ok:#3ddc84; --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.35);
  }
}
html,body{margin:0;padding:0}
body{
  min-height:100vh;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;
}
.top{
  height:56px;display:flex;align-items:center;gap:10px;padding:0 20px;
  border-bottom:1px solid var(--border);background:var(--panel);
}
.logo{
  width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#5b52ff,#8b7dff);
  display:grid;place-items:center;color:#fff;flex:none;
}
.logo svg{width:16px;height:16px}
.brand{font-weight:650;font-size:14.5px;letter-spacing:-.2px}
.brand span{color:var(--text3);font-weight:500;margin-left:6px;font-size:12.5px}
.wrap{flex:1;display:flex;justify-content:center;align-items:flex-start;padding:34px 18px 60px}
.card{
  width:100%;max-width:620px;background:var(--panel);border:1px solid var(--border);
  border-radius:16px;box-shadow:var(--shadow);padding:26px 26px 22px;
  animation:in .28s cubic-bezier(.2,.8,.3,1);
}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.fhead{display:flex;align-items:flex-start;gap:14px}
.fico{
  width:52px;height:52px;border-radius:13px;background:var(--brand-weak);color:var(--brand);
  display:grid;place-items:center;flex:none;
}
.fico svg{width:26px;height:26px}
.fmeta{min-width:0;flex:1}
.fname{
  font-size:17px;font-weight:650;letter-spacing:-.2px;word-break:break-all;line-height:1.4;
  margin:1px 0 5px;
}
.fsub{color:var(--text3);font-size:12.5px;display:flex;flex-wrap:wrap;gap:4px 10px}
.fsub i{font-style:normal;opacity:.55}
.divider{height:1px;background:var(--border2);margin:20px 0}
.pv{
  border-radius:12px;overflow:hidden;background:var(--bg);border:1px solid var(--border2);
  margin-bottom:16px;display:flex;align-items:center;justify-content:center;
}
.pv img{display:block;max-width:100%;max-height:min(52vh,440px);object-fit:contain}
.pv video{display:block;width:100%;max-height:min(52vh,440px);background:#000}
.pv-audio{padding:26px 18px}
.pv-audio audio{width:100%;max-width:420px}
.pv-pdf{height:min(64vh,560px);display:block}
.pv-pdf iframe{display:block;width:100%;height:100%;border:0;background:#fff}
.btn{
  height:40px;padding:0 18px;border-radius:10px;border:1px solid transparent;
  background:var(--brand);color:#fff;font-size:13.5px;font-weight:600;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:7px;
  transition:filter .15s,transform .06s;font-family:inherit;
}
.btn:hover{filter:brightness(1.06)}
.btn:active{transform:scale(.985)}
.btn[disabled]{opacity:.6;cursor:not-allowed}
.btn svg{width:16px;height:16px}
.btn-block{width:100%}
.btn-ghost{background:transparent;border-color:var(--border);color:var(--text)}
.btn-ghost:hover{background:var(--bg)}
.hint{color:var(--text3);font-size:12.5px;text-align:center;margin-top:12px}
.safety{
  display:flex;align-items:flex-start;gap:8px;margin-top:20px;padding:11px 13px;
  border-radius:10px;background:var(--bg);border:1px solid var(--border2);
  color:var(--text3);font-size:12px;line-height:1.55;
}
.safety svg{width:15px;height:15px;flex:none;margin-top:1px;color:var(--ok)}
.pwfield{margin-top:2px}
.label{display:block;font-size:12.5px;font-weight:600;color:var(--text2);margin-bottom:7px}
.input{
  width:100%;height:42px;border-radius:10px;border:1px solid var(--border);
  background:var(--bg);color:var(--text);padding:0 13px;font-size:14px;font-family:inherit;
  outline:none;transition:border-color .15s,box-shadow .15s;
}
.input:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-weak)}
.err{color:#e5484d;font-size:12.5px;margin-top:9px;display:none}
.err.on{display:block}

/* 目录列表 */
.list{margin-top:4px;max-height:min(52vh,430px);overflow:auto;border-radius:11px}
.crumb{
  display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:12.5px;
  color:var(--text3);margin-bottom:10px;
}
.crumb b{color:var(--text);font-weight:600;cursor:pointer}
.crumb b:hover{color:var(--brand)}
.crumb .sep{opacity:.45}
.qleft{font-size:12px;color:var(--text3);margin:0 0 8px}
.item{
  display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:9px;
  cursor:pointer;border:1px solid transparent;
}
.item:hover{background:var(--bg);border-color:var(--border2)}
.item .ic{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;flex:none;background:var(--brand-weak);color:var(--brand)}
.item .ic.dir{background:#fff4e5;color:#c77700}
@media (prefers-color-scheme: dark){.item .ic.dir{background:#3a2a12;color:#f0a742}}
.item .ic svg{width:17px;height:17px}
.item .nm{flex:1;min-width:0;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .sz{color:var(--text3);font-size:12px;flex:none;font-variant-numeric:tabular-nums}
.item .dl{
  flex:none;width:30px;height:30px;border-radius:7px;display:grid;place-items:center;
  color:var(--text3);background:transparent;border:none;cursor:pointer;
}
.item .dl:hover{background:var(--brand-weak);color:var(--brand)}
.item .dl svg{width:15px;height:15px}
.empty{padding:34px 0;text-align:center;color:var(--text3);font-size:13px}
.skel{height:46px;border-radius:9px;background:var(--border2);margin-bottom:8px;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}
.foot{text-align:center;color:var(--text3);font-size:11.5px;padding:0 18px 26px}
.foot a{color:var(--text3);text-decoration:none;border-bottom:1px dotted var(--border)}
@media (max-width:560px){
  .wrap{padding:16px 12px 40px}
  .card{padding:20px 16px 16px;border-radius:14px}
  .fname{font-size:15.5px}
  .fico{width:46px;height:46px;border-radius:11px}
  .logo+.brand{font-size:13.5px}
  .top{padding:0 14px;height:52px}
}
</style>
</head>
<body>
<div class="top">
  <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg></div>
  <div class="brand">云盘<span>文件分享</span></div>
</div>

<div class="wrap">
  <div class="card" id="card">
    <div class="fhead">
      <div class="fico" id="fico"></div>
      <div class="fmeta">
        <div class="fname" id="fname"></div>
        <div class="fsub">
          <span id="fsize"></span><i>·</i>
          <span id="fcreated">${escapeHtml(created)} 分享</span><i>·</i>
          <span id="fexpire">${escapeHtml(expireText)}</span><i>·</i>
          <span id="fquota">${escapeHtml(quotaText)}</span>
        </div>
      </div>
    </div>
    <div class="divider"></div>
    <div id="body"></div>
  </div>
</div>

<div class="foot">由 WebDAV over Cloudflare R2 提供</div>

<script>
var SHARE = {
  id: ${JSON.stringify(rec.id)},
  name: ${JSON.stringify(rec.name || "未命名")},
  kind: ${JSON.stringify(kind)},
  mime: ${JSON.stringify(mime)},
  needsPassword: ${rec.needsPassword ? "true" : "false"},
  createdAt: ${JSON.stringify(rec.createdAt)},
  expiresAt: ${JSON.stringify(rec.expiresAt)},
  max: ${JSON.stringify(max)},
  left: ${JSON.stringify(left)}
};
var TOKEN_KEY = "dav.share." + SHARE.id;
var token = "";

function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fmtSize(n){
  if(n === null || n === undefined || isNaN(n)) return "";
  if(n < 1024) return n + " B";
  var u = ["KB","MB","GB","TB"], v = n / 1024, i = 0;
  while(v >= 1024 && i < u.length - 1){ v /= 1024; i++; }
  return (v >= 10 ? v.toFixed(1) : v.toFixed(2)) + " " + u[i];
}
var ICON_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
var ICON_DIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
var ICON_DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l4-4m-4 4l-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';

$("fname").textContent = SHARE.name;
$("fsize").textContent = SHARE.kind === "dir" ? "文件夹" : ${JSON.stringify(sizeText)};
$("fico").innerHTML = SHARE.kind === "dir" ? ICON_DIR : ICON_FILE;

/* 时间按访问者的本地时区重画；服务端那行是 UTC 文本，只作无脚本时的兜底 */
function fmtDT(ms){
  var d = new Date(ms);
  var p = function(n){ return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
try {
  $("fcreated").textContent = fmtDT(SHARE.createdAt) + " 分享";
  $("fexpire").textContent = SHARE.expiresAt === null ? "长期有效" : "有效期至 " + fmtDT(SHARE.expiresAt);
} catch(e){}

try {
  var saved = sessionStorage.getItem(TOKEN_KEY);
  if(saved){
    var p = saved.split(".");
    if(p.length === 3 && Number(p[1]) > Date.now()) token = saved;
  }
} catch(e){}

function api(path, opts){
  opts = opts || {};
  var headers = opts.headers || {};
  return fetch(path, {
    method: opts.method || "GET",
    headers: headers,
    body: opts.body,
    credentials: "omit",
    cache: "no-store"
  });
}

/* ---------- 提取码 ---------- */
function renderPassword(msg){
  var html = '<div class="pwfield">' +
    '<label class="label" for="pw">请输入提取码</label>' +
    '<input class="input" id="pw" type="text" inputmode="text" autocomplete="off" placeholder="输入分享者提供的提取码">' +
    '<div class="err" id="pwerr"></div>' +
    '</div>' +
    '<button class="btn btn-block" id="pwgo" style="margin-top:14px">提取文件</button>' +
    '<div class="hint">此分享设置了提取码，请输入后继续</div>';
  $("body").innerHTML = html;
  var errEl = $("pwerr");
  if(msg){ errEl.textContent = msg; errEl.classList.add("on"); }
  $("pwgo").onclick = submitPassword;
  $("pw").addEventListener("keydown", function(e){ if(e.key === "Enter") submitPassword(); });
  setTimeout(function(){ var el = $("pw"); if(el) el.focus(); }, 120);
}

function submitPassword(){
  var el = $("pw");
  if(!el) return;
  var val = el.value.trim();
  var btn = $("pwgo");
  var errEl = $("pwerr");
  if(!val){
    errEl.textContent = "请先输入提取码";
    errEl.classList.add("on");
    return;
  }
  btn.disabled = true; btn.textContent = "验证中…";
  api("/__s/" + SHARE.id + "/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: val })
  }).then(function(r){
    if(r.ok) return r.json();
    return r.json().then(function(j){ throw new Error(j.error || "提取码错误"); });
  }).then(function(j){
    token = j.token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch(e){}
    renderMain();
  }).catch(function(e){
    btn.disabled = false; btn.textContent = "提取文件";
    errEl.textContent = e.message || "提取码错误";
    errEl.classList.add("on");
    el.select();
  });
}

/* ---------- 主内容 ---------- */
function previewKind(mime){
  if(!mime) return "";
  if(mime.indexOf("image/") === 0) return "image";
  if(mime.indexOf("video/") === 0) return "video";
  if(mime.indexOf("audio/") === 0) return "audio";
  if(mime === "application/pdf") return "pdf";
  if(mime.indexOf("text/") === 0) return "text";
  return "";
}

function renderMain(){
  if(SHARE.kind === "file"){
    var pk = previewKind(SHARE.mime);
    var pv = "";
    if(pk === "image"){
      pv = '<div class="pv"><img id="pvImg" alt=""></div>';
    } else if(pk === "video"){
      pv = '<div class="pv"><video id="pvVid" controls preload="metadata"></video></div>';
    } else if(pk === "audio"){
      pv = '<div class="pv pv-audio"><audio id="pvAud" controls preload="metadata"></audio></div>';
    } else if(pk === "pdf"){
      pv = '<div class="pv pv-pdf"><iframe id="pvPdf" title="PDF 预览"></iframe></div>';
    }
    $("body").innerHTML = pv +
      '<button class="btn btn-block" id="dl1">' + ICON_DL + "下载文件" + '</button>' +
      '<div class="hint">' + (SHARE.max === null
        ? "点击后开始下载，文件会保存到你本机"
        : "点击后开始下载，本次下载后还剩 " + SHARE.left + " 次") + '</div>' +
      '<div class="safety">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>' +
        '<span>请确认文件来源可信后再打开，尤其是可执行文件与压缩包</span>' +
      '</div>';

    var inlineSrc = rawUrl("") + (rawUrl("").indexOf("?") >= 0 ? "&" : "?") + "inline=1";
    if(pk === "image") $("pvImg").src = inlineSrc;
    if(pk === "video") $("pvVid").src = inlineSrc;
    if(pk === "audio") $("pvAud").src = inlineSrc;
    if(pk === "pdf") $("pvPdf").src = inlineSrc;

    $("dl1").onclick = function(){ bumpLocal(); window.location.href = rawUrl(""); };
    return;
  }
  renderDir("");
}

/* 下载后本地的剩余次数立刻减一，不必等刷新 */
function bumpLocal(){
  if(SHARE.max === null) return;
  SHARE.left = Math.max(0, SHARE.left - 1);
  var q = $("qleft");
  if(q) q.textContent = "剩余可下载 " + SHARE.left + " 次（预览不计次）";
  var h = document.querySelector(".hint");
  if(h && SHARE.kind === "file") h.textContent = "点击后开始下载，本次下载后还剩 " + SHARE.left + " 次";
}

function qs(p){
  var q = [];
  if(p) q.push("p=" + encodeURIComponent(p));
  if(token) q.push("token=" + encodeURIComponent(token));
  return q.length ? "?" + q.join("&") : "";
}

function rawUrl(p){
  return "/__s/" + SHARE.id + "/raw" + qs(p);
}

function renderDir(sub){
  $("body").innerHTML = '<div id="crumbs"></div>' +
    (SHARE.max === null ? "" : '<div class="qleft" id="qleft">剩余可下载 ' + SHARE.left + ' 次（预览不计次）</div>') +
    '<div class="list" id="list"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
  api("/__s/" + SHARE.id + "/list" + qs(sub))
    .then(function(r){
      if(r.status === 401){ token = ""; try{ sessionStorage.removeItem(TOKEN_KEY); }catch(e){} renderPassword("会话已过期，请重新输入提取码"); throw new Error("__handled__"); }
      if(!r.ok) throw new Error("列目录失败（" + r.status + "）");
      return r.json();
    })
    .then(function(j){
      renderCrumbs(sub || "");
      var items = j.items || [];
      if(items.length === 0){
        $("list").innerHTML = '<div class="empty">这个文件夹是空的</div>';
        return;
      }
      var html = "";
      items.forEach(function(it){
        var p = it.rel;
        html += '<div class="item" data-rel="' + esc(p) + '" data-dir="' + (it.isDir ? "1" : "0") + '">' +
          '<div class="ic' + (it.isDir ? " dir" : "") + '">' + (it.isDir ? ICON_DIR : ICON_FILE) + '</div>' +
          '<div class="nm" title="' + esc(it.name) + '">' + esc(it.name) + '</div>' +
          '<div class="sz">' + (it.isDir ? "" : esc(fmtSize(it.size))) + '</div>' +
          (it.isDir ? "" : '<button class="dl" data-dl="' + esc(p) + '" title="下载">' + ICON_DL + '</button>') +
          '</div>';
      });
      $("list").innerHTML = html;
      Array.prototype.forEach.call($("list").querySelectorAll(".item"), function(el){
        var rel = el.getAttribute("data-rel");
        var isDir = el.getAttribute("data-dir") === "1";
        el.addEventListener("click", function(e){
          if(e.target.closest("[data-dl]")) return;
          if(isDir) renderDir(rel);
          else { bumpLocal(); window.location.href = rawUrl(rel); }
        });
      });
      Array.prototype.forEach.call($("list").querySelectorAll("[data-dl]"), function(b){
        b.addEventListener("click", function(e){
          e.stopPropagation();
          bumpLocal();
          window.location.href = rawUrl(b.getAttribute("data-dl"));
        });
      });
    })
    .catch(function(e){
      if(e.message === "__handled__") return;
      $("list").innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    });
}

function renderCrumbs(sub){
  var el = $("crumbs");
  if(!el) return;
  var parts = sub ? sub.split("/") : [];
  var html = '<b data-nav="">全部文件</b>';
  var acc = "";
  parts.forEach(function(seg){
    acc = acc ? acc + "/" + seg : seg;
    html += '<span class="sep">/</span><b data-nav="' + esc(acc) + '">' + esc(seg) + '</b>';
  });
  el.className = "crumb";
  el.innerHTML = html;
  Array.prototype.forEach.call(el.querySelectorAll("[data-nav]"), function(b){
    b.addEventListener("click", function(){ renderDir(b.getAttribute("data-nav")); });
  });
}

/* ---------- 启动 ---------- */
if(SHARE.needsPassword && !token){
  renderPassword("");
} else if(SHARE.needsPassword && token){
  renderMain();
} else {
  renderMain();
}
</script>
</body>
</html>`;
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 分享已失效 / 不存在的提示页 */
export function renderShareError(title: string, detail: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#f6f7fb;--panel:#fff;--text:#12141a;--text2:#5b6472;--border:#e6e9f0}
@media (prefers-color-scheme: dark){:root{--bg:#0d0f14;--panel:#151922;--text:#e8eaed;--text2:#9aa4b0;--border:#242a35}}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);display:grid;place-items:center;
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}
.box{max-width:380px;padding:34px 28px;text-align:center;background:var(--panel);
 border:1px solid var(--border);border-radius:16px;margin:20px}
.ic{width:52px;height:52px;border-radius:14px;background:#fee;color:#e5484d;display:grid;place-items:center;margin:0 auto 16px}
@media (prefers-color-scheme: dark){.ic{background:#3a1a1c;color:#ff7b81}}
h1{font-size:16.5px;margin:0 0 8px;font-weight:650}
p{margin:0;color:var(--text2);font-size:13px;line-height:1.65}
</style>
</head>
<body>
<div class="box">
  <div class="ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/></svg></div>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(detail)}</p>
</div>
</body>
</html>`;
}
