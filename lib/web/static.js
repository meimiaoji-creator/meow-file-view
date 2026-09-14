/**
 * meow-file-view 查看器页面 —— HTML 壳（页面 CSS/JS 拆到 static/viewer.css + static/viewer.js）。
 *
 * 左侧目录树（懒加载，逐层展开）+ 右侧查看器：
 *   - md：源码 / 预览 / 编辑 三态；预览 = marked → DOMPurify → highlight.js → mermaid → github 主题；
 *     附 TOC 目录栏（scrollspy）、mermaid 点击缩放 lightbox、内嵌图片相对路径改写（raw 端点直出）
 *   - code：highlight.js 只读高亮（按 lang，缺失回退 highlightAuto）
 *   - text：等宽原文
 *   - image：/api/meow-file-view/raw 端点直出 <img>（png/jpg/jpeg/gif/webp/bmp/ico）
 * 明暗主题跟随（localStorage 记忆）；数据全部经 `/api/meow-file-view/*` 同源 fetch。
 *
 * 结构说明（2026-09 拆分）：页面 CSS 在 `static/viewer.css`、JS 在 `static/viewer.js`，
 * 是普通静态文件，由 routes.ts 的 static 路由磁盘直出（build.bat [4/6] 整目录 xcopy static，
 * 新增文件自动进 dist）。拆出后本文件回归纯 HTML 壳，不再有「内嵌 JS 禁反引号/${}」约束
 * （该约束只对 TS 模板字面量里的内嵌 JS 有意义，viewer.js/vewer.css 无此限制）。
 * md-viewer lib（marked/highlight/purify/mermaid + github 双 css）照旧经 <script>/<link> 加载，
 * 跑在 iframe 自己的 window（独立浏览上下文），与 dsh 主 SPA 零共享。
 */
export const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>文件查看</title>
<link rel="stylesheet" href="/meow-file-view/static/github.min.css" id="hljs-light">
<link rel="stylesheet" href="/meow-file-view/static/github-dark.min.css" id="hljs-dark" disabled>
<link rel="stylesheet" href="/meow-file-view/static/viewer.css">
<script src="/meow-file-view/static/marked.min.js"></script>
<script src="/meow-file-view/static/highlight.min.js"></script>
<script src="/meow-file-view/static/purify.min.js"></script>
<script src="/meow-file-view/static/mermaid.min.js"></script>
</head>
<body>
<header>
  <div class="head-left">
    <span class="title">文件查看</span>
    <span id="rootBadge" class="badge hidden" title="树根"></span>
    <span id="pathBadge" class="badge hidden" title="当前工作区"></span>
  </div>
  <div class="head-right">
    <button id="themeBtn" type="button" class="btn">🌙 暗色</button>
    <button id="refreshBtn" type="button" class="btn">刷新</button>
  </div>
</header>
<div class="layout">
  <aside class="tree-pane">
    <div class="tree-head">目录（点击目录展开，点击文件查看）</div>
    <div id="tree"></div>
  </aside>
  <main class="content">
    <div id="viewerToolbar" class="viewer-toolbar hidden">
      <span id="fileName" class="file-name"></span>
      <div class="toolbar-actions">
        <button id="copyPathBtn" type="button" class="btn small" title="复制绝对路径">复制路径</button>
        <button id="copyContentBtn" type="button" class="btn small" title="复制文本内容">复制内容</button>
        <button id="editBtn" type="button" class="btn small hidden" title="编辑此 md 文件">编辑</button>
        <button id="saveBtn" type="button" class="btn small primary hidden" title="保存（Ctrl+S）">保存</button>
        <button id="cancelEditBtn" type="button" class="btn small hidden" title="放弃修改并返回预览">取消</button>
        <button id="toggleSource" type="button" class="btn small hidden">源码</button>
        <button id="tocToggle" type="button" class="btn small hidden" title="显示/隐藏目录栏">目录</button>
      </div>
    </div>
    <div class="content-body">
      <div id="viewer" class="viewer"><div class="empty">请在左侧选择文件</div></div>
      <aside id="tocPane" class="toc-pane hidden">
        <div class="toc-head">目录</div>
        <div id="tocTree" class="toc-tree"></div>
      </aside>
    </div>
  </main>
</div>
<div id="lightbox" class="lightbox hidden">
  <button id="lightboxClose" type="button" class="lightbox-close" title="关闭（Esc）">×</button>
  <div id="lightboxStage" class="lightbox-stage"></div>
  <div class="lightbox-hint">滚轮缩放 · 拖拽平移 · 双击复位 · Esc 关闭</div>
</div>
<div id="flash" class="flash"></div>
<script src="/meow-file-view/static/viewer.js"></script>
</body>
</html>
`;
