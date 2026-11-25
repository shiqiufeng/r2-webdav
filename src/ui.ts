/**
 * 浏览器端文件管理器（单页应用）
 *
 * 设计原则：不新增任何私有 API —— 前端就是一台标准 WebDAV 客户端，
 * 用 PROPFIND / PUT / MKCOL / MOVE / DELETE 与同一个 Worker 通信，
 * 因此 UI 的任何操作都等价于 Finder / 资源管理器 / rclone 的操作。
 *
 * initAuth: 浏览器已通过 Basic Auth 弹窗认证时，服务端会把 base64 凭据注入，
 *           页面可免登录直接进入（绝不注入未通过校验的凭据）。
 * defaultUser: 服务端 WEBDAV_USER 的当前值，用于预填登录框；前端不再硬编码用户名。
 */
/** 服务端侧属性转义：仅用于把 env 值安全注入 HTML 属性 */
function attrEsc(input: string): string {
  return input.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/** 服务端侧脚本常量转义：防止 </script> 提前闭合 */
function jsConst(input: string): string {
  return JSON.stringify(input).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function renderUi(initAuth = "", defaultUser = "admin"): string {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>云盘 · WebDAV</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234f46e5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'/%3E%3C/svg%3E">
<style>
:root{
  --bg:#f5f6f8; --panel:#ffffff; --panel2:#fbfbfd; --text:#101828; --text2:#667085; --text3:#98a2b3;
  --border:#e6e8ec; --border2:#eef0f3; --hover:#f4f5f8; --active:#eceefb;
  --accent:#4f46e5; --accent2:#6366f1; --accent-soft:#eef2ff; --accent-text:#4338ca;
  --brand:#4f46e5; --brand-weak:#eef2ff;
  --quota-warn:#b45309; --quota-full:#e5484d;
  --danger:#e5484d; --danger-soft:#fef1f1; --ok:#12a594;
  --shadow-sm:0 1px 2px rgba(16,24,40,.05);
  --shadow:0 2px 4px rgba(16,24,40,.04),0 12px 32px -8px rgba(16,24,40,.12);
  --shadow-lg:0 24px 64px -12px rgba(16,24,40,.22),0 2px 8px rgba(16,24,40,.06);
  --r:10px; --r-lg:14px;
  --topbar:58px;
}
html[data-theme="dark"]{
  --bg:#0c0e12; --panel:#14171d; --panel2:#171b22; --text:#e8eaed; --text2:#9aa4b0; --text3:#7b8592;
  --border:#242932; --border2:#1d222a; --hover:#1b2028; --active:#232a3b;
  --accent:#818cf8; --accent2:#6366f1; --accent-soft:#1e1f3a; --accent-text:#a5b4fc;
  --brand:#818cf8; --brand-weak:#1e1f3a;
  --quota-warn:#fbbf24; --quota-full:#ff7b7b;
  --danger:#f87171; --danger-soft:#2a1618; --ok:#2dd4bf;
  --shadow-sm:0 1px 2px rgba(0,0,0,.4);
  --shadow:0 2px 4px rgba(0,0,0,.3),0 12px 32px -8px rgba(0,0,0,.5);
  --shadow-lg:0 24px 64px -12px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4);
}
@media (prefers-color-scheme:dark){
  html[data-theme="auto"]{
    --bg:#0c0e12; --panel:#14171d; --panel2:#171b22; --text:#e8eaed; --text2:#9aa4b0; --text3:#7b8592;
    --border:#242932; --border2:#1d222a; --hover:#1b2028; --active:#232a3b;
    --accent:#818cf8; --accent2:#6366f1; --accent-soft:#1e1f3a; --accent-text:#a5b4fc;
    --brand:#818cf8; --brand-weak:#1e1f3a;
  --quota-warn:#fbbf24; --quota-full:#ff7b7b;
    --danger:#f87171; --danger-soft:#2a1618; --ok:#2dd4bf;
    --shadow-sm:0 1px 2px rgba(0,0,0,.4);
    --shadow:0 2px 4px rgba(0,0,0,.3),0 12px 32px -8px rgba(0,0,0,.5);
    --shadow-lg:0 24px 64px -12px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4);
  }
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;background:var(--bg);color:var(--text);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer;border:none;background:none;padding:0}
a{color:var(--accent);text-decoration:none}
svg{display:block;flex:none}
::selection{background:var(--accent);color:#fff}
.hidden{display:none!important}

/* 滚动条 */
*{scrollbar-width:thin;scrollbar-color:var(--border) transparent}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:8px;border:3px solid transparent;background-clip:content-box}
::-webkit-scrollbar-thumb:hover{background:var(--text3);background-clip:content-box}

/* ---------------- 启动遮罩 ---------------- */
/* 刷新时先盖住整页，等本地凭据校验完再决定进主界面还是登录页，
   否则会先闪一下登录表单再跳到文件列表。 */
#boot{
  position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(900px 500px at 50% -10%,var(--accent-soft),transparent 60%),var(--bg);
  transition:opacity .18s ease;
}
#boot.out{opacity:0;pointer-events:none}
.boot-logo{
  width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,var(--accent2),var(--accent));color:#fff;
  box-shadow:0 8px 20px -6px var(--accent);
}
.boot-bar{width:118px;height:3px;border-radius:3px;background:var(--border2);overflow:hidden;margin:16px auto 0}
.boot-bar i{display:block;width:44%;height:100%;border-radius:3px;background:var(--accent);animation:bootSlide 1.1s cubic-bezier(.4,0,.2,1) infinite}
@keyframes bootSlide{0%{transform:translateX(-110%)}100%{transform:translateX(330%)}}

/* ---------------- 登录 ---------------- */
#login{
  position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;
  background:radial-gradient(900px 500px at 50% -10%,var(--accent-soft),transparent 60%),var(--bg);
  z-index:60;
}
.login-card{
  width:100%;max-width:384px;background:var(--panel);border:1px solid var(--border);
  border-radius:18px;padding:32px 28px 24px;box-shadow:var(--shadow-lg);
}
.login-logo{
  width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,var(--accent2),var(--accent));color:#fff;
  box-shadow:0 8px 20px -6px var(--accent);margin-bottom:18px;
}
.login-card h1{font-size:20px;font-weight:650;margin:0 0 20px;letter-spacing:-.2px}
.field{margin-bottom:14px}
.field label{display:block;font-size:12.5px;font-weight:550;color:var(--text2);margin-bottom:6px}
.input{
  width:100%;height:40px;padding:0 12px;border-radius:var(--r);
  border:1px solid var(--border);background:var(--panel2);outline:none;transition:.15s;
}
.input:focus{border-color:var(--accent);background:var(--panel);box-shadow:0 0 0 3px var(--accent-soft)}
.pw-field{position:relative}
.pw-field .input{padding-right:44px}
.pw-toggle{
  position:absolute;right:5px;top:50%;transform:translateY(-50%);
  width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;
  border:0;border-radius:8px;background:transparent;color:var(--text3);cursor:pointer;
  transition:color .13s,background .13s;padding:0;
}
.pw-toggle:hover{background:var(--panel2);color:var(--text2)}
.pw-toggle.on{color:var(--accent)}
.pw-toggle svg{pointer-events:none}
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 14px;
  border-radius:var(--r);font-size:13.5px;font-weight:550;border:1px solid transparent;
  transition:background .13s,border-color .13s,opacity .13s,transform .08s;white-space:nowrap;
}
.btn:active{transform:scale(.975)}
.btn-primary{background:var(--accent);color:#fff;box-shadow:0 1px 2px rgba(79,70,229,.3)}
.btn-primary:hover{filter:brightness(1.06)}
.btn-ghost{border-color:var(--border);background:var(--panel);color:var(--text)}
.btn-ghost:hover{background:var(--hover)}
.btn-danger{background:var(--danger);color:#fff}
.btn-danger:hover{filter:brightness(1.06)}
.btn-quiet{color:var(--text2)}
.btn-quiet:hover{background:var(--hover);color:var(--text)}
.btn-block{width:100%;height:42px;font-size:14px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-sm{height:30px;padding:0 10px;font-size:12.5px;border-radius:8px}
.login-err{
  margin-top:14px;padding:9px 12px;border-radius:8px;font-size:12.5px;
  background:var(--danger-soft);color:var(--danger);border:1px solid color-mix(in srgb,var(--danger) 25%,transparent);
}

/* ---------------- 主框架 ---------------- */
#app{display:flex;flex-direction:column;height:100vh;height:100dvh}
.topbar{
  height:var(--topbar);flex:none;display:flex;align-items:center;gap:12px;
  padding:0 14px;background:var(--panel);border-bottom:1px solid var(--border);
  position:relative;z-index:20;
}
.brand{display:flex;align-items:center;gap:9px;padding-right:4px;flex:none}
.brand-mark{
  width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,var(--accent2),var(--accent));color:#fff;flex:none;
}
.brand-name{font-size:14.5px;font-weight:650;letter-spacing:-.2px}
.brand-name span{color:var(--text3);font-weight:400;font-size:12px;margin-left:5px}

.search{position:relative;flex:1;max-width:420px;margin-left:auto}
.search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--text3)}
.search input{
  width:100%;height:34px;padding:0 32px 0 34px;border-radius:8px;
  border:1px solid transparent;background:var(--bg);outline:none;font-size:13px;transition:.15s;
}
.search input:focus{border-color:var(--accent);background:var(--panel);box-shadow:0 0 0 3px var(--accent-soft)}
.search .clr{position:absolute;right:6px;top:50%;transform:translateY(-50%);padding:4px;border-radius:6px;color:var(--text3)}
.search .clr:hover{background:var(--hover);color:var(--text)}
.icon-btn{
  width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  color:var(--text2);transition:.13s;flex:none;
}
.icon-btn:hover{background:var(--hover);color:var(--text)}
.icon-btn.on{background:var(--accent-soft);color:var(--accent-text)}
.icon-btn:disabled{opacity:.35;cursor:default;background:none}
.topbar-actions{display:flex;align-items:center;gap:2px;flex:none}
.vsep{width:1px;height:20px;background:var(--border);margin:0 6px;flex:none}

.avatar{
  width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:var(--accent-soft);color:var(--accent-text);font-size:12.5px;font-weight:650;
  border:1px solid color-mix(in srgb,var(--accent) 20%,transparent);
}

/* ---------------- 容量 ---------------- */
/* 进度条按 9.9 GB 归一，走满就是「写不进去了」，不会让人以为还有余量 */
.quota{
  flex:none;width:126px;height:34px;padding:0 10px;border-radius:8px;
  display:flex;flex-direction:column;justify-content:center;gap:3px;
  background:var(--bg);border:1px solid transparent;transition:.13s;cursor:pointer;
}
.quota:hover{background:var(--hover);border-color:var(--border)}
.q-line{
  display:flex;align-items:baseline;gap:4px;font-size:11px;color:var(--text2);
  line-height:1.15;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;
}
.q-line b{color:var(--text);font-weight:600;font-size:11.5px}
.q-line em{font-style:normal;color:var(--text3)}
.q-bar{height:3px;border-radius:3px;background:var(--border2);overflow:hidden;flex:none}
.q-bar i{
  display:block;height:100%;width:0;border-radius:3px;background:var(--accent);
  transition:width .4s cubic-bezier(.4,0,.2,1),background .3s;
}
.quota.warn .q-bar i{background:var(--quota-warn)}
.quota.full .q-bar i{background:var(--quota-full)}
.quota.warn .q-line b{color:var(--quota-warn)}
.quota.full .q-line b{color:var(--quota-full)}
.q-s{display:none}

/* ---------------- 面包屑 + 工具条 ---------------- */
.crumbbar{
  flex:none;display:flex;align-items:center;gap:6px;padding:0 14px;height:46px;
  background:var(--panel);border-bottom:1px solid var(--border);overflow-x:auto;overflow-y:hidden;
}
.crumbbar::-webkit-scrollbar{height:0}
.crumbs{display:flex;align-items:center;gap:2px;font-size:13.5px;min-width:0}
.crumb{
  padding:4px 7px;border-radius:6px;color:var(--text2);white-space:nowrap;
  display:flex;align-items:center;gap:6px;transition:.12s;
}
.crumb:hover{background:var(--hover);color:var(--text)}
.crumb.cur{color:var(--text);font-weight:600;background:none}
.crumb.cur:hover{background:none}
.crumb-sep{color:var(--text3);font-size:12px;flex:none;user-select:none}
.crumb-ghost{color:var(--text3);font-size:12.5px;padding:4px 6px;border-radius:6px}
.crumb-ghost:hover{background:var(--hover);color:var(--text2)}

.toolbar{
  flex:none;display:flex;align-items:center;gap:8px;padding:9px 14px;
  background:var(--bg);border-bottom:1px solid var(--border);
}
.toolbar .spacer{flex:1}
.selinfo{font-size:12.5px;color:var(--text2);white-space:nowrap}
.selinfo b{color:var(--accent-text);font-weight:650}

/* ---------------- 内容区 ---------------- */
.content{flex:1;overflow:auto;overscroll-behavior:contain;padding:0 8px 80px}
.listwrap{max-width:1240px;margin:0 auto}

.thead{
  display:grid;grid-template-columns:38px 1fr 104px 156px 92px;align-items:center;
  height:34px;padding:0 8px;position:sticky;top:0;z-index:5;
  background:var(--bg);color:var(--text3);font-size:12px;font-weight:550;
  border-bottom:1px solid var(--border);
}
.thead > div{padding:0 6px}
.th-sort{cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px;border-radius:5px;height:24px;width:fit-content;padding:0 6px!important}
.th-sort:hover{background:var(--hover);color:var(--text2)}
.th-sort .arrow{opacity:0;transition:.12s}
.th-sort.on{color:var(--accent-text)}
.th-sort.on .arrow{opacity:1}

