# meow-file-view

> **dsh-plugin** for DeepSeek Harness（DSH）：在对话窗查看工作区文件——输入框「文件」按钮 + 右侧滑出面板，目录树 + 预览/源码/编辑 + 回合产物直达 + Git 差异视图。

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/meimiaoji-creator/meow-file-view)

meow-file-view 解决「AI 改完文件，我却要切到 VS Code 才能看它到底改了什么」的问题。它把一个轻量文件查看器直接嵌进 DSH 对话窗：左侧目录树懒加载浏览工作区，右侧预览 Markdown（含 TOC / mermaid / 图片）、源码高亮、甚至直接编辑保存；模型每回合产出/修改的文件会以 chips 行挂在回合尾部，点一下直达该文件，命中 git 变更还能一键看 diff。

零 DSH 源码改动——独立 bundle，经 `dsh 插件 --profile web add` 装进 web profile，与官方插件平级共存。

![文件查看面板](docs/screenshots/file-panel.png)

---

## 安装

通过 dsh 官方插件管理器安装（profile = web）：

```bash
dsh 插件 --profile web add github:meimiaoji-creator/meow-file-view
```

若你的 dsh 版本子命令为英文，等价写法：

```bash
dsh plugin --profile web add github:meimiaoji-creator/meow-file-view
```

本地开发调试（指向本仓库检出目录）：

```bash
dsh 插件 --profile web add link:./
```

安装完成后，重启 dsh web 即可生效：输入框右侧出现「文件」按钮，设置弹窗多出 **meow-file-view**（Git 差异）配置节。

**安装后会发生什么**：插件向你的 dsh web profile 注册 3 条本地 HTTP 路由（查看器页面 / 静态资源 / 文件 API），并在对话窗 UI 注入 4 个界面元素（「文件」按钮、右侧面板、回合产物行、设置节）。它**不会**改动 dsh 本体、不装任何额外依赖、不发起任何外部网络请求。

---

## 功能

### 「文件」按钮 + 右侧滑出面板

- 对话窗输入框右侧常驻「文件」按钮，点击滑出查看面板（iframe 技术栈隔离，与 dsh 主 SPA 零依赖冲突）。
- 左侧**目录树**单层懒加载（默认隐藏 `node_modules` / `.git`，可配置）；树根自动跟随**会话工作区**。
- 右侧预览区按文件类型自动路由：md 渲染预览、代码/文本高亮源码、图片直接显示；常见开发产物（md / java / yml / json / ts / js / py / css / html …）都支持。

### Markdown 三态：源码 / 预览 / 编辑

- **预览**：TOC 目录栏（点击平滑滚动 + scrollspy 高亮）、mermaid 图表**点击缩放 lightbox**（滚轮缩放 / 拖拽平移 / 双击复位）、内嵌图片相对路径自动改写为本地 raw URL。
- **编辑**：预览页一键切编辑态（textarea），`Ctrl+S` 保存、`Tab` 两空格；保存走**临时文件 + rename 原子替换**，脏状态有关闭守卫。插件配置 `edit: false` 可整体关掉写入口。
- 被截断展示的超大文件（超 `maxBytes`）禁编辑，防止丢失未读入的尾部内容。

### 图片预览

png / jpg / jpeg / gif / webp / bmp / ico 直接在面板查看（20MB 上限，超限明确报错）；svg **故意排除**，避免同源脚本执行面。

### 回合产物行 + Git 差异

- 每回合结束后，本回合模型**写入/编辑过的文件**以 chips 行挂在回合尾部（读取官方 ui-deliverables 插件发布的产物路径）。
- 点击 chip → 打开查看面板并直达该文件。
- 插件自动做两段式 git 探测（先纯文件系统上溯找 `.git`，再确认 `git` 命令可用），文件有改动/未跟踪时 chip 长出 **Diff 按钮** → 差异视图（工作区+暂存区 vs HEAD；untracked 文件全文按新增行渲染）。
- 没装 git 也不碍事：探测安静失败，Diff 按钮不出现，其余功能完全正常。
- 测试报告类产物预留占位提示（未来由测试报告插件接管）。

![回合产物行与 Diff 按钮](docs/screenshots/artifacts-diff.png)

### 设置页「Git 差异」节

dsh 设置弹窗新增 meow-file-view 节：`gitExePath`（git 可执行文件路径兜底）与 `repoRoots` 覆盖表（工作区 ≠ 仓库根时逐行指定）。保存即生效，持久化到插件根 `git-config.json`，无需重启。

![设置页 Git 差异节](docs/screenshots/settings-git.png)

---

## 配置

`cordis.patch.yml` 的 `config` 字段（全部可选）：

| 字段 | 缺省 | 说明 |
|---|---|---|
| `root` | 会话工作区 | 目录树根覆盖（相对工作区解析） |
| `maxBytes` | `1048576`（1MB） | 单文本文件读取上限（超限截断展示 + 禁编辑） |
| `exclude` | `['node_modules', '.git']` | 目录树隐藏名 |
| `edit` | `true` | 是否允许浏览器端编辑并保存 md |
| `maxImageBytes` | `20971520`（20MB） | 单图片读取上限（raw 端点 + md 内嵌图片共用，超限 413） |

