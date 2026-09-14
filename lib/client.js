window.__ModuleLoader__.load({
	id: "meow-file-view",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared/turn-artifacts.ts
		/**
		* 图片扩展名白名单 —— 镜像 node 半 `src/files.ts` 的 IMAGE_MIME 键。
		* ⚠️ 两边故意复制（client 不能引 node 模块）：改表需同步两处 + 测试。
		* svg 同样故意排除（防同源脚本执行面），与 node 半口径一致。
		*/
		const IMAGE_EXTS = new Set([
			"png",
			"jpg",
			"jpeg",
			"gif",
			"webp",
			"bmp",
			"ico"
		]);
		/**
		* 二进制扩展名黑名单 —— 镜像 node 半 `src/files.ts` 的 BINARY_EXTS。
		* 命中 = 查看器 /content 端点必 415，客户端就不该路由给查看器（走 Host 打开）。
		*/
		const BINARY_EXTS = new Set([
			"png",
			"jpg",
			"jpeg",
			"gif",
			"webp",
			"bmp",
			"ico",
			"pdf",
			"psd",
			"ai",
			"zip",
			"gz",
			"xz",
			"bz2",
			"7z",
			"rar",
			"tar",
			"jar",
			"war",
			"ear",
			"nupkg",
			"whl",
			"tgz",
			"exe",
			"dll",
			"so",
			"dylib",
			"o",
			"a",
			"obj",
			"lib",
			"pyc",
			"pyo",
			"class",
			"dex",
			"apk",
			"aab",
			"ipa",
			"dmg",
			"msi",
			"woff",
			"woff2",
			"ttf",
			"otf",
			"eot",
			"mp3",
			"wav",
			"flac",
			"ogg",
			"aac",
			"m4a",
			"mp4",
			"webm",
			"avi",
			"mkv",
			"mov",
			"wmv",
			"flv",
			"db",
			"sqlite",
			"sqlite3",
			"mdb",
			"bin",
			"dat",
			"iso",
			"vhd"
		]);
		/** 取路径最后一段（`/` 或 `\` 分隔；无分隔符原样返回）。 */
		function basenameOf(path) {
			const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return i >= 0 ? path.slice(i + 1) : path;
		}
		/** 取扩展名（小写、无点；无扩展名返回 ''）。 */
		function extOf(path) {
			const name = basenameOf(path);
			const i = name.lastIndexOf(".");
			if (i <= 0 || i === name.length - 1) return "";
			return name.slice(i + 1).toLowerCase();
		}
		/**
		* 是否可由本插件查看器打开：图片白名单 ∪（非二进制黑名单）。
		* 未知扩展名 → 视为可查看（与 node 半 detectType 的「text 宽进 + 空字节嗅探兜底」一致）。
		*/
		function isViewableFile(path) {
			const ext = extOf(path);
			if (IMAGE_EXTS.has(ext)) return true;
			return !BINARY_EXTS.has(ext);
		}
		/**
		* 测试类产物判定（**占位启发式**，仅按文件名）：
		* 真实的测试类产物应由未来测试报告插件以「自有工具调用 + 自有 turn 数据」判定
		* （见 docs/09 §案例）。本插件只对文件名形如 test-report / 测试报告 的产物
		* 演示路由占位 —— 点击给出提示而非打开查看器。
		*/
		function looksLikeTestReport(path) {
			return /(?:test|spec)[-_]?(?:report|result)|(?:report|result)[-_]?(?:test|spec)|测试(?:报告|结果)/i.test(basenameOf(path));
		}
		/**
		* 绝对产物路径 → 相对树根的 rel 路径（查看器 /api 只收树根内 rel）。
		* Windows 反斜杠与盘符大小写差异都归一；不在树根内返回 null（调用方回落原始路径，
		* 查看器会显示明确的加载失败 —— 比静默忽略更可诊断）。
		*/
		function relWithinRoot(root, path) {
			if (!root || !path) return null;
			const norm = (value) => value.replace(/\\/g, "/").replace(/\/+$/, "");
			const r = norm(root);
			const p = norm(path);
			if (!r || !p) return null;
			if (r.toLowerCase() === p.toLowerCase()) return "";
			const prefix = `${r.toLowerCase()}/`;
			if (!p.toLowerCase().startsWith(prefix)) return null;
			return p.slice(r.length + 1);
		}
		/**
		* 从 'deliverables' turn 数据提取本回合产物路径（首见顺序去重）。
		* @param data - 鸭子类型的 turn 数据（`owner.turn.data.get('deliverables')` 原样）。
		* @param closingSeq - 回合 closing seq；其后才 settled 的调用不计入。
		*/
		function producedPathsOf(data, closingSeq) {
			if (typeof data !== "object" || data === null) return [];
			const produced = data.produced;
			if (!Array.isArray(produced)) return [];
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			for (const entry of produced) {
				if (typeof entry !== "object" || entry === null) continue;
				const { seq, path } = entry;
				if (typeof path !== "string" || path.length === 0) continue;
				if (typeof seq !== "number" || seq > closingSeq) continue;
				if (seen.has(path)) continue;
				seen.add(path);
				paths.push(path);
			}
			return paths;
		}
		/**
		* turnTail 链槽 selector（鸭子类型 owner，纯函数）：
		* 接受 = 返回本回合产物路径（作为组件 matched）；拒绝 = null（回落官方产物行）。
		* 任何异常都拒绝 —— selector 抛错只会让本条目行渲染异常，拒绝则整行交给官方，
		* 与本插件「失败降级」惯例一致。
		*/
		function selectTurnArtifacts(owner) {
			try {
				const o = owner;
				const data = o?.turn?.data?.get?.("deliverables");
				const paths = producedPathsOf(data, typeof o?.seq === "number" ? o.seq : Number.POSITIVE_INFINITY);
				return paths.length > 0 ? paths : null;
			} catch {
				return null;
			}
		}
		//#endregion
		//#region src/client/panel-store.ts
		let open = false;
		const listeners = /* @__PURE__ */ new Set();
		/**
		* 产物联动请求：chat 回合产物 chips 点击时带的目标路径（原始工具参数路径，
		* 未必相对树根）。FilePanel 组 iframe URL 时把树根内的换算成 rel 注入 `?path=`。
		*
		* 只增不清：path 参数只在 iframe（重）加载时被 viewer.js 读一次，之后留存
		* 不影响已挂载 iframe（src 不变就不重载）；新请求 = 新 src = 重载直达目标文件。
		*/
		let requestedPath = null;
		/**
		* 打开形态：'view' 普通文件视图；'diff' 差异视图（vs HEAD，viewer.js 按 ?mode= 进入）。
		* 随 requestedPath 一起更新（src 变化 → iframe 重载 → viewer 按 mode 渲染）。
		*/
		let requestedMode = "view";
		/** 订阅开关变化；返回退订函数（React useSyncExternalStore 契约）。 */
		function subscribe(fn) {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
			};
		}
		/** 当前开关状态快照（布尔值，引用稳定，可直接作为 useSyncExternalStore 的 getSnapshot）。 */
		function getOpen() {
			return open;
		}
		/** 打开/关闭面板；无变化时 no-op（避免无谓重渲染）。 */
		function setOpen(next) {
			if (open === next) return;
			open = next;
			for (const fn of [...listeners]) fn();
		}
		/** 切换面板开关。 */
		function toggleOpen() {
			setOpen(!open);
		}
		/** 当前产物联动请求路径（null = 无，普通打开）。 */
		function getRequestedPath() {
			return requestedPath;
		}
		/** 产物 chips 点击入口：记下目标路径并打开面板（iframe 以新 src 重载直达该文件）。 */
		function openPath(path) {
			requestedPath = path;
			requestedMode = "view";
			setOpen(true);
		}
		/** 当前请求形态。 */
		function getRequestedMode() {
			return requestedMode;
		}
		/** Diff 按钮点击入口：openPath(path, 'diff')。 */
		function openDiff(path) {
			requestedPath = path;
			requestedMode = "diff";
			setOpen(true);
		}
		//#endregion
		//#region src/client/ArtifactsRow.tsx
		/**
		* 回合产物行（`conversation.chat.turnTail` 链槽条目，2026-09 新增）。
		*
		* dsh 官方 `ui-deliverables` 在同一链槽也有一条产物行（priority 0，点击经 Host
		* openFile 用系统程序打开）。本条目以 priority -1 先尝试（链槽低 priority 先选举）：
		*   - selector 接受（本回合有写/改文件产物）→ 本行接管：点击路由到**应用内查看**；
		*   - selector 拒绝 / 抛错（无产物、ui-deliverables 缺位、契约变化）→ 自然回落官方行，
		*     官方行此时也在（链槽共享），行为退化 = 原生体验，不会丢功能。
		*
		* 点击路由（共享判定在 ../shared/turn-artifacts.ts，node --test 可测）：
		*   1. 测试报告类（占位启发式）→ 占位提示（预留未来由测试报告插件打开，docs/09）；
		*   2. 可查看文件（文本/md/code/图片白名单）→ panel-store.openPath → 本插件查看面板；
		*   3. 其余（二进制等）→ 回落 owner.openFile（Host 系统打开，与官方行同款）。
		*
		* Diff 按钮（2026-09 新增）：挂载后批量探测（POST /git/probe，一次请求全量返回），
		* 命中 changed / untracked 的产物 chip 变为分体 pill——主区开文件、右侧 Diff 开
		* 差异视图（panel-store.openDiff → iframe &mode=diff → viewer 渲染 vs HEAD）。
		* 探测失败/无仓库/git 不可用 → 不显示 Diff（静默降级，按钮默认就藏）。
		*
		* 样式（2026-09 反馈「产物区空空的」调整）：整行收进紧凑卡片容器（浅底 + 细边 +
		* 圆角 + 计数徽标 + 文件类型图标），令牌取 `var(--dsw-alias-*)`（缺失时内联兜底色，
		* 跟随主界面换肤，见 docs/08）。官方 slot 约定：纯 React + 内联样式。
		*/
		/** 单行最多直出的 chip 数，超出折叠为「+N」计数（与官方 ProducedFiles 行为一致）。 */
		const SHOWN_LIMIT = 6;
		/** 探测结论里值得显示 Diff 的状态。 */
		const DIFF_SHOWABLE = new Set(["changed", "untracked"]);
		const CARD_STYLE = {
			display: "flex",
			alignItems: "center",
			alignContent: "flex-start",
			justifyContent: "flex-start",
			flexWrap: "wrap",
			gap: 6,
			height: "fit-content",
			flex: "0 0 auto",
			margin: "2px 0 0",
			padding: "8px 12px",
			border: "1px solid var(--dsw-alias-border-l1, #eceff3)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-layer-1, #f7f8fa)",
			fontSize: 12,
			lineHeight: 18
		};
		const LABEL_STYLE = {
			flex: "none",
			color: "var(--dsw-alias-label-secondary, #374151)",
			fontWeight: 600
		};
		const COUNT_STYLE = {
			flex: "none",
			minWidth: 18,
			textAlign: "center",
			padding: "0 6px",
			borderRadius: 9,
			border: "1px solid var(--dsw-alias-border-l2, #e2e5ea)",
			background: "var(--dsw-alias-bg-base, #fff)",
			color: "var(--dsw-alias-label-tertiary, #6b7280)",
			fontSize: 11,
			lineHeight: "16px"
		};
		/** 分体 pill：主区（图标+文件名，开文件）+ 右侧 Diff（开差异），探测命中才长出 Diff。 */
		const PILL_STYLE = {
			display: "inline-flex",
			alignItems: "stretch",
			maxWidth: 340,
			border: "1px solid var(--dsw-alias-border-l2, #e2e5ea)",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-base, #fff)",
			overflow: "hidden"
		};
		const MAIN_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: 5,
			minWidth: 0,
			maxWidth: 260,
			height: 24,
			padding: "0 10px",
			border: "none",
			background: "transparent",
			color: "var(--dsw-alias-label-primary, #111827)",
			fontSize: 12,
			lineHeight: "18px",
			cursor: "pointer",
			overflow: "hidden",
			whiteSpace: "nowrap",
			textOverflow: "ellipsis"
		};
		/** 测试报告占位 chip：虚线 + 半透明，视觉上与正式路由区分。 */
		const MAIN_PLACEHOLDER = {
			...MAIN_STYLE,
			borderStyle: "dashed",
			opacity: .8
		};
		const DIFF_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			height: 24,
			padding: "0 8px",
			border: "none",
			borderLeft: "1px solid var(--dsw-alias-border-l2, #e2e5ea)",
			background: "transparent",
			color: "var(--dsw-alias-link, #2f5fd7)",
			fontSize: 11,
			fontWeight: 600,
			lineHeight: "18px",
			cursor: "pointer"
		};
		const MORE_STYLE = {
			flex: "none",
			color: "var(--dsw-alias-label-tertiary, #6b7280)"
		};
		/** 单个 chip 的主区点击路由（判定纯函数在 shared）。 */
		function routeArtifactClick(path, openFileHost) {
			if (looksLikeTestReport(path)) {
				window.alert("【占位】测试类产物：此处预留由「测试报告插件」打开（meow-file-view 案例，见 docs/09）。");
				return;
			}
			if (isViewableFile(path)) {
				openPath(path);
				return;
			}
			openFileHost(path);
		}
		/**
		* 回合产物行：卡片容器 + label + 计数徽标 + 分体 pill chips（+ 溢出计数）。
		* @param props - 链槽 runtime 份额 + matched 产物路径。
		*/
		function ArtifactsRow(props) {
			const openFileHost = props.openFile;
			const paths = props.matched;
			const shown = paths.slice(0, SHOWN_LIMIT);
			const workspace = props.useSessions((state) => {
				const current = state.current;
				return current !== void 0 ? state.byId[current]?.cwd : void 0;
			});
			const [probe, setProbe] = (0, react.useState)({});
			(0, react.useEffect)(() => {
				let cancelled = false;
				setProbe({});
				const body = JSON.stringify({
					workspace,
					paths
				});
				fetch("/api/meow-file-view/git/probe", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body
				}).then(async (res) => res.ok ? await res.json() : null).then((data) => {
					if (!cancelled && data?.results !== void 0) setProbe(data.results);
				}).catch(() => {});
				return () => {
					cancelled = true;
				};
			}, [paths.join("\0"), workspace]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: CARD_STYLE,
				"data-meow-artifacts-row": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: LABEL_STYLE,
						children: "产物"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: COUNT_STYLE,
						children: paths.length
					}),
					shown.map((path) => {
						const placeholder = looksLikeTestReport(path);
						const showDiff = DIFF_SHOWABLE.has(probe[path] ?? "");
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: PILL_STYLE,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								style: placeholder ? MAIN_PLACEHOLDER : MAIN_STYLE,
								title: placeholder ? `${path}（占位：测试类产物，未来由测试报告插件打开）` : path,
								"aria-label": placeholder ? `测试类产物 ${basenameOf(path)}` : `查看 ${basenameOf(path)}`,
								onClick: () => {
									routeArtifactClick(path, openFileHost);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.LinkIcon, {
									kind: (0, _deepseek_ai_dsh_client_ui_primitives.classifyLinkPath)(path),
									size: 12
								}), basenameOf(path)]
							}), showDiff && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: DIFF_STYLE,
								title: "查看与 git 最近提交（HEAD）的差异",
								"aria-label": `Diff ${basenameOf(path)}`,
								onClick: () => {
									openDiff(path);
								},
								children: "Diff"
							})]
						}, path);
					}),
					paths.length > shown.length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: MORE_STYLE,
						children: ["+", paths.length - shown.length]
					})
				]
			});
		}
		//#endregion
		//#region src/client/FileButton.tsx
		/**
		* 输入框右端「文件」按钮（conversation.input.right 槽）。
		*
		* 与 meow-dsh-task 的「任务」按钮同款：加性列表条目注册进空置槽（发送键前、工具行右端）。
		* owner share 为 InputZone（session + input），本按钮不需要读它们——点击只切换模块级面板开关。
		*
		* 遵循官方 slot 组件约定：纯 React 组件，样式内联（不引第三方 UI 库、不引 CSS Modules，
		* 减少 client bundle 构建复杂度），文案固定中文。
		*/
		const BUTTON_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			height: 24,
			padding: "0 8px",
			border: "1px solid var(--dsw-alias-border-l2, #e2e5ea)",
			borderRadius: 6,
			background: "var(--dsw-alias-bg-base, #fff)",
			color: "var(--dsw-alias-label-primary, #111827)",
			fontSize: 12,
			lineHeight: 1,
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		/**
		* 文件按钮：点击切换右侧文件查看面板浮层。aria-pressed 反映当前开关态。
		*/
		function FileButton(_props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				title: "文件查看",
				"aria-label": "文件查看",
				"aria-pressed": (0, react.useSyncExternalStore)(subscribe, getOpen),
				onClick: toggleOpen,
				style: BUTTON_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					children: "📂"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "文件" })]
			});
		}
		//#endregion
		//#region src/client/FilePanel.tsx
		/**
		* 右侧文件查看面板浮层（shell.overlay 槽）。
		*
		* 与 meow-dsh-task 的 TaskPanel 同款：ui-layout 的 `shell.overlay` 是加性全屏浮层
		* （root 域，列表槽），渲染层 `.overlayLayer` 默认 click-through（pointer-events: none），
		* 条目根节点由 CSS 恢复 pointer-events: auto。
		*
		* 本组件：全屏遮罩 + 右停靠 80% 宽面板 + `<iframe src="/meow-file-view?workspace=…">`。
		* iframe 加载的是 node 半查看器页面，数据经同源 `/api/meow-file-view/*` fetch，
		* 浏览器半零本地文件读取。背景点击关闭面板，面板内部点击不冒泡。
		*
		* 懒挂载 + 保持挂载（与 TaskPanel 的"关闭即卸载"不同）：
		*   - 首次打开前不渲染（不预加载 3MB 查看器页）；
		*   - 打开过一次后始终渲染，关闭时仅 `display: none` 隐藏而不卸载 —— iframe 内的
		*     目录树展开/折叠状态、选中的文件、预览内容全部保留，再次打开不再重新加载、无需重找文件。
		*   - 工作区跟随：root 域 slot 用全局标准座 `useSessions` 读当前活动会话的
		*     `SessionSummary.cwd`，经 `encodeURIComponent` 注入 iframe URL 的 `?workspace=`；
		*     工作区切换 → 选择器变化 → 本组件重渲染 → iframe 以新 workspace 重载。
		*     无当前会话时回落 `/meow-file-view`（/api 走默认工作区兜底）。
		*/
		const OVERLAY_STYLE = {
			position: "absolute",
			inset: 0,
			zIndex: 30,
			background: "rgba(15, 23, 42, 0.35)"
		};
		const PANEL_STYLE = {
			position: "absolute",
			top: 0,
			right: 0,
			bottom: 0,
			width: "93%",
			maxWidth: "none",
			display: "flex",
			flexDirection: "column",
			background: "var(--dsw-alias-bg-base, #fff)",
			borderLeft: "1px solid var(--dsw-alias-border-l2, #e2e5ea)",
			boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.18)"
		};
		const HEADER_STYLE = {
			flex: "none",
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 8,
			height: 44,
			padding: "0 12px 0 16px",
			borderBottom: "1px solid var(--dsw-alias-border-l1, #eceff3)",
			fontSize: 14,
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary, #111827)"
		};
		const CLOSE_STYLE = {
			width: 28,
			height: 28,
			border: "none",
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary, #6b7280)",
			fontSize: 18,
			lineHeight: 1,
			cursor: "pointer"
		};
		const IFRAME_STYLE = {
			flex: 1,
			width: "100%",
			height: "100%",
			border: 0
		};
		/**
		* 右侧文件查看面板浮层：首次打开前不渲染；打开过一次后始终渲染，
		* 关闭时用 display:none 隐藏（iframe 与树状态保留），打开直接复用。
		*/
		function FilePanel(props) {
			const isOpen = (0, react.useSyncExternalStore)(subscribe, getOpen);
			const [everOpened, setEverOpened] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (isOpen) setEverOpened(true);
			}, [isOpen]);
			const workspace = props.useSessions((state) => {
				const current = state.current;
				return current !== void 0 ? state.byId[current]?.cwd : void 0;
			});
			const requestedPath = (0, react.useSyncExternalStore)(subscribe, getRequestedPath);
			const requestedMode = (0, react.useSyncExternalStore)(subscribe, getRequestedMode);
			const pathParam = requestedPath !== null ? (workspace !== void 0 ? relWithinRoot(workspace, requestedPath) : null) ?? requestedPath : null;
			const frameSrc = workspace ? `/meow-file-view?workspace=${encodeURIComponent(workspace)}` : "/meow-file-view";
			const fullSrc = pathParam !== null ? `${frameSrc}&path=${encodeURIComponent(pathParam)}${requestedMode === "diff" ? "&mode=diff" : ""}` : frameSrc;
			if (!everOpened) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: isOpen ? OVERLAY_STYLE : {
					...OVERLAY_STYLE,
					display: "none"
				},
				onClick: () => setOpen(false),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: PANEL_STYLE,
					onClick: (event) => event.stopPropagation(),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: HEADER_STYLE,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "文件查看" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-label": "关闭文件查看面板",
							title: "关闭",
							onClick: () => setOpen(false),
							style: CLOSE_STYLE,
							children: "×"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
						src: fullSrc,
						title: "文件查看",
						style: IFRAME_STYLE
					})]
				})
			});
		}
		//#endregion
		//#region src/client/GitSettings.tsx
		/**
		* 设置页「Git 差异」节（`settings.section` list 槽，2026-09 新增）。
		*
		* 用途：产物 Diff 的 git 探测失误时的手动兜底——
		*   - gitExePath：git 可执行文件路径（默认 `git` 走 PATH；分发机没装 git 或装在
		*     非标准位置时手动指定）；
		*   - repoRoots：仓库根覆盖表（工作区树根 → repo 根；上溯探测到错误仓库 /
		*     monorepo 子目录场景手动指定）。
		* 持久化走插件自有 API（GET/POST /api/meow-file-view/git/config → 插件根
		* git-config.json），保存即生效不用重启（meow-dsh-skill-mcp 的 server.json 同款模式）。
		*
		* 结构说明：本节 **1:1 采用 meow-vision VisionModelSection 的成熟结构**
		* （flex column 根 + section 分块 + label>span+input、输入框自然高度、字符串 px 值）——
		* 该结构已在同一设置面板实机验证无样式问题；不再自创显式高度/lineHeight 等样式。
		* 另保留 height:'fit-content' 等防拉伸兜底（内联优先级高于宿主样式表，双保险）。
		* 官方 slot 约定：纯 React + 内联样式；文案简体中文硬编码（本插件无 locale 体系）。
		*/
		/** 容器通用防拉伸兜底（内联优先级高于宿主样式表；拉伸需要 auto 高度，fit-content 锁死）。 */
		const FIT = {
			height: "fit-content",
			flex: "0 0 auto",
			alignContent: "flex-start",
			justifyContent: "flex-start"
		};
		/** 「工作区=仓库根」行解析（每行一条；空行/# 开头注释行跳过）。 */
		function parseRepoRoots(text) {
			const map = {};
			for (const line of text.split("\n")) {
				const trimmed = line.trim();
				if (trimmed === "" || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
				const eq = trimmed.indexOf("=");
				const key = trimmed.slice(0, eq).trim();
				const value = trimmed.slice(eq + 1).trim();
				if (key !== "" && value !== "") map[key] = value;
			}
			return map;
		}
		/** repoRoots 序列化回多行文本（稳定顺序，按键排序）。 */
		function formatRepoRoots(map) {
			if (map === void 0) return "";
			return Object.keys(map).sort().map((key) => `${key}=${map[key]}`).join("\n");
		}
		/**
		* 「Git 差异」设置节：gitExePath 输入 + 仓库根覆盖表多行编辑 + 保存。
		* @param props - settings.section runtime 份额（本节只用到空 owner；close 忽略）。
		*/
		function GitSettingsSection(_props) {
			const [gitExePath, setGitExePath] = (0, react.useState)("");
			const [rootsText, setRootsText] = (0, react.useState)("");
			const [status, setStatus] = (0, react.useState)({ kind: "idle" });
			(0, react.useEffect)(() => {
				let cancelled = false;
				fetch("/api/meow-file-view/git/config").then(async (res) => res.ok ? await res.json() : null).then((config) => {
					if (cancelled || config === null) return;
					setGitExePath(config.gitExePath ?? "");
					setRootsText(formatRepoRoots(config.repoRoots));
				}).catch(() => {});
				return () => {
					cancelled = true;
				};
			}, []);
			const save = () => {
				setStatus({ kind: "saving" });
				fetch("/api/meow-file-view/git/config", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						gitExePath: gitExePath.trim(),
						repoRoots: parseRepoRoots(rootsText)
					})
				}).then(async (res) => {
					if (res.ok) {
						setStatus({ kind: "ok" });
						return;
					}
					setStatus({
						kind: "error",
						message: (await res.json().catch(() => null))?.error ?? `保存失败（HTTP ${res.status}）`
					});
				}).catch((err) => {
					setStatus({
						kind: "error",
						message: err instanceof Error ? err.message : String(err)
					});
				});
			};
			const labelStyle = {
				display: "flex",
				flexDirection: "column",
				gap: "4px"
			};
			const inputStyle = { padding: "6px 8px" };
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					...FIT,
					display: "flex",
					flexDirection: "column",
					gap: "14px",
					maxWidth: "560px"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: {
						...FIT,
						display: "flex",
						flexDirection: "column",
						gap: "10px"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: {
								margin: 0,
								fontSize: "15px"
							},
							children: "Git 差异（产物 Diff）"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							style: { margin: 0 },
							children: [
								"产物 Diff 依赖本地 git（两段式自动探测：目录上溯找 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: ".git" }),
								" → git 命令可用性）。 探测不到或探测失误时，可在此手动指定；保存即生效，无需重启。"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: labelStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "git 可执行文件路径（留空 = git 走 PATH）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: gitExePath,
								placeholder: "例如 D:\\Program Files\\Git\\cmd\\git.exe",
								onChange: (event) => {
									setGitExePath(event.target.value);
								},
								style: inputStyle
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: labelStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "仓库根覆盖（每行一条：工作区路径=仓库根路径；# 开头为注释）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								rows: 3,
								value: rootsText,
								placeholder: "E:\\workspace\\my-project=E:\\workspace\\my-project\\sub\\repo\nE:\\monorepo=E:\\monorepo\\packages\\app",
								onChange: (event) => {
									setRootsText(event.target.value);
								},
								style: {
									...inputStyle,
									resize: "vertical"
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...FIT,
								display: "flex",
								alignItems: "center",
								gap: "10px"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: status.kind === "saving",
									onClick: save,
									style: { padding: "6px 14px" },
									children: status.kind === "saving" ? "保存中…" : "保存"
								}),
								status.kind === "ok" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "已保存 ✓" }),
								status.kind === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.message })
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** 插件名（cordis 诊断标签；loader 条目名仍为包名 meow-file-view）。 */
		const name = "meow-file-view-client";
		/** 需要的服务：`slots`（SlotRegistry，由 @deepseek-ai/dsh-client-runtime 提供）。 */
		const inject = ["slots"];
		/**
		* 客户端插件体：注册输入框按钮 + 右侧浮层（slot 注入，随插件卸载自动回收）。
		* @param ctx - 客户端根上下文（含 ctx.slots / ctx.effect 等 cordis 核心面）。
		*/
		function apply(ctx) {
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "meow-file-view",
				order: 30
			}, FileButton));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "meow-file-view-panel"
			}, FilePanel));
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				priority: -1,
				select: selectTurnArtifacts
			}, ArtifactsRow));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "meow-file-view-git",
				order: 18,
				label: "Git 差异"
			}, GitSettingsSection));
		}
		//#endregion
		exports.ArtifactsRow = ArtifactsRow;
		exports.FileButton = FileButton;
		exports.FilePanel = FilePanel;
		exports.GitSettingsSection = GitSettingsSection;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map