.row{
  display:grid;grid-template-columns:38px 1fr 104px 156px 92px;align-items:center;
  height:46px;padding:0 8px;border-radius:9px;cursor:default;
  transition:background .1s;position:relative;
}
.row:hover{background:var(--hover)}
.row.sel{background:var(--active)}
.row.sel:hover{background:var(--active)}
.row .c{min-width:0;padding:0 6px;display:flex;align-items:center;gap:10px}
.row .c-name{gap:11px}
.row .nm{
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;
  min-width:0;cursor:pointer;
}
.row .nm:hover{color:var(--accent-text);text-decoration:underline;text-underline-offset:2px}
.row .meta{font-size:12.5px;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}
.row .acts{display:flex;justify-content:flex-end;gap:1px;opacity:0;transition:opacity .12s}
.row:hover .acts,.row.sel .acts{opacity:1}
.row .dot{
  width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none;
  opacity:0;transition:opacity .12s;
}
.row.sel .dot{opacity:1}
.tick{
  width:17px;height:17px;border-radius:5px;border:1.5px solid var(--border);
  display:flex;align-items:center;justify-content:center;flex:none;cursor:pointer;
  transition:.12s;background:var(--panel);
}
.row:hover .tick{border-color:var(--text3)}
.tick:hover{border-color:var(--accent)}
.tick.on{background:var(--accent);border-color:var(--accent);color:#fff}
.tick svg{opacity:0;transition:opacity .1s}
.tick.on svg{opacity:1}

.fico{
  width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:none;
}
.fico.dir{background:color-mix(in srgb,#f59e0b 14%,transparent);color:#d97706}
.fico.img{background:color-mix(in srgb,#8b5cf6 14%,transparent);color:#7c3aed}
.fico.vid{background:color-mix(in srgb,#ec4899 14%,transparent);color:#db2777}
.fico.aud{background:color-mix(in srgb,#06b6d4 14%,transparent);color:#0891b2}
.fico.doc{background:color-mix(in srgb,#3b82f6 14%,transparent);color:#2563eb}
.fico.zip{background:color-mix(in srgb,#64748b 16%,transparent);color:#475569}
.fico.code{background:color-mix(in srgb,#10b981 14%,transparent);color:#059669}
.fico.bin{background:color-mix(in srgb,#94a3b8 16%,transparent);color:#64748b}

/* 网格视图 */
.gridview{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;padding:14px 8px}
.card{
  border:1px solid var(--border);border-radius:var(--r-lg);background:var(--panel);
  overflow:hidden;cursor:default;transition:.15s;position:relative;box-shadow:var(--shadow-sm);
}
.card:hover{box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--accent) 30%,var(--border));transform:translateY(-1px)}
.card.sel{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.card .thumb{
  height:100px;display:flex;align-items:center;justify-content:center;
  background:var(--panel2);border-bottom:1px solid var(--border2);overflow:hidden;position:relative;
}
.card .thumb img{width:100%;height:100%;object-fit:cover;display:block}
.card .thumb .fico{width:44px;height:44px;border-radius:11px}
.card .thumb .fico svg{width:24px;height:24px}
.card .thumb .fico[data-thumb]{width:100%;height:100%;border-radius:0;background:var(--panel2)}
.card .thumb .fico[data-thumb] img{width:100%;height:100%;object-fit:cover;display:block}
.card .cbody{padding:9px 10px 10px}
.card .cname{
  font-size:13px;font-weight:520;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  cursor:pointer;
}
.card .cname:hover{color:var(--accent-text)}
.card .cmeta{font-size:11.5px;color:var(--text3);margin-top:2px;font-variant-numeric:tabular-nums}
.card .card-acts{
  position:absolute;top:6px;right:6px;display:flex;gap:3px;opacity:0;transition:.12s;
}
.card:hover .card-acts{opacity:1}
.card .card-acts button{
  width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;
  background:color-mix(in srgb,var(--panel) 88%,transparent);color:var(--text2);
  backdrop-filter:blur(6px);border:1px solid var(--border);box-shadow:var(--shadow-sm);
}
.card .card-acts button:hover{background:var(--panel);color:var(--text)}
.card .card-tick{position:absolute;top:6px;left:6px;opacity:0;transition:.12s}
.card:hover .card-tick,.card.sel .card-tick{opacity:1}

/* 空状态 / 骨架 */
.empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:70px 20px;text-align:center;color:var(--text2);
}
.empty .ill{
  width:72px;height:72px;border-radius:20px;display:flex;align-items:center;justify-content:center;
  background:var(--panel);border:1px solid var(--border);color:var(--text3);
  margin-bottom:16px;box-shadow:var(--shadow-sm);
}
.empty h3{font-size:14.5px;font-weight:600;color:var(--text);margin:0 0 6px}
.empty p{font-size:13px;margin:0;max-width:340px;line-height:1.6}
.empty .btnrow{display:flex;gap:8px;margin-top:18px}
.skel{height:46px;border-radius:9px;margin:2px 8px;background:linear-gradient(90deg,var(--hover),var(--border2),var(--hover));background-size:200% 100%;animation:sh 1.3s infinite}
@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* ---------------- 对话框 ---------------- */
.overlay{
  position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
  padding:20px;background:rgba(8,10,14,.42);backdrop-filter:blur(2px);
  animation:fade .14s ease-out;
}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.dialog{
  width:100%;max-width:392px;background:var(--panel);border:1px solid var(--border);
  border-radius:16px;box-shadow:var(--shadow-lg);animation:pop .16s cubic-bezier(.2,.8,.3,1);
  overflow:hidden;
}
.dialog .dbody{padding:22px 22px 6px}
.dialog h2{font-size:15.5px;font-weight:640;margin:0 0 7px;letter-spacing:-.1px;display:flex;align-items:center;gap:9px}
.dialog p.msg{font-size:13px;color:var(--text2);margin:0 0 16px;line-height:1.6}
.dialog p.msg b{color:var(--text);font-weight:600;word-break:break-all}
.dialog .dfoot{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px 20px}

/* ---------------- 分享 ---------------- */
.share-dialog{
  max-width:470px;max-height:min(88vh,760px);display:flex;flex-direction:column;
}
.share-dialog .dbody{padding:20px 22px 4px;overflow-y:auto;flex:1;min-height:0;overscroll-behavior:contain}
.share-dialog .dfoot{flex:none;border-top:1px solid var(--border2);padding-top:14px}
.share-file{
  display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:11px;
  background:var(--bg);border:1px solid var(--border2);margin-bottom:18px;
}
.share-file .sfi{
  width:34px;height:34px;border-radius:9px;background:var(--brand-weak);color:var(--brand);
  display:grid;place-items:center;flex:none;
}
.share-file .sfi svg{width:17px;height:17px}
.share-file .sfn{min-width:0;flex:1}
.share-file .sfn b{display:block;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.share-file .sfn span{font-size:11.5px;color:var(--text3)}
.optrow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.optrow > label{font-size:12.5px;font-weight:550;color:var(--text2);flex:none}
.seg{display:flex;gap:2px;background:var(--bg);border:1px solid var(--border2);border-radius:9px;padding:2px}
.seg button{
  height:28px;padding:0 11px;border:none;background:transparent;color:var(--text2);
  font-size:12.5px;font-family:inherit;font-weight:550;border-radius:7px;cursor:pointer;
}
.seg button.on{background:var(--panel);color:var(--text);box-shadow:0 1px 2px rgba(16,24,40,.1)}
.sel-mini{
  height:32px;border-radius:8px;border:1px solid var(--border);background:var(--bg);
  color:var(--text);font-size:12.5px;font-family:inherit;padding:0 8px;outline:none;cursor:pointer;
}
.share-result{
  border:1px solid var(--border2);border-radius:12px;padding:14px;background:var(--bg);margin-bottom:16px;
}
.share-result .okline{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--ok);margin-bottom:12px}
.share-result .okline svg{width:15px;height:15px}
.linkrow{display:flex;gap:7px;margin-bottom:9px}
.linkrow input{
  flex:1;min-width:0;height:34px;border-radius:8px;border:1px solid var(--border);
  background:var(--panel);color:var(--text);font-size:11.5px;padding:0 10px;outline:none;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.2px;
  text-overflow:ellipsis;
}
.linkrow input:focus{border-color:var(--brand)}
.linkrow .btn{height:34px;padding:0 12px;font-size:12.5px;flex:none}
.pwcode{
  display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 4px 0 12px;
  border-radius:8px;border:1px dashed var(--brand);background:var(--brand-weak);
}
.pwcode b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;letter-spacing:.8px;color:var(--brand);font-weight:700}
.pwcode button{border:none;background:transparent;color:var(--brand);cursor:pointer;padding:0 8px;height:100%;font-size:12px;font-family:inherit}
.share-list{margin-top:6px}
.share-list{max-height:224px;overflow-y:auto;overscroll-behavior:contain}
.share-list h3{font-size:12px;font-weight:600;color:var(--text3);margin:0 0 8px;letter-spacing:.2px}
.share-item{
  display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;border:1px solid transparent;
}
.share-item:hover{background:var(--bg);border-color:var(--border2)}
.share-item .si-ic{width:28px;height:28px;border-radius:7px;background:var(--brand-weak);color:var(--brand);display:grid;place-items:center;flex:none}
.share-item .si-ic svg{width:14px;height:14px}
.share-item .si-n{min-width:0;flex:1}
.share-item .si-n b{display:flex;align-items:center;gap:3px;min-width:0;font-size:12.5px;font-weight:550}
.share-item .si-n .si-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:normal}
.share-item .si-n span{
  font-size:11px;color:var(--text3);display:block;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.si-lock{display:inline-flex;flex:none;margin-left:1px;color:var(--brand);opacity:.85}
.share-item .si-act{display:flex;gap:2px;flex:none}
.share-item .si-act button{
  width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:var(--text2);
  cursor:pointer;display:grid;place-items:center;
}
.share-item .si-act button:hover{background:var(--panel);color:var(--brand)}
.share-item .si-act button.dg:hover{color:var(--danger)}
.share-empty{
  font-size:12px;color:var(--text3);padding:14px 12px;text-align:center;
  border:1px dashed var(--border);border-radius:9px;background:var(--bg);
}

/* ---------------- 我的分享面板 ---------------- */
#shares{
  position:fixed;inset:0;z-index:66;display:flex;align-items:center;justify-content:center;
  padding:24px;background:rgba(8,10,14,.45);backdrop-filter:blur(3px);animation:fade .14s;
}
.sp-card{
  width:min(760px,100%);max-height:min(78vh,720px);display:flex;flex-direction:column;
  background:var(--panel);border:1px solid var(--border);border-radius:16px;
  box-shadow:var(--shadow-lg);overflow:hidden;animation:pop .16s cubic-bezier(.2,.8,.3,1);
}
.sp-head{display:flex;align-items:center;gap:9px;padding:15px 18px 11px}
.sp-head h2{margin:0;font-size:16px;font-weight:650;letter-spacing:-.2px}
.sp-cnt{font-size:12px;color:var(--text3);font-variant-numeric:tabular-nums}
.sp-head .icon-btn{margin-left:auto;width:30px;height:30px}
.sp-bar{display:flex;align-items:center;gap:8px;padding:0 18px 12px;flex-wrap:wrap}
.sp-search{
  flex:1;min-width:150px;display:flex;align-items:center;gap:7px;height:32px;padding:0 10px;
  border:1px solid var(--border);border-radius:8px;background:var(--panel2);color:var(--text3);
}
.sp-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:12.5px;color:var(--text)}
.sp-all{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text2);cursor:pointer;user-select:none}
.sp-list{flex:1;overflow:auto;padding:0 14px 14px;overscroll-behavior:contain}
.sp-row{
  display:flex;align-items:center;gap:10px;padding:10px;margin-bottom:8px;
  border:1px solid var(--border2);border-radius:10px;background:var(--panel2);cursor:pointer;
  transition:border-color .12s,background .12s;
}
.sp-row:hover{border-color:var(--border);background:var(--hover)}
.sp-row.on{border-color:var(--accent);background:var(--accent-soft)}
.sp-row .si-ic{width:30px;height:30px;border-radius:8px;background:var(--brand-weak);color:var(--brand);display:grid;place-items:center;flex:none}
.sp-row .si-n{min-width:0;flex:1}
.sp-row .si-n b{display:flex;align-items:center;gap:5px;min-width:0;font-size:13px;font-weight:550}
.sp-row .si-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:normal}
.sp-row .si-n .si-meta{display:block;font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.sp-row .si-meta i{font-style:normal;white-space:nowrap}
.sp-row .si-meta em{font-style:normal}
.sp-badge{display:inline-block;font-size:10px;padding:0 6px;border-radius:20px;flex:none;font-weight:500;line-height:1.7;white-space:nowrap}
.sp-badge.exp{background:var(--danger-soft);color:var(--danger)}
.sp-badge.pw{background:var(--accent-soft);color:var(--accent-text)}
.sp-row .si-act{display:flex;gap:2px;flex:none}
.sp-row .si-act button{width:28px;height:28px;border-radius:7px;border:none;background:transparent;color:var(--text2);cursor:pointer;display:grid;place-items:center;transition:.12s}
.sp-row .si-act button:hover{background:var(--panel);color:var(--accent)}
.sp-row .si-act button.dg:hover{color:var(--danger)}
.sp-empty{font-size:12.5px;color:var(--text3);text-align:center;padding:40px 12px;border:1px dashed var(--border);border-radius:10px;background:var(--bg)}
@media (max-width:720px){
  #shares{padding:0}
  .sp-card{width:100%;height:100%;max-height:none;border-radius:0;border:0}
  .sp-head{padding:14px 14px 10px}
  .sp-bar{padding:0 12px 10px}
  .sp-list{padding:0 10px 10px}
  .sp-row .si-act button{width:30px;height:30px}
  /* 手机上横向空间不够，元信息给两行，别把到期时间切掉 */
  .sp-row .si-n .si-meta{
    display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;
    white-space:normal;line-height:1.45;margin-top:3px;
  }
}
.share-note{font-size:11.5px;color:var(--text3);line-height:1.55;margin:0 0 14px}
.share-meta{color:var(--text2);font-size:12px}

/* ---------------- 预览 ---------------- */
#preview{
  position:fixed;inset:0;z-index:80;background:rgba(8,10,14,.9);backdrop-filter:blur(10px);
  display:flex;flex-direction:column;animation:fade .14s;
}
.pv-head{
  height:56px;flex:none;display:flex;align-items:center;gap:12px;padding:0 14px;color:#fff;
  background:linear-gradient(rgba(0,0,0,.5),rgba(0,0,0,0));position:relative;z-index:3;
}
.pv-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.pv-title{
  font-size:13.5px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  display:flex;align-items:center;gap:8px;
}
.pv-title .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-sub{font-size:11.5px;opacity:.55;margin-top:2px;font-variant-numeric:tabular-nums}
.pv-acts{margin-left:auto;display:flex;gap:6px;align-items:center}
.pv-acts button{
  height:32px;padding:0 11px;border-radius:8px;display:flex;align-items:center;gap:6px;
  background:rgba(255,255,255,.13);color:#fff;font-size:12.5px;transition:.12s;white-space:nowrap;
}
.pv-acts button:hover{background:rgba(255,255,255,.24)}
.pv-acts button:disabled{opacity:.35;pointer-events:none}
.pv-body{
  flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:0 20px 24px;
  position:relative;
}
.pv-body img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 24px 70px rgba(0,0,0,.55);cursor:zoom-in}
.pv-body img.zoom{max-width:none;max-height:none;cursor:zoom-out;box-shadow:none}
.pv-body video{max-width:100%;max-height:100%;border-radius:10px;background:#000;box-shadow:0 24px 70px rgba(0,0,0,.5)}
.pv-body iframe{width:min(100%,1080px);height:100%;border:none;border-radius:10px;background:#fff}
.pv-sheet{width:min(100%,1080px);height:100%;background:var(--panel);border-radius:10px;overflow:auto}

/* 文档（Markdown / 纯文本 / docx 抽文） */
.pv-doc{
  width:min(100%,900px);height:100%;background:var(--panel);color:var(--text);border-radius:10px;
  overflow:auto;padding:34px 44px 60px;font-size:14px;line-height:1.8;
  box-shadow:0 24px 70px rgba(0,0,0,.45);
}
.pv-doc>*:first-child{margin-top:0}
.pv-doc h1,.pv-doc h2,.pv-doc h3,.pv-doc h4{margin:1.5em 0 .6em;line-height:1.4;font-weight:650}
.pv-doc h1{font-size:22px;border-bottom:1px solid var(--border);padding-bottom:.4em}
.pv-doc h2{font-size:18px;border-bottom:1px solid var(--border2);padding-bottom:.3em}
.pv-doc h3{font-size:15.5px}
.pv-doc h4{font-size:14px}
.pv-doc p{margin:.7em 0}
.pv-doc ul,.pv-doc ol{margin:.6em 0;padding-left:1.6em}
.pv-doc li{margin:.25em 0}
.pv-doc code{background:var(--hover);border:1px solid var(--border2);border-radius:5px;padding:1px 5px;font:12.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.pv-doc pre{background:var(--panel2);border:1px solid var(--border2);border-radius:8px;padding:12px 14px;overflow:auto;margin:.9em 0}
.pv-doc pre code{background:none;border:none;padding:0;font-size:12.5px;line-height:1.7}
.pv-doc blockquote{margin:.9em 0;padding:.2em 0 .2em 14px;border-left:3px solid var(--accent);color:var(--text2)}
.pv-doc a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(79,70,229,.35)}
.pv-doc a:hover{border-bottom-color:var(--accent)}
.pv-doc hr{border:none;border-top:1px solid var(--border);margin:1.6em 0}
.pv-doc img{max-width:100%;border-radius:6px;cursor:default}
.pv-doc table{border-collapse:collapse;margin:.9em 0;font-size:13px;display:block;overflow:auto}
.pv-doc th,.pv-doc td{border:1px solid var(--border);padding:6px 12px;text-align:left}
.pv-doc th{background:var(--panel2);font-weight:600}
.pv-plain{
  width:min(100%,900px);height:100%;background:var(--panel);color:var(--text);border-radius:10px;
  overflow:auto;padding:24px 28px;margin:0;white-space:pre-wrap;word-break:break-word;
  font:13px/1.75 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}

/* 代码：行号 + 自动换行 */
.pv-code{
  width:min(100%,1080px);height:100%;margin:0;background:var(--panel);color:var(--text);
  border:1px solid var(--border);border-radius:10px;overflow:auto;padding:14px 0;
  font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:4;
}
.pv-code .cl{display:block;padding-right:18px;white-space:pre-wrap;word-break:break-word}
.pv-code .cl:hover{background:var(--hover)}
.pv-code .ln{display:inline-block;width:52px;padding-right:14px;text-align:right;color:var(--text3);user-select:none}

/* CSV / 表格 */
.pv-tbl{border-collapse:collapse;font-size:12.5px;background:var(--panel);width:max-content;min-width:60%}
.pv-tbl th,.pv-tbl td{
  border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top;
  max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.pv-tbl th{background:var(--panel2);font-weight:600;position:sticky;top:0;z-index:1}
.pv-tbl tbody tr:nth-child(even) td{background:var(--panel2)}
.pv-tblwrap{width:min(100%,1080px);height:100%;overflow:auto;border-radius:10px;background:var(--panel);box-shadow:0 24px 70px rgba(0,0,0,.45)}

/* 音频 */
.pv-aud{
  display:flex;flex-direction:column;align-items:center;gap:20px;color:#fff;width:min(100%,440px);
  padding:28px 24px;border-radius:18px;background:rgba(255,255,255,.07);
}
.pv-aud .cover{
  width:118px;height:118px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,var(--accent2),var(--accent));box-shadow:0 18px 44px rgba(79,70,229,.45);
}
.pv-aud .an{font-size:13.5px;font-weight:550;text-align:center;word-break:break-all;line-height:1.5}
.pv-aud audio{width:100%}

/* 不支持预览 / 报错 */
.pv-empty{display:flex;flex-direction:column;align-items:center;gap:12px;color:#fff;text-align:center;padding:40px 20px}
.pv-empty .ico{
  width:78px;height:78px;border-radius:22px;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.1);
}
.pv-empty h4{margin:0;font-size:14px;font-weight:600}
.pv-empty p{margin:0;font-size:12.5px;opacity:.6;max-width:360px;line-height:1.7}
.pv-empty button{
  margin-top:4px;height:36px;padding:0 16px;border-radius:9px;display:flex;align-items:center;gap:7px;
  background:rgba(255,255,255,.16);color:#fff;font-size:13px;
}
.pv-empty button:hover{background:rgba(255,255,255,.26)}

.pv-nav{
  position:absolute;top:50%;margin-top:-26px;width:38px;height:52px;border-radius:12px;z-index:3;
  display:flex;align-items:center;justify-content:center;color:#fff;
  background:rgba(18,21,28,.55);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(8px);
  transition:.12s;box-shadow:0 6px 20px rgba(0,0,0,.3);
}
.pv-nav:hover{background:rgba(18,21,28,.8)}
.pv-nav[disabled]{opacity:0;pointer-events:none}
.pv-nav.prev{left:10px}
.pv-nav.next{right:10px}
.pv-loading{color:#fff;opacity:.72;font-size:13px;display:flex;align-items:center;gap:10px}
.pv-note{color:#fff;opacity:.45;font-size:11.5px;margin-top:12px;line-height:1.6;max-width:420px;text-align:center}

@media (max-width:640px){
  .pv-acts button .lbl{display:none}
  .pv-acts button{padding:0 9px}
  .pv-body{padding:0 8px 12px}
  .pv-doc{padding:20px 18px 40px}
  .pv-nav{display:none}
}

.spinner{
  width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.25);
  border-top-color:#fff;animation:spin .7s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

/* 编辑器 */
#editor{
  position:fixed;inset:0;z-index:85;background:var(--bg);display:flex;flex-direction:column;
  animation:fade .12s;
}
.ed-head{
  height:52px;flex:none;display:flex;align-items:center;gap:10px;padding:0 14px;
  background:var(--panel);border-bottom:1px solid var(--border);
}
.ed-name{font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:8px;min-width:0}
.ed-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ed-status{font-size:12px;color:var(--text3);margin-left:auto;margin-right:6px}
.ed-body{flex:1;padding:0;display:flex;background:var(--panel)}
#edText{
  flex:1;width:100%;border:none;outline:none;resize:none;padding:20px 24px;
  font:13px/1.75 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:var(--panel);color:var(--text);tab-size:2;
}

/* ---------------- 上传队列 ---------------- */
#uploads{
  position:fixed;right:18px;bottom:18px;width:344px;max-width:calc(100vw - 36px);z-index:65;
  background:var(--panel);border:1px solid var(--border);border-radius:14px;
  box-shadow:var(--shadow-lg);overflow:hidden;animation:pop .18s cubic-bezier(.2,.8,.3,1);
}
.up-head{
  display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid var(--border2);
  font-size:12.5px;font-weight:600;background:var(--panel2);
}
.up-head .up-sum{color:var(--text2);font-weight:400;margin-left:auto;font-variant-numeric:tabular-nums}
.up-head .up-rate{font-size:11px;font-weight:500;color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap}
.up-list{max-height:240px;overflow:auto;padding:6px}
.up-item{display:flex;align-items:center;gap:9px;padding:7px 7px;border-radius:8px}
.up-item:hover{background:var(--hover)}
.up-item .un{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;overflow:hidden}
.up-item .un b{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.up-item .un span{font-size:10.5px;color:var(--text3);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.up-item .ub{width:64px;flex:none}
.bar{height:4px;border-radius:3px;background:var(--border);overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent);border-radius:3px;transition:width .18s}
.bar i.err{background:var(--danger)}
.bar i.ok{background:var(--ok)}
.up-item .st{font-size:11px;color:var(--text3);width:52px;text-align:right;flex:none;font-variant-numeric:tabular-nums}

/* Toast */
#toasts{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:95;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.toast{
  display:flex;align-items:center;gap:9px;padding:10px 15px;border-radius:10px;
  background:var(--panel);border:1px solid var(--border);box-shadow:var(--shadow-lg);
  font-size:13px;animation:pop .16s;max-width:min(90vw,460px);pointer-events:auto;
}
.toast .td{width:7px;height:7px;border-radius:50%;flex:none}
.toast.ok .td{background:var(--ok)}
.toast.err .td{background:var(--danger)}
.toast.info .td{background:var(--accent)}

/* 拖放遮罩 */
#drop{
  position:fixed;inset:0;z-index:75;background:color-mix(in srgb,var(--accent) 10%,rgba(8,10,14,.55));
  backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;
  pointer-events:none;opacity:0;transition:opacity .12s;
}
#drop.on{opacity:1}
.drop-box{
  border:2px dashed color-mix(in srgb,var(--accent) 60%,#fff);border-radius:20px;
  padding:44px 60px;display:flex;flex-direction:column;align-items:center;gap:12px;
  color:#fff;background:rgba(0,0,0,.25);
}
.drop-box strong{font-size:16px;font-weight:600}
.drop-box span{font-size:12.5px;opacity:.8}

/* 右键菜单 */
#ctx{
  position:fixed;z-index:90;min-width:180px;background:var(--panel);border:1px solid var(--border);
  border-radius:10px;box-shadow:var(--shadow-lg);padding:5px;animation:pop .1s;
}
.mi{
  display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:7px;font-size:13px;
  width:100%;text-align:left;color:var(--text);
}
.mi:hover{background:var(--hover)}
.mi.danger{color:var(--danger)}
.mi.danger:hover{background:var(--danger-soft)}
.mi .kbd{margin-left:auto;font-size:10.5px;color:var(--text3)}
.ctx-sep{height:1px;background:var(--border2);margin:4px 2px}

/* 移动端 */
@media (max-width:720px){
  .brand-name,.vsep,#btnRefresh,#btnTheme,.crumb-ghost{display:none}
  /* 手机顶栏挤，容量块缩成短格式，只留「1.2G / 10G」加一条进度线 */
  .quota{width:68px;padding:0 7px;gap:2px}
  .quota .q-l{display:none}
  .quota .q-s{display:inline;font-size:10px;line-height:1.2;font-variant-numeric:tabular-nums;color:var(--text2);white-space:nowrap}
  .quota.warn .q-s{color:var(--quota-warn)}
  .quota.full .q-s{color:var(--quota-full)}
  .brand{padding-right:0}
  .topbar{gap:6px;padding:0 10px}
  .search{margin-left:0;max-width:none}
  /* 手机上仍保留「大小」列：文件夹的「N 项 · 大小」是用户最想先看到的，
     宽度只给 92px，允许折两行，文件名那一列让步 */
  .thead{grid-template-columns:38px 1fr 92px}
  .thead .th-time,.th-act{display:none}
  .row{grid-template-columns:38px 1fr 92px;height:54px;padding:0 4px}
  .row .c-time,.row .acts{display:none}
  .row .c-size{display:flex;justify-content:flex-end;padding-right:4px}
  .row .c-size .meta{
    font-size:11.5px;line-height:1.32;text-align:right;white-space:normal;
    display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;
  }
  .row .nm{font-size:14.5px}
  .toolbar{padding:8px 10px;overflow-x:auto;gap:6px}
  .toolbar .btn span.lbl{display:none}
  .toolbar .btn{width:38px;padding:0;justify-content:center}
  .toolbar .btn-primary{padding:0}
  .content{padding:0 4px 90px}
  #uploads{right:10px;left:10px;width:auto;bottom:10px}
  .gridview{grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:9px;padding:10px 4px}
  .card .thumb{height:88px}
  .card .cbody{padding:8px 9px 9px}
  .card .cmeta{font-size:11px}
  .login-card{padding:26px 20px 20px}
}
</style>
</head>
<body>

<!-- ============ 启动遮罩 ============ -->
<div id="boot">
  <div>
    <div class="boot-logo">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
    </div>
    <div class="boot-bar"><i></i></div>
  </div>
</div>

<!-- ============ 登录 ============ -->
<div id="login" class="hidden">
  <form class="login-card" id="loginForm" autocomplete="off">
    <div class="login-logo">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
    </div>
    <h1>登录云盘</h1>
    <div class="field">
      <label for="u">用户名</label>
      <input class="input" id="u" name="dav-u" autocomplete="off" placeholder="请输入用户名" spellcheck="false" autocapitalize="off" autocorrect="off">
    </div>
    <div class="field">
      <label for="p">密码</label>
      <div class="pw-field">
        <input class="input" id="p" name="dav-p" type="password" autocomplete="new-password" placeholder="请输入密码">
        <button type="button" class="pw-toggle" id="pwToggle" title="显示密码" aria-label="显示密码" aria-pressed="false">
          <span id="pwEyeOpen"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></span>
          <span id="pwEyeOff" class="hidden"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18.3 18.3 0 0 1-3.3 4.2"/><path d="M6.4 6.5A18.2 18.2 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.7-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/></svg></span>
        </button>
      </div>
    </div>
    <div class="field" style="display:flex;align-items:center;gap:8px;margin:16px 0 18px">
      <span class="tick" id="remember"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
      <label for="remember" style="font-size:12.5px;color:var(--text2);margin:0;cursor:pointer;font-weight:400">在这台设备上记住登录</label>
    </div>
    <button class="btn btn-primary btn-block" type="submit" id="loginBtn">登录</button>
    <div class="login-err hidden" id="loginErr"></div>
  </form>
</div>

<!-- ============ 主界面 ============ -->
<div id="app" class="hidden">
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
      </div>
      <div class="brand-name">云盘<span>R2</span></div>
    </div>

    <div class="search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
      <input id="q" placeholder="搜索当前目录…" spellcheck="false" autocomplete="off">
      <button class="clr hidden" id="qClr" title="清除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="quota" id="quota" title="云盘容量">
      <div class="q-line">
        <span class="q-l"><b id="qUsed">—</b><span class="q-sep">&nbsp;/&nbsp;</span><em id="qTotal">10 GB</em></span>
        <span class="q-s" id="qShort">—</span>
      </div>
      <div class="q-bar"><i id="qFill"></i></div>
    </div>

    <div class="topbar-actions">
      <button class="icon-btn" id="btnRefresh" title="刷新 (F5)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
      </button>
      <div class="vsep"></div>
      <button class="icon-btn" id="btnViewList" title="列表视图">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>
      </button>
      <button class="icon-btn" id="btnViewGrid" title="网格视图">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
      </button>
      <button class="icon-btn" id="btnTheme" title="切换主题">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      </button>
      <div class="vsep"></div>
      <button class="avatar" id="btnUser" title="账户">A</button>
    </div>
  </header>

  <div class="crumbbar">
    <button class="icon-btn" id="btnUp" title="上一级 (Backspace)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7M19 12H5"/></svg>
    </button>
    <div class="crumbs" id="crumbs"></div>
  </div>

  <div class="toolbar">
    <button class="btn btn-primary" id="btnUpload">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16"/></svg>
      <span class="lbl">上传</span>
    </button>
    <button class="btn btn-ghost" id="btnMkdir">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v6M9 14h6"/></svg>
      <span class="lbl">新建文件夹</span>
    </button>
    <button class="btn btn-ghost" id="btnNewFile">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 12v6M9 15h6"/></svg>
      <span class="lbl">新建文件</span>
    </button>
    <button class="btn btn-ghost" id="btnDl" disabled>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5"/><path d="M4 18v1.5A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V18"/></svg>
      <span class="lbl">下载</span>
    </button>
    <button class="btn btn-ghost" id="btnShare" disabled>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>
      <span class="lbl">分享</span>
    </button>
    <button class="btn btn-ghost" id="btnShares">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="18" r="2"/></svg>
      <span class="lbl">我的分享</span>
    </button>
    <button class="btn btn-ghost" id="btnDel" disabled style="color:var(--danger)">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      <span class="lbl">删除</span>
    </button>
    <div class="spacer"></div>
    <div class="selinfo" id="selInfo"></div>
  </div>

  <main class="content" id="content" tabindex="-1">
    <div class="listwrap" id="wrap"></div>
  </main>
</div>

<!-- 预览 -->
<div id="preview" class="hidden">
  <div class="pv-head">
    <div class="pv-meta">
      <div class="pv-title" id="pvTitle"><span class="t"></span></div>
      <div class="pv-sub" id="pvSub"></div>
    </div>
    <div class="pv-acts">
      <button id="pvEdit" class="hidden" title="用内置编辑器打开">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        <span class="lbl">编辑</span>
      </button>
      <button id="pvDl" title="下载到本地">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5"/><path d="M4 18v1.5A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V18"/></svg>
        <span class="lbl">下载</span>
      </button>
      <button id="pvClose" title="关闭 (Esc)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        <span class="lbl">关闭</span>
      </button>
    </div>
  </div>
  <button class="pv-nav prev" id="pvPrev" title="上一个 (←)">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>
  </button>
  <button class="pv-nav next" id="pvNext" title="下一个 (→)">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
  </button>
  <div class="pv-body" id="pvBody"></div>
</div>


<!-- 编辑器 -->
<div id="editor" class="hidden">
  <div class="ed-head">
    <div class="ed-name">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>
      <span id="edName"></span>
    </div>
    <div class="ed-status" id="edStatus"></div>
    <button class="btn btn-ghost btn-sm" id="edCancel">关闭</button>
    <button class="btn btn-primary btn-sm" id="edSave">保存</button>
  </div>
  <div class="ed-body"><textarea id="edText" spellcheck="false" wrap="off" placeholder=""></textarea></div>
</div>

<!-- 上传队列 -->
<div id="uploads" class="hidden">
  <div class="up-head">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16"/></svg>
    传输队列
    <span class="up-rate" id="upRate"></span>
    <span class="up-sum" id="upSum"></span>
    <button class="icon-btn" id="upClose" style="width:24px;height:24px">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="up-list" id="upList"></div>
</div>

<!-- 我的分享 -->
<div id="shares" class="hidden">
  <div class="sp-card">
    <div class="sp-head">
      <h2>我的分享</h2>
      <span class="sp-cnt" id="spCnt"></span>
      <button class="icon-btn" id="spClose" title="关闭">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="sp-bar">
      <div class="sp-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
        <input id="spQ" placeholder="搜索文件名…" autocomplete="off" spellcheck="false">
      </div>
      <span class="sp-all" id="spAll"><span class="tick"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>全选</span>
      <button class="btn btn-ghost btn-sm" id="spDelSel" disabled>删除选中</button>
      <button class="btn btn-ghost btn-sm" id="spClear" style="color:var(--danger)" disabled>全部清空</button>
    </div>
    <div class="sp-list" id="spList"></div>
  </div>
</div>

<!-- 拖放 -->
<div id="drop"><div class="drop-box">
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16"/></svg>
  <strong>松开即可上传</strong>
  <span id="dropHint"></span>
</div></div>

<div id="toasts"></div>
<input type="file" id="fileInput" multiple class="hidden">

<script>
var DEFAULT_USER = ${jsConst(defaultUser)};
(function(){
"use strict";

/* ================= 基础工具 ================= */
var $ = function(id){ return document.getElementById(id); };
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function fmtSize(n){
  if(n == null || isNaN(n)) return "—";
  if(n < 1024) return n + " B";
  var u = ["KB","MB","GB","TB"], i = -1, v = n;
  do { v /= 1024; i++; } while(v >= 1024 && i < u.length - 1);
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + " " + u[i];
}
/** 文件夹的大小列：统计到位就是「N 项 · 大小」，还在算就显示省略号 */
function sizeText(it){
  if(!it) return "—";
  if(!it.isDir) return fmtSize(it.size);
  var st = it.stat;
  if(!st) return it.statFail ? "—" : "…";
  var n = st.items + " 项";
  if(!st.size) return n;
  return n + " · " + (st.truncated ? "≥" : "") + fmtSize(st.size);
}
/** 悬停提示：文件夹给递归明细 */
function statTitle(it){
  if(!it) return "";
  if(!it.isDir) return fmtSize(it.size);
  var st = it.stat;
  if(!st) return it.statFail ? "统计失败，重新进入目录可重试" : "正在统计…";
  var t = st.dirs + " 个文件夹 · " + st.files + " 个文件 · " + fmtSize(st.size);
  if(st.truncated) t += "（只统计了前 1 万个对象）";
  return t;
}
function pad(n){ return n < 10 ? "0" + n : "" + n; }
function fmtTime(ms){
  if(!ms) return "—";
  var d = new Date(ms), now = Date.now(), diff = (now - ms) / 1000;
  if(diff < 60) return "刚刚";
  if(diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  var today = new Date(); today.setHours(0,0,0,0);
  if(ms >= today.getTime()) return "今天 " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  if(ms >= today.getTime() - 86400000) return "昨天 " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  var y = new Date(today.getTime() - 31536000000);
  if(ms > y.getTime()) return pad(d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());
}
/** MM-DD HH:mm，未来时间也能正确显示（fmtTime 用于过去时间，会给未来返回"刚刚"） */
function fmtShort(ms){
  if(!ms) return "—";
  var d = new Date(ms);
  return pad(d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function fmtTimeFull(ms){
  if(!ms) return "—";
  var d = new Date(ms);
  return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function segEnc(s){ return encodeURIComponent(s); }
/** 内部路径 -> 编码后的 URL 路径（与 Worker 的 encodePath 一致） */
function urlPath(p){
  if(p === "/") return "/";
  /* 查询串要原样保留：逐段 encodeURIComponent 会把 ? 和 = 也编掉，
     服务端收到 /__api/quota%3Ffresh%3D1 就 404 了 */
  var qs = "";
  var qi = p.indexOf("?");
  if(qi >= 0){ qs = p.slice(qi); p = p.slice(0, qi); }
  return p.split("/").map(function(x, i){ return i === 0 ? "" : encodeURIComponent(x); }).join("/") + qs;
}
function joinPath(dir, name){ return dir === "/" ? "/" + name : dir + "/" + name; }
function parentOf(p){
  if(p === "/") return "/";
  var i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}
function baseOf(p){ return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); }

var EXT = {
  img: ["png","jpg","jpeg","gif","webp","svg","bmp","ico","avif","heic","tif","tiff"],
  vid: ["mp4","webm","mkv","mov","avi","m4v","ogv","flv","wmv"],
  aud: ["mp3","wav","flac","aac","ogg","m4a","opus","wma"],
  zip: ["zip","rar","7z","tar","gz","bz2","xz","tgz","zst"],
  code: ["js","ts","jsx","tsx","json","html","htm","css","scss","py","go","rs","java","c","h","cpp","hpp","sh","yml","yaml","toml","sql","php","rb","swift","kt","xml","vue","svelte"],
  doc: ["txt","md","markdown","pdf","doc","docx","xls","xlsx","ppt","pptx","csv","rtf","epub","log","ini","conf","env"]
};
function kindOf(name, isDir){
  if(isDir) return "dir";
  var i = name.lastIndexOf(".");
  var e = i > 0 ? name.slice(i + 1).toLowerCase() : "";
  if(EXT.img.indexOf(e) >= 0) return "img";
  if(EXT.vid.indexOf(e) >= 0) return "vid";
  if(EXT.aud.indexOf(e) >= 0) return "aud";
  if(EXT.zip.indexOf(e) >= 0) return "zip";
  if(EXT.code.indexOf(e) >= 0) return "code";
  if(EXT.doc.indexOf(e) >= 0) return "doc";
  return "bin";
}
var ICON = {
  dir: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  img: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-4.5-4.5L7 20"/>',
  vid: '<rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="m16.5 10 5-3v10l-5-3Z"/>',
  aud: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8.5 13h7M8.5 17h5"/>',
  zip: '<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2Z"/><path d="M12 10v1.5M12 13.5V15M12 17v.5"/>',
  code: '<path d="m8 6-5 6 5 6M16 6l5 6-5 6"/>',
  bin: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
};
function iconSvg(kind, size){
  var s = size || 16;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICON[kind] || ICON.bin) + '</svg>';
}

/* ================= 状态 ================= */
var S = {
  auth: "",          // "Basic xxx"
  user: DEFAULT_USER,
  path: "/",
  items: [],
  view: "list",
  sort: { key: "name", dir: 1 },
  sel: {},
  q: "",
  loading: false,
  hist: [],          // 后退栈
  editorPath: null
};
try {
  var sv = localStorage.getItem("dav.view"); if(sv) S.view = sv;
  var st = localStorage.getItem("dav.theme"); if(st) document.documentElement.setAttribute("data-theme", st);
  else document.documentElement.setAttribute("data-theme", "auto");
} catch(e){}

/* ================= HTTP ================= */
function authHeaders(extra){
  var h = new Headers(extra || {});
  h.set("Authorization", S.auth);
  h.set("X-DAV-UI", "1");
  return h;
}
/** 写操作之后要把目录统计重新算：服务端缓存按 isolate 存，跨实例清不掉 */
var statFresh = false;
function req(method, path, opts){
  opts = opts || {};
  var m = String(method || "").toUpperCase();
  if(m === "PUT" || m === "DELETE" || m === "MKCOL" || m === "MOVE" || m === "COPY"){ statFresh = true; quotaDirty = true; }
  var headers = authHeaders(opts.headers);
  if(opts.body !== undefined && opts.body !== null && !(opts.body instanceof Blob) && !(opts.body instanceof File)){
    if(!headers.has("Content-Type")) headers.set("Content-Type", "application/xml; charset=utf-8");
  }
  return fetch(location.origin + urlPath(path), {
    method: method,
    headers: headers,
    body: opts.body === undefined ? undefined : opts.body,
    cache: "no-store",
    redirect: "follow"
  });
}

var PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<D:propfind xmlns:D="DAV:"><D:prop>' +
  '<D:resourcetype/><D:getcontentlength/><D:getlastmodified/>' +
  '<D:getcontenttype/><D:getetag/><D:displayname/>' +
  '</D:prop></D:propfind>';

function parsePropfind(xmlText, base){
  var doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if(doc.getElementsByTagName("parsererror").length) throw new Error("响应解析失败");
  var resps = doc.getElementsByTagNameNS("DAV:", "response");
  if(!resps.length) resps = doc.getElementsByTagName("response");
  var out = [];
  var prefix = base === "/" ? "/" : base + "/";
  for(var i = 0; i < resps.length; i++){
    var r = resps[i];
    var hrefEl = r.getElementsByTagNameNS("DAV:", "href")[0] || r.getElementsByTagName("href")[0];
    if(!hrefEl) continue;
    var href = hrefEl.textContent || "";
    var p = href;
    if(p.indexOf("://") > 0){
      try { p = new URL(p).pathname; } catch(e){}
    }
    try { p = decodeURIComponent(p); } catch(e){}
    if(p.length > 1 && p.charAt(p.length - 1) === "/") p = p.slice(0, -1);
    if(p === base) continue;                       // 自身
    if(p.indexOf(prefix) !== 0) continue;          // 不在本目录
    var rest = p.slice(prefix.length);
    if(!rest || rest.indexOf("/") >= 0) continue;  // 非直接子项
    var isDir = !!(r.getElementsByTagNameNS("DAV:", "collection")[0] || r.getElementsByTagName("collection")[0]);
    var sizeEl = r.getElementsByTagNameNS("DAV:", "getcontentlength")[0] || r.getElementsByTagName("getcontentlength")[0];
    var modEl = r.getElementsByTagNameNS("DAV:", "getlastmodified")[0] || r.getElementsByTagName("getlastmodified")[0];
    var typeEl = r.getElementsByTagNameNS("DAV:", "getcontenttype")[0] || r.getElementsByTagName("getcontenttype")[0];
    var etagEl = r.getElementsByTagNameNS("DAV:", "getetag")[0] || r.getElementsByTagName("getetag")[0];
    var mtime = modEl ? Date.parse(modEl.textContent || "") : 0;
    out.push({
      name: rest,
      path: p,
      isDir: isDir,
      size: sizeEl ? parseInt(sizeEl.textContent || "0", 10) || 0 : 0,
      mtime: isFinite(mtime) ? mtime : 0,
      ctype: typeEl ? (typeEl.textContent || "") : "",
      etag: etagEl ? (etagEl.textContent || "") : "",
      kind: kindOf(rest, isDir)
    });
  }
  return out;
}

/* ================= Toast / 对话框 ================= */
function toast(msg, type){
  var box = $("toasts");
  var el = document.createElement("div");
  el.className = "toast " + (type || "info");
  el.innerHTML = '<span class="td"></span><span>' + esc(msg) + '</span>';
  box.appendChild(el);
  setTimeout(function(){
    el.style.transition = "opacity .2s,transform .2s";
    el.style.opacity = "0"; el.style.transform = "translateY(6px)";
    setTimeout(function(){ el.remove(); }, 220);
  }, type === "err" ? 4200 : 2400);
}

var dlgEl = null;
function closeDialog(){ if(dlgEl){ dlgEl.remove(); dlgEl = null; } }
/* ================= 分享 ================= */

var shareOv = null;

function closeShare(){
  if(shareOv){ shareOv.remove(); shareOv = null; }
}

function fallbackCopy(text){
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch(e){}
  ta.remove();
}

function copyText(text, btn){
  var flash = function(){
    if(btn){
      var old = btn.getAttribute("data-label") || btn.textContent;
      btn.setAttribute("data-label", old);
      btn.textContent = "已复制";
      setTimeout(function(){ btn.textContent = old; }, 1300);
    }
    toast("已复制到剪贴板", "ok");
  };
  if(navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(text).then(flash).catch(function(){ fallbackCopy(text); flash(); });
  } else {
    fallbackCopy(text);
    flash();
  }
}

function randPassword(){
  var abc = "abcdefghjkmnpqrstuvwxyz23456789";
  var buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  var out = "";
  for(var i = 0; i < 4; i++) out += abc[buf[i] % abc.length];
  return out;
}

function openShare(path){
  var it = findItem(path);
  if(!it) return;
  closeShare();
  var ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = '<div class="dialog share-dialog"><div class="dbody" id="shareBody"></div><div class="dfoot" id="shareFoot"></div></div>';
  document.body.appendChild(ov);
  shareOv = ov;
  ov.addEventListener("mousedown", function(e){ if(e.target === ov) closeShare(); });
  renderShareCreate(it);
}

function renderShareCreate(it){
  var body = shareOv.querySelector("#shareBody");
  var foot = shareOv.querySelector("#shareFoot");
  var autoPw = randPassword();

  body.innerHTML =
    '<h2>分享</h2>' +
    '<div class="share-file">' +
      '<div class="sfi">' + iconSvg(it.isDir ? "dir" : it.kind, 17) + '</div>' +
      '<div class="sfn"><b>' + esc(it.name) + '</b><span>' + (it.isDir ? "文件夹" : fmtSize(it.size)) + '</span></div>' +
    '</div>' +
    '<div class="optrow"><label>提取码</label>' +
      '<div class="seg" id="pwMode">' +
        '<button data-m="none">不需要</button>' +
        '<button data-m="auto" class="on">自动生成</button>' +
        '<button data-m="custom">自定义</button>' +
      '</div>' +
    '</div>' +
    '<div id="pwCustomWrap" style="display:none;margin:-8px 0 14px">' +
      '<input class="input" id="pwCustom" placeholder="4-16 位，字母或数字" maxlength="16" spellcheck="false" autocomplete="off">' +
    '</div>' +
    '<div class="optrow"><label>有效期</label>' +
      '<select class="sel-mini" id="expSel">' +
        '<option value="86400">1 天</option>' +
        '<option value="604800" selected>7 天</option>' +
        '<option value="2592000">30 天</option>' +
        '<option value="0">永久有效</option>' +
      '</select>' +
    '</div>' +
    '<p class="share-note" id="shareNote" style="margin:2px 0 16px"></p>' +
    '<div class="share-list" id="shareList"><h3>已有分享</h3><div class="share-empty">加载中…</div></div>';

  foot.innerHTML = '<button class="btn btn-ghost" id="shareClose">关闭</button>' +
    '<button class="btn btn-primary" id="shareCreate">创建分享链接</button>';

  var mode = "auto";

  function syncNote(){
    var note = shareOv.querySelector("#shareNote");
    if(!note) return;
    note.textContent = mode === "none"
      ? "不设提取码：任何拿到链接的人都能直接访问。"
      : "访问者需要输入提取码才能查看和下载。";
  }

  Array.prototype.forEach.call(body.querySelectorAll("#pwMode button"), function(b){
    b.onclick = function(){
      mode = b.getAttribute("data-m");
      Array.prototype.forEach.call(body.querySelectorAll("#pwMode button"), function(x){ x.classList.toggle("on", x === b); });
      var wrap = shareOv.querySelector("#pwCustomWrap");
      if(wrap) wrap.style.display = mode === "custom" ? "" : "none";
      if(mode === "custom"){
        var inp = shareOv.querySelector("#pwCustom");
        if(inp){ inp.value = autoPw; setTimeout(function(){ inp.focus(); inp.select(); }, 30); }
      }
      syncNote();
    };
  });
  syncNote();

  shareOv.querySelector("#shareClose").onclick = closeShare;
  shareOv.querySelector("#shareCreate").onclick = function(){
    var password = "";
    if(mode === "auto") password = autoPw;
    else if(mode === "custom"){
      password = (shareOv.querySelector("#pwCustom").value || "").trim();
      if(password.length < 4){ toast("提取码至少 4 位", "err"); return; }
    }
    var expVal = Number(shareOv.querySelector("#expSel").value);
    var btn = shareOv.querySelector("#shareCreate");
    btn.disabled = true;
    btn.textContent = "创建中…";
    req("POST", "/__api/shares", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: it.path, password: password, expiresIn: expVal > 0 ? expVal : null })
    }).then(function(r){
      return r.json().then(function(j){
        if(!r.ok) throw new Error(j.error || ("创建失败（" + r.status + "）"));
        return j;
      });
    }).then(function(j){
      renderShareResult(j.share, j.password);
    }).catch(function(e){
      btn.disabled = false;
      btn.textContent = "创建分享链接";
      toast(e.message || "创建失败", "err");
    });
  };

  loadShareList();
}

function renderShareResult(share, password){
  var body = shareOv.querySelector("#shareBody");
  var foot = shareOv.querySelector("#shareFoot");
  var expText = share.expiresAt ? fmtTimeFull(share.expiresAt) + " 失效" : "永久有效";

  body.innerHTML =
    '<h2>分享</h2>' +
    '<div class="share-result">' +
      '<div class="okline"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>分享链接已创建</div>' +
      '<div class="linkrow">' +
        '<input id="shareLink" readonly value="' + esc(share.url) + '">' +
        '<button class="btn btn-ghost" id="copyLink">复制</button>' +
      '</div>' +
      (password ?
        '<div class="linkrow" style="margin-bottom:9px"><label style="font-size:12.5px;color:var(--text2);align-self:center;flex:none;width:48px">提取码</label>' +
        '<div class="pwcode"><b id="sharePw">' + esc(password) + '</b><button id="copyPw">复制</button></div></div>'
        : '') +
      '<p class="share-note share-meta" style="margin:10px 0 0">' + esc(share.name) + ' · ' + expText + (password ? ' · 需要提取码' : ' · 无需提取码') + '</p>' +
    '</div>' +
    '<div class="share-list" id="shareList"></div>';

  foot.innerHTML = '<button class="btn btn-ghost" id="shareAgain">继续分享</button>' +
    '<button class="btn btn-primary" id="shareDone">完成</button>';

  shareOv.querySelector("#copyLink").onclick = function(){ copyText(share.url, this); };
  var cp = shareOv.querySelector("#copyPw");
  if(cp) cp.onclick = function(){ copyText(password || "", this); };
  var linkInput = shareOv.querySelector("#shareLink");
  if(linkInput) linkInput.onclick = function(){ this.select(); };

  shareOv.querySelector("#shareDone").onclick = closeShare;
  shareOv.querySelector("#shareAgain").onclick = function(){
    var it = findItem(share.path);
    if(it) renderShareCreate(it);
    else { closeShare(); load(); }
  };

  loadShareList();
}

function loadShareList(){
  var box = shareOv && shareOv.querySelector("#shareList");
  if(!box) return;
  req("GET", "/__api/shares").then(function(r){ return r.json(); }).then(function(j){
    var list = j.shares || [];
    if(!box || !box.isConnected) return;
    if(!list.length){
      box.innerHTML = '<h3>已有分享</h3><div class="share-empty">还没有创建过分享</div>';
      return;
    }
    var html = '<h3>已有分享 · ' + list.length + '</h3>';
    list.forEach(function(s){
      var meta = (s.downloads || 0) + " 次下载 · " + (s.expiresAt ? fmtTimeFull(s.expiresAt) + " 失效" : "永久有效");
      html += '<div class="share-item" data-id="' + esc(s.id) + '">' +
        '<div class="si-ic">' + iconSvg(s.isDir ? "dir" : "bin", 14) + '</div>' +
        '<div class="si-n"><b title="' + esc(s.name) + '"><i class="si-name">' + esc(s.name) + '</i>' + (s.needsPassword ? '<span class="si-lock">' + iconSvg("lock", 11) + '</span>' : '') + '</b>' +
        '<span>' + esc(meta) + '</span></div>' +
        '<div class="si-act">' +
          '<button data-copy="' + esc(s.id) + '" title="复制链接">' + iconSvg("copy", 14) + '</button>' +
          '<button data-open="' + esc(s.id) + '" title="打开">' + iconSvg("open", 14) + '</button>' +
          '<button class="dg" data-revoke="' + esc(s.id) + '" title="取消分享">' + iconSvg("trash", 14) + '</button>' +
        '</div>' +
      '</div>';
    });
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll("[data-copy]"), function(b){
      b.onclick = function(){
        var id = b.getAttribute("data-copy");
        var target = list.filter(function(x){ return x.id === id; })[0];
        if(target) copyText(target.url, null);
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-open]"), function(b){
      b.onclick = function(){
        var id = b.getAttribute("data-open");
        var target = list.filter(function(x){ return x.id === id; })[0];
        if(target) window.open(target.url, "_blank");
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-revoke]"), function(b){
      b.onclick = function(){
        var id = b.getAttribute("data-revoke");
        var target = list.filter(function(x){ return x.id === id; })[0];
        confirmBox("取消分享", "取消后这个链接立即失效，已发出的链接无法再打开。", "取消分享").then(function(ok){
          if(!ok) return;
          req("DELETE", "/__api/shares/" + encodeURIComponent(id)).then(function(r){
            if(r.ok){ toast("已取消分享", "ok"); loadShareList(); }
            else toast("取消失败", "err");
          });
        });
      };
    });
  }).catch(function(){
    if(box && box.isConnected) box.innerHTML = '<h3>已有分享</h3><div class="share-empty">加载失败</div>';
  });
}

/* ================= 我的分享 ================= */
var SP = { list: [], sel: {}, q: "" };
var TICK_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

function openShares(){
  $("shares").classList.remove("hidden");
  $("spQ").value = "";
  SP.q = ""; SP.sel = {};
  /* 有上次结果就先画出来，别让面板空着等一次网络往返 */
  if(SP.list.length) renderShares();
  else $("spList").innerHTML = '<div class="sp-empty">加载中…</div>';
  loadShares();
}
function closeShares(){ $("shares").classList.add("hidden"); }

function loadShares(){
  var box = $("spList");
  if(!box) return;
  if(!SP.list.length) box.innerHTML = '<div class="sp-empty">加载中…</div>';
  req("GET", "/__api/shares").then(function(r){ return r.json(); }).then(function(j){
    SP.list = (j.shares || []).slice().sort(function(a, b){ return b.createdAt - a.createdAt; });
    /* 服务端已不存在的选中项要丢掉 */
    var alive = {};
    SP.list.forEach(function(s){ if(SP.sel[s.id]) alive[s.id] = true; });
    SP.sel = alive;
    renderShares();
  }).catch(function(){
    if(box.isConnected && !SP.list.length) box.innerHTML = '<div class="sp-empty">加载失败，请稍后重试</div>';
  });
}

function isShareExpired(s){ return s.expiresAt != null && Date.now() > s.expiresAt; }

function spRows(){
  if(!SP.q) return SP.list;
  var q = SP.q.toLowerCase();
  return SP.list.filter(function(s){
    return (s.name || "").toLowerCase().indexOf(q) >= 0 ||
      (s.path || "").toLowerCase().indexOf(q) >= 0 ||
      s.id.toLowerCase().indexOf(q) >= 0;
  });
}

function renderShares(){
  var box = $("spList");
  if(!box) return;
  var all = spRows();
  var selN = Object.keys(SP.sel).length;

  $("spCnt").textContent = SP.list.length ? "共 " + SP.list.length + " 个" + (SP.q ? " · 匹配 " + all.length : "") : "";
  $("spDelSel").disabled = selN === 0;
  $("spDelSel").textContent = selN ? "删除选中 (" + selN + ")" : "删除选中";
  $("spClear").disabled = SP.list.length === 0;
  var allTick = $("spAll").querySelector(".tick");
  if(allTick) allTick.classList.toggle("on", all.length > 0 && all.every(function(s){ return SP.sel[s.id]; }));

  if(!all.length){
    box.innerHTML = '<div class="sp-empty">' +
      (SP.q ? "没有匹配的分享" : "还没有创建过分享。选中文件后点工具栏「分享」即可生成外链。") +
      '</div>';
    return;
  }

  var html = "";
  all.forEach(function(s){
    var expired = isShareExpired(s);
    var bits = [
      s.isDir ? "文件夹" : fmtSize(s.size),
      (s.downloads || 0) + " 次下载",
      fmtTime(s.createdAt) + "创建",
      s.expiresAt ? fmtShort(s.expiresAt) + " 到期" : "永久有效"
    ];
    /* 每段独立 nowrap，换行只发生在 · 处，不会把「11-27 21:59 到期」拆开 */
    var meta = bits.map(function(x){ return '<i>' + esc(x) + '</i>'; }).join('<em> · </em>');
    html += '<div class="sp-row' + (SP.sel[s.id] ? " on" : "") + '" data-id="' + esc(s.id) + '">' +
      '<span class="tick' + (SP.sel[s.id] ? " on" : "") + '" data-tick>' + TICK_SVG + '</span>' +
      '<div class="si-ic">' + iconSvg(kindOf(s.name, s.isDir), 15) + '</div>' +
      '<div class="si-n"><b><i class="si-name" title="' + esc(s.path) + '">' + esc(s.name) + '</i>' +
        (s.needsPassword ? '<span class="sp-badge pw">提取码</span>' : '') +
        (expired ? '<span class="sp-badge exp">已过期</span>' : '') +
      '</b><span class="si-meta">' + meta + '</span></div>' +
      '<div class="si-act">' +
        '<button data-copy title="复制链接">' + iconSvg("copy", 14) + '</button>' +
        '<button data-open title="打开分享页">' + iconSvg("open", 14) + '</button>' +
        '<button class="dg" data-del title="删除分享">' + iconSvg("trash", 14) + '</button>' +
      '</div></div>';
  });
  box.innerHTML = html;
}

function removeShares(ids){
  if(!ids || !ids.length) return;
  req("DELETE", "/__api/shares", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: ids })
  }).then(function(r){
    if(!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(function(j){
    /* 先就地移除，界面立刻响应；随后再拉一次列表校准 */
    var gone = {};
    ids.forEach(function(x){ gone[x] = true; });
    SP.list = SP.list.filter(function(s){ return !gone[s.id]; });
    ids.forEach(function(x){ delete SP.sel[x]; });
    renderShares();
    toast("已删除 " + (j.removed != null ? j.removed : ids.length) + " 个分享", "ok");
    loadShares();
    if(typeof loadShareList === "function") loadShareList();
  }).catch(function(e){
    toast("删除失败：" + e.message, "err");
  });
}

function bindShares(){
  $("btnShares").onclick = openShares;
  $("spClose").onclick = closeShares;
  $("shares").addEventListener("mousedown", function(e){
    if(e.target === $("shares")) closeShares();
  });
  $("spQ").addEventListener("input", function(){ SP.q = this.value.trim(); renderShares(); });
  $("spAll").onclick = function(){
    var all = spRows();
    var every = all.length > 0 && all.every(function(s){ return SP.sel[s.id]; });
    all.forEach(function(s){ if(every) delete SP.sel[s.id]; else SP.sel[s.id] = true; });
    renderShares();
  };
  $("spDelSel").onclick = function(){
    var ids = Object.keys(SP.sel);
    if(!ids.length) return;
    confirmBox("删除分享", "选中的 " + ids.length + " 个链接将立即失效，无法再打开。", "删除").then(function(ok){
      if(ok) removeShares(ids);
    });
  };
  $("spClear").onclick = function(){
    var ids = SP.list.map(function(s){ return s.id; });
    if(!ids.length) return;
    confirmBox("清空全部分享", "共 " + ids.length + " 个链接将立即失效，此操作不可撤销。", "全部清空").then(function(ok){
      if(ok) removeShares(ids);
    });
  };
  $("spList").addEventListener("click", function(e){
    var row = e.target.closest(".sp-row");
    if(!row) return;
    var id = row.getAttribute("data-id");
    var pick = function(){ return SP.list.filter(function(x){ return x.id === id; })[0]; };
    var btn = e.target.closest("button");
    if(btn){
      if(btn.hasAttribute("data-copy")){
        var a = pick(); if(a) copyText(a.url, null);
        return;
      }
      if(btn.hasAttribute("data-open")){
        var b = pick(); if(b) window.open(b.url, "_blank");
        return;
      }
      if(btn.hasAttribute("data-del")){
        confirmBox("删除分享", "删除后这个链接立即失效，已发出的链接无法再打开。", "删除").then(function(ok){
          if(ok) removeShares([id]);
        });
        return;
      }
    }
    if(SP.sel[id]) delete SP.sel[id]; else SP.sel[id] = true;
    renderShares();
  });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape" && !$("shares").classList.contains("hidden")) closeShares();
  });
}

function dialog(opts){
  closeDialog();
  var ov = document.createElement("div");
  ov.className = "overlay";
  var inputHtml = "";
  if(opts.input !== undefined){
    inputHtml = '<div class="field" style="margin:0 0 14px">' +
      (opts.label ? '<label>' + esc(opts.label) + '</label>' : '') +
      '<input class="input" id="dlgInput" value="' + esc(opts.input) + '" placeholder="' + esc(opts.placeholder || "") + '" spellcheck="false" autocomplete="off">' +
      '</div>';
  }
  ov.innerHTML = '<div class="dialog"><div class="dbody">' +
    '<h2>' + (opts.icon || "") + esc(opts.title) + '</h2>' +
    (opts.message ? '<p class="msg">' + opts.message + '</p>' : '') +
    inputHtml + '</div><div class="dfoot"></div></div>';
  var foot = ov.querySelector(".dfoot");
  var btns = opts.buttons || [{ text: "取消", value: false, kind: "ghost" }, { text: "确定", value: true, kind: "primary" }];
  var resolveFn = null;
  var p = new Promise(function(res){ resolveFn = res; });
  btns.forEach(function(b){
    var el = document.createElement("button");
    el.className = "btn " + (b.kind === "primary" ? "btn-primary" : b.kind === "danger" ? "btn-danger" : "btn-ghost");
    el.textContent = b.text;
    el.onclick = function(){
      var v = b.value;
      if(v === "__input__"){ var inp = ov.querySelector("#dlgInput"); v = inp ? inp.value.trim() : ""; if(!v) return; }
      closeDialog(); resolveFn(v);
    };
    foot.appendChild(el);
  });
  ov.addEventListener("mousedown", function(e){ if(e.target === ov){ closeDialog(); resolveFn(null); } });
  document.body.appendChild(ov);
  dlgEl = ov;
  var inp = ov.querySelector("#dlgInput");
  if(inp){
    setTimeout(function(){ inp.focus(); inp.select(); }, 30);
    inp.addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); var b = foot.querySelector(".btn-primary"); if(b) b.click(); }
    });
  }
  return p;
}
function confirmBox(title, message, okText){
  return dialog({
    title: title,
    message: message,
    buttons: [{ text: "取消", value: false, kind: "ghost" }, { text: okText || "确定", value: true, kind: "danger" }]
  });
}
function promptBox(title, label, value, placeholder, okText){
  return dialog({
    title: title, label: label, input: value, placeholder: placeholder,
    buttons: [{ text: "取消", value: null, kind: "ghost" }, { text: okText || "创建", value: "__input__", kind: "primary" }]
  });
}

/* ================= 渲染 ================= */
/** 排序用的大小：文件夹用统计值，还没算出来按 0 处理 */
function sortSize(x){
  if(!x.isDir) return x.size;
  return x.stat ? x.stat.size : 0;
}
function sortedItems(){
  var arr = S.items.slice();
  var k = S.sort.key, dir = S.sort.dir;
  arr.sort(function(a, b){
    if(a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    var r = 0;
    if(k === "name") r = a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    else if(k === "size") r = sortSize(a) - sortSize(b);
    else if(k === "mtime") r = a.mtime - b.mtime;
    return r * dir;
  });
  return arr;
}
function visibleItems(){
  var arr = sortedItems();
  if(!S.q) return arr;
  var q = S.q.toLowerCase();
  return arr.filter(function(it){ return it.name.toLowerCase().indexOf(q) >= 0; });
}

function renderCrumbs(){
  var parts = S.path === "/" ? [] : S.path.slice(1).split("/");
  var html = '<button class="crumb-ghost" data-path="/">全部文件</button>';
  if(parts.length === 0) html = '<span class="crumb cur">全部文件</span>';
  else {
    html += '<span class="crumb-sep">/</span>';
    var acc = "";
    for(var i = 0; i < parts.length; i++){
      acc += "/" + parts[i];
      var isLast = i === parts.length - 1;
      html += '<span class="crumb' + (isLast ? " cur" : "") + '" data-path="' + esc(acc) + '">' +
        esc(parts[i]) + '</span>';
      if(!isLast) html += '<span class="crumb-sep">/</span>';
    }
  }
  $("crumbs").innerHTML = html;
  Array.prototype.forEach.call($("crumbs").querySelectorAll("[data-path]"), function(el){
    el.onclick = function(){
      var p = el.getAttribute("data-path");
      if(p !== S.path) navigate(p, true);
    };
  });
}

function render(){
  var items = visibleItems();
  renderCrumbs();
  $("btnViewList").classList.toggle("on", S.view === "list");
  $("btnViewGrid").classList.toggle("on", S.view === "grid");
  var selCount = Object.keys(S.sel).length;
  $("btnDel").disabled = selCount === 0;
  $("btnDl").disabled = selCount === 0;
  $("btnShare").disabled = selCount !== 1;
  $("selInfo").innerHTML = selCount ? '已选 <b>' + selCount + '</b> 项' :
    (S.items.length ? '共 <b>' + S.items.length + '</b> 项' : "");

  var wrap = $("wrap");

  if(S.loading){
    wrap.innerHTML = '<div>' + new Array(7).join('<div class="skel"></div>') + '</div>';
    return;
  }

  if(!items.length){
    var isSearch = !!S.q;
    wrap.innerHTML = '<div class="empty">' +
      '<div class="ill">' + iconSvg(isSearch ? "bin" : "dir", 30) + '</div>' +
      '<h3>' + (isSearch ? "没有匹配的文件" : (S.path === "/" ? "这里还什么都没有" : "此文件夹为空")) + '</h3>' +
      '<p>' + (isSearch ? "试试其它关键词，或清空搜索框。" : "拖拽文件到页面任意位置即可上传，也可以点击上方按钮新建文件夹。") + '</p>' +
      (isSearch ? '' : '<div class="btnrow">' +
        '<button class="btn btn-primary" id="emptyUp"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16"/></svg>上传文件</button>' +
        '<button class="btn btn-ghost" id="emptyMk">新建文件夹</button></div>') +
      '</div>';
    var eu = $("emptyUp");
    if(eu) eu.onclick = function(){ $("fileInput").click(); };
    var em = $("emptyMk");
    if(em) em.onclick = makeDir;
    return;
  }

  if(S.view === "grid"){
    var gh = '<div class="gridview">';
    for(var g = 0; g < items.length; g++){
      var it = items[g];
      var sel = S.sel[it.path] ? " sel" : "";
      gh += '<div class="card' + sel + '" data-path="' + esc(it.path) + '">' +
        '<div class="thumb">' +
          '<span class="card-tick"><span class="tick' + (sel ? " on" : "") + '" data-tick="' + esc(it.path) + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span></span>' +
          (it.kind === "img"
            ? '<div class="fico img" data-thumb="' + esc(it.path) + '">' + iconSvg("img", 24) + '</div>'
            : '<div class="fico ' + it.kind + '">' + iconSvg(it.kind, 24) + '</div>') +
          '<div class="card-acts">' +
            (it.isDir ? '' : '<button data-dl="' + esc(it.path) + '" title="下载">' + iconSvg("bin", 13) + '</button>') +
            '<button data-more="' + esc(it.path) + '" title="更多">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="cbody">' +
          '<div class="cname" data-open="' + esc(it.path) + '">' + esc(it.name) + '</div>' +
          '<div class="cmeta" title="' + esc(statTitle(it)) + '">' + (it.isDir ? sizeText(it) : fmtSize(it.size)) + '</div>' +
        '</div>' +
      '</div>';
    }
    gh += '</div>';
    wrap.innerHTML = gh;
    bindGrid();
    lazyThumbs(items);
    return;
  }

  var arrow = S.sort.dir > 0
    ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>'
    : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  function th(key, label, cls){
    var on = S.sort.key === key;
    return '<div class="' + cls + '"><span class="th-sort' + (on ? " on" : "") + '" data-sort="' + key + '">' + label +
      '<span class="arrow">' + arrow + '</span></span></div>';
  }

  var html = '<div class="thead">' +
    '<div><span class="tick" id="tickAll"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span></div>' +
    th("name", "名称", "") + th("size", "大小", "th-size") + th("mtime", "修改时间", "th-time") +
    '<div class="th-act" style="text-align:right;padding-right:6px">操作</div>' +
    '</div>';

  for(var i = 0; i < items.length; i++){
    var it2 = items[i];
    var isSel = !!S.sel[it2.path];
    html += '<div class="row' + (isSel ? " sel" : "") + '" data-path="' + esc(it2.path) + '">' +
      '<div class="c"><span class="tick' + (isSel ? " on" : "") + '" data-tick="' + esc(it2.path) + '">' +
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span></div>' +
      '<div class="c c-name">' +
        '<span class="fico ' + it2.kind + '">' + iconSvg(it2.kind, 16) + '</span>' +
        '<span class="nm" data-open="' + esc(it2.path) + '" title="' + esc(it2.name) + '">' + esc(it2.name) + '</span>' +
      '</div>' +
      '<div class="c c-size"><span class="meta" title="' + esc(statTitle(it2)) + '">' + sizeText(it2) + '</span></div>' +
      '<div class="c c-time"><span class="meta" title="' + esc(fmtTimeFull(it2.mtime)) + '">' + fmtTime(it2.mtime) + '</span></div>' +
      '<div class="c acts">' +
        (it2.isDir ? "" :
          '<button class="icon-btn" style="width:28px;height:28px" data-dl="' + esc(it2.path) + '" title="下载">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M4 18v1.5A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V18"/></svg></button>') +
        '<button class="icon-btn" style="width:28px;height:28px" data-ren="' + esc(it2.path) + '" title="重命名">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>' +
        '<button class="icon-btn" style="width:28px;height:28px;color:var(--danger)" data-del="' + esc(it2.path) + '" title="删除">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>' +
      '</div>' +
    '</div>';
  }
  wrap.innerHTML = html;
  bindList(items);
}

var longPressAt = 0;
function bindLongPress(el){
  var timer = null;
  el.addEventListener("touchstart", function(ev){
    var t = ev.touches && ev.touches[0];
    if(!t) return;
    var x = t.clientX, y = t.clientY;
    timer = setTimeout(function(){
      timer = null;
      longPressAt = Date.now();
      var p = el.getAttribute("data-path");
      var it = findItem(p);
      if(!it) return;
      if(!S.sel[p]){ S.sel = {}; S.sel[p] = true; render(); }
      showCtx(x, y, it);
    }, 460);
  }, { passive: true });
  var cancel = function(){ if(timer){ clearTimeout(timer); timer = null; } };
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener("touchmove", cancel);
}

function bindList(items){
  var all = $("tickAll");
  if(all){
    var every = items.length > 0 && items.every(function(it){ return S.sel[it.path]; });
    if(every) all.classList.add("on");
    all.onclick = function(e){
      e.stopPropagation();
      if(every){ S.sel = {}; } else { items.forEach(function(it){ S.sel[it.path] = true; }); }
      render();
    };
  }
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-sort]"), function(el){
    el.onclick = function(){
      var k = el.getAttribute("data-sort");
      if(S.sort.key === k) S.sort.dir = -S.sort.dir;
      else S.sort = { key: k, dir: 1 };
      render();
    };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-tick]"), function(el){
    el.onclick = function(e){ e.stopPropagation(); toggleSel(el.getAttribute("data-tick")); };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-open]"), function(el){
    el.onclick = function(e){ e.stopPropagation(); openItem(el.getAttribute("data-open")); };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-dl]"), function(el){
    el.onclick = function(e){ e.stopPropagation(); download(el.getAttribute("data-dl")); };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-ren]"), function(el){
    el.onclick = function(e){ e.stopPropagation(); renameItem(el.getAttribute("data-ren")); };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-del]"), function(el){
    el.onclick = function(e){ e.stopPropagation(); deleteItems([el.getAttribute("data-del")]); };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll(".row"), function(row){
    bindLongPress(row);
    /* 单击即打开：文件进预览、文件夹进目录。勾选走左侧 tick，多选按住 Ctrl / Cmd / Shift 点击 */
    row.addEventListener("click", function(e){
      if(Date.now() - longPressAt < 700) return;
      if(e.target.closest(".tick") || e.target.closest("button")) return;
      var p = row.getAttribute("data-path");
      if(e.shiftKey || e.ctrlKey || e.metaKey){ toggleSel(p, e.shiftKey); return; }
      openItem(p);
    });
    row.addEventListener("contextmenu", function(e){
      e.preventDefault();
      var p = row.getAttribute("data-path");
      var it = findItem(p);
      if(!it) return;
      if(!S.sel[p]){ S.sel = {}; S.sel[p] = true; render(); }
      showCtx(e.clientX, e.clientY, it);
    });
  });
}

