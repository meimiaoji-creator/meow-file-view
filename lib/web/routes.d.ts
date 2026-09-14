/**
 * meow-file-view Web 路由注册 —— ctx.webServer 三条命名路由。
 *
 *   - exact  /meow-file-view         → 查看器页面 HTML（壳；CSS/JS 在 static/viewer.*）
 *   - prefix /meow-file-view/static  → md-viewer lib + 页面 viewer.js/css（磁盘读，前缀校验防穿越）
 *   - prefix /api/meow-file-view     → API（GET tree/content/root/raw + POST save）
 *
 * 约束（与 meow-dsh-task 一致）：
 *   - 不抢 `registerFallback`（已被 frontend-static 占），只用 exact/prefix 命名路由。
 *   - 同源（http://127.0.0.1:3080），无 CORS。
 *   - 零 dsh 源码改动；`ctx.webServer` 类型经 `@deepseek-ai/dsh-host-webserver` 的
 *     module augmentation 提供（`import type {}` 仅为加载声明，运行时无此 import）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileViewConfig } from '../schema.js';
/**
 * 注册 Web 路由：查看器页 + 静态 lib + JSON API。
 * @param ctx    Cordis 上下文（webServer 服务由 web profile 提供）
 * @param config 归一化后的插件配置
 */
export declare function registerWebRoutes(ctx: Context, config: FileViewConfig): void;
