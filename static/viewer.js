/**
 * meow-file-view 查看器页面脚本（static.ts HTML 壳引用；普通静态文件，无内嵌转义约束）。
 *
 * 功能（2026-09 扩展后）：
 *   - 目录树懒加载（md/code/text/image 图标区分）
 *   - md：源码 / 预览 / 编辑 三态
 *       预览 = marked → DOMPurify → highlight.js → mermaid → github 主题
 *       + TOC 目录栏（marked v11 无 headerIds，自定义 heading renderer 生成 slug id）
 *       + scrollspy（IntersectionObserver，root = 滚动容器 .viewer）
 *       + mermaid 点击缩放 lightbox（克隆 svg，滚轮缩放 / 拖拽平移 / 双击复位 / Esc 关闭）
 *       + 内嵌图片相对路径改写（按 md 所在目录解析 → /api/meow-file-view/raw 端点）
 *       + 编辑（textarea，Ctrl+S 保存、Tab 两空格；脏状态守卫；truncated 禁编辑防丢尾部数据）
 *   - image：raw 端点直出 <img>（树点击查看）
 *   - code / text：highlight.js 高亮 / 等宽原文
 * 明暗主题跟随（localStorage 记忆）；数据全部经 /api/meow-file-view/* 同源 fetch。
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var workspace = params.get('workspace');
  // 产物联动：chat 产物 chips → 面板 iframe 带 ?path=（树根内 rel）进入，初始化直达该文件。
  var initialPath = params.get('path');
  // Diff 联动：产物 chips 的 Diff 按钮 → &mode=diff，文件内容就绪后切差异视图。
  var initialDiff = params.get('mode') === 'diff';
  var pendingDiff = false;
  var THEME_KEY = 'meow-file-view-theme';
  var TOC_KEY = 'meow-file-view-toc';
  var currentTheme = localStorage.getItem(THEME_KEY) || 'light';

  // ---------- DOM 引用 ----------
  var treeRoot = document.getElementById('tree');
  var viewer = document.getElementById('viewer');
  var toolbar = document.getElementById('viewerToolbar');
  var fileNameEl = document.getElementById('fileName');
  var toggleSourceBtn = document.getElementById('toggleSource');
  var editBtn = document.getElementById('editBtn');
  var saveBtn = document.getElementById('saveBtn');
  var cancelEditBtn = document.getElementById('cancelEditBtn');
  var tocToggleBtn = document.getElementById('tocToggle');
  var copyPathBtn = document.getElementById('copyPathBtn');
  var copyContentBtn = document.getElementById('copyContentBtn');
  var tocPane = document.getElementById('tocPane');
  var tocTree = document.getElementById('tocTree');
  var rootBadge = document.getElementById('rootBadge');
  var pathBadge = document.getElementById('pathBadge');
  var lightbox = document.getElementById('lightbox');
  var lightboxStage = document.getElementById('lightboxStage');

  // ---------- 当前文件状态 ----------
  var currentPath = null;    // 相对树根的路径（也可能是 md 内嵌图片改写场景下的绝对路径，仅 raw 用）
  var currentRoot = null;    // 树根绝对路径（服务端返回）
  var currentAbsPath = null; // 当前文件绝对路径（服务端返回）
  var currentKind = null;    // 'md' | 'code' | 'text' | 'image'
  var currentLang = null;
  var currentText = '';
  var currentTotalSize = 0;  // 文件真实字节数（截断时前端提示用）
  var currentTruncated = false;
  var currentEditAllowed = false;
  var isSource = false;      // md：true = 源码视图
  var isEditing = false;     // md：编辑态
  var isDirty = false;       // 编辑态下有未保存修改
  var editorEl = null;       // 编辑态 textarea
  var tocVisible = localStorage.getItem(TOC_KEY) !== '0'; // 目录栏默认展开
  var tocItems = [];         // 当前 md 的标题集合 [{level,text,id,_el}]
  var slugCounts = {};       // slug 去重计数（每次渲染重置）
  var spyRaf = 0;            // scrollspy rAF 节流句柄

  // ---------- 工具函数 ----------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function extOf(name) {
    var i = String(name).lastIndexOf('.');
    if (i <= 0 || i === name.length - 1) return '';
    return name.slice(i + 1).toLowerCase();
  }

  var IMAGE_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, ico: 1 };

  // ---------- 剪贴板 + 提示 ----------
  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
  }

  function legacyCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
    done();
  }

  var flashTimer = null;
  function flash(msg) {
    var f = document.getElementById('flash');
    f.textContent = msg;
    f.classList.add('show');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.classList.remove('show'); }, 2200);
  }

  // ---------- API ----------
  function apiUrl(path) {
    var url = path;
    if (workspace) {
      url = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'workspace=' + encodeURIComponent(workspace);
    }
    return url;
  }

  function api(path) {
    return fetch(apiUrl(path)).then(function (r) {
      return r.json();
    }).then(function (data) {
      if (data && data.error) throw new Error(data.error);
      return data;
    });
  }

  function apiPost(path, payload) {
    return fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json();
    }).then(function (data) {
      if (data && data.error) throw new Error(data.error);
      return data;
    });
  }

  // ---------- 主题 ----------
  function applyTheme(theme) {
    currentTheme = theme;
    document.body.setAttribute('data-theme', theme);
    document.getElementById('hljs-light').disabled = theme !== 'light';
    document.getElementById('hljs-dark').disabled = theme !== 'dark';
    document.getElementById('themeBtn').textContent = theme === 'dark' ? '☀ 亮色' : '🌙 暗色';
    localStorage.setItem(THEME_KEY, theme);
  }
  document.getElementById('themeBtn').addEventListener('click', function () {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  // ---------- marked 渲染（mermaid 块 + 代码高亮 + 标题 id/TOC 收集） ----------
  // marked v11 已无 headerIds：heading 里自己生成 slug id 并收集 TOC 条目。
  function resetTocCollect() {
    slugCounts = {};
    tocItems = [];
  }

  function slugify(text) {
    var s = String(text).trim().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '');
    if (!s) s = 'section';
    var n = slugCounts[s] || 0;
    slugCounts[s] = n + 1;
    return n ? s + '-' + n : s;
  }

  var mdRenderer = new marked.Renderer();
  mdRenderer.code = function (code, lang) {
    if (lang && lang.toLowerCase() === 'mermaid') {
      return '<div class="mermaid">' + escapeHtml(code) + '</div>';
    }
    var highlighted;
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(code, { language: lang }).value;
      } else {
        highlighted = hljs.highlightAuto(code).value;
      }
    } catch (e) {
      highlighted = escapeHtml(code);
    }
    return '<pre><code class="hljs">' + highlighted + '</code></pre>';
  };
  mdRenderer.heading = function (text, level) {
    var plain = String(text).replace(/<[^>]*>/g, '');
    var id = slugify(plain);
    tocItems.push({ level: level, text: plain, id: id, _el: null });
    return '<h' + level + ' id="' + escapeHtml(id) + '">' + text + '</h' + level + '>\n';
  };
  marked.setOptions({ renderer: mdRenderer, gfm: true, breaks: true });

  // ---------- 目录树（懒加载） ----------
  function joinRel(base, name) {
    return base ? base + '/' + name : name;
  }

  function fileIcon(name) {
    return IMAGE_EXTS[extOf(name)] ? '🖼️' : '📄';
  }

  function renderEntries(container, relDir, entries) {
    container.textContent = '';
    if (!entries || !entries.length) {
      container.appendChild(el('div', { class: 'muted', text: '空目录' }));
      return;
    }
    entries.forEach(function (entry) {
      if (entry.type === 'dir') container.appendChild(makeDirRow(relDir, entry.name));
      else container.appendChild(makeFileRow(relDir, entry.name));
    });
  }

  function makeDirRow(relDir, name) {
    var rel = joinRel(relDir, name);
    var row = el('div', { class: 'tree-row dir' });
    var head = el('div', { class: 'tree-row-head' });
    var arrow = el('span', { class: 'arrow', text: '▸' });
    var label = el('span', { class: 'label', text: name });
    var child = el('div', { class: 'children' });
    head.appendChild(arrow);
    head.appendChild(label);
    row.appendChild(head);
    row.appendChild(child);
    // 监听挂在头上（头与子容器是兄弟，点击子节点不会冒泡触发父目录 toggle）
    head.addEventListener('click', function () {
      var open = row.classList.contains('open');
      if (open) {
        row.classList.remove('open');
        arrow.textContent = '▸';
        return;
      }
      row.classList.add('open');
      arrow.textContent = '▾';
      if (!row._loaded) {
        row._loaded = true;
        child.textContent = '';
        child.appendChild(el('div', { class: 'muted', text: '加载中…' }));
        api('/api/meow-file-view/tree?path=' + encodeURIComponent(rel))
          .then(function (data) { renderEntries(child, rel, data.entries); })
          .catch(function (err) {
            child.textContent = '';
            child.appendChild(el('div', { class: 'muted', text: '加载失败: ' + err.message }));
          });
      }
    });
    return row;
  }

  function makeFileRow(relDir, name) {
    var rel = joinRel(relDir, name);
    var row = el('div', { class: 'tree-row file' });
    var head = el('div', { class: 'tree-row-head' });
    head.appendChild(el('span', { class: 'file-icon', text: fileIcon(name) }));
    head.appendChild(el('span', { class: 'label', text: name }));
    row.appendChild(head);
    head.addEventListener('click', function () {
      if (!confirmDiscard()) return; // 编辑中未保存 → 先确认
      openFile(rel, row);
    });
    return row;
  }

  // ---------- 脏状态守卫（编辑态切文件 / 刷新 / 取消前确认） ----------
  function confirmDiscard() {
    if (isEditing && isDirty) {
      return window.confirm('当前文件有未保存的修改，确定放弃并离开？');
    }
    return true;
  }

  /** 无条件退出编辑态（已在别处确认过；viewer 随后会被重绘）。 */
  function forceExitEdit() {
    isEditing = false;
    isDirty = false;
    editorEl = null;
    updateToolbar();
  }

  // ---------- 文件内容 ----------
  function openFile(rel, row) {
    currentPath = rel;
    treeRoot.querySelectorAll('.tree-row.active').forEach(function (r) {
      r.classList.remove('active');
    });
    if (row) row.classList.add('active');
    loadContent(rel);
  }

  function loadContent(rel) {
    forceExitEdit();
    isSource = false;
    toggleSourceBtn.classList.add('hidden');
    viewer.textContent = '';
    viewer.appendChild(el('div', { class: 'muted', text: '加载中…' }));
    // 图片不走 /content（readText 对二进制抛 415，图片分支永远到不了前端）——按扩展名直接 raw 渲染
    if (IMAGE_EXTS[extOf(rel)]) {
      renderImageEntry(rel);
      return;
    }
    api('/api/meow-file-view/content?path=' + encodeURIComponent(rel))
      .then(renderContent)
      .catch(function (err) {
        viewer.textContent = '';
        viewer.appendChild(el('div', { class: 'error', text: '加载失败: ' + err.message }));
      });
  }

  /** 树点击图片入口：不需要服务端元数据（raw URL 自含 path+workspace），直接渲染。 */
  function renderImageEntry(rel) {
    currentKind = 'image';
    currentText = '';
    currentAbsPath = null; // 图片无 content 响应，复制路径按钮随 currentAbsPath 隐藏
    currentTotalSize = 0;
    currentTruncated = false;
    fileNameEl.textContent = rel;
    fileNameEl.title = rel;
    toolbar.classList.remove('hidden');
    viewer.textContent = '';
    renderImage();
    updateToolbar();
  }

  function renderContent(data) {
    currentRoot = data.root || null;
    currentAbsPath = data.absPath || null;
    currentKind = data.type;
    currentLang = data.lang || null;
    currentText = data.content || '';
    currentTotalSize = data.size || 0;
    currentTruncated = !!data.truncated;
    currentEditAllowed = data.editAllowed !== false;
    fileNameEl.textContent = currentPath;
    fileNameEl.title = currentAbsPath || currentPath;
    toolbar.classList.remove('hidden');
    viewer.textContent = '';
    if (currentKind === 'md') {
      renderCurrent();
    } else if (currentKind === 'image') {
      renderImage();
    } else if (currentKind === 'code') {
      renderCode(currentText, currentLang);
    } else {
      renderText(currentText);
    }
    updateToolbar();
    // 产物 Diff 联动：?mode=diff 打开的文件，内容就绪后切差异视图（一次性消费）
    if (pendingDiff) {
      pendingDiff = false;
      renderDiffView();
    }
  }

  // ---------- Diff 视图（vs HEAD；产物 Diff 按钮 → &mode=diff 进入） ----------
  function diffLineClass(line) {
    if (line.indexOf('diff --git') === 0 || line.indexOf('index ') === 0
      || line.indexOf('--- ') === 0 || line.indexOf('+++ ') === 0) return 'meta';
    if (line.indexOf('@@') === 0) return 'hunk';
    if (line.indexOf('+') === 0) return 'add';
    if (line.indexOf('-') === 0) return 'del';
    return 'ctx';
  }

  /** unified diff / 全文新增 文本 → 着色行盒。 */
  function renderDiffText(text) {
    var lines = text.split('\n');
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    var box = el('div', { class: 'diff-code' });
    if (lines.length === 0) {
      box.appendChild(el('div', { class: 'dl ctx', text: '（空）' }));
    }
    lines.forEach(function (line) {
      box.appendChild(el('div', { class: 'dl ' + diffLineClass(line), text: line === '' ? ' ' : line }));
    });
    return box;
  }

  function renderDiffBody(children) {
    forceExitEdit();
    isSource = false;
    viewer.textContent = '';
    children.forEach(function (c) { viewer.appendChild(c); });
    viewer.scrollTop = 0;
    var link = viewer.querySelector('.diff-back');
    if (link) {
      link.addEventListener('click', function () {
        if (confirmDiscard()) loadContent(currentPath);
      });
    }
  }

  /** 拉取 /git/diff 并渲染；untracked = 全文新增（不调 --no-index，不动暂存区）。 */
  function renderDiffView() {
    if (currentKind === 'image') { flash('图片暂不支持 diff'); return; }
    if (!currentPath) return;
    api('/api/meow-file-view/git/diff?path=' + encodeURIComponent(currentPath))
      .then(function (data) {
        if (data.state === 'unchanged') { flash('与 git 最近提交（HEAD）无差异'); return; }
        if (data.state === 'untracked') {
          renderDiffBody([
            el('div', { class: 'diff-banner' }, [
              el('span', { text: 'Diff · 新文件（未跟踪，无 HEAD 基线）· ' }),
              el('a', { class: 'diff-back', text: '返回文件视图' }),
            ]),
            renderDiffText(currentText),
          ]);
          return;
        }
        if (data.state === 'changed' && typeof data.diff === 'string') {
          renderDiffBody([
            el('div', { class: 'diff-banner' }, [
              el('span', { text: 'Diff · 工作区 vs HEAD' + (data.truncated ? '（内容已截断）' : '') + ' · ' }),
              el('a', { class: 'diff-back', text: '返回文件视图' }),
            ]),
            renderDiffText(data.diff),
          ]);
          return;
        }
        flash('无法获取 diff：' + (data.state || '未知状态'));
      })
      .catch(function (err) {
        flash('diff 加载失败: ' + err.message);
      });
  }

  /** 截断提示（各渲染函数清空 viewer 后调用；顺带说明截断文件不可编辑）。 */
  function appendTruncationBanner() {
    if (!currentTruncated) return;
    viewer.appendChild(el('div', {
      class: 'banner',
      text: '文件较大（共 ' + fmtSize(currentTotalSize) + ' 字节），内容已截断，仅显示开头部分；截断文件不支持编辑',
    }));
  }

  /** 工具栏按钮可见性集中管理（随 kind / 视图态 / 编辑态变化）。 */
  function updateToolbar() {
    var isMd = currentKind === 'md';
    toggleSourceBtn.classList.toggle('hidden', !(isMd && !isEditing));
    toggleSourceBtn.textContent = isSource ? '预览' : '源码';
    // truncated 禁编辑：截断视图下保存会把未读入的尾部写丢
    var canEdit = isMd && currentEditAllowed && !currentTruncated && !isEditing;
    editBtn.classList.toggle('hidden', !canEdit);
    editBtn.title = (isMd && currentTruncated)
      ? '文件超过读取上限被截断，编辑保存会丢失未显示部分，故不支持编辑'
      : '编辑此 md 文件';
    saveBtn.classList.toggle('hidden', !isEditing);
    cancelEditBtn.classList.toggle('hidden', !isEditing);
    copyContentBtn.classList.toggle('hidden', isEditing || currentKind === 'image');
    copyPathBtn.classList.toggle('hidden', !currentAbsPath);
    tocToggleBtn.classList.toggle('hidden', !(isMd && !isEditing && tocItems.length > 0));
    updateTocToggleLabel();
  }

  function renderCurrent() {
    if (currentKind === 'md') {
      if (isSource) renderMdSource(currentText);
      else renderMdPreview(currentText);
    } else if (currentKind === 'image') {
      renderImage();
    } else if (currentKind === 'code') {
      renderCode(currentText, currentLang);
    } else {
      renderText(currentText);
    }
  }

  // ---------- 图片预览（raw 端点直出） ----------
  function rawImageUrl(rawSrc) {
    var src = String(rawSrc || '').trim();
    if (!src) return null;
    // 外链 / 内联数据直接放行
    if (/^(https?:|data:|blob:)/i.test(src) || src.indexOf('//') === 0) return src;
    var decoded = src;
    try { decoded = decodeURIComponent(src); } catch (e) { /* 保留原样 */ }
    if (/^file:/i.test(decoded)) {
      decoded = decoded.replace(/^file:\/\/\/?/i, '');
      decoded = decoded.replace(/^\/([A-Za-z]:\/)/, '$1'); // file:///E:/x → E:/x
    }
    decoded = decoded.replace(/\\/g, '/');
    var isAbs = /^([A-Za-z]:\/|\/\/|\/)/.test(decoded);
    var relPath = isAbs ? decoded : resolveRelPath(mdBaseDir(), decoded);
    if (!relPath) return null;
    return apiUrl('/api/meow-file-view/raw?path=' + encodeURIComponent(relPath));
  }

  /** md 内嵌图片的基准目录（当前 md 所在的相对目录）。 */
  function mdBaseDir() {
    if (!currentPath) return '';
    var i = currentPath.lastIndexOf('/');
    return i >= 0 ? currentPath.slice(0, i) : '';
  }

  /** 相对路径解析（处理 ./ 与 ../），返回规范化相对路径。 */
  function resolveRelPath(base, rel) {
    var parts = (base ? base.split('/') : []).concat(String(rel).split('/'));
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p || p === '.') continue;
      if (p === '..') { out.pop(); continue; }
      out.push(p);
    }
    return out.join('/');
  }

  /** md 预览内嵌图片：相对路径改写为 raw 端点 URL；失败时占位提示。 */
  function rewriteMdImages(container) {
    var imgs = container.querySelectorAll('article img');
    Array.prototype.forEach.call(imgs, function (img) {
      var url = rawImageUrl(img.getAttribute('src'));
      if (!url) return;
      img.addEventListener('error', function () {
        var tip = el('span', { class: 'muted', text: '（图片加载失败: ' + (img.getAttribute('src') || '') + '）' });
        if (img.parentNode) img.parentNode.replaceChild(tip, img);
      });
      img.setAttribute('src', url);
    });
  }

  function renderImage() {
    viewer.textContent = '';
    appendTruncationBanner();
    var wrap = el('div', { class: 'image-wrap' });
    var caption = el('div', { class: 'image-caption muted', text: '加载中…' });
    var img = el('img', { alt: currentPath || '' });
    img.addEventListener('error', function () {
      wrap.textContent = '';
      wrap.appendChild(el('div', { class: 'error', text: '图片加载失败（可能超出大小上限或类型不支持）: ' + currentPath }));
    });
    img.addEventListener('load', function () {
      caption.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
    });
    wrap.appendChild(img);
    wrap.appendChild(caption);
    viewer.appendChild(wrap);
    img.src = apiUrl('/api/meow-file-view/raw?path=' + encodeURIComponent(currentPath));
  }

  // ---------- md 预览（渲染管线 + 图片改写 + TOC + mermaid） ----------
  function renderMdPreview(text) {
    viewer.textContent = '';
    appendTruncationBanner();
    resetTocCollect();
    var container = el('div', { class: 'md-wrap' });
    viewer.appendChild(container);
    var raw;
    try {
      raw = marked.parse(text);
    } catch (e) {
      container.appendChild(el('pre', { class: 'source', text: text }));
      hideToc();
      updateToolbar();
      return;
    }
    var safe = DOMPurify.sanitize(raw, { ADD_TAGS: ['foreignObject'], ADD_ATTR: ['class', 'id'] });
    container.innerHTML = '<article class="markdown-body">' + safe + '</article>';
    rewriteMdImages(container);
    renderToc();
    runMermaid(container);
    updateToolbar();
  }

  function renderMdSource(text) {
    hideToc();
    viewer.textContent = '';
    appendTruncationBanner();
    viewer.appendChild(el('pre', { class: 'source', text: text }));
  }

  function renderCode(text, lang) {
    hideToc();
    viewer.textContent = '';
    appendTruncationBanner();
    var pre = el('pre', { class: 'code-view' });
    var codeEl = el('code');
    codeEl.className = 'hljs';
    try {
      if (lang && hljs.getLanguage(lang)) {
        codeEl.innerHTML = hljs.highlight(text, { language: lang }).value;
      } else {
        codeEl.innerHTML = hljs.highlightAuto(text).value;
      }
    } catch (e) {
      codeEl.textContent = text;
    }
    pre.appendChild(codeEl);
    viewer.appendChild(pre);
  }

  function renderText(text) {
    hideToc();
    viewer.textContent = '';
    appendTruncationBanner();
    viewer.appendChild(el('pre', { class: 'text-view', text: text }));
  }

  // ---------- mermaid（渲染 + 点击缩放 lightbox） ----------
  function runMermaid(container) {
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: currentTheme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'inherit',
        flowchart: { useMaxWidth: true, htmlLabels: true },
      });
      var nodes = container.querySelectorAll('.mermaid');
      mermaid.run({ nodes: nodes }).then(function () {
        bindMermaidLightbox(container);
      }).catch(function () {
        container.querySelectorAll('.mermaid').forEach(function (node) {
          var code = node.textContent;
          node.innerHTML = '<pre class="mermaid-error">Mermaid 渲染失败: ' + escapeHtml(code) + '</pre>';
        });
      });
    } catch (e) {
      /* mermaid 未加载/异常 → 保留代码块原文 */
    }
  }

  /** 渲染成功的 .mermaid 绑定点击 → lightbox（失败降级的已换成 pre，不含 svg 不绑）。 */
  function bindMermaidLightbox(container) {
    Array.prototype.forEach.call(container.querySelectorAll('.mermaid'), function (box) {
      if (!box.querySelector('svg')) return;
      box.addEventListener('click', function () {
        var svg = box.querySelector('svg');
        if (svg) openLightbox(svg);
      });
    });
  }

  var lbState = { scale: 1, tx: 0, ty: 0, drag: null };

  function naturalSvgSize(svg) {
    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width && vb.height) return { w: vb.width, h: vb.height };
    try {
      var b = svg.getBBox();
      if (b && b.width && b.height) return { w: b.width, h: b.height };
    } catch (e) { /* 未挂载等异常 → 兜底尺寸 */ }
    return { w: 800, h: 600 };
  }

  function openLightbox(svg) {
    lightboxStage.textContent = '';
    var inner = el('div', { class: 'lightbox-inner' });
    var clone = svg.cloneNode(true);
    clone.style.maxWidth = 'none';
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    inner.appendChild(clone);
    lightboxStage.appendChild(inner);
    lightbox.classList.remove('hidden');
    fitLightbox();
  }

  function fitLightbox() {
    var inner = lightboxStage.querySelector('.lightbox-inner');
    var clone = inner && inner.querySelector('svg');
    if (!inner || !clone) return;
    var size = naturalSvgSize(clone);
    clone.setAttribute('width', size.w);
    clone.setAttribute('height', size.h);
    var s = Math.min(lightboxStage.clientWidth / size.w, lightboxStage.clientHeight / size.h) * 0.92;
    lbState.scale = s;
    lbState.tx = (lightboxStage.clientWidth - size.w * s) / 2;
    lbState.ty = (lightboxStage.clientHeight - size.h * s) / 2;
    applyLightboxTransform(inner);
  }

  function applyLightboxTransform(inner) {
    inner.style.transformOrigin = '0 0';
    inner.style.transform = 'translate(' + lbState.tx + 'px,' + lbState.ty + 'px) scale(' + lbState.scale + ')';
  }

  function currentLightboxInner() {
    return lightboxStage.querySelector('.lightbox-inner');
  }

  function closeLightbox() {
    lightbox.classList.add('hidden');
    lightboxStage.textContent = '';
    lbState.drag = null;
  }

  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) closeLightbox(); // 只点背景（stage 占满内容，点 svg 不关）
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lightbox.classList.contains('hidden')) closeLightbox();
  });

  lightboxStage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var inner = currentLightboxInner();
    if (!inner) return;
    var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    var newScale = Math.min(40, Math.max(0.05, lbState.scale * factor));
    var rect = lightboxStage.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    // 以光标为中心缩放：保持光标下的内容点不动
    lbState.tx = cx - ((cx - lbState.tx) * newScale) / lbState.scale;
    lbState.ty = cy - ((cy - lbState.ty) * newScale) / lbState.scale;
    lbState.scale = newScale;
    applyLightboxTransform(inner);
  }, { passive: false });

  lightboxStage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || !currentLightboxInner()) return;
    lbState.drag = { x: e.clientX, y: e.clientY, tx: lbState.tx, ty: lbState.ty };
    lightboxStage.classList.add('dragging');
    try { lightboxStage.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  });
  lightboxStage.addEventListener('pointermove', function (e) {
    if (!lbState.drag) return;
    var inner = currentLightboxInner();
    lbState.tx = lbState.drag.tx + (e.clientX - lbState.drag.x);
    lbState.ty = lbState.drag.ty + (e.clientY - lbState.drag.y);
    if (inner) applyLightboxTransform(inner);
  });
  function endLightboxDrag(e) {
    if (!lbState.drag) return;
    lbState.drag = null;
    lightboxStage.classList.remove('dragging');
    try { lightboxStage.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  }
  lightboxStage.addEventListener('pointerup', endLightboxDrag);
  lightboxStage.addEventListener('pointercancel', endLightboxDrag);
  lightboxStage.addEventListener('dblclick', fitLightbox);

  // ---------- TOC 目录（构建 + 点击滚动 + scrollspy + 开关记忆） ----------
  function renderToc() {
    if (!tocItems.length) { hideToc(); return; }
    var minLevel = 6;
    tocItems.forEach(function (it) { if (it.level < minLevel) minLevel = it.level; });
    tocTree.textContent = '';
    tocItems.forEach(function (it) {
      var item = el('button', { class: 'toc-item', type: 'button', title: it.text, text: it.text });
      item.style.paddingLeft = (6 + (it.level - minLevel) * 14) + 'px';
      item.addEventListener('click', function () {
        var target = document.getElementById(it.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveTocItem(it);
      });
      it._el = item;
      tocTree.appendChild(item);
    });
    tocPane.classList.toggle('hidden', !tocVisible);
    bindScrollSpy();
  }

  function hideToc() {
    tocPane.classList.add('hidden');
    unbindScrollSpy();
  }

  function updateTocToggleLabel() {
    tocToggleBtn.textContent = tocVisible ? '隐藏目录' : '目录';
  }

  tocToggleBtn.addEventListener('click', function () {
    tocVisible = !tocVisible;
    localStorage.setItem(TOC_KEY, tocVisible ? '1' : '0');
    if (tocItems.length) tocPane.classList.toggle('hidden', !tocVisible);
    updateTocToggleLabel();
  });

  /** 只切高亮，不滚动 TOC 面板自身（目录列表常驻固定，2026-09 反馈：自动滚动会把列表滚乱/滚出视野）。 */
  function setActiveTocItem(it) {
    Array.prototype.forEach.call(tocTree.children, function (n) { n.classList.remove('active'); });
    if (it && it._el) it._el.classList.add('active');
  }

  /** scrollspy：滚动监听逐标题判定（IntersectionObserver 快速滚动会丢交叉事件导致高亮乱跳）。 */
  function bindScrollSpy() {
    unbindScrollSpy();
    viewer.addEventListener('scroll', onViewerScroll, { passive: true });
    onViewerScroll();
  }

  function unbindScrollSpy() {
    viewer.removeEventListener('scroll', onViewerScroll);
    if (spyRaf) { cancelAnimationFrame(spyRaf); spyRaf = 0; }
  }

  function onViewerScroll() {
    if (!tocItems.length) return;
    if (spyRaf) return; // rAF 节流：一帧最多算一次
    spyRaf = requestAnimationFrame(function () {
      spyRaf = 0;
      updateActiveToc();
    });
  }

  function updateActiveToc() {
    if (!tocItems.length) return;
    // 判定线 = 滚动容器顶部下方 64px：最后一个越过此线的标题为当前节
    var mark = viewer.getBoundingClientRect().top + 64;
    var active = null;
    for (var i = 0; i < tocItems.length; i++) {
      var t = document.getElementById(tocItems[i].id);
      if (!t) continue;
      if (t.getBoundingClientRect().top <= mark) active = tocItems[i];
      else break; // 标题按文档序排列，后面的只会更靠下
    }
    // 顶部以上无标题：贴顶时高亮第一个，避免开头无高亮
    if (!active && viewer.scrollTop <= 4) active = tocItems[0];
    // 滚到底：兜底高亮最后一个（结尾段落短于判定线的情况）
    if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 2) {
      active = tocItems[tocItems.length - 1];
    }
    setActiveTocItem(active);
  }

  // ---------- md 编辑 ----------
  function enterEdit() {
    if (currentKind !== 'md' || isEditing) return;
    if (currentTruncated) { flash('文件超过读取上限被截断，不支持编辑'); return; }
    isEditing = true;
    isDirty = false;
    hideToc();
    viewer.textContent = '';
    editorEl = document.createElement('textarea');
    editorEl.className = 'md-editor';
    editorEl.spellcheck = false;
    editorEl.value = currentText;
    editorEl.addEventListener('input', function () { isDirty = true; });
    editorEl.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        insertAtCursor(editorEl, '  ');
        isDirty = true;
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveEdit();
      }
    });
    viewer.appendChild(editorEl);
    updateToolbar();
    editorEl.focus();
  }

  function insertAtCursor(ta, text) {
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.selectionStart = start + text.length;
    ta.selectionEnd = start + text.length;
  }

  function saveEdit() {
    if (!isEditing || !editorEl) return;
    var content = editorEl.value;
    saveBtn.disabled = true;
    apiPost('/api/meow-file-view/save?path=' + encodeURIComponent(currentPath), { content: content })
      .then(function () {
        currentText = content;
        forceExitEdit();
        renderCurrent();
        flash('已保存（' + content.length + ' 字符）');
      })
      .catch(function (err) {
        saveBtn.disabled = false;
        flash('保存失败: ' + err.message);
      });
  }

  function cancelEdit() {
    if (!isEditing) return;
    if (isDirty && !window.confirm('有未保存的修改，确定放弃？')) return;
    forceExitEdit();
    renderCurrent();
  }

  editBtn.addEventListener('click', enterEdit);
  saveBtn.addEventListener('click', saveEdit);
  cancelEditBtn.addEventListener('click', cancelEdit);

  toggleSourceBtn.addEventListener('click', function () {
    if (currentKind !== 'md' || isEditing) return;
    isSource = !isSource;
    toggleSourceBtn.textContent = isSource ? '预览' : '源码';
    renderCurrent();
    updateToolbar();
  });

  // ---------- 复制路径 / 复制内容 ----------
  copyPathBtn.addEventListener('click', function () {
    if (!currentAbsPath) return;
    copyText(currentAbsPath, function () { flash('已复制路径: ' + currentAbsPath); });
  });

  copyContentBtn.addEventListener('click', function () {
    if (!currentText) return;
    copyText(currentText, function () { flash('已复制内容（' + currentText.length + ' 字符）'); });
  });

  // ---------- 刷新 ----------
  document.getElementById('refreshBtn').addEventListener('click', function () {
    if (!confirmDiscard()) return;
    api('/api/meow-file-view/tree')
      .then(function (data) {
        renderEntries(treeRoot, '', data.entries);
        if (currentPath) loadContent(currentPath);
      })
      .catch(function (err) {
        treeRoot.textContent = '';
        treeRoot.appendChild(el('div', { class: 'error', text: '刷新失败: ' + err.message }));
      });
  });

  // ---------- 初始化 ----------
  if (workspace) {
    pathBadge.textContent = '工作区: ' + workspace;
    pathBadge.classList.remove('hidden');
  }
  api('/api/meow-file-view/tree')
    .then(function (data) {
      rootBadge.textContent = '根: ' + data.root;
      rootBadge.title = data.root;
      rootBadge.classList.remove('hidden');
      renderEntries(treeRoot, '', data.entries);
    })
    .catch(function (err) {
      treeRoot.textContent = '';
      treeRoot.appendChild(el('div', { class: 'error', text: '加载失败: ' + err.message }));
    });
  // ?path= 直达（不依赖树渲染成功；树加载失败也照样打开目标文件内容）
  if (initialPath) {
    pendingDiff = initialDiff;
    openFile(initialPath, null);
  }
  applyTheme(currentTheme);
})();