function bindGrid(){
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-open]"), function(el){
    el.onclick = function(e){ e.stopPropagation(); openItem(el.getAttribute("data-open")); };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-tick]"), function(el){
    el.onclick = function(e){ e.stopPropagation(); toggleSel(el.getAttribute("data-tick")); };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-dl]"), function(el){
    el.onclick = function(e){ e.stopPropagation(); download(el.getAttribute("data-dl")); };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll("[data-more]"), function(el){
    el.onclick = function(e){
      e.stopPropagation();
      var p = el.getAttribute("data-more");
      var it = findItem(p);
      if(it) showCtx(e.clientX, e.clientY, it);
    };
  });
  Array.prototype.forEach.call($("wrap").querySelectorAll(".card"), function(card){
    bindLongPress(card);
    card.addEventListener("click", function(e){
      if(Date.now() - longPressAt < 700) return;
      if(e.target.closest("button") || e.target.closest(".tick")) return;
      var p = card.getAttribute("data-path");
      if(e.shiftKey || e.ctrlKey || e.metaKey){ toggleSel(p, e.shiftKey); return; }
      openItem(p);
    });
    card.addEventListener("contextmenu", function(e){
      e.preventDefault();
      var p = card.getAttribute("data-path");
      var it = findItem(p);
      if(!it) return;
      if(!S.sel[p]){ S.sel = {}; S.sel[p] = true; render(); }
      showCtx(e.clientX, e.clientY, it);
    });
  });
}

