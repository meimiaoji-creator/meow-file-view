/**
 * meow-file-view —— dsh 插件入口（node 半）。
 *
 * 文件查看插件：在对话窗提供「文件」按钮（browser 半，见 src/client），点击右侧滑出查看面板。
 * node 半只做一件事：注册 Web 路由（ctx.webServer）——
 *   1. /meow-file-view            查看器页面（自包含单页，内嵌 CSS/JS）；
 *   2. /meow-file-view/static/*   md-viewer lib（磁盘读，穿越防护）；
 *   3. /api/meow-file-view/*      JSON API（tree/content/root，读真实文件系统）。
 * 树根跟随会话工作区（session.header.cwd），由 browser 半经 iframe ?workspace= 注入。
 * 零 dsh 源码改动；与 meow-dsh-task / dsh-meow-skill 平级共存，互不影响。
 */
import { normalizeConfig } from './schema.js';
import { registerWebRoutes } from './web/routes.js';
/** 插件名（Cordis 行 id 之外的插件标识）。 */
export const name = 'meow-file-view';
/** 需要的服务：Web 路由服务（web profile 提供；browser 半的 UI 注入见 src/client）。 */
export const inject = ['webServer'];
/**
 * 插件入口：归一化配置 → 注册 Web 路由。
 * @param ctx    Cordis 上下文（webServer 服务）
 * @param config 插件配置（cordis.patch.yml config 字段；无配置时 Cordis 传 null，统一兜底空对象）
 */
export async function apply(ctx, config = {}) {
    const cfg = normalizeConfig(config ?? {});
    registerWebRoutes(ctx, cfg);
    ctx.logger.info('[meow-file-view] 已加载：/meow-file-view 查看器 + /api/meow-file-view/*（树根跟随会话工作区）');
}