> 注意：`config` 显式给 `{}` 而非空值（空会解析成 null，插件 apply 会崩）。

---

## Web API 端点

本插件**不向模型提供任何工具、不注入系统提示词**——它纯粹是给人用的 UI。浏览器端通过同源 API 读写：

| 端点 | 方法 | 作用 |
|---|---|---|
| `/api/meow-file-view/tree` | GET | 单层目录列表（`?workspace=&path=`） |
| `/api/meow-file-view/content` | GET | 文本内容（附 `editAllowed`） |
| `/api/meow-file-view/root` | GET | 当前树根 |
| `/api/meow-file-view/raw` | GET | 图片字节直出（MIME 白名单 + 大小上限） |
| `/api/meow-file-view/save` | POST | 保存 md（`config.edit` 开关；原子替换） |
| `/api/meow-file-view/git/probe` | POST | 产物 git 状态探测（changed/untracked/unchanged） |
| `/api/meow-file-view/git/diff` | GET | 文件 vs HEAD 差异 |
| `/api/meow-file-view/git/config` | GET/POST | git 配置读写（设置页持久化） |

页面本身：`/meow-file-view`（自包含查看器）+ `/meow-file-view/static/*`（marked / highlight.js / DOMPurify / mermaid 随插件分发，磁盘读 + 穿越防护）。

---

## 权限与运行时行为

### 会做

- **读文件**：会话工作区内文件（目录树 / 文本内容 / 图片字节）。路径经树根校验（穿越防护），受 `maxBytes` / `maxImageBytes` 上限约束，`exclude` 名单隐藏。
- **写文件（仅两处）**：
  1. **md 保存**：仅限**已存在**的 `.md` 文件，拒绝 `.git` 内路径，临时文件写入 + rename 原子替换（`edit: false` 可整体关闭）；
  2. **插件根 `git-config.json`**：设置页保存的 gitExePath / repoRoots。
- **注册路由**：`/meow-file-view`、`/meow-file-view/static/*`、`/api/meow-file-view/*`（见上表，全部本地同源，无 CORS 暴露）。
- **运行 git 命令**：仅 `git --version` / `git status --porcelain` / `git diff HEAD`（`-c core.quotepath=false --no-color --no-ext-diff`），且仅在产物探测命中后触发；不动用户的暂存区。
- **调用 DSH 已注入的服务**：`ctx.webServer`（`inject: ['webServer']`）。
- **UI 注入**：`conversation.input.right`（文件按钮）、`shell.overlay`（右侧面板）、`conversation.chat.turnTail`（产物行）、`settings.section`（Git 差异设置）。
- **读取官方 ui-deliverables 插件按回合发布的产物路径数据**（仅文件路径列表，鸭子类型读取；该插件缺位时产物行自动不渲染）。

### 不会做

- ❌ 不读聊天记录 / 会话历史文本 / 其他插件配置
- ❌ 不提供模型工具、不注入系统提示词（`ctx.tools` / `ctx.systemPrompt` 零调用）
- ❌ 不调用任何 DSH 之外的第三方 API；browser 半只 fetch 同源 `/api/meow-file-view/*`，无 telemetry
- ❌ 不修改 DSH 源码（零补丁，独立 bundle）
- ❌ 不写工作区文件（除上述 md 保存与 git-config.json 两处）
- ❌ 不持久化任何用户隐私；图片预览故意排除 svg，防同源脚本执行

---

## 兼容性

| 项目 | 要求 |
|---|---|
| **DSH profile** | 仅 `web`（强依赖 `ctx.webServer`） |
| **DSH runtime** | `@deepseek-ai/cordis ^0.1.0` |
| **运行平台** | Node ≥ 22（与 dsh 自身要求一致），ESM only |
| **Git 差异功能** | 可选：本机装了 git 才出现 Diff 按钮 |

### 已知不兼容

- ❌ TUI / CLI profile（依赖 webServer 与浏览器 UI 注入）
- ❌ 未安装官方 ui-deliverables 插件时，回合产物行不渲染（官方 web-app bundle 默认必装，常规环境不受影响）
- ❌ 旧版 cordis API（`inject` 声明式服务注入）

---

## 依赖与 peer

- `peerDependencies`: `@deepseek-ai/cordis ^0.1.0`
- `dsh.client.inject`: `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-layout`
- node 半运行时**零 dsh 依赖**（仅 node 内置 + 相对导入，完全自包含）
- 前端库（marked / highlight.js / DOMPurify / mermaid）随插件 `static/` 分发，跑在面板 iframe 独立 window，与 dsh 主 SPA 零冲突

---

## 开发

本仓库是**发布仓库**（只含编译产物 `lib/` + `static/` + bundle 声明，不含 src 源码）。源码开发在内部 monorepo 进行；本仓库的使用方式：

```bash
npm install          # 安装 devDependencies（typescript，仅类型检查用）
npm test             # node --test（需 test/ 目录，发布仓库默认无测试文件）
```

改动 `lib/` 内代码前请先在上游源码仓库改完重新编译，再同步产物过来。

---

## License

[MIT](./LICENSE) © meimiaoji-creator