/* 图片缩略图：并发 3，IntersectionObserver 懒加载 */
var thumbQueue = [], thumbActive = 0, thumbCache = {};
function lazyThumbs(items){
  var targets = Array.prototype.slice.call($("wrap").querySelectorAll("[data-thumb]"));
  if(!targets.length) return;
  if(!("IntersectionObserver" in window)){
    targets.forEach(function(t){ thumbQueue.push(t); });
    pumpThumbs();
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){
        io.unobserve(en.target);
        thumbQueue.push(en.target);
        pumpThumbs();
      }
    });
  }, { rootMargin: "180px" });
  targets.forEach(function(t){ io.observe(t); });
}
function pumpThumbs(){
  while(thumbActive < 3 && thumbQueue.length){
    var el = thumbQueue.shift();
    var p = el.getAttribute("data-thumb");
    if(thumbCache[p]){ el.innerHTML = '<img src="' + thumbCache[p] + '" alt="">'; continue; }
    thumbActive++;
    (function(node, path){
      fetch(location.origin + urlPath(path), { headers: authHeaders(), cache: "force-cache" })
        .then(function(r){ if(!r.ok) throw 0; return r.blob(); })
        .then(function(b){ var u = URL.createObjectURL(b); thumbCache[path] = u; node.innerHTML = '<img src="' + u + '" alt="">'; })
        .catch(function(){})
        .then(function(){ thumbActive--; pumpThumbs(); });
    })(el, p);
  }
}

function findItem(p){
  for(var i = 0; i < S.items.length; i++) if(S.items[i].path === p) return S.items[i];
  return null;
}
function toggleSel(p, range){
  if(range) { /* 范围选择：从最后选中项到当前项 */ }
  if(S.sel[p]) delete S.sel[p]; else S.sel[p] = true;
  render();
}
function selectedPaths(){ return Object.keys(S.sel); }

/* ================= 导航 ================= */
function navigate(path, push){
  if(push && S.path !== path) S.hist.push(S.path);
  S.path = path;
  S.sel = {};
  S.q = ""; $("q").value = ""; $("qClr").classList.add("hidden");
  load();
}
async function load(){
  S.loading = true; render();
  try {
    var r = await req("PROPFIND", S.path, {
      headers: { Depth: "1" },
      body: PROPFIND_BODY
    });
    if(r.status === 401){ logout("登录已失效，请重新登录"); return; }
    if(r.status === 404){ toast("目录不存在", "err"); S.path = parentOf(S.path); S.loading = false; load(); return; }
    if(r.status !== 207 && r.status !== 200) throw new Error("PROPFIND " + r.status);
    var txt = await r.text();
    S.items = parsePropfind(txt, S.path);
    S.loading = false;
    render();
    loadDirStats(statFresh);
    statFresh = false;
    if(quotaDirty){ quotaDirty = false; loadQuota(true); }
  } catch(e){
    S.loading = false;
    render();
    toast("加载失败：" + (e && e.message ? e.message : e), "err");
  }
}

/* ================= 文件夹大小 / 条目数 =================
   R2 没有目录大小，PROPFIND 对集合只能给 0。
   这里按需向 /__api/dirstat 批量要递归统计，分批串行拉，回来一批就刷一批。 */
var dirStatSeq = 0;
function loadDirStats(fresh){
  var dirs = [];
  for(var i = 0; i < S.items.length; i++) if(S.items[i].isDir) dirs.push(S.items[i]);
  var seq = ++dirStatSeq;
  if(!dirs.length) return;
  dirs.forEach(function(d){ if(d.stat === undefined) d.stat = null; });
  var queue = dirs.map(function(d){ return d.path; });

  function step(){
    if(seq !== dirStatSeq) return;
    var chunk = queue.splice(0, 4);
    if(!chunk.length) return;
    req("POST", "/__api/dirstat", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: chunk, fresh: !!fresh })
    }).then(function(r){
      if(r.status === 401){ logout("登录已失效，请重新登录"); throw new Error("401"); }
      if(!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function(j){
      if(seq !== dirStatSeq) return;
      var rows = (j && j.stats) || [];
      for(var k = 0; k < rows.length; k++){
        var it = findItem(rows[k].path);
        if(it && it.isDir) it.stat = rows[k];
      }
      paintDirStats();
      step();
    }).catch(function(e){
      if(seq !== dirStatSeq || (e && e.message === "401")) return;
      for(var k = 0; k < chunk.length; k++){
        var it = findItem(chunk[k]);
        if(it && it.isDir && !it.stat) it.statFail = true;
      }
      paintDirStats();
      step();
    });
  }
  step();
}

/** 只改文本，不重绘整页 —— 保住滚动位置和选中态 */
function paintDirStats(){
  var wrap = $("wrap");
  if(!wrap) return;
  var els = wrap.querySelectorAll(".row[data-path], .card[data-path]");
  for(var i = 0; i < els.length; i++){
    var it = findItem(els[i].getAttribute("data-path"));
    if(!it || !it.isDir) continue;
    var cell = els[i].querySelector(".c-size .meta") || els[i].querySelector(".cmeta");
    if(!cell) continue;
    cell.textContent = sizeText(it);
    cell.title = statTitle(it);
  }
}

/* ================= 文件操作 ================= */
function openItem(p){
  var it = findItem(p);
  if(!it) return;
  if(it.isDir){ navigate(p, true); return; }
  preview(it);
}

function download(p){
  var it = findItem(p);
  if(it && it.isDir){ toast("文件夹暂不支持打包下载", "info"); return; }
  var name = it ? it.name : baseOf(p);
  toast("开始下载 " + name, "info");
  fetch(location.origin + urlPath(p), { headers: authHeaders() })
    .then(function(r){
      if(r.status === 401){ logout("登录已失效"); throw new Error("401"); }
      if(!r.ok) throw new Error("HTTP " + r.status);
      return r.blob();
    })
    .then(function(b){
      var u = URL.createObjectURL(b);
      var a = document.createElement("a");
      a.href = u; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(u); }, 30000);
    })
    .catch(function(e){ if(e.message !== "401") toast("下载失败：" + e.message, "err"); });
}

async function deleteItems(paths){
  if(!paths.length) return;
  var label = paths.length === 1 ? '"' + baseOf(paths[0]) + '"' : paths.length + " 个项目";
  var ok = await confirmBox("删除" + (paths.length === 1 ? "项目" : "项目"),
    "确定要删除 <b>" + esc(label) + "</b> 吗？" +
    (paths.some(function(p){ var i = findItem(p); return i && i.isDir; }) ? "<br>文件夹将被递归删除，此操作不可撤销。" : "此操作不可撤销。"),
    "删除");
  if(!ok) return;
  var fail = 0, locked = 0;
  for(var i = 0; i < paths.length; i++){
    try {
      var r = await req("DELETE", paths[i]);
      if(r.status === 423) locked++;
      else if(!r.ok && r.status !== 404) fail++;
      delete S.sel[paths[i]];
    } catch(e){ fail++; }
  }
  if(locked) toast(locked + " 项被锁定，无法删除", "err");
  if(fail) toast(fail + " 项删除失败", "err");
  if(!fail && !locked) toast("已删除 " + paths.length + " 项", "ok");
  load();
}

async function renameItem(p){
  var it = findItem(p);
  var old = it ? it.name : baseOf(p);
  var name = await promptBox("重命名", "新名称", old, "输入新名称", "重命名");
  if(!name || name === old) return;
  if(name.indexOf("/") >= 0){ toast("名称不能包含 /", "err"); return; }
  var dest = joinPath(parentOf(p), name);
  try {
    var r = await req("MOVE", p, {
      headers: { Destination: location.origin + urlPath(dest), Overwrite: "F" }
    });
    if(r.status === 412){ toast("目标名称已存在", "err"); return; }
    if(r.status === 423){ toast("项目被锁定，无法重命名", "err"); return; }
    if(!r.ok && r.status !== 201 && r.status !== 204) throw new Error("HTTP " + r.status);
    toast("已重命名为 " + name, "ok");
    load();
  } catch(e){ toast("重命名失败：" + e.message, "err"); }
}

async function makeDir(){
  var name = await promptBox("新建文件夹", "文件夹名称", "新建文件夹", "例如：照片", "创建");
  if(!name) return;
  if(name.indexOf("/") >= 0){ toast("名称不能包含 /", "err"); return; }
  try {
    var r = await req("MKCOL", joinPath(S.path, name));
    if(r.status === 405){ toast("同名项目已存在", "err"); return; }
    if(!r.ok && r.status !== 201) throw new Error("HTTP " + r.status);
    toast("已创建文件夹", "ok");
    load();
  } catch(e){ toast("创建失败：" + e.message, "err"); }
}

async function newFile(){
  var name = await promptBox("新建文件", "文件名（可带扩展名）", "未命名.txt", "例如：笔记.md", "创建并编辑");
  if(!name) return;
  if(name.indexOf("/") >= 0){ toast("名称不能包含 /", "err"); return; }
  var p = joinPath(S.path, name);
  try {
    var r = await req("PUT", p, {
      headers: { "Content-Type": guessType(name) },
      body: ""
    });
    if(!r.ok && r.status !== 201 && r.status !== 204) throw new Error("HTTP " + r.status);
    load();
    openEditor(p, name, "");
  } catch(e){ toast("创建失败：" + e.message, "err"); }
}

function guessType(name){
  var k = kindOf(name, false);
  if(k === "code"){
    var e = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    if(e === "json") return "application/json";
    if(e === "html" || e === "htm") return "text/html";
    if(e === "css") return "text/css";
    if(e === "js") return "application/javascript";
    if(e === "xml") return "application/xml";
    if(e === "md" || e === "markdown") return "text/markdown";
    return "text/plain; charset=utf-8";
  }
  if(k === "img" || k === "doc") return "";
  return "";
}

/* ================= 编辑器 ================= */
function openEditor(path, name, content){
  S.editorPath = path;
  $("edName").textContent = name;
  $("edText").value = content;
  $("edStatus").textContent = content.length + " 字符";
  $("editor").classList.remove("hidden");
  setTimeout(function(){ $("edText").focus(); }, 40);
}
function closeEditor(){ $("editor").classList.add("hidden"); S.editorPath = null; }
async function saveEditor(){
  if(!S.editorPath) return;
  var body = $("edText").value;
  $("edSave").disabled = true;
  $("edSave").textContent = "保存中…";
  try {
    var r = await req("PUT", S.editorPath, {
      headers: { "Content-Type": guessType($("edName").textContent) || "text/plain; charset=utf-8" },
      body: body
    });
    if(r.status === 423){ toast("文件被锁定，无法保存", "err"); return; }
    if(!r.ok && r.status !== 201 && r.status !== 204) throw new Error("HTTP " + r.status);
    toast("已保存", "ok");
    $("edStatus").textContent = "已保存 · " + body.length + " 字符";
    load();
  } catch(e){ toast("保存失败：" + e.message, "err"); }
  finally {
    $("edSave").disabled = false;
    $("edSave").textContent = "保存";
  }
}

/* ================= 预览 =================
   单击即预览：图片 / 视频 / 音频 / PDF / 网页 / Markdown / JSON / CSV / 代码 / 纯文本 /
   docx / xlsx / pptx。媒体走签名直链，浏览器原生 Range 边下边播，不再把整个文件读进内存。 */
var PV = { list: [], idx: 0, it: null, seq: 0, tokens: {} };
var PV_TEXT_MAX = 6 * 1024 * 1024;
var PV_OFFICE_MAX = 24 * 1024 * 1024;
var NL = String.fromCharCode(10), TAB = String.fromCharCode(9);

function pvSet(s){
  var o = {};
  s.split(",").forEach(function(x){ if(x) o[x] = 1; });
  return o;
}
var PV_EXT = {
  img: pvSet("avif,bmp,gif,heic,ico,jfif,jpeg,jpg,png,svg,tif,tiff,webp"),
  vid: pvSet("avi,flv,m4v,mkv,mov,mp4,ogv,webm,wmv"),
  aud: pvSet("aac,flac,m4a,mp3,oga,ogg,opus,wav,wma"),
  pdf: pvSet("pdf"),
  md: pvSet("md,markdown"),
  json: pvSet("json,json5,ipynb"),
  csv: pvSet("csv,tsv"),
  html: pvSet("html,htm,xhtml"),
  docx: pvSet("docx"),
  xlsx: pvSet("xlsx,xlsm"),
  pptx: pvSet("pptx"),
  text: pvSet("txt,log,ini,conf,cfg,env,properties,srt,vtt,nfo,text,readme,license,gitignore,editorconfig"),
  code: pvSet("js,mjs,cjs,jsx,ts,tsx,vue,svelte,css,scss,sass,less,styl,py,pyi,go,rs,java,c,cc,cpp,cxx,h,hpp,cs,sh,bash,zsh,fish,ps1,psm1,bat,cmd,yml,yaml,toml,sql,php,rb,swift,kt,kts,xml,gradle,lua,dart,r,pl,pm,tex,proto,graphql,gql,cmake,mk,make,dockerfile,nginx,service,plist,lock")
};
var PV_LABEL = {
  img: "图片", vid: "视频", aud: "音频", pdf: "PDF 文档", md: "Markdown",
  json: "JSON", csv: "表格", html: "网页", docx: "Word 文档", xlsx: "Excel 表格",
  pptx: "演示文稿", text: "文本", code: "代码"
};
var PV_EDITABLE = { md: 1, json: 1, csv: 1, text: 1, code: 1, html: 1 };

function extOf(name){
  var i = String(name).lastIndexOf(".");
  return i > 0 ? String(name).slice(i + 1).toLowerCase() : "";
}
function pvModeOf(it){
  if(it.isDir) return "none";
  var e = extOf(it.name);
  if(PV_EXT.img[e]) return "img";
  if(PV_EXT.vid[e]) return "vid";
  if(PV_EXT.aud[e]) return "aud";
  if(PV_EXT.pdf[e]) return "pdf";
  if(PV_EXT.md[e]) return "md";
  if(PV_EXT.json[e]) return "json";
  if(PV_EXT.csv[e]) return "csv";
  if(PV_EXT.html[e]) return "html";
  if(PV_EXT.docx[e]) return "docx";
  if(PV_EXT.xlsx[e]) return "xlsx";
  if(PV_EXT.pptx[e]) return "pptx";
  if(PV_EXT.text[e]) return "text";
  if(PV_EXT.code[e]) return "code";
  if(!e && /^(makefile|dockerfile|license|readme|changelog)$/i.test(it.name)) return "code";
  return "none";
}

/* 预览直链：带 Basic 换签名地址，过期前复用 */
function pvUrl(path){
  var c = PV.tokens[path];
  if(c && c.exp - 60000 > Date.now()) return Promise.resolve(c.url);
  return fetch(location.origin + "/__api/preview", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path: path })
  }).then(function(r){
    if(r.status === 401){ logout("登录已失效"); throw new Error("登录已失效"); }
    if(!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(function(j){
    PV.tokens[path] = { url: j.url, exp: j.expiresAt || 0 };
    return j.url;
  });
}

function closePreview(){
  PV.seq++;
  PV.it = null;
  $("pvBody").innerHTML = "";
  $("preview").classList.add("hidden");
}

function preview(it){
  if(!it || it.isDir){ return; }
  PV.it = it;
  PV.openedAt = Date.now();
  var files = visibleItems().filter(function(x){ return !x.isDir; });
  var idx = -1;
  for(var i = 0; i < files.length; i++){ if(files[i].path === it.path){ idx = i; break; } }
  if(idx < 0){ files = [it]; idx = 0; }
  PV.list = files;
  PV.idx = idx;
  $("preview").classList.remove("hidden");
  pvPaint();
}

function pvStep(d){
  if(PV.list.length < 2) return;
  PV.idx = (PV.idx + d + PV.list.length) % PV.list.length;
  PV.it = PV.list[PV.idx];
  pvPaint();
}

function pvPaint(){
  var it = PV.it;
  if(!it) return;
  var mode = pvModeOf(it);
  var n = PV.list.length;
  var parts = [fmtSize(it.size), fmtTimeFull(it.mtime)];
  if(PV_LABEL[mode]) parts.push(PV_LABEL[mode]);
  if(n > 1) parts.push((PV.idx + 1) + " / " + n);
  $("pvTitle").querySelector(".t").textContent = it.name;
  $("pvSub").textContent = parts.join(" · ");
  $("pvEdit").classList.toggle("hidden", !PV_EDITABLE[mode]);
  $("pvEdit").onclick = async function(){ var cur = PV.it; closePreview(); await editExisting(cur); };
  $("pvDl").onclick = function(){ download(it.path); };
  $("pvPrev").disabled = n < 2;
  $("pvNext").disabled = n < 2;
  pvRender();
}

async function pvRender(){
  var it = PV.it, box = $("pvBody");
  var seq = ++PV.seq;
  var mode = pvModeOf(it);
  box.scrollTop = 0;
  box.innerHTML = '<div class="pv-loading"><span class="spinner"></span>载入中…</div>';
  try {
    if(mode === "none"){ pvFallback(it); return; }

    if(mode === "img"){
      var u = await pvUrl(it.path);
      if(seq !== PV.seq) return;
      box.innerHTML = '<img alt="' + esc(it.name) + '" src="' + u + '">';
      var im = box.querySelector("img");
      im.onclick = function(){ im.classList.toggle("zoom"); };
      im.onerror = function(){
        pvFallback(it, "预览失败", "浏览器无法解码这张图片（HEIC / TIFF 等格式需要下载后用本地应用打开）。");
      };
      return;
    }

    if(mode === "vid"){
      var uv = await pvUrl(it.path);
      if(seq !== PV.seq) return;
      box.innerHTML = '<video src="' + uv + '" controls autoplay playsinline preload="metadata"></video>';
      var vd = box.querySelector("video");
      if(vd) vd.onerror = function(){
        pvFallback(it, "预览失败", "这个视频的编码浏览器放不了（常见于 RMVB / WMV / 部分 MKV），下载后用本地播放器可以正常看。");
      };
      return;
    }

    if(mode === "aud"){
      var ua = await pvUrl(it.path);
      if(seq !== PV.seq) return;
      box.innerHTML = '<div class="pv-aud"><div class="cover">' + iconSvg("aud", 46) + '</div>' +
        '<div class="an">' + esc(it.name) + '</div><audio src="' + ua + '" controls autoplay></audio></div>';
      return;
    }

    if(mode === "pdf" || mode === "html"){
      var up = await pvUrl(it.path);
      if(seq !== PV.seq) return;
      box.innerHTML = mode === "pdf"
        ? '<iframe src="' + up + '" title="' + esc(it.name) + '"></iframe>'
        : '<iframe src="' + up + '" title="' + esc(it.name) + '" sandbox="allow-scripts allow-popups allow-forms"></iframe>';
      return;
    }

    if(mode === "md" || mode === "json" || mode === "csv" || mode === "text" || mode === "code"){
      if(it.size > PV_TEXT_MAX){ pvFallback(it, "文件太大", "超过 6 MB 的文本在线渲染会让页面卡死，建议下载后查看。"); return; }
      var ut = await pvUrl(it.path);
      var rt = await fetch(ut);
      if(!rt.ok) throw new Error("HTTP " + rt.status);
      var text = await rt.text();
      if(seq !== PV.seq) return;
      if(mode === "csv"){
        box.innerHTML = '<div class="pv-tblwrap">' + pvTable(text, extOf(it.name) === "tsv" ? TAB : ",") + '</div>';
      } else if(mode === "md"){
        box.innerHTML = '<div class="pv-doc">' + pvMd(text) + '</div>';
      } else if(mode === "json"){
        var pretty = text;
        try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch(e){}
        box.innerHTML = pvCode(pretty);
      } else if(mode === "code"){
        box.innerHTML = pvCode(text);
      } else {
        box.innerHTML = '<pre class="pv-plain">' + esc(text) + '</pre>';
      }
      return;
    }

    if(mode === "docx" || mode === "xlsx" || mode === "pptx"){
      if(it.size > PV_OFFICE_MAX){ pvFallback(it, "文件太大", "超过 24 MB 的 Office 文件在线解析会占用大量内存，建议下载后查看。"); return; }
      if(typeof DecompressionStream === "undefined"){
        pvFallback(it, "浏览器不支持", "当前浏览器不支持在线解压预览，请升级浏览器或下载后查看。");
        return;
      }
      var uo = await pvUrl(it.path);
      var ab = await (await fetch(uo)).arrayBuffer();
      if(seq !== PV.seq) return;
      var zip = pvZipList(ab);
      if(mode === "docx"){
        box.innerHTML = '<div class="pv-doc">' + pvDocxHtml(await pvZipText(zip, "word/document.xml")) + '</div>';
      } else if(mode === "xlsx"){
        box.innerHTML = '<div class="pv-tblwrap">' + await pvXlsxHtml(zip) + '</div>';
      } else {
        box.innerHTML = '<div class="pv-doc">' + await pvPptxHtml(zip) + '</div>';
      }
      return;
    }
  } catch(e){
    if(seq !== PV.seq) return;
    pvFallback(it, "预览失败", e && e.message ? e.message : "未知错误");
  }
}

function pvFallback(it, title, hint){
  var e = extOf(it.name);
  if(!hint){
    if(e === "doc" || e === "xls" || e === "ppt"){
      hint = "这是旧版 Office 二进制格式，无法在线解析。下载后用 Office / WPS 打开，或另存为 " + e + "x 再上传即可预览。";
    } else if(it.kind === "zip"){
      hint = "压缩包暂不支持在线解包预览，可先下载到本地。";
    } else if(e === "epub" || e === "rtf" || e === "pages" || e === "key" || e === "numbers"){
      hint = "该格式需要专用阅读器，可下载后使用本地应用打开。";
    } else {
      hint = "浏览器无法直接渲染这种格式，可下载后使用本地应用打开。";
    }
  }
  $("pvBody").innerHTML = '<div class="pv-empty">' +
    '<div class="ico">' + iconSvg(it.kind, 34) + '</div>' +
    '<h4>' + esc(title || "暂不支持在线预览") + '</h4>' +
    '<p>' + esc(hint) + '</p>' +
    '<button id="pvDl2">下载文件（' + fmtSize(it.size) + '）</button>' +
    '</div>';
  var b = $("pvDl2");
  if(b) b.onclick = function(){ download(it.path); };
}

/* ---------- 代码 / 表格 / Markdown ---------- */
function pvCode(text){
  var lines = String(text).split(/\\r?\\n/);
  var cap = Math.min(lines.length, 8000);
  var h = '<pre class="pv-code">';
  for(var i = 0; i < cap; i++){
    h += '<span class="cl"><span class="ln">' + (i + 1) + '</span>' + esc(lines[i] || " ") + '</span>';
  }
  if(lines.length > cap) h += '<span class="cl"><span class="ln">…</span>已截断，共 ' + lines.length + ' 行</span>';
  return h + '</pre>';
}

function pvCsv(text, sep){
  var rows = [], row = [], cur = "", q = false, ch;
  for(var i = 0; i < text.length; i++){
    ch = text.charAt(i);
    if(q){
      if(ch === '"'){
        if(text.charAt(i + 1) === '"'){ cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else if(ch === '"'){ q = true; }
    else if(ch === sep){ row.push(cur); cur = ""; }
    else if(ch === NL || ch === String.fromCharCode(13)){
      if(ch === String.fromCharCode(13) && text.charAt(i + 1) === NL) i++;
      row.push(cur); rows.push(row); row = []; cur = "";
      if(rows.length >= 600) return rows;
    } else cur += ch;
  }
  if(cur !== "" || row.length){ row.push(cur); rows.push(row); }
  return rows;
}

function pvTable(text, sep){
  var rows = pvCsv(text, sep);
  if(!rows.length) return '<div style="padding:24px;color:var(--text3)">空表格</div>';
  var cols = 0;
  rows.forEach(function(r){ if(r.length > cols) cols = r.length; });
  cols = Math.min(cols, 60);
  var h = '<table class="pv-tbl">';
  for(var i = 0; i < rows.length; i++){
    var tag = i === 0 ? "th" : "td";
    h += "<tr>";
    for(var c = 0; c < cols; c++) h += "<" + tag + ">" + esc(rows[i][c] || "") + "</" + tag + ">";
    h += "</tr>";
  }
  h += "</table>";
  if(rows.length >= 600) h += '<div style="padding:10px 14px;color:var(--text3);font-size:12px">仅显示前 600 行</div>';
  return h;
}

function pvInline(s){
  var out = esc(s);
  out = out.replace(/\\x60([^\\x60]+)\\x60/g, "<code>$1</code>");
  out = out.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\\*([^*]+)\\*/g, "$1<em>$2</em>");
  out = out.replace(/!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)/g, function(m, alt, src){
    return /^(https?:|data:image\\/)/i.test(src) ? '<img alt="' + alt + '" src="' + src + '">' : alt;
  });
  out = out.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, function(m, t, u){
    if(!/^(https?:|mailto:|#)/i.test(u)) return t;
    return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
  });
  return out;
}

function pvMd(src){
  var lines = String(src).split(/\\r?\\n/);
  var out = [], code = null, i = 0;
  function flush(){ if(code){ out.push("<pre><code>" + esc(code.join(NL)) + "</code></pre>"); code = null; } }
  while(i < lines.length){
    var ln = lines[i];
    if(/^\\s*(\\x60{3}|~~~)/.test(ln)){
      if(code) flush(); else code = [];
      i++; continue;
    }
    if(code){ code.push(ln); i++; continue; }
    if(/^\\s*$/.test(ln)){ i++; continue; }
    var hm = /^(#{1,6})\\s+(.*)$/.exec(ln);
    if(hm){
      var lv = hm[1].length;
      out.push("<h" + lv + ">" + pvInline(hm[2]) + "</h" + lv + ">");
      i++; continue;
    }
    if(/^\\s*([-*_])\\s*\\1\\s*\\1[\\s\\-*_]*$/.test(ln)){ out.push("<hr>"); i++; continue; }
    if(/^\\s*>/.test(ln)){
      var q = [];
      while(i < lines.length && /^\\s*>/.test(lines[i])){ q.push(lines[i].replace(/^\\s*>\\s?/, "")); i++; }
      out.push("<blockquote>" + pvMd(q.join(NL)) + "</blockquote>");
      continue;
    }
    if(/^\\s*\\|.*\\|\\s*$/.test(ln)){
      var trs = [];
      while(i < lines.length && /^\\s*\\|.*\\|\\s*$/.test(lines[i])){ trs.push(lines[i]); i++; }
      var cells = trs.map(function(r){
        return r.trim().replace(/^\\|/, "").replace(/\\|$/, "").split("|").map(function(c){ return c.trim(); });
      });
      var hasSep = cells.length > 1 && cells[1].every(function(c){ return /^:?-{2,}:?$/.test(c) || c === ""; });
      var tb = "<table>";
      for(var ri = 0; ri < cells.length; ri++){
        if(hasSep && ri === 1) continue;
        tb += "<tr>";
        for(var ci = 0; ci < cells[ri].length; ci++){
          var tg = (ri === 0 || (hasSep && ri === 2)) ? "th" : "td";
          tb += "<" + tg + ">" + pvInline(cells[ri][ci]) + "</" + tg + ">";
        }
        tb += "</tr>";
      }
      out.push(tb + "</table>");
      continue;
    }
    if(/^\\s*[-*+]\\s+/.test(ln)){
      var items = [];
      while(i < lines.length && /^\\s*[-*+]\\s+/.test(lines[i])){
        items.push(lines[i].replace(/^\\s*[-*+]\\s+/, "")); i++;
      }
      out.push("<ul>" + items.map(function(t){ return "<li>" + pvInline(t) + "</li>"; }).join("") + "</ul>");
      continue;
    }
    if(/^\\s*\\d+[.)]\\s+/.test(ln)){
      var oit = [];
      while(i < lines.length && /^\\s*\\d+[.)]\\s+/.test(lines[i])){
        oit.push(lines[i].replace(/^\\s*\\d+[.)]\\s+/, "")); i++;
      }
      out.push("<ol>" + oit.map(function(t){ return "<li>" + pvInline(t) + "</li>"; }).join("") + "</ol>");
      continue;
    }
    out.push("<p>" + pvInline(ln) + "</p>");
    i++;
  }
  flush();
  return out.join("");
}

/* ---------- OOXML：docx / xlsx / pptx（浏览器内置解压） ---------- */
var NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
var NS_S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
var NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

function pvXml(text){
  return new DOMParser().parseFromString(text, "application/xml");
}

function pvZipList(buf){
  var u8 = new Uint8Array(buf), dv = new DataView(buf);
  var eocd = -1, min = Math.max(0, u8.length - 66000);
  for(var i = u8.length - 22; i >= min; i--){
    if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error("不是标准的 Office (ZIP) 文件，无法解析");
  var count = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true), list = [];
  for(var n = 0; n < count; n++){
    if(off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
    var method = dv.getUint16(off + 10, true);
    var csize = dv.getUint32(off + 20, true);
    var nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    var lho = dv.getUint32(off + 42, true);
    var name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
    list.push({ name: name, method: method, csize: csize, lho: lho });
    off += 46 + nlen + elen + clen;
  }
  return { u8: u8, dv: dv, list: list };
}

function pvZipFind(zip, name){
  for(var i = 0; i < zip.list.length; i++){ if(zip.list[i].name === name) return zip.list[i]; }
  return null;
}

async function pvZipBytes(zip, entry){
  var dv = zip.dv, off = entry.lho;
  if(dv.getUint32(off, true) !== 0x04034b50) throw new Error("ZIP 条目损坏");
  var nlen = dv.getUint16(off + 26, true), elen = dv.getUint16(off + 28, true);
  var start = off + 30 + nlen + elen;
  var data = zip.u8.subarray(start, start + entry.csize);
  if(entry.method === 0) return data;
  var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function pvZipText(zip, name){
  var e = pvZipFind(zip, name);
  if(!e) return "";
  return new TextDecoder().decode(await pvZipBytes(zip, e));
}

function pvDocxHtml(xml){
  if(!xml) return "<p>文档内容为空。</p>";
  var doc;
  try { doc = pvXml(xml); } catch(e){ return "<p>文档解析失败。</p>"; }
  var ps = doc.getElementsByTagNameNS(NS_W, "p");
  if(!ps.length) ps = doc.getElementsByTagName("w:p");
  var out = "", count = 0;
  for(var i = 0; i < ps.length && count < 4000; i++){
    var ts = ps[i].getElementsByTagNameNS(NS_W, "t");
    var text = "";
    for(var j = 0; j < ts.length; j++) text += ts[j].textContent || "";
    if(!text.trim()) continue;
    count++;
    var style = "";
    var st = ps[i].getElementsByTagNameNS(NS_W, "pStyle")[0];
    if(st) style = st.getAttributeNS(NS_W, "val") || st.getAttribute("w:val") || "";
    var lv = 0;
    var hm = /^Heading(\\d)$/i.exec(style) || /^标题\\s*(\\d)$/.exec(style);
    if(hm) lv = Math.min(4, parseInt(hm[1], 10) || 1);
    else if(/^Title$/i.test(style)) lv = 1;
    out += lv ? "<h" + lv + ">" + esc(text) + "</h" + lv + ">" : "<p>" + esc(text) + "</p>";
  }
  if(!count) return "<p>没有提取到文字内容（文档可能整篇都是图片或扫描件）。</p>";
  return out;
}

function pvColIndex(ref){
  var m = /^([A-Z]+)/.exec(ref || "");
  if(!m) return -1;
  var n = 0;
  for(var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
  return n - 1;
}

async function pvXlsxHtml(zip){
  var shared = [];
  var ss = await pvZipText(zip, "xl/sharedStrings.xml");
  if(ss){
    var sdoc = pvXml(ss);
    var sis = sdoc.getElementsByTagNameNS(NS_S, "si");
    for(var i = 0; i < sis.length; i++){
      var ts = sis[i].getElementsByTagNameNS(NS_S, "t"), s = "";
      for(var j = 0; j < ts.length; j++) s += ts[j].textContent || "";
      shared.push(s);
    }
  }
  var sheet = null;
  for(var k = 0; k < zip.list.length; k++){
    if(/^xl\\/worksheets\\/sheet\\d+\\.xml$/.test(zip.list[k].name)){ sheet = zip.list[k].name; break; }
  }
  if(!sheet) return '<div style="padding:24px;color:var(--text3)">没有找到工作表</div>';
  var doc = pvXml(await pvZipText(zip, sheet));
  var rows = doc.getElementsByTagNameNS(NS_S, "row");
  var grid = [], maxCol = 0;
  for(var r = 0; r < rows.length && r < 400; r++){
    var cells = rows[r].getElementsByTagNameNS(NS_S, "c");
    var line = [];
    for(var c = 0; c < cells.length; c++){
      var cell = cells[c];
      var col = pvColIndex(cell.getAttribute("r") || "");
      if(col < 0) col = line.length;
      if(col > 59) continue;
      var t = cell.getAttribute("t") || "";
      var val = "", node;
      if(t === "s"){
        node = cell.getElementsByTagNameNS(NS_S, "v")[0];
        val = node ? (shared[parseInt(node.textContent || "0", 10)] || "") : "";
      } else if(t === "inlineStr"){
        node = cell.getElementsByTagNameNS(NS_S, "t")[0];
        val = node ? (node.textContent || "") : "";
      } else {
        node = cell.getElementsByTagNameNS(NS_S, "v")[0];
        val = node ? (node.textContent || "") : "";
      }
      while(line.length < col) line.push("");
      line[col] = val;
      if(col + 1 > maxCol) maxCol = col + 1;
    }
    grid.push(line);
  }
  if(!grid.length) return '<div style="padding:24px;color:var(--text3)">工作表是空的</div>';
  var h = '<table class="pv-tbl">';
  for(var ri = 0; ri < grid.length; ri++){
    var tag = ri === 0 ? "th" : "td";
    h += "<tr>";
    for(var ci = 0; ci < maxCol; ci++) h += "<" + tag + ">" + esc(grid[ri][ci] || "") + "</" + tag + ">";
    h += "</tr>";
  }
  h += "</table>";
  if(rows.length > 400) h += '<div style="padding:10px 14px;color:var(--text3);font-size:12px">仅显示前 400 行，共 ' + rows.length + ' 行</div>';
  return h;
}

async function pvPptxHtml(zip){
  var slides = zip.list.filter(function(e){ return /^ppt\\/slides\\/slide\\d+\\.xml$/.test(e.name); });
  slides.sort(function(a, b){
    var na = parseInt((/(\\d+)/.exec(a.name) || [0, "0"])[1], 10);
    var nb = parseInt((/(\\d+)/.exec(b.name) || [0, "0"])[1], 10);
    return na - nb;
  });
  if(!slides.length) return "<p>没有找到幻灯片。</p>";
  var out = "";
  for(var i = 0; i < slides.length && i < 100; i++){
    var doc = pvXml(await pvZipText(zip, slides[i].name));
    var ps = doc.getElementsByTagNameNS(NS_A, "p");
    var body = "";
    for(var j = 0; j < ps.length; j++){
      var ts = ps[j].getElementsByTagNameNS(NS_A, "t"), line = "";
      for(var k = 0; k < ts.length; k++) line += ts[k].textContent || "";
      if(line.trim()) body += "<p>" + esc(line) + "</p>";
    }
    out += "<h3>第 " + (i + 1) + " 页</h3>" + (body || '<p style="opacity:.5">本页没有可提取的文字</p>');
  }
  return out;
}


async function editExisting(it){
  try {
    var r = await fetch(location.origin + urlPath(it.path), { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    var txt = await r.text();
    openEditor(it.path, it.name, txt);
  } catch(e){ toast("读取失败：" + e.message, "err"); }
}

/* ================= 容量 =================
   总额度 10 GB，真正能写到的上限是 9.9 GB（服务端硬限制）。
   进度条按 9.9 GB 归一：走满就是「存不进去了」，不会让人以为还剩 10%。 */
var QP = null, quotaSeq = 0, quotaDirty = false;

/** 顶栏用的短格式：1.2G / 512M
    注意：这里是模板字符串内部，正则里的 \. 会被 TS 吃掉变成 . ，
    会导致 "10.0" 被 .0$ 误伤成 "1"，所以这里只用字符串判断，不用正则。 */
function fmtSizeShort(n){
  if(n == null || isNaN(n)) return "—";
  if(n >= 1073741824){
    var g = n / 1073741824;
    var s = g >= 10 ? String(Math.round(g)) : g.toFixed(1);
    if(s.length > 2 && s.slice(-2) === ".0") s = s.slice(0, -2);
    return s + "G";
  }
  if(n >= 1048576) return Math.round(n / 1048576) + "M";
  if(n >= 1024) return Math.round(n / 1024) + "K";
  return Math.round(n) + "B";
}

function loadQuota(fresh, cb){
  if(!S.auth){ if(cb) cb(QP); return; }
  var seq = ++quotaSeq;
  req("GET", "/__api/quota" + (fresh ? "?fresh=1" : "")).then(function(r){
    if(r.status === 401){ logout("登录已失效，请重新登录"); return null; }
    if(!r.ok) return null;
    return r.json();
  }).then(function(j){
    if(seq === quotaSeq && j) applyQuota(j);
    if(cb) cb(j || QP);
  }).catch(function(){ if(cb) cb(QP); });
}

function applyQuota(u){
  QP = u;
  var el = $("quota");
  if(!el) return;
  var used = $("qUsed"), tot = $("qTotal"), sh = $("qShort"), fill = $("qFill");
  if(used) used.textContent = fmtSize(u.used);
  if(tot) tot.textContent = fmtSize(u.total);
  if(sh) sh.textContent = fmtSizeShort(u.used) + " / " + fmtSizeShort(u.total);
  var pct = u.limit ? Math.min(100, (u.used / u.limit) * 100) : 0;
  /* 有数据时至少留 0.6%，否则一颗灰尘大小的文件看起来像没画 */
  if(fill){
    fill.style.width = (u.used > 0 && pct < 0.6 ? 0.6 : pct) + "%";
    /* 用量很小时按比例只有一两像素，给个下限，否则看起来像没画 */
    fill.style.minWidth = u.used > 0 ? "2px" : "0";
  }
  el.classList.toggle("warn", !!u.nearLimit && !u.full);
  el.classList.toggle("full", !!u.full);
  var pctOfTotal = u.total ? (u.used / u.total) * 100 : 0;
  /* 注意：这里是模板字符串内部，不能用 \n —— 会被 TS 提前解析成真实换行，生成的 JS 直接语法错误 */
  el.setAttribute("title",
    "已用 " + fmtSize(u.used) + " / " + fmtSize(u.total) + "（" + pctOfTotal.toFixed(1) + "%）" +
    " · 剩余 " + fmtSize(Math.max(0, u.total - u.used)) +
    " · 写入上限 " + fmtSize(u.limit) +
    " · " + u.files + " 个文件 / " + u.dirs + " 个文件夹");
}

function quotaTip(){
  if(!QP){ loadQuota(true); return; }
  var full = Math.max(0, QP.total - QP.used);
  toast("已用 " + fmtSize(QP.used) + " / " + fmtSize(QP.total) + " · 剩余 " + fmtSize(full), QP.full ? "err" : "ok");
}

/* ================= 上传 ================= */
var Q = [], Qactive = 0, Qtimer = null;

/** 速率格式化：B/s → KB/s → MB/s */
function fmtRate(bps){
  if(!bps || !isFinite(bps) || bps <= 0) return "";
  if(bps < 1024) return Math.round(bps) + " B/s";
  if(bps < 1024 * 1024) return (bps / 1024).toFixed(bps < 10240 ? 1 : 0) + " KB/s";
  return (bps / 1048576).toFixed(bps < 10485760 ? 2 : 1) + " MB/s";
}

function enqueue(fileList){
  var files = Array.prototype.slice.call(fileList || []);
  if(!files.length) return;

  var need = 0;
  files.forEach(function(f){ need += f.size; });

  function start(){
    /* 已知配额时先挡一道，省得传到一半才被服务端 507 打断 */
    if(QP){
      var free = Math.max(0, QP.limit - QP.used);
      if(need > free){
        toast("空间不足：这批共 " + fmtSize(need) + "，只剩 " + fmtSize(free), "err");
        loadQuota(true);
        return;
      }
    }
    files.forEach(function(f){
      Q.push({
        file: f, path: joinPath(S.path, f.name),
        prog: 0, status: "wait", err: "",
        loaded: 0, speed: 0, lastT: 0, lastLoaded: 0, lastEvt: 0
      });
    });
    $("uploads").classList.remove("hidden");
    renderUploads();
    startTicker();
    pump();
  }

  /* 还没取到配额：先拉一次再决定，避免「不知道还能不能放」 */
  if(!QP) loadQuota(true, start); else start();
}

/* 卡住时不会再收到 progress，速度得掉回 0，否则会一直停在最后一个读数上 */
function startTicker(){
  if(Qtimer) return;
  Qtimer = setInterval(function(){
    if(!Q.length){ stopTicker(); return; }
    var now = Date.now();
    Q.forEach(function(t){
      if(t.status === "run" && t.lastEvt && now - t.lastEvt > 1200) t.speed = 0;
    });
    applyUploadStats();
  }, 500);
}
function stopTicker(){ if(Qtimer){ clearInterval(Qtimer); Qtimer = null; } }

function pump(){
  while(Qactive < 3){
    var next = null;
    for(var i = 0; i < Q.length; i++){ if(Q[i].status === "wait"){ next = Q[i]; break; } }
    if(!next) break;
    startUpload(next);
  }
  renderUploads();
  if(Qactive === 0 && Q.length && Q.every(function(t){ return t.status === "done" || t.status === "error"; })){
    var okN = Q.filter(function(t){ return t.status === "done"; }).length;
    var errN = Q.filter(function(t){ return t.status === "error"; }).length;
    if(okN) toast("已上传 " + okN + " 个文件" + (errN ? "，" + errN + " 个失败" : ""), errN ? "err" : "ok");
    if(okN) statFresh = true; // 上传绕过了 req()，这里补上统计失效标记
    if(okN) quotaDirty = true;
    load();
    var snapshot = Q.length;
    setTimeout(function(){
      if(Qactive === 0 && Q.length === snapshot) resetQueue();
    }, 3200);
  }
}

function startUpload(task){
  task.status = "run";
  task.lastEvt = Date.now();
  Qactive++;
  var xhr = new XMLHttpRequest();
  xhr.open("PUT", location.origin + urlPath(task.path), true);
  xhr.setRequestHeader("Authorization", S.auth);
  xhr.setRequestHeader("X-DAV-UI", "1");
  if(task.file.type) xhr.setRequestHeader("Content-Type", task.file.type);
  xhr.upload.onprogress = function(e){
    if(!e.lengthComputable) return;
    var now = performance.now();
    task.prog = e.loaded / e.total;
    task.loaded = e.loaded;
    task.lastEvt = Date.now();
    if(!task.lastT){ task.lastT = now; task.lastLoaded = e.loaded; }
    var dt = (now - task.lastT) / 1000;
    /* 200ms 以上才采样一次，瞬时抖动做 60/40 指数平滑，读数不会乱跳 */
    if(dt >= 0.2){
      var inst = (e.loaded - task.lastLoaded) / dt;
      if(inst >= 0) task.speed = task.speed ? task.speed * 0.6 + inst * 0.4 : inst;
      task.lastT = now; task.lastLoaded = e.loaded;
    }
    applyUploadStats();
  };
  xhr.onload = function(){
    Qactive--;
    if(xhr.status === 401){ task.status = "error"; task.err = "登录失效"; }
    else if(xhr.status === 423){ task.status = "error"; task.err = "已锁定"; }
    else if(xhr.status === 507){
      task.status = "error";
      task.err = "空间不足";
      /* 服务端已经按 9.9 GB 拦下了，这里把配额拉新，顶栏数字跟着变红 */
      quotaDirty = true;
      loadQuota(true);
    }
    else if(xhr.status === 201 || xhr.status === 204 || xhr.status === 200){
      task.status = "done"; task.prog = 1; task.loaded = task.file.size;
    }
    else { task.status = "error"; task.err = "HTTP " + xhr.status; }
    task.speed = 0;
    renderUploads(); pump();
  };
  xhr.onerror = function(){ Qactive--; task.status = "error"; task.err = "网络错误"; task.speed = 0; renderUploads(); pump(); };
  xhr.onabort = function(){ Qactive--; task.status = "error"; task.err = "已取消"; task.speed = 0; renderUploads(); pump(); };
  xhr.send(task.file);
}

/* 只有任务数量变化才重建 DOM；进度走 applyUploadStats，避免每帧 innerHTML 造成闪烁 */
function renderUploads(){
  var list = $("upList");
  if(!list) return;
  if(list.children.length !== Q.length){
    var html = "";
    Q.forEach(function(t, i){
      var kind = kindOf(t.file.name, false);
      html += '<div class="up-item" data-i="' + i + '">' +
        '<span class="fico ' + kind + '" style="width:26px;height:26px;border-radius:7px">' + iconSvg(kind, 14) + '</span>' +
        '<div class="un" title="' + esc(t.file.name) + '"><b>' + esc(t.file.name) + '</b><span></span></div>' +
        '<div class="ub"><div class="bar"><i></i></div></div>' +
        '<div class="st"></div>' +
        '</div>';
    });
    list.innerHTML = html;
  }
  applyUploadStats();
}

function applyUploadStats(){
  var list = $("upList");
  if(!list) return;
  var doneN = 0, totalRate = 0;
  Q.forEach(function(t, i){
    var row = list.children[i];
    if(!row) return;
    var pct = Math.max(0, Math.min(100, Math.round(t.prog * 100)));
    var bar = row.querySelector(".bar i");
    var st = row.querySelector(".st");
    var meta = row.querySelector(".un span");
    if(t.status === "done"){
      doneN++;
      bar.className = "ok"; bar.style.width = "100%";
      st.textContent = "完成";
      meta.textContent = fmtSize(t.file.size);
    } else if(t.status === "error"){
      bar.className = "err"; bar.style.width = "100%";
      st.textContent = "失败";
      meta.textContent = fmtSize(t.file.size) + " · " + (t.err || "上传失败");
    } else if(t.status === "wait"){
      bar.className = ""; bar.style.width = "0%";
      st.textContent = "等待";
      meta.textContent = fmtSize(t.file.size) + " · 排队中";
    } else {
      totalRate += t.speed || 0;
      bar.className = ""; bar.style.width = pct + "%";
      st.textContent = pct + "%";
      var line = fmtSize(t.loaded || 0) + " / " + fmtSize(t.file.size);
      if(t.speed > 0) line += " · " + fmtRate(t.speed);
      meta.textContent = line;
    }
  });
  $("upSum").textContent = doneN + " / " + Q.length;
  var rt = $("upRate");
  if(rt) rt.textContent = totalRate > 0 ? "↑ " + fmtRate(totalRate) : "";
}

function resetQueue(){
  if(Qactive > 0) return;
  Q = [];
  stopTicker();
  $("uploads").classList.add("hidden");
  $("upList").innerHTML = "";
}

/* ================= 右键菜单 ================= */
var ctxEl = null;
function closeCtx(){ if(ctxEl){ ctxEl.remove(); ctxEl = null; } }
function showCtx(x, y, it){
  closeCtx();
  var el = document.createElement("div");
  el.id = "ctx";
  var multi = selectedPaths().length > 1;
  var items = [];
  if(!multi){
    if(it.isDir) items.push({ t: "打开", i: ICON.dir, fn: function(){ openItem(it.path); } });
    else if(it.kind === "img" || it.kind === "vid" || it.kind === "aud" || it.kind === "doc" || it.kind === "code" || it.ctype === "application/pdf")
      items.push({ t: "预览", i: ICON.doc, fn: function(){ preview(it); } });
    if(!it.isDir) items.push({ t: "下载", i: ICON.bin, fn: function(){ download(it.path); } });
    items.push({ sep: true });
    items.push({ t: "分享", i: ICON.share, fn: function(){ openShare(it.path); } });
    items.push({ t: "重命名", k: "F2", fn: function(){ renameItem(it.path); } });
  }
  items.push({ t: multi ? "删除 " + selectedPaths().length + " 项" : "删除", k: "Del", danger: true, fn: function(){ deleteItems(selectedPaths()); } });

  var html = "";
  items.forEach(function(o){
    if(o.sep){ html += '<div class="ctx-sep"></div>'; return; }
    html += '<button class="mi' + (o.danger ? " danger" : "") + '">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + o.i + '</svg>' +
      '<span>' + esc(o.t) + '</span>' + (o.k ? '<span class="kbd">' + o.k + '</span>' : '') + '</button>';
  });
  el.innerHTML = html;
  document.body.appendChild(el);
  var r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  var btns = el.querySelectorAll(".mi");
  var idx = 0;
  items.forEach(function(o){
    if(o.sep) return;
    var b = btns[idx++];
    b.onclick = function(){ closeCtx(); o.fn(); };
  });
  ctxEl = el;
}

/* ================= 认证 ================= */
function b64e(str){
  return btoa(unescape(encodeURIComponent(str)));
}
function applyAuth(user, pass){
  S.user = user;
  S.auth = "Basic " + b64e(user + ":" + pass);
}
function showApp(){
  hideBoot();
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  var initial = (S.user || "A").slice(0, 1).toUpperCase();
  $("btnUser").textContent = initial;
  $("btnUser").title = S.user + " · 点击退出";
  navigate("/", false);
  /* 进来先取一次容量，顶栏不会空着 */
  QP = null;
  loadQuota(true);
}
function logout(msg){
  try {
    sessionStorage.removeItem("dav.auth");
    localStorage.removeItem("dav.auth");
    localStorage.removeItem("dav.user");
  } catch(e){}
  S.auth = ""; S.items = []; S.sel = {}; S.path = "/";
  hideBoot();
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("p").value = "";
  setPwVisible(false, true);
  if(msg){ $("loginErr").textContent = msg; $("loginErr").classList.remove("hidden"); }
}

async function doLogin(user, pass, remember){
  var btn = $("loginBtn");
  btn.disabled = true; btn.textContent = "登录中…";
  $("loginErr").classList.add("hidden");
  var prevAuth = S.auth;
  applyAuth(user, pass);
  try {
    var r = await req("PROPFIND", "/", { headers: { Depth: "0" }, body: PROPFIND_BODY });
    if(r.status === 401) throw new Error("用户名或密码不正确");
    if(!r.ok && r.status !== 207) throw new Error("服务返回 " + r.status);
    var rec = { auth: S.auth, user: user };
    try {
      if(remember) localStorage.setItem("dav.auth", JSON.stringify(rec));
      else sessionStorage.setItem("dav.auth", JSON.stringify(rec));
      localStorage.setItem("dav.user", user);
    } catch(e){}
    showApp();
  } catch(e){
    S.auth = prevAuth;
    $("loginErr").textContent = e.message || "登录失败";
    $("loginErr").classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = "登录";
  }
}

/* ================= 事件绑定 ================= */
function bindGlobal(){
  bindShares();
  if($("quota")) $("quota").addEventListener("click", quotaTip);
  $("loginForm").addEventListener("submit", function(e){
    e.preventDefault();
    var u = $("u").value.trim();
    var p = $("p").value;
    if(!u){ $("loginErr").textContent = "请输入用户名"; $("loginErr").classList.remove("hidden"); $("u").focus(); return; }
    if(!p){ $("loginErr").textContent = "请输入密码"; $("loginErr").classList.remove("hidden"); $("p").focus(); return; }
    doLogin(u, p, $("remember").classList.contains("on"));
  });

  $("pwToggle").onclick = function(){ setPwVisible($("p").type === "password"); };

  $("btnUpload").onclick = function(){ $("fileInput").click(); };
  $("fileInput").onchange = function(e){ enqueue(e.target.files); e.target.value = ""; };
  $("btnMkdir").onclick = makeDir;
  $("btnNewFile").onclick = newFile;
  $("btnShare").onclick = function(){
    var ps = selectedPaths();
    if(ps.length !== 1){ toast("请选择单个文件或文件夹", "info"); return; }
    openShare(ps[0]);
  };
  $("btnDel").onclick = function(){ deleteItems(selectedPaths()); };
  $("btnDl").onclick = function(){
    var ps = selectedPaths();
    ps.forEach(function(p, i){ setTimeout(function(){ download(p); }, i * 400); });
  };
  $("btnRefresh").onclick = function(){ load(); toast("已刷新", "info"); };
  $("btnUp").onclick = function(){ if(S.path !== "/") navigate(parentOf(S.path), true); };
  $("btnUser").onclick = async function(){
    var ok = await confirmBox("退出登录", "将清除本机保存的登录凭据。", "退出");
    if(ok) logout();
  };
  $("btnViewList").onclick = function(){ S.view = "list"; localStorage.setItem("dav.view", "list"); render(); };
  $("btnViewGrid").onclick = function(){ S.view = "grid"; localStorage.setItem("dav.view", "grid"); render(); };
  $("btnTheme").onclick = function(){
    var cur = document.documentElement.getAttribute("data-theme") || "auto";
    var dark = matchMedia("(prefers-color-scheme: dark)").matches;
    var next;
    if(cur === "auto") next = dark ? "light" : "dark";
    else if(cur === "dark") next = "light";
    else next = "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("dav.theme", next);
  };
  $("remember").onclick = function(){ $("remember").classList.toggle("on"); };

  $("q").addEventListener("input", function(e){
    S.q = e.target.value.trim();
    $("qClr").classList.toggle("hidden", !S.q);
    render();
  });
  $("qClr").onclick = function(){ $("q").value = ""; S.q = ""; $("qClr").classList.add("hidden"); render(); };

  $("pvClose").onclick = closePreview;
  $("pvPrev").onclick = function(){ pvStep(-1); };
  $("pvNext").onclick = function(){ pvStep(1); };
  $("preview").addEventListener("click", function(e){
    /* 双击文件时第二次点击会落在刚弹出来的遮罩上，400ms 内不响应，避免开了又立刻关掉 */
    if(Date.now() - (PV.openedAt || 0) < 400) return;
    if(e.target === $("preview") || e.target === $("pvBody")) closePreview();
  });

  /* 手机上没有箭头，左右滑动切换上一个 / 下一个 */
  var pvSx = 0, pvSy = 0, pvMoved = false;
  $("pvBody").addEventListener("touchstart", function(e){
    var t = e.touches[0];
    if(!t) return;
    pvSx = t.clientX; pvSy = t.clientY; pvMoved = false;
  }, { passive: true });
  $("pvBody").addEventListener("touchmove", function(){ pvMoved = true; }, { passive: true });
  $("pvBody").addEventListener("touchend", function(e){
    if(!pvMoved) return;
    var t = e.changedTouches[0];
    if(!t) return;
    if(e.target.closest(".pv-tblwrap") || e.target.closest(".pv-code")) return;
    var dx = t.clientX - pvSx, dy = t.clientY - pvSy;
    if(Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) pvStep(dx > 0 ? -1 : 1);
  }, { passive: true });

  $("edCancel").onclick = closeEditor;
  $("edSave").onclick = saveEditor;
  $("edText").addEventListener("input", function(){
    $("edStatus").textContent = $("edText").value.length + " 字符 · 未保存";
  });

  $("upClose").onclick = resetQueue;

  /* 拖放 */
  var dragDepth = 0;
  document.addEventListener("dragenter", function(e){
    if(!S.auth) return;
    if(!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, "Files") < 0) return;
    dragDepth++;
    $("dropHint").textContent = "目标文件夹：" + (S.path === "/" ? "根目录" : S.path);
    $("drop").classList.add("on");
  });
  document.addEventListener("dragover", function(e){ e.preventDefault(); });
  document.addEventListener("dragleave", function(e){
    dragDepth = Math.max(0, dragDepth - 1);
    if(dragDepth === 0) $("drop").classList.remove("on");
  });
  document.addEventListener("drop", function(e){
    e.preventDefault();
    dragDepth = 0;
    $("drop").classList.remove("on");
    if(!S.auth) return;
    if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
      enqueue(e.dataTransfer.files);
    }
  });

  /* 键盘 */
  document.addEventListener("keydown", function(e){
    var inField = /INPUT|TEXTAREA/.test((e.target.tagName || "")) || e.target.isContentEditable;
    if(e.key === "Escape"){
      if(!$("editor").classList.contains("hidden")){ closeEditor(); return; }
      if(!$("preview").classList.contains("hidden")){ closePreview(); return; }
      closeCtx(); closeDialog();
      return;
    }
    if($("editor").classList.contains("hidden") === false){
      if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s"){ e.preventDefault(); saveEditor(); }
      return;
    }
    if(!$("preview").classList.contains("hidden")){
      if(e.key === "ArrowLeft"){ e.preventDefault(); pvStep(-1); }
      else if(e.key === "ArrowRight"){ e.preventDefault(); pvStep(1); }
      return;
    }
    if(inField) return;
    if(!S.auth) return;

    if(e.key === "Delete"){ if(selectedPaths().length) { e.preventDefault(); deleteItems(selectedPaths()); } }
    else if(e.key === "F2"){
      var one = selectedPaths();
      if(one.length === 1){ e.preventDefault(); renameItem(one[0]); }
    }
    else if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a"){
      e.preventDefault();
      S.sel = {};
      visibleItems().forEach(function(it){ S.sel[it.path] = true; });
      render();
    }
    else if(e.key === "Backspace" && S.path !== "/"){
      e.preventDefault(); navigate(parentOf(S.path), true);
    }
    else if(e.key === "Enter"){
      var sel = selectedPaths();
      if(sel.length === 1){ e.preventDefault(); openItem(sel[0]); }
    }
  });

  document.addEventListener("click", function(e){
    if(ctxEl && !ctxEl.contains(e.target)) closeCtx();
  });
  window.addEventListener("beforeunload", function(e){
    var running = Q.some(function(t){ return t.status === "run" || t.status === "wait"; });
    if(running){ e.preventDefault(); e.returnValue = ""; }
  });
}

/* ================= 密码可见切换 ================= */
function setPwVisible(on, silent){
  var p = $("p"), btn = $("pwToggle");
  if(!p || !btn) return;
  p.type = on ? "text" : "password";
  btn.classList.toggle("on", !!on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.title = on ? "隐藏密码" : "显示密码";
  btn.setAttribute("aria-label", on ? "隐藏密码" : "显示密码");
  var a = $("pwEyeOpen"), b = $("pwEyeOff");
  if(a) a.classList.toggle("hidden", !!on);
  if(b) b.classList.toggle("hidden", !on);
  if(!silent){
    try { p.focus({ preventScroll: true }); p.setSelectionRange(p.value.length, p.value.length); }
    catch(e){ try { p.focus(); } catch(_){} }
  }
}

/* ================= 启动 ================= */
/** 不预填任何账号/密码，也不缓存上次输入 —— 全部留空由用户自己填 */
function presetUserInput(){
  var u = $("u"), p = $("p");
  if(u){ u.value = ""; u.placeholder = "请输入用户名"; }
  if(p){ p.value = ""; p.placeholder = "请输入密码"; }
  setPwVisible(false, true);
}


/* 启动遮罩在「进主界面」或「显示登录页」时收起；两个入口都调它，确保不会卡住 */
var bootClosed = false;
function hideBoot(){
  if(bootClosed) return;
  bootClosed = true;
  var b = $("boot");
  if(!b) return;
  b.classList.add("out");
  setTimeout(function(){ b.classList.add("hidden"); }, 200);
}

function boot(){
  var initAuth = ${JSON.stringify(initAuth)};
  bindGlobal();

  /** 该分支不自动登录：露出登录页 */
  function enterLogin(){
    $("login").classList.remove("hidden");
    presetUserInput();
    hideBoot();
    setTimeout(function(){ ($("u").value ? $("p") : $("u")).focus(); }, 120);
  }

  if(!initAuth){
    /* 登录页：清掉浏览器密码管理器/自动填充硬塞进来的值。
       用户自己敲过键盘（input 事件）后就永久停止清理，不会吞掉输入。 */
    var afTouched = false;
    ["u","p"].forEach(function(id){
      var el = $(id);
      if(el) el.addEventListener("input", function(){ afTouched = true; });
    });
    var purgeAutofill = function(){
      if(afTouched) return;
      var changed = false;
      ["u","p"].forEach(function(id){
        var el = $(id);
        if(el && el.value){ el.value = ""; changed = true; }
      });
      if(changed) setPwVisible(false, true);
    };
    [60, 320, 900, 1800, 3200, 6000].forEach(function(t){ setTimeout(purgeAutofill, t); });
  }

  if(initAuth){
    applyAuth(DEFAULT_USER, "");
    S.auth = "Basic " + initAuth;
    // 校验注入的凭据是否真的可用，避免白屏
    req("PROPFIND", "/", { headers: { Depth: "0" }, body: PROPFIND_BODY })
      .then(function(r){
        if(r.ok || r.status === 207){
          try {
            var dec = atob(initAuth);
            S.user = dec.slice(0, dec.indexOf(":"));
            sessionStorage.setItem("dav.auth", JSON.stringify({ auth: S.auth, user: S.user }));
          } catch(e){}
          showApp();
        } else {
          try { sessionStorage.removeItem("dav.auth"); } catch(e){}
          S.auth = "";
          enterLogin();
        }
      })
      .catch(function(){ S.auth = ""; enterLogin(); });
    return;
  }

  var saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("dav.auth") || "null"); } catch(e){}
  if(!saved){ try { saved = JSON.parse(localStorage.getItem("dav.auth") || "null"); } catch(e){} }
  if(saved && saved.auth && saved.user && saved.user !== DEFAULT_USER){
    // 服务端用户名已改，旧凭据必然失效，直接丢弃避免一次无谓的 401
    try { sessionStorage.removeItem("dav.auth"); localStorage.removeItem("dav.auth"); } catch(e){}
    saved = null;
  }
  if(saved && saved.auth){
    S.auth = saved.auth; S.user = saved.user || DEFAULT_USER;
    // 校验期间不露登录页：遮罩一直盖着，成功直接进主界面
    req("PROPFIND", "/", { headers: { Depth: "0" }, body: PROPFIND_BODY })
      .then(function(r){
        if(r.ok || r.status === 207) showApp();
        else {
          try { sessionStorage.removeItem("dav.auth"); localStorage.removeItem("dav.auth"); } catch(e){}
          S.auth = "";
          enterLogin();
        }
      })
      .catch(function(){ S.auth = ""; enterLogin(); });
  } else {
    enterLogin();
  }
}

/* 兜底：万一启动逻辑本身抛异常，别把整页卡在遮罩上 */
try { boot(); } catch(err){
  var bEl = document.getElementById("boot");
  var lEl = document.getElementById("login");
  if(bEl) bEl.classList.add("hidden");
  if(lEl){
    lEl.classList.remove("hidden");
    var eEl = document.getElementById("loginErr");
    if(eEl){ eEl.textContent = "页面初始化失败，请刷新重试"; eEl.classList.remove("hidden"); }
  }
}
})();
</script>
</body>
</html>`;
}